// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface ITokenMinter {
	function mint(address, uint256) external;

	function burn(address, uint256) external;
}
