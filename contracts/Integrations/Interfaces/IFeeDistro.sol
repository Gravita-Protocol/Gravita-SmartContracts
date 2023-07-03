// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IFeeDistro {
	function claim() external;

	function token() external view returns (address);
}
