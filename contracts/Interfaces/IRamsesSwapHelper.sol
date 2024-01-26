// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/**
 * @dev https://vscode.blockscan.com/arbitrum-one/0xfd26c0df49a6e64247a5d12d67b7c3fe4ac319aa
 */
interface IRamsesSwapHelper {
	function swap(address pool, address tokenIn, address tokenOut, bool zeroForOne, uint256 amountIn) external;
}

