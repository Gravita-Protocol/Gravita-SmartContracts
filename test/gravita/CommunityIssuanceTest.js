const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const CommunityIssuance = artifacts.require("CommunityIssuance")

const th = testHelpers.TestHelper
const { dec, toBN } = th

var contracts
var snapshotId
var initialSnapshotId

const deploy = async (treasury, mintingAccounts) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)

	activePool = contracts.core.activePool
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	collSurplusPool = contracts.core.collSurplusPool
	debtToken = contracts.core.debtToken
	defaultPool = contracts.core.defaultPool
	erc20 = contracts.core.erc20
	feeCollector = contracts.core.feeCollector
	gasPool = contracts.core.gasPool
	priceFeed = contracts.core.priceFeedTestnet
	sortedVessels = contracts.core.sortedVessels
	stabilityPool = contracts.core.stabilityPool
	vesselManager = contracts.core.vesselManager
	vesselManagerOperations = contracts.core.vesselManagerOperations
	shortTimelock = contracts.core.shortTimelock
	longTimelock = contracts.core.longTimelock

	grvtStaking = contracts.grvt.grvtStaking
	grvtToken = contracts.grvt.grvtToken
	communityIssuance = contracts.grvt.communityIssuance
}

contract("CommunityIssuance", async accounts => {
	const assertRevert = th.assertRevert
	const [owner, user, oldTreasury, treasury] = accounts
	const timeValues = testHelpers.TimeValues

	describe("Community Issuance", async () => {
		before(async () => {
			await deploy(oldTreasury, accounts.slice(0, 10))

			communityIssuance = await CommunityIssuance.new()
			await communityIssuance.initialize()
			await communityIssuance.setAddresses(
				grvtToken.address,
				stabilityPool.address,
				adminContract.address
			)
			await communityIssuance.transferOwnership(treasury, { from: owner })
			const supply = dec(32_000_000, 18)
			await grvtToken.unprotectedMint(treasury, supply)
			await contracts.grvt.grvtToken.approve(communityIssuance.address, ethers.constants.MaxUint256, { from: treasury })

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

		it("Owner(): Contract has been initialized, owner should be the treasury", async () => {
			assert.equal(await communityIssuance.owner(), treasury)
		})

		it("addFundToStabilityPool: Called by user, valid inputs, revert transaction", async () => {
			await communityIssuance.addFundToStabilityPool(dec(100, 18), {
				from: treasury,
			})
			await assertRevert(
				communityIssuance.addFundToStabilityPool(dec(100, 18), {
					from: user,
				})
			)
		})

		it("addFundToStabilityPool: Called by owner, valid inputs, add stability pool", async () => {
			await communityIssuance.addFundToStabilityPool(dec(100, 18), {
				from: treasury,
			})
			await communityIssuance.addFundToStabilityPool(dec(100, 18), { from: treasury })
			assert.equal((await communityIssuance.GRVTSupplyCap()).toString(), dec(200, 18))
		})

		it("addFundToStabilityPool: Called by owner twice, double total supply, don't change deploy time", async () => {
			await communityIssuance.addFundToStabilityPool(dec(100, 18), {
				from: treasury,
			})

			const deployTimePool = await communityIssuance.lastUpdateTime()

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

			await communityIssuance.addFundToStabilityPool(dec(100, 18), {
				from: treasury,
			})

			const deployTimePoolAfter = await communityIssuance.lastUpdateTime()

			assert.equal((await communityIssuance.GRVTSupplyCap()).toString(), dec(200, 18))
			assert.equal(deployTimePool.toString(), deployTimePoolAfter.toString())
		})

		it("addFundToStabilityPool: Called by owner, valid inputs, change total supply", async () => {
			const supply = toBN(dec(100, 18))

			await communityIssuance.addFundToStabilityPool(supply, {
				from: treasury,
			})
			await communityIssuance.addFundToStabilityPool(supply, {
				from: treasury,
			})

			assert.equal((await communityIssuance.GRVTSupplyCap()).toString(), supply.mul(toBN(2)))
		})

		it("removeFundFromStabilityPool: Called by user, valid inputs, then reverts", async () => {
			const supply = toBN(dec(100, 18))

			await communityIssuance.addFundToStabilityPool(supply, {
				from: treasury,
			})
			await assertRevert(
				communityIssuance.removeFundFromStabilityPool(dec(50, 18), {
					from: user,
				})
			)
		})

		it("removeFundFromStabilityPool: Called by owner, invalid inputs, then reverts", async () => {
			const supply = toBN(dec(100, 18))

			await communityIssuance.addFundToStabilityPool(supply, {
				from: treasury,
			})
			await assertRevert(
				communityIssuance.removeFundFromStabilityPool(dec(101, 18), {
					from: treasury,
				})
			)
		})

		it("removeFundFromStabilityPool: Called by owner, valid amount, then remove from supply and give to caller", async () => {
			const supply = toBN(dec(100, 18))
			await communityIssuance.addFundToStabilityPool(supply, {
				from: treasury,
			})

			const beforeBalance = await grvtToken.balanceOf(communityIssuance.address)
			const beforeBalanceTreasury = await grvtToken.balanceOf(treasury)

			await communityIssuance.removeFundFromStabilityPool(dec(50, 18), {
				from: treasury,
			})
			assert.equal((await communityIssuance.GRVTSupplyCap()).toString(), dec(50, 18))
			assert.equal(
				(await grvtToken.balanceOf(communityIssuance.address)).toString(),
				beforeBalance.sub(toBN(dec(50, 18)))
			)
			assert.equal(
				(await grvtToken.balanceOf(treasury)).toString(),
				beforeBalanceTreasury.add(toBN(dec(50, 18))).toString()
			)
		})

		it("removeFundFromStabilityPool: Called by owner, max supply, then disable pool", async () => {
			const supply = toBN(dec(100, 18))
			await communityIssuance.addFundToStabilityPool(supply, {
				from: treasury,
			})
			await communityIssuance.removeFundFromStabilityPool(supply, {
				from: treasury,
			})

			assert.equal((await communityIssuance.GRVTSupplyCap()).toString(), 0)
			assert.equal((await communityIssuance.totalGRVTIssued()).toString(), 0)
		})
	})
})

contract("Reset chain state", async accounts => {})
