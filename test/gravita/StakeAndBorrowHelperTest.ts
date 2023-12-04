import { artifacts, assert, contract, ethers, network } from "hardhat"
import {
	impersonateAccount,
	setBalance,
	stopImpersonatingAccount,
	time,
} from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256 } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const deploymentHelper = require("../utils/deploymentHelpers.js")

const InterestIncurringTokenizedVault = artifacts.require("InterestIncurringTokenizedVault")
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
	shortTimelock: any,
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
	shortTimelock = contracts.core.shortTimelock
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

		setBalance(shortTimelock.address, 1e18)
		await impersonateAccount(shortTimelock.address)
		await vesselManagerOperations.setRedemptionSofteningParam("9700", { from: shortTimelock.address })
		await stopImpersonatingAccount(shortTimelock.address)

		interestRate = 200 // 2%
		autoTransfer = 30 * 86_400 // 30 days timeout

		vault = await InterestIncurringTokenizedVault.new(
			erc20.address,
			"InterestToken",
			"INTTKN",
			feeCollector.address,
			interestRate,
			autoTransfer
		)
		await adminContract.addNewCollateral(vault.address, bn(200), 18)
		await adminContract.setIsActive(vault.address, true)

		stakeAndBorrowHelper = await StakeAndBorrowHelper.new()
		await stakeAndBorrowHelper.initialize(borrowerOperations.address)
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

	it("open/adjust/closeVessel via StakeAndBorrowHelper should deposit into vault and use shares as collateral", async () => {
		// alice obtains assets to be used as collateral
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)

		// alice approves transfers of her assets
		debug && console.log(`[alice] approves...`)
		await erc20.approve(stakeAndBorrowHelper.address, MaxUint256, { from: alice })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })

		const collValueAlice = bnMulDiv(assetAmountAlice, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountAlice = bnMulDec(collValueAlice, 0.5) // 50% LTV

		debug && console.log(`[alice] opens vessel...`)
		await stakeAndBorrowHelper.openVessel(erc20.address, assetAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

		// all alice's assets should be gone (and used as collateral)
		assert.equal("0", await erc20.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(alice))
		assert.equal(loanAmountAlice.toString(), await debtToken.balanceOf(alice))

		// alice increases her coll amount
		const assetAddOnAlice = bn(25)
		await erc20.mint(alice, assetAddOnAlice)
		debug && console.log(`[alice] adjusts vessel...`)
		await stakeAndBorrowHelper.adjustVessel(erc20.address, assetAddOnAlice, 0, 0, false, AddressZero, AddressZero, {
			from: alice,
		})

		// alice's add-on assets should be gone (and used as collateral)
		assert.equal("0", await erc20.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(alice))
		assert.equal(loanAmountAlice.toString(), await debtToken.balanceOf(alice))

		// alice acquires a few extra GRAI for the borrowing fee
		const feeAmount = bnMulDec(loanAmountAlice, 0.005)
		await debtToken.unprotectedMint(alice, feeAmount)

		const assetAmountBob = bn(100)
		await erc20.mint(bob, assetAmountBob)
		await erc20.approve(stakeAndBorrowHelper.address, MaxUint256, { from: bob })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: bob })
		const collValueBob = bnMulDiv(assetAmountBob, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountBob = bnMulDec(collValueBob, 0.5) // 50% LTV
		debug && console.log(`[bob] opens vessel...`)
		await stakeAndBorrowHelper.openVessel(erc20.address, assetAmountBob, loanAmountBob, AddressZero, AddressZero, {
			from: bob,
		})

		// half a year goes by (borrowing fee decays in full, meaning no refunds)
		await time.increase(182.5 * 86_400)

		debug && console.log(`[alice] closes vessel...`)
		await stakeAndBorrowHelper.closeVessel(erc20.address, { from: alice })

		assert.equal("0", await debtToken.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(alice)) // closing the vessel unwraps the asset
		const expectedAssetAmountAlice = bnMulDec(assetAmountAlice.add(assetAddOnAlice), 0.99) // original amount minus 1% interest
		assertIsApproximatelyEqual(expectedAssetAmountAlice, await erc20.balanceOf(alice))
	})

	it("claimCollateral pass-through", async () => {

		debug && console.log(`Enabling redemptions...`)
		await adminContract.setRedemptionBlockTimestamp(vault.address, 0)

		const assetAmount = bn(100)
		const assetAmountWhale = bn(1_000)
		await erc20.mint(alice, assetAmount)
		await erc20.mint(bob, assetAmount)
		await erc20.mint(whale, assetAmountWhale)

		debug && console.log(`[whale] approves...`)
		await erc20.approve(stakeAndBorrowHelper.address, MaxUint256, { from: whale })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: whale })
		debug && console.log(`[alice] approves...`)
		await erc20.approve(stakeAndBorrowHelper.address, MaxUint256, { from: alice })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		debug && console.log(`[bob] approves...`)
		await erc20.approve(stakeAndBorrowHelper.address, MaxUint256, { from: bob })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: bob })

		const collValue = bnMulDiv(assetAmount, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmount = bnMulDec(collValue, 0.75) // 75% LTV

		debug && console.log(`[whale] opens vessel for $${f(loanAmount)} GRAI...`)
		await stakeAndBorrowHelper.openVessel(erc20.address, assetAmountWhale, loanAmount, AddressZero, AddressZero, {
			from: whale,
		})
		debug && console.log(`[alice] opens vessel for $${f(loanAmount)} GRAI...`)
		await stakeAndBorrowHelper.openVessel(erc20.address, assetAmount, loanAmount, AddressZero, AddressZero, {
			from: alice,
		})
		debug && console.log(`[bob] opens vessel for $${f(loanAmount)} GRAI...`)
		await stakeAndBorrowHelper.openVessel(erc20.address, assetAmount, loanAmount, AddressZero, AddressZero, {
			from: bob,
		})

		const redeemer = carol
		const redemptionAmount = bnMulDec(await vesselManager.getVesselDebt(vault.address, alice), 1.5) // alice's debt + half of bob's
		const price = await priceFeed.getPrice(vault.address)
		await debtToken.unprotectedMint(redeemer, redemptionAmount)

		// redeem alice's and bob's (partially) vessels
		debug && console.log(`[redeemer] redeems $${f(redemptionAmount)} GRAI...`)

		const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
			vault.address,
			redemptionAmount,
			price,
			0
		)
		const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
			vault.address,
			partialRedemptionHintNewICR,
			AddressZero,
			AddressZero
		)

		assert.equal("0", await erc20.balanceOf(alice))
		await vesselManagerOperations.redeemCollateral(
			vault.address,
			redemptionAmount,
			upperPartialRedemptionHint,
			lowerPartialRedemptionHint,
			firstRedemptionHint,
			partialRedemptionHintNewICR,
			0,
			"1000000000000000000",
			{ from: redeemer }
		)
		debug && console.log(`[alice] asset balance: ${f(await erc20.balanceOf(alice))}`)
		debug && console.log(`[alice] vault balance: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`[alice] approves...`)
		await vault.approve(stakeAndBorrowHelper.address, MaxUint256, { from: alice })
		debug && console.log(`[alice] claims surplus...`)
		await stakeAndBorrowHelper.claimCollateral(erc20.address, { from: alice })
		debug && console.log(`[alice] asset balance: ${f(await erc20.balanceOf(alice))}`)
		debug && console.log(`[alice] vault balance: ${f(await vault.balanceOf(alice))}`)
		assert.notEqual("0", await erc20.balanceOf(alice)) // alice had surplus from her vessel redemption, which was unwrapped
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

