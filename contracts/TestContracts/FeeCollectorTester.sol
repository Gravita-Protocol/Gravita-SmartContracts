// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "../FeeCollector.sol";

contract FeeCollectorTester is FeeCollector {
	function calcNewDuration(
		uint256 remainingAmount,
		uint256 remainingTimeToLive,
		uint256 addedAmount
	) external pure returns (uint256) {
		return _calcNewDuration(remainingAmount, remainingTimeToLive, addedAmount);
	}
}
