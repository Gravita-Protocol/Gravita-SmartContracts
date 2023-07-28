// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../VesselManager.sol";

/* Tester contract inherits from VesselManager, and provides external functions 
for testing the parent's internal functions. */

contract VesselManagerTester is VesselManager {
	function computeICR(uint256 _coll, uint256 _debt, uint256 _price) external pure returns (uint256) {
		return GravitaMath._computeCR(_coll, _debt, _price);
	}

	function getCollGasCompensation(address _asset, uint256 _coll) external view returns (uint256) {
		return _getCollGasCompensation(_asset, _coll);
	}

	function unprotectedDecayBaseRateFromBorrowing(address _asset) external returns (uint256) {
		baseRate[_asset] = _calcDecayedBaseRate(_asset);
		assert(baseRate[_asset] >= 0 && baseRate[_asset] <= DECIMAL_PRECISION);

		_updateLastFeeOpTime(_asset);
		return baseRate[_asset];
	}

	function minutesPassedSinceLastFeeOp(address _asset) external view returns (uint256) {
		return _minutesPassedSinceLastFeeOp(_asset);
	}

	function setLastFeeOpTimeToNow(address _asset) external {
		lastFeeOperationTime[_asset] = block.timestamp;
	}

	function setBaseRate(address _asset, uint256 _baseRate) external {
		baseRate[_asset] = _baseRate;
	}

	function getActualDebtFromComposite(address _asset, uint256 _debtVal) external view returns (uint256) {
		return _getNetDebt(_asset, _debtVal);
	}
}
