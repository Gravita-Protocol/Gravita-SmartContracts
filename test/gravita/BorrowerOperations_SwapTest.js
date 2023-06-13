const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants.js")

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN, assertRevert } = th

var contracts
var snapshotId
var initialSnapshotId

const openVessel = async params => th.openVessel(contracts.core, params)
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
}

const f = v => ethers.utils.commify(ethers.utils.formatEther(v.toString()))

contract("BorrowerOperations - Swap Tests", async accounts => {
	const [owner, whale, alice, bob, treasury] = accounts

	describe("Debt Swap on Vessel Close", async () => {
		before(async () => {
			await deploy(treasury, accounts.slice(0, 3))
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(20, 18)),
                extraGRAIAmount: toBN(dec(15_000, 18)),
				extraParams: { from: whale },
			})
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

		it("closeVesselWithDebtSwap(): insufficient balance for netDebt, reverts", async () => {
			// alice opens vessel
			const collAmount = dec(10_000, 18)
			const borrowAmount = dec(1_000_000, 18)
			await borrowerOperations.openVessel(erc20.address, collAmount, borrowAmount, ZERO_ADDRESS, ZERO_ADDRESS, {
				from: alice,
			})
            // alice transfers tiny amount to someone else, and now she owns less than her net debt
            await debtToken.transfer(bob, 1, { from: alice })
            assertRevert(borrowerOperations.closeVesselWithDebtSwap(erc20.address, { from: alice }))
		})

		it("closeVesselWithDebtSwap(): sufficient balance for full debt, no swap", async () => {
			// alice opens vessel
			const collAmount = dec(10_000, 18)
			const borrowAmount = dec(1_000_000, 18)
            const aliceCollBalanceBefore = await erc20.balanceOf(alice)
			await borrowerOperations.openVessel(erc20.address, collAmount, borrowAmount, ZERO_ADDRESS, ZERO_ADDRESS, {
				from: alice,
			})
            // alice receives enough borrowingFee from someone, so she won't need a swap
            const borrowingFee = await vesselManager.getBorrowingFee(erc20.address, borrowAmount)
            await debtToken.transfer(alice, borrowingFee, { from: whale })
            await borrowerOperations.closeVesselWithDebtSwap(erc20.address, { from: alice })
            const aliceCollBalanceAfter = await erc20.balanceOf(alice)
            // no changes to her collateral
            assert.equal(aliceCollBalanceAfter.toString(), aliceCollBalanceBefore.toString())
        })

		it("closeVesselWithDebtSwap(): swapAmount <= borrowingFee, succeeds", async () => {})
	})
})
