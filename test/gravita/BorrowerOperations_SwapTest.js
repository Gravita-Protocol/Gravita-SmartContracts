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

	const calcFees = async debtAmountBN => {
		const MAX_FEE_FRACTION = toBN(1e18).div(toBN(1000)).mul(toBN(5)) // 0.5%
		const MIN_FEE_FRACTION = toBN(String(await feeCollector.MIN_FEE_FRACTION()))
		const maxFee = MAX_FEE_FRACTION.mul(debtAmountBN).div(toBN(1e18))
		const minFee = MIN_FEE_FRACTION.mul(maxFee).div(toBN(1e18))
		return { minFee, maxFee }
	}

	const generateRandomAddress = () => {
		const crypto = require("crypto")
		const privateKey = "0x" + crypto.randomBytes(32).toString("hex")
		const wallet = new ethers.Wallet(privateKey)
		return wallet.address
	}

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
			const { minFee } = await calcFees(toBN(borrowAmount))
			await debtToken.transfer(alice, minFee, { from: whale })
			await borrowerOperations.closeVesselWithDebtSwap(erc20.address, { from: alice })
			const aliceCollBalanceAfter = await erc20.balanceOf(alice)
			const aliceGraiBalanceAfter = await debtToken.balanceOf(alice)
			// no changes to her collateral
			assert.equal(aliceCollBalanceAfter.toString(), aliceCollBalanceBefore.toString())
			assert.equal(aliceGraiBalanceAfter.toString(), "0")
		})

		it("closeVesselWithDebtSwap(): swapAmount <= borrowingFee, succeeds", async () => {
			// set coll price to 1,500
			const collPrice = dec(1_500, 18)
			await priceFeed.setPrice(erc20.address, collPrice)
			// snapshot at t0
			const activePoolGraiContractBefore = await activePool.getDebtTokenBalance(erc20.address)
			const activePoolCollContractBefore = await activePool.getAssetBalance(erc20.address)
			const aliceGraiBalanceBefore = await debtToken.balanceOf(alice)
			const aliceCollBalanceBefore = await erc20.balanceOf(alice)
			const treasuryGraiBalanceBefore = await debtToken.balanceOf(treasury)
			const treasuryCollBalanceBefore = await erc20.balanceOf(treasury)
			// alice opens vessel
			const collAmount = dec(10_000, 18)
			const borrowAmount = dec(1_000_000, 18)
			await borrowerOperations.openVessel(erc20.address, collAmount, borrowAmount, ZERO_ADDRESS, ZERO_ADDRESS, {
				from: alice,
			})
			// snapshot at t1
			const activePoolCollContractMidway = await activePool.getAssetBalance(erc20.address)
			const aliceGraiBalanceMidway = await debtToken.balanceOf(alice)
			const treasuryGraiBalanceMidway = await debtToken.balanceOf(treasury)
			const treasuryCollBalanceMidway = await erc20.balanceOf(treasury)
			// verify balance changes
			const activePoolContractDiff = activePoolCollContractMidway.sub(activePoolCollContractBefore)
			assert.equal(activePoolContractDiff.toString(), collAmount)
			const aliceGraiBalanceDiff = aliceGraiBalanceMidway.sub(aliceGraiBalanceBefore)
			assert.equal(aliceGraiBalanceDiff.toString(), borrowAmount)
			const treasuryGraiBalanceDiff = treasuryGraiBalanceMidway.sub(treasuryGraiBalanceBefore)
			const { minFee } = await calcFees(toBN(borrowAmount)) // minFee for 1,000,000 is 192.30769
			assert.equal(treasuryGraiBalanceDiff.toString(), minFee)
			let treasuryCollBalanceDiff = treasuryCollBalanceMidway.sub(treasuryCollBalanceBefore)
			assert.equal(treasuryCollBalanceDiff.toString(), "0")
			// alice closes vessel; at a 1,500:1 asset:grai price the 192.30769 grai minFee becomes 0.128205126666666666 coll
			await borrowerOperations.closeVesselWithDebtSwap(erc20.address, { from: alice })
			// snapshot at t2
			const activePoolGraiContractAfter = await activePool.getDebtTokenBalance(erc20.address)
			const activePoolCollContractAfter = await activePool.getAssetBalance(erc20.address)
			const aliceGraiBalanceAfter = await debtToken.balanceOf(alice)
			const aliceCollBalanceAfter = await erc20.balanceOf(alice)
			const treasuryGraiBalanceAfter = await debtToken.balanceOf(treasury)
			const treasuryCollBalanceAfter = await erc20.balanceOf(treasury)
			// verify balance changes
			assert.equal(aliceGraiBalanceAfter.toString(), "0") // alice pays back all her grai
			assert.equal(treasuryGraiBalanceMidway.toString(), treasuryGraiBalanceAfter) // treasury does not get any more GRAI fees on vessel close
			treasuryCollBalanceDiff = treasuryCollBalanceAfter.sub(treasuryCollBalanceBefore)
			const expectedTreasuryCollBalanceDiff = minFee.mul(toBN(1e18)).div(toBN(collPrice))
			assert.equal(treasuryCollBalanceDiff.toString(), expectedTreasuryCollBalanceDiff) // expect treasury to receive 0.1282... coll from alice
			const aliceCollBalanceDiff = aliceCollBalanceBefore.sub(aliceCollBalanceAfter)
			assert.equal(aliceCollBalanceDiff.toString(), expectedTreasuryCollBalanceDiff) // expect alice to be 0.1282... coll short
			assert.equal(activePoolCollContractAfter.toString(), activePoolCollContractBefore)
			assert.equal(activePoolGraiContractAfter.toString(), activePoolGraiContractBefore)
		})
	})
})
