// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IRewardFactory {
	function setAccess(address, bool) external;

	function CreateCrvRewards(uint256, address) external returns (address);

	function CreateTokenRewards(address, address, address) external returns (address);

	function activeRewardCount(address) external view returns (uint256);

	function addActiveReward(address, uint256) external returns (bool);

	function removeActiveReward(address, uint256) external returns (bool);
}
