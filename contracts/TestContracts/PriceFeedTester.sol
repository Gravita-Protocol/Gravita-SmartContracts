// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../PriceFeed.sol";

contract PriceFeedTester is PriceFeed {
	function setPrice(address _asset, uint256 _price) external {
		priceRecords[_asset] = PriceRecord({ scaledPrice: _price, timestamp: block.timestamp });
	}
}
