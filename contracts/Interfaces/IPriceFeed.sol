// SPDX-License-Identifier: MIT
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

pragma solidity 0.8.19;

interface IPriceFeed {
	// Structs --------------------------------------------------------------------------------------------------------

	struct OracleRecord {
		AggregatorV3Interface chainLinkOracle;
		// Maximum price deviation allowed between two consecutive Chainlink oracle prices. 18-digit precision.
		uint256 maxDeviationBetweenRounds;
		bool exists;
		bool isFeedWorking;
		bool isEthIndexed;
	}

	struct PriceRecord {
		uint256 scaledPrice;
		uint256 timestamp;
	}

	struct FeedResponse {
		uint80 roundId;
		int256 answer;
		uint256 timestamp;
		bool success;
		uint8 decimals;
	}

	// Custom Errors --------------------------------------------------------------------------------------------------

	error PriceFeed__InvalidFeedResponseError(address token);
	error PriceFeed__InvalidPriceDeviationParamError();
	error PriceFeed__FeedFrozenError(address token);
	error PriceFeed__PriceDeviationError(address token);
	error PriceFeed__UnknownFeedError(address token);
	error PriceFeed__TimelockOnly();

	// Events ---------------------------------------------------------------------------------------------------------

	event NewOracleRegistered(address token, address chainlinkAggregator, bool isEthIndexed);
	event PriceFeedStatusUpdated(address token, address oracle, bool isWorking);
	event PriceRecordUpdated(address indexed token, uint256 _price);

	// Functions ------------------------------------------------------------------------------------------------------

	function setOracle(
		address _token,
		address _chainlinkOracle,
		uint256 _maxPriceDeviationFromPreviousRound,
		bool _isEthIndexed
	) external;

	function fetchPrice(address _token) external returns (uint256);
}
