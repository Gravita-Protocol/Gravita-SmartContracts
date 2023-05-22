// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../FeeCollector.sol";

contract FeeCollectorTester is FeeCollector {

	bool public __routeToGRVTStaking;

	function calcNewDuration(
		uint256 remainingAmount,
		uint256 remainingTimeToLive,
		uint256 addedAmount
	) external pure returns (uint256) {
		return _calcNewDuration(remainingAmount, remainingTimeToLive, addedAmount);
	}

	function setRouteToGRVTStaking(bool ___routeToGRVTStaking) external onlyOwner {
		__routeToGRVTStaking = ___routeToGRVTStaking;
	}

	function _routeToGRVTStaking() internal view override returns (bool) {
		return __routeToGRVTStaking;
	}
}
