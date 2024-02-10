import { BigNumber, FixedNumber } from "ethers"
import { artifacts, assert, contract, ethers, network, upgrades } from "hardhat"

const {
	setBalance,
	time,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")

/**
 *  Configure hardhat.config.ts for an Arbitrum fork before running:
  
		hardhat: {
			accounts: accountsList,
			chainId: 42161,
			forking: {
				url: `https://arb-mainnet.g.alchemy.com/v2/[API-KEY]`,
				blockNumber: 174133000,
			},
		},
 */

const AdminContract = artifacts.require("AdminContract")
const PriceFeed = artifacts.require("PriceFeed")
const SortedVessels = artifacts.require("SortedVessels")
const VesselManagerOperations = artifacts.require("VesselManagerOperations")

const ERC20 = artifacts.require("ERC20")
const GRAI = artifacts.require("DebtToken")
const WETH = artifacts.require("IWETH")

const IUniswapSwapRouter = artifacts.require("IUniswapSwapRouter")
const IPendleIPActionSwapYTV3 = artifacts.require("IPendleIPActionSwapYTV3")

const redemptionSoftening = 99_75
const weETH = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"

const f = (v: any) => Number(ethers.utils.formatEther(v.toString())).toFixed(5)
const bn = (s: string) => ethers.utils.parseEther(s)

let sortedVessels: any, vesselManagerOperations: any
const debug = false

contract("Redemption Profitability Test", async accounts => {
	const [redeemer] = accounts
	const provider = ethers.provider

	let adminContract: any, priceFeed: any, grai: any
	let assetContract: any, assetPrice: any, assetSymbol: string
	let usdc: any
	let swapRouter: any
	let usdcBalanceBefore: BigNumber, ethBalanceBefore: BigNumber

	before(async () => {
		usdc = await ERC20.at("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
		adminContract = await AdminContract.at("0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53")
		grai = await GRAI.at(await adminContract.debtToken())
		priceFeed = await PriceFeed.at(await adminContract.priceFeed())
		sortedVessels = await SortedVessels.at(await adminContract.sortedVessels())
		vesselManagerOperations = await VesselManagerOperations.at(await adminContract.vesselManagerOperations())
		swapRouter = await IUniswapSwapRouter.at("0xE592427A0AEce92De3Edee1F18E0157C05861564")
		await _acquireUSDC()
		assetPrice = await priceFeed.fetchPrice(weETH)
		assetContract = await ERC20.at(weETH)
		assetSymbol = await assetContract.symbol()
	})

	it("Redemption buying GRAI from Uniswap", async () => {
		const ethPrice = await priceFeed.fetchPrice(ethers.constants.AddressZero)
		console.log(`[ETH] price: $${f(ethPrice)}`)
		console.log(`[${assetSymbol}] price: $${f(assetPrice)}`)
		console.log(`[GAS] price: ${Number(await provider.getGasPrice()) / 10 ** 9} gwei`)

		for (var inputUsdcAmount = 2_500; inputUsdcAmount <= 50_000; inputUsdcAmount += 2_500) {
			const snapshotId = await network.provider.send("evm_snapshot")

			ethBalanceBefore = BigNumber.from(await provider.getBalance(redeemer))
			usdcBalanceBefore = BigNumber.from(String(await usdc.balanceOf(redeemer)))

			// await _setRedemptionSoftening()

			try {
				const { graiAmount, graiPrice } = await _buyGrai(inputUsdcAmount)
				await _redeem(assetContract.address, assetPrice, graiAmount)
				const graiLeft = await grai.balanceOf(redeemer)
				if (graiLeft.toString() != "0") {
					await _sellGrai(graiLeft)
				}
				// await _sellRedeemedAsset(assetContract)
				await _printResults(inputUsdcAmount, ethPrice, graiAmount, graiPrice)
			} catch (e) {
				console.log(`FAILED for inputUsdcAmount = ${inputUsdcAmount}`)
			}

			await network.provider.send("evm_revert", [snapshotId])
		}
	})

	// ------------------------------------------------------------------------------------------------------------------
	async function _acquireUSDC() {
		const usdcAmount = 100_000_000_000 // $100k (6 digits)
		const usdcWhale = "0xD6153F5af5679a75cC85D8974463545181f48772"
		await setBalance(usdcWhale, bn("10"))
		await impersonateAccount(usdcWhale)
		await usdc.transfer(redeemer, usdcAmount, { from: usdcWhale })
		await stopImpersonatingAccount(usdcWhale)
	}

	// ------------------------------------------------------------------------------------------------------------------
	async function _setRedemptionSoftening() {
		const timelock = await adminContract.timelockAddress()
		await setBalance(timelock, bn("10"))
		await impersonateAccount(timelock)
		await vesselManagerOperations.setRedemptionSofteningParam(redemptionSoftening, { from: timelock })
		await stopImpersonatingAccount(timelock)
	}

	// ------------------------------------------------------------------------------------------------------------------
	async function _buyGrai(usdcAmount: number): Promise<{ graiAmount: BigNumber; graiPrice: string }> {
		await usdc.approve(swapRouter.address, ethers.constants.MaxUint256)

		const swapParams = [
			usdc.address, // tokenIn
			grai.address, // tokenOut
			500, // fee
			redeemer, // recipient
			(await _getBlockTimestamp()) + 10, // deadline
			usdcAmount * 10 ** 6, // amountIn (usdc is 6 digits)
			0, // amountOutMinimum
			0, // sqrtPriceLimitX96
		]

		debug && console.log(`_buyGrai() :: swapRouter.exactInputSingle()...`)
		await swapRouter.exactInputSingle(swapParams)

		const graiAmount = await grai.balanceOf(redeemer)
		let graiPrice: any = FixedNumber.from(bn(usdcAmount.toString()).toString()).divUnsafe(
			FixedNumber.from(graiAmount.toString())
		)
		graiPrice = Number(graiPrice).toFixed(5)

		debug && console.log(`_buyGrai() :: graiAmount: ${f(graiAmount)} graiPrice: $${graiPrice}`)
		return { graiAmount, graiPrice }
	}

	// ------------------------------------------------------------------------------------------------------------------
	async function _sellGrai(graiAmount: BigNumber) {
		await grai.approve(swapRouter.address, ethers.constants.MaxUint256)
		const swapParams = [
			grai.address, // tokenIn
			usdc.address, // tokenOut
			500, // fee
			redeemer, // recipient
			(await _getBlockTimestamp()) + 10, // deadline
			graiAmount, // amountIn
			0, // amountOutMinimum
			0, // sqrtPriceLimitX96
		]
		debug && console.log(`_sellGrai() :: swapRouter.exactInputSingle()...`)
		await swapRouter.exactInputSingle(swapParams)
	}

	// ------------------------------------------------------------------------------------------------------------------
	async function _sellRedeemedAsset(assetContract: any) {
		console.log(`_sellRedeemedAsset()...`)
		const pendle = await IPendleIPActionSwapYTV3.at("0xff2097020e556648269377286b1b7fcf6987eede")
		await assetContract.approve(pendle.address, ethers.constants.MaxUint256)
		const amountIn = await assetContract.balanceOf(redeemer)
		await pendle.swapExactYtForToken(
			redeemer, // receiver
			"0xF32e58F92e60f4b0A37A69b95d642A471365EAe8", // market
			amountIn, // exactYtIn
			[
				"0x0000000000000000000000000000000000000000", // output.tokenOut
				"0", // output.minTokenOut
				"0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", // output.tokenRedeemSy
				"0x1f5B1f22585f430C3a1a7D16e1E1100945965e35", // output.pendleSwap
				[
					"1", // output.swapData.swapType = KYBER
					"0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // output.swapData.extRouter
					"0xe21fd0e90000000000000000000000000000000000000000000000000000000000000020000000000000000000000000f081470f5c6fbccf48cc4e5b82dd926409dcdd67000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000036000000000000000000000000000000000000000000000000000000000000005a000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000005bbb0ef59571e58418f9a4357b68a0000000000000000000000000000000000000000000000000000000007fffffff0000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000408cc7a56b0000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8b9debddf1d894c79d2b2d09f819ff9b856fca55200000000000000000000062a000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000013d2a5b50afd67b0000000000000000000000000000000000000000000000000000000000000020000000000000000000000015645dd95b000000000000000001466ab905db7878000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000005bbb0ef59571e58418f9a4357b68a0000000000000000000000000000000000000000000000000013d2a5b50afd67b0000000000000000000000000000000000000000000000000144c8e8bcde3696000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f081470f5c6fbccf48cc4e5b82dd926409dcdd670000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000013d2a5b50afd67b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f17b22536f75726365223a22222c22416d6f756e74496e555344223a223231322e3739363531363636323932333332222c22416d6f756e744f7574555344223a223231332e3739323931303036333436313837222c22526566657272616c223a22222c22466c616773223a312c22496e74656772697479496e666f223a7b224b65794944223a2231222c225369676e6174757265223a22506b692b3063714430633376393256594b37372b766a41526a62365843717078324b4b584a52446b6d6877654b4569735a7255626368322f4b6831787346544f777135365a61426d6462664f615a62686177767a5255567a376c304d34726c637535466e4e4a502b32494a346e494f515531677453397855715368724b4b3654555347525032545850724a4659664578535051705179664e5558374c537158776b4a41673332627831444941526e347962376453334f2f532b4843634e46464d31514378376f5352653638575732734e76726a567230537851473568536575416c7671695176354b415535577a4957466238775542427976415847663563505634524d787a462f756430697a2f4a4d79303949414d434b53513248515939347a634c786945484152587564373073784e794573766a57326b2b4266544964313738355671553450714c653674342f6b577962677041513d3d227d7d000000000000000000000000000000",
					true,
				], // output.swapData
			], // output
			[
				"0x0000000000000000000000000000000000000000", // limit.limitRouter
				0, // limit.epsSkipMarket
				[], // limit.normalFills
				[], // limit.flashFills
				"0x", // limit.optData
			] // limit
		)
	}

	async function _printResults(inputUsdcAmount: number, ethPrice: BigNumber, graiAmount: BigNumber, graiPrice: string) {
		const usdcBalanceAfter = BigNumber.from(String(await usdc.balanceOf(redeemer)))
		const usdcBalanceDiff = usdcBalanceAfter.sub(usdcBalanceBefore)
		const ethBalanceAfter = BigNumber.from(await provider.getBalance(redeemer))
		const ethBalanceDiff = ethBalanceAfter.sub(ethBalanceBefore)
		const ethDollarDiff = BigNumber.from(ethPrice.toString()).mul(ethBalanceDiff).div(BigNumber.from((1e18).toString()))
		const weethBalance = BigNumber.from(String(await assetContract.balanceOf(redeemer)))
		const weethDollarVal = BigNumber.from(assetPrice.toString())
			.mul(weethBalance)
			.div(BigNumber.from((1e18).toString()))

		const finalResult = Number(usdcBalanceDiff) / 10 ** 6 + Number(f(ethDollarDiff)) + Number(f(weethDollarVal))

		console.log(
			`Asset: [${assetSymbol}] Input: [$${inputUsdcAmount} USDC] Softn: [${redemptionSoftening}] GRAI: [${f(
				graiAmount
			)} at $${graiPrice}] -> Balances: [${Number(usdcBalanceDiff) / 10 ** 6} USDC | ${f(ethBalanceDiff)} ETH ($${f(
				ethDollarDiff
			)}) | ${f(weethBalance)} weETH ($${f(weethDollarVal)})] -> Result: [$${finalResult.toFixed(2)}]`
		)
	}
})

async function _getBlockTimestamp() {
	const currentBlock = await ethers.provider.getBlockNumber()
	return Number((await ethers.provider.getBlock(currentBlock)).timestamp)
}

function _calcValue(assetAmount: any, assetPrice: any) {
	const assetAmountBn = BigNumber.from(assetAmount.toString())
	const assetPriceBn = BigNumber.from(assetPrice.toString())
	const oneEthBn = BigNumber.from((1e18).toString())
	return assetAmountBn.mul(assetPriceBn).div(oneEthBn)
}

async function _redeem(assetAddress: string, assetPrice: BigNumber, graiAmount: BigNumber) {
	debug && console.log(`_redeem() :: getRedemptionHints()...`)
	const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
		assetAddress,
		graiAmount,
		assetPrice,
		0
	)
	debug && console.log(`_redeem() :: getApproxHint()...`)
	const { hintAddress } = await vesselManagerOperations.getApproxHint(assetAddress, partialRedemptionHintNewICR, 50, 0)
	const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
		assetAddress,
		partialRedemptionHintNewICR,
		hintAddress,
		hintAddress
	)
	debug && console.log(`_redeem() :: redeemCollateral()...`)
	await vesselManagerOperations.redeemCollateral(
		assetAddress,
		graiAmount,
		upperPartialRedemptionHint,
		lowerPartialRedemptionHint,
		firstRedemptionHint,
		partialRedemptionHintNewICR,
		0,
		"10000000000000000"
	)
}
