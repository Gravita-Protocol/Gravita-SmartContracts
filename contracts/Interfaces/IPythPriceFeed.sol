// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IPythPriceFeed {
	// Custom Errors --------------------------------------------------------------------------------------------------

	// error PriceFeed__InvalidOracleResponseError(address token);
	// error PriceFeed__InvalidDecimalsError();
	// error PriceFeed__ExistingOracleRequired();
	error PriceFeed__TimelockOnlyError();
	// error PriceFeed__UnknownAssetError();
	// error PriceFeed__DeprecatedFunctionError();

	// Events ---------------------------------------------------------------------------------------------------------

	event NewPriceIdRegistered(address _token, bytes32 _priceId);

	// Functions ------------------------------------------------------------------------------------------------------

	function setTokenPriceId(address _token, bytes32 _priceId) external;

	function fetchPrice(address _token, bytes[] calldata _pythPriceUpdateData) external payable returns (uint256);
}
