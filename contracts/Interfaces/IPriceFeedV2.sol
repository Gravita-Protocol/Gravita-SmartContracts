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
		uint256 timeoutMinutes;
		uint256 decimals;
		bool isEthIndexed;
	}

	// Custom Errors --------------------------------------------------------------------------------------------------

	error PriceFeed__InvalidOracleResponseError(address token);
	error PriceFeed__ExistingOracleRequired();
	error PriceFeed__TimelockOnlyError();
	error PriceFeed__UnknownAssetError();

	// Events ---------------------------------------------------------------------------------------------------------

	event NewOracleRegistered(address token, address oracleAddress, bool isEthIndexed, bool isFallback);

	// Functions ------------------------------------------------------------------------------------------------------

	function setOracle(
		address _token,
		address _oracle,
		ProviderType _type,
		uint256 _timeoutMinutes,
		bool _isEthIndexed,
		bool _isFallback
	) external;

	function fetchPrice(address _token) external returns (uint256);
}

