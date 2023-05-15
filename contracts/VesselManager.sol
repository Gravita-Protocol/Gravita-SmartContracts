// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./Dependencies/GravitaBase.sol";

import "./Interfaces/IFeeCollector.sol";
import "./Interfaces/IVesselManager.sol";

contract VesselManager is IVesselManager, UUPSUpgradeable, ReentrancyGuardUpgradeable, GravitaBase {
	// Constants ------------------------------------------------------------------------------------------------------

	string public constant NAME = "VesselManager";

	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;
	/*
	 * Half-life of 12h. 12h = 720 min
	 * (1/2) = d^720 => d = (1/2)^(1/720)
	 */
	uint256 public constant MINUTE_DECAY_FACTOR = 999037758833783000;

	/*
	 * BETA: 18 digit decimal. Parameter by which to divide the redeemed fraction, in order to calc the new base rate from a redemption.
	 * Corresponds to (1 / ALPHA) in the white paper.
	 */
	uint256 public constant BETA = 2;

	// Structs --------------------------------------------------------------------------------------------------------

	// Object containing the asset and debt token snapshots for a given active vessel
	struct RewardSnapshot {
		uint256 asset;
		uint256 debt;
	}

	// State ----------------------------------------------------------------------------------------------------------

	address public constant borrowerOperations = address(0);
	address public constant gasPoolAddress = address(0);
	address public constant vesselManagerOperations = address(0);

	IStabilityPool public constant stabilityPool = IStabilityPool(address(0));
	IDebtToken public constant debtToken = IDebtToken(address(0));
	IFeeCollector public constant feeCollector = IFeeCollector(address(0));
	ICollSurplusPool public constant collSurplusPool = ICollSurplusPool(address(0));
	ISortedVessels public constant sortedVessels = ISortedVessels(address(0)); // double-linked list of Vessels, sorted by their collateral ratios

	mapping(address => uint256) public baseRate;

	// The timestamp of the latest fee operation (redemption or new debt token issuance)
	mapping(address => uint256) public lastFeeOperationTime;

	// Vessels[borrower address][Collateral address]
	mapping(address => mapping(address => Vessel)) public Vessels;

	mapping(address => uint256) public totalStakes;

	// Snapshot of the value of totalStakes, taken immediately after the latest liquidation
	mapping(address => uint256) public totalStakesSnapshot;

	// Snapshot of the total collateral across the ActivePool and DefaultPool, immediately after the latest liquidation.
	mapping(address => uint256) public totalCollateralSnapshot;

	/*
	 * L_Colls and L_Debts track the sums of accumulated liquidation rewards per unit staked. During its lifetime, each stake earns:
	 *
	 * An asset gain of ( stake * [L_Colls - L_Colls(0)] )
	 * A debt increase of ( stake * [L_Debts - L_Debts(0)] )
	 *
	 * Where L_Colls(0) and L_Debts(0) are snapshots of L_Colls and L_Debts for the active Vessel taken at the instant the stake was made
	 */
	mapping(address => uint256) public L_Colls;
	mapping(address => uint256) public L_Debts;

	// Map addresses with active vessels to their RewardSnapshot
	mapping(address => mapping(address => RewardSnapshot)) public rewardSnapshots;

	// Array of all active vessel addresses - used to to compute an approximate hint off-chain, for the sorted list insertion
	mapping(address => address[]) public VesselOwners;

	// Error trackers for the vessel redistribution calculation
	mapping(address => uint256) public lastCollError_Redistribution;
	mapping(address => uint256) public lastDebtError_Redistribution;

	bool public isSetupInitialized;

	// Modifiers ------------------------------------------------------------------------------------------------------

	modifier onlyVesselManagerOperations() {
		if (msg.sender != vesselManagerOperations) {
			revert VesselManager__OnlyVesselManagerOperations();
		}
		_;
	}

	modifier onlyBorrowerOperations() {
		if (msg.sender != borrowerOperations) {
			revert VesselManager__OnlyBorrowerOperations();
		}
		_;
	}

	modifier onlyVesselManagerOperationsOrBorrowerOperations() {
		if (msg.sender != borrowerOperations && msg.sender != vesselManagerOperations) {
			revert VesselManager__OnlyVesselManagerOperationsOrBorrowerOperations();
		}
		_;
	}

	// Initializer ------------------------------------------------------------------------------------------------------

	function initialize() public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
		__ReentrancyGuard_init();
	}

	// External/public functions --------------------------------------------------------------------------------------

	function isValidFirstRedemptionHint(
		address _asset,
		address _firstRedemptionHint,
		uint256 _price
	) external view returns (bool) {
		if (
			_firstRedemptionHint == address(0) ||
			!sortedVessels.contains(_asset, _firstRedemptionHint) ||
			getCurrentICR(_asset, _firstRedemptionHint, _price) < adminContract.getMcr(_asset)
		) {
			return false;
		}
		address nextVessel = sortedVessels.getNext(_asset, _firstRedemptionHint);
		return nextVessel == address(0) || getCurrentICR(_asset, nextVessel, _price) < adminContract.getMcr(_asset);
	}

	// Return the nominal collateral ratio (ICR) of a given Vessel, without the price. Takes a vessel's pending coll and debt rewards from redistributions into account.
	function getNominalICR(address _asset, address _borrower) external view override returns (uint256) {
		(uint256 currentAsset, uint256 currentDebt) = _getCurrentVesselAmounts(_asset, _borrower);

		uint256 NICR = GravitaMath._computeNominalCR(currentAsset, currentDebt);
		return NICR;
	}

	// Return the current collateral ratio (ICR) of a given Vessel. Takes a vessel's pending coll and debt rewards from redistributions into account.
	function getCurrentICR(address _asset, address _borrower, uint256 _price) public view override returns (uint256) {
		(uint256 currentAsset, uint256 currentDebt) = _getCurrentVesselAmounts(_asset, _borrower);
		uint256 ICR = GravitaMath._computeCR(currentAsset, currentDebt, _price);
		return ICR;
	}

	// Get the borrower's pending accumulated asset reward, earned by their stake
	function getPendingAssetReward(address _asset, address _borrower) public view override returns (uint256) {
		uint256 snapshotAsset = rewardSnapshots[_borrower][_asset].asset;
		uint256 rewardPerUnitStaked = L_Colls[_asset] - snapshotAsset;
		if (rewardPerUnitStaked == 0 || !isVesselActive(_asset, _borrower)) {
			return 0;
		}
		uint256 stake = Vessels[_borrower][_asset].stake;
		uint256 pendingAssetReward = (stake * rewardPerUnitStaked) / DECIMAL_PRECISION;
		return pendingAssetReward;
	}

	// Get the borrower's pending accumulated debt token reward, earned by their stake
	function getPendingDebtTokenReward(address _asset, address _borrower) public view override returns (uint256) {
		uint256 snapshotDebt = rewardSnapshots[_borrower][_asset].debt;
		uint256 rewardPerUnitStaked = L_Debts[_asset] - snapshotDebt;
		if (rewardPerUnitStaked == 0 || !isVesselActive(_asset, _borrower)) {
			return 0;
		}
		uint256 stake = Vessels[_borrower][_asset].stake;
		return (stake * rewardPerUnitStaked) / DECIMAL_PRECISION;
	}

	function hasPendingRewards(address _asset, address _borrower) public view override returns (bool) {
		if (!isVesselActive(_asset, _borrower)) {
			return false;
		}
		return (rewardSnapshots[_borrower][_asset].asset < L_Colls[_asset]);
	}

	function getEntireDebtAndColl(
		address _asset,
		address _borrower
	) external view override returns (uint256 debt, uint256 coll, uint256 pendingDebtReward, uint256 pendingCollReward) {
		pendingDebtReward = getPendingDebtTokenReward(_asset, _borrower);
		pendingCollReward = getPendingAssetReward(_asset, _borrower);
		Vessel storage vessel = Vessels[_borrower][_asset];
		debt = vessel.debt + pendingDebtReward;
		coll = vessel.coll + pendingCollReward;
	}

	function isVesselActive(address _asset, address _borrower) public view override returns (bool) {
		return getVesselStatus(_asset, _borrower) == uint256(Status.active);
	}

	function getTCR(address _asset, uint256 _price) external view override returns (uint256) {
		return _getTCR(_asset, _price);
	}

	function checkRecoveryMode(address _asset, uint256 _price) external view override returns (bool) {
		return _checkRecoveryMode(_asset, _price);
	}

	function getBorrowingRate(address _asset) external view override returns (uint256) {
		return adminContract.getBorrowingFee(_asset);
	}

	function getBorrowingFee(address _asset, uint256 _debt) external view override returns (uint256) {
		return (adminContract.getBorrowingFee(_asset) * _debt) / DECIMAL_PRECISION;
	}

	function getRedemptionFee(address _asset, uint256 _assetDraw) public view returns (uint256) {
		return _calcRedemptionFee(getRedemptionRate(_asset), _assetDraw);
	}

	function getRedemptionFeeWithDecay(address _asset, uint256 _assetDraw) external view override returns (uint256) {
		return _calcRedemptionFee(getRedemptionRateWithDecay(_asset), _assetDraw);
	}

	function getRedemptionRate(address _asset) public view override returns (uint256) {
		return _calcRedemptionRate(_asset, baseRate[_asset]);
	}

	function getRedemptionRateWithDecay(address _asset) public view override returns (uint256) {
		return _calcRedemptionRate(_asset, _calcDecayedBaseRate(_asset));
	}

	// Called by Gravita contracts ------------------------------------------------------------------------------------

	function addVesselOwnerToArray(
		address _asset,
		address _borrower
	) external override onlyBorrowerOperations returns (uint256 index) {
		address[] storage assetOwners = VesselOwners[_asset];
		assetOwners.push(_borrower);
		index = assetOwners.length - 1;
		Vessels[_borrower][_asset].arrayIndex = uint128(index);
		return index;
	}

	function executeFullRedemption(
		address _asset,
		address _borrower,
		uint256 _newColl
	) external override nonReentrant onlyVesselManagerOperations {
		_removeStake(_asset, _borrower);
		_closeVessel(_asset, _borrower, Status.closedByRedemption);
		_redeemCloseVessel(_asset, _borrower, adminContract.getDebtTokenGasCompensation(_asset), _newColl);
		emit VesselUpdated(_asset, _borrower, 0, 0, 0, VesselManagerOperation.redeemCollateral);
	}

	function executePartialRedemption(
		address _asset,
		address _borrower,
		uint256 _newDebt,
		uint256 _newColl,
		uint256 _newNICR,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint
	) external override onlyVesselManagerOperations {
		sortedVessels.reInsert(_asset, _borrower, _newNICR, _upperPartialRedemptionHint, _lowerPartialRedemptionHint);

		Vessels[_borrower][_asset].debt = _newDebt;
		Vessels[_borrower][_asset].coll = _newColl;
		_updateStakeAndTotalStakes(_asset, _borrower);

		emit VesselUpdated(
			_asset,
			_borrower,
			_newDebt,
			_newColl,
			Vessels[_borrower][_asset].stake,
			VesselManagerOperation.redeemCollateral
		);
	}

	function finalizeRedemption(
		address _asset,
		address _receiver,
		uint256 _debtToRedeem,
		uint256 _assetFeeAmount,
		uint256 _assetRedeemedAmount
	) external override onlyVesselManagerOperations {
		// Send the asset fee to the fee collector
		activePool.sendAsset(_asset, address(feeCollector), _assetFeeAmount);
		feeCollector.handleRedemptionFee(_asset, _assetFeeAmount);
		// Burn the total debt tokens that is cancelled with debt, and send the redeemed asset to msg.sender
		debtToken.burn(_receiver, _debtToRedeem);
		// Update Active Pool, and send asset to account
		uint256 collToSendToRedeemer = _assetRedeemedAmount - _assetFeeAmount;
		activePool.decreaseDebt(_asset, _debtToRedeem);
		activePool.sendAsset(_asset, _receiver, collToSendToRedeemer);
	}

	function updateBaseRateFromRedemption(
		address _asset,
		uint256 _assetDrawn,
		uint256 _price,
		uint256 _totalDebtTokenSupply
	) external override onlyVesselManagerOperations returns (uint256) {
		uint256 decayedBaseRate = _calcDecayedBaseRate(_asset);
		uint256 redeemedDebtFraction = (_assetDrawn * _price) / _totalDebtTokenSupply;
		uint256 newBaseRate = decayedBaseRate + (redeemedDebtFraction / BETA);
		newBaseRate = GravitaMath._min(newBaseRate, DECIMAL_PRECISION);
		assert(newBaseRate != 0);
		baseRate[_asset] = newBaseRate;
		emit BaseRateUpdated(_asset, newBaseRate);
		_updateLastFeeOpTime(_asset);
		return newBaseRate;
	}

	function applyPendingRewards(
		address _asset,
		address _borrower
	) external override nonReentrant onlyVesselManagerOperationsOrBorrowerOperations {
		return _applyPendingRewards(_asset, _borrower);
	}

	// Move a Vessel's pending debt and collateral rewards from distributions, from the Default Pool to the Active Pool
	function movePendingVesselRewardsToActivePool(
		address _asset,
		uint256 _debt,
		uint256 _assetAmount
	) external override onlyVesselManagerOperations {
		_movePendingVesselRewardsToActivePool(_asset, _debt, _assetAmount);
	}

	// Update borrower's snapshots of L_Colls and L_Debts to reflect the current values
	function updateVesselRewardSnapshots(address _asset, address _borrower) external override onlyBorrowerOperations {
		return _updateVesselRewardSnapshots(_asset, _borrower);
	}

	function updateStakeAndTotalStakes(
		address _asset,
		address _borrower
	) external override onlyBorrowerOperations returns (uint256) {
		return _updateStakeAndTotalStakes(_asset, _borrower);
	}

	function removeStake(
		address _asset,
		address _borrower
	) external override onlyVesselManagerOperationsOrBorrowerOperations {
		return _removeStake(_asset, _borrower);
	}

	function redistributeDebtAndColl(
		address _asset,
		uint256 _debt,
		uint256 _coll,
		uint256 _debtToOffset,
		uint256 _collToSendToStabilityPool
	) external override nonReentrant onlyVesselManagerOperations {
		stabilityPool.offset(_debtToOffset, _asset, _collToSendToStabilityPool);

		if (_debt == 0) {
			return;
		}
		/*
		 * Add distributed coll and debt rewards-per-unit-staked to the running totals. Division uses a "feedback"
		 * error correction, to keep the cumulative error low in the running totals L_Colls and L_Debts:
		 *
		 * 1) Form numerators which compensate for the floor division errors that occurred the last time this
		 * function was called.
		 * 2) Calculate "per-unit-staked" ratios.
		 * 3) Multiply each ratio back by its denominator, to reveal the current floor division error.
		 * 4) Store these errors for use in the next correction when this function is called.
		 * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
		 */
		uint256 collNumerator = (_coll * DECIMAL_PRECISION) + lastCollError_Redistribution[_asset];
		uint256 debtNumerator = (_debt * DECIMAL_PRECISION) + lastDebtError_Redistribution[_asset];

		// Get the per-unit-staked terms
		uint256 assetStakes = totalStakes[_asset];
		uint256 collRewardPerUnitStaked = collNumerator / assetStakes;
		uint256 debtRewardPerUnitStaked = debtNumerator / assetStakes;

		lastCollError_Redistribution[_asset] = collNumerator - (collRewardPerUnitStaked * assetStakes);
		lastDebtError_Redistribution[_asset] = debtNumerator - (debtRewardPerUnitStaked * assetStakes);

		// Add per-unit-staked terms to the running totals
		uint256 liquidatedColl = L_Colls[_asset] + collRewardPerUnitStaked;
		uint256 liquidatedDebt = L_Debts[_asset] + debtRewardPerUnitStaked;
		L_Colls[_asset] = liquidatedColl;
		L_Debts[_asset] = liquidatedDebt;
		emit LTermsUpdated(_asset, liquidatedColl, liquidatedDebt);

		activePool.decreaseDebt(_asset, _debt);
		defaultPool.increaseDebt(_asset, _debt);
		activePool.sendAsset(_asset, address(defaultPool), _coll);
	}

	function updateSystemSnapshots_excludeCollRemainder(
		address _asset,
		uint256 _collRemainder
	) external onlyVesselManagerOperations {
		uint256 totalStakesCached = totalStakes[_asset];
		totalStakesSnapshot[_asset] = totalStakesCached;
		uint256 activeColl = activePool.getAssetBalance(_asset);
		uint256 liquidatedColl = defaultPool.getAssetBalance(_asset);
		uint256 _totalCollateralSnapshot = activeColl - _collRemainder + liquidatedColl;
		totalCollateralSnapshot[_asset] = _totalCollateralSnapshot;
		emit SystemSnapshotsUpdated(_asset, totalStakesCached, _totalCollateralSnapshot);
	}

	function closeVessel(
		address _asset,
		address _borrower
	) external override onlyVesselManagerOperationsOrBorrowerOperations {
		return _closeVessel(_asset, _borrower, Status.closedByOwner);
	}

	function closeVesselLiquidation(address _asset, address _borrower) external override onlyVesselManagerOperations {
		_closeVessel(_asset, _borrower, Status.closedByLiquidation);
		feeCollector.liquidateDebt(_borrower, _asset);
		emit VesselUpdated(_asset, _borrower, 0, 0, 0, VesselManagerOperation.liquidateInNormalMode);
	}

	function sendGasCompensation(
		address _asset,
		address _liquidator,
		uint256 _debtTokenAmount,
		uint256 _assetAmount
	) external nonReentrant onlyVesselManagerOperations {
		if (_debtTokenAmount != 0) {
			debtToken.returnFromPool(gasPoolAddress, _liquidator, _debtTokenAmount);
		}
		if (_assetAmount != 0) {
			adminContract.activePool().sendAsset(_asset, _liquidator, _assetAmount);
		}
	}

	// Internal functions ---------------------------------------------------------------------------------------------

	function _redeemCloseVessel(
		address _asset,
		address _borrower,
		uint256 _debtTokenAmount,
		uint256 _assetAmount
	) internal {
		debtToken.burn(gasPoolAddress, _debtTokenAmount);
		// Update Active Pool, and send asset to account
		activePool.decreaseDebt(_asset, _debtTokenAmount);
		// send asset from Active Pool to CollSurplus Pool
		collSurplusPool.accountSurplus(_asset, _borrower, _assetAmount);
		activePool.sendAsset(_asset, address(collSurplusPool), _assetAmount);
	}

	function _movePendingVesselRewardsToActivePool(
		address _asset,
		uint256 _debtTokenAmount,
		uint256 _assetAmount
	) internal {
		defaultPool.decreaseDebt(_asset, _debtTokenAmount);
		activePool.increaseDebt(_asset, _debtTokenAmount);
		defaultPool.sendAssetToActivePool(_asset, _assetAmount);
	}

	function _getCurrentVesselAmounts(
		address _asset,
		address _borrower
	) internal view returns (uint256 coll, uint256 debt) {
		uint256 pendingCollReward = getPendingAssetReward(_asset, _borrower);
		uint256 pendingDebtReward = getPendingDebtTokenReward(_asset, _borrower);
		Vessel memory vessel = Vessels[_borrower][_asset];
		coll = vessel.coll + pendingCollReward;
		debt = vessel.debt + pendingDebtReward;
	}

	// Add the borrowers's coll and debt rewards earned from redistributions, to their Vessel
	function _applyPendingRewards(address _asset, address _borrower) internal {
		if (!hasPendingRewards(_asset, _borrower)) {
			return;
		}

		// Compute pending rewards
		uint256 pendingCollReward = getPendingAssetReward(_asset, _borrower);
		uint256 pendingDebtReward = getPendingDebtTokenReward(_asset, _borrower);

		// Apply pending rewards to vessel's state
		Vessel storage vessel = Vessels[_borrower][_asset];
		vessel.coll = vessel.coll + pendingCollReward;
		vessel.debt = vessel.debt + pendingDebtReward;

		_updateVesselRewardSnapshots(_asset, _borrower);

		// Transfer from DefaultPool to ActivePool
		_movePendingVesselRewardsToActivePool(_asset, pendingDebtReward, pendingCollReward);

		emit VesselUpdated(
			_asset,
			_borrower,
			vessel.debt,
			vessel.coll,
			vessel.stake,
			VesselManagerOperation.applyPendingRewards
		);
	}

	function _updateVesselRewardSnapshots(address _asset, address _borrower) internal {
		uint256 liquidatedColl = L_Colls[_asset];
		uint256 liquidatedDebt = L_Debts[_asset];
		RewardSnapshot storage snapshot = rewardSnapshots[_borrower][_asset];
		snapshot.asset = liquidatedColl;
		snapshot.debt = liquidatedDebt;
		emit VesselSnapshotsUpdated(_asset, liquidatedColl, liquidatedDebt);
	}

	function _removeStake(address _asset, address _borrower) internal {
		Vessel storage vessel = Vessels[_borrower][_asset];
		totalStakes[_asset] -= vessel.stake;
		vessel.stake = 0;
	}

	// Update borrower's stake based on their latest collateral value
	function _updateStakeAndTotalStakes(address _asset, address _borrower) internal returns (uint256) {
		Vessel storage vessel = Vessels[_borrower][_asset];
		uint256 newStake = _computeNewStake(_asset, vessel.coll);
		uint256 oldStake = vessel.stake;
		vessel.stake = newStake;
		uint256 newTotal = totalStakes[_asset] - oldStake + newStake;
		totalStakes[_asset] = newTotal;
		emit TotalStakesUpdated(_asset, newTotal);
		return newStake;
	}

	// Calculate a new stake based on the snapshots of the totalStakes and totalCollateral taken at the last liquidation
	function _computeNewStake(address _asset, uint256 _coll) internal view returns (uint256 stake) {
		uint256 assetColl = totalCollateralSnapshot[_asset];
		if (assetColl == 0) {
			stake = _coll;
		} else {
			uint256 assetStakes = totalStakesSnapshot[_asset];
			/*
			 * The following assert() holds true because:
			 * - The system always contains >= 1 vessel
			 * - When we close or liquidate a vessel, we redistribute the pending rewards, so if all vessels were closed/liquidated,
			 * rewards would’ve been emptied and totalCollateralSnapshot would be zero too.
			 */
			assert(assetStakes != 0);
			stake = (_coll * assetStakes) / assetColl;
		}
	}

	function _closeVessel(address _asset, address _borrower, Status closedStatus) internal {
		assert(closedStatus != Status.nonExistent && closedStatus != Status.active);

		uint256 VesselOwnersArrayLength = VesselOwners[_asset].length;
		if (VesselOwnersArrayLength <= 1 || sortedVessels.getSize(_asset) <= 1) {
			revert VesselManager__OnlyOneVessel();
		}

		Vessel storage vessel = Vessels[_borrower][_asset];
		vessel.status = closedStatus;
		vessel.coll = 0;
		vessel.debt = 0;

		RewardSnapshot storage rewardSnapshot = rewardSnapshots[_borrower][_asset];
		rewardSnapshot.asset = 0;
		rewardSnapshot.debt = 0;

		_removeVesselOwner(_asset, _borrower, VesselOwnersArrayLength);
		sortedVessels.remove(_asset, _borrower);
	}

	function _removeVesselOwner(address _asset, address _borrower, uint256 VesselOwnersArrayLength) internal {
		Vessel memory vessel = Vessels[_borrower][_asset];
		assert(vessel.status != Status.nonExistent && vessel.status != Status.active);

		uint128 index = vessel.arrayIndex;
		uint256 length = VesselOwnersArrayLength;
		uint256 idxLast = length - 1;

		assert(index <= idxLast);

		address[] storage vesselAssetOwners = VesselOwners[_asset];
		address addressToMove = vesselAssetOwners[idxLast];

		vesselAssetOwners[index] = addressToMove;
		Vessels[addressToMove][_asset].arrayIndex = index;
		emit VesselIndexUpdated(_asset, addressToMove, index);

		vesselAssetOwners.pop();
	}

	function _calcRedemptionRate(address _asset, uint256 _baseRate) internal view returns (uint256) {
		return GravitaMath._min(adminContract.getRedemptionFeeFloor(_asset) + _baseRate, DECIMAL_PRECISION);
	}

	function _calcRedemptionFee(uint256 _redemptionRate, uint256 _assetDraw) internal pure returns (uint256) {
		uint256 redemptionFee = (_redemptionRate * _assetDraw) / DECIMAL_PRECISION;
		if (redemptionFee >= _assetDraw) {
			revert VesselManager__FeeBiggerThanAssetDraw();
		}
		return redemptionFee;
	}

	function _updateLastFeeOpTime(address _asset) internal {
		uint256 timePassed = block.timestamp - lastFeeOperationTime[_asset];
		if (timePassed >= SECONDS_IN_ONE_MINUTE) {
			// Update the last fee operation time only if time passed >= decay interval. This prevents base rate griefing.
			lastFeeOperationTime[_asset] = block.timestamp;
			emit LastFeeOpTimeUpdated(_asset, block.timestamp);
		}
	}

	function _calcDecayedBaseRate(address _asset) internal view returns (uint256) {
		uint256 minutesPassed = _minutesPassedSinceLastFeeOp(_asset);
		uint256 decayFactor = GravitaMath._decPow(MINUTE_DECAY_FACTOR, minutesPassed);
		return (baseRate[_asset] * decayFactor) / DECIMAL_PRECISION;
	}

	function _minutesPassedSinceLastFeeOp(address _asset) internal view returns (uint256) {
		return (block.timestamp - lastFeeOperationTime[_asset]) / SECONDS_IN_ONE_MINUTE;
	}

	// --- Vessel property getters --------------------------------------------------------------------------------------

	function getVesselStatus(address _asset, address _borrower) public view override returns (uint256) {
		return uint256(Vessels[_borrower][_asset].status);
	}

	function getVesselStake(address _asset, address _borrower) external view override returns (uint256) {
		return Vessels[_borrower][_asset].stake;
	}

	function getVesselDebt(address _asset, address _borrower) external view override returns (uint256) {
		return Vessels[_borrower][_asset].debt;
	}

	function getVesselColl(address _asset, address _borrower) external view override returns (uint256) {
		return Vessels[_borrower][_asset].coll;
	}

	function getVesselOwnersCount(address _asset) external view override returns (uint256) {
		return VesselOwners[_asset].length;
	}

	function getVesselFromVesselOwnersArray(address _asset, uint256 _index) external view override returns (address) {
		return VesselOwners[_asset][_index];
	}

	// --- Vessel property setters, called by Gravita's BorrowerOperations/VMRedemptions/VMLiquidations ---------------

	function setVesselStatus(address _asset, address _borrower, uint256 _num) external override onlyBorrowerOperations {
		Vessels[_borrower][_asset].status = Status(_num);
	}

	function increaseVesselColl(
		address _asset,
		address _borrower,
		uint256 _collIncrease
	) external override onlyBorrowerOperations returns (uint256 newColl) {
		Vessel storage vessel = Vessels[_borrower][_asset];
		newColl = vessel.coll + _collIncrease;
		vessel.coll = newColl;
	}

	function decreaseVesselColl(
		address _asset,
		address _borrower,
		uint256 _collDecrease
	) external override onlyBorrowerOperations returns (uint256 newColl) {
		Vessel storage vessel = Vessels[_borrower][_asset];
		newColl = vessel.coll - _collDecrease;
		vessel.coll = newColl;
	}

	function increaseVesselDebt(
		address _asset,
		address _borrower,
		uint256 _debtIncrease
	) external override onlyBorrowerOperations returns (uint256 newDebt) {
		Vessel storage vessel = Vessels[_borrower][_asset];
		newDebt = vessel.debt + _debtIncrease;
		vessel.debt = newDebt;
	}

	function decreaseVesselDebt(
		address _asset,
		address _borrower,
		uint256 _debtDecrease
	) external override onlyBorrowerOperations returns (uint256) {
		Vessel storage vessel = Vessels[_borrower][_asset];
		uint256 oldDebt = vessel.debt;
		if (_debtDecrease == 0) {
			return oldDebt; // no changes
		}
		uint256 paybackFraction = (_debtDecrease * 1 ether) / oldDebt;
		uint256 newDebt = oldDebt - _debtDecrease;
		vessel.debt = newDebt;
		if (paybackFraction != 0) {
			feeCollector.decreaseDebt(_borrower, _asset, paybackFraction);
		}
		return newDebt;
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
