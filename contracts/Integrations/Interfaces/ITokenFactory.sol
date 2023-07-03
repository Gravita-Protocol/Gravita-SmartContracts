// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface ITokenFactory {
	function CreateDepositToken(address) external returns (address);
}
