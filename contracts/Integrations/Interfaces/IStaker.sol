// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IStaker {
	function deposit(address, address) external;

	function withdraw(address) external;

	function withdraw(address, address, uint256) external;

	function withdrawAll(address, address) external;

	function createLock(uint256, uint256) external;

	function increaseAmount(uint256) external;

	function increaseTime(uint256) external;

	function release() external;

	function claimCrv(address) external returns (uint256);

	function claimRewards(address) external;

	function claimFees(address, address) external;

	function setStashAccess(address, bool) external;

	function vote(uint256, address, bool) external;

	function voteGaugeWeight(address, uint256) external;

	function balanceOfPool(address) external view returns (uint256);

	function operator() external view returns (address);

	function execute(address _to, uint256 _value, bytes calldata _data) external returns (bool, bytes memory);
}
