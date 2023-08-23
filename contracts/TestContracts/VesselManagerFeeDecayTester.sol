// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../Dependencies/GravitaBase.sol";

/* Mimic VesselManager decaying fee model for testing */

contract VesselManagerFeeDecayTester is GravitaBase {
	event LastFeeOpTimeUpdated(address indexed _asset, uint256 _lastFeeOpTime);

	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;
	/*
	 * Half-life of 12h. 12h = 720 min
	 * (1/2) = d^720 => d = (1/2)^(1/720)
	 */
	uint256 public constant MINUTE_DECAY_FACTOR = 999037758833783000;

	mapping(address => uint256) public baseRate;
	mapping(address => uint256) public lastFeeOperationTime;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Test functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function unprotectedDecayBaseRateFromBorrowing(address _asset) external {
		baseRate[_asset] = _calcDecayedBaseRate(_asset);
		assert(baseRate[_asset] >= 0 && baseRate[_asset] <= DECIMAL_PRECISION);
		_updateLastFeeOpTime(_asset);
	}

	function setLastFeeOpTimeToNow(address _asset) external {
		lastFeeOperationTime[_asset] = block.timestamp;
	}

	function setBaseRate(address _asset, uint256 _baseRate) external {
		baseRate[_asset] = _baseRate;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Functions copied from VesselManager
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function _updateLastFeeOpTime(address _asset) internal {
		uint256 timePassed = block.timestamp - lastFeeOperationTime[_asset];
		if (timePassed >= SECONDS_IN_ONE_MINUTE) {
			// Update the last fee operation time only if time passed >= decay interval. This prevents base rate griefing.
			lastFeeOperationTime[_asset] = block.timestamp;
			emit LastFeeOpTimeUpdated(_asset, block.timestamp);
		}
	}

	function _calcDecayedBaseRate(address _asset) internal view returns (uint256) {
		uint256 minutesPassed = _minutesPassedSinceLastFeeOp(_asset);
		uint256 decayFactor = GravitaMath._decPow(MINUTE_DECAY_FACTOR, minutesPassed);
		return (baseRate[_asset] * decayFactor) / DECIMAL_PRECISION;
	}

	function _minutesPassedSinceLastFeeOp(address _asset) internal view returns (uint256) {
		return (block.timestamp - lastFeeOperationTime[_asset]) / SECONDS_IN_ONE_MINUTE;
	}
}
