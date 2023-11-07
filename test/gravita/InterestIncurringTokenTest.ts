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
	const debug = true
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

	it("deposit and withdraw happy path", async () => {
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

	it.only("5% interest rate, shares should reflect discounts", async () => {
		const assetAmountAlice = bn(100_000)
		const assetAmountBob = bn(100_000)
		await asset.mint(alice, assetAmountAlice)
		await asset.mint(bob, assetAmountBob)
		debug && console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		debug && console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		debug && console.log(`Approving...`)
		await asset.approve(token.address, MaxUint256, { from: alice })
		await asset.approve(token.address, MaxUint256, { from: bob })
		debug && console.log(`Setting interest rate to 5%`)
		await token.setInterestRate(500)
		debug && console.log(`Alice deposits...`)
		await token.deposit(assetAmountAlice, alice, { from: alice })
		debug && console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		debug && console.log(`Bob deposits...`)
		await token.deposit(assetAmountBob, bob, { from: bob })
		const shareAmountBob = await token.balanceOf(bob)
		const assetsInVault = await token.totalAssets()
		const expectedAssetsInVault = bn(100_000 + 100_000 * .95)
		debug && console.log(`Vault's assets: ${f(assetsInVault)} (actual)`)
		debug && console.log(`Vault's assets: ${f(expectedAssetsInVault)} (expected)`)

		const ratioOverTotalBob = (100_000 / 100_000)
		const expectedShareAmountBob = bn(100_000 / 100_000)
		debug && console.log(`Alice's assets: ${f(await asset.balanceOf(alice))}`)
		debug && console.log(`Alice's shares: ${f(await token.balanceOf(alice))}`)
		debug && console.log(`Bob's assets: ${f(await asset.balanceOf(bob))}`)
		debug && console.log(`Bob's shares: ${f(shareAmountBob)} (actual)`)
		debug && console.log(`Bob's shares: ${f(expectedShareAmountBob)} (expected)`)
	})

	it("liquidated vessel: should credit all fees to platform", async () => {
		assert.equal(await debtToken.balanceOf(treasury), "0")

		// whale opens a vessel
		const { totalDebt: totalDebtWhale } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(20, 18)),
			extraParams: { from: whale },
		})
		const netDebtWhale = await th.getOpenVesselGRAIAmount(contracts.core, totalDebtWhale, erc20.address)
		const { minFee: minFeeWhale } = calcFees(netDebtWhale)
		const treasuryBalance1 = await debtToken.balanceOf(treasury)
		assert.equal(minFeeWhale.toString(), treasuryBalance1.toString())

		// alice opens another vessel
		const { totalDebt: totalDebtAlice } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(4, 18)),
			extraParams: { from: alice },
		})
		const netDebtAlice = await th.getOpenVesselGRAIAmount(contracts.core, totalDebtAlice, erc20.address)

		// alice increases debt, lowering her ICR to 1.11
		const targetICR = toBN("1111111111111111111")
		const { GRAIAmount: extraDebtAlice } = await withdrawGRAI({
			asset: erc20.address,
			ICR: targetICR,
			extraParams: { from: alice },
		})
		const { minFee: minFeeAlice, maxFee: maxFeeAlice } = calcFees(netDebtAlice.add(extraDebtAlice))
		const treasuryBalanceBeforeLiquidation = await debtToken.balanceOf(treasury)

		// treasury must have been paid both borrower's minFees
		th.assertIsApproximatelyEqual(
			minFeeWhale.add(minFeeAlice).toString(),
			treasuryBalanceBeforeLiquidation.toString(),
			100
		)

		// price drops to 1:$100, reducing Alice's ICR below MCR
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		// confirm system is not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// liquidate vessel
		await vesselManagerOperations.liquidate(erc20.address, alice, { from: bob })

		const treasuryBalanceAfterLiquidation = await debtToken.balanceOf(treasury)

		// check the vessel is successfully closed, and removed from sortedList
		const status_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX]

		// status enum 3 corresponds to "Closed by liquidation"
		assert.equal(status_Asset.toString(), "3")
		assert.isFalse(await sortedVessels.contains(erc20.address, alice))

		// treasury must now account for whale's minFee and alice's maxFee
		th.assertIsApproximatelyEqual(
			minFeeWhale.add(maxFeeAlice).toString(),
			treasuryBalanceAfterLiquidation.toString(),
			100
		)
	})
})

it("transfer assets directly (without calling deposit/mint functions)", async () => {})

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}
