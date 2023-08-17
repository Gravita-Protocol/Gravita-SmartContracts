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
const ERC20 = artifacts.require("ERC20")
const ISortedVessels = artifacts.require("ISortedVessels")
const IVesselManager = artifacts.require("IVesselManager")
const MaverickStakingWrapper = artifacts.require("MaverickStakingWrapper")
const MaverickRewards = artifacts.require("IReward")

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Internal test types
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

enum WrapperType {
	CurveConvex,
	BalancerAura,
	Bunni,
	Maverick,
}

type StakingWrapperTestConfig = {
	wrapperType: WrapperType
	piggyBank: `0x${string}`
	poolId: number | undefined
	lpToken: `0x${string}`
	booster: `0x${string}` | undefined
	rewards: `0x${string}`
	crv: `0x${string}` | undefined
	cvx: `0x${string}` | undefined
}

type RewardEarned = {
	token: `0x${string}`
	index: number
	amount: BigNumber
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Test config
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const curveConvexConfig: StakingWrapperTestConfig = {
	// CVX ETH Pool: https://curve.fi/#/ethereum/pools/cvxeth/deposit
	wrapperType: WrapperType.CurveConvex,
	piggyBank: "0x7E1444BA99dcdFfE8fBdb42C02F0005D14f13BE1", // Curve.fi crvCVXETH Gauge Deposit
	poolId: 64,
	lpToken: "0x3A283D9c08E8b55966afb64C515f5143cf907611", // Curve CVX-ETH (crvCVXETH)
	booster: "0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
	rewards: "0xb1Fb0BA0676A1fFA83882c7F4805408bA232C1fA",
	crv: "0xD533a949740bb3306d119CC777fa900bA034cd52",
	cvx: "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B",
	// convexLPToken: "0x0bC857f97c0554d1d0D602b56F2EEcE682016fBA", // Curve CVX-ETH Convex Deposit
}

const balancerAuraConfig: StakingWrapperTestConfig = {
	// rETH WETH Pool
	// https://app.balancer.fi/#/ethereum/pool/0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112
	wrapperType: WrapperType.BalancerAura,
	piggyBank: "0x79eF6103A513951a3b25743DB509E267685726B7", // Balancer B-rETH-STABLE Gauge Deposit
	poolId: 109,
	lpToken: "0x1E19CF2D73a72Ef1332C882F20534B6519Be0276", // Balancer rETH Stable Pool (B-rETH-STABLE)
	booster: "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234", // ArbitratorVault
	rewards: "0xDd1fE5AD401D4777cE89959b7fa587e569Bf125D",
	crv: "0xba100000625a3754423978a60c9317c58a424e3D", // BAL
	cvx: "0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF", // AURA
	// auraLPToken: "0x9497df26e5bD669Cb925eC68E730492b9300c482", // Balancer rETH Stable Pool Aura Deposit
}

const maverickConfig: StakingWrapperTestConfig = {
	// Maverick Position-wstETH-WETH-0
	// https://app.mav.xyz/boosted-positions/0xa2b4e72a9d2d3252da335cb50e393f44a9f104ee?chain=1
	wrapperType: WrapperType.Maverick,
	piggyBank: "0x14edfe68031bBf229a765919EB52AE6F6F3347d4", // some LP whale
	poolId: undefined,
	lpToken: "0xa2b4e72a9d2d3252da335cb50e393f44a9f104ee", // MP-wstETH-WETH-0
	booster: undefined,
	rewards: "0x14edfe68031bbf229a765919eb52ae6f6f3347d4",
	crv: undefined,
	cvx: undefined,
}

const bunniConfig: StakingWrapperTestConfig = {
	// Timeless BUNNI-LP Gauge Deposit: 0xa718193e1348fd4def3063e7f4b4154baacb0214
	wrapperType: WrapperType.Bunni,
	piggyBank: "0xa718193E1348FD4dEF3063E7F4b4154BAAcB0214", // Timeless BUNNI-LP Gauge Deposit
	poolId: undefined,
	lpToken: "0x846A4566802C27eAC8f72D594F4Ca195Fe41C07a", // Bunni WETH/swETH LP (BUNNI-LP)
	booster: undefined,
	rewards: "0xa718193E1348FD4dEF3063E7F4b4154BAAcB0214", // Timeless BUNNI-LP Gauge Deposit
	crv: undefined,
	cvx: undefined,
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Vars used on tests
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let adminContract: any
let borrowerOperations: any
let debtToken: any
let priceFeed: any
let stabilityPool: any
let vesselManagerOperations: any

let config: StakingWrapperTestConfig
let wrapper: any, curveConvexWrapper: any, balancerAuraWrapper: any, maverickWrapper: any, bunniWrapper: any
let lpToken: any

let alice: string, bob: string, carol: string, liquidator: string, redeemer: string
let whale: string, deployer: string, treasury: string

let snapshotId: number

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Test cases
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

describe("StakingWrappers", async () => {
	before(async () => {
		const accounts = await ethers.getSigners()
		deployer = await accounts[0].getAddress()
		alice = await accounts[1].getAddress()
		bob = await accounts[2].getAddress()
		carol = await accounts[3].getAddress()
		liquidator = await accounts[4].getAddress()
		redeemer = await accounts[5].getAddress()
		whale = await accounts[6].getAddress()
		treasury = await accounts[7].getAddress()

		console.log(`${alice} -> alice`)
		console.log(`${bob} -> bob`)
		console.log(`${carol} -> carol`)
		console.log(`${liquidator} -> liquidator`)
		console.log(`${redeemer} -> redeemer`)
		console.log(`${whale} -> whale`)
		console.log(`${deployer} -> deployer`)
		console.log(`${treasury} -> treasury`)

		await deployGravitaContracts(treasury, [])
		await setupWrappers()
	})

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Curve-Convex wrapper tests
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	describe("Curve-Convex Staking Wrapper", async () => {
		before(async () => {
			config = curveConvexConfig
			wrapper = curveConvexWrapper
			lpToken = await ERC20.at(config.lpToken)
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

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Balancer-Aura wrapper tests
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	describe("Balancer-Aura Staking Wrapper", async () => {
		before(async () => {
			config = balancerAuraConfig
			wrapper = balancerAuraWrapper
			lpToken = await ERC20.at(config.lpToken)
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

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Maverick wrapper tests
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	describe("Maverick Staking Wrapper", async () => {

		/**
		 * Function that gives LDO and swETH tokens to be distributed as rewards to Maverick's Rewards contract.
		 */
		async function fundMaverickRewards() {
			const rewardsContract = await MaverickRewards.at(config.rewards)
			const duration = 30 * 86_400 // 3 <= days <= 30

			const rewardToken1 = "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32" // LDO
			const rewardAmount1 = toEther(50) // rewardFactory.minimumRewardAmount = 40
			const rewardToken1Provider = "0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c" // Lido Agent aka whale
			await setBalance(rewardToken1Provider, 10e18) // for gas
			await impersonateAccount(rewardToken1Provider)
			await (await ERC20.at(rewardToken1)).approve(rewardsContract.address, rewardAmount1, { from: rewardToken1Provider })
			await rewardsContract.notifyAndTransfer(rewardToken1, rewardAmount1, duration, { from: rewardToken1Provider })
			await stopImpersonatingAccount(rewardToken1Provider)

			const rewardToken2 = "0xf951E335afb289353dc249e82926178EaC7DEd78" // swETH
			const rewardAmount2 = toEther(5) // rewardFactory.minimumRewardAmount = 0.052600000
			const rewardToken2Provider = "0xBA12222222228d8Ba445958a75a0704d566BF2C8" // Balancer Vault aka whale
			await setBalance(rewardToken2Provider, 10e18) // for gas
			await impersonateAccount(rewardToken2Provider)
			await (await ERC20.at(rewardToken2)).approve(rewardsContract.address, rewardAmount2, { from: rewardToken2Provider })
			await rewardsContract.notifyAndTransfer(rewardToken2, rewardAmount2, duration, { from: rewardToken2Provider })
			await stopImpersonatingAccount(rewardToken2Provider)
		}

		before(async () => {
			config = maverickConfig
			wrapper = maverickWrapper
			lpToken = await ERC20.at(config.lpToken)
			await fundMaverickRewards()
		})

		beforeEach(async () => {
			snapshotId = await network.provider.send("evm_snapshot")
		})

		afterEach(async () => {
			await network.provider.send("evm_revert", [snapshotId])
		})

		it("Maverick: on happy path, openVessel & closeVessel should not transfer reward rights", async () => {
			await itHappyPath()
		})

		it("Maverick: Liquidation using stability pool deposits should transfer reward rights to treasury", async () => {
			await itLiquidation()
		})

		it("Maverick: Redemption should transfer rewards rights", async () => {
			await itRedemption()
		})
	})
})

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Wrapper-agnostic unit tests
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Happy path test: alice and bob both deposit into wrapper, but only alice opens & closes a vessel; after 90 days,
 * they unwrap and withdraw their LP tokens: it is expected that both should end up with the same amount of claimed
 * rewards, and that treasury should have captured the protocol fees.
 */
async function itHappyPath() {
	const aliceInitialLpTokenBalance = await lpToken.balanceOf(alice)
	const bobInitialLpTokenBalance = await lpToken.balanceOf(bob)

	// alice & bob deposit into wrapper
	console.log(`\n --> deposit(alice)\n`)
	await wrapper.deposit(aliceInitialLpTokenBalance, { from: alice })
	console.log(`\n --> deposit(bob)\n`)
	await wrapper.deposit(bobInitialLpTokenBalance, { from: bob })

	// only alice opens a vessel
	console.log(`\n--> openVessel(alice)\n`)
	await openVessel(alice)
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
	if (wrapper.earmarkBoosterRewards) {
		await wrapper.earmarkBoosterRewards()
	}
	await wrapper.claimEarnedRewards({ from: alice })
	await wrapper.claimEarnedRewards({ from: bob })
	for (const r of await wrapper.getEarnedRewards(treasury)) {
		await wrapper.claimTreasuryEarnedRewards((await wrapper.registeredRewards(r.token)) - 1)
	}

	console.log(`\n--> withdraw(alice, bob)\n`)
	await wrapper.withdraw(await wrapper.balanceOf(alice), { from: alice })
	await wrapper.withdraw(await wrapper.balanceOf(bob), { from: bob })

	// checks
	const aliceLpTokenBalance = await lpToken.balanceOf(alice)
	const aliceRewardBalances = await getBalancesOnRewardTokens(alice)
	const aliceWrapperBalance = await wrapper.totalBalanceOf(alice)

	const bobLpTokenBalance = await lpToken.balanceOf(bob)
	const bobRewardBalances = await getBalancesOnRewardTokens(bob)
	const bobWrapperBalance = await wrapper.totalBalanceOf(bob)

	const treasuryLpTokenBalance = await lpToken.balanceOf(treasury)
	const treasuryRewardBalances = await getBalancesOnRewardTokens(treasury)
	const treasuryWrapperBalance = await wrapper.totalBalanceOf(treasury)

	assert.equal(aliceLpTokenBalance.toString(), aliceInitialLpTokenBalance.toString())
	assert.equal(bobLpTokenBalance.toString(), bobInitialLpTokenBalance.toString())
	assert.equal(aliceWrapperBalance.toString(), "0")
	assert.equal(bobWrapperBalance.toString(), "0")
	assert.equal(treasuryWrapperBalance.toString(), "0")
	assert.equal(treasuryLpTokenBalance.toString(), "0")

	const protocolFee = await wrapper.protocolFee()

	for (let i = 0; i < aliceRewardBalances.length; i++) {
		const aliceRewardTokenAmount = aliceRewardBalances[i].amount
		const bobRewardTokenAmount = bobRewardBalances[i].amount
		const treasuryRewardTokenAmount = treasuryRewardBalances[i].amount

		const sum = aliceRewardTokenAmount.add(bobRewardTokenAmount).add(treasuryRewardTokenAmount)

		// alice & bob should have earned similar amounts of each reward token (.5% deviation accepted)
		assertIsApproximatelyEqual(aliceRewardTokenAmount, bobRewardTokenAmount, Number(aliceRewardTokenAmount) / 200)

		// treasury should have earned the `protocolFee` (15% of total)
		const expectedTreasuryRewardTokenAmount = Number(sum) * (Number(protocolFee) / 1e18)
		assertIsApproximatelyEqual(
			treasuryRewardTokenAmount,
			expectedTreasuryRewardTokenAmount,
			Number(treasuryRewardTokenAmount) / 200
		)
	}

	// remaining rewards on wrapper should belong to whale and corresponding treasury share (.5% deviation accepted)
	const wrapperRewardBalances = await getBalancesOnRewardTokens(wrapper.address)

	await wrapper.userCheckpoint(whale)
	const whaleRewards = await wrapper.getEarnedRewards(whale)
	const treasuryRewards = await wrapper.getEarnedRewards(treasury)

	for (let i = 0; i < whaleRewards.length; i++) {
		const remainingClaimableRewards = BigInt(whaleRewards[i].amount) + BigInt(treasuryRewards[i].amount)
		assertIsApproximatelyEqual(
			wrapperRewardBalances[i].amount,
			remainingClaimableRewards,
			Number(remainingClaimableRewards) / 200
		)
	}
}

/**
 * Liquidation test: alice & bob open vessels, and after 30 days alice gets liquidated; 30 more days goes by,
 * bob closes his vessel, and the SP provider withdraws his gains. It is expected that alice's rewards
 * stopped at day 30, and that the treasury gained rewards while alice's collateral was sitting in the 
 * StabilityPool waiting to be claimed.
 */
async function itLiquidation() {
	const aliceInitialLpTokenBalance = await lpToken.balanceOf(alice)
	const bobInitialLpTokenBalance = await lpToken.balanceOf(bob)

	// alice & bob deposit into wrapper
	console.log(`\n--> deposit(alice & bob)\n`)
	await wrapper.deposit(aliceInitialLpTokenBalance, { from: alice })
	await wrapper.deposit(bobInitialLpTokenBalance, { from: bob })

	// whale provides to SP
	const whaleInitialDebtTokenBalance = await debtToken.balanceOf(whale)
	console.log(`\n--> provideToSP(whale, ${f(whaleInitialDebtTokenBalance)} GRAI)\n`)
	await stabilityPool.provideToSP(whaleInitialDebtTokenBalance, [], { from: whale })

	// alice & bob open vessels
	console.log(`\n--> openVessel(alice)\n`)
	await openVessel(alice)
	console.log(`\n--> openVessel(bob)\n`)
	await openVessel(bob)

	// fast forward 30 days
	console.log(`\n--> time.increase() :: t = 30\n`)
	await time.increase(30 * 86_400)

	// price drops 10%, liquidate alice (but leave bob alone, on purpose)
	await dropPriceByPercent(wrapper.address, 10)

	await printClaimableBalances([alice, bob, treasury])

	console.log(`\n--> liquidate(alice)\n`)
	await vesselManagerOperations.liquidate(wrapper.address, alice, { from: liquidator })

	// fast forward another 30 days
	console.log(`\n--> time.increase() :: t = 60\n`)
	await time.increase(30 * 86_400)

	await printClaimableBalances([alice, bob, treasury])

	// whale withdraws SP deposit
	console.log(`\n--> withdrawFromSP(whale)\n`)
	const whaleBalanceSP = await stabilityPool.getCompoundedDebtTokenDeposits(whale)
	await stabilityPool.withdrawFromSP(whaleBalanceSP, [wrapper.address], { from: whale })

	// bob closes vessel
	console.log(`\n--> closeVessel(bob)\n`)
	await borrowerOperations.closeVessel(wrapper.address, { from: bob })

	// alice, bob and treasury claim rewards
	console.log(`\n--> claimEarnedRewards(alice, bob, treasury)\n`)
	if (wrapper.earmarkBoosterRewards) {
		await wrapper.earmarkBoosterRewards()
	}
	await wrapper.claimEarnedRewards({ from: alice })
	await wrapper.claimEarnedRewards({ from: bob })
	await wrapper.claimEarnedRewards({ from: liquidator })
	for (const r of await wrapper.getEarnedRewards(treasury)) {
		await wrapper.claimTreasuryEarnedRewards((await wrapper.registeredRewards(r.token)) - 1)
	}

	// bob withdraws; alice was liquidated and has no balance
	console.log(`\n--> withdraw(bob) :: ${f(await wrapper.balanceOf(bob))}\n`)
	await wrapper.withdraw(await wrapper.balanceOf(bob), { from: bob })

	// checks
	const aliceLpTokenBalance = await lpToken.balanceOf(alice)
	const aliceRewardBalances = await getBalancesOnRewardTokens(alice)
	const aliceWrapperBalance = await wrapper.totalBalanceOf(alice)

	const bobLpTokenBalance = await lpToken.balanceOf(bob)
	const bobRewardBalances = await getBalancesOnRewardTokens(bob)
	const bobWrapperBalance = await wrapper.totalBalanceOf(bob)

	const treasuryLpTokenBalance = await lpToken.balanceOf(treasury)
	const treasuryRewardBalances = await getBalancesOnRewardTokens(treasury)
	const treasuryWrapperBalance = await wrapper.totalBalanceOf(treasury)

	console.log(`\naliceLpTokenBalance: ${f(aliceLpTokenBalance)}`)
	console.log(`aliceWrapperBalance: ${f(aliceWrapperBalance)}`)

	console.log(`\nbobLpTokenBalance: ${f(bobLpTokenBalance)}`)
	console.log(`bobWrapperBalance: ${f(bobWrapperBalance)}`)

	console.log(`\ntreasuryLpTokenBalance: ${f(treasuryLpTokenBalance)}`)
	console.log(`treasuryWrapperBalance: ${f(treasuryWrapperBalance)}`)

	assert.equal(aliceLpTokenBalance.toString(), "0") // alice lost her collateral on liquidation
	assert.equal(bobLpTokenBalance.toString(), bobInitialLpTokenBalance.toString())
	assert.equal(aliceWrapperBalance.toString(), "0")
	assert.equal(bobWrapperBalance.toString(), "0")
	assert.equal(treasuryLpTokenBalance.toString(), "0")

	// remaining rewards on wrapper should belong to whale and corresponding treasury share (.5% deviation accepted)
	const wrapperRewardBalances = await getBalancesOnRewardTokens(wrapper.address)

	await wrapper.userCheckpoint(whale)
	const whaleRewards = await wrapper.getEarnedRewards(whale)
	const treasuryRewards = await wrapper.getEarnedRewards(treasury)

	for (let i = 0; i < whaleRewards.length; i++) {
		const remainingClaimableRewards = BigInt(whaleRewards[i].amount) + BigInt(treasuryRewards[i].amount)
		assertIsApproximatelyEqual(
			wrapperRewardBalances[i].amount,
			remainingClaimableRewards,
			Number(remainingClaimableRewards) / 200
		)
	}

	console.log(`\n >>> final standings <<< \n`)
	await printBalancesOnRewardTokens([alice, bob, liquidator, treasury, wrapper.address, whale])
	await printClaimableBalances([treasury, whale])
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
	const aliceInitialLpTokenBalance = await lpToken.balanceOf(alice)
	const bobInitialLpTokenBalance = await lpToken.balanceOf(bob)
	console.log(`\n--> deposit(alice & bob)\n`)
	await wrapper.deposit(aliceInitialLpTokenBalance, { from: alice })
	await wrapper.deposit(bobInitialLpTokenBalance, { from: bob })

	// alice & bob open vessels
	console.log(`\n--> openVessel(alice)\n`)
	await openVessel(alice)
	console.log(`\n--> openVessel(bob)\n`)
	await openVessel(bob)

	// fast forward 30 days
	console.log(`\n--> time.increase() :: t = 30\n`)
	await time.increase(30 * 86_400)

	// whale redeems some of his GRAI
	const redemptionAmount = toEther(5_000)
	console.log(`\n--> redeemCollateral(whale) :: ${f(redemptionAmount)} GRAI\n`)
	await redeem(redemptionAmount, whale)

	// TODO checks
	await printClaimableBalances([alice, bob])
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Helper functions
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const addrToName = (addr: string) => {
	switch (addr) {
		case alice:
			return `alice`
		case bob:
			return `bob`
		case carol:
			return `carol`
		case liquidator:
			return `liquidator`
		case redeemer:
			return `redeemer`
		case treasury:
			return `treasury`
		case whale:
			return `whale`
		case wrapper.address:
			return `wrapper`
	}
	return `${addr.substring(0, 6)}...`
}

function assertIsApproximatelyEqual(x: any, y: any, error = 1_000) {
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, error)
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
	let wrapper, initParams
	if (cfg.wrapperType == WrapperType.CurveConvex) {
		wrapper = await CurveConvexStakingWrapper.new()
		initParams = [cfg.booster, cfg.crv, cfg.cvx, cfg.poolId]
	} else if (cfg.wrapperType == WrapperType.BalancerAura) {
		wrapper = await BalancerAuraStakingWrapper.new()
		initParams = [cfg.booster, cfg.crv, cfg.cvx, cfg.poolId]
	} else {
		wrapper = await MaverickStakingWrapper.new()
		initParams = [cfg.lpToken, cfg.rewards]
	}
	await wrapper.initialize(...initParams)
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

async function dropPriceByPercent(collAddress: string, pct: number) {
	const price = await priceFeed.getPrice(collAddress)
	const newPrice = (BigInt(price) * BigInt(100 - pct)) / BigInt(100)
	await priceFeed.setPrice(collAddress, newPrice)
}

async function getBalancesOnRewardTokens(account: string): Promise<RewardEarned[]> {
	const rewardsLength = await wrapper.rewardsLength()
	const rewardsTokensBalances: RewardEarned[] = []
	for (let i = 0; i < rewardsLength; i++) {
		const { token } = await wrapper.rewards(i)
		const index = await wrapper.registeredRewards(token)
		const amount = await (await ERC20.at(token)).balanceOf(account)
		rewardsTokensBalances.push({
			token,
			index,
			amount,
		})
	}
	return rewardsTokensBalances
}

const f = (v: any) => ethers.utils.formatEther(v.toString())

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

async function openVessel(account: string) {
	const accountBalance = await wrapper.balanceOf(account)
	const maxLoan = await calcMaxLoan(accountBalance)
	await borrowerOperations.openVessel(wrapper.address, accountBalance, maxLoan, AddressZero, AddressZero, {
		from: account,
	})
}

async function printBalancesOnRewardTokens(accounts: string[]) {
	for (const account of accounts) {
		const username = addrToName(account)
		const userTokens: RewardEarned[] = await getBalancesOnRewardTokens(account)
		for (const { token, amount } of userTokens) {
			const symbol = await tokenSymbol(token)
			console.log(`${symbol}.balanceOf(${username}): ${f(amount)}`)
		}
	}
}

async function printClaimableBalances(accounts: string[]) {
	for (const account of accounts) {
		const username = addrToName(account)
		await wrapper.userCheckpoint(account)
		const earnedRewards = await wrapper.getEarnedRewards(account)
		for (const { 0: token, 1: amount } of earnedRewards) {
			const symbol = await tokenSymbol(token)
			console.log(`Wrapper.getEarnedRewards(${username}).${symbol}: ${f(amount)}`)
		}
	}
}

async function redeem(redemptionAmount: BigNumber, redeemer: string) {
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
		{ from: redeemer }
	)
}

async function setupPositions(wrapper: any, cfg: StakingWrapperTestConfig) {
	const lpToken = await ERC20.at(cfg.lpToken)
	// assign LP tokens to whale, alice and bob
	await impersonateAccount(cfg.piggyBank)
	await setBalance(cfg.piggyBank, 20e18)
	await lpToken.transfer(whale, toEther(50), { from: cfg.piggyBank })
	await lpToken.transfer(alice, toEther(10), { from: cfg.piggyBank })
	await lpToken.transfer(bob, toEther(10), { from: cfg.piggyBank })
	await lpToken.transfer(carol, toEther(10), { from: cfg.piggyBank })
	await stopImpersonatingAccount(cfg.piggyBank)
	// issue token transfer approvals
	await lpToken.approve(wrapper.address, MaxUint256, { from: whale })
	await lpToken.approve(wrapper.address, MaxUint256, { from: alice })
	await lpToken.approve(wrapper.address, MaxUint256, { from: bob })
	await lpToken.approve(wrapper.address, MaxUint256, { from: carol })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: whale })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: alice })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: bob })
	await wrapper.approve(borrowerOperations.address, MaxUint256, { from: carol })
	// whale opens a vessel
	const whaleCurveBalance = await lpToken.balanceOf(whale)
	await wrapper.deposit(whaleCurveBalance, { from: whale })
	console.log(`\n--> openVessel(whale, ${f(whaleCurveBalance)}) => ${f(toEther(50_000))} GRAI\n`)
	await borrowerOperations.openVessel(wrapper.address, whaleCurveBalance, toEther(50_000), AddressZero, AddressZero, {
		from: whale,
	})
	// give alice, bob & carol some grai ($1,000 each) for fees
	await debtToken.transfer(alice, toEther(1_000), { from: whale })
	await debtToken.transfer(bob, toEther(1_000), { from: whale })
	await debtToken.transfer(carol, toEther(1_000), { from: whale })
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
	maverickWrapper = await deployWrapperContract(maverickConfig)
	await setupWrapperAsCollateral(curveConvexWrapper)
	await setupWrapperAsCollateral(balancerAuraWrapper)
	await setupWrapperAsCollateral(maverickWrapper)
	await setupPositions(curveConvexWrapper, curveConvexConfig)
	await setupPositions(balancerAuraWrapper, balancerAuraConfig)
	await setupPositions(maverickWrapper, maverickConfig)
}

const toEther = (v: any) => ethers.utils.parseEther(v.toString())

const tokenSymbol = async (addr: string) => await (await ERC20.at(addr)).symbol()
