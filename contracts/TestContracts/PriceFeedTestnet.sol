// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../Interfaces/IPriceFeed.sol";

/*
 * PriceFeed placeholder for testnet and development. The price is simply set manually and saved in a state
 * variable. The contract does not connect to a live Chainlink price feed.
 */
contract PriceFeedTestnet is IPriceFeed {

	string public constant NAME = "PriceFeedTestnet";
	bool public constant isInitialized = true;

	mapping(address => uint256) public lastGoodPrice;

	function getPrice(address _asset) external view returns (uint256) {
		return lastGoodPrice[_asset];
	}

	function setPrice(address _asset, uint256 _price) external {
		lastGoodPrice[_asset] = _price;
	}

	function addOracle(address _token, address _chainlinkOracle, bool _isEthIndexed) external override {}

	function deleteOracle(address _token) external override {}

	function deleteQueuedOracle(address _token) external override {}

	function fetchPrice(address _asset) external view override returns (uint256) {
		return this.getPrice(_asset);
	}
}
