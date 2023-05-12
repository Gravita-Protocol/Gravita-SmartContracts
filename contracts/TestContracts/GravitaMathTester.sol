// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../Dependencies/GravitaMath.sol";

/* Tester contract for math functions in Math.sol library. */

contract GravitaMathTester {
	function callMax(uint256 _a, uint256 _b) external pure returns (uint256) {
		return GravitaMath._max(_a, _b);
	}

	// Non-view wrapper for gas test
	function callDecPowTx(uint256 _base, uint256 _n) external pure returns (uint256) {
		return GravitaMath._decPow(_base, _n);
	}

	// External wrapper
	function callDecPow(uint256 _base, uint256 _n) external pure returns (uint256) {
		return GravitaMath._decPow(_base, _n);
	}
}
