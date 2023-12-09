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

const debug = true

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

contract("DepositorGainsTest", async accounts => {
	let snapshotId: number, initialSnapshotId: number
	const [treasury, alice, bob, carol, logan] = accounts
	let vault: any, helper: any
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

		helper = await StakeAndBorrowHelper.new()
		await helper.initialize(borrowerOperations.address)
		await helper.registerStakingVault(erc20.address, vault.address)

		await borrowerOperations.registerHelper(helper.address, true)

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

	it("liquidation/gains test", async () => {
		// alice, bob & carol obtain assets to be used as collateral
		const assetAmount = bn(100)
		await erc20.mint(alice, assetAmount)
		await erc20.mint(bob, assetAmount)
		await erc20.mint(carol, assetAmount)

		// everyone approve transfers of their assets
		debug && console.log(`[alice] [bob] [carol] approve...`)
		await erc20.approve(helper.address, MaxUint256, { from: alice })
		await erc20.approve(helper.address, MaxUint256, { from: bob })
		await erc20.approve(helper.address, MaxUint256, { from: carol })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: bob })
		await vault.approve(borrowerOperations.address, MaxUint256, { from: carol })

		const collValue = bnMulDiv(assetAmount, await priceFeed.getPrice(vault.address), 1e18)

		// alice opens vessel
		const loanAmountAlice = bnMulDec(collValue, 0.5) // 50% LTV
		debug && console.log(`[alice] opens a $${f(loanAmountAlice)} GRAI vessel...`)
		await helper.openVessel(erc20.address, assetAmount, loanAmountAlice, AddressZero, AddressZero, { from: alice })
		// bob creates a vessel
		const loanAmountBob = bnMulDec(collValue, 0.5) // 50% LTV
		debug && console.log(`[bob] opens a $${f(loanAmountBob)} GRAI vessel...`)
		await helper.openVessel(erc20.address, assetAmount, loanAmountBob, AddressZero, AddressZero, { from: bob })
		// carol creates a vessel
		const loanAmountCarol = bnMulDec(collValue, 0.8) // 80% LTV
		debug && console.log(`[carol] opens a $${f(loanAmountCarol)} GRAI vessel...`)
		await helper.openVessel(erc20.address, assetAmount, loanAmountCarol, AddressZero, AddressZero, { from: carol })

    // alice deposits her GRAI on the Stability Pool
		const aliceSPDeposit = await debtToken.balanceOf(alice)
		debug && console.log(`[alice] deposits $${f(aliceSPDeposit)} GRAI on StabilityPool...`)
		await stabilityPool.provideToSP(aliceSPDeposit, [], { from: alice })
    // bob deposits his GRAI on the Stability Pool
		const bobSPDeposit = await debtToken.balanceOf(bob)
		debug && console.log(`[bob] deposits $${f(bobSPDeposit)} GRAI on StabilityPool...`)
		await stabilityPool.provideToSP(bobSPDeposit, [], { from: bob })

		// price drops 15%, carol becomes liquidatable
		debug && console.log(`[priceFeed] price drops...`)
		await priceFeed.setPrice(vault.address, bn(1_700))

		debug && console.log(`[liquidator] carol gets liquidated...`)
		await vesselManagerOperations.liquidate(vault.address, carol, { from: logan })

		printGains("alice", await stabilityPool.getDepositorGains(alice, [vault.address, erc20.address]))
		printGains("bob", await stabilityPool.getDepositorGains(bob, [vault.address, erc20.address]))

		// alice gets a few more GRAI
		debug && console.log(`[alice] borrows a bit more...`)
		await helper.adjustVessel(erc20.address, 0, 0, bn(100), true, AddressZero, AddressZero, { from: alice })
		debug && console.log(`[alice] ${f(await erc20.balanceOf(alice))} -> erc20 balance`)
		debug && console.log(`[alice] ${f(await vault.balanceOf(alice))} -> vault balance`)
		debug && console.log(`[alice] and deposits again...`)
		await stabilityPool.provideToSP(bn(100), [vault.address, erc20.address], { from: alice })

		debug && console.log(`[alice] ${f(await erc20.balanceOf(alice))} -> erc20 balance`)
    debug && console.log(`[alice] ${f(await vault.balanceOf(alice))} -> vault balance`)
		printGains("alice", await stabilityPool.getDepositorGains(alice, [vault.address, erc20.address]))
		printGains("bob", await stabilityPool.getDepositorGains(bob, [vault.address, erc20.address]))
	})
})

function printGains(user: string, gains: any) {
	console.log(`[${user}] ${gains[0][0]} -> ${f(gains[1][0])} (vault gain)`)
	console.log(`[${user}] ${gains[0][1]} -> ${f(gains[1][1])} (erc20 gain)`)
}

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
