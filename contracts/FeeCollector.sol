// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./Addresses.sol";

contract FeeCollector is IFeeCollector, UUPSUpgradeable, OwnableUpgradeable, Addresses {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	// Constants --------------------------------------------------------------------------------------------------------

	string public constant NAME = "FeeCollector";

	uint256 public constant MIN_FEE_DAYS = 7;
	uint256 public constant MIN_FEE_FRACTION = 0.038461538 * 1 ether; // (1/26) fee divided by 26 weeks
	uint256 public constant FEE_EXPIRATION_SECONDS = 175 * 1 days; // ~ 6 months, minus one week (MIN_FEE_DAYS)

	// State ------------------------------------------------------------------------------------------------------------

	mapping(address => mapping(address => FeeRecord)) public feeRecords; // borrower -> asset -> fees

	bool public constant routeToGRVTStaking = false; // if true, collected fees go to stakers; if false, to the treasury

	// Initializer ------------------------------------------------------------------------------------------------------

	function initialize() public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
	}

	// Public/external methods ------------------------------------------------------------------------------------------

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
		_decreaseDebt(_borrower, _asset, _paybackFraction);
	}

	/**
	 * Triggered when a debt is paid in full.
	 */
	function closeDebt(address _borrower, address _asset) external override onlyBorrowerOperationsOrVesselManager {
		_decreaseDebt(_borrower, _asset, 1 ether);
	}

	/**
	 * Simulates the refund due -if- vessel would be closed at this moment (helper function used by the UI).
	 */
	function simulateRefund(
		address _borrower,
		address _asset,
		uint256 _paybackFraction
	) external view override returns (uint256) {
		require(_paybackFraction <= 1 ether, "Payback fraction cannot be higher than 1 (@ 10**18)");
		require(_paybackFraction != 0, "Payback fraction cannot be zero");
		FeeRecord storage record = feeRecords[_borrower][_asset];
		if (record.amount == 0 || record.to < block.timestamp) {
			return 0;
		}
		uint256 expiredAmount = _calcExpiredAmount(record.from, record.to, record.amount);
		if (_paybackFraction == 1e18) {
			// full payback
			return record.amount - expiredAmount;
		} else {
			// calc refund amount proportional to the payment
			return ((record.amount - expiredAmount) * _paybackFraction) / 1 ether;
		}
	}

	/**
	 * Triggered when a vessel is liquidated; in that case, all remaining fees are collected by the platform,
	 * and no refunds are generated.
	 */
	function liquidateDebt(address _borrower, address _asset) external override onlyVesselManager {
		FeeRecord memory mRecord = feeRecords[_borrower][_asset];
		if (mRecord.amount != 0) {
			_closeExpiredOrLiquidatedFeeRecord(_borrower, _asset, mRecord.amount);
		}
	}

	/**
	 * Batch collect fees from an array of borrowers/assets.
	 */
	function collectFees(address[] calldata _borrowers, address[] calldata _assets) external override {
		uint256 borrowersLength = _borrowers.length;
		if (borrowersLength != _assets.length || borrowersLength == 0) {
			revert FeeCollector__ArrayMismatch();
		}
		uint256 NOW = block.timestamp;
		for (uint256 i = 0; i < borrowersLength; ) {
			address borrower = _borrowers[i];
			address asset = _assets[i];
			FeeRecord storage sRecord = feeRecords[borrower][asset];
			uint256 expiredAmount = _calcExpiredAmount(sRecord.from, sRecord.to, sRecord.amount);
			if (expiredAmount > 0) {
				uint256 updatedAmount = sRecord.amount - expiredAmount;
				sRecord.amount = updatedAmount;
				sRecord.from = NOW;
				_collectFee(borrower, asset, expiredAmount);
				emit FeeRecordUpdated(borrower, asset, NOW, sRecord.to, updatedAmount);
			}
			unchecked {
				i++;
			}
		}
	}

	/**
	 * Triggered by VesselManager.finalizeRedemption(); assumes _amount of _asset has been moved here from ActivePool.
	 */
	function handleRedemptionFee(address _asset, uint256 _amount) external onlyVesselManager {
		if (_amount != 0) {
			address collector = routeToGRVTStaking ? address(grvtStaking) : treasuryAddress;
			IERC20Upgradeable(_asset).safeTransfer(collector, _amount);
			if (routeToGRVTStaking) {
				grvtStaking.increaseFee_Asset(_asset, _amount);
			}
			emit RedemptionFeeCollected(_asset, _amount);
		}
	}

	// Helper & internal methods ----------------------------------------------------------------------------------------

	function _decreaseDebt(address _borrower, address _asset, uint256 _paybackFraction) internal {
		uint256 NOW = block.timestamp;
		require(_paybackFraction <= 1 ether, "Payback fraction cannot be higher than 1 (@ 10**18)");
		require(_paybackFraction != 0, "Payback fraction cannot be zero");
		FeeRecord storage sRecord = feeRecords[_borrower][_asset];
		if (sRecord.amount == 0) {
			return;
		}
		if (sRecord.to <= NOW) {
			_closeExpiredOrLiquidatedFeeRecord(_borrower, _asset, sRecord.amount);
		} else {
			// collect expired refund
			uint256 expiredAmount = _calcExpiredAmount(sRecord.from, sRecord.to, sRecord.amount);
			_collectFee(_borrower, _asset, expiredAmount);
			if (_paybackFraction == 1e18) {
				// full payback
				uint256 refundAmount = sRecord.amount - expiredAmount;
				sRecord.amount = 0;
				_refundFee(_borrower, _asset, refundAmount);
				emit FeeRecordUpdated(_borrower, _asset, NOW, 0, 0);
			} else {
				// refund amount proportional to the payment
				uint256 refundAmount = ((sRecord.amount - expiredAmount) * _paybackFraction) / 1 ether;
				_refundFee(_borrower, _asset, refundAmount);
				uint256 updatedAmount = sRecord.amount - expiredAmount - refundAmount;
				sRecord.amount = updatedAmount;
				sRecord.from = NOW;
				emit FeeRecordUpdated(_borrower, _asset, NOW, sRecord.to, updatedAmount);
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
			_createFeeRecord(_borrower, _asset, _feeAmount, sRecord);
		} else {
			if (sRecord.to <= block.timestamp) {
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
		uint256 from = block.timestamp + MIN_FEE_DAYS * 1 days;
		uint256 to = from + FEE_EXPIRATION_SECONDS;
		_sRecord.amount = _feeAmount;
		_sRecord.from = from;
		_sRecord.to = to;
		emit FeeRecordUpdated(_borrower, _asset, from, to, _feeAmount);
	}

	function _updateFeeRecord(
		address _borrower,
		address _asset,
		uint256 _addedAmount,
		FeeRecord storage _sRecord
	) internal returns (uint256) {
		uint256 NOW = block.timestamp;
		if (NOW < _sRecord.from) {
			// loan is still in its first week (MIN_FEE_DAYS)
			NOW = _sRecord.from;
		}
		uint256 expiredAmount = _calcExpiredAmount(_sRecord.from, _sRecord.to, _sRecord.amount);
		uint256 remainingAmount = _sRecord.amount - expiredAmount;
		uint256 remainingTime = _sRecord.to - NOW;
		uint256 updatedAmount = remainingAmount + _addedAmount;
		uint256 updatedTo = NOW + _calcNewDuration(remainingAmount, remainingTime, _addedAmount);
		_sRecord.amount = updatedAmount;
		_sRecord.from = NOW;
		_sRecord.to = updatedTo;
		emit FeeRecordUpdated(_borrower, _asset, NOW, updatedTo, updatedAmount);
		return expiredAmount;
	}

	function _closeExpiredOrLiquidatedFeeRecord(address _borrower, address _asset, uint256 _amount) internal {
		_collectFee(_borrower, _asset, _amount);
		delete feeRecords[_borrower][_asset];
		emit FeeRecordUpdated(_borrower, _asset, block.timestamp, 0, 0);
	}

	function _calcExpiredAmount(uint256 _from, uint256 _to, uint256 _amount) internal view returns (uint256) {
		uint256 NOW = block.timestamp;
		if (_from > NOW) {
			return 0;
		}
		if (NOW >= _to) {
			return _amount;
		}
		uint256 PRECISION = 1e9;
		uint256 lifeTime = _to - _from;
		uint256 elapsedTime = NOW - _from;
		uint256 decayRate = (_amount * PRECISION) / lifeTime;
		uint256 expiredAmount = (elapsedTime * decayRate) / PRECISION;
		return expiredAmount;
	}

	function _calcNewDuration(
		uint256 remainingAmount,
		uint256 remainingTimeToLive,
		uint256 addedAmount
	) internal pure returns (uint256) {
		uint256 prevWeight = remainingAmount * remainingTimeToLive;
		uint256 nextWeight = addedAmount * FEE_EXPIRATION_SECONDS;
		uint256 newDuration = (prevWeight + nextWeight) / (remainingAmount + addedAmount);
		return newDuration;
	}

	/**
	 * Transfers collected (debt token) fees to either the treasury or the GRVTStaking contract, depending on a flag.
	 */
	function _collectFee(address _borrower, address _asset, uint256 _feeAmount) internal {
		if (_feeAmount != 0) {
			address collector = routeToGRVTStaking ? address(grvtStaking) : treasuryAddress;
			IERC20Upgradeable(address(debtToken)).safeTransfer(collector, _feeAmount);
			if (routeToGRVTStaking) {
				grvtStaking.increaseFee_DebtToken(_feeAmount);
			}
			emit FeeCollected(_borrower, _asset, collector, _feeAmount);
		}
	}

	function _refundFee(address _borrower, address _asset, uint256 _refundAmount) internal {
		if (_refundAmount != 0) {
			IERC20Upgradeable(address(debtToken)).safeTransfer(_borrower, _refundAmount);
			emit FeeRefunded(_borrower, _asset, _refundAmount);
		}
	}

	// Modifiers --------------------------------------------------------------------------------------------------------

	modifier onlyBorrowerOperations() {
		if (msg.sender != address(borrowerOperations)) {
			revert FeeCollector__BorrowerOperationsOnly(msg.sender, address(borrowerOperations));
		}
		_;
	}

	modifier onlyVesselManager() {
		if (msg.sender != address(vesselManager)) {
			revert FeeCollector__VesselManagerOnly(msg.sender, address(vesselManager));
		}
		_;
	}

	modifier onlyBorrowerOperationsOrVesselManager() {
		if (msg.sender != address(borrowerOperations) && msg.sender != address(vesselManager)) {
			revert FeeCollector__BorrowerOperationsOrVesselManagerOnly(
				msg.sender,
				address(borrowerOperations),
				address(vesselManager)
			);
		}
		_;
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
