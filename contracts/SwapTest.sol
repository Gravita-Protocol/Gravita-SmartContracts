// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract SwapTest {
	// For the scope of these swap examples,
	// we will detail the design considerations when using
	// `exactInput`, `exactInputSingle`, `exactOutput`, and  `exactOutputSingle`.

	// It should be noted that for the sake of these examples, we purposefully pass in the swap router instead of inherit the swap router for simplicity.
	// More advanced example contracts will detail how to inherit the swap router safely.

	ISwapRouter public immutable swapRouter;

	// This example swaps DAI/WETH9 for single path swaps and DAI/USDC/WETH9 for multi path swaps.

	address public constant GRAI = 0x15f74458aE0bFdAA1a96CA1aa779D715Cc1Eefe4;

	// For this example, we will set the pool fee to 0.5%.
	uint24 public constant poolFee = 5000;

	constructor(ISwapRouter _swapRouter) {
		swapRouter = _swapRouter;
	}

	/// @notice swapExactOutputSingle swaps a minimum possible amount of `asset` for a fixed amount of GRAI.
	/// @dev The calling address must approve this contract to spend its `asset` for this function to succeed. As the amount of input `asset` is variable,
	/// the calling address will need to approve for a slightly higher amount, anticipating some variance.
	/// @param amountOut The exact amount of GRAI to receive from the swap.
	/// @param amountInMaximum The amount of `asset` we are willing to spend to receive the specified amount of GRAI.
	/// @return amountIn The amount of `asset` actually spent in the swap.
	function swapExactOutputSingle(address asset, uint256 amountOut, uint256 amountInMaximum) external returns (uint256 amountIn) {
		// Transfer the specified amount of `asset` to this contract.
		TransferHelper.safeTransferFrom(asset, msg.sender, address(this), amountInMaximum);

		// Approve the router to spend the specifed `amountInMaximum` of `asset`.
		// In production, you should choose the maximum amount to spend based on oracles or other data sources to acheive a better swap.
		TransferHelper.safeApprove(asset, address(swapRouter), amountInMaximum);

		ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams({
			tokenIn: asset,
			tokenOut: GRAI,
			fee: poolFee,
			recipient: msg.sender,
			deadline: block.timestamp,
			amountOut: amountOut,
			amountInMaximum: amountInMaximum,
			sqrtPriceLimitX96: 0
		});

		// Executes the swap returning the amountIn needed to spend to receive the desired amountOut.
		amountIn = swapRouter.exactOutputSingle(params);

		// For exact output swaps, the amountInMaximum may not have all been spent.
		// If the actual amount spent (amountIn) is less than the specified maximum amount, we must refund the msg.sender and approve the swapRouter to spend 0.
		if (amountIn < amountInMaximum) {
			TransferHelper.safeApprove(asset, address(swapRouter), 0);
			TransferHelper.safeTransfer(asset, msg.sender, amountInMaximum - amountIn);
		}
	}
}
