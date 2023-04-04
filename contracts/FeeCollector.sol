// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./Interfaces/IDebtToken.sol";
import "./Interfaces/IFeeCollector.sol";
import "./Interfaces/IGRVTStaking.sol";

// import "hardhat/console.sol";

contract FeeCollector is IFeeCollector, OwnableUpgradeable {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	/** Constants ---------------------------------------------------------------------------------------------------- */

	string public constant NAME = "FeeCollector";

	uint256 public constant MIN_FEE_DAYS = 7;
	uint256 public constant MIN_FEE_FRACTION = 0.038461538 * 1 ether; // (1/26) fee divided by 26 weeks
	uint256 public constant FEE_EXPIRATION_SECONDS = 175 * 24 * 60 * 60; // ~ 6 months, minus one week (MIN_FEE_DAYS)

	/** State -------------------------------------------------------------------------------------------------------- */

	mapping(address => mapping(address => FeeRecord)) public feeRecords; // borrower -> asset -> fees

	address public borrowerOperationsAddress;
	address public vesselManagerAddress;
	address public treasuryAddress;
	address public debtTokenAddress;

	IGRVTStaking public grvtStaking;
	bool public routeToGRVTStaking; // if true, collected fees go to stakers; if false, to the treasury

	bool public isInitialized;

	/** Constructor/Initializer -------------------------------------------------------------------------------------- */

	function setAddresses(
		address _borrowerOperationsAddress,
		address _vesselManagerAddress,
		address _grvtStakingAddress,
		address _debtTokenAddress,
		address _treasuryAddress,
		bool _routeToGRVTStaking
	) external initializer {
		require(!isInitialized);
		require(_treasuryAddress != address(0));
		borrowerOperationsAddress = _borrowerOperationsAddress;
		vesselManagerAddress = _vesselManagerAddress;
		grvtStaking = IGRVTStaking(_grvtStakingAddress);
		debtTokenAddress = _debtTokenAddress;
		treasuryAddress = _treasuryAddress;
		routeToGRVTStaking = _routeToGRVTStaking;
		if (_routeToGRVTStaking && address(grvtStaking) == address(0)) {
			revert FeeCollector__InvalidGRVTStakingAddress();
		}
		__Ownable_init();
		isInitialized = true;
	}

	/** Config setters ----------------------------------------------------------------------------------------------- */

	function setGRVTStakingAddress(address _grvtStakingAddress) external onlyOwner {
		grvtStaking = IGRVTStaking(_grvtStakingAddress);
		emit GRVTStakingAddressChanged(_grvtStakingAddress);
	}

	function setRouteToGRVTStaking(bool _routeToGRVTStaking) external onlyOwner {
		if (_routeToGRVTStaking && address(grvtStaking) == address(0)) {
			revert FeeCollector__InvalidGRVTStakingAddress();
		}
		routeToGRVTStaking = _routeToGRVTStaking;
		emit RouteToGRVTStakingChanged(_routeToGRVTStaking);
	}

	/** Public/external methods -------------------------------------------------------------------------------------- */

	/**
	 * Triggered when a vessel is created and again whenever the borrower acquires additional loans.
	 * Collects the minimum fee to the platform, for which there is no refund; holds on to the remaining fees until
	 * debt is paid, liquidated, or expired.
	 *
	 * Attention: this method assumes that (debt token) _feeAmount has already been minted and transferred to this contract.
	 */
	function increaseDebt(
		address _borrower,
		address _asset,
		uint256 _feeAmount
	) external override onlyBorrowerOperations {
		// console.log(" ----- increaseDebt(%s) ----- [ts: %s]", _feeAmount, block.timestamp);
		uint256 minFeeAmount = (MIN_FEE_FRACTION * _feeAmount) / 1 ether;
		uint256 refundableFeeAmount = _feeAmount - minFeeAmount;
		uint256 feeToCollect = _createOrUpdateFeeRecord(_borrower, _asset, refundableFeeAmount);
		_collectFee(_borrower, _asset, minFeeAmount + feeToCollect);
	}

	/**
	 * Triggered when a vessel is adjusted or closed (and the borrower has paid back/decreased his loan).
	 */
	function decreaseDebt(
		address _borrower,
		address _asset,
		uint256 _paybackFraction
	) external override onlyBorrowerOperationsOrVesselManager {
		// console.log(" ----- decreaseDebt(%s) -----", _paybackFraction);
		_decreaseDebt(_borrower, _asset, _paybackFraction);
	}

	/**
	 * Triggered when a debt is paid in full.
	 */
	function closeDebt(address _borrower, address _asset) external override onlyBorrowerOperationsOrVesselManager {
		// console.log(" ----- closeDebt() -----");
		_decreaseDebt(_borrower, _asset, 1 ether);
	}

	/**
	 * Triggered when a vessel is liquidated; in that case, all remaining fees are collected by the platform,
	 * and no refunds are generated.
	 */
	function liquidateDebt(address _borrower, address _asset) external override onlyVesselManager {
		// console.log(" ----- liquidateDebt() ----- ");
		FeeRecord memory mRecord = feeRecords[_borrower][_asset];
		if (mRecord.amount > 0) {
			_closeExpiredOrLiquidatedFeeRecord(_borrower, _asset, mRecord.amount);
		}
	}

	/**
	 * Batch collect fees from an array of borrowers/assets.
	 */
	function collectFees(address[] memory _borrowers, address[] memory _assets) external override {
		uint256 borrowersLength = _borrowers.length;
		if (borrowersLength != _assets.length || borrowersLength == 0) {
			revert FeeCollector__ArrayMismatch();
		}
		uint256 NOW = block.timestamp;
		for (uint256 i = 0; i < borrowersLength; ++i) {
			address borrower = _borrowers[i];
			address asset = _assets[i];
			FeeRecord storage sRecord = feeRecords[borrower][asset];
			uint256 expiredAmount = _calcExpiredAmount(sRecord.from, sRecord.to, sRecord.amount);
			if (expiredAmount == 0) {
				continue;
			}
			uint256 updatedAmount = sRecord.amount - expiredAmount;
			sRecord.amount = updatedAmount;
			sRecord.from = NOW;
			_collectFee(borrower, asset, expiredAmount);
			emit FeeRecordUpdated(borrower, asset, NOW, sRecord.to, updatedAmount);
		}
	}

	/**
	 * Triggered by VesselManager.finalizeRedemption(); assumes _amount of _asset has been moved here from ActivePool.
	 */
	function handleRedemptionFee(address _asset, uint256 _amount) external onlyVesselManager {
		if (_amount > 0) {
			address collector = routeToGRVTStaking ? address(grvtStaking) : treasuryAddress;
			IERC20Upgradeable(_asset).safeTransfer(collector, _amount);
			if (routeToGRVTStaking) {
				grvtStaking.increaseFee_Asset(_asset, _amount);
			}
			emit RedemptionFeeCollected(_asset, _amount);
		}
	}

	/** Helper & internal methods ------------------------------------------------------------------------------------ */

	function _decreaseDebt(
		address _borrower,
		address _asset,
		uint256 _paybackFraction
	) internal {
		uint256 NOW = block.timestamp;
		require(_paybackFraction <= 1 ether, "Payback fraction cannot be higher than 1 (@ 10**18)");
		require(_paybackFraction > 0, "Payback fraction cannot be zero");
		FeeRecord memory mRecord = feeRecords[_borrower][_asset];
		if (mRecord.amount == 0) {
			// console.log("      decreaseDebt() :: no records found");
			return;
		}
		if (mRecord.to < NOW) {
			// console.log("      decreaseDebt() :: record is expired");
			_closeExpiredOrLiquidatedFeeRecord(_borrower, _asset, mRecord.amount);
		} else {
			// collect expired refund
			uint256 expiredAmount = _calcExpiredAmount(mRecord.from, mRecord.to, mRecord.amount);
			_collectFee(_borrower, _asset, expiredAmount);
			if (_paybackFraction == 1e18) {
				// full payback
				uint256 refundAmount = mRecord.amount - expiredAmount;
				_refundFee(_borrower, _asset, refundAmount);
				delete feeRecords[_borrower][_asset];
				emit FeeRecordUpdated(_borrower, _asset, NOW, 0, 0);
				// console.log("^^^ EVENT FeeRecordUpdated(%s, 0, 0)", NOW);
			} else {
				// refund amount proportional to the payment
				uint256 refundAmount = ((mRecord.amount - expiredAmount) * _paybackFraction) / 1 ether;
				// console.log("      decreaseDebt() :: %s = refund", f(refundAmount));
				_refundFee(_borrower, _asset, refundAmount);
				uint256 updatedAmount = mRecord.amount - expiredAmount - refundAmount;
				feeRecords[_borrower][_asset].amount = updatedAmount;
				feeRecords[_borrower][_asset].from = NOW;
				// console.log("      decreaseDebt() :: %s left", f(updatedAmount));
				emit FeeRecordUpdated(_borrower, _asset, NOW, mRecord.to, updatedAmount);
				// console.log("^^^ EVENT FeeRecordUpdated(%s, %s, %s)", NOW, mRecord.to, f(updatedAmount));
			}
		}
	}

	function _createOrUpdateFeeRecord(
		address _borrower,
		address _asset,
		uint256 _feeAmount
	) internal returns (uint256 feeToCollect) {
		FeeRecord storage sRecord = feeRecords[_borrower][_asset];
		if (sRecord.amount == 0) {
			// console.log("  _createFeeRecord() :: creating a new fee record");
			_createFeeRecord(_borrower, _asset, _feeAmount, sRecord);
		} else {
			if (sRecord.to <= block.timestamp) {
				// console.log("  _createFeeRecord() :: record expired, collect fees and overwrite record");
				feeToCollect = sRecord.amount;
				_createFeeRecord(_borrower, _asset, _feeAmount, sRecord);
			} else {
				feeToCollect = _updateFeeRecord(_borrower, _asset, _feeAmount, sRecord);
			}
		}
	}

	function _createFeeRecord(
		address _borrower,
		address _asset,
		uint256 _feeAmount,
		FeeRecord storage _sRecord
	) internal {
		uint256 from = block.timestamp + MIN_FEE_DAYS * 24 * 60 * 60;
		uint256 to = from + FEE_EXPIRATION_SECONDS;
		_sRecord.amount = _feeAmount;
		_sRecord.from = from;
		_sRecord.to = to;
		emit FeeRecordUpdated(_borrower, _asset, from, to, _feeAmount);
		// console.log("^^^ EVENT FeeRecordUpdated(%s, %s, %s)", from, to, f(_feeAmount));
	}

	function _updateFeeRecord(
		address _borrower,
		address _asset,
		uint256 _addedAmount,
		FeeRecord storage _sRecord
	) internal returns (uint256) {
		// console.log("  _updateFeeRecord()");
		FeeRecord memory mRecord = _sRecord;
		uint256 NOW = block.timestamp;
		if (NOW < mRecord.from) {
			// loan is still in its first week (MIN_FEE_DAYS)
			// console.log("  _updateFeeRecord() :: still on first week");
			NOW = mRecord.from;
		}
		uint256 expiredAmount = _calcExpiredAmount(mRecord.from, mRecord.to, mRecord.amount);
		uint256 remainingAmount = mRecord.amount - expiredAmount;
		uint256 remainingTime = mRecord.to - NOW;
		uint256 updatedAmount = remainingAmount + _addedAmount;
		uint256 updatedTo = NOW + _calcNewDuration(remainingAmount, remainingTime, _addedAmount);
		_sRecord.amount = updatedAmount;
		_sRecord.from = NOW;
		_sRecord.to = updatedTo;
		emit FeeRecordUpdated(_borrower, _asset, NOW, updatedTo, updatedAmount);
		// console.log("^^^ EVENT FeeRecordUpdated(%s, %s, %s)", NOW, updatedTo, f(updatedAmount));
		return expiredAmount;
	}

	function _closeExpiredOrLiquidatedFeeRecord(
		address _borrower,
		address _asset,
		uint256 _amount
	) internal {
		_collectFee(_borrower, _asset, _amount);
		delete feeRecords[_borrower][_asset];
		emit FeeRecordUpdated(_borrower, _asset, block.timestamp, 0, 0);
	}

	function _calcExpiredAmount(
		uint256 _from,
		uint256 _to,
		uint256 _amount
	) internal view returns (uint256) {
		uint256 NOW = block.timestamp;
		if (_from > NOW) {
			// console.log("_calcExpiredAmount() :: RESULT = 0 (still on first week)");
			return 0;
		}
		if (NOW >= _to) {
			// console.log("_calcExpiredAmount() :: RESULT = %s (expired)", f(_amount));
			return _amount;
		}
		uint256 PRECISION = 1e9;
		uint256 lifeTime = _to - _from;
		uint256 elapsedTime = NOW - _from;
		uint256 decayRate = (_amount * PRECISION) / lifeTime;
		uint256 expiredAmount = (elapsedTime * decayRate) / PRECISION;
		// console.log("_calcExpiredAmount() :: lifeTime: %s (~%s days)", lifeTime, lifeTime / 24 / 60 / 60);
		// console.log("_calcExpiredAmount() :: elapsedTime: %s (~%s days)", elapsedTime, elapsedTime / 24 / 60 / 60);
		// console.log("_calcExpiredAmount() :: decayRate: %s", decayRate);
		// console.log("_calcExpiredAmount() :: RESULT = %s", f(expiredAmount));
		return expiredAmount;
	}

	function _calcNewDuration(
		uint256 remainingAmount,
		uint256 remainingTimeToLive,
		uint256 addedAmount
	) internal pure returns (uint256) {
		// console.log("  _calcNewDuration() :: remainingAmount = %s addedAmount = %s", f(remainingAmount), f(addedAmount));
		// console.log(
		// 	"  _calcNewDuration() :: remainingTimeToLive = %s (~%s days))",
		// 	remainingTimeToLive,
		// 	remainingTimeToLive / 24 / 60 / 60
		// );
		uint256 prevWeight = remainingAmount * remainingTimeToLive;
		uint256 nextWeight = addedAmount * FEE_EXPIRATION_SECONDS;
		uint256 newDuration = (prevWeight + nextWeight) / (remainingAmount + addedAmount);
		// console.log("  _calcNewDuration() :: prevWeight = %s nextWeight = %s", prevWeight, nextWeight);
		// console.log("  _calcNewDuration() :: RESULT = %s (~%s days)", newDuration, newDuration / 24 / 60 / 60);
		return newDuration;
	}

	/**
	 * Transfers collected (debt token) fees to either the treasury or the GRVTStaking contract, depending on a flag.
	 */
	function _collectFee(
		address _borrower,
		address _asset,
		uint256 _feeAmount
	) internal {
		if (_feeAmount > 0) {
			address collector = routeToGRVTStaking ? address(grvtStaking) : treasuryAddress;
			IDebtToken(debtTokenAddress).transfer(collector, _feeAmount);
			if (routeToGRVTStaking) {
				grvtStaking.increaseFee_DebtToken(_feeAmount);
			}
			emit FeeCollected(_borrower, _asset, collector, _feeAmount);
			// console.log("       _collectFee() :: %s collected from %s", f(_feeAmount), _borrower);
		}
	}

	function _refundFee(
		address _borrower,
		address _asset,
		uint256 _refundAmount
	) internal {
		if (_refundAmount > 0) {
			IDebtToken(debtTokenAddress).transfer(_borrower, _refundAmount);
			// console.log("        _refundFee() :: %s refunded to %s at %s", f(_refundAmount), _borrower, block.timestamp);
			emit FeeRefunded(_borrower, _asset, _refundAmount);
		}
	}

	/**
	 * TEMPORARY formatting method to help with debugging
	 * TODO remove for production deployment
	 */
	function f(uint256 value) internal pure returns (string memory) {
		string memory sInput = Strings.toString(value);
		bytes memory bInput = bytes(sInput);
		uint256 len = bInput.length > 18 ? bInput.length + 1 : 20;
		string memory sResult = new string(len);
		bytes memory bResult = bytes(sResult);
		if (bInput.length <= 18) {
			bResult[0] = "0";
			bResult[1] = ".";
			for (uint256 i = 1; i <= 18 - bInput.length; i++) bResult[i + 1] = "0";
			for (uint256 i = bInput.length; i > 0; i--) bResult[--len] = bInput[i - 1];
		} else {
			uint256 c = 0;
			uint256 i = bInput.length;
			while (i > 0) {
				bResult[--len] = bInput[--i];
				if (++c == 18) bResult[--len] = ".";
			}
		}
		return string(bResult);
	}

	/** Modifiers ---------------------------------------------------------------------------------------------------- */

	modifier onlyBorrowerOperations() {
		if (msg.sender != borrowerOperationsAddress) {
			revert FeeCollector__BorrowerOperationsOnly(msg.sender, borrowerOperationsAddress);
		}
		_;
	}

	modifier onlyVesselManager() {
		if (msg.sender != vesselManagerAddress) {
			revert FeeCollector__VesselManagerOnly(msg.sender, vesselManagerAddress);
		}
		_;
	}

	modifier onlyBorrowerOperationsOrVesselManager() {
		if (msg.sender != borrowerOperationsAddress && msg.sender != vesselManagerAddress) {
			revert FeeCollector__BorrowerOperationsOrVesselManagerOnly(
				msg.sender,
				borrowerOperationsAddress,
				vesselManagerAddress
			);
		}
		_;
	}
}
