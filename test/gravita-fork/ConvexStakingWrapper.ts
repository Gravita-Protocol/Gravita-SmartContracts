import { artifacts, ethers, network } from "hardhat"
import {
	setBalance,
	time,
	impersonateAccount,
	stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers"

const AdminContract = artifacts.require("AdminContract")
const MockAggregator = artifacts.require("MockAggregator")
const PriceFeed = artifacts.require("PriceFeed")

const BaseRewardPool = artifacts.require("IBaseRewardPool")
const Booster = artifacts.require("IBooster")
const ConvexStakingWrapper = artifacts.require("ConvexStakingWrapper")
const IERC20 = artifacts.require("IERC20")

let adminContract: any
let wrapper: any
let wrapperPriceFeed: any

let booster: any
let crv: any
let cvx: any
let curveLP: any
let convexLP: any
let convexRewards: any

let gaugeAddress = "0x7E1444BA99dcdFfE8fBdb42C02F0005D14f13BE1"
let poolId = 64

let snapshotId: number, initialSnapshotId: number
let alice: string, bob: string, deployer: string

const f = (v: any) => ethers.utils.formatEther(v.toString())
const toEther = (v: any) => ethers.utils.parseEther(v.toString())
const addrToName = (v: string) => (v == alice ? `alice` : v == bob ? `bob` : `${v.substring(0, 6)}...`)

const printBalances = async (accounts: string[]) => {
	await wrapper.earmarkBoosterRewards()
	for (const account of accounts) {
		await wrapper.userCheckpoint(account)
		console.log(`Wrapper.earned(${addrToName(account)}): ${formatEarnedData(await wrapper.getEarnedRewards(account))}`)
		console.log(`CRV.balanceOf(${addrToName(account)}): ${f(await crv.balanceOf(account))}`)
		console.log(`CVX.balanceOf(${addrToName(account)}): ${f(await cvx.balanceOf(account))}`)
	}
	console.log(
		`Wrapper.earned(treasury): ${formatEarnedData(await wrapper.getEarnedRewards(await wrapper.treasuryAddress()))}`
	)
	console.log(`CRV.balanceOf(wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
	console.log(`CVX.balanceOf(wrapper): ${f(await cvx.balanceOf(wrapper.address))}`)
}

const printRewards = async () => {
	let rewardCount = await wrapper.rewardsLength()
	for (var i = 0; i < rewardCount; i++) {
		var r = await wrapper.rewards(i)
		console.log(`Reward #${i}: ${formatRewardType(r)}`)
	}
}

const formatRewardType = (r: any) => {
	const token = r.token == crv.address ? "CRV" : r.token == cvx.address ? "CVX" : r.token
	return `[${token}] integral: ${f(r.integral)} remaining: ${f(r.remaining)}`
}

const formatEarnedData = (earnedDataArray: any) => {
	return earnedDataArray.map((d: any) => {
		const token = d[0] == crv.address ? "CRV" : d[0] == cvx.address ? "CVX" : d[0]
		return `[${token}] = ${f(d[1])}`
	})
}

const deployWrapper = async (poolId: number) => {
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
			await adminContract.treasuryAddress(),
			await adminContract.timelockAddress(),
			await adminContract.vesselManager(),
			await adminContract.vesselManagerOperations(),
		],
		{ from: deployer }
	)
}

const setupWrapperAsCollateral = async () => {
	// Setup a mock price feed (as owner)
	const gravitaOwner = await adminContract.owner()
	await setBalance(gravitaOwner, 10e18)
	await impersonateAccount(gravitaOwner)
	wrapperPriceFeed = await MockAggregator.new({ from: gravitaOwner })
	const priceFeed = await PriceFeed.at(await adminContract.priceFeed())
	await priceFeed.setOracle(wrapper.address, wrapperPriceFeed.address, 0, 3_600, false, false, { from: gravitaOwner })
	await stopImpersonatingAccount(gravitaOwner)

	// Setup collateral (as timelock)
	const timelockAddress = await adminContract.timelockAddress()
	await setBalance(timelockAddress, 10e18)
	await impersonateAccount(timelockAddress)
	await adminContract.addNewCollateral(wrapper.address, toEther("200"), 18, { from: timelockAddress })
	await adminContract.setCollateralParameters(
		wrapper.address,
		await adminContract.BORROWING_FEE_DEFAULT(),
		toEther(1.4),
		toEther(1.111),
		toEther(2_000),
		toEther(1_500_000),
		await adminContract.PERCENT_DIVISOR_DEFAULT(),
		await adminContract.REDEMPTION_FEE_FLOOR_DEFAULT(),
		{ from: timelockAddress }
	)
	await stopImpersonatingAccount(timelockAddress)
}

describe("ConvexStakingWrapper", async () => {
	before(async () => {
		initialSnapshotId = await network.provider.send("evm_snapshot")

		adminContract = await AdminContract.at("0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53")

		booster = await Booster.at("0xF403C135812408BFbE8713b5A23a04b3D48AAE31")
		cvx = await IERC20.at("0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B")
		crv = await IERC20.at("0xD533a949740bb3306d119CC777fa900bA034cd52")
		curveLP = await IERC20.at("0x3A283D9c08E8b55966afb64C515f5143cf907611")
		convexLP = await IERC20.at("0x0bC857f97c0554d1d0D602b56F2EEcE682016fBA")
		convexRewards = await BaseRewardPool.at("0xb1Fb0BA0676A1fFA83882c7F4805408bA232C1fA")

		const accounts = await ethers.getSigners()
		deployer = await accounts[0].getAddress()
		alice = await accounts[1].getAddress()
		bob = await accounts[2].getAddress()

		await deployWrapper(poolId)
		await setupWrapperAsCollateral()
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

	it.only("simple metrics check", async () => {
		const aliceBalance = toEther("100")
		// give alice 100 curveLP from gauge
		await setBalance(gaugeAddress, 20e18)
		await impersonateAccount(gaugeAddress)
		await curveLP.transfer(alice, aliceBalance, { from: gaugeAddress })
		await stopImpersonatingAccount(gaugeAddress)
		// alice deposits into wrapper
		await curveLP.approve(wrapper.address, aliceBalance, { from: alice })
		await wrapper.depositCurveTokens(aliceBalance, alice, { from: alice })
		// fast forward 10 days
		await time.increase(10 * 86_400)
		await printBalances([alice])
		await printRewards()
	})

	it("happy path: openVessel, closeVessel", async () => {

	})

	it("original test: should deposit lp tokens and earn rewards while being transferable", async () => {
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
