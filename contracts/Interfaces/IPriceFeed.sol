// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/*
 * @dev from https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol
 */
interface ChainlinkAggregatorV3Interface {
	function decimals() external view returns (uint8);

	function latestRoundData()
		external
		view
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/*
 * @dev If we decide to onboard Band oracles, notice that their price request expects two strings, a base and a quote.
 *
 * @dev from https://docs.bandchain.org/band-standard-dataset/using-band-dataset/using-band-dataset-evm.html
 */
interface BandIStdReference {
	struct ReferenceData {
		uint256 rate; // base/quote exchange rate, multiplied by 1e18.
		uint256 lastUpdatedBase; // UNIX epoch of the last time when base price gets updated.
		uint256 lastUpdatedQuote; // UNIX epoch of the last time when quote price gets updated.
	}

	/// Returns the price data for the given base/quote pair. Revert if not available.
	function getReferenceData(string memory _base, string memory _quote) external view returns (ReferenceData memory);
}

interface IPriceFeed {
	// Enums ----------------------------------------------------------------------------------------------------------

	enum ProviderType {
		Chainlink
	}

	// Structs --------------------------------------------------------------------------------------------------------

	struct OracleRecordV2 {
		address oracleAddress;
		ProviderType providerType;
		uint256 timeoutMinutes;
		uint256 decimals;
		bool isEthIndexed;
	}

	/// @dev Deprecated, but retained for upgradeability
	struct OracleRecord {
		address chainLinkOracle;
		uint256 maxDeviationBetweenRounds;
		bool exists;
		bool isFeedWorking;
		bool isEthIndexed;
	}

	/// @dev Deprecated, but retained for upgradeability
	struct PriceRecord {
		uint256 scaledPrice;
		uint256 timestamp;
	}

	/// @dev Deprecated, but retained for upgradeability
	struct FeedResponse {
		uint80 roundId;
		int256 answer;
		uint256 timestamp;
		bool success;
		uint8 decimals;
	}

	// Custom Errors --------------------------------------------------------------------------------------------------

	error PriceFeed__InvalidOracleResponseError(address token);
	error PriceFeed__InvalidDecimalsError();
	error PriceFeed__ExistingOracleRequired();
	error PriceFeed__TimelockOnlyError();
	error PriceFeed__UnknownAssetError();
	error PriceFeed__DeprecatedFunctionError();

	// Events ---------------------------------------------------------------------------------------------------------

	event NewOracleRegistered(address token, address oracleAddress, bool isEthIndexed, bool isFallback);

	// Functions ------------------------------------------------------------------------------------------------------

	function fetchPrice(address _token) external view returns (uint256);

	function setOracle(
		address _token,
		address _oracle,
		ProviderType _type,
		uint256 _timeoutMinutes,
		bool _isEthIndexed,
		bool _isFallback
	) external;
}

