const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")

const VesselManagerTester = artifacts.require("VesselManagerTester")

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN } = th
const mv = testHelpers.MoneyValues

var contracts
var snapshotId
var initialSnapshotId
var validCollateral

const deploy = async (treasury, mintingAccounts) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)

	activePool = contracts.core.activePool
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	collSurplusPool = contracts.core.collSurplusPool
	debtToken = contracts.core.debtToken
	defaultPool = contracts.core.defaultPool
	erc20 = contracts.core.erc20
	erc20B = contracts.core.erc20B
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
	validCollateral = await adminContract.getValidCollateral()
}

contract("VesselManager - in Recovery Mode - back to normal mode in 1 tx", async accounts => {
	const [alice, bob, carol, whale, treasury] = accounts

	const openVessel = async params => th.openVessel(contracts.core, params)

	before(async () => {
		await deploy(treasury, accounts.slice(0, 20))
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

	context("Batch liquidations", () => {
		const setup = async () => {
			const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(296, 16)),
				extraParams: { from: alice },
			})
			const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(280, 16)),
				extraParams: { from: bob },
			})
			const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: carol },
			})

			const totalLiquidatedDebt_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset)

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(340, 16)),
				extraGRAIAmount: totalLiquidatedDebt_Asset,
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(totalLiquidatedDebt_Asset, validCollateral, { from: whale })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)
			const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

			// Check Recovery Mode is active
			assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

			// Check vessels A, B are in range 110% < ICR < TCR, C is below 100%

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
			const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

			assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
			assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
			assert.isTrue(ICR_C_Asset.lt(mv._ICR100))

			return {
				A_coll_Asset,
				A_totalDebt_Asset,
				B_coll_Asset,
				B_totalDebt_Asset,
				C_coll_Asset,
				C_totalDebt_Asset,
				totalLiquidatedDebt_Asset,
				price,
			}
		}

		it("First vessel only doesn’t get out of Recovery Mode", async () => {
			await setup()
			await vesselManagerOperations.batchLiquidateVessels(erc20.address, [alice])

			await th.getTCR(contracts.core, erc20.address)
			assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))
		})

		it("Two vessels over MCR are liquidated", async () => {
			await setup()
			const tx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, [alice, bob, carol])

			const liquidationEvents_Asset = th.getAllEventsByName(tx_Asset, "VesselLiquidated")
			assert.equal(liquidationEvents_Asset.length, 3, "Not enough liquidations")

			// Confirm all vessels removed

			assert.isFalse(await sortedVessels.contains(erc20.address, alice))
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))
			assert.isFalse(await sortedVessels.contains(erc20.address, carol))

			// Confirm vessels have status 'closed by liquidation' (Status enum element idx 3)

			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
		})

		it("Stability Pool profit matches", async () => {
			const {
				A_coll,
				A_totalDebt,
				C_coll,
				C_totalDebt,
				totalLiquidatedDebt,
				A_coll_Asset,
				A_totalDebt_Asset,
				C_coll_Asset,
				C_totalDebt_Asset,
				totalLiquidatedDebt_Asset,
				price,
			} = await setup()

			const spEthBefore_Asset = await stabilityPool.getCollateral(erc20.address)
			const spGRAIBefore_Asset = await stabilityPool.getTotalDebtTokenDeposits()

			const txAsset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, [alice, carol])

			// Confirm all vessels removed

			assert.isFalse(await sortedVessels.contains(erc20.address, alice))
			assert.isFalse(await sortedVessels.contains(erc20.address, carol))

			// Confirm vessels have status 'closed by liquidation' (Status enum element idx 3)

			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "3")

			const spEthAfter_Asset = await stabilityPool.getCollateral(erc20.address)
			const spGRVTfter_Asset = await stabilityPool.getTotalDebtTokenDeposits()

			// liquidate collaterals with the gas compensation fee subtracted

			const expectedCollateralLiquidatedA_Asset = th.applyLiquidationFee(A_totalDebt_Asset.mul(mv._MCR).div(price))
			const expectedCollateralLiquidatedC_Asset = th.applyLiquidationFee(C_coll_Asset)
			// Stability Pool gains

			const expectedGainInGRAI_Asset = expectedCollateralLiquidatedA_Asset
				.mul(price)
				.div(mv._1e18BN)
				.sub(A_totalDebt_Asset)
			const realGainInGRAI_Asset = spEthAfter_Asset
				.sub(spEthBefore_Asset)
				.mul(price)
				.div(mv._1e18BN)
				.sub(spGRAIBefore_Asset.sub(spGRVTfter_Asset))

			assert.equal(
				spEthAfter_Asset.sub(spEthBefore_Asset).toString(),
				expectedCollateralLiquidatedA_Asset.toString(),
				"Stability Pool ETH doesn’t match"
			)
			assert.equal(
				spGRAIBefore_Asset.sub(spGRVTfter_Asset).toString(),
				A_totalDebt_Asset.toString(),
				"Stability Pool GRAI doesn’t match"
			)
			assert.equal(
				realGainInGRAI_Asset.toString(),
				expectedGainInGRAI_Asset.toString(),
				"Stability Pool gains don’t match"
			)
		})

		it("A vessel over TCR is not liquidated", async () => {
			const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(280, 16)),
				extraParams: { from: alice },
			})
			const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(276, 16)),
				extraParams: { from: bob },
			})
			const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: carol },
			})

			const totalLiquidatedDebt_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset)

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(310, 16)),
				extraGRAIAmount: totalLiquidatedDebt_Asset,
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(totalLiquidatedDebt_Asset, validCollateral, { from: whale })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)
			const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

			// Check Recovery Mode is active
			assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

			// Check vessels A, B are in range 110% < ICR < TCR, C is below 100%

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
			const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

			assert.isTrue(ICR_A_Asset.gt(TCR_Asset))
			assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
			assert.isTrue(ICR_C_Asset.lt(mv._ICR100))

			const tx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, [bob, alice])

			const liquidationEvents_Asset = th.getAllEventsByName(tx_Asset, "VesselLiquidated")
			assert.equal(liquidationEvents_Asset.length, 1, "Not enough liquidations")

			// Confirm only Bob’s vessel removed

			assert.isTrue(await sortedVessels.contains(erc20.address, alice))
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))
			assert.isTrue(await sortedVessels.contains(erc20.address, carol))

			// Confirm vessels have status 'closed by liquidation' (Status enum element idx 3)

			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
		})
	})

	context("Sequential liquidations", () => {
		const setup = async () => {
			const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(299, 16)),
				extraParams: { from: alice },
			})
			const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(298, 16)),
				extraParams: { from: bob },
			})

			const totalLiquidatedDebt_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset)

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(300, 16)),
				extraGRAIAmount: totalLiquidatedDebt_Asset,
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(totalLiquidatedDebt_Asset, validCollateral, { from: whale })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)
			const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

			// Check Recovery Mode is active
			assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

			// Check vessels A, B are in range 110% < ICR < TCR, C is below 100%

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)

			assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
			assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))

			return {
				A_coll_Asset,
				A_totalDebt_Asset,
				B_coll_Asset,
				B_totalDebt_Asset,
				totalLiquidatedDebt_Asset,
				price,
			}
		}

		it("First vessel only doesn’t get out of Recovery Mode", async () => {
			await setup()

			await th.getTCR(contracts.core, erc20.address)
			assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))
		})

		it("Two vessels over MCR are liquidated", async () => {
			await setup()
			const tx_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 10)

			const liquidationEvents_Asset = th.getAllEventsByName(tx_Asset, "VesselLiquidated")
			assert.equal(liquidationEvents_Asset.length, 2, "Not enough liquidations")

			// Confirm all vessels removed

			assert.isFalse(await sortedVessels.contains(erc20.address, alice))
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))

			// Confirm vessels have status 'closed by liquidation' (Status enum element idx 3)

			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
		})
	})
})

contract("Reset chain state", async accounts => {})

