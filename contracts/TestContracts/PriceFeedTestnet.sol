// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../Interfaces/IPriceFeed.sol";

/*
 * PriceFeed placeholder for testnet and development. The price is simply set manually and saved in a state
 * variable. The contract does not connect to a live Chainlink price feed.
 */
contract PriceFeedTestnet is IPriceFeed {
	string public constant NAME = "PriceFeedTestnet";

	mapping(address => uint256) public prices;

	function getPrice(address _asset) external view returns (uint256) {
		return prices[_asset];
	}

	function setPrice(address _asset, uint256 _price) external {
		prices[_asset] = _price;
	}

	function setOracle(
		address _token,
		address _oracle,
		ProviderType _type,
		uint256 _timeoutMinutes,
		bool _isEthIndexed,
		bool _isFallback
	) external override {}

	function setSequencerUptimeFeed(address _sequencerUptimeFeed) external override {}

	function fetchPrice(address _asset) external view override returns (uint256) {
		return this.getPrice(_asset);
	}
}

