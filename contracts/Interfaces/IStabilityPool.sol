// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "./IDeposit.sol";

interface IStabilityPool is IDeposit {
	// --- Events ---

	event DepositSnapshotUpdated(address indexed _depositor, uint256 _P, uint256 _G);
	event SystemSnapshotUpdated(uint256 _P, uint256 _G);

	event AssetSent(address _asset, address _to, uint256 _amount);
	event GainsWithdrawn(
		address indexed _depositor,
		address[] _collaterals,
		uint256[] _amounts,
		uint256 _debtTokenLoss
	);
	event GRVTPaidToDepositor(address indexed _depositor, uint256 _GRVT);
	event StabilityPoolAssetBalanceUpdated(address _asset, uint256 _newBalance);
	event StabilityPoolDebtTokenBalanceUpdated(uint256 _newBalance);
	event StakeChanged(uint256 _newSystemStake, address _depositor);
	event UserDepositChanged(address indexed _depositor, uint256 _newDeposit);

	event P_Updated(uint256 _P);
	event S_Updated(address _asset, uint256 _S, uint128 _epoch, uint128 _scale);
	event G_Updated(uint256 _G, uint128 _epoch, uint128 _scale);
	event EpochUpdated(uint128 _currentEpoch);
	event ScaleUpdated(uint128 _currentScale);

	// --- Functions ---

	/*
	 * Called only once on init, to set addresses of other Gravita contracts
	 * Callable only by owner, renounces ownership at the end
	 */
	function setAddresses(
		address _borrowerOperationsAddress,
		address _vesselManagerAddress,
		address _activePoolAddress,
		address _debtTokenAddress,
		address _sortedVesselsAddress,
		address _communityIssuanceAddress,
		address _adminContractAddress
	) external;

	/*
	 * Initial checks:
	 * - Frontend is registered or zero address
	 * - Sender is not a registered frontend
	 * - _amount is not zero
	 * ---
	 * - Triggers a GRVT issuance, based on time passed since the last issuance. The GRVT issuance is shared between *all* depositors and front ends
	 * - Tags the deposit with the provided front end tag param, if it's a new deposit
	 * - Sends depositor's accumulated gains (GRVT, ETH) to depositor
	 * - Sends the tagged front end's accumulated GRVT gains to the tagged front end
	 * - Increases deposit and tagged front end's stake, and takes new snapshots for each.
	 */
	function provideToSP(uint256 _amount) external;

	/*
	 * Initial checks:
	 * - _amount is zero or there are no under collateralized vessels left in the system
	 * - User has a non zero deposit
	 * ---
	 * - Triggers a GRVT issuance, based on time passed since the last issuance. The GRVT issuance is shared between *all* depositors and front ends
	 * - Removes the deposit's front end tag if it is a full withdrawal
	 * - Sends all depositor's accumulated gains (GRVT, ETH) to depositor
	 * - Sends the tagged front end's accumulated GRVT gains to the tagged front end
	 * - Decreases deposit and tagged front end's stake, and takes new snapshots for each.
	 *
	 * If _amount > userDeposit, the user withdraws all of their compounded deposit.
	 */
	function withdrawFromSP(uint256 _amount) external;

	/*
	Initial checks:
	 * - Caller is VesselManager
	 * ---
	 * Cancels out the specified debt against the debt token contained in the Stability Pool (as far as possible)
	 * and transfers the Vessel's collateral from ActivePool to StabilityPool.
	 * Only called by liquidation functions in the VesselManager.
	 */
	function offset(uint256 _debt, address _asset, uint256 _coll) external;

	/*
	 * Returns debt tokens held in the pool. Changes when users deposit/withdraw, and when Vessel debt is offset.
	 */
	function getTotalDebtTokenDeposits() external view returns (uint256);

	/*
	 * Calculates the ETH gain earned by the deposit since its last snapshots were taken.
	 */
	function getDepositorGains(
		address _depositor
	) external view returns (address[] memory, uint256[] memory);

	/*
	 * Calculate the GRVT gain earned by a deposit since its last snapshots were taken.
	 * If not tagged with a front end, the depositor gets a 100% cut of what their deposit earned.
	 * Otherwise, their cut of the deposit's earnings is equal to the kickbackRate, set by the front end through
	 * which they made their deposit.
	 */
	function getDepositorGRVTGain(address _depositor) external view returns (uint256);

	/*
	 * Return the user's compounded deposits.
	 */
	function getCompoundedDebtTokenDeposits(address _depositor) external view returns (uint256);

	/*
	 * Fallback function
	 * Only callable by Active Pool, it just accounts for ETH received
	 * receive() external payable;
	 */

	function addCollateralType(address _collateral) external;
}
