// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IConvexDeposits {
	function deposit(uint256 _pid, uint256 _amount, bool _stake) external returns (bool);
}
