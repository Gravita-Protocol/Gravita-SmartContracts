// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

// TODO replace with import from IPriceFeed, once merged from the pricefeed-v2 branch
interface ChainlinkAggregatorV3Interface {
	function decimals() external view returns (uint8);

	function latestRoundData()
		external
		view
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract PythAggregator is ChainlinkAggregatorV3Interface {
	
	/// @notice Crypto.ETH/USD on Pyth EVM Mainnet (https://pyth.network/developers/price-feed-ids)
	// string public constant priceId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

	/// @notice Crypto.ETH/USD on Pyth EVM Testnet (https://pyth.network/developers/price-feed-ids)
	string public constant priceId = "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6";

	IPyth pyth;

	constructor(address pythContract) {
		pyth = IPyth(pythContract);
	}

	function decimals() external view override returns (uint8) {
		return 0;
	}

	function latestRoundData()
		external
		view
		override
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
	{
  }

	function getBtcUsdPrice(bytes[] calldata priceUpdateData) public payable returns (PythStructs.Price memory) {
		// Update the prices to the latest available values and pay the required fee for it. The `priceUpdateData` data
		// should be retrieved from our off-chain Price Service API using the `pyth-evm-js` package.
		// See section "How Pyth Works on EVM Chains" below for more information.
		uint fee = pyth.getUpdateFee(priceUpdateData);
		pyth.updatePriceFeeds{ value: fee }(priceUpdateData);

		bytes32 priceID = 0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b;
		// Read the current value of priceID, aborting the transaction if the price has not been updated recently.
		// Every chain has a default recency threshold which can be retrieved by calling the getValidTimePeriod() function on the contract.
		// Please see IPyth.sol for variants of this function that support configurable recency thresholds and other useful features.
		return pyth.getPrice(priceID);
	}
}
