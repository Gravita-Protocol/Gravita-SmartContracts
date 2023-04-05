// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "./IDeposit.sol";

interface ICollSurplusPool is IDeposit {

	// --- Events ---

	event CollBalanceUpdated(address indexed _account, uint256 _newBalance);
	event AssetSent(address _to, uint256 _amount);

	// --- Contract setters ---

	function setAddresses(
		address _activePoolAddress,
		address _borrowerOperationsAddress,
		address _vesselManagerAddress,
		address _vesselManagerOperationsAddress
	) external;

	function getAssetBalance(address _asset) external view returns (uint256);

	function getCollateral(address _asset, address _account) external view returns (uint256);

	function accountSurplus(
		address _asset,
		address _account,
		uint256 _amount
	) external;

	function claimColl(address _asset, address _account) external;
}
