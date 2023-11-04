// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../Dependencies/External/OpenZeppelin5/ERC4626.sol";

import "hardhat/console.sol";

/**
 * @notice
 * @dev Assumes that the underlying asset of the vault uses 18 digits, as is the case with all Gravita's collateral.
 */
contract TokenizedVaultPriceAggregator is AggregatorV3Interface {
	error NotImplementedException();

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Constants
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	IERC4626 public immutable erc4626Vault;
	AggregatorV3Interface public immutable vaultAssetPriceFeed;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Constructor
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	constructor(address _erc4626VaultAddress, address _vaultAssetPriceFeedAddress) {
		require(_erc4626VaultAddress != address(0), "ERC4626 address cannot be zero");
		require(_vaultAssetPriceFeedAddress != address(0), "Asset Price Feed address cannot be zero");
		erc4626Vault = IERC4626(_erc4626VaultAddress);
		vaultAssetPriceFeed = AggregatorV3Interface(_vaultAssetPriceFeedAddress);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// AggregatorV3Interface functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function decimals() public view override returns (uint8) {
		return vaultAssetPriceFeed.decimals();
	}

	function description() external pure override returns (string memory) {
		return "TokenizedVaultPriceAggregator";
	}

	function latestRoundData()
		external
		view
		override
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
	{
		(roundId, answer, startedAt, updatedAt, answeredInRound) = vaultAssetPriceFeed.latestRoundData();
		require(answer > 0, "asset value cannot be zero");

		uint256 shares = erc4626Vault.totalSupply();
		// In case of an empty vault, just return the asset value; else, apply ratio asset/share
		if (shares > 0) {
			uint256 assets = erc4626Vault.totalAssets();
			uint256 ratio = Math.mulDiv(assets, 1 ether, shares);
			answer = int256(Math.mulDiv(uint256(answer), ratio, 1 ether));
			console.log("assets: %s", assets);
			console.log("shares: %s", shares);
			console.log("ratio: %s", ratio);
			console.log("answer: %s", uint256(answer));
		}
	}

	function getRoundData(
		uint80 // roundId
	)
		external
		pure
		virtual
		override
		returns (
			uint80, // roundId,
			int256, // answer,
			uint256, // startedAt,
			uint256, // updatedAt,
			uint80 // answeredInRound
		)
	{
		// We cannot provide a reliable response because the history of the vault's asset/share ratio
		// is not stored on-chain.
		revert NotImplementedException();
	}

	function version() external pure override returns (uint256) {
		return 1;
	}
}
