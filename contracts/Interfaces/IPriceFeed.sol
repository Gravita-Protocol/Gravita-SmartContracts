// SPDX-License-Identifier: MIT
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

pragma solidity ^0.8.10;

interface IPriceFeed {

	// Structs --------------------------------------------------------------------------------------------------------

	struct OracleRecord {
		AggregatorV3Interface chainLinkOracle;
		uint256 timelockRelease;
		bool exists;
		bool isFeedWorking;
		bool isEthIndexed;
	}

	struct FeedResponse {
		uint80 roundId;
		int256 answer;
		uint256 timestamp;
		bool success;
		uint8 decimals;
	}

	// Custom Errors --------------------------------------------------------------------------------------------------

	error UnknownOracleError(address _token);

	// Events ---------------------------------------------------------------------------------------------------------

	event LastGoodPriceUpdated(address indexed token, uint256 _lastGoodPrice);
	event NewOracleRegistered(address token, address chainlinkAggregator, bool isEthIndexed);
	event OracleDeleted(address token, address chainlinkAggregator);
	event PriceFeedStatusUpdated(address token, address oracle, bool isWorking);
	event PriceDeviationAlert(address _token, uint256 _currPrice, uint256 _prevPrice);

	// Functions ------------------------------------------------------------------------------------------------------

	function addOracle(address _token, address _chainlinkOracle, bool _isEthIndexed) external;

	function deleteQueuedOracle(address _token) external;

	function deleteOracle(address _token) external;

	function fetchPrice(address _token) external returns (uint256);
}
