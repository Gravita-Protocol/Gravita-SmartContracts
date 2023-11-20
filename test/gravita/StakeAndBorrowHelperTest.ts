import { artifacts, assert, contract, ethers, network } from "hardhat"
import { time } from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256 } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper

const InterestIncurringToken = artifacts.require("InterestIncurringToken")
const StakeAndBorrowHelper = artifacts.require("StakeAndBorrowHelper")

const f = (v: any) => ethers.utils.commify(ethers.utils.formatEther(v.toString()))
const bn = (v: any) => ethers.utils.parseEther(v.toString())

const debug = false

let contracts: any,
	adminContract: any,
	borrowerOperations: any,
	debtToken: any,
	erc20: any,
	feeCollector: any,
	priceFeed: any,
	sortedVessels: any,
	stabilityPool: any,
	vesselManager: any,
	vesselManagerOperations: any

const deploy = async (treasury: string, mintingAccounts: string[]) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	debtToken = contracts.core.debtToken
	erc20 = contracts.core.erc20
	feeCollector = contracts.core.feeCollector
	priceFeed = contracts.core.priceFeedTestnet
	sortedVessels = contracts.core.sortedVessels
	stabilityPool = contracts.core.stabilityPool
	vesselManager = contracts.core.vesselManager
	vesselManagerOperations = contracts.core.vesselManagerOperations
}

contract("StakeAndBorrowHelper", async accounts => {
	let snapshotId: number, initialSnapshotId: number
	const [treasury, alice, bob, carol, whale] = accounts
	let vault: any, stakeAndBorrowHelper: any
	let interestRate, autoTransfer

	before(async () => {
		await deploy(treasury, [])

		interestRate = 200 // 2%
		autoTransfer = 30 * 86_400 // 30 days timeout

		vault = await InterestIncurringToken.new(
			erc20.address,
			"InterestToken",
			"INTTKN",
			feeCollector.address,
			interestRate,
			autoTransfer
		)
		await vault.initialize()
		await adminContract.addNewCollateral(vault.address, bn(200), 18)
		await adminContract.setIsActive(vault.address, true)

		stakeAndBorrowHelper = await StakeAndBorrowHelper.new(borrowerOperations.address)
		await stakeAndBorrowHelper.initialize()
    await stakeAndBorrowHelper.registerStakingVault(erc20.address, vault.address)

		await borrowerOperations.registerHelper(stakeAndBorrowHelper.address, true)
		
    await priceFeed.setPrice(erc20.address, bn(2_000))
    await priceFeed.setPrice(vault.address, bn(2_000))

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

	it.only("openVessel via StakeAndBorrowHelper should deposit into vault and create a vessel with the shares", async () => {

		// alice obtains assets to be used as collateral
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)
    
		// alice approves transfer of her assets
    await erc20.approve(stakeAndBorrowHelper.address, MaxUint256, { from: alice })
    await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })

		const collValueAlice = bnMulDiv(assetAmountAlice, await priceFeed.getPrice(vault.address), 1e18)		
    const loanAmountAlice = bnMulDec(collValueAlice, 0.5) // 50% LTV

		await stakeAndBorrowHelper.openVessel(erc20.address, assetAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

    // all alice's assets should be gone (and used as collateral)
    assert.equal("0", await erc20.balanceOf(alice))
    assert.equal("0", await vault.balanceOf(alice))
    assert.equal(loanAmountAlice.toString(), await debtToken.balanceOf(alice))
	})

	it("adjusting and closing vessel should return unwrapped collateral to borrower", async () => {
		await priceFeed.setPrice(vault.address, bn(2_000))
		debug && console.log(`Setting interest rate to 4%`)
		await vault.setInterestRate(400)
		// whale opens a vessel
		const assetAmountWhale = bn(10_000)
		await erc20.mint(whale, assetAmountWhale)
		await erc20.approve(vault.address, MaxUint256, { from: whale })
		await vault.deposit(assetAmountWhale, whale, { from: whale })
		const vaultAmountwhale = await vault.balanceOf(whale)
		await vault.approve(borrowerOperations.address, MaxUint256, { from: whale })
		const loanAmountWhale = bn(200_000)
		await borrowerOperations.openVessel(vault.address, vaultAmountwhale, loanAmountWhale, AddressZero, AddressZero, {
			from: whale,
		})

		// alice opens a vessel
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		const vaultAmountAlice = await vault.balanceOf(alice)
		const collValueAlice = bnMulDiv(vaultAmountAlice, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountAlice = bnMulDec(collValueAlice, 0.8) // 80% LTV
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		debug && console.log(`[alice] opens vessel, borrowing $${f(loanAmountAlice)} GRAI...`)
		await borrowerOperations.openVessel(vault.address, vaultAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

		// half a year goes by
		await time.increase(182.5 * 86_400)

		// alice adjusts her vessel, withdrawing 50% of her collateral
		const collWithdrawAmount = bnMulDec(vaultAmountAlice, 0.5)
		const debtTokenChange = bnMulDec(loanAmountAlice, 0.5)
		assert.equal("0", await erc20.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(alice))
		debug && console.log(`[alice] adjusts vessel (50% payback + 50% coll withdraw)...`)
		await borrowerOperations.adjustVessel(
			vault.address,
			0,
			collWithdrawAmount,
			debtTokenChange,
			false,
			AddressZero,
			AddressZero,
			{
				from: alice,
			}
		)
		const assetBalanceAlice1 = await erc20.balanceOf(alice)
		const expectedAssetBalanceAlice1 = bnMulDec(assetAmountAlice, 0.5 * 0.98) // discount for 2% interest
		debug && console.log(`[alice] assets: ${f(assetBalanceAlice1)} (actual)`)
		debug && console.log(`[alice] assets: ${f(expectedAssetBalanceAlice1)} (expected)`)
		assert.equal("0", await vault.balanceOf(alice))
		assertIsApproximatelyEqual(assetBalanceAlice1, expectedAssetBalanceAlice1)

		// another half of a year goes by
		await time.increase(182.5 * 86_400)

		// alice closes her vessel
		const borrowingFeeAlice = bnMulDec(loanAmountAlice, 0.005)
		await debtToken.transfer(alice, borrowingFeeAlice, { from: whale }) // whale kindly transfers change for borrowing fee
		debug && console.log(`[alice] closes vessel...`)
		await borrowerOperations.closeVessel(vault.address, { from: alice })
		assert.equal("0", await vault.balanceOf(alice))
		const assetBalanceAlice2 = await erc20.balanceOf(alice)
		const expectedAssetBalanceAlice2 = bnMulDec(assetAmountAlice, 0.5 * 0.98).add(
			bnMulDec(assetAmountAlice, 0.5 * 0.96)
		) // half @ 2% + half @ 4%
		debug && console.log(`[alice] assets: ${f(assetBalanceAlice2)} (actual)`)
		debug && console.log(`[alice] assets: ${f(expectedAssetBalanceAlice2)} (expected)`)
		assert.equal("0", await vault.balanceOf(alice))
		assertIsApproximatelyEqual(assetBalanceAlice2, expectedAssetBalanceAlice2, 0.1)
	})
})

/**
 * Compares x and y, accepting a default error margin of 0.001%
 */
function assertIsApproximatelyEqual(x: any, y: any, errorPercent = 0.001) {
	const margin = Number(x) * (errorPercent / 100)
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, margin)
}

/**
 * Multiplies a BigNumber(ish) by a decimal
 */
function bnMulDec(x: any, y: number) {
	const precision = 1e12
	const multiplicand = BigNumber.from(x.toString())
	const multiplier = BigNumber.from(Math.floor(y * precision).toString())
	const divisor = BigNumber.from(precision)
	return multiplicand.mul(multiplier).div(divisor)
}

function bnMulDiv(x: any, y: any, z: any) {
	const xBn = BigNumber.from(x.toString())
	const yBn = BigNumber.from(y.toString())
	const zBn = BigNumber.from(z.toString())
	return xBn.mul(yBn).div(zBn)
}
