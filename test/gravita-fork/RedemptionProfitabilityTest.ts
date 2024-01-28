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
const IRamsesSwapHelper = artifacts.require("IRamsesSwapHelper")

const f = (v: any) => Number(ethers.utils.formatEther(v.toString())).toFixed(5)
const bn = (s: string) => ethers.utils.parseEther(s)

interface RedemptionSetup {
	ethAmount: BigNumber
	redeemedAsset: string
	redemptionSoftening: number
	assetWethSwapPool: string | undefined
}
const setupCases: RedemptionSetup[] = [
	// wETH ----------------------------------------------------------
	{
		redemptionSoftening: 99_50,
		ethAmount: bn("1"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_50,
		ethAmount: bn("2"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_50,
		ethAmount: bn("3"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_60,
		ethAmount: bn("1"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_60,
		ethAmount: bn("2"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_60,
		ethAmount: bn("3"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_70,
		ethAmount: bn("1"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_70,
		ethAmount: bn("2"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	{
		redemptionSoftening: 99_70,
		ethAmount: bn("3"),
		redeemedAsset: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		assetWethSwapPool: undefined,
	},
	// wstETH --------------------------------------------------------
	{
		redemptionSoftening: 99_50,
		ethAmount: bn("1"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_50,
		ethAmount: bn("2"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_50,
		ethAmount: bn("3"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_60,
		ethAmount: bn("1"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_60,
		ethAmount: bn("2"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_60,
		ethAmount: bn("3"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_70,
		ethAmount: bn("1"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_70,
		ethAmount: bn("2"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
	{
		redemptionSoftening: 99_70,
		ethAmount: bn("3"),
		redeemedAsset: "0x5979D7b546E38E414F7E9822514be443A4800529",
		assetWethSwapPool: "0x2ed095289b2116d7a3399e278d603a4e4015b19d",
	},
]

let sortedVessels: any, vesselManagerOperations: any

contract("Redemption Profitability Test", async accounts => {
	const [redeemer] = accounts
	const provider = ethers.provider

	let adminContract: any, weth: any, priceFeed: any, swapHelper: any, grai: any

	before(async () => {
		swapHelper = await IRamsesSwapHelper.at("0xfd26c0df49a6e64247a5d12d67b7c3fe4ac319aa")
		weth = await WETH.at("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1")
		adminContract = await AdminContract.at("0x4928c8F8c20A1E3C295DddBe05095A9aBBdB3d14")
		grai = await GRAI.at(await adminContract.debtToken())
		priceFeed = await PriceFeed.at(await adminContract.priceFeed())
		sortedVessels = await SortedVessels.at(await adminContract.sortedVessels())
		vesselManagerOperations = await VesselManagerOperations.at(await adminContract.vesselManagerOperations())
	})

	it("Redemption using Ramses Pools", async () => {
		const ethPrice = await priceFeed.fetchPrice(ethers.constants.AddressZero)
		console.log(`[ETH] price: $${f(ethPrice)}`)

		for (const setup of setupCases) {
			const snapshotId = await network.provider.send("evm_snapshot")

			const ethBalanceBefore = BigNumber.from(await provider.getBalance(redeemer))

			const assetPrice = await priceFeed.fetchPrice(setup.redeemedAsset)
			const assetContract = await ERC20.at(setup.redeemedAsset)
			const assetSymbol = await assetContract.symbol()

			await _setRedemptionSoftening(setup.redemptionSoftening)

			const { graiAmount, graiPrice } = await _buyGrai(setup.ethAmount, ethPrice)

			await _redeem(setup.redeemedAsset, assetPrice, graiAmount)

			const graiLeft = await grai.balanceOf(redeemer)
			if (graiLeft.toString() != "0") {
				await _sellGrai(graiLeft)
			}

			if (setup.assetWethSwapPool) {
				await assetContract.approve(swapHelper.address, ethers.constants.MaxUint256)
				await swapHelper.swap(
					setup.assetWethSwapPool,
					setup.redeemedAsset,
					weth.address,
					true,
					await assetContract.balanceOf(redeemer)
				)
			}
			await weth.withdraw(await weth.balanceOf(redeemer))

			const ethBalanceAfter = BigNumber.from(await provider.getBalance(redeemer))
			const ethBalanceDiff = ethBalanceAfter.sub(ethBalanceBefore)
			const dollarDiff = BigNumber.from(ethPrice.toString()).mul(ethBalanceDiff).div(BigNumber.from((1e18).toString()))

			console.log(
				`Asset: [${assetSymbol}] Amount: [${f(setup.ethAmount)}] Softening: [${
					setup.redemptionSoftening
				}] GRAI Price: [${graiPrice}] --> Result: [${f(ethBalanceDiff)} ETH ($${f(dollarDiff)})]`
			)

			await network.provider.send("evm_revert", [snapshotId])
		}
	})

	async function _setRedemptionSoftening(redemptionSoftening: number) {
		const timelock = await adminContract.timelockAddress()
		await setBalance(timelock, bn("1"))
		await impersonateAccount(timelock)
		await vesselManagerOperations.setRedemptionSofteningParam(redemptionSoftening, { from: timelock })
		await stopImpersonatingAccount(timelock)
	}

	async function _buyGrai(
		ethAmount: BigNumber,
		ethPrice: BigNumber
	): Promise<{ graiAmount: BigNumber; graiPrice: FixedNumber }> {
		const ramsesPool_Grai_Weth = "0x8f0e6d286cee76f8866dfb2595d1c103fd7b13d8"
		const ethValue = _calcValue(ethAmount, ethPrice)
		await weth.deposit({ value: ethAmount.toString() })
		await weth.approve(swapHelper.address, ethers.constants.MaxUint256)
		await swapHelper.swap(ramsesPool_Grai_Weth, weth.address, grai.address, true, ethAmount)
		const graiAmount = await grai.balanceOf(redeemer)
		const graiPrice = FixedNumber.from(ethValue.toString()).divUnsafe(FixedNumber.from(graiAmount.toString()))
		return { graiAmount, graiPrice }
	}

	async function _sellGrai(graiAmount: BigNumber) {
		const ramsesPool_Grai_Weth = "0x8f0e6d286cee76f8866dfb2595d1c103fd7b13d8"
		await grai.approve(swapHelper.address, ethers.constants.MaxUint256)
		await swapHelper.swap(ramsesPool_Grai_Weth, grai.address, weth.address, false, graiAmount)
	}
})

function _calcValue(assetAmount: any, assetPrice: any) {
	const assetAmountBn = BigNumber.from(assetAmount.toString())
	const assetPriceBn = BigNumber.from(assetPrice.toString())
	const oneEthBn = BigNumber.from((1e18).toString())
	return assetAmountBn.mul(assetPriceBn).div(oneEthBn)
}

async function _redeem(assetAddress: string, assetPrice: BigNumber, graiAmount: BigNumber) {
	const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
		assetAddress,
		graiAmount,
		assetPrice,
		0
	)
	const { hintAddress } = await vesselManagerOperations.getApproxHint(assetAddress, partialRedemptionHintNewICR, 50, 0)
	const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
		assetAddress,
		partialRedemptionHintNewICR,
		hintAddress,
		hintAddress
	)
	await vesselManagerOperations.redeemCollateral(
		assetAddress,
		graiAmount,
		upperPartialRedemptionHint,
		lowerPartialRedemptionHint,
		firstRedemptionHint,
		partialRedemptionHintNewICR,
		0,
		"50000000000000000"
	)
}
