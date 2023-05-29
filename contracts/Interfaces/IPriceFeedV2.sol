// SPDX-License-Identifier: MIT
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

pragma solidity ^0.8.19;

interface IPriceFeedV2 {
	// Enums ----------------------------------------------------------------------------------------------------------

	enum ProviderType {
		Chainlink,
		Redstone,
		Tellor
	}

	// Structs --------------------------------------------------------------------------------------------------------

	struct OracleRecord {
		address oracleAddress;
		ProviderType providerType;
		uint256 timeout;
		uint256 decimals;
		bool isEthIndexed;
	}

	struct OracleResponse {
		uint256 price;
		uint256 timestamp;
		uint256 decimals;
	}

	// Custom Errors --------------------------------------------------------------------------------------------------

	error PriceFeed__InvalidOracleResponseError(address token);
	error PriceFeed__OracleFrozenError(address token);
	error PriceFeed__UnknownAssetError(address token);
	error PriceFeed__TimelockOnlyError();

	// Events ---------------------------------------------------------------------------------------------------------

	event NewOracleRegistered(address token, address chainlinkAggregator, bool isEthIndexed, bool isFallback);

	// Functions ------------------------------------------------------------------------------------------------------

	function setOracle(
		address _token,
		address _oracle,
		ProviderType _type,
		uint256 _timeout,
		bool _isEthIndexed,
		bool _isFallback
	) external;

	function fetchPrice(address _token) external returns (uint256);
}

