import { artifacts, assert, ethers, network } from "hardhat"
import {
	setBalance,
	time,
	impersonateAccount,
	stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256, WeiPerEther } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const ERC20Mock = artifacts.require("ERC20Mock")
const InterestIncurringToken = artifacts.require("InterestIncurringToken")
const TokenizedVaultPriceAggregator = artifacts.require("TokenizedVaultPriceAggregator")
const MockAggregator = artifacts.require("MockAggregator")

const f = (v: any) => ethers.utils.formatEther(v.toString())
const bn = (v: any) => ethers.utils.parseEther(v.toString())

describe("TokenizedVaultPriceAggregator :: 18-decimal asset", async () => {
	let snapshotId: number, initialSnapshotId: number
	let alice: string, bob: string, carol: string, treasury: string
	let asset: any, token: any, assetPriceFeed: any, tokenPriceFeed: any
	const assetPrice = 2_000_0000_0000 // $2,000 (using mock feed's 8 digits)

	before(async () => {
		;[alice, bob, carol, treasury] = (await ethers.getSigners()).map(signer => signer.address)

		const interestRate = 500 // 5%
		asset = await ERC20Mock.new("Mock ERC20", "MCK", 18)
		token = await InterestIncurringToken.new(asset.address, "InterestToken", "INTTKN", treasury, interestRate)
		await token.initialize()
		assetPriceFeed = await MockAggregator.new()
		await assetPriceFeed.setPrice(assetPrice)
		tokenPriceFeed = await TokenizedVaultPriceAggregator.new(token.address, assetPriceFeed.address)

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

	it("empty vault price should be the asset price", async () => {
		let emptyVaultPrice = (await tokenPriceFeed.latestRoundData()).answer
		assert.equal(assetPrice.toString(), emptyVaultPrice.toString())
	})

	it("price should remain still after a deposit", async () => {
		const assetAmountAlice = bn(100_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.approve(token.address, MaxUint256, { from: alice })
		await token.deposit(assetAmountAlice, alice, { from: alice })
		let vaultPrice = (await tokenPriceFeed.latestRoundData()).answer
		assert.equal(assetPrice.toString(), vaultPrice.toString())
	})

	it("price should decrease after interest is accrued", async () => {
		const assetAmountAlice = bn(100_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.approve(token.address, MaxUint256, { from: alice })
		await token.deposit(assetAmountAlice, alice, { from: alice })
    // one year goes by
    await time.increase(365 * 86_400)
    // expect vault price to drop by 5%
		let vaultPrice = (await tokenPriceFeed.latestRoundData()).answer
    const expectedPrice = assetPrice * .95
		assert.equal(expectedPrice.toString(), vaultPrice.toString())
	})
})

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}