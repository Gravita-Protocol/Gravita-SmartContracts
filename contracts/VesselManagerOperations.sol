// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "./Dependencies/GravitaBase.sol";
import "./Interfaces/IActivePool.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IVesselManager.sol";
import "./Interfaces/IVesselManagerOperations.sol";

contract VesselManagerOperations is IVesselManagerOperations, GravitaBase {
	using SafeMathUpgradeable for uint256;

	string public constant NAME = "VesselManagerOperations";
	uint256 public constant REDEMPTION_SOFTENING_PARAM = 970; // 97%

	// Structs ----------------------------------------------------------------------------------------------------------

	struct LiquidationContractsCache {
		IActivePool activePool;
		IDefaultPool defaultPool;
		ISortedVessels sortedVessels;
	}

	struct RedemptionContractsCache {
		IAdminContract adminContract;
		IPriceFeed priceFeed;
		ISortedVessels sortedVessels;
		IVesselManager vesselManager;
	}

	struct HintHelperLocalVars {
		address asset;
		uint256 debtTokenAmount;
		uint256 price;
		uint256 maxIterations;
	}

	// State ------------------------------------------------------------------------------------------------------------

	IVesselManager public vesselManager;
	ISortedVessels public sortedVessels;
	IStabilityPool public stabilityPool;
	ICollSurplusPool public collSurplusPool;
	IDebtToken public debtToken;

	// Modifiers --------------------------------------------------------------------------------------------------------

	modifier onlyVesselManager() {
		if (msg.sender != address(vesselManager)) {
			revert VesselManagerOperations__OnlyVesselManager();
		}
		_;
	}

	// Initializer ------------------------------------------------------------------------------------------------------

	function setAddresses(
		address _vesselManagerAddress,
		address _sortedVesselsAddress,
		address _stabilityPoolAddress,
		address _collSurplusPoolAddress,
		address _debtTokenAddress,
		address _adminContractAddress
	) external initializer {
		__Ownable_init();
		vesselManager = IVesselManager(_vesselManagerAddress);
		sortedVessels = ISortedVessels(_sortedVesselsAddress);
		stabilityPool = IStabilityPool(_stabilityPoolAddress);
		collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
		debtToken = IDebtToken(_debtTokenAddress);
		adminContract = IAdminContract(_adminContractAddress);
	}

	// Liquidation external functions -----------------------------------------------------------------------------------

	/*
	 * Single liquidation function. Closes the vessel if its ICR is lower than the minimum collateral ratio.
	 */
	function liquidate(address _asset, address _borrower) external override {
		if (!vesselManager.isVesselActive(_asset, _borrower)) {
			revert VesselManagerOperations__VesselNotActive();
		}
		address[] memory borrowers = new address[](1);
		borrowers[0] = _borrower;
		batchLiquidateVessels(_asset, borrowers);
	}

	/*
	 * Liquidate a sequence of vessels. Closes a maximum number of n under-collateralized Vessels,
	 * starting from the one with the lowest collateral ratio in the system, and moving upwards.
	 */
	function liquidateVessels(address _asset, uint256 _n) external override {
		LiquidationContractsCache memory contractsCache = LiquidationContractsCache(
			adminContract.activePool(),
			adminContract.defaultPool(),
			sortedVessels
		);
		IStabilityPool stabilityPoolCached = stabilityPool;
		LocalVariables_OuterLiquidationFunction memory vars;
		LiquidationTotals memory totals;
		vars.price = adminContract.priceFeed().fetchPrice(_asset);
		vars.debtTokenInStabPool = stabilityPoolCached.getTotalDebtTokenDeposits();
		vars.recoveryModeAtStart = _checkRecoveryMode(_asset, vars.price);

		// Perform the appropriate liquidation sequence - tally the values, and obtain their totals
		if (vars.recoveryModeAtStart) {
			totals = _getTotalsFromLiquidateVesselsSequence_RecoveryMode(
				_asset,
				contractsCache,
				vars.price,
				vars.debtTokenInStabPool,
				_n
			);
		} else {
			totals = _getTotalsFromLiquidateVesselsSequence_NormalMode(_asset, vars.price, vars.debtTokenInStabPool, _n);
		}

		if (totals.totalDebtInSequence == 0) {
			revert VesselManagerOperations__NothingToLiquidate();
		}

		vesselManager.redistributeDebtAndColl(
			_asset,
			totals.totalDebtToRedistribute,
			totals.totalCollToRedistribute,
			totals.totalDebtToOffset,
			totals.totalCollToSendToSP
		);
		if (totals.totalCollSurplus > 0) {
			contractsCache.activePool.sendAsset(_asset, address(collSurplusPool), totals.totalCollSurplus);
		}

		vesselManager.updateSystemSnapshots_excludeCollRemainder(_asset, totals.totalCollGasCompensation);

		vars.liquidatedDebt = totals.totalDebtInSequence;
		vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(totals.totalCollSurplus);
		emit Liquidation(
			_asset,
			vars.liquidatedDebt,
			vars.liquidatedColl,
			totals.totalCollGasCompensation,
			totals.totalDebtTokenGasCompensation
		);
		vesselManager.sendGasCompensation(
			_asset,
			msg.sender,
			totals.totalDebtTokenGasCompensation,
			totals.totalCollGasCompensation
		);
	}

	/*
	 * Attempt to liquidate a custom list of vessels provided by the caller.
	 */
	function batchLiquidateVessels(address _asset, address[] memory _vesselArray) public override {
		if (_vesselArray.length == 0) {
			revert VesselManagerOperations__CalldataEmptyArray();
		}

		IActivePool activePoolCached = adminContract.activePool();
		IStabilityPool stabilityPoolCached = stabilityPool;
		LocalVariables_OuterLiquidationFunction memory vars;
		LiquidationTotals memory totals;

		vars.debtTokenInStabPool = stabilityPoolCached.getTotalDebtTokenDeposits();
		vars.price = adminContract.priceFeed().fetchPrice(_asset);
		vars.recoveryModeAtStart = _checkRecoveryMode(_asset, vars.price);

		// Perform the appropriate liquidation sequence - tally values and obtain their totals.
		if (vars.recoveryModeAtStart) {
			totals = _getTotalFromBatchLiquidate_RecoveryMode(_asset, vars.price, vars.debtTokenInStabPool, _vesselArray);
		} else {
			totals = _getTotalsFromBatchLiquidate_NormalMode(_asset, vars.price, vars.debtTokenInStabPool, _vesselArray);
		}

		if (totals.totalDebtInSequence == 0) {
			revert VesselManagerOperations__NothingToLiquidate();
		}

		vesselManager.redistributeDebtAndColl(
			_asset,
			totals.totalDebtToRedistribute,
			totals.totalCollToRedistribute,
			totals.totalDebtToOffset,
			totals.totalCollToSendToSP
		);
		if (totals.totalCollSurplus > 0) {
			activePoolCached.sendAsset(_asset, address(collSurplusPool), totals.totalCollSurplus);
		}

		// Update system snapshots
		vesselManager.updateSystemSnapshots_excludeCollRemainder(_asset, totals.totalCollGasCompensation);

		vars.liquidatedDebt = totals.totalDebtInSequence;
		vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(totals.totalCollSurplus);
		emit Liquidation(
			_asset,
			vars.liquidatedDebt,
			vars.liquidatedColl,
			totals.totalCollGasCompensation,
			totals.totalDebtTokenGasCompensation
		);
		vesselManager.sendGasCompensation(
			_asset,
			msg.sender,
			totals.totalDebtTokenGasCompensation,
			totals.totalCollGasCompensation
		);
	}

	// Redemption external functions ------------------------------------------------------------------------------------

	function redeemCollateral(
		address _asset,
		uint256 _debtTokenAmount,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		address _firstRedemptionHint,
		uint256 _partialRedemptionHintNICR,
		uint256 _maxIterations,
		uint256 _maxFeePercentage
	) external override {
		RedemptionTotals memory totals;
		RedemptionContractsCache memory contractsCache = RedemptionContractsCache(
			adminContract,
			adminContract.priceFeed(),
			sortedVessels,
			vesselManager
		);
		totals.price = contractsCache.priceFeed.fetchPrice(_asset);
		_validateRedemptionRequirements(contractsCache, _asset, _maxFeePercentage, _debtTokenAmount, totals.price);
		totals.totalDebtTokenSupplyAtStart = getEntireSystemDebt(_asset);
		totals.remainingDebt = _debtTokenAmount;
		address currentBorrower;
		if (contractsCache.vesselManager.isValidFirstRedemptionHint(_asset, _firstRedemptionHint, totals.price)) {
			currentBorrower = _firstRedemptionHint;
		} else {
			currentBorrower = contractsCache.sortedVessels.getLast(_asset);
			// Find the first vessel with ICR >= MCR
			while (
				currentBorrower != address(0) &&
				contractsCache.vesselManager.getCurrentICR(_asset, currentBorrower, totals.price) <
				contractsCache.adminContract.getMcr(_asset)
			) {
				currentBorrower = contractsCache.sortedVessels.getPrev(_asset, currentBorrower);
			}
		}

		// Loop through the vessels starting from the one with lowest collateral ratio until _debtTokenAmount is exchanged for collateral
		if (_maxIterations == 0) {
			_maxIterations = type(uint256).max;
		}
		while (currentBorrower != address(0) && totals.remainingDebt > 0 && _maxIterations > 0) {
			_maxIterations--;
			// Save the address of the vessel preceding the current one, before potentially modifying the list
			address nextUserToCheck = contractsCache.sortedVessels.getPrev(_asset, currentBorrower);

			contractsCache.vesselManager.applyPendingRewards(_asset, currentBorrower);

			SingleRedemptionValues memory singleRedemption = _redeemCollateralFromVessel(
				_asset,
				currentBorrower,
				totals.remainingDebt,
				totals.price,
				_upperPartialRedemptionHint,
				_lowerPartialRedemptionHint,
				_partialRedemptionHintNICR
			);

			if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last vessel

			totals.totalDebtToRedeem = totals.totalDebtToRedeem.add(singleRedemption.debtLot);
			totals.totalCollDrawn = totals.totalCollDrawn.add(singleRedemption.collLot);

			totals.remainingDebt = totals.remainingDebt.sub(singleRedemption.debtLot);
			currentBorrower = nextUserToCheck;
		}
		if (totals.totalCollDrawn == 0) {
			revert VesselManagerOperations__UnableToRedeemAnyAmount();
		}

		// Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
		// Use the saved total GRAI supply value, from before it was reduced by the redemption.
		contractsCache.vesselManager.updateBaseRateFromRedemption(
			_asset,
			totals.totalCollDrawn,
			totals.price,
			totals.totalDebtTokenSupplyAtStart
		);

		// Calculate the collateral fee
		totals.collFee = contractsCache.vesselManager.getRedemptionFee(_asset, totals.totalCollDrawn);

		_requireUserAcceptsFee(totals.collFee, totals.totalCollDrawn, _maxFeePercentage);

		contractsCache.vesselManager.finalizeRedemption(
			_asset,
			msg.sender,
			totals.totalDebtToRedeem,
			totals.collFee,
			totals.totalCollDrawn
		);

		emit Redemption(_asset, _debtTokenAmount, totals.totalDebtToRedeem, totals.totalCollDrawn, totals.collFee);
	}

	// Hint helper functions --------------------------------------------------------------------------------------------

	/* getRedemptionHints() - Helper function for finding the right hints to pass to redeemCollateral().
	 *
	 * It simulates a redemption of `_debtTokenAmount` to figure out where the redemption sequence will start and what state the final Vessel
	 * of the sequence will end up in.
	 *
	 * Returns three hints:
	 *  - `firstRedemptionHint` is the address of the first Vessel with ICR >= MCR (i.e. the first Vessel that will be redeemed).
	 *  - `partialRedemptionHintNICR` is the final nominal ICR of the last Vessel of the sequence after being hit by partial redemption,
	 *     or zero in case of no partial redemption.
	 *  - `truncatedDebtTokenAmount` is the maximum amount that can be redeemed out of the the provided `_debtTokenAmount`. This can be lower than
	 *    `_debtTokenAmount` when redeeming the full amount would leave the last Vessel of the redemption sequence with less net debt than the
	 *    minimum allowed value (i.e. adminContract.MIN_NET_DEBT()).
	 *
	 * The number of Vessels to consider for redemption can be capped by passing a non-zero value as `_maxIterations`, while passing zero
	 * will leave it uncapped.
	 */

	function getRedemptionHints(
		address _asset,
		uint256 _debtTokenAmount,
		uint256 _price,
		uint256 _maxIterations
	)
		external
		view
		override
		returns (
			address firstRedemptionHint,
			uint256 partialRedemptionHintNewICR,
			uint256 truncatedDebtTokenAmount
		)
	{
		ISortedVessels sortedVesselsCached = sortedVessels;

		HintHelperLocalVars memory vars = HintHelperLocalVars(_asset, _debtTokenAmount, _price, _maxIterations);

		uint256 remainingDebt = _debtTokenAmount;
		address currentVesselBorrower = sortedVesselsCached.getLast(vars.asset);

		while (
			currentVesselBorrower != address(0) &&
			vesselManager.getCurrentICR(vars.asset, currentVesselBorrower, vars.price) < adminContract.getMcr(vars.asset)
		) {
			currentVesselBorrower = sortedVesselsCached.getPrev(vars.asset, currentVesselBorrower);
		}

		firstRedemptionHint = currentVesselBorrower;

		if (vars.maxIterations == 0) {
			vars.maxIterations = type(uint256).max;
		}

		while (currentVesselBorrower != address(0) && remainingDebt > 0 && vars.maxIterations-- > 0) {
			uint256 currentVesselNetDebt = _getNetDebt(vars.asset, vesselManager.getVesselDebt(vars.asset, currentVesselBorrower)).add(
				vesselManager.getPendingDebtTokenReward(vars.asset, currentVesselBorrower)
			);

			if (currentVesselNetDebt <= remainingDebt) {

				remainingDebt = remainingDebt.sub(currentVesselNetDebt);

			} else {

				if (currentVesselNetDebt > adminContract.getMinNetDebt(vars.asset)) {

					uint256 maxRedeemableDebt = GravitaMath._min(
						remainingDebt,
						currentVesselNetDebt.sub(adminContract.getMinNetDebt(vars.asset))
					);

					uint256 currentVesselColl = vesselManager.getVesselColl(vars.asset, currentVesselBorrower).add(
						vesselManager.getPendingAssetReward(vars.asset, currentVesselBorrower)
					);

					uint256 collLot = maxRedeemableDebt * DECIMAL_PRECISION / vars.price;
					// Apply redemption softening
					collLot = collLot * REDEMPTION_SOFTENING_PARAM / 1000;

					uint256 newColl = currentVesselColl - collLot;
					uint256 newDebt = currentVesselNetDebt.sub(maxRedeemableDebt);
					uint256 compositeDebt = _getCompositeDebt(vars.asset, newDebt);

					partialRedemptionHintNewICR = GravitaMath._computeNominalCR(newColl, compositeDebt);
					remainingDebt = remainingDebt.sub(maxRedeemableDebt);
				}

				break;
			}

			currentVesselBorrower = sortedVesselsCached.getPrev(vars.asset, currentVesselBorrower);
		}

		truncatedDebtTokenAmount = _debtTokenAmount.sub(remainingDebt);
	}

	/* getApproxHint() - return address of a Vessel that is, on average, (length / numTrials) positions away in the 
    sortedVessels list from the correct insert position of the Vessel to be inserted. 
    
    Note: The output address is worst-case O(n) positions away from the correct insert position, however, the function 
    is probabilistic. Input can be tuned to guarantee results to a high degree of confidence, e.g:

    Submitting numTrials = k * sqrt(length), with k = 15 makes it very, very likely that the ouput address will 
    be <= sqrt(length) positions away from the correct insert position.
    */
	function getApproxHint(
		address _asset,
		uint256 _CR,
		uint256 _numTrials,
		uint256 _inputRandomSeed
	)
		external
		view
		override
		returns (
			address hintAddress,
			uint256 diff,
			uint256 latestRandomSeed
		)
	{
		uint256 arrayLength = vesselManager.getVesselOwnersCount(_asset);

		if (arrayLength == 0) {
			return (address(0), 0, _inputRandomSeed);
		}

		hintAddress = sortedVessels.getLast(_asset);
		diff = GravitaMath._getAbsoluteDifference(_CR, vesselManager.getNominalICR(_asset, hintAddress));
		latestRandomSeed = _inputRandomSeed;

		uint256 i = 1;

		while (i < _numTrials) {
			latestRandomSeed = uint256(keccak256(abi.encodePacked(latestRandomSeed)));

			uint256 arrayIndex = latestRandomSeed % arrayLength;
			address currentAddress = vesselManager.getVesselFromVesselOwnersArray(_asset, arrayIndex);
			uint256 currentNICR = vesselManager.getNominalICR(_asset, currentAddress);

			// check if abs(current - CR) > abs(closest - CR), and update closest if current is closer
			uint256 currentDiff = GravitaMath._getAbsoluteDifference(currentNICR, _CR);

			if (currentDiff < diff) {
				diff = currentDiff;
				hintAddress = currentAddress;
			}
			i++;
		}
	}

	function computeNominalCR(uint256 _coll, uint256 _debt) external pure override returns (uint256) {
		return GravitaMath._computeNominalCR(_coll, _debt);
	}

	// Liquidation internal/helper functions ----------------------------------------------------------------------------

	/*
	 * This function is used when the batch liquidation sequence starts during Recovery Mode. However, it
	 * handles the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
	 */
	function _getTotalFromBatchLiquidate_RecoveryMode(
		address _asset,
		uint256 _price,
		uint256 _debtTokenInStabPool,
		address[] memory _vesselArray
	) internal returns (LiquidationTotals memory totals) {
		LocalVariables_LiquidationSequence memory vars;
		LiquidationValues memory singleLiquidation;
		vars.remainingDebtTokenInStabPool = _debtTokenInStabPool;
		vars.backToNormalMode = false;
		vars.entireSystemDebt = getEntireSystemDebt(_asset);
		vars.entireSystemColl = getEntireSystemColl(_asset);

		for (vars.i = 0; vars.i < _vesselArray.length; vars.i++) {
			vars.user = _vesselArray[vars.i];
			// Skip non-active vessels
			if (vesselManager.getVesselStatus(_asset, vars.user) != uint256(IVesselManager.Status.active)) {
				continue;
			}
			vars.ICR = vesselManager.getCurrentICR(_asset, vars.user, _price);

			if (!vars.backToNormalMode) {
				// Skip this vessel if ICR is greater than MCR and Stability Pool is empty
				if (vars.ICR >= adminContract.getMcr(_asset) && vars.remainingDebtTokenInStabPool == 0) {
					continue;
				}
				uint256 TCR = GravitaMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, _price);

				singleLiquidation = _liquidateRecoveryMode(
					_asset,
					vars.user,
					vars.ICR,
					vars.remainingDebtTokenInStabPool,
					TCR,
					_price
				);

				// Update aggregate trackers
				vars.remainingDebtTokenInStabPool = vars.remainingDebtTokenInStabPool.sub(singleLiquidation.debtToOffset);
				vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
				vars.entireSystemColl = vars
					.entireSystemColl
					.sub(singleLiquidation.collToSendToSP)
					.sub(singleLiquidation.collGasCompensation)
					.sub(singleLiquidation.collSurplus);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

				vars.backToNormalMode = !_checkPotentialRecoveryMode(
					_asset,
					vars.entireSystemColl,
					vars.entireSystemDebt,
					_price
				);
			} else if (vars.backToNormalMode && vars.ICR < adminContract.getMcr(_asset)) {
				singleLiquidation = _liquidateNormalMode(_asset, vars.user, vars.remainingDebtTokenInStabPool);
				vars.remainingDebtTokenInStabPool = vars.remainingDebtTokenInStabPool.sub(singleLiquidation.debtToOffset);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
			} else continue; // In Normal Mode skip vessels with ICR >= MCR
		}
	}

	function _getTotalsFromBatchLiquidate_NormalMode(
		address _asset,
		uint256 _price,
		uint256 _debtTokenInStabPool,
		address[] memory _vesselArray
	) internal returns (LiquidationTotals memory totals) {
		LocalVariables_LiquidationSequence memory vars;
		LiquidationValues memory singleLiquidation;

		vars.remainingDebtTokenInStabPool = _debtTokenInStabPool;

		for (vars.i = 0; vars.i < _vesselArray.length; vars.i++) {
			vars.user = _vesselArray[vars.i];
			vars.ICR = vesselManager.getCurrentICR(_asset, vars.user, _price);

			if (vars.ICR < adminContract.getMcr(_asset)) {
				singleLiquidation = _liquidateNormalMode(_asset, vars.user, vars.remainingDebtTokenInStabPool);
				vars.remainingDebtTokenInStabPool = vars.remainingDebtTokenInStabPool.sub(singleLiquidation.debtToOffset);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
			}
		}
	}

	function _addLiquidationValuesToTotals(LiquidationTotals memory oldTotals, LiquidationValues memory singleLiquidation)
		internal
		pure
		returns (LiquidationTotals memory newTotals)
	{
		// Tally all the values with their respective running totals
		newTotals.totalCollGasCompensation = oldTotals.totalCollGasCompensation.add(singleLiquidation.collGasCompensation);
		newTotals.totalDebtTokenGasCompensation = oldTotals.totalDebtTokenGasCompensation.add(
			singleLiquidation.debtTokenGasCompensation
		);
		newTotals.totalDebtInSequence = oldTotals.totalDebtInSequence.add(singleLiquidation.entireVesselDebt);
		newTotals.totalCollInSequence = oldTotals.totalCollInSequence.add(singleLiquidation.entireVesselColl);
		newTotals.totalDebtToOffset = oldTotals.totalDebtToOffset.add(singleLiquidation.debtToOffset);
		newTotals.totalCollToSendToSP = oldTotals.totalCollToSendToSP.add(singleLiquidation.collToSendToSP);
		newTotals.totalDebtToRedistribute = oldTotals.totalDebtToRedistribute.add(singleLiquidation.debtToRedistribute);
		newTotals.totalCollToRedistribute = oldTotals.totalCollToRedistribute.add(singleLiquidation.collToRedistribute);
		newTotals.totalCollSurplus = oldTotals.totalCollSurplus.add(singleLiquidation.collSurplus);
		return newTotals;
	}

	function _getTotalsFromLiquidateVesselsSequence_NormalMode(
		address _asset,
		uint256 _price,
		uint256 _debtTokenInStabPool,
		uint256 _n
	) internal returns (LiquidationTotals memory totals) {
		LocalVariables_LiquidationSequence memory vars;
		LiquidationValues memory singleLiquidation;
		ISortedVessels sortedVesselsCached = sortedVessels;

		vars.remainingDebtTokenInStabPool = _debtTokenInStabPool;

		for (vars.i = 0; vars.i < _n; vars.i++) {
			vars.user = sortedVesselsCached.getLast(_asset);
			vars.ICR = vesselManager.getCurrentICR(_asset, vars.user, _price);

			if (vars.ICR < adminContract.getMcr(_asset)) {
				singleLiquidation = _liquidateNormalMode(_asset, vars.user, vars.remainingDebtTokenInStabPool);

				vars.remainingDebtTokenInStabPool = vars.remainingDebtTokenInStabPool.sub(singleLiquidation.debtToOffset);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
			} else break; // break if the loop reaches a Vessel with ICR >= MCR
		}
	}

	function _liquidateNormalMode(
		address _asset,
		address _borrower,
		uint256 _debtTokenInStabPool
	) internal returns (LiquidationValues memory singleLiquidation) {
		IVesselManager vesselManagerCached = vesselManager;
		LocalVariables_InnerSingleLiquidateFunction memory vars;
		(
			singleLiquidation.entireVesselDebt,
			singleLiquidation.entireVesselColl,
			vars.pendingDebtReward,
			vars.pendingCollReward
		) = vesselManagerCached.getEntireDebtAndColl(_asset, _borrower);

		vesselManagerCached.movePendingVesselRewardsToActivePool(_asset, vars.pendingDebtReward, vars.pendingCollReward);
		vesselManagerCached.removeStake(_asset, _borrower);

		singleLiquidation.collGasCompensation = _getCollGasCompensation(_asset, singleLiquidation.entireVesselColl);
		singleLiquidation.debtTokenGasCompensation = adminContract.getDebtTokenGasCompensation(_asset);
		uint256 collToLiquidate = singleLiquidation.entireVesselColl.sub(singleLiquidation.collGasCompensation);

		(
			singleLiquidation.debtToOffset,
			singleLiquidation.collToSendToSP,
			singleLiquidation.debtToRedistribute,
			singleLiquidation.collToRedistribute
		) = _getOffsetAndRedistributionVals(singleLiquidation.entireVesselDebt, collToLiquidate, _debtTokenInStabPool);

		vesselManagerCached.closeVesselLiquidation(_asset, _borrower);
		emit VesselLiquidated(
			_asset,
			_borrower,
			singleLiquidation.entireVesselDebt,
			singleLiquidation.entireVesselColl,
			IVesselManager.VesselManagerOperation.liquidateInNormalMode
		);
		return singleLiquidation;
	}

	function _liquidateRecoveryMode(
		address _asset,
		address _borrower,
		uint256 _ICR,
		uint256 _debtTokenInStabPool,
		uint256 _TCR,
		uint256 _price
	) internal returns (LiquidationValues memory singleLiquidation) {
		LocalVariables_InnerSingleLiquidateFunction memory vars;
		IVesselManager vesselManagerCached = vesselManager;
		IAdminContract adminContractCached = adminContract;
		if (vesselManager.getVesselOwnersCount(_asset) <= 1) {
			return singleLiquidation;
		} // don't liquidate if last vessel
		(
			singleLiquidation.entireVesselDebt,
			singleLiquidation.entireVesselColl,
			vars.pendingDebtReward,
			vars.pendingCollReward
		) = vesselManagerCached.getEntireDebtAndColl(_asset, _borrower);

		singleLiquidation.collGasCompensation = _getCollGasCompensation(_asset, singleLiquidation.entireVesselColl);
		singleLiquidation.debtTokenGasCompensation = adminContractCached.getDebtTokenGasCompensation(_asset);
		vars.collToLiquidate = singleLiquidation.entireVesselColl.sub(singleLiquidation.collGasCompensation);

		// If ICR <= 100%, purely redistribute the Vessel across all active Vessels
		if (_ICR <= adminContract._100pct()) {
			vesselManagerCached.movePendingVesselRewardsToActivePool(_asset, vars.pendingDebtReward, vars.pendingCollReward);
			vesselManagerCached.removeStake(_asset, _borrower);

			singleLiquidation.debtToOffset = 0;
			singleLiquidation.collToSendToSP = 0;
			singleLiquidation.debtToRedistribute = singleLiquidation.entireVesselDebt;
			singleLiquidation.collToRedistribute = vars.collToLiquidate;

			vesselManagerCached.closeVesselLiquidation(_asset, _borrower);
			emit VesselLiquidated(
				_asset,
				_borrower,
				singleLiquidation.entireVesselDebt,
				singleLiquidation.entireVesselColl,
				IVesselManager.VesselManagerOperation.liquidateInRecoveryMode
			);

			// If 100% < ICR < MCR, offset as much as possible, and redistribute the remainder
		} else if ((_ICR > adminContract._100pct()) && (_ICR < adminContractCached.getMcr(_asset))) {
			vesselManagerCached.movePendingVesselRewardsToActivePool(_asset, vars.pendingDebtReward, vars.pendingCollReward);
			vesselManagerCached.removeStake(_asset, _borrower);

			(
				singleLiquidation.debtToOffset,
				singleLiquidation.collToSendToSP,
				singleLiquidation.debtToRedistribute,
				singleLiquidation.collToRedistribute
			) = _getOffsetAndRedistributionVals(
				singleLiquidation.entireVesselDebt,
				vars.collToLiquidate,
				_debtTokenInStabPool
			);

			vesselManagerCached.closeVesselLiquidation(_asset, _borrower);
			emit VesselLiquidated(
				_asset,
				_borrower,
				singleLiquidation.entireVesselDebt,
				singleLiquidation.entireVesselColl,
				IVesselManager.VesselManagerOperation.liquidateInRecoveryMode
			);

			/*
			 * If 110% <= ICR < current TCR (accounting for the preceding liquidations in the current sequence)
			 * and there are debt tokens in the Stability Pool, only offset, with no redistribution,
			 * but at a capped rate of 1.1 and only if the whole debt can be liquidated.
			 * The remainder due to the capped rate will be claimable as collateral surplus.
			 */
		} else if (
			(_ICR >= adminContractCached.getMcr(_asset)) &&
			(_ICR < _TCR) &&
			(singleLiquidation.entireVesselDebt <= _debtTokenInStabPool)
		) {
			vesselManagerCached.movePendingVesselRewardsToActivePool(_asset, vars.pendingDebtReward, vars.pendingCollReward);
			assert(_debtTokenInStabPool != 0);

			vesselManagerCached.removeStake(_asset, _borrower);
			singleLiquidation = _getCappedOffsetVals(
				_asset,
				singleLiquidation.entireVesselDebt,
				singleLiquidation.entireVesselColl,
				_price
			);

			vesselManagerCached.closeVesselLiquidation(_asset, _borrower);
			if (singleLiquidation.collSurplus > 0) {
				collSurplusPool.accountSurplus(_asset, _borrower, singleLiquidation.collSurplus);
			}
			emit VesselLiquidated(
				_asset,
				_borrower,
				singleLiquidation.entireVesselDebt,
				singleLiquidation.collToSendToSP,
				IVesselManager.VesselManagerOperation.liquidateInRecoveryMode
			);
		} else {
			// if (_ICR >= MCR && ( _ICR >= _TCR || singleLiquidation.entireVesselDebt > _debtTokenInStabPool))
			LiquidationValues memory zeroVals;
			return zeroVals;
		}

		return singleLiquidation;
	}

	/*
	 * This function is used when the liquidateVessels sequence starts during Recovery Mode. However, it
	 * handles the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
	 */
	function _getTotalsFromLiquidateVesselsSequence_RecoveryMode(
		address _asset,
		LiquidationContractsCache memory _contractsCache,
		uint256 _price,
		uint256 _debtTokenInStabPool,
		uint256 _n
	) internal returns (LiquidationTotals memory totals) {
		LocalVariables_AssetBorrowerPrice memory assetVars = LocalVariables_AssetBorrowerPrice(_asset, address(0), _price);

		LocalVariables_LiquidationSequence memory vars;
		LiquidationValues memory singleLiquidation;

		vars.remainingDebtTokenInStabPool = _debtTokenInStabPool;
		vars.backToNormalMode = false;
		vars.entireSystemDebt = getEntireSystemDebt(assetVars._asset);
		vars.entireSystemColl = getEntireSystemColl(assetVars._asset);

		vars.user = _contractsCache.sortedVessels.getLast(assetVars._asset);
		address firstUser = _contractsCache.sortedVessels.getFirst(assetVars._asset);
		for (vars.i = 0; vars.i < _n && vars.user != firstUser; vars.i++) {
			// we need to cache it, because current user is likely going to be deleted
			address nextUser = _contractsCache.sortedVessels.getPrev(assetVars._asset, vars.user);

			vars.ICR = vesselManager.getCurrentICR(assetVars._asset, vars.user, assetVars._price);

			if (!vars.backToNormalMode) {
				// Break the loop if ICR is greater than MCR and Stability Pool is empty
				if (vars.ICR >= adminContract.getMcr(_asset) && vars.remainingDebtTokenInStabPool == 0) {
					break;
				}

				uint256 TCR = GravitaMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, assetVars._price);

				singleLiquidation = _liquidateRecoveryMode(
					assetVars._asset,
					vars.user,
					vars.ICR,
					vars.remainingDebtTokenInStabPool,
					TCR,
					assetVars._price
				);

				// Update aggregate trackers
				vars.remainingDebtTokenInStabPool = vars.remainingDebtTokenInStabPool.sub(singleLiquidation.debtToOffset);
				vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
				vars.entireSystemColl = vars
					.entireSystemColl
					.sub(singleLiquidation.collToSendToSP)
					.sub(singleLiquidation.collGasCompensation)
					.sub(singleLiquidation.collSurplus);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

				vars.backToNormalMode = !_checkPotentialRecoveryMode(
					_asset,
					vars.entireSystemColl,
					vars.entireSystemDebt,
					assetVars._price
				);
			} else if (vars.backToNormalMode && vars.ICR < adminContract.getMcr(_asset)) {
				singleLiquidation = _liquidateNormalMode(assetVars._asset, vars.user, vars.remainingDebtTokenInStabPool);

				vars.remainingDebtTokenInStabPool = vars.remainingDebtTokenInStabPool.sub(singleLiquidation.debtToOffset);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
			} else break; // break if the loop reaches a Vessel with ICR >= MCR

			vars.user = nextUser;
		}
	}

	/* In a full liquidation, returns the values for a vessel's coll and debt to be offset, and coll and debt to be
	 * redistributed to active vessels.
	 */
	function _getOffsetAndRedistributionVals(
		uint256 _debt,
		uint256 _coll,
		uint256 _debtTokenInStabPool
	)
		internal
		pure
		returns (
			uint256 debtToOffset,
			uint256 collToSendToSP,
			uint256 debtToRedistribute,
			uint256 collToRedistribute
		)
	{
		if (_debtTokenInStabPool > 0) {
			/*
			 * Offset as much debt & collateral as possible against the Stability Pool, and redistribute the remainder
			 * between all active vessels.
			 *
			 *  If the vessel's debt is larger than the deposited debt token in the Stability Pool:
			 *
			 *  - Offset an amount of the vessel's debt equal to the debt token in the Stability Pool
			 *  - Send a fraction of the vessel's collateral to the Stability Pool, equal to the fraction of its offset debt
			 *
			 */
			debtToOffset = GravitaMath._min(_debt, _debtTokenInStabPool);
			collToSendToSP = _coll.mul(debtToOffset).div(_debt);
			debtToRedistribute = _debt.sub(debtToOffset);
			collToRedistribute = _coll.sub(collToSendToSP);
		} else {
			debtToOffset = 0;
			collToSendToSP = 0;
			debtToRedistribute = _debt;
			collToRedistribute = _coll;
		}
	}

	/*
	 *  Get its offset coll/debt and coll gas comp, and close the vessel.
	 */
	function _getCappedOffsetVals(
		address _asset,
		uint256 _entireVesselDebt,
		uint256 _entireVesselColl,
		uint256 _price
	) internal view returns (LiquidationValues memory singleLiquidation) {
		singleLiquidation.entireVesselDebt = _entireVesselDebt;
		singleLiquidation.entireVesselColl = _entireVesselColl;
		uint256 cappedCollPortion = _entireVesselDebt.mul(adminContract.getMcr(_asset)).div(_price);

		singleLiquidation.collGasCompensation = _getCollGasCompensation(_asset, cappedCollPortion);
		singleLiquidation.debtTokenGasCompensation = adminContract.getDebtTokenGasCompensation(_asset);

		singleLiquidation.debtToOffset = _entireVesselDebt;
		singleLiquidation.collToSendToSP = cappedCollPortion.sub(singleLiquidation.collGasCompensation);
		singleLiquidation.collSurplus = _entireVesselColl.sub(cappedCollPortion);
		singleLiquidation.debtToRedistribute = 0;
		singleLiquidation.collToRedistribute = 0;
	}

	function _checkPotentialRecoveryMode(
		address _asset,
		uint256 _entireSystemColl,
		uint256 _entireSystemDebt,
		uint256 _price
	) internal view returns (bool) {
		uint256 TCR = GravitaMath._computeCR(_entireSystemColl, _entireSystemDebt, _price);
		return TCR < adminContract.getCcr(_asset);
	}

	// Redemption internal/helper functions -----------------------------------------------------------------------------

	function _validateRedemptionRequirements(
		RedemptionContractsCache memory contractsCache,
		address _asset,
		uint256 _maxFeePercentage,
		uint256 _debtTokenAmount,
		uint256 _price
	) internal view {
		uint256 redemptionBlock = contractsCache.adminContract.getRedemptionBlock(_asset);
		if (redemptionBlock > block.timestamp) {
			revert VesselManagerOperations__RedemptionIsBlocked();
		}
		uint256 redemptionFeeFloor = contractsCache.adminContract.getRedemptionFeeFloor(_asset);
		if (_maxFeePercentage < redemptionFeeFloor || _maxFeePercentage > DECIMAL_PRECISION) {
			revert VesselManagerOperations__FeePercentOutOfBounds(redemptionFeeFloor, DECIMAL_PRECISION);
		}
		if (_debtTokenAmount == 0) {
			revert VesselManagerOperations__EmptyAmount();
		}
		uint256 redeemerBalance = debtToken.balanceOf(msg.sender);
		if (redeemerBalance < _debtTokenAmount) {
			revert VesselManagerOperations__InsufficientDebtTokenBalance(redeemerBalance);
		}
		uint256 tcr = _getTCR(_asset, _price);
		uint256 mcr = contractsCache.adminContract.getMcr(_asset);
		if (tcr < mcr) {
			revert VesselManagerOperations__TCRMustBeAboveMCR(tcr, mcr);
		}
	}

	// Redeem as much collateral as possible from _borrower's vessel in exchange for GRAI up to _maxDebtTokenAmount
	function _redeemCollateralFromVessel(
		address _asset,
		address _borrower,
		uint256 _maxDebtTokenAmount,
		uint256 _price,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR
	) internal returns (SingleRedemptionValues memory singleRedemption) {

		uint256 vesselDebt = vesselManager.getVesselDebt(_asset, _borrower);
		uint256 vesselColl = vesselManager.getVesselColl(_asset, _borrower);

		// Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the vessel minus the liquidation reserve
		singleRedemption.debtLot = GravitaMath._min(_maxDebtTokenAmount, vesselDebt - adminContract.getDebtTokenGasCompensation(_asset));

		// Get the debtToken lot of equivalent value in USD
		singleRedemption.collLot = singleRedemption.debtLot * DECIMAL_PRECISION / _price;
		// Apply redemption softening
		singleRedemption.collLot = singleRedemption.collLot * REDEMPTION_SOFTENING_PARAM / 1000;

		// Decrease the debt and collateral of the current vessel according to the debt token lot and corresponding coll to send

		uint256 newDebt = (vesselDebt).sub(singleRedemption.debtLot);
		uint256 newColl = (vesselColl).sub(singleRedemption.collLot);

		if (newDebt == adminContract.getDebtTokenGasCompensation(_asset)) {

			vesselManager.executeFullRedemption(_asset, _borrower, newColl);

		} else {

			uint256 newNICR = GravitaMath._computeNominalCR(newColl, newDebt);

			/*
			 * If the provided hint is out of date, we bail since trying to reinsert without a good hint will almost
			 * certainly result in running out of gas.
			 *
			 * If the resultant net debt of the partial is less than the minimum, net debt we bail.
			 */
			if (newNICR != _partialRedemptionHintNICR || _getNetDebt(_asset, newDebt) < adminContract.getMinNetDebt(_asset)) {
				singleRedemption.cancelledPartial = true;
				return singleRedemption;
			}

			vesselManager.executePartialRedemption(
				_asset,
				_borrower,
				newDebt,
				newColl,
				newNICR,
				_upperPartialRedemptionHint,
				_lowerPartialRedemptionHint
			);
		}

		return singleRedemption;
	}
}
