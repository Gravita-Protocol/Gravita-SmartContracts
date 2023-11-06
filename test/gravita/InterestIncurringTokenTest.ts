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

const f = (v: any) => ethers.utils.formatEther(v.toString())
const bn = (v: any) => ethers.utils.parseEther(v.toString())

describe("InterestIncurringToken", async () => {
	let snapshotId: number, initialSnapshotId: number
	let alice: string, bob: string, carol: string, treasury: string
	let asset: any, token: any
	let interestRate, autoTransfer

	before(async () => {
		;[alice, bob, carol, treasury] = (await ethers.getSigners()).map(signer => signer.address)

		interestRate = 200 // 2%
		autoTransfer = 30 * 86_400 // 30 days timeout
		asset = await ERC20Mock.new("Mock ERC20", "MCK", 18)
		token = await InterestIncurringToken.new(
			asset.address,
			"InterestToken",
			"INTTKN",
			treasury,
			interestRate,
			autoTransfer
		)
		await token.initialize()

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

	it.only("deposit and withdraw happy path", async () => {
		const assetAmountAlice = bn(100_000)
		const assetAmountBob = bn(200_000)
		const assetAmountCarol = bn(300_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.mint(bob, assetAmountBob)
		await asset.mint(carol, assetAmountCarol)
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Carol's assets: ${f(await asset.balanceOf(carol))}`)
		console.log(`Approving...`)
		await asset.approve(token.address, MaxUint256, { from: alice })
		await asset.approve(token.address, MaxUint256, { from: bob })
		await asset.approve(token.address, MaxUint256, { from: carol })
		console.log(`Depositing...`)
		await token.deposit(assetAmountAlice, alice, { from: alice })
		await token.deposit(assetAmountBob, bob, { from: bob })
		await token.deposit(assetAmountCarol, carol, { from: carol })
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Alice's shares: ${f(await token.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Bob's shares: ${f(await token.balanceOf(bob))}`)
		console.log(`Carol's assets: ${f(await asset.balanceOf(carol))}`)
		console.log(`Carol's shares: ${f(await token.balanceOf(carol))}`)
		console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		console.log(`Collecting...`)
		await token.collectInterest()
		console.log(`Treasury's assets: ${f(await asset.balanceOf(treasury))}`)
		console.log(`Treasury's shares: ${f(await token.balanceOf(treasury))}`)
		console.log(`Withdrawing...`)
		await token.redeem(await token.balanceOf(alice), alice, alice, { from: alice })
		await token.redeem(await token.balanceOf(bob), bob, bob, { from: bob })
		await token.redeem(await token.balanceOf(carol), carol, carol, { from: carol })
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Alice's shares: ${f(await token.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Bob's shares: ${f(await token.balanceOf(bob))}`)
		console.log(`Carol's assets: ${f(await asset.balanceOf(carol))}`)
		console.log(`Carol's shares: ${f(await token.balanceOf(carol))}`)
	})

	it("50% interest rate, shares should reflect discounts", async () => {
		const assetAmountAlice = bn(100_000)
		const assetAmountBob = bn(100_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.mint(bob, assetAmountBob)
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Approving...`)
		await asset.approve(token.address, MaxUint256, { from: alice })
		await asset.approve(token.address, MaxUint256, { from: bob })
		console.log(`Setting interest rate to 50%`)
		await token.setInterestRate(5000)
		console.log(`Alice deposits...`)
		await token.deposit(assetAmountAlice, alice, { from: alice })
		console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		console.log(`Bob deposits...`)
		await token.deposit(assetAmountBob, bob, { from: bob })
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Alice's shares: ${f(await token.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Bob's shares: ${f(await token.balanceOf(bob))}`)
	})
})

it("transfer assets directly (without calling deposit/mint functions)", async () => {})

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}
