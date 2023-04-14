// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./Interfaces/IBorrowerOperations.sol";
import "./Interfaces/IVesselManager.sol";
import "./Interfaces/IDebtToken.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ISortedVessels.sol";
import "./Interfaces/IFeeCollector.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Dependencies/GravitaBase.sol";
import "./Dependencies/SafetyTransfer.sol";

contract BorrowerOperations is GravitaBase, IBorrowerOperations {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "BorrowerOperations";

	// --- Connected contract declarations ---

	IVesselManager public vesselManager;
	IStabilityPool public stabilityPool;
	address public gasPoolAddress;
	ICollSurplusPool public collSurplusPool;
	IFeeCollector public feeCollector;
	IDebtToken public debtToken;
	ISortedVessels public sortedVessels; // double-linked list, sorted by their collateral ratios

	/* --- Variable container structs  ---

    Used to hold, return and assign variables inside a function, in order to avoid the error:
    "CompilerError: Stack too deep". */

	struct LocalVariables_adjustVessel {
		address asset;
		uint256 price;
		uint256 collChange;
		uint256 netDebtChange;
		bool isCollIncrease;
		uint256 debt;
		uint256 coll;
		uint256 oldICR;
		uint256 newICR;
		uint256 newTCR;
		uint256 debtTokenFee;
		uint256 newDebt;
		uint256 newColl;
		uint256 stake;
	}

	struct LocalVariables_openVessel {
		address asset;
		uint256 price;
		uint256 debtTokenFee;
		uint256 netDebt;
		uint256 compositeDebt;
		uint256 ICR;
		uint256 NICR;
		uint256 stake;
		uint256 arrayIndex;
	}

	struct ContractsCache {
		IAdminContract adminContract;
		IVesselManager vesselManager;
		IActivePool activePool;
		IDebtToken debtToken;
	}

	enum BorrowerOperation {
		openVessel,
		closeVessel,
		adjustVessel
	}

	event VesselUpdated(
		address indexed _asset,
		address indexed _borrower,
		uint256 _debt,
		uint256 _coll,
		uint256 stake,
		BorrowerOperation operation
	);

	// --- Dependency setters ---

	function setAddresses(
		address _vesselManagerAddress,
		address _stabilityPoolAddress,
		address _gasPoolAddress,
		address _collSurplusPoolAddress,
		address _sortedVesselsAddress,
		address _debtTokenAddress,
		address _feeCollectorAddress,
		address _adminContractAddress
	) external initializer {
		__Ownable_init();
		vesselManager = IVesselManager(_vesselManagerAddress);
		stabilityPool = IStabilityPool(_stabilityPoolAddress);
		gasPoolAddress = _gasPoolAddress;
		collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
		sortedVessels = ISortedVessels(_sortedVesselsAddress);
		debtToken = IDebtToken(_debtTokenAddress);
		feeCollector = IFeeCollector(_feeCollectorAddress);
		adminContract = IAdminContract(_adminContractAddress);
	}

	// --- Borrower Vessel Operations ---

	function openVessel(
		address _asset,
		uint256 _assetAmount,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint
	) external override {
		ContractsCache memory contractsCache = ContractsCache({
			adminContract: adminContract,
			vesselManager: vesselManager,
			activePool: adminContract.activePool(),
			debtToken: debtToken
		});
		contractsCache.adminContract.sanitizeParameters(_asset);
		LocalVariables_openVessel memory vars;
		vars.asset = _asset;

		vars.price = contractsCache.adminContract.priceFeed().fetchPrice(vars.asset);
		bool isRecoveryMode = _checkRecoveryMode(vars.asset, vars.price);

		_requireVesselIsNotActive(vars.asset, contractsCache.vesselManager, msg.sender);

		vars.netDebt = _debtTokenAmount;

		if (!isRecoveryMode) {
			vars.debtTokenFee = _triggerBorrowingFee(
				vars.asset,
				contractsCache.vesselManager,
				contractsCache.debtToken,
				_debtTokenAmount
			);
			vars.netDebt = vars.netDebt + vars.debtTokenFee;
		}
		_requireAtLeastMinNetDebt(vars.asset, vars.netDebt);

		// ICR is based on the composite debt, i.e. the requested debt token amount + borrowing fee + gas comp.
		vars.compositeDebt = _getCompositeDebt(vars.asset, vars.netDebt);
		assert(vars.compositeDebt > 0);

		vars.ICR = GravitaMath._computeCR(_assetAmount, vars.compositeDebt, vars.price);
		vars.NICR = GravitaMath._computeNominalCR(_assetAmount, vars.compositeDebt);

		if (isRecoveryMode) {
			_requireICRisAboveCCR(vars.asset, vars.ICR);
		} else {
			_requireICRisAboveMCR(vars.asset, vars.ICR);
			uint256 newTCR = _getNewTCRFromVesselChange(vars.asset, _assetAmount, true, vars.compositeDebt, true, vars.price); // bools: coll increase, debt increase
			_requireNewTCRisAboveCCR(vars.asset, newTCR);
		}

		// Set the vessel struct's properties
		contractsCache.vesselManager.setVesselStatus(vars.asset, msg.sender, 1); // Vessel Status 1 = Active
		contractsCache.vesselManager.increaseVesselColl(vars.asset, msg.sender, _assetAmount);
		contractsCache.vesselManager.increaseVesselDebt(vars.asset, msg.sender, vars.compositeDebt);

		contractsCache.vesselManager.updateVesselRewardSnapshots(vars.asset, msg.sender);
		vars.stake = contractsCache.vesselManager.updateStakeAndTotalStakes(vars.asset, msg.sender);

		sortedVessels.insert(vars.asset, msg.sender, vars.NICR, _upperHint, _lowerHint);
		vars.arrayIndex = contractsCache.vesselManager.addVesselOwnerToArray(vars.asset, msg.sender);
		emit VesselCreated(vars.asset, msg.sender, vars.arrayIndex);

		// Move the asset to the Active Pool, and mint the debtToken amount to the borrower
		_activePoolAddColl(vars.asset, contractsCache.activePool, _assetAmount);
		_withdrawDebtTokens(
			vars.asset,
			contractsCache.activePool,
			contractsCache.debtToken,
			msg.sender,
			_debtTokenAmount,
			vars.netDebt
		);
		// Move the debtToken gas compensation to the Gas Pool
		_withdrawDebtTokens(
			vars.asset,
			contractsCache.activePool,
			contractsCache.debtToken,
			gasPoolAddress,
			contractsCache.adminContract.getDebtTokenGasCompensation(vars.asset),
			contractsCache.adminContract.getDebtTokenGasCompensation(vars.asset)
		);

		emit VesselUpdated(
			vars.asset,
			msg.sender,
			vars.compositeDebt,
			_assetAmount,
			vars.stake,
			BorrowerOperation.openVessel
		);
		emit BorrowingFeePaid(vars.asset, msg.sender, vars.debtTokenFee);
	}

	// Send collateral to a vessel
	function addColl(
		address _asset,
		uint256 _assetSent,
		address _upperHint,
		address _lowerHint
	) external override {
		_adjustVessel(_asset, _assetSent, msg.sender, 0, 0, false, _upperHint, _lowerHint);
	}

	// Withdraw collateral from a vessel
	function withdrawColl(
		address _asset,
		uint256 _collWithdrawal,
		address _upperHint,
		address _lowerHint
	) external override {
		_adjustVessel(_asset, 0, msg.sender, _collWithdrawal, 0, false, _upperHint, _lowerHint);
	}

	// Withdraw debt tokens from a vessel: mint new debt tokens to the owner, and increase the vessel's debt accordingly
	function withdrawDebtTokens(
		address _asset,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint
	) external override {
		_adjustVessel(_asset, 0, msg.sender, 0, _debtTokenAmount, true, _upperHint, _lowerHint);
	}

	// Repay debt tokens to a Vessel: Burn the repaid debt tokens, and reduce the vessel's debt accordingly
	function repayDebtTokens(
		address _asset,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint
	) external override {
		_adjustVessel(_asset, 0, msg.sender, 0, _debtTokenAmount, false, _upperHint, _lowerHint);
	}

	function adjustVessel(
		address _asset,
		uint256 _assetSent,
		uint256 _collWithdrawal,
		uint256 _debtTokenChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint
	) external override {
		_adjustVessel(
			_asset,
			_assetSent,
			msg.sender,
			_collWithdrawal,
			_debtTokenChange,
			_isDebtIncrease,
			_upperHint,
			_lowerHint
		);
	}

	/*
	 * _adjustVessel(): Alongside a debt change, this function can perform either a collateral top-up or a collateral withdrawal.
	 */
	function _adjustVessel(
		address _asset,
		uint256 _assetSent,
		address _borrower,
		uint256 _collWithdrawal,
		uint256 _debtTokenChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint
	) internal {
		ContractsCache memory contractsCache = ContractsCache({
			adminContract: adminContract,
			vesselManager: vesselManager,
			activePool: adminContract.activePool(),
			debtToken: debtToken
		});
		LocalVariables_adjustVessel memory vars;
		vars.asset = _asset;
		vars.price = contractsCache.adminContract.priceFeed().fetchPrice(vars.asset);
		bool isRecoveryMode = _checkRecoveryMode(vars.asset, vars.price);

		if (_isDebtIncrease) {
			_requireNonZeroDebtChange(_debtTokenChange);
		}
		_requireSingularCollChange(_collWithdrawal, _assetSent);
		_requireNonZeroAdjustment(_collWithdrawal, _debtTokenChange, _assetSent);
		_requireVesselIsActive(vars.asset, contractsCache.vesselManager, _borrower);

		// Confirm the operation is either a borrower adjusting their own vessel, or a pure asset transfer from the Stability Pool to a vessel
		assert(
			msg.sender == _borrower || (address(stabilityPool) == msg.sender && _assetSent > 0 && _debtTokenChange == 0)
		);

		contractsCache.vesselManager.applyPendingRewards(vars.asset, _borrower);

		// Get the collChange based on whether or not asset was sent in the transaction
		(vars.collChange, vars.isCollIncrease) = _getCollChange(_assetSent, _collWithdrawal);

		vars.netDebtChange = _debtTokenChange;

		// If the adjustment incorporates a debt increase and system is in Normal Mode, then trigger a borrowing fee
		if (_isDebtIncrease && !isRecoveryMode) {
			vars.debtTokenFee = _triggerBorrowingFee(
				vars.asset,
				contractsCache.vesselManager,
				contractsCache.debtToken,
				_debtTokenChange
			);
			vars.netDebtChange = vars.netDebtChange + vars.debtTokenFee; // The raw debt change includes the fee
		}

		vars.debt = contractsCache.vesselManager.getVesselDebt(vars.asset, _borrower);
		vars.coll = contractsCache.vesselManager.getVesselColl(vars.asset, _borrower);

		// Get the vessel's old ICR before the adjustment, and what its new ICR will be after the adjustment
		vars.oldICR = GravitaMath._computeCR(vars.coll, vars.debt, vars.price);
		vars.newICR = _getNewICRFromVesselChange(
			vars.coll,
			vars.debt,
			vars.collChange,
			vars.isCollIncrease,
			vars.netDebtChange,
			_isDebtIncrease,
			vars.price
		);
		require(_collWithdrawal <= vars.coll, "BorrowerOps: Trying to remove more than the vessel holds");

		// Check the adjustment satisfies all conditions for the current system mode
		_requireValidAdjustmentInCurrentMode(vars.asset, isRecoveryMode, _collWithdrawal, _isDebtIncrease, vars);

		// When the adjustment is a debt repayment, check it's a valid amount and that the caller has enough debt tokens
		if (!_isDebtIncrease && _debtTokenChange > 0) {
			_requireAtLeastMinNetDebt(vars.asset, _getNetDebt(vars.asset, vars.debt) - vars.netDebtChange);
			_requireValidDebtTokenRepayment(vars.asset, vars.debt, vars.netDebtChange);
			_requireSufficientDebtTokenBalance(contractsCache.debtToken, _borrower, vars.netDebtChange);
		}

		(vars.newColl, vars.newDebt) = _updateVesselFromAdjustment(
			vars.asset,
			contractsCache.vesselManager,
			_borrower,
			vars.collChange,
			vars.isCollIncrease,
			vars.netDebtChange,
			_isDebtIncrease
		);
		vars.stake = contractsCache.vesselManager.updateStakeAndTotalStakes(vars.asset, _borrower);

		// Re-insert vessel in to the sorted list
		uint256 newNICR = _getNewNominalICRFromVesselChange(
			vars.coll,
			vars.debt,
			vars.collChange,
			vars.isCollIncrease,
			vars.netDebtChange,
			_isDebtIncrease
		);
		sortedVessels.reInsert(vars.asset, _borrower, newNICR, _upperHint, _lowerHint);

		emit VesselUpdated(vars.asset, _borrower, vars.newDebt, vars.newColl, vars.stake, BorrowerOperation.adjustVessel);
		emit BorrowingFeePaid(vars.asset, msg.sender, vars.debtTokenFee);

		// Use the unmodified _debtTokenChange here, as we don't send the fee to the user
		_moveTokensFromAdjustment(
			vars.asset,
			contractsCache.activePool,
			contractsCache.debtToken,
			msg.sender,
			vars.collChange,
			vars.isCollIncrease,
			_debtTokenChange,
			_isDebtIncrease,
			vars.netDebtChange
		);
	}

	function closeVessel(address _asset) external override {
		IVesselManager vesselManagerCached = vesselManager;
		IAdminContract adminContractCached = adminContract;
		IActivePool activePoolCached = adminContractCached.activePool();
		IDebtToken debtTokenCached = debtToken;

		_requireVesselIsActive(_asset, vesselManagerCached, msg.sender);
		uint256 price = adminContractCached.priceFeed().fetchPrice(_asset);
		_requireNotInRecoveryMode(_asset, price);

		vesselManagerCached.applyPendingRewards(_asset, msg.sender);

		uint256 coll = vesselManagerCached.getVesselColl(_asset, msg.sender);
		uint256 debt = vesselManagerCached.getVesselDebt(_asset, msg.sender);

		_requireSufficientDebtTokenBalance(
			debtTokenCached,
			msg.sender,
			debt - adminContractCached.getDebtTokenGasCompensation(_asset)
		);

		uint256 newTCR = _getNewTCRFromVesselChange(_asset, coll, false, debt, false, price);
		_requireNewTCRisAboveCCR(_asset, newTCR);

		vesselManagerCached.removeStake(_asset, msg.sender);
		vesselManagerCached.closeVessel(_asset, msg.sender);

		emit VesselUpdated(_asset, msg.sender, 0, 0, 0, BorrowerOperation.closeVessel);
		uint256 gasCompensation = adminContractCached.getDebtTokenGasCompensation(_asset);
		// Burn the repaid debt tokens from the user's balance and the gas compensation from the Gas Pool
		_repayDebtTokens(_asset, activePoolCached, debtTokenCached, msg.sender, debt - gasCompensation);
		_repayDebtTokens(_asset, activePoolCached, debtTokenCached, gasPoolAddress, gasCompensation);

		// Send the collateral back to the user
		activePoolCached.sendAsset(_asset, msg.sender, coll);
		// Signal to the fee collector that debt has been paid in full
		feeCollector.closeDebt(msg.sender, _asset);
	}

	/**
	 * Claim remaining collateral from a redemption or from a liquidation with ICR > MCR in Recovery Mode
	 */
	function claimCollateral(address _asset) external override {
		// send asset from CollSurplusPool to owner
		collSurplusPool.claimColl(_asset, msg.sender);
	}

	// --- Helper functions ---

	function _triggerBorrowingFee(
		address _asset,
		IVesselManager _vesselManager,
		IDebtToken _debtToken,
		uint256 _debtTokenAmount
	) internal returns (uint256) {
		uint256 debtTokenFee = _vesselManager.getBorrowingFee(_asset, _debtTokenAmount);
		_debtToken.mint(_asset, address(feeCollector), debtTokenFee);
		feeCollector.increaseDebt(msg.sender, _asset, debtTokenFee);
		return debtTokenFee;
	}

	function _getUSDValue(uint256 _coll, uint256 _price) internal pure returns (uint256) {
		return _price * _coll / DECIMAL_PRECISION;
	}

	function _getCollChange(uint256 _collReceived, uint256 _requestedCollWithdrawal)
		internal
		pure
		returns (uint256 collChange, bool isCollIncrease)
	{
		if (_collReceived != 0) {
			collChange = _collReceived;
			isCollIncrease = true;
		} else {
			collChange = _requestedCollWithdrawal;
		}
	}

	// Update vessel's coll and debt based on whether they increase or decrease
	function _updateVesselFromAdjustment(
		address _asset,
		IVesselManager _vesselManager,
		address _borrower,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease
	) internal returns (uint256, uint256) {
		uint256 newColl = (_isCollIncrease)
			? _vesselManager.increaseVesselColl(_asset, _borrower, _collChange)
			: _vesselManager.decreaseVesselColl(_asset, _borrower, _collChange);
		uint256 newDebt = (_isDebtIncrease)
			? _vesselManager.increaseVesselDebt(_asset, _borrower, _debtChange)
			: _vesselManager.decreaseVesselDebt(_asset, _borrower, _debtChange);

		return (newColl, newDebt);
	}

	function _moveTokensFromAdjustment(
		address _asset,
		IActivePool _activePool,
		IDebtToken _debtToken,
		address _borrower,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtTokenChange,
		bool _isDebtIncrease,
		uint256 _netDebtChange
	) internal {
		if (_isDebtIncrease) {
			_withdrawDebtTokens(_asset, _activePool, _debtToken, _borrower, _debtTokenChange, _netDebtChange);
		} else {
			_repayDebtTokens(_asset, _activePool, _debtToken, _borrower, _debtTokenChange);
		}
		if (_isCollIncrease) {
			_activePoolAddColl(_asset, _activePool, _collChange);
		} else {
			_activePool.sendAsset(_asset, _borrower, _collChange);
		}
	}

	// Send asset to Active Pool and increase its recorded asset balance
	function _activePoolAddColl(
		address _asset,
		IActivePool _activePool,
		uint256 _amount
	) internal {
		IERC20Upgradeable(_asset).safeTransferFrom(
			msg.sender,
			address(_activePool),
			SafetyTransfer.decimalsCorrection(_asset, _amount)
		);
		_activePool.receivedERC20(_asset, _amount);
	}

	// Issue the specified amount of debt tokens to _account and increases the total active debt (_netDebtIncrease potentially includes a debtTokenFee)
	function _withdrawDebtTokens(
		address _asset,
		IActivePool _activePool,
		IDebtToken _debtToken,
		address _account,
		uint256 _debtTokenAmount,
		uint256 _netDebtIncrease
	) internal {
		uint256 newTotalAssetDebt = _activePool.getDebtTokenBalance(_asset) +
			adminContract.defaultPool().getDebtTokenBalance(_asset) +
			_netDebtIncrease;
		require(newTotalAssetDebt <= adminContract.getMintCap(_asset), "BorrowerOperations: Exceeds mint cap");
		_activePool.increaseDebt(_asset, _netDebtIncrease);
		_debtToken.mint(_asset, _account, _debtTokenAmount);
	}

	// Burn the specified amount of debt tokens from _account and decreases the total active debt
	function _repayDebtTokens(
		address _asset,
		IActivePool _activePool,
		IDebtToken _debtToken,
		address _account,
		uint256 _debtTokenAmount
	) internal {
		_activePool.decreaseDebt(_asset, _debtTokenAmount);
		_debtToken.burn(_account, _debtTokenAmount);
	}

	// --- 'Require' wrapper functions ---

	function _requireSingularCollChange(uint256 _collWithdrawal, uint256 _amountSent) internal pure {
		require(_collWithdrawal == 0 || _amountSent == 0, "BorrowerOperations: Cannot withdraw and add coll");
	}

	function _requireCallerIsBorrower(address _borrower) internal view {
		require(msg.sender == _borrower, "BorrowerOps: Caller must be the borrower for a withdrawal");
	}

	function _requireNonZeroAdjustment(
		uint256 _collWithdrawal,
		uint256 _debtTokenChange,
		uint256 _assetSent
	) internal pure {
		require(
			_collWithdrawal != 0 || _debtTokenChange != 0 || _assetSent != 0,
			"BorrowerOps: There must be either a collateral change or a debt change"
		);
	}

	function _requireVesselIsActive(
		address _asset,
		IVesselManager _vesselManager,
		address _borrower
	) internal view {
		uint256 status = _vesselManager.getVesselStatus(_asset, _borrower);
		require(status == 1, "BorrowerOps: Vessel does not exist or is closed");
	}

	function _requireVesselIsNotActive(
		address _asset,
		IVesselManager _vesselManager,
		address _borrower
	) internal view {
		uint256 status = _vesselManager.getVesselStatus(_asset, _borrower);
		require(status != 1, "BorrowerOps: Vessel is active");
	}

	function _requireNonZeroDebtChange(uint256 _debtTokenChange) internal pure {
		require(_debtTokenChange > 0, "BorrowerOps: Debt increase requires non-zero debtChange");
	}

	function _requireNotInRecoveryMode(address _asset, uint256 _price) internal view {
		require(!_checkRecoveryMode(_asset, _price), "BorrowerOps: Operation not permitted during Recovery Mode");
	}

	function _requireNoCollWithdrawal(uint256 _collWithdrawal) internal pure {
		require(_collWithdrawal == 0, "BorrowerOps: Collateral withdrawal not permitted Recovery Mode");
	}

	function _requireValidAdjustmentInCurrentMode(
		address _asset,
		bool _isRecoveryMode,
		uint256 _collWithdrawal,
		bool _isDebtIncrease,
		LocalVariables_adjustVessel memory _vars
	) internal view {
		/*
		 * In Recovery Mode, only allow:
		 *
		 * - Pure collateral top-up
		 * - Pure debt repayment
		 * - Collateral top-up with debt repayment
		 * - A debt increase combined with a collateral top-up which makes the ICR >= 150% and improves the ICR (and by extension improves the TCR).
		 *
		 * In Normal Mode, ensure:
		 *
		 * - The new ICR is above MCR
		 * - The adjustment won't pull the TCR below CCR
		 */
		if (_isRecoveryMode) {
			_requireNoCollWithdrawal(_collWithdrawal);
			if (_isDebtIncrease) {
				_requireICRisAboveCCR(_asset, _vars.newICR);
				_requireNewICRisAboveOldICR(_vars.newICR, _vars.oldICR);
			}
		} else {
			// if Normal Mode
			_requireICRisAboveMCR(_asset, _vars.newICR);
			_vars.newTCR = _getNewTCRFromVesselChange(
				_asset,
				_vars.collChange,
				_vars.isCollIncrease,
				_vars.netDebtChange,
				_isDebtIncrease,
				_vars.price
			);
			_requireNewTCRisAboveCCR(_asset, _vars.newTCR);
		}
	}

	function _requireICRisAboveMCR(address _asset, uint256 _newICR) internal view {
		require(
			_newICR >= adminContract.getMcr(_asset),
			"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
		);
	}

	function _requireICRisAboveCCR(address _asset, uint256 _newICR) internal view {
		require(_newICR >= adminContract.getCcr(_asset), "BorrowerOps: Operation must leave vessel with ICR >= CCR");
	}

	function _requireNewICRisAboveOldICR(uint256 _newICR, uint256 _oldICR) internal pure {
		require(_newICR >= _oldICR, "BorrowerOps: Cannot decrease your Vessel's ICR in Recovery Mode");
	}

	function _requireNewTCRisAboveCCR(address _asset, uint256 _newTCR) internal view {
		require(
			_newTCR >= adminContract.getCcr(_asset),
			"BorrowerOps: An operation that would result in TCR < CCR is not permitted"
		);
	}

	function _requireAtLeastMinNetDebt(address _asset, uint256 _netDebt) internal view {
		require(
			_netDebt >= adminContract.getMinNetDebt(_asset),
			"BorrowerOps: Vessel's net debt must be greater than minimum"
		);
	}

	function _requireValidDebtTokenRepayment(
		address _asset,
		uint256 _currentDebt,
		uint256 _debtRepayment
	) internal view {
		require(
			_debtRepayment <= _currentDebt - adminContract.getDebtTokenGasCompensation(_asset),
			"BorrowerOps: Amount repaid must not be larger than the Vessel's debt"
		);
	}

	function _requireCallerIsStabilityPool() internal view {
		require(address(stabilityPool) == msg.sender, "BorrowerOps: Caller is not Stability Pool");
	}

	function _requireSufficientDebtTokenBalance(
		IDebtToken _debtToken,
		address _borrower,
		uint256 _debtRepayment
	) internal view {
		require(
			_debtToken.balanceOf(_borrower) >= _debtRepayment,
			"BorrowerOps: Caller doesnt have enough debt tokens to make repayment"
		);
	}

	// --- ICR and TCR getters ---

	// Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
	function _getNewNominalICRFromVesselChange(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease
	) internal pure returns (uint256) {
		(uint256 newColl, uint256 newDebt) = _getNewVesselAmounts(
			_coll,
			_debt,
			_collChange,
			_isCollIncrease,
			_debtChange,
			_isDebtIncrease
		);

		uint256 newNICR = GravitaMath._computeNominalCR(newColl, newDebt);
		return newNICR;
	}

	// Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
	function _getNewICRFromVesselChange(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease,
		uint256 _price
	) internal pure returns (uint256) {
		(uint256 newColl, uint256 newDebt) = _getNewVesselAmounts(
			_coll,
			_debt,
			_collChange,
			_isCollIncrease,
			_debtChange,
			_isDebtIncrease
		);

		uint256 newICR = GravitaMath._computeCR(newColl, newDebt, _price);
		return newICR;
	}

	function _getNewVesselAmounts(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease
	) internal pure returns (uint256, uint256) {
		uint256 newColl = _coll;
		uint256 newDebt = _debt;

		newColl = _isCollIncrease ? _coll + _collChange : _coll - _collChange;
		newDebt = _isDebtIncrease ? _debt + _debtChange : _debt - _debtChange;

		return (newColl, newDebt);
	}

	function _getNewTCRFromVesselChange(
		address _asset,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease,
		uint256 _price
	) internal view returns (uint256) {
		uint256 totalColl = getEntireSystemColl(_asset);
		uint256 totalDebt = getEntireSystemDebt(_asset);

		totalColl = _isCollIncrease ? totalColl + _collChange : totalColl - _collChange;
		totalDebt = _isDebtIncrease ? totalDebt + _debtChange : totalDebt - _debtChange;

		uint256 newTCR = GravitaMath._computeCR(totalColl, totalDebt, _price);
		return newTCR;
	}

	function getCompositeDebt(address _asset, uint256 _debt) external view override returns (uint256) {
		return _getCompositeDebt(_asset, _debt);
	}
}
