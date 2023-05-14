const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN } = th
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

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
	shortTimelock = contracts.core.shortTimelock
	longTimelock = contracts.core.longTimelock

	grvtStaking = contracts.grvt.grvtStaking
	grvtToken = contracts.grvt.grvtToken
	communityIssuance = contracts.grvt.communityIssuance
}

contract("CollSurplusPool", async accounts => {
	const [A, B, treasury] = accounts

	before(async () => {
		await deploy(treasury, [])
		for (const acc of accounts.slice(0, 2)) {
			await erc20.mint(acc, await web3.eth.getBalance(acc))
		}
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

	it("getAssetBalance(): Returns the collateral balance of the CollSurplusPool after redemption", async () => {
		const balance = await collSurplusPool.getAssetBalance(erc20.address)
		assert.equal(balance, "0")

		const price = toBN(dec(100, 18))
		const redemption_soften_param = toBN(970)

		await priceFeed.setPrice(erc20.address, price)

		const { collateral: B_coll, netDebt: B_netDebt } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			assetSent: dec(3000, "ether"),
			extraVUSDAmount: B_netDebt,
			extraParams: { from: A },
		})

		// skip bootstrapping phase
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

		// At ETH:USD = 100, this redemption should leave 1 ether of coll surplus
		await th.redeemCollateralAndGetTxObject(A, contracts.core, B_netDebt, erc20.address)

		const ETH_2 = await collSurplusPool.getAssetBalance(erc20.address)
		th.assertIsApproximatelyEqual(
			ETH_2,
			B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price).mul(redemption_soften_param).div(toBN(1000)))
		)
	})

	it("claimColl(): Reverts if caller is not Borrower Operations", async () => {
		await th.assertRevert(
			collSurplusPool.claimColl(erc20.address, A, { from: A }),
			"CollSurplusPool: Caller is not Borrower Operations"
		)
	})

	it("claimColl(): Reverts if nothing to claim", async () => {
		await th.assertRevert(
			borrowerOperations.claimCollateral(erc20.address, { from: A }),
			"CollSurplusPool: No collateral available to claim"
		)
	})

	// Removed as we won't be dealing with pure ETH
	/* it("CollSurplusPool: claimColl(): Reverts if owner cannot receive ETH surplus", async () => {
		const nonPayable = await NonPayable.new()
		const price = toBN(dec(100, 18))
		await priceFeed.setPrice(price)
		// open vessel from NonPayable proxy contract
		const B_coll = toBN(dec(60, 18))
		const B_VUSDAmount = toBN(dec(3000, 18))
		const B_netDebt = await th.getAmountWithBorrowingFee(contracts, B_VUSDAmount)
		const openVesselData = th.getTransactionData(
			"openVessel(address,uint256,uint256,uint256,address,address)",
			[erc20.address, 0, "0xde0b6b3a7640000", web3.utils.toHex(B_VUSDAmount), B, B]
		)
		await nonPayable.forward(borrowerOperations.address, openVesselData, { value: B_coll })
		await openVessel({
			asset: erc20.address,
			assetSent: dec(3000, "ether"),
			extraVUSDAmount: B_netDebt,
			extraParams: { from: A },
		})
		// skip bootstrapping phase
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)
		// At ETH:USD = 100, this redemption should leave 1 ether of coll surplus for B
		await th.redeemCollateralAndGetTxObject(A, contracts, B_netDebt, erc20.address)
		const ETH_2 = await collSurplusPool.getAssetBalance(erc20.address)
		th.assertIsApproximatelyEqual(ETH_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price)))
		const claimCollateralData = th.getTransactionData("claimCollateral(address)", [
			erc20.address,
		])
		await th.assertRevert(
			nonPayable.forward(borrowerOperations.address, claimCollateralData),
			"CollSurplusPool: sending ETH failed"
		)
	}) */

	it("fallback(): reverts trying to send ETH to it", async () => {
		await th.assertRevert(
			web3.eth.sendTransaction({ from: A, to: collSurplusPool.address, value: 1 }),
			"CollSurplusPool: Caller is not Active Pool"
		)
	})

	it("accountSurplus(): reverts if caller is not Vessel Manager", async () => {
		await th.assertRevert(
			collSurplusPool.accountSurplus(erc20.address, A, 1),
			"CollSurplusPool: Caller is not VesselManager"
		)
	})
})

contract("Reset chain state", async accounts => {})
