// https://vscode.blockscan.com/ethereum/0xff2097020e556648269377286b1b7fcf6987eede

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IPLimitOrderType {
	enum OrderType {
		SY_FOR_PT,
		PT_FOR_SY,
		SY_FOR_YT,
		YT_FOR_SY
	}

	// Fixed-size order part with core information
	struct StaticOrder {
		uint256 salt;
		uint256 expiry;
		uint256 nonce;
		OrderType orderType;
		address token;
		address YT;
		address maker;
		address receiver;
		uint256 makingAmount;
		uint256 lnImpliedRate;
		uint256 failSafeRate;
	}

	struct FillResults {
		uint256 totalMaking;
		uint256 totalTaking;
		uint256 totalFee;
		uint256 totalNotionalVolume;
		uint256[] netMakings;
		uint256[] netTakings;
		uint256[] netFees;
		uint256[] notionalVolumes;
	}
}

interface IPendleIPActionSwapYTV3 {
	struct SwapData {
		SwapType swapType;
		address extRouter;
		bytes extCalldata;
		bool needScale;
	}
	struct Order {
		uint256 salt;
		uint256 expiry;
		uint256 nonce;
		IPLimitOrderType.OrderType orderType;
		address token;
		address YT;
		address maker;
		address receiver;
		uint256 makingAmount;
		uint256 lnImpliedRate;
		uint256 failSafeRate;
		bytes permit;
	}

	struct FillOrderParams {
		Order order;
		bytes signature;
		uint256 makingAmount;
	}
	struct LimitOrderData {
		address limitRouter;
		uint256 epsSkipMarket; // only used for swap operations, will be ignored otherwise
		FillOrderParams[] normalFills;
		FillOrderParams[] flashFills;
		bytes optData;
	}

	enum SwapType {
		NONE,
		KYBERSWAP,
		ONE_INCH,
		// ETH_WETH not used in Aggregator
		ETH_WETH
	}
	struct TokenOutput {
		// Token/Sy data
		address tokenOut;
		uint256 minTokenOut;
		address tokenRedeemSy;
		// aggregator data
		address pendleSwap;
		SwapData swapData;
	}

	function swapExactYtForToken(
		address receiver,
		address market,
		uint256 exactYtIn,
		TokenOutput calldata output,
		LimitOrderData calldata limit
	) external returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm);
}
