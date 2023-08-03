import { artifacts, assert, ethers, network } from "hardhat"
import {
	setBalance,
	time,
	impersonateAccount,
	stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256, WeiPerEther } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const ICurvePool = artifacts.require("ICurvePool")
const IERC20 = artifacts.require("IERC20")
const AggregatorV3Interface = artifacts.require("AggregatorV3Interface")
const CurveLP2PriceAggregator = artifacts.require("CurveLP2PriceAggregator")

let lpPriceAggregator: any

let usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
let frax = "0x853d955acef822db058eb8505911ed77f175b99e"
let curvePool = "0xdcef968d416a41cdac0ed8702fac8128a64241a2" // FRAX-USDC
let curveToken = "0x3175df0976dfa876431c2e9ee6bc45b65d3473cc"
let curveGauge = "0xcfc25170633581bf896cb6cdee170e3e3aa59503"
let fraxUsdPriceFeed = "0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD" // FRAX:USD
let usdcUsdPriceFeed = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6" // USDC:USD

let snapshotId: number, initialSnapshotId: number
let alice: string, bob: string, whale: string, deployer: string, treasury: string

describe("ConvexStakingWrapper", async () => {
	before(async () => {
		const accounts = await ethers.getSigners()
		deployer = await accounts[0].getAddress()
		alice = await accounts[1].getAddress()
		await setBalance(deployer, 10e18)

		const delta = 2_00 // 2%
		const params = [delta, curvePool, fraxUsdPriceFeed, usdcUsdPriceFeed]
		lpPriceAggregator = await CurveLP2PriceAggregator.new(...params, { from: deployer })

		initialSnapshotId = await network.provider.send("evm_snapshot")
	})

	beforeEach(async () => {
		snapshotId = await network.provider.send("evm_snapshot")
	})

	afterEach(async () => {
		await network.provider.send("evm_revert", [snapshotId])
	})

	after(async () => {
		await network.provider.send("evm_revert", [initialSnapshotId])
	})

	it("latestRoundData()", async () => {
        // give alice 1,000 FRAX
		const fraxToken = await IERC20.at(frax)
		const fraxDecimals = 18
		const fraxWhale = "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2"
        const fraxAmount = String(1_000).concat("0".repeat(fraxDecimals))
		await setBalance(fraxWhale, 10e18)
		await impersonateAccount(fraxWhale)
		await fraxToken.transfer(alice, fraxAmount, { from: fraxWhale })
		await stopImpersonatingAccount(fraxWhale)
        // give alice 1,000 USDC
		const usdcToken = await IERC20.at(usdc)
		const usdcDecimals = 6
		const usdcWhale = "0xcEe284F754E854890e311e3280b767F80797180d"
        const usdcAmount = String(1_000).concat("0".repeat(usdcDecimals))
		await setBalance(usdcWhale, 10e18)
		await impersonateAccount(usdcWhale)
		await usdcToken.transfer(alice, usdcAmount, { from: usdcWhale })
		await stopImpersonatingAccount(usdcWhale)
        // evaluate alice's wallet
        const fraxUsdPrice = (await (await AggregatorV3Interface.at(fraxUsdPriceFeed)).latestRoundData()).answer
        const usdcUsdPrice = (await (await AggregatorV3Interface.at(usdcUsdPriceFeed)).latestRoundData()).answer
        const aliceFraxValue = 1_000 * fraxUsdPrice / 10 ** 8 // aggregator answer is 8 decimals
        const aliceUsdcValue = 1_000 * usdcUsdPrice / 10 ** 8 // aggregator answer is 8 decimals
        const aliceUsdValue = aliceFraxValue + aliceUsdcValue // ~$2,000
        // alice deposits both into the Curve pool
		const curvePoolContract = await ICurvePool.at(curvePool)
		const curveTokenContract = await IERC20.at(curveToken)
        await fraxToken.approve(curvePool, MaxUint256, { from: alice })
        await usdcToken.approve(curvePool, MaxUint256, { from: alice })
		await curvePoolContract.add_liquidity([fraxAmount, usdcAmount], 0, { from: alice })
        const aliceLPTokenBalance = (await curveTokenContract.balanceOf(alice)) / 10 ** 18
        // considering alice's ~$2,000 deposit and the LP tokens received, we can estimate how much each token is worth
        const lpEstimatedUsdValue = aliceLPTokenBalance / aliceUsdValue
        // compare agains the LP price feed
        const decimals = await lpPriceAggregator.decimals()
		const lpPriceFeedUsdValue = (await lpPriceAggregator.latestRoundData()).answer / 10 ** decimals
        assertIsApproximatelyEqual(lpEstimatedUsdValue, lpPriceFeedUsdValue, 0.01) // 1 cent error margin accepted
	})
})


function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}