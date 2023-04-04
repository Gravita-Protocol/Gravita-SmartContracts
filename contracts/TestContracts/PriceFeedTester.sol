// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../PriceFeed.sol";

contract PriceFeedTester is PriceFeed {

	uint256 timelock;

	function setLastGoodPrice(address _asset, uint256 _lastGoodPrice) external {
		lastGoodPrice[_asset] = _lastGoodPrice;
	}

	function _getRETH_ETHValue() internal pure override returns (uint256) {
		return 1054021266924449498;
	}

	function _getWstETH_StETHValue() internal pure override returns (uint256) {
		return 1104446462143629660;
	}

	function _getOracleUpdateTimelock() internal view override returns (uint256) {
		return timelock;
	}

	function _setOracleUpdateTimelock(uint256 _timelock) external {
		timelock = _timelock;
	}
}
