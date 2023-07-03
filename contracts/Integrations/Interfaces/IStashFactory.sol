// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IStashFactory {
	function CreateStash(uint256, address, address, uint256) external returns (address);

	function setImplementation(address _v1, address _v2, address _v3) external;
}
