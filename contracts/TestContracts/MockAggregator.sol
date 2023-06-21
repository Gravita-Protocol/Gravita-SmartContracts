// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MockAggregator is AggregatorV3Interface {
	uint8 private decimalsVal = 8;
	int256 private answer = 190000000000;
	int256 private prevAnswer = 190000000000;
	uint256 private startedAt;
	uint256 private updatedAt;

	uint80 private latestRoundId = 2;
	uint80 private prevRoundId = 1;

	bool priceIsAlwaysUpToDate = true;

	// --- Functions ---

	function setDecimals(uint8 _decimals) external {
		decimalsVal = _decimals;
	}

	function setPrice(int256 _price) external {
		answer = _price;
	}

	function setPrevPrice(int256 _prevPrice) external {
		prevAnswer = _prevPrice;
	}

	function setStartedAt(uint256 _startedAt) external {
		startedAt = _startedAt;
	}

	function setUpdatedAt(uint256 _updatedAt) external {
		updatedAt = _updatedAt;
	}

	function setLatestRoundId(uint80 _latestRoundId) external {
		latestRoundId = _latestRoundId;
	}

	function setPrevRoundId(uint80 _prevRoundId) external {
		prevRoundId = _prevRoundId;
	}

	function setPriceIsAlwaysUpToDate(bool _priceIsAlwaysUpToDate) external {
		priceIsAlwaysUpToDate = _priceIsAlwaysUpToDate;
	}

	// --- Getters that adhere to the AggregatorV3 interface ---

	function decimals() external view override returns (uint8) {
		return decimalsVal;
	}

	function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
		uint256 timestamp = priceIsAlwaysUpToDate ? block.timestamp - 2 minutes : updatedAt;
		return (latestRoundId, answer, startedAt, timestamp, 0);
	}

	function getRoundData(uint80) external view override returns (uint80, int256, uint256, uint256, uint80) {
		uint256 timestamp = priceIsAlwaysUpToDate ? block.timestamp - 5 minutes : updatedAt;
		return (prevRoundId, prevAnswer, startedAt, timestamp, 0);
	}

	function description() external pure override returns (string memory) {
		return "";
	}

	function version() external pure override returns (uint256) {
		return 1;
	}
}
