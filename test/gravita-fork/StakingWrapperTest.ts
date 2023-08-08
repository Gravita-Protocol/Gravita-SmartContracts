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

const BalancerAuraStakingWrapper = artifacts.require("BalancerAuraStakingWrapper")
const CurveConvexStakingWrapper = artifacts.require("CurveConvexStakingWrapper")
const IERC20 = artifacts.require("IERC20")
const ISortedVessels = artifacts.require("ISortedVessels")
const IVesselManager = artifacts.require("IVesselManager")

export enum WrapperType {
	CurveConvex,
	BalancerAura,
}

type StakingWrapperTestConfig = {
	wrapperType: WrapperType
	gauge: `0x${string}`
	poolId: number
	curveLPToken: `0x${string}`
	convexLPToken: `0x${string}`
	convexBooster: `0x${string}`
	convexRewards: `0x${string}`
	crv: `0x${string}`
	cvx: `0x${string}`
}

const curveConvexConfig: StakingWrapperTestConfig = {
	// CVX ETH Pool: https://curve.fi/#/ethereum/pools/cvxeth/deposit
	wrapperType: WrapperType.CurveConvex,
	gauge: "0x7E1444BA99dcdFfE8fBdb42C02F0005D14f13BE1", // Curve.fi crvCVXETH Gauge Deposit
	poolId: 64,
	curveLPToken: "0x3A283D9c08E8b55966afb64C515f5143cf907611", // Curve CVX-ETH (crvCVXETH)
	convexLPToken: "0x0bC857f97c0554d1d0D602b56F2EEcE682016fBA", // Curve CVX-ETH Convex Deposit
	convexBooster: "0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
	convexRewards: "0xb1Fb0BA0676A1fFA83882c7F4805408bA232C1fA",
	crv: "0xD533a949740bb3306d119CC777fa900bA034cd52",
	cvx: "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B",
}

const balancerAuraConfig: StakingWrapperTestConfig = {
	// rETH WETH Pool: https://app.balancer.fi/#/ethereum/pool/0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112
	wrapperType: WrapperType.BalancerAura,
	gauge: "0x79eF6103A513951a3b25743DB509E267685726B7", // Balancer B-rETH-STABLE Gauge Deposit
	poolId: 109,
	curveLPToken: "0x1E19CF2D73a72Ef1332C882F20534B6519Be0276", // Balancer rETH Stable Pool (B-rETH-STABLE)
	convexLPToken: "0x9497df26e5bD669Cb925eC68E730492b9300c482", // Balancer rETH Stable Pool Aura Deposit
	convexBooster: "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234", // ArbitratorVault
	convexRewards: "0xDd1fE5AD401D4777cE89959b7fa587e569Bf125D",
	crv: "0xba100000625a3754423978a60c9317c58a424e3D", // BAL
	cvx: "0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF", // AURA
}

let adminContract: any
let borrowerOperations: any
let debtToken: any
let priceFeed: any
let stabilityPool: any
let vesselManagerOperations: any

let config: StakingWrapperTestConfig
let wrapper: any, curveConvexWrapper: any, balancerAuraWrapper: any
let crv: any, cvx: any, curveLP: any

let alice: string, bob: string, whale: string, deployer: string, treasury: string

let snapshotId: number

describe("StakingWrappers", async () => {
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

		await deployGravitaContracts(treasury, [])
		await setupWrappers()
	})

	describe("Curve-Convex Staking Wrapper", async () => {
		before(async () => {
			config = curveConvexConfig
			wrapper = curveConvexWrapper
			crv = await IERC20.at(config.crv)
			cvx = await IERC20.at(config.cvx)
			curveLP = await IERC20.at(config.curveLPToken)
		})

		beforeEach(async () => {
			snapshotId = await network.provider.send("evm_snapshot")
		})

		afterEach(async () => {
			await network.provider.send("evm_revert", [snapshotId])
		})

		it("Curve-Convex: on happy path, openVessel & closeVessel should not transfer reward rights", async () => {
			await itHappyPath()
		})

		it("Curve-Convex: Liquidation using stability pool deposits should transfer reward rights to treasury", async () => {
			await itLiquidation()
		})

		it("Curve-Convex: Redemption should transfer rewards rights", async () => {
			await itRedemption()
		})
	})

	describe("Balancer-Aura Staking Wrapper", async () => {
		before(async () => {
			config = balancerAuraConfig
			wrapper = balancerAuraWrapper
			crv = await IERC20.at(config.crv)
			cvx = await IERC20.at(config.cvx)
			curveLP = await IERC20.at(config.curveLPToken)
		})

		beforeEach(async () => {
			snapshotId = await network.provider.send("evm_snapshot")
		})

		afterEach(async () => {
			await network.provider.send("evm_revert", [snapshotId])
		})

		it("Balancer-Aura: on happy path, openVessel & closeVessel should not transfer reward rights", async () => {
			await itHappyPath()
		})

		it("Balancer-Aura: Liquidation using stability pool deposits should transfer reward rights to treasury", async () => {
			await itLiquidation()
		})

		it("Balancer-Aura: Redemption should transfer rewards rights", async () => {
			await itRedemption()
		})
	})
})

// Test cases ---------------------------------------------------------------------------------------------------------

async function itHappyPath() {
	const aliceInitialCurveBalance = await curveLP.balanceOf(alice)
	const bobInitialCurveBalance = await curveLP.balanceOf(bob)

	// alice & bob deposit into wrapper
	console.log(`\n --> deposit(alice)\n`)
	await wrapper.deposit(aliceInitialCurveBalance, alice, { from: alice })
	console.log(`\n --> deposit(bob)\n`)
	await wrapper.deposit(bobInitialCurveBalance, bob, { from: bob })

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

	console.log(`\n--> withdraw(alice, bob)\n`)
	await wrapper.withdraw(await wrapper.balanceOf(alice), { from: alice })
	await wrapper.withdraw(await wrapper.balanceOf(bob), { from: bob })

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
}

async function itLiquidation() {
	const aliceInitialCurveBalance = await curveLP.balanceOf(alice)
	const bobInitialCurveBalance = await curveLP.balanceOf(bob)

	// alice & bob deposit into wrapper
	console.log(`\n--> deposit(alice & bob)\n`)
	await wrapper.deposit(aliceInitialCurveBalance, alice, { from: alice })
	await wrapper.deposit(bobInitialCurveBalance, bob, { from: bob })

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

	console.log(`\n--> withdraw(bob)\n`)
	await wrapper.withdraw(await wrapper.balanceOf(bob), { from: bob })

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

	// TODO research CRV and CVX rewards metrics and understand how much should alice & bob each have on day 60,
	//     considering alice lost accruing rights (to treasury) on day 30
}

async function itRedemption() {
	// enable & setup redemptions
	const timelockAddress = await adminContract.timelockAddress()
	await impersonateAccount(timelockAddress)
	await setBalance(timelockAddress, 10e18)
	await vesselManagerOperations.setRedemptionSofteningParam(98_00, { from: timelockAddress })
	await stopImpersonatingAccount(timelockAddress)
	const currentBlock = await ethers.provider.getBlockNumber()
	const currentBlockTimestamp = Number((await ethers.provider.getBlock(currentBlock)).timestamp)
	await adminContract.setRedemptionBlockTimestamp(wrapper.address, currentBlockTimestamp - 1)

	// alice & bob deposit into wrapper
	const aliceInitialCurveBalance = await curveLP.balanceOf(alice)
	const bobInitialCurveBalance = await curveLP.balanceOf(bob)
	console.log(`\n--> deposit(alice & bob)\n`)
	await wrapper.deposit(aliceInitialCurveBalance, alice, { from: alice })
	await wrapper.deposit(bobInitialCurveBalance, bob, { from: bob })

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

	// whale redeems some of his GRAI
	const redemptionAmount = toEther(5_000)
	console.log(`\n--> redeemCollateral(whale) :: ${f(redemptionAmount)} GRAI\n`)
	const { firstRedemptionHint, partialRedemptionHintNewICR, upperPartialRedemptionHint, lowerPartialRedemptionHint } =
		await getRedemptionHints(redemptionAmount)

	await vesselManagerOperations.redeemCollateral(
		wrapper.address,
		redemptionAmount,
		upperPartialRedemptionHint,
		lowerPartialRedemptionHint,
		firstRedemptionHint,
		partialRedemptionHintNewICR,
		5,
		toEther(0.05),
		{ from: whale }
	)

	// TODO checks

	await printBalances([alice, bob])

	return
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

	console.log(`\n--> withdraw(bob)\n`)
	await wrapper.withdraw(await wrapper.balanceOf(bob), { from: bob })

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

	// TODO research CRV and CVX rewards metrics and understand how much should alice & bob each have on day 60,
	//     considering alice lost accruing rights (to treasury) on day 30
}
// Helper functions ---------------------------------------------------------------------------------------------------

const f = (v: any) => ethers.utils.formatEther(v.toString())
const toEther = (v: any) => ethers.utils.parseEther(v.toString())
const addrToName = (v: string) => (v == alice ? `alice` : v == bob ? `bob` : `${v.substring(0, 6)}...`)
const tokenName = (v: string) => {
	if (v == curveConvexConfig.crv) return "CRV"
	if (v == curveConvexConfig.cvx) return "CVX"
	if (v == balancerAuraConfig.crv) return "BAL"
	if (v == balancerAuraConfig.cvx) return "AURA"
	return `${v.substring(0, 6)}...`
}

async function printBalances(accounts: string[]) {
	const { crv, cvx, crvName, cvxName } = await getCrvAndCvx(wrapper)
	for (const account of accounts) {
		await wrapper.userCheckpoint(account)
		const earnedRewards = await wrapper.getEarnedRewards(account)
		console.log(`Wrapper.getEarnedRewards(${addrToName(account)}): ${formatEarnedData(earnedRewards)}`)
		console.log(`${crvName}.balanceOf(${addrToName(account)}): ${f(await crv.balanceOf(account))}`)
		console.log(`${cvxName}.balanceOf(${addrToName(account)}): ${f(await cvx.balanceOf(account))}\n`)
	}
	console.log(`${crvName}.balanceOf(wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
	console.log(`${cvxName}.balanceOf(wrapper): ${f(await cvx.balanceOf(wrapper.address))}`)
}

async function printRewards() {
	let rewardCount = await wrapper.rewardsLength()
	for (var i = 0; i < rewardCount; i++) {
		var r = await wrapper.rewards(i)
		console.log(` - reward #${i}: ${formatRewardType(r)}`)
	}
}

function formatRewardType(r: any) {
	return `[${tokenName(r.token)}] integral: ${f(r.integral)} remaining: ${f(r.remaining)}`
}

function formatEarnedData(earnedDataArray: any) {
	return earnedDataArray.map((d: any) => {
		return `[${tokenName(d[0])}] = ${f(d[1])}`
	})
}

async function getCrvAndCvx(wrapper: any) {
	const crv = await IERC20.at(await wrapper.crv())
	const cvx = await IERC20.at(await wrapper.cvx())
	const crvName = tokenName(crv.address)
	const cvxName = tokenName(cvx.address)
	return { crv, cvx, crvName, cvxName }
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

async function deployWrapperContract(cfg: StakingWrapperTestConfig): Promise<any> {
	await setBalance(deployer, 10e18)
	const wrapper =
		cfg.wrapperType == WrapperType.CurveConvex
			? await CurveConvexStakingWrapper.new({ from: deployer })
			: await BalancerAuraStakingWrapper.new({ from: deployer })
	const params = [cfg.convexBooster, cfg.crv, cfg.cvx, cfg.poolId]
	await wrapper.initialize(...params, { from: deployer })
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
	return wrapper
}

async function setupWrapperAsCollateral(wrapper: any) {
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

async function setupWrappers() {
	curveConvexWrapper = await deployWrapperContract(curveConvexConfig)
	balancerAuraWrapper = await deployWrapperContract(balancerAuraConfig)
	await setupWrapperAsCollateral(curveConvexWrapper)
	await setupWrapperAsCollateral(balancerAuraWrapper)
	await setupPositions(curveConvexWrapper, curveConvexConfig)
	await setupPositions(balancerAuraWrapper, balancerAuraConfig)
}

async function setupPositions(wrapper: any, cfg: StakingWrapperTestConfig) {
	const curveLPToken = await IERC20.at(cfg.curveLPToken)
	// assign CurveLP tokens to whale, alice and bob
	await impersonateAccount(cfg.gauge)
	await setBalance(cfg.gauge, 20e18)
	await curveLPToken.transfer(whale, toEther(10_000), { from: cfg.gauge })
	await curveLPToken.transfer(alice, toEther(100), { from: cfg.gauge })
	await curveLPToken.transfer(bob, toEther(100), { from: cfg.gauge })
	await stopImpersonatingAccount(cfg.gauge)
	// issue token transfer approvals
	await curveLPToken.approve(wrapper.address, MaxUint256, { from: whale })
	await curveLPToken.approve(wrapper.address, MaxUint256, { from: alice })
	await curveLPToken.approve(wrapper.address, MaxUint256, { from: bob })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: whale })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: alice })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: bob })
	// whale opens a vessel
	const whaleCurveBalance = await curveLPToken.balanceOf(whale)
	await wrapper.deposit(whaleCurveBalance, whale, { from: whale })
	console.log(`\n--> openVessel(whale, ${f(whaleCurveBalance)}) => ${f(toEther(500_000))} GRAI\n`)
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
async function calcMaxLoan(collAmount: BigNumber): Promise<BigInt> {
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

async function getRedemptionHints(redemptionAmount: BigNumber) {
	const price = await priceFeed.fetchPrice(wrapper.address)
	const vesselManager = await IVesselManager.at(await adminContract.vesselManager())
	const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManager.getRedemptionHints(
		wrapper.address,
		redemptionAmount,
		price,
		0
	)
	const sortedVessels = await ISortedVessels.at(await adminContract.sortedVessels())
	const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
		wrapper.address,
		partialRedemptionHintNewICR,
		alice,
		alice
	)
	return { firstRedemptionHint, partialRedemptionHintNewICR, upperPartialRedemptionHint, lowerPartialRedemptionHint }
}

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
}
