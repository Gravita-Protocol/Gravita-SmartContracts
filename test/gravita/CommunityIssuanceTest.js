const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const StabilityPool = artifacts.require("StabilityPool.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract("CommunityIssuance", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const assertRevert = th.assertRevert
	const DECIMAL_PRECISION = toBN(dec(1, 18))
	const [owner, user, A, C, B, multisig, treasury] = accounts
	const timeValues = testHelpers.TimeValues

	let communityIssuance
	let stabilityPool
	let stabilityPoolERC20
	let grvtToken
	let erc20

	describe("Community Issuance", async () => {
		async function deployContractsFixture() {
			contracts = await deploymentHelper.deployGravitaCore()
			contracts.vesselManager = await VesselManagerTester.new()
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(treasury)

			grvtToken = GRVTContracts.grvtToken
			communityIssuance = GRVTContracts.communityIssuance
			erc20 = contracts.erc20

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts, true)

			stabilityPool = contracts.stabilityPool

			await communityIssuance.transferOwnership(treasury)
			await GRVTContracts.grvtToken.approve(
				GRVTContracts.communityIssuance.address,
				ethers.constants.MaxUint256,
				{ from: treasury }
			)
		}
		beforeEach(async () => {
			await loadFixture(deployContractsFixture)
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

