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

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper

const f = (v: any) => ethers.utils.formatEther(v.toString())
const bn = (v: any) => ethers.utils.parseEther(v.toString())

let feeCollector: any

const deploy = async (treasury: string, mintingAccounts: string[]) => {
	let contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)
	feeCollector = contracts.core.feeCollector
}

describe("TokenizedVaultPriceAggregator :: 18-decimal asset", async () => {
	let snapshotId: number, initialSnapshotId: number
	let alice: string, bob: string, carol: string, treasury: string
	let asset: any, vault: any, assetPriceFeed: any, vaultPriceFeed: any
	const autoTransfer = 0 // never
	const assetPrice = 2_000_0000_0000 // $2,000 (using mock feed's 8 digits)

	before(async () => {
		;[alice, bob, carol, treasury] = (await ethers.getSigners()).map(signer => signer.address)

		await deploy(treasury, [])

		const interestRate = 500 // 5%
		asset = await ERC20Mock.new("Mock ERC20", "MCK", 18)

		vault = await InterestIncurringToken.new(
			asset.address,
			"InterestToken",
			"INTTKN",
			feeCollector.address,
			interestRate,
			autoTransfer
		)
		await vault.initialize()
		assetPriceFeed = await MockAggregator.new()
		await assetPriceFeed.setPrice(assetPrice)
		vaultPriceFeed = await TokenizedVaultPriceAggregator.new(vault.address, assetPriceFeed.address)

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
		let emptyVaultPrice = (await vaultPriceFeed.latestRoundData()).answer
		assert.equal(assetPrice.toString(), emptyVaultPrice.toString())
	})

	it("price should remain still after a deposit", async () => {
		const assetAmountAlice = bn(100_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		let vaultPrice = (await vaultPriceFeed.latestRoundData()).answer
		assert.equal(assetPrice.toString(), vaultPrice.toString())
	})

	it("price should decrease after interest is accrued", async () => {
		const assetAmountAlice = bn(100_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		// one year goes by
		await time.increase(365 * 86_400)
		// expect vault price to drop by 5%
		let vaultPrice = (await vaultPriceFeed.latestRoundData()).answer
		const expectedPrice = assetPrice * 0.95
		assert.equal(expectedPrice.toString(), vaultPrice.toString())
	})

	it("transfer assets directly (without calling deposit/mint functions)", async () => {
		// TODO
	})
})

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}
