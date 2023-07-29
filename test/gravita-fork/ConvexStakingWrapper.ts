import { artifacts, assert, ethers, network } from "hardhat"
import {
	setBalance,
	time,
	impersonateAccount,
	stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256, WeiPerEther } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const deploymentHelper = require("../utils/deploymentHelpers.js")

const BaseRewardPool = artifacts.require("IBaseRewardPool")
const Booster = artifacts.require("IBooster")
const ConvexStakingWrapper = artifacts.require("ConvexStakingWrapper")
const IERC20 = artifacts.require("IERC20")

let adminContract: any
let borrowerOperations: any
let debtToken: any
let priceFeed: any
let stabilityPool: any
let vesselManagerOperations: any
let wrapper: any

let booster: any
let crv: any
let cvx: any
let curveLP: any
let convexLP: any
let convexRewards: any

let gaugeAddress = "0x7E1444BA99dcdFfE8fBdb42C02F0005D14f13BE1"
let poolId = 64

let snapshotId: number, initialSnapshotId: number
let alice: string, bob: string, whale: string, deployer: string, treasury: string

describe("ConvexStakingWrapper", async () => {
	before(async () => {
		const accounts = await ethers.getSigners()
		deployer = await accounts[0].getAddress()
		alice = await accounts[1].getAddress()
		bob = await accounts[2].getAddress()
		whale = await accounts[3].getAddress()
		treasury = await accounts[4].getAddress()

		console.log(`${alice} -> alice`)
		console.log(`${bob} -> bob`)
		console.log(`${whale} -> whale`)
		console.log(`${deployer} -> deployer`)
		console.log(`${treasury} -> treasury`)

		booster = await Booster.at("0xF403C135812408BFbE8713b5A23a04b3D48AAE31")
		crv = await IERC20.at("0xD533a949740bb3306d119CC777fa900bA034cd52")
		cvx = await IERC20.at("0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B")
		curveLP = await IERC20.at("0x3A283D9c08E8b55966afb64C515f5143cf907611")
		convexLP = await IERC20.at("0x0bC857f97c0554d1d0D602b56F2EEcE682016fBA")
		convexRewards = await BaseRewardPool.at("0xb1Fb0BA0676A1fFA83882c7F4805408bA232C1fA")

		await deployGravitaContracts(treasury, [])
		await initGravitaCurveSetup()
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

	it("happy path: openVessel, closeVessel", async () => {
		const aliceInitialCurveBalance = await curveLP.balanceOf(alice)
		const bobInitialCurveBalance = await curveLP.balanceOf(bob)

		// alice & bob deposit into wrapper
		console.log(`\n --> depositCurveTokens(alice)\n`)
		await wrapper.depositCurveTokens(aliceInitialCurveBalance, alice, { from: alice })
		console.log(`\n --> depositCurveTokens(bob)\n`)
		await wrapper.depositCurveTokens(bobInitialCurveBalance, bob, { from: bob })

		// only alice opens a vessel
		console.log(`\n--> openVessel(alice)\n`)
		await borrowerOperations.openVessel(wrapper.address, toEther(100), toEther(2_000), AddressZero, AddressZero, {
			from: alice,
		})
		console.log(`wrapper.balanceOf(alice): ${f(await wrapper.balanceOf(alice))}`)
		console.log(`wrapper.gravitaBalanceOf(alice): ${f(await wrapper.gravitaBalanceOf(alice))}`)
		console.log(`wrapper.totalBalanceOf(alice): ${f(await wrapper.totalBalanceOf(alice))}`)

		// fast forward 90 days
		console.log(`\n--> time.increase() :: t = 90\n`)
		await time.increase(90 * 86_400)

		// alice closes vessel
		console.log(`\n--> closeVessel(alice)\n`)
		await borrowerOperations.closeVessel(wrapper.address, { from: alice })

		// alice, bob and treasury claim rewards & unwrap
		console.log(`\n--> claimEarnedRewards(alice, bob, treasury)\n`)
		await wrapper.earmarkBoosterRewards()
		await wrapper.claimEarnedRewards(alice)
		await wrapper.claimEarnedRewards(bob)
		await wrapper.claimTreasuryEarnedRewards((await wrapper.registeredRewards(crv.address)) - 1)
		await wrapper.claimTreasuryEarnedRewards((await wrapper.registeredRewards(cvx.address)) - 1)

		console.log(`\n--> withdrawAndUnwrap(alice, bob)\n`)
		await wrapper.withdrawAndUnwrap(await wrapper.balanceOf(alice), { from: alice })
		await wrapper.withdrawAndUnwrap(await wrapper.balanceOf(bob), { from: bob })

		// checks
		const aliceCurveBalance = await curveLP.balanceOf(alice)
		const aliceCrvBalance = await crv.balanceOf(alice)
		const aliceCvxBalance = await cvx.balanceOf(alice)
		const aliceWrapperBalance = await wrapper.totalBalanceOf(alice)

		const bobCurveBalance = await curveLP.balanceOf(bob)
		const bobCrvBalance = await crv.balanceOf(bob)
		const bobCvxBalance = await cvx.balanceOf(bob)
		const bobWrapperBalance = await wrapper.totalBalanceOf(bob)

		const treasuryCurveBalance = await curveLP.balanceOf(treasury)
		const treasuryCrvBalance = await crv.balanceOf(treasury)
		const treasuryCvxBalance = await cvx.balanceOf(treasury)
		const treasuryWrapperBalance = await wrapper.totalBalanceOf(treasury)

		assert.equal(aliceCurveBalance.toString(), aliceInitialCurveBalance.toString())
		assert.equal(bobCurveBalance.toString(), bobInitialCurveBalance.toString())
		assert.equal(aliceWrapperBalance.toString(), "0")
		assert.equal(bobWrapperBalance.toString(), "0")
		assert.equal(treasuryWrapperBalance.toString(), "0")
		assert.equal(treasuryCurveBalance.toString(), "0")

		const crvSum = aliceCrvBalance.add(bobCrvBalance).add(treasuryCrvBalance)
		const cvxSum = aliceCvxBalance.add(bobCvxBalance).add(treasuryCvxBalance)

		// alice & bob should have earned similar rewards (.5% deviation accepted)
		assertIsApproximatelyEqual(aliceCrvBalance, bobCrvBalance, Number(crvSum) / 200)
		assertIsApproximatelyEqual(aliceCvxBalance, bobCvxBalance, Number(cvxSum) / 200)

		// treasury should have earned `protocolFee` (15% of total)
		const protocolFee = await wrapper.protocolFee()
		const expectedTreasuryCrvBalance = Number(crvSum) * (Number(protocolFee) / 1e18)
		const expectedTreasuryCvxBalance = Number(cvxSum) * (Number(protocolFee) / 1e18)
		assertIsApproximatelyEqual(treasuryCrvBalance, expectedTreasuryCrvBalance)
		assertIsApproximatelyEqual(treasuryCvxBalance, expectedTreasuryCvxBalance)

		// remaining rewards on wrapper should belong to whale - and corresponding treasury share (.5% deviation accepted)
		const wrapperCrvBalance = await crv.balanceOf(wrapper.address)
		const wrapperCvxBalance = await cvx.balanceOf(wrapper.address)

		await wrapper.userCheckpoint(whale)
		const whaleRewards = await wrapper.getEarnedRewards(whale)
		const treasuryRewards = await wrapper.getEarnedRewards(treasury)
		const claimableCrvRewards = BigInt(whaleRewards[0].amount) + BigInt(treasuryRewards[0].amount)
		const claimableCvxRewards = BigInt(whaleRewards[1].amount) + BigInt(treasuryRewards[1].amount)

		assertIsApproximatelyEqual(wrapperCrvBalance, claimableCrvRewards, Number(wrapperCrvBalance) / 200)
		assertIsApproximatelyEqual(wrapperCvxBalance, claimableCvxRewards, Number(wrapperCvxBalance) / 200)
	})

	it("liquidation using stability pool deposits", async () => {
		const aliceInitialCurveBalance = await curveLP.balanceOf(alice)
		const bobInitialCurveBalance = await curveLP.balanceOf(bob)

		// alice & bob deposit into wrapper
		console.log(`\n--> depositCurveTokens(alice & bob)\n`)
		await wrapper.depositCurveTokens(aliceInitialCurveBalance, alice, { from: alice })
		await wrapper.depositCurveTokens(bobInitialCurveBalance, bob, { from: bob })

		// whale provides to SP
		const whaleInitialDebtTokenBalance = await debtToken.balanceOf(whale)
		console.log(`\n--> provideToSP(whale, ${f(whaleInitialDebtTokenBalance)} GRAI)\n`)
		await stabilityPool.provideToSP(whaleInitialDebtTokenBalance, [], { from: whale })

		// alice & bob open vessels
		const aliceMaxLoan = await calcMaxLoan(aliceInitialCurveBalance)
		console.log(`\n--> openVessel(alice, ${f(aliceInitialCurveBalance)}) => ${f(aliceMaxLoan)} GRAI\n`)
		await borrowerOperations.openVessel(
			wrapper.address,
			aliceInitialCurveBalance,
			aliceMaxLoan,
			AddressZero,
			AddressZero,
			{
				from: alice,
			}
		)
		const bobMaxLoan = await calcMaxLoan(bobInitialCurveBalance)
		console.log(`\n--> openVessel(bob, ${f(bobInitialCurveBalance)}) => ${f(bobMaxLoan)} GRAI\n`)
		await borrowerOperations.openVessel(wrapper.address, bobInitialCurveBalance, bobMaxLoan, AddressZero, AddressZero, {
			from: bob,
		})

		// fast forward 30 days
		console.log(`\n--> time.increase() :: t = 30\n`)
		await time.increase(30 * 86_400)

		// price drops 50%, liquidate alice (but leave bob alone, on purpose)
		await dropPriceByPercent(wrapper.address, 50)

		await printBalances([alice, bob])

		console.log(`\n--> liquidate(alice)\n`)
		const liquidator = (await ethers.getSigners())[10]
		await vesselManagerOperations.liquidate(wrapper.address, alice, { from: liquidator.address })

		// fast forward another 30 days
		console.log(`\n--> time.increase() :: t = 60\n`)
		await time.increase(30 * 86_400)

		await printBalances([alice, bob])

		// whale withdraws deposit and gains
		console.log(`\n--> withdrawFromSP(whale)\n`)
		const whaleBalanceSP = await stabilityPool.getCompoundedDebtTokenDeposits(whale)
		await stabilityPool.withdrawFromSP(whaleBalanceSP, [wrapper.address], { from: whale })

		// bob closes vessel
		console.log(`\n--> closeVessel(bob)\n`)
		await borrowerOperations.closeVessel(wrapper.address, { from: bob })

		// alice, bob and treasury claim rewards & unwrap
		console.log(`\n--> claimEarnedRewards(alice, bob, treasury)\n`)
		await wrapper.earmarkBoosterRewards()
		await wrapper.claimEarnedRewards(alice)
		await wrapper.claimEarnedRewards(bob)
		await wrapper.claimTreasuryEarnedRewards((await wrapper.registeredRewards(crv.address)) - 1)
		await wrapper.claimTreasuryEarnedRewards((await wrapper.registeredRewards(cvx.address)) - 1)

		console.log(`\n--> withdrawAndUnwrap(bob)\n`)
		await wrapper.withdrawAndUnwrap(await wrapper.balanceOf(bob), { from: bob })

		// checks
		const aliceCurveBalance = await curveLP.balanceOf(alice)
		const aliceCrvBalance = await crv.balanceOf(alice)
		const aliceCvxBalance = await cvx.balanceOf(alice)
		const aliceWrapperBalance = await wrapper.totalBalanceOf(alice)

		const bobCurveBalance = await curveLP.balanceOf(bob)
		const bobCrvBalance = await crv.balanceOf(bob)
		const bobCvxBalance = await cvx.balanceOf(bob)
		const bobWrapperBalance = await wrapper.totalBalanceOf(bob)

		const treasuryCurveBalance = await curveLP.balanceOf(treasury)
		const treasuryCrvBalance = await crv.balanceOf(treasury)
		const treasuryCvxBalance = await cvx.balanceOf(treasury)
		const treasuryWrapperBalance = await wrapper.totalBalanceOf(treasury)

		console.log(`\naliceCurveBalance: ${f(aliceCurveBalance)}`)
		console.log(`aliceCrvBalance: ${f(aliceCrvBalance)}`)
		console.log(`aliceCvxBalance: ${f(aliceCvxBalance)}`)
		console.log(`aliceWrapperBalance: ${f(aliceWrapperBalance)}`)

		console.log(`\nbobCurveBalance: ${f(bobCurveBalance)}`)
		console.log(`bobCrvBalance: ${f(bobCrvBalance)}`)
		console.log(`bobCvxBalance: ${f(bobCvxBalance)}`)
		console.log(`bobWrapperBalance: ${f(bobWrapperBalance)}`)

		console.log(`\ntreasuryCurveBalance: ${f(treasuryCurveBalance)}`)
		console.log(`treasuryCrvBalance: ${f(treasuryCrvBalance)}`)
		console.log(`treasuryCvxBalance: ${f(treasuryCvxBalance)}`)
		console.log(`treasuryWrapperBalance: ${f(treasuryWrapperBalance)}`)

		assert.equal(aliceCurveBalance.toString(), "0") // alice lost her collateral on liquidation
		assert.equal(bobCurveBalance.toString(), bobInitialCurveBalance.toString())
		assert.equal(aliceWrapperBalance.toString(), "0")
		assert.equal(bobWrapperBalance.toString(), "0")
		assert.equal(treasuryCurveBalance.toString(), "0")

		// TODO research CRV and CVX rewards metrics and understand how much should alice & bob each have,
		//     considering alice lost accruing rights (to treasury) on day 30
	})

	it.skip("original test: should deposit lp tokens and earn rewards while being transferable", async () => {
		await setBalance(gaugeAddress, 20e18)
		await impersonateAccount(gaugeAddress)
		await curveLP.transfer(alice, toEther("10"), { from: gaugeAddress })
		await curveLP.transfer(bob, toEther("5"), { from: gaugeAddress })
		await stopImpersonatingAccount(gaugeAddress)

		const aliceBalance = await curveLP.balanceOf(alice)
		const bobBalance = await curveLP.balanceOf(bob)
		console.log(`curveLP.balanceOf(alice): ${f(aliceBalance)}`)
		console.log(`curveLP.balanceOf(bob): ${f(bobBalance)}`)

		await printRewards()

		// alice will deposit curve tokens and bob, convex
		console.log("Approve Booster and wrapper for alice and bob")
		await curveLP.approve(wrapper.address, aliceBalance, { from: alice })
		await curveLP.approve(booster.address, bobBalance, { from: bob })
		await convexLP.approve(wrapper.address, bobBalance, { from: bob })

		console.log("alice deposits into wrapper")
		await wrapper.depositCurveTokens(aliceBalance, alice, { from: alice })

		console.log("bob deposits into Booster")
		await booster.depositAll(poolId, false, { from: bob })
		console.log(`ConvexLP.balanceOf(bob): ${f(await convexLP.balanceOf(bob))}`)

		console.log("bob stakes into wrapper")
		await wrapper.stakeConvexTokens(bobBalance, bob, { from: bob })

		console.log(`Wrapper supply: ${f(await wrapper.totalSupply())}`)

		await printBalances([alice, bob])

		console.log(" --- Advancing 1 day --- ")
		await time.increase(86_400)

		await printBalances([alice, bob])

		console.log(" --- Advancing 1 more day --- ")
		await time.increase(86_400)

		console.log("ConvexRewards.getReward()")
		await convexRewards.getReward(wrapper.address, true)

		console.log("Booster.earmarkRewards()")
		await booster.earmarkRewards(poolId, { from: deployer })

		await printBalances([alice, bob])
		await printRewards()

		console.log(" --- Advancing 1 more day --- ")
		await time.increase(86_400)

		await printBalances([alice, bob])

		console.log(" ---> Claiming rewards...")
		await wrapper.claimEarnedRewards(alice, { from: alice })
		await wrapper.claimEarnedRewards(bob, { from: bob })

		await printBalances([alice, bob])
		await printRewards()

		console.log("Booster.earmarkRewards()")
		await booster.earmarkRewards(poolId, { from: deployer })

		console.log(" --- Advancing 5 more days --- ")
		await time.increase(86_400 * 5)

		await printBalances([alice, bob])

		console.log(" ---> Claiming rewards...")
		await wrapper.claimEarnedRewards(alice, { from: alice })
		await wrapper.claimEarnedRewards(bob, { from: bob })

		await printBalances([alice, bob])
		await printRewards()

		console.log("Booster.earmarkRewards()")
		await booster.earmarkRewards(poolId, { from: deployer })

		console.log(" --- Advancing 10 more days --- ")
		await time.increase(86_400 * 5)

		await printBalances([alice, bob])

		console.log(" ---> Claiming rewards...")
		await wrapper.claimEarnedRewards(alice, { from: alice })
		await wrapper.claimEarnedRewards(bob, { from: bob })

		await printBalances([alice, bob])
		await printRewards()

		console.log(" --- Advancing 1 more day --- ")
		await time.increase(86_400)
		console.log("Withdrawing...")
		await wrapper.withdrawAndUnwrap(aliceBalance, { from: alice })
		await wrapper.withdraw(bobBalance, { from: bob })
		console.log("Withdraw complete")

		console.log(" ---> Claiming rewards...")
		await wrapper.claimEarnedRewards(alice, { from: alice })
		await wrapper.claimEarnedRewards(bob, { from: bob })

		await printBalances([alice, bob])

		// check what is left on the wrapper
		console.log(" >>> remaining check <<<< ")

		console.log(`Wrapper supply: ${f(await wrapper.totalSupply())}`)

		console.log(`Wrapper.balanceOf(alice): ${f(await wrapper.balanceOf(alice))}`)
		console.log(`Wrapper.balanceOf(bob): ${f(await wrapper.balanceOf(bob))}`)

		console.log(`CRV.balanceOf(Wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
		console.log(`CVX.balanceOf(Wrapper): ${f(await cvx.balanceOf(wrapper.address))}`)
	})
})

const f = (v: any) => ethers.utils.formatEther(v.toString())
const toEther = (v: any) => ethers.utils.parseEther(v.toString())
const addrToName = (v: string) => (v == alice ? `alice` : v == bob ? `bob` : `${v.substring(0, 6)}...`)

async function printBalances(accounts: string[]) {
	for (const account of accounts) {
		await wrapper.userCheckpoint(account)
		console.log(
			`Wrapper.getEarnedRewards(${addrToName(account)}): ${formatEarnedData(await wrapper.getEarnedRewards(account))}`
		)
		console.log(`CRV.balanceOf(${addrToName(account)}): ${f(await crv.balanceOf(account))}`)
		console.log(`CVX.balanceOf(${addrToName(account)}): ${f(await cvx.balanceOf(account))}\n`)
	}
	console.log(`CRV.balanceOf(wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
	console.log(`CVX.balanceOf(wrapper): ${f(await cvx.balanceOf(wrapper.address))}`)
}

async function printRewards() {
	let rewardCount = await wrapper.rewardsLength()
	for (var i = 0; i < rewardCount; i++) {
		var r = await wrapper.rewards(i)
		console.log(` - reward #${i}: ${formatRewardType(r)}`)
	}
}

function formatRewardType(r: any) {
	const token = r.token == crv.address ? "CRV" : r.token == cvx.address ? "CVX" : r.token
	return `[${token}] integral: ${f(r.integral)} remaining: ${f(r.remaining)}`
}

function formatEarnedData(earnedDataArray: any) {
	return earnedDataArray.map((d: any) => {
		const token = d[0] == crv.address ? "CRV" : d[0] == cvx.address ? "CVX" : d[0]
		return `[${token}] = ${f(d[1])}`
	})
}

async function deployGravitaContracts(treasury: string, mintingAccounts: string[]) {
	console.log(`Deploying Gravita contracts...`)
	const contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	debtToken = contracts.core.debtToken
	priceFeed = contracts.core.priceFeedTestnet
	stabilityPool = contracts.core.stabilityPool
	vesselManagerOperations = contracts.core.vesselManagerOperations
}

async function deployWrapperContract(poolId: number) {
	console.log(`Deploying ConvexStakingWrapper contract...`)
	await setBalance(deployer, 10e18)
	wrapper = await ConvexStakingWrapper.new({ from: deployer })
	await wrapper.initialize(poolId, { from: deployer })
	await wrapper.setAddresses(
		[
			await adminContract.activePool(),
			adminContract.address,
			await adminContract.borrowerOperations(),
			await adminContract.collSurplusPool(),
			await adminContract.debtToken(),
			await adminContract.defaultPool(),
			await adminContract.feeCollector(),
			await adminContract.gasPoolAddress(),
			await adminContract.priceFeed(),
			await adminContract.sortedVessels(),
			await adminContract.stabilityPool(),
			await adminContract.timelockAddress(),
			await adminContract.treasuryAddress(),
			await adminContract.vesselManager(),
			await adminContract.vesselManagerOperations(),
		],
		{ from: deployer }
	)
	await priceFeed.setPrice(wrapper.address, toEther(2_000))
}

async function setupWrapperAsCollateral() {
	console.log(`Configuring ConvexStakingWrapper as collateral...`)
	await adminContract.addNewCollateral(wrapper.address, toEther("200"), 18)
	await adminContract.setCollateralParameters(
		wrapper.address,
		await adminContract.BORROWING_FEE_DEFAULT(),
		toEther(1.4),
		toEther(1.111),
		toEther(2_000),
		toEther(1_500_000),
		await adminContract.PERCENT_DIVISOR_DEFAULT(),
		await adminContract.REDEMPTION_FEE_FLOOR_DEFAULT()
	)
	await adminContract.setRewardAccruingCollateral(wrapper.address, true)
}

async function initGravitaCurveSetup() {
	await deployWrapperContract(poolId)
	await setupWrapperAsCollateral()
	// assign CurveLP tokens to whale, alice and bob
	await setBalance(gaugeAddress, 20e18)
	await impersonateAccount(gaugeAddress)
	await curveLP.transfer(alice, toEther(100), { from: gaugeAddress })
	await curveLP.transfer(bob, toEther(100), { from: gaugeAddress })
	await curveLP.transfer(whale, toEther(10_000), { from: gaugeAddress })
	await stopImpersonatingAccount(gaugeAddress)
	// issue token transfer approvals
	await curveLP.approve(wrapper.address, MaxUint256, { from: alice })
	await curveLP.approve(wrapper.address, MaxUint256, { from: bob })
	await curveLP.approve(wrapper.address, MaxUint256, { from: whale })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: alice })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: bob })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: whale })
	// whale opens a vessel
	const whaleCurveBalance = await curveLP.balanceOf(whale)
	await wrapper.depositCurveTokens(whaleCurveBalance, whale, { from: whale })
	await borrowerOperations.openVessel(wrapper.address, whaleCurveBalance, toEther(500_000), AddressZero, AddressZero, {
		from: whale,
	})
	// give alice & bob some grai ($1,000 each) for fees
	await debtToken.transfer(alice, toEther(1_000), { from: whale })
	await debtToken.transfer(bob, toEther(1_000), { from: whale })
}

/**
 * Calculates a loan amount that is close to the maxLTV.
 */
async function calcMaxLoan(collAmount: BigNumber) {
	const collPrice = BigInt(String(await priceFeed.fetchPrice(wrapper.address)))
	const collValue = (BigInt(collAmount.toString()) * collPrice) / BigInt(WeiPerEther.toString())
	const gasCompensation = await adminContract.getDebtTokenGasCompensation(wrapper.address)
	let maxLoan = (collValue * BigInt(WeiPerEther.toString())) / BigInt(await adminContract.getMcr(wrapper.address))
	maxLoan = (maxLoan * BigInt(99)) / BigInt(100) // discount for borrowingFee
	return maxLoan - BigInt(gasCompensation)
}

async function dropPriceByPercent(collAddress: string, pct: number) {
	const price = await priceFeed.getPrice(collAddress)
	const newPrice = (BigInt(price) * BigInt(100 - pct)) / BigInt(100)
	await priceFeed.setPrice(collAddress, newPrice)
}

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}
