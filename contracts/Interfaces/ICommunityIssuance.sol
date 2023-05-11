// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface ICommunityIssuance {
	// --- Events ---

	event AddressesChanged(
		address indexed newGrvtTokenAddress,
		address indexed newStabilityPoolAddress,
		address indexed newAdminContract
	);
	event AdminContractChanged(address indexed oldAdminContract, address indexed newAdminContract);
	event TotalGRVTIssuedUpdated(uint256 _totalGRVTIssued);

	// --- Functions ---

	function issueGRVT() external returns (uint256);

	function sendGRVT(address _account, uint256 _GRVTamount) external;

	function addFundToStabilityPool(uint256 _assignedSupply) external;

	function addFundToStabilityPoolFrom(uint256 _assignedSupply, address _spender) external;

	function setWeeklyGrvtDistribution(uint256 _weeklyReward) external;
}

