// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IBalancerPool {
	function getSpotPrice(address tokenIn, address tokenOut) external view returns (uint256 spotPrice);

	function swapExactAmountOut(
		address tokenIn,
		uint256 maxAmountIn,
		address tokenOut,
		uint256 tokenAmountOut,
		uint256 maxPrice
	) external returns (uint256 tokenAmountIn, uint256 spotPriceAfter);
}
