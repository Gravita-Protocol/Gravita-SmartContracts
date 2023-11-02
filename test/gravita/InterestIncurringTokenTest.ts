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
	let alice: string, bob: string, whale: string, deployer: string, treasury: string
	let asset: any, token: any
	let interestRate

	before(async () => {
		;([alice, bob, whale, treasury] = (await ethers.getSigners()).map(signer => signer.address))

		interestRate = 200 // 2%
		asset = await ERC20Mock.new("Mock ERC20", "MCK", 18)
		token = await InterestIncurringToken.new(asset.address, "InterestToken", "INTTKN", treasury, interestRate)

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

	it("depositAndWithdraw()", async () => {
		const assetAmountAlice = bn(100_000)
		const assetAmountBob = bn(200_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.mint(bob, assetAmountBob)
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		await asset.approve(token.address, MaxUint256, { from: alice })
		await asset.approve(token.address, MaxUint256, { from: bob })
		console.log(`Depositing...`)
		await token.depositAssets(assetAmountAlice, { from: alice })
		await token.depositAssets(assetAmountBob, { from: bob })
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Alice's shares: ${f(await token.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Bob's shares: ${f(await token.balanceOf(bob))}`)
		console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		console.log(`Collecting...`)
		await token.collectInterest()
		console.log(`Treasury's assets: ${f(await asset.balanceOf(treasury))}`)
		console.log(`Treasury's shares: ${f(await token.balanceOf(treasury))}`)
		console.log(`Withdrawing...`)
		await token.withdrawShares(await token.balanceOf(alice), { from: alice })
		await token.withdrawShares(await token.balanceOf(bob), { from: bob })
		console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		console.log(`Alice's shares: ${f(await token.balanceOf(alice))}`)
		console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		console.log(`Bob's shares: ${f(await token.balanceOf(bob))}`)
	})
})

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}
