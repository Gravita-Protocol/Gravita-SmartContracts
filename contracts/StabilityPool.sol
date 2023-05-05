// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./Dependencies/GravitaBase.sol";
import "./Dependencies/SafetyTransfer.sol";

import "./Interfaces/IAdminContract.sol";
import "./Interfaces/IBorrowerOperations.sol";
import "./Interfaces/ICommunityIssuance.sol";
import "./Interfaces/IDebtToken.sol";
import "./Interfaces/ISortedVessels.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/IVesselManager.sol";

/**
 * @title The Stability Pool holds debt tokens deposited by Stability Pool depositors.
 * @dev When a vessel is liquidated, then depending on system conditions, some of its debt tokens debt gets offset with
 * debt tokens in the Stability Pool: that is, the offset debt evaporates, and an equal amount of debt tokens tokens in the Stability Pool is burned.
 *
 * Thus, a liquidation causes each depositor to receive a debt tokens loss, in proportion to their deposit as a share of total deposits.
 * They also receive an Collateral gain, as the amount of collateral of the liquidated vessel is distributed among Stability depositors,
 * in the same proportion.
 *
 * When a liquidation occurs, it depletes every deposit by the same fraction: for example, a liquidation that depletes 40%
 * of the total debt tokens in the Stability Pool, depletes 40% of each deposit.
 *
 * A deposit that has experienced a series of liquidations is termed a "compounded deposit": each liquidation depletes the deposit,
 * multiplying it by some factor in range ]0,1[
 *
 *
 * --- IMPLEMENTATION ---
 *
 * We use a highly scalable method of tracking deposits and Collateral gains that has O(1) complexity.
 *
 * When a liquidation occurs, rather than updating each depositor's deposit and Collateral gain, we simply update two state variables:
 * a product P, and a sum S. These are kept track for each type of collateral.
 *
 * A mathematical manipulation allows us to factor out the initial deposit, and accurately track all depositors' compounded deposits
 * and accumulated Collateral amount gains over time, as liquidations occur, using just these two variables P and S. When depositors join the
 * Stability Pool, they get a snapshot of the latest P and S: P_t and S_t, respectively.
 *
 * The formula for a depositor's accumulated Collateral amount gain is derived here:
 * https://github.com/liquity/dev/blob/main/papers/Scalable_Reward_Distribution_with_Compounding_Stakes.pdf
 *
 * For a given deposit d_t, the ratio P/P_t tells us the factor by which a deposit has decreased since it joined the Stability Pool,
 * and the term d_t * (S - S_t)/P_t gives us the deposit's total accumulated Collateral amount gain.
 *
 * Each liquidation updates the product P and sum S. After a series of liquidations, a compounded deposit and corresponding Collateral amount gain
 * can be calculated using the initial deposit, the depositor’s snapshots of P and S, and the latest values of P and S.
 *
 * Any time a depositor updates their deposit (withdrawal, top-up) their accumulated Collateral amount gain is paid out, their new deposit is recorded
 * (based on their latest compounded deposit and modified by the withdrawal/top-up), and they receive new snapshots of the latest P and S.
 * Essentially, they make a fresh deposit that overwrites the old one.
 *
 *
 * --- SCALE FACTOR ---
 *
 * Since P is a running product in range ]0,1] that is always-decreasing, it should never reach 0 when multiplied by a number in range ]0,1[.
 * Unfortunately, Solidity floor division always reaches 0, sooner or later.
 *
 * A series of liquidations that nearly empty the Pool (and thus each multiply P by a very small number in range ]0,1[ ) may push P
 * to its 18 digit decimal limit, and round it to 0, when in fact the Pool hasn't been emptied: this would break deposit tracking.
 *
 * So, to track P accurately, we use a scale factor: if a liquidation would cause P to decrease to <1e-9 (and be rounded to 0 by Solidity),
 * we first multiply P by 1e9, and increment a currentScale factor by 1.
 *
 * The added benefit of using 1e9 for the scale factor (rather than 1e18) is that it ensures negligible precision loss close to the
 * scale boundary: when P is at its minimum value of 1e9, the relative precision loss in P due to floor division is only on the
 * order of 1e-9.
 *
 * --- EPOCHS ---
 *
 * Whenever a liquidation fully empties the Stability Pool, all deposits should become 0. However, setting P to 0 would make P be 0
 * forever, and break all future reward calculations.
 *
 * So, every time the Stability Pool is emptied by a liquidation, we reset P = 1 and currentScale = 0, and increment the currentEpoch by 1.
 *
 * --- TRACKING DEPOSIT OVER SCALE CHANGES AND EPOCHS ---
 *
 * When a deposit is made, it gets snapshots of the currentEpoch and the currentScale.
 *
 * When calculating a compounded deposit, we compare the current epoch to the deposit's epoch snapshot. If the current epoch is newer,
 * then the deposit was present during a pool-emptying liquidation, and necessarily has been depleted to 0.
 *
 * Otherwise, we then compare the current scale to the deposit's scale snapshot. If they're equal, the compounded deposit is given by d_t * P/P_t.
 * If it spans one scale change, it is given by d_t * P/(P_t * 1e9). If it spans more than one scale change, we define the compounded deposit
 * as 0, since it is now less than 1e-9'th of its initial value (e.g. a deposit of 1 billion debt tokens has depleted to < 1 debt token).
 *
 *
 *  --- TRACKING DEPOSITOR'S COLLATERAL AMOUNT GAIN OVER SCALE CHANGES AND EPOCHS ---
 *
 * In the current epoch, the latest value of S is stored upon each scale change, and the mapping (scale -> S) is stored for each epoch.
 *
 * This allows us to calculate a deposit's accumulated Collateral amount gain, during the epoch in which the deposit was non-zero and earned Collateral amount.
 *
 * We calculate the depositor's accumulated Collateral amount gain for the scale at which they made the deposit, using the Collateral amount gain formula:
 * e_1 = d_t * (S - S_t) / P_t
 *
 * and also for scale after, taking care to divide the latter by a factor of 1e9:
 * e_2 = d_t * S / (P_t * 1e9)
 *
 * The gain in the second scale will be full, as the starting point was in the previous scale, thus no need to subtract anything.
 * The deposit therefore was present for reward events from the beginning of that second scale.
 *
 *        S_i-S_t + S_{i+1}
 *      .<--------.------------>
 *      .         .
 *      . S_i     .   S_{i+1}
 *   <--.-------->.<----------->
 *   S_t.         .
 *   <->.         .
 *      t         .
 *  |---+---------|-------------|-----...
 *         i            i+1
 *
 * The sum of (e_1 + e_2) captures the depositor's total accumulated Collateral amount gain, handling the case where their
 * deposit spanned one scale change. We only care about gains across one scale change, since the compounded
 * deposit is defined as being 0 once it has spanned more than one scale change.
 *
 *
 * --- UPDATING P WHEN A LIQUIDATION OCCURS ---
 *
 * Please see the implementation spec in the proof document, which closely follows on from the compounded deposit / Collateral amount gain derivations:
 * https://github.com/liquity/liquity/blob/master/papers/Scalable_Reward_Distribution_with_Compounding_Stakes.pdf
 *
 *
 * --- Gravita ISSUANCE TO STABILITY POOL DEPOSITORS ---
 *
 * An Gravita issuance event occurs at every deposit operation, and every liquidation.
 *
 * All deposits earn a share of the issued Gravita in proportion to the deposit as a share of total deposits.
 *
 * Please see the system Readme for an overview:
 * https://github.com/liquity/dev/blob/main/README.md#lqty-issuance-to-stability-providers
 *
 * We use the same mathematical product-sum approach to track Gravita gains for depositors, where 'G' is the sum corresponding to Gravita gains.
 * The product P (and snapshot P_t) is re-used, as the ratio P/P_t tracks a deposit's depletion due to liquidations.
 *
 */
contract StabilityPool is ReentrancyGuardUpgradeable, GravitaBase, IStabilityPool {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "StabilityPool";

	IBorrowerOperations public borrowerOperations;
	IVesselManager public vesselManager;
	IDebtToken public debtToken;
	ISortedVessels public sortedVessels;
	ICommunityIssuance public communityIssuance;

	// Tracker for debtToken held in the pool. Changes when users deposit/withdraw, and when Vessel debt is offset.
	uint256 internal totalDebtTokenDeposits;

	// totalColl.tokens and totalColl.amounts should be the same length and
	// always be the same length as adminContract.validCollaterals().
	// Anytime a new collateral is added to AdminContract, both lists are lengthened
	Colls internal totalColl;

	// --- Data structures ---

	struct Snapshots {
		mapping(address => uint256) S;
		uint256 P;
		uint256 G;
		uint128 scale;
		uint128 epoch;
	}

	mapping(address => uint256) public deposits; // depositor address -> deposit amount

	/*
	 * depositSnapshots maintains an entry for each depositor
	 * that tracks P, S, G, scale, and epoch.
	 * depositor's snapshot is updated only when they
	 * deposit or withdraw from stability pool
	 * depositSnapshots are used to allocate GRVT rewards, calculate compoundedDepositAmount
	 * and to calculate how much Collateral amount the depositor is entitled to
	 */
	mapping(address => Snapshots) public depositSnapshots; // depositor address -> snapshots struct

	/*  Product 'P': Running product by which to multiply an initial deposit, in order to find the current compounded deposit,
	 * after a series of liquidations have occurred, each of which cancel some debt tokens debt with the deposit.
	 *
	 * During its lifetime, a deposit's value evolves from d_t to d_t * P / P_t , where P_t
	 * is the snapshot of P taken at the instant the deposit was made. 18-digit decimal.
	 */
	uint256 public P;

	uint256 public constant SCALE_FACTOR = 1e9;

	// Each time the scale of P shifts by SCALE_FACTOR, the scale is incremented by 1
	uint128 public currentScale;

	// With each offset that fully empties the Pool, the epoch is incremented by 1
	uint128 public currentEpoch;

	/* Collateral amount Gain sum 'S': During its lifetime, each deposit d_t earns an Collateral amount gain of ( d_t * [S - S_t] )/P_t,
	 * where S_t is the depositor's snapshot of S taken at the time t when the deposit was made.
	 *
	 * The 'S' sums are stored in a nested mapping (epoch => scale => sum):
	 *
	 * - The inner mapping records the (scale => sum)
	 * - The middle mapping records (epoch => (scale => sum))
	 * - The outer mapping records (collateralType => (epoch => (scale => sum)))
	 */
	mapping(address => mapping(uint128 => mapping(uint128 => uint256))) public epochToScaleToSum;

	/*
	 * Similarly, the sum 'G' is used to calculate GRVT gains. During it's lifetime, each deposit d_t earns a GRVT gain of
	 *  ( d_t * [G - G_t] )/P_t, where G_t is the depositor's snapshot of G taken at time t when  the deposit was made.
	 *
	 *  GRVT reward events occur are triggered by depositor operations (new deposit, topup, withdrawal), and liquidations.
	 *  In each case, the GRVT reward is issued (i.e. G is updated), before other state changes are made.
	 */
	mapping(uint128 => mapping(uint128 => uint256)) public epochToScaleToG;

	// Error tracker for the error correction in the GRVT issuance calculation
	uint256 public lastGRVTError;
	// Error trackers for the error correction in the offset calculation
	uint256[] public lastAssetError_Offset;
	uint256 public lastDebtTokenLossError_Offset;

	// --- Contract setters ---

	function setAddresses(
		address _borrowerOperationsAddress,
		address _vesselManagerAddress,
		address _activePoolAddress,
		address _debtTokenAddress,
		address _sortedVesselsAddress,
		address _communityIssuanceAddress,
		address _adminContractAddress
	) external payable initializer {
		__ReentrancyGuard_init();

		borrowerOperations = IBorrowerOperations(_borrowerOperationsAddress);
		vesselManager = IVesselManager(_vesselManagerAddress);
		activePool = IActivePool(_activePoolAddress);
		debtToken = IDebtToken(_debtTokenAddress);
		sortedVessels = ISortedVessels(_sortedVesselsAddress);
		communityIssuance = ICommunityIssuance(_communityIssuanceAddress);
		adminContract = IAdminContract(_adminContractAddress);

		P = DECIMAL_PRECISION;
	}

	// --- Getters for public variables. Required by IPool interface ---

	/**
	 * @notice get collateral balance in the SP for a given collateral type
	 * @dev Not necessarily this contract's actual collateral balance;
	 * just what is stored in state
	 * @param _collateral address of the collateral to get amount of
	 * @return amount of this specific collateral
	 */
	function getCollateral(address _collateral) external view returns (uint256) {
		uint256 collateralIndex = adminContract.getIndex(_collateral);
		return totalColl.amounts[collateralIndex];
	}

	/**
	 * @notice getter function
	 * @dev gets collateral from totalColl
	 * This is not necessarily the contract's actual collateral balance;
	 * just what is stored in state
	 * @return tokens and amounts
	 */
	function getAllCollateral() external view returns (address[] memory, uint256[] memory) {
		return (totalColl.tokens, totalColl.amounts);
	}

	/**
	 * @notice getter function
	 * @dev gets total debtToken from deposits
	 * @return totalDebtTokenDeposits
	 */
	function getTotalDebtTokenDeposits() external view override returns (uint256) {
		return totalDebtTokenDeposits;
	}

	// --- External Depositor Functions ---

	/**
	 * @notice Used to provide debt tokens to the stability Pool
	 * @dev Triggers a GRVT issuance, based on time passed since the last issuance.
	 * The GRVT issuance is shared between *all* depositors
	 * - Sends depositor's accumulated gains (GRVT, collateral assets) to depositor
	 * - Increases deposit stake, and takes new snapshots for each.
	 * @param _amount amount of asset provided
	 */
	function provideToSP(uint256 _amount) external override nonReentrant {
		_requireNonZeroAmount(_amount);

		uint256 initialDeposit = deposits[msg.sender];

		ICommunityIssuance communityIssuanceCached = communityIssuance;

		_triggerGRVTIssuance(communityIssuanceCached);

		(address[] memory gainAssets, uint256[] memory gainAmounts) = getDepositorGains(msg.sender);
		uint256 compoundedDeposit = getCompoundedDebtTokenDeposits(msg.sender);
		uint256 loss = initialDeposit - compoundedDeposit; // Needed only for event log

		// First pay out any GRVT gains
		_payOutGRVTGains(communityIssuanceCached, msg.sender);

		// just pulls debtTokens into the pool, updates totalDeposits variable for the stability pool and throws an event
		_sendToStabilityPool(msg.sender, _amount);

		uint256 newDeposit = compoundedDeposit + _amount;
		_updateDepositAndSnapshots(msg.sender, newDeposit);
		emit UserDepositChanged(msg.sender, newDeposit);

		emit GainsWithdrawn(msg.sender, gainAssets, gainAmounts, loss); // loss required for event log

		// send any collateral gains accrued to the depositor
		_sendGainsToDepositor(msg.sender, gainAssets, gainAmounts);
	}

	function withdrawFromSP(uint256 _amount) external {
		(address[] memory assets, uint256[] memory amounts) = _withdrawFromSP(_amount);
		_sendGainsToDepositor(msg.sender, assets, amounts);
	}

	/**
	 * @notice withdraw from the stability pool
	 * @dev see withdrawFromSPAndSwap
	 * @param _amount debtToken amount to withdraw
	 * @return assets , amounts address of assets withdrawn, amount of asset withdrawn
	 */
	function _withdrawFromSP(uint256 _amount) internal returns (address[] memory assets, uint256[] memory amounts) {
		if (_amount != 0) {
			_requireNoUnderCollateralizedVessels();
		}
		uint256 initialDeposit = deposits[msg.sender];
		_requireUserHasDeposit(initialDeposit);

		ICommunityIssuance communityIssuanceCached = communityIssuance;
		_triggerGRVTIssuance(communityIssuanceCached);

		(assets, amounts) = getDepositorGains(msg.sender);

		uint256 compoundedDeposit = getCompoundedDebtTokenDeposits(msg.sender);

		uint256 debtTokensToWithdraw = GravitaMath._min(_amount, compoundedDeposit);
		uint256 loss = initialDeposit - compoundedDeposit; // Needed only for event log

		// First pay out any GRVT gains
		_payOutGRVTGains(communityIssuanceCached, msg.sender);
		_sendToDepositor(msg.sender, debtTokensToWithdraw);

		// Update deposit
		uint256 newDeposit = compoundedDeposit - debtTokensToWithdraw;
		_updateDepositAndSnapshots(msg.sender, newDeposit);
		emit UserDepositChanged(msg.sender, newDeposit);

		emit GainsWithdrawn(msg.sender, assets, amounts, loss); // loss required for event log
	}

	// --- GRVT issuance functions ---

	function _triggerGRVTIssuance(ICommunityIssuance _communityIssuance) internal {
		if (address(_communityIssuance) != address(0)) {
			uint256 GRVTIssuance = _communityIssuance.issueGRVT();
			_updateG(GRVTIssuance);
		}
	}

	function _updateG(uint256 _GRVTIssuance) internal {
		uint256 cachedTotalDebtTokenDeposits = totalDebtTokenDeposits; // cached to save an SLOAD
		/*
		 * When total deposits is 0, G is not updated. In this case, the GRVT issued can not be obtained by later
		 * depositors - it is missed out on, and remains in the balanceof the CommunityIssuance contract.
		 *
		 */
		if (cachedTotalDebtTokenDeposits == 0 || _GRVTIssuance == 0) {
			return;
		}
		uint256 GRVTPerUnitStaked = _computeGRVTPerUnitStaked(_GRVTIssuance, cachedTotalDebtTokenDeposits);
		uint256 marginalGRVTGain = GRVTPerUnitStaked * P;
		uint256 newEpochToScaleToG = epochToScaleToG[currentEpoch][currentScale];
		newEpochToScaleToG += marginalGRVTGain;
		epochToScaleToG[currentEpoch][currentScale] = newEpochToScaleToG;
		emit G_Updated(newEpochToScaleToG, currentEpoch, currentScale);
	}

	function _computeGRVTPerUnitStaked(uint256 _GRVTIssuance, uint256 _totalDeposits) internal returns (uint256) {
		/*
		 * Calculate the GRVT-per-unit staked.  Division uses a "feedback" error correction, to keep the
		 * cumulative error low in the running total G:
		 *
		 * 1) Form a numerator which compensates for the floor division error that occurred the last time this
		 * function was called.
		 * 2) Calculate "per-unit-staked" ratio.
		 * 3) Multiply the ratio back by its denominator, to reveal the current floor division error.
		 * 4) Store this error for use in the next correction when this function is called.
		 * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
		 */
		uint256 GRVTNumerator = (_GRVTIssuance * DECIMAL_PRECISION) + lastGRVTError;
		uint256 GRVTPerUnitStaked = GRVTNumerator / _totalDeposits;
		lastGRVTError = GRVTNumerator - (GRVTPerUnitStaked * _totalDeposits);
		return GRVTPerUnitStaked;
	}

	// --- Liquidation functions ---

	/**
	 * @notice sets the offset for liquidation
	 * @dev Cancels out the specified debt against the debtTokens contained in the Stability Pool (as far as possible)
	 * and transfers the Vessel's collateral from ActivePool to StabilityPool.
	 * Only called by liquidation functions in the VesselManager.
	 * @param _debtToOffset how much debt to offset
	 * @param _asset token address
	 * @param _amountAdded token amount as uint256
	 */
	function offset(
		uint256 _debtToOffset,
		address _asset,
		uint256 _amountAdded
	) external {
		_requireCallerIsVesselManager();
		uint256 cachedTotalDebtTokenDeposits = totalDebtTokenDeposits; // cached to save an SLOAD
		if (cachedTotalDebtTokenDeposits == 0 || _debtToOffset == 0) {
			return;
		}
		_triggerGRVTIssuance(communityIssuance);
		(uint256 collGainPerUnitStaked, uint256 debtLossPerUnitStaked) = _computeRewardsPerUnitStaked(
			_asset,
			_amountAdded,
			_debtToOffset,
			cachedTotalDebtTokenDeposits
		);

		_updateRewardSumAndProduct(_asset, collGainPerUnitStaked, debtLossPerUnitStaked); // updates S and P
		_moveOffsetCollAndDebt(_asset, _amountAdded, _debtToOffset);
	}

	// --- Offset helper functions ---

	/**
	 * @notice Compute the debtToken and Collateral amount rewards. Uses a "feedback" error correction, to keep
	 * the cumulative error in the P and S state variables low:
	 *
	 * @dev 1) Form numerators which compensate for the floor division errors that occurred the last time this
	 * function was called.
	 * 2) Calculate "per-unit-staked" ratios.
	 * 3) Multiply each ratio back by its denominator, to reveal the current floor division error.
	 * 4) Store these errors for use in the next correction when this function is called.
	 * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
	 * @param _asset Address of token
	 * @param _amountAdded amount as uint256
	 * @param _debtToOffset amount of debt to offset
	 * @param _totalDeposits How much user has deposited
	 */
	function _computeRewardsPerUnitStaked(
		address _asset,
		uint256 _amountAdded,
		uint256 _debtToOffset,
		uint256 _totalDeposits
	) internal returns (uint256 collGainPerUnitStaked, uint256 debtLossPerUnitStaked) {
		uint256 currentP = P;
		uint256 index = adminContract.getIndex(_asset);
		uint256 collateralNumerator = (_amountAdded * DECIMAL_PRECISION) + lastAssetError_Offset[index];
		require(_debtToOffset <= _totalDeposits, "StabilityPool: Debt is larger than totalDeposits");
		if (_debtToOffset == _totalDeposits) {
			debtLossPerUnitStaked = DECIMAL_PRECISION; // When the Pool depletes to 0, so does each deposit
			lastDebtTokenLossError_Offset = 0;
		} else {
			uint256 lossNumerator = (_debtToOffset * DECIMAL_PRECISION) - lastDebtTokenLossError_Offset;
			/*
			 * Add 1 to make error in quotient positive. We want "slightly too much" loss,
			 * which ensures the error in any given compoundedDeposit favors the Stability Pool.
			 */
			debtLossPerUnitStaked = (lossNumerator / _totalDeposits) + 1;
			lastDebtTokenLossError_Offset = (debtLossPerUnitStaked * _totalDeposits) - lossNumerator;
		}
		collGainPerUnitStaked = (collateralNumerator * currentP) / _totalDeposits;
		lastAssetError_Offset[index] = collateralNumerator - ((collGainPerUnitStaked * _totalDeposits) / currentP);
	}

	/**
	 * @notice add a collateral
	 * @dev should be called anytime a collateral is added to controller
	 * keeps all arrays the correct length
	 * @param _collateral address of collateral to add
	 */
	function addCollateralType(address _collateral) external {
		_requireCallerIsAdminContract();
		lastAssetError_Offset.push(0);
		totalColl.tokens.push(_collateral);
		totalColl.amounts.push(0);
	}

	// Update the Stability Pool reward sum S and product P
	function _updateRewardSumAndProduct(
		address _asset,
		uint256 _AssetGainPerUnitStaked,
		uint256 _lossPerUnitStaked
	) internal {
		require(_lossPerUnitStaked <= DECIMAL_PRECISION, "StabilityPool: Loss < 1");
		uint256 currentP = P;
		uint256 newP;
		/*
		 * The newProductFactor is the factor by which to change all deposits, due to the depletion of Stability Pool debt tokens in the liquidation.
		 * We make the product factor 0 if there was a pool-emptying. Otherwise, it is (1 - lossPerUnitStaked)
		 */
		uint256 newProductFactor = DECIMAL_PRECISION - _lossPerUnitStaked;
		uint128 currentScaleCached = currentScale;
		uint128 currentEpochCached = currentEpoch;
		uint256 currentS = epochToScaleToSum[_asset][currentEpochCached][currentScaleCached];
		uint256 newS = currentS + _AssetGainPerUnitStaked;
		epochToScaleToSum[_asset][currentEpochCached][currentScaleCached] = newS;
		emit S_Updated(_asset, newS, currentEpochCached, currentScaleCached);

		// If the Stability Pool was emptied, increment the epoch, and reset the scale and product P
		if (newProductFactor == 0) {
			currentEpoch = currentEpochCached + 1;
			emit EpochUpdated(currentEpoch);
			currentScale = 0;
			emit ScaleUpdated(currentScale);
			newP = DECIMAL_PRECISION;

			// If multiplying P by a non-zero product factor would reduce P below the scale boundary, increment the scale
		} else if ((currentP * newProductFactor) / DECIMAL_PRECISION < SCALE_FACTOR) {
			newP = (currentP * newProductFactor * SCALE_FACTOR) / DECIMAL_PRECISION;
			currentScale = currentScaleCached + 1;
			emit ScaleUpdated(currentScale);
		} else {
			newP = (currentP * newProductFactor) / DECIMAL_PRECISION;
		}

		require(newP != 0, "StabilityPool: P = 0");
		P = newP;
		emit P_Updated(newP);
	}

	/**
	 * @notice Internal function to move offset collateral and debt between pools.
	 * @dev Cancel the liquidated debtToken debt with the debtTokens in the stability pool,
	 * Burn the debt that was successfully offset. Collateral is moved from
	 * the ActivePool to this contract.
	 * @param _asset collateral address
	 * @param _amount amount as uint256
	 * @param _debtToOffset uint256
	 */
	function _moveOffsetCollAndDebt(
		address _asset,
		uint256 _amount,
		uint256 _debtToOffset
	) internal {
		IActivePool activePoolCached = activePool;
		activePoolCached.decreaseDebt(_asset, _debtToOffset);
		_decreaseDebtTokens(_debtToOffset);
		debtToken.burn(address(this), _debtToOffset);
		activePoolCached.sendAsset(_asset, address(this), _amount);
	}

	function _decreaseDebtTokens(uint256 _amount) internal {
		uint256 newTotalDeposits = totalDebtTokenDeposits - _amount;
		totalDebtTokenDeposits = newTotalDeposits;
		emit StabilityPoolDebtTokenBalanceUpdated(newTotalDeposits);
	}

	// --- Reward calculator functions for depositor ---

	/**
	 * @notice Calculates the gains earned by the deposit since its last snapshots were taken.
	 * @dev Given by the formula:  E = d0 * (S - S(0))/P(0)
	 * where S(0) and P(0) are the depositor's snapshots of the sum S and product P, respectively.
	 * d0 is the last recorded deposit value.
	 * @param _depositor address of depositor in question
	 * @return assets, amounts
	 */
	function getDepositorGains(address _depositor) public view returns (address[] memory, uint256[] memory) {
		uint256 initialDeposit = deposits[_depositor];

		if (initialDeposit == 0) {
			address[] memory emptyAddress = new address[](0);
			uint256[] memory emptyUint = new uint256[](0);
			return (emptyAddress, emptyUint);
		}

		Snapshots storage snapshots = depositSnapshots[_depositor];

		(address[] memory collateralsFromNewGains, uint256[] memory amountsFromNewGains) = _calculateNewGains(
			initialDeposit,
			snapshots
		);
		return (collateralsFromNewGains, amountsFromNewGains);
	}

	/**
	 * @notice get gains on each possible asset by looping through
	 * @dev assets with _getGainFromSnapshots function
	 * @param initialDeposit Amount of initial deposit
	 * @param snapshots struct snapshots
	 */
	function _calculateNewGains(uint256 initialDeposit, Snapshots storage snapshots)
		internal
		view
		returns (address[] memory assets, uint256[] memory amounts)
	{
		assets = adminContract.getValidCollateral();
		uint256 assetsLen = assets.length;
		amounts = new uint256[](assetsLen);
		for (uint256 i; i < assetsLen; ) {
			amounts[i] = _getGainFromSnapshots(initialDeposit, snapshots, assets[i]);
			unchecked {
				i++;
			}
		}
	}

	/**
	 * @notice gets the gain in S for a given asset
	 * @dev for a user who deposited initialDeposit
	 * @param initialDeposit Amount of initialDeposit
	 * @param snapshots struct snapshots
	 * @param asset asset to gain snapshot
	 * @return uint256 the gain
	 */
	function _getGainFromSnapshots(
		uint256 initialDeposit,
		Snapshots storage snapshots,
		address asset
	) internal view returns (uint256) {
		/*
		 * Grab the sum 'S' from the epoch at which the stake was made. The Collateral amount gain may span up to one scale change.
		 * If it does, the second portion of the Collateral amount gain is scaled by 1e9.
		 * If the gain spans no scale change, the second portion will be 0.
		 */
		uint256 S_Snapshot = snapshots.S[asset];
		uint256 P_Snapshot = snapshots.P;

		mapping(uint128 => uint256) storage scaleToSum = epochToScaleToSum[asset][snapshots.epoch];
		uint256 firstPortion = scaleToSum[snapshots.scale] - S_Snapshot;
		uint256 secondPortion = scaleToSum[snapshots.scale + 1] / SCALE_FACTOR;

		uint256 assetGain = (initialDeposit * (firstPortion + secondPortion)) / P_Snapshot / DECIMAL_PRECISION;

		return assetGain;
	}

	/*
	 * Calculate the GRVT gain earned by a deposit since its last snapshots were taken.
	 * Given by the formula:  GRVT = d0 * (G - G(0))/P(0)
	 * where G(0) and P(0) are the depositor's snapshots of the sum G and product P, respectively.
	 * d0 is the last recorded deposit value.
	 */
	function getDepositorGRVTGain(address _depositor) public view override returns (uint256) {
		uint256 initialDeposit = deposits[_depositor];
		if (initialDeposit == 0) {
			return 0;
		}

		Snapshots storage snapshots = depositSnapshots[_depositor];
		return _getGRVTGainFromSnapshots(initialDeposit, snapshots);
	}

	function _getGRVTGainFromSnapshots(uint256 initialStake, Snapshots storage snapshots)
		internal
		view
		returns (uint256)
	{
		/*
		 * Grab the sum 'G' from the epoch at which the stake was made. The GRVT gain may span up to one scale change.
		 * If it does, the second portion of the GRVT gain is scaled by 1e9.
		 * If the gain spans no scale change, the second portion will be 0.
		 */
		uint128 epochSnapshot = snapshots.epoch;
		uint128 scaleSnapshot = snapshots.scale;
		uint256 G_Snapshot = snapshots.G;
		uint256 P_Snapshot = snapshots.P;

		uint256 firstPortion = epochToScaleToG[epochSnapshot][scaleSnapshot] - G_Snapshot;
		uint256 secondPortion = epochToScaleToG[epochSnapshot][scaleSnapshot + 1] / SCALE_FACTOR;

		uint256 GRVTGain = (initialStake * (firstPortion + secondPortion)) / P_Snapshot / DECIMAL_PRECISION;

		return GRVTGain;
	}

	// --- Compounded deposit and compounded System stake ---

	/*
	 * Return the user's compounded deposit. Given by the formula:  d = d0 * P/P(0)
	 * where P(0) is the depositor's snapshot of the product P, taken when they last updated their deposit.
	 */
	function getCompoundedDebtTokenDeposits(address _depositor) public view override returns (uint256) {
		uint256 initialDeposit = deposits[_depositor];
		if (initialDeposit == 0) {
			return 0;
		}

		return _getCompoundedStakeFromSnapshots(initialDeposit, depositSnapshots[_depositor]);
	}

	// Internal function, used to calculate compounded deposits and compounded stakes.
	function _getCompoundedStakeFromSnapshots(uint256 initialStake, Snapshots storage snapshots)
		internal
		view
		returns (uint256)
	{
		uint256 snapshot_P = snapshots.P;
		uint128 scaleSnapshot = snapshots.scale;
		uint128 epochSnapshot = snapshots.epoch;

		// If stake was made before a pool-emptying event, then it has been fully cancelled with debt -- so, return 0
		if (epochSnapshot < currentEpoch) {
			return 0;
		}

		uint256 compoundedStake;
		uint128 scaleDiff = currentScale - scaleSnapshot;

		/* Compute the compounded stake. If a scale change in P was made during the stake's lifetime,
		 * account for it. If more than one scale change was made, then the stake has decreased by a factor of
		 * at least 1e-9 -- so return 0.
		 */
		if (scaleDiff == 0) {
			compoundedStake = (initialStake * P) / snapshot_P;
		} else if (scaleDiff == 1) {
			compoundedStake = (initialStake * P) / snapshot_P / SCALE_FACTOR;
		}

		/*
		 * If compounded deposit is less than a billionth of the initial deposit, return 0.
		 *
		 * NOTE: originally, this line was in place to stop rounding errors making the deposit too large. However, the error
		 * corrections should ensure the error in P "favors the Pool", i.e. any given compounded deposit should slightly less
		 * than it's theoretical value.
		 *
		 * Thus it's unclear whether this line is still really needed.
		 */
		if (compoundedStake < initialStake / 1e9) {
			return 0;
		}

		return compoundedStake;
	}

	// --- Sender functions for debtToken deposits

	// Transfer the tokens from the user to the Stability Pool's address, and update its recorded deposits
	function _sendToStabilityPool(address _address, uint256 _amount) internal {
		debtToken.sendToPool(_address, address(this), _amount);
		uint256 newTotalDeposits = totalDebtTokenDeposits + _amount;
		totalDebtTokenDeposits = newTotalDeposits;
		emit StabilityPoolDebtTokenBalanceUpdated(newTotalDeposits);
	}

	/**
	 * @notice transfer collateral gains to the depositor
	 * @dev this function also unwraps wrapped assets
	 * before sending to depositor
	 * @param _to address
	 * @param assets array of address
	 * @param amounts array of uint256. Includes pending collaterals since that was added in previous steps
	 */
	function _sendGainsToDepositor(
		address _to,
		address[] memory assets,
		uint256[] memory amounts
	) internal {
		uint256 assetsLen = assets.length;
		require(assetsLen == amounts.length, "StabilityPool: Length mismatch");
		for (uint256 i; i < assetsLen; ) {
			uint256 amount = amounts[i];
			if (amount == 0) {
				unchecked {
					i++;
				}
				continue;
			}
			address asset = assets[i];
			// Assumes we're internally working only with the wrapped version of ERC20 tokens
			IERC20Upgradeable(asset).safeTransfer(_to, amount);
			unchecked {
				i++;
			}
		}
		totalColl.amounts = _leftSubColls(totalColl, assets, amounts);
	}

	// Send debt tokens to user and decrease deposits in Pool
	function _sendToDepositor(address _depositor, uint256 debtTokenWithdrawal) internal {
		if (debtTokenWithdrawal == 0) {
			return;
		}
		debtToken.returnFromPool(address(this), _depositor, debtTokenWithdrawal);
		_decreaseDebtTokens(debtTokenWithdrawal);
	}

	// --- Stability Pool Deposit Functionality ---

	/**
	 * @notice updates deposit and snapshots internally
	 * @dev if _newValue is zero, delete snapshot for given _depositor and emit event
	 * otherwise, add an entry or update existing entry for _depositor in the depositSnapshots
	 * with current values for P, S, G, scale and epoch and then emit event.
	 * @param _depositor address
	 * @param _newValue uint256
	 */
	function _updateDepositAndSnapshots(address _depositor, uint256 _newValue) internal {
		deposits[_depositor] = _newValue;
		address[] memory colls = adminContract.getValidCollateral();
		uint256 collsLen = colls.length;

		Snapshots storage depositorSnapshots = depositSnapshots[_depositor];
		if (_newValue == 0) {
			for (uint256 i; i < collsLen; ) {
				depositSnapshots[_depositor].S[colls[i]] = 0;
				unchecked {
					i++;
				}
			}
			depositorSnapshots.P = 0;
			depositorSnapshots.G = 0;
			depositorSnapshots.epoch = 0;
			depositorSnapshots.scale = 0;
			emit DepositSnapshotUpdated(_depositor, 0, 0);
			return;
		}
		uint128 currentScaleCached = currentScale;
		uint128 currentEpochCached = currentEpoch;
		uint256 currentP = P;

		for (uint256 i; i < collsLen; ) {
			address asset = colls[i];
			uint256 currentS = epochToScaleToSum[asset][currentEpochCached][currentScaleCached];
			depositSnapshots[_depositor].S[asset] = currentS;
			unchecked {
				i++;
			}
		}

		uint256 currentG = epochToScaleToG[currentEpochCached][currentScaleCached];
		depositorSnapshots.P = currentP;
		depositorSnapshots.G = currentG;
		depositorSnapshots.scale = currentScaleCached;
		depositorSnapshots.epoch = currentEpochCached;

		emit DepositSnapshotUpdated(_depositor, currentP, currentG);
	}

	function S(address _depositor, address _asset) external view returns (uint256) {
		return depositSnapshots[_depositor].S[_asset];
	}

	function _payOutGRVTGains(ICommunityIssuance _communityIssuance, address _depositor) internal {
		if (address(_communityIssuance) != address(0)) {
			uint256 depositorGRVTGain = getDepositorGRVTGain(_depositor);
			_communityIssuance.sendGRVT(_depositor, depositorGRVTGain);
			emit GRVTPaidToDepositor(_depositor, depositorGRVTGain);
		}
	}

	function _leftSubColls(
		Colls memory _coll1,
		address[] memory _tokens,
		uint256[] memory _amounts
	) internal pure returns (uint256[] memory) {
		uint256 coll1Len = _coll1.amounts.length;
		uint256 tokensLen = _tokens.length;

		for (uint256 i; i < coll1Len; ) {
			for (uint256 j; j < tokensLen; ) {
				if (_coll1.tokens[i] == _tokens[j]) {
					_coll1.amounts[i] -= _amounts[j];
				}
				unchecked {
					j++;
				}
			}
			unchecked {
				i++;
			}
		}

		return _coll1.amounts;
	}

	// --- 'require' functions ---

	function _requireCallerIsActivePool() internal view {
		require(msg.sender == address(adminContract.activePool()), "StabilityPool: Caller is not ActivePool");
	}

	function _requireCallerIsVesselManager() internal view {
		require(msg.sender == address(vesselManager), "StabilityPool: Caller is not VesselManager");
	}

	function _requireCallerIsAdminContract() internal view {
		require(msg.sender == address(adminContract), "StabilityPool: Caller is not AdminContract");
	}

	/**
	 * @notice check ICR of bottom vessel (per asset) in SortedVessels
	 */
	function _requireNoUnderCollateralizedVessels() internal {
		IVesselManager _vesselManager = vesselManager;
		IAdminContract _adminContract = adminContract;
		ISortedVessels _sortedVessels = sortedVessels;
		IPriceFeed _priceFeed = _adminContract.priceFeed();
		address[] memory assets = _adminContract.getValidCollateral();
		uint256 assetsLen = assets.length;

		for (uint256 i; i < assetsLen; ) {
			address assetAddress = assets[i];
			address lowestVessel = _sortedVessels.getLast(assetAddress);
			uint256 price = _priceFeed.fetchPrice(assetAddress);
			uint256 ICR = _vesselManager.getCurrentICR(assetAddress, lowestVessel, price);
			require(
				ICR >= _adminContract.getMcr(assetAddress),
				"StabilityPool: Cannot withdraw while there are vessels with ICR < MCR"
			);
			unchecked {
				i++;
			}
		}
	}

	function _requireUserHasDeposit(uint256 _initialDeposit) internal pure {
		require(_initialDeposit != 0, "StabilityPool: User must have a non-zero deposit");
	}

	function _requireNonZeroAmount(uint256 _amount) internal pure {
		require(_amount != 0, "StabilityPool: Amount must be non-zero");
	}

	// --- Fallback function ---

	function receivedERC20(address _asset, uint256 _amount) external override {
		_requireCallerIsActivePool();
		uint256 collateralIndex = adminContract.getIndex(_asset);
		uint256 newAssetBalance = totalColl.amounts[collateralIndex] + _amount;
		totalColl.amounts[collateralIndex] = newAssetBalance;
		emit StabilityPoolAssetBalanceUpdated(_asset, newAssetBalance);
	}
}
