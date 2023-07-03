// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IStash {
	function stashRewards() external returns (bool);

	function processStash() external returns (bool);

	function claimRewards() external returns (bool);

	function initialize(
		uint256 _pid,
		address _operator,
		address _staker,
		address _gauge,
		address _rewardFactory
	) external;

	function setExtraReward(address _token) external;

	function setRewardHook(address _hook) external;

	function tokenCount() external view returns (uint256);
}
