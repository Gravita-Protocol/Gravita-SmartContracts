// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../Dependencies/GravitaSafeMath128.sol";

/* Tester contract for math functions in GravitaSafeMath128.sol library. */

contract GravitaSafeMath128Tester {
	using GravitaSafeMath128 for uint128;

	function add(uint128 a, uint128 b) external pure returns (uint128) {
		return a.add(b);
	}

	function sub(uint128 a, uint128 b) external pure returns (uint128) {
		return a.sub(b);
	}
}
