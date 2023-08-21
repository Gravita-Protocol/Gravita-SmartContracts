import { artifacts, assert, ethers, network } from "hardhat"
import { setBalance, impersonateAccount, stopImpersonatingAccount } from "@nomicfoundation/hardhat-network-helpers"
import { MaxUint256 } from "@ethersproject/constants"

const IERC20 = artifacts.require("IERC20")
const AggregatorV3Interface = artifacts.require("AggregatorV3Interface")
const MaverickBPTPriceAggregator = artifacts.require("MaverickBPTPriceAggregator")

let lpPriceAggregator: any

let bpToken = "0xa2b4e72a9d2d3252da335cb50e393f44a9f104ee" // Maverick Position-wstETH-WETH-0
let poolInformation = "0x0087D11551437c3964Dddf0F4FA58836c5C5d949"

const tokens = [
	{
		address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", // wstETH
		decimals: 18,
		oracle: "0xCA68ad4EE5c96871EC6C6dac2F714a8437A3Fe66", // Gravita/Chainlink wstETH:USD
		piggyBank: "0x248cCBf4864221fC0E840F29BB042ad5bFC89B5c",
	},
	{
		address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // wETH
		decimals: 18,
		oracle: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // Chainlink wETH:USD
		piggyBank: "0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E",
	},
]
let snapshotId: number, initialSnapshotId: number
let deployer: string, alice: string

const f = (v: any) => ethers.utils.formatEther(v.toString())

describe("MaverickBPTPriceAggregator", async () => {
	before(async () => {
		const accounts = await ethers.getSigners()
		deployer = await accounts[0].getAddress()
		alice = await accounts[1].getAddress()
		await setBalance(deployer, 10e18)

		const params = [bpToken, poolInformation, tokens[0].oracle]
		lpPriceAggregator = await MaverickBPTPriceAggregator.new(...params, { from: deployer })

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
		const amount = 100
		const amountEther = ethers.utils.parseEther(String(amount))
		let aliceUsdWalletValue = 0
		for (const t of tokens) {
			// give alice 100 of each (wstETH & wETH)
			const token = await IERC20.at(t.address)
			await setBalance(t.piggyBank, 10e18)
			await impersonateAccount(t.piggyBank)
			await token.transfer(alice, amountEther, { from: t.piggyBank })
			await stopImpersonatingAccount(t.piggyBank)
			const tokenPrice = (await (await AggregatorV3Interface.at(t.oracle)).latestRoundData()).answer
			const aliceUsdTokenValue = (amount * tokenPrice) / 10 ** 8 // aggregator answer is 8 decimals
			aliceUsdWalletValue += aliceUsdTokenValue
			console.log(`aliceUsdTokenValue: ${aliceUsdTokenValue}`)
			// await token.approve(curvePool, MaxUint256, { from: alice })
		}
		console.log(`aliceUsdWalletValue: ${aliceUsdWalletValue}`)
		const bptUsdPrice = (await lpPriceAggregator.latestRoundData()).answer
		console.log(`BPTPrice: ${bptUsdPrice}`)
		// // alice deposits both into the Curve pool
		// const curvePoolContract = await ICurvePool.at(curvePool)
		// const curveTokenContract = await IERC20.at(curveToken)
		// await fraxToken.approve(curvePool, MaxUint256, { from: alice })
		// await usdcToken.approve(curvePool, MaxUint256, { from: alice })
		// await curvePoolContract.add_liquidity([fraxAmount, usdcAmount], 0, { from: alice })
		// const aliceLPTokenBalance = (await curveTokenContract.balanceOf(alice)) / 10 ** 18
		// // considering alice's ~$2,000 deposit and the LP tokens received, we can estimate how much each token is worth
		// const lpEstimatedUsdValue = aliceLPTokenBalance / aliceUsdValue
		// // compare agains the LP price feed
		// const decimals = await lpPriceAggregator.decimals()
		// const lpPriceFeedUsdValue = (await lpPriceAggregator.latestRoundData()).answer / 10 ** decimals
		// assertIsApproximatelyEqual(lpEstimatedUsdValue, lpPriceFeedUsdValue, 0.01) // 1 cent error margin accepted
	})
})

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}

