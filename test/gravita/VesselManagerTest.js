const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers")
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN, assertRevert } = th
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const { ethers } = require("hardhat")
const f = v => ethers.utils.formatEther(v.toString())

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
}

/* NOTE: Some tests involving ETH redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific ETH gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the VesselManager, which is still TBD based on economic modelling.
 *
 */
contract("VesselManager", async accounts => {
	const _18_zeros = "000000000000000000"
	const ZERO_ADDRESS = th.ZERO_ADDRESS

	const [
		owner,
		alice,
		bob,
		carol,
		dennis,
		erin,
		flyn,
		graham,
		harriet,
		ida,
		defaulter_1,
		defaulter_2,
		defaulter_3,
		defaulter_4,
		whale,
		A,
		B,
		C,
		D,
		E,
		treasury,
	] = accounts

	const multisig = accounts[999]

	let REDEMPTION_SOFTENING_PARAM

	const getOpenVesselVUSDAmount = async (totalDebt, asset) =>
		th.getOpenVesselVUSDAmount(contracts.core, totalDebt, asset)
	const getNetBorrowingAmount = async (debtWithFee, asset) =>
		th.getNetBorrowingAmount(contracts.core, debtWithFee, asset)
	const openVessel = async params => th.openVessel(contracts.core, params)
	const withdrawVUSD = async params => th.withdrawVUSD(contracts.core, params)
	const calcSoftnedAmount = (collAmount, price) =>
		collAmount.mul(mv._1e18BN).mul(REDEMPTION_SOFTENING_PARAM).div(toBN(1000)).div(price)

	describe("Vessel Manager", async () => {
		before(async () => {
			await deploy(treasury, accounts.slice(0, 20))

			await grvtToken.unprotectedMint(multisig, dec(1, 24))
			// give some gas to the contracts that will be impersonated
			setBalance(adminContract.address, 1e18)
			for (const acc of accounts.slice(0, 20)) {
				await grvtToken.approve(grvtStaking.address, await web3.eth.getBalance(acc), { from: acc })
				await erc20.mint(acc, await web3.eth.getBalance(acc))
			}
			REDEMPTION_SOFTENING_PARAM = await vesselManagerOperations.REDEMPTION_SOFTENING_PARAM()

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

		describe("Liquidations", async () => {
			it("liquidate(): closes a Vessel that has ICR < MCR", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				await th.logActiveAccounts(contracts.core, 10)
				const price = await priceFeed.getPrice(erc20.address)
				const ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				assert.equal(ICR_Before_Asset, dec(4, 18))

				assert.equal((await adminContract.getMcr(erc20.address)).toString(), "1100000000000000000")

				// Alice increases debt to 180 VUSD, lowering her ICR to 1.11
				await getNetBorrowingAmount(dec(130, 18), erc20.address)

				const targetICR = toBN("1111111111111111111")
				await withdrawVUSD({
					asset: erc20.address,
					ICR: targetICR,
					extraParams: { from: alice },
				})

				const ICR_AfterWithdrawal_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				assert.isAtMost(th.getDifference(ICR_AfterWithdrawal_Asset, targetICR), 100)

				// price drops to 1ETH:100VUSD, reducing Alice's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// close Vessel
				await vesselManagerOperations.liquidate(erc20.address, alice, { from: owner })

				// check the Vessel is successfully closed, and removed from sortedList
				const status_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX]
				// status enum 3 corresponds to "Closed by liquidation"
				assert.equal(status_Asset, 3)

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
			})

			it("liquidate(): decreases ActivePool ETH and VUSDDebt by correct amounts", async () => {
				// --- SETUP ---
				const { collateral: A_collateral_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				const { collateral: B_collateral_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(21, 17)),
					extraParams: { from: bob },
				})

				// --- TEST ---

				// check ActivePool ETH and VUSD debt before
				const activePool_ETH_Before_Asset = (await activePool.getAssetBalance(erc20.address)).toString()
				const activePool_RawEther_Before_Asset = (await erc20.balanceOf(activePool.address)).toString()
				const activePooL_VUSDDebt_Before_Asset = (await activePool.getDebtTokenBalance(erc20.address)).toString()

				assert.equal(activePool_ETH_Before_Asset, A_collateral_Asset.add(B_collateral_Asset))
				assert.equal(activePool_RawEther_Before_Asset, A_collateral_Asset.add(B_collateral_Asset))
				th.assertIsApproximatelyEqual(activePooL_VUSDDebt_Before_Asset, A_totalDebt_Asset.add(B_totalDebt_Asset))

				// price drops to 1ETH:100VUSD, reducing Bob's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				/* close Bob's Vessel. Should liquidate his ether and VUSD,
    leaving Alice’s ether and VUSD debt in the ActivePool. */
				await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

				// check ActivePool ETH and VUSD debt
				const activePool_ETH_After_Asset = (await activePool.getAssetBalance(erc20.address)).toString()
				const activePool_RawEther_After_Asset = (await erc20.balanceOf(activePool.address)).toString()
				const activePooL_VUSDDebt_After_Asset = (await activePool.getDebtTokenBalance(erc20.address)).toString()

				assert.equal(activePool_ETH_After_Asset, A_collateral_Asset)
				assert.equal(activePool_RawEther_After_Asset, A_collateral_Asset)
				th.assertIsApproximatelyEqual(activePooL_VUSDDebt_After_Asset, A_totalDebt_Asset)
			})

			it("liquidate(): increases DefaultPool ETH and VUSD debt by correct amounts", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				const { collateral: B_collateral_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(21, 17)),
					extraParams: { from: bob },
				})

				// --- TEST ---

				// check DefaultPool ETH and VUSD debt before
				const defaultPool_ETH_Before_Asset = await defaultPool.getAssetBalance(erc20.address)
				const defaultPool_RawEther_Before_Asset = (await web3.eth.getBalance(defaultPool.address)).toString()
				const defaultPooL_VUSDDebt_Before_Asset = (await defaultPool.getDebtTokenBalance(erc20.address)).toString()

				assert.equal(defaultPool_ETH_Before_Asset, "0")
				assert.equal(defaultPool_RawEther_Before_Asset, "0")
				assert.equal(defaultPooL_VUSDDebt_Before_Asset, "0")

				// price drops to 1ETH:100VUSD, reducing Bob's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// close Bob's Vessel
				await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

				// check after
				const defaultPool_ETH_After_Asset = (await defaultPool.getAssetBalance(erc20.address)).toString()
				const defaultPool_RawEther_After_Asset = (await erc20.balanceOf(defaultPool.address)).toString()
				const defaultPooL_VUSDDebt_After_Asset = (await defaultPool.getDebtTokenBalance(erc20.address)).toString()
				const defaultPool_ETH_Asset = th.applyLiquidationFee(B_collateral_Asset)
				assert.equal(defaultPool_ETH_After_Asset, defaultPool_ETH_Asset)
				assert.equal(defaultPool_RawEther_After_Asset, defaultPool_ETH_Asset)
				th.assertIsApproximatelyEqual(defaultPooL_VUSDDebt_After_Asset, B_totalDebt_Asset)
			})

			it("liquidate(): removes the Vessel's stake from the total stakes", async () => {
				// --- SETUP ---
				const { collateral: A_collateral_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				const { collateral: B_collateral_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(21, 17)),
					extraParams: { from: bob },
				})

				// --- TEST ---

				// check totalStakes before
				const totalStakes_Before_Asset = (await vesselManager.totalStakes(erc20.address)).toString()
				assert.equal(totalStakes_Before_Asset, A_collateral_Asset.add(B_collateral_Asset))

				// price drops to 1ETH:100VUSD, reducing Bob's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Close Bob's Vessel
				await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

				// check totalStakes after
				const totalStakes_After_Asset = (await vesselManager.totalStakes(erc20.address)).toString()
				assert.equal(totalStakes_After_Asset, A_collateral_Asset)
			})

			it("liquidate(): removes the correct vessel from the VesselOwners array, and moves the last array element to the new empty slot", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})

				// Alice, Bob, Carol, Dennis, Erin open vessels with consecutively decreasing collateral ratio
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(216, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(214, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(212, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraParams: { from: erin },
				})

				// At this stage, VesselOwners array should be: [W, A, B, C, D, E]

				// Drop price
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const arrayLength_Before_Asset = await vesselManager.getVesselOwnersCount(erc20.address)
				assert.equal(arrayLength_Before_Asset, 6)

				// Confirm system is not in Recovery Mode

				// Liquidate carol
				await vesselManagerOperations.liquidate(erc20.address, carol)

				// Check Carol no longer has an active vessel
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// Check length of array has decreased by 1
				const arrayLength_After_Asset = await vesselManager.getVesselOwnersCount(erc20.address)
				assert.equal(arrayLength_After_Asset, 5)

				/* After Carol is removed from array, the last element (Erin's address) should have been moved to fill
    the empty slot left by Carol, and the array length decreased by one.  The final VesselOwners array should be:

    [W, A, B, E, D]

    Check all remaining vessels in the array are in the correct order */

				const vessel_0_Asset = await vesselManager.VesselOwners(erc20.address, 0)
				const vessel_1_Asset = await vesselManager.VesselOwners(erc20.address, 1)
				const vessel_2_Asset = await vesselManager.VesselOwners(erc20.address, 2)
				const vessel_3_Asset = await vesselManager.VesselOwners(erc20.address, 3)
				const vessel_4_Asset = await vesselManager.VesselOwners(erc20.address, 4)

				assert.equal(vessel_0_Asset, whale)
				assert.equal(vessel_1_Asset, alice)
				assert.equal(vessel_2_Asset, bob)
				assert.equal(vessel_3_Asset, erin)
				assert.equal(vessel_4_Asset, dennis)

				// Check correct indices recorded on the active vessel structs

				const whale_arrayIndex_Asset = (await vesselManager.Vessels(whale, erc20.address))[th.VESSEL_ARRAY_INDEX]
				const alice_arrayIndex_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_ARRAY_INDEX]
				const bob_arrayIndex_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_ARRAY_INDEX]
				const dennis_arrayIndex_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_ARRAY_INDEX]
				const erin_arrayIndex_Asset = (await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_ARRAY_INDEX]

				// [W, A, B, E, D]
				assert.equal(whale_arrayIndex_Asset, 0)
				assert.equal(alice_arrayIndex_Asset, 1)
				assert.equal(bob_arrayIndex_Asset, 2)
				assert.equal(erin_arrayIndex_Asset, 3)
				assert.equal(dennis_arrayIndex_Asset, 4)
			})

			it("liquidate(): updates the snapshots of total stakes and total collateral", async () => {
				// --- SETUP ---
				const { collateral: A_collateral_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				const { collateral: B_collateral_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(21, 17)),
					extraParams: { from: bob },
				})

				// --- TEST ---

				// check snapshots before
				const totalStakesSnapshot_Before_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
				const totalCollateralSnapshot_Before_Asset = (
					await vesselManager.totalCollateralSnapshot(erc20.address)
				).toString()

				assert.equal(totalStakesSnapshot_Before_Asset, "0")
				assert.equal(totalCollateralSnapshot_Before_Asset, "0")

				// price drops to 1ETH:100VUSD, reducing Bob's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// close Bob's Vessel.  His ether*0.995 and VUSD should be added to the DefaultPool.
				await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

				/* check snapshots after. Total stakes should be equal to the  remaining stake then the system:
    10 ether, Alice's stake.

    Total collateral should be equal to Alice's collateral plus her pending ETH reward (Bob’s collaterale*0.995 ether), earned
    from the liquidation of Bob's Vessel */
				const totalStakesSnapshot_After_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
				const totalCollateralSnapshot_After_Asset = (
					await vesselManager.totalCollateralSnapshot(erc20.address)
				).toString()

				assert.equal(totalStakesSnapshot_After_Asset, A_collateral_Asset)
				assert.equal(
					totalCollateralSnapshot_After_Asset,
					A_collateral_Asset.add(th.applyLiquidationFee(B_collateral_Asset))
				)
			})

			it("liquidate(): updates the L_ETH and L_VUSDDebt reward-per-unit-staked totals", async () => {
				// --- SETUP ---
				const { collateral: A_collateral_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(8, 18)),
					extraParams: { from: alice },
				})
				const { collateral: B_collateral_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: bob },
				})
				const { collateral: C_collateral_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(111, 16)),
					extraParams: { from: carol },
				})

				// --- TEST ---

				// price drops to 1ETH:100VUSD, reducing Carols's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// close Carol's Vessel.
				assert.isTrue(await sortedVessels.contains(erc20.address, carol))
				await vesselManagerOperations.liquidate(erc20.address, carol, { from: owner })
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// Carol's ether*0.995 and VUSD should be added to the DefaultPool.
				const L_ETH_AfterCarolLiquidated_Asset = await vesselManager.L_Colls(erc20.address)
				const L_VUSDDebt_AfterCarolLiquidated_Asset = await vesselManager.L_Debts(erc20.address)

				const L_ETH_expected_1_Asset = th
					.applyLiquidationFee(C_collateral_Asset)
					.mul(mv._1e18BN)
					.div(A_collateral_Asset.add(B_collateral_Asset))
				const L_VUSDDebt_expected_1_Asset = C_totalDebt_Asset.mul(mv._1e18BN).div(
					A_collateral_Asset.add(B_collateral_Asset)
				)
				assert.isAtMost(th.getDifference(L_ETH_AfterCarolLiquidated_Asset, L_ETH_expected_1_Asset), 100)
				assert.isAtMost(th.getDifference(L_VUSDDebt_AfterCarolLiquidated_Asset, L_VUSDDebt_expected_1_Asset), 100)

				// Bob now withdraws VUSD, bringing his ICR to 1.11
				const { increasedTotalDebt: B_increasedTotalDebt_Asset } = await withdrawVUSD({
					asset: erc20.address,
					ICR: toBN(dec(111, 16)),
					extraParams: { from: bob },
				})

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// price drops to 1ETH:50VUSD, reducing Bob's ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(50, 18))
				await priceFeed.getPrice(erc20.address)

				// close Bob's Vessel
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const L_ETH_AfterBobLiquidated_Asset = await vesselManager.L_Colls(erc20.address)
				const L_VUSDDebt_AfterBobLiquidated_Asset = await vesselManager.L_Debts(erc20.address)

				/* Alice now has all the active stake. totalStakes in the system is now 10 ether.

   Bob's pending collateral reward and debt reward are applied to his Vessel
   before his liquidation.
   His total collateral*0.995 and debt are then added to the DefaultPool.

   The system rewards-per-unit-staked should now be:

   L_ETH = (0.995 / 20) + (10.4975*0.995  / 10) = 1.09425125 ETH
   L_VUSDDebt = (180 / 20) + (890 / 10) = 98 VUSD */

				const L_ETH_expected_2_Asset = L_ETH_expected_1_Asset.add(
					th
						.applyLiquidationFee(B_collateral_Asset.add(B_collateral_Asset.mul(L_ETH_expected_1_Asset).div(mv._1e18BN)))
						.mul(mv._1e18BN)
						.div(A_collateral_Asset)
				)
				const L_VUSDDebt_expected_2 = L_VUSDDebt_expected_1_Asset.add(
					B_totalDebt_Asset.add(B_increasedTotalDebt_Asset)
						.add(B_collateral_Asset.mul(L_VUSDDebt_expected_1_Asset).div(mv._1e18BN))
						.mul(mv._1e18BN)
						.div(A_collateral_Asset)
				)
				assert.isAtMost(th.getDifference(L_ETH_AfterBobLiquidated_Asset, L_ETH_expected_2_Asset), 100)
				assert.isAtMost(th.getDifference(L_VUSDDebt_AfterBobLiquidated_Asset, L_VUSDDebt_expected_2), 100)
			})

			it("liquidate(): liquidates undercollateralized vessel if there are two vessels in the system", async () => {
				await openVessel({
					asset: erc20.address,
					assetSent: dec(100, "ether"),
					ICR: toBN(dec(200, 18)),
					extraParams: { from: bob },
				})

				// Alice creates a single vessel with 0.7 ETH and a debt of 70 VUSD, and provides 10 VUSD to SP
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: alice },
				})

				// Alice proves 10 VUSD to SP
				await stabilityPool.provideToSP(dec(10, 18), { from: alice })

				// Set ETH:USD price to 105
				await priceFeed.setPrice(erc20.address, "105000000000000000000")
				const price = await priceFeed.getPrice(erc20.address)

				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				const alice_ICR_Asset = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
				assert.equal(alice_ICR_Asset, "1050000000000000000")

				const activeVesselsCount_Before_Asset = await vesselManager.getVesselOwnersCount(erc20.address)

				assert.equal(activeVesselsCount_Before_Asset, 2)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate the vessel
				await vesselManagerOperations.liquidate(erc20.address, alice, { from: owner })

				// Check Alice's vessel is removed, and bob remains
				const activeVesselsCount_After_Asset = await vesselManager.getVesselOwnersCount(erc20.address)
				assert.equal(activeVesselsCount_After_Asset, 1)

				const alice_isInSortedList_Asset = await sortedVessels.contains(erc20.address, alice)
				assert.isFalse(alice_isInSortedList_Asset)

				const bob_isInSortedList_Asset = await sortedVessels.contains(erc20.address, bob)
				assert.isTrue(bob_isInSortedList_Asset)
			})

			it("liquidate(): reverts if vessel is non-existent", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(21, 17)),
					extraParams: { from: bob },
				})

				assert.equal(await vesselManager.getVesselStatus(erc20.address, carol), 0) // check vessel non-existent

				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				try {
					const txCarol = await vesselManagerOperations.liquidate(erc20.address, carol)
					assert.isFalse(txCarol.receipt.status)
				} catch (err) {
					assert.include(err.message, "revert")
					assert.include(err.message, "VesselManagerOperations__VesselNotActive()")
				}
			})

			it("liquidate(): reverts if vessel has been closed", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(8, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: carol },
				})

				assert.isTrue(await sortedVessels.contains(erc20.address, carol))

				// price drops, Carol ICR falls below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				// Carol liquidated, and her vessel is closed
				const txCarol_L1_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
				assert.isTrue(txCarol_L1_Asset.receipt.status)

				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				assert.equal(await vesselManager.getVesselStatus(erc20.address, carol), 3) // check vessel closed by liquidation

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				try {
					const txCarol_L2 = await vesselManagerOperations.liquidate(erc20.address, carol)
					assert.isFalse(txCarol_L2.receipt.status)
				} catch (err) {
					assert.include(err.message, "revert")
					assert.include(err.message, "VesselManagerOperations__VesselNotActive()")
				}
			})

			it("liquidate(): does nothing if vessel has >= 110% ICR", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: bob },
				})

				const TCR_Before_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
				const listSize_Before_Asset = (await sortedVessels.getSize(erc20.address)).toString()

				const price = await priceFeed.getPrice(erc20.address)

				// Check Bob's ICR > 110%
				const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				assert.isTrue(bob_ICR_Asset.gte(mv._MCR))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Attempt to liquidate bob
				await assertRevert(vesselManagerOperations.liquidate(erc20.address, bob), "VesselManager: nothing to liquidate")

				// Check bob active, check whale active
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				assert.isTrue(await sortedVessels.contains(erc20.address, whale))

				const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
				const listSize_After_Asset = (await sortedVessels.getSize(erc20.address)).toString()

				assert.equal(TCR_Before_Asset, TCR_After_Asset)
				assert.equal(listSize_Before_Asset, listSize_After_Asset)
			})

			it("liquidate(): given the same price and no other vessel changes, complete Pool offsets restore the TCR to its value prior to the defaulters opening vessels", async () => {
				// Whale provides VUSD to SP
				const spDeposit = toBN(dec(100, 24))
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraVUSDAmount: spDeposit,
					extraParams: { from: whale },
				})
				await stabilityPool.provideToSP(spDeposit, { from: whale })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(70, 18)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 18)),
					extraParams: { from: dennis },
				})

				const TCR_Before_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(202, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: defaulter_2 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(196, 16)),
					extraParams: { from: defaulter_3 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_4 },
				})

				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

				// Price drop
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// All defaulters liquidated
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_3)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_4)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))

				// Price bounces back
				await priceFeed.setPrice(erc20.address, dec(200, 18))

				const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
				assert.equal(TCR_Before_Asset, TCR_After_Asset)
			})

			it("liquidate(): pool offsets increase the TCR", async () => {
				// Whale provides VUSD to SP
				const spDeposit = toBN(dec(100, 24))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraVUSDAmount: spDeposit,
					extraParams: { from: whale },
				})

				await stabilityPool.provideToSP(spDeposit, { from: whale })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(70, 18)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 18)),
					extraParams: { from: dennis },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(202, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: defaulter_2 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(196, 16)),
					extraParams: { from: defaulter_3 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_4 },
				})

				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const TCR_1_Asset = await th.getTCR(contracts.core, erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Check TCR improves with each liquidation that is offset with Pool
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				const TCR_2_Asset = await th.getTCR(contracts.core, erc20.address)
				assert.isTrue(TCR_2_Asset.gte(TCR_1_Asset))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))
				const TCR_3_Asset = await th.getTCR(contracts.core, erc20.address)
				assert.isTrue(TCR_3_Asset.gte(TCR_2_Asset))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_3)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))
				const TCR_4_Asset = await th.getTCR(contracts.core, erc20.address)
				assert.isTrue(TCR_4_Asset.gte(TCR_3_Asset))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_4)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))
				const TCR_5_Asset = await th.getTCR(contracts.core, erc20.address)
				assert.isTrue(TCR_5_Asset.gte(TCR_4_Asset))
			})

			it("liquidate(): a pure redistribution reduces the TCR only as a result of compensation", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: whale },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(70, 18)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 18)),
					extraParams: { from: dennis },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(202, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: defaulter_2 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(196, 16)),
					extraParams: { from: defaulter_3 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_4 },
				})

				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				const TCR_0_Asset = await th.getTCR(contracts.core, erc20.address)

				const entireSystemCollBefore_Asset = await vesselManager.getEntireSystemColl(erc20.address)
				const entireSystemDebtBefore_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

				const expectedTCR_0_Asset = entireSystemCollBefore_Asset.mul(price).div(entireSystemDebtBefore_Asset)

				assert.isTrue(expectedTCR_0_Asset.eq(TCR_0_Asset))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Check TCR does not decrease with each liquidation
				const liquidationTx_1_Asset = await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

				const [liquidatedDebt_1_Asset, liquidatedColl_1_Asset, gasComp_1_Asset] =
					th.getEmittedLiquidationValues(liquidationTx_1_Asset)

				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				const TCR_1_Asset = await th.getTCR(contracts.core, erc20.address)

				// Expect only change to TCR to be due to the issued gas compensation	.div(entireSystemDebtBefore)
				const expectedTCR_1_Asset = entireSystemCollBefore_Asset
					.sub(gasComp_1_Asset)
					.mul(price)
					.div(entireSystemDebtBefore_Asset)

				assert.isTrue(expectedTCR_1_Asset.eq(TCR_1_Asset))

				const liquidationTx_2_Asset = await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
				const [liquidatedDebt_2_Asset, liquidatedColl_2_Asset, gasComp_2_Asset] =
					th.getEmittedLiquidationValues(liquidationTx_2_Asset)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const TCR_2_Asset = await th.getTCR(contracts.core, erc20.address)

				const expectedTCR_2_Asset = entireSystemCollBefore_Asset
					.sub(gasComp_1_Asset)
					.sub(gasComp_2_Asset)
					.mul(price)
					.div(entireSystemDebtBefore_Asset)

				assert.isTrue(expectedTCR_2_Asset.eq(TCR_2_Asset))

				const liquidationTx_3_Asset = await vesselManagerOperations.liquidate(erc20.address, defaulter_3)

				const [liquidatedDebt_3_Asset, liquidatedColl_3_Asset, gasComp_3_Asset] =
					th.getEmittedLiquidationValues(liquidationTx_3_Asset)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))

				const TCR_3_Asset = await th.getTCR(contracts.core, erc20.address)

				const expectedTCR_3_Asset = entireSystemCollBefore_Asset
					.sub(gasComp_1_Asset)
					.sub(gasComp_2_Asset)
					.sub(gasComp_3_Asset)
					.mul(price)
					.div(entireSystemDebtBefore_Asset)

				assert.isTrue(expectedTCR_3_Asset.eq(TCR_3_Asset))

				const liquidationTx_4_Asset = await vesselManagerOperations.liquidate(erc20.address, defaulter_4)
				const [liquidatedDebt_4_Asset, liquidatedColl_4_Asset, gasComp_4_Asset] =
					th.getEmittedLiquidationValues(liquidationTx_4_Asset)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))

				const TCR_4_Asset = await th.getTCR(contracts.core, erc20.address)

				const expectedTCR_4_Asset = entireSystemCollBefore_Asset
					.sub(gasComp_1_Asset)
					.sub(gasComp_2_Asset)
					.sub(gasComp_3_Asset)
					.sub(gasComp_4_Asset)
					.mul(price)
					.div(entireSystemDebtBefore_Asset)

				assert.isTrue(expectedTCR_4_Asset.eq(TCR_4_Asset))
			})

			it("liquidate(): does not affect the SP deposit or ETH gain when called on an SP depositor's address that has no vessel", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				const spDeposit = toBN(dec(1, 24))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraVUSDAmount: spDeposit,
					extraParams: { from: bob },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: carol },
				})

				// Bob sends tokens to Dennis, who has no vessel
				await debtToken.transfer(dennis, spDeposit, { from: bob })

				//Dennis provides VUSD to SP
				await stabilityPool.provideToSP(spDeposit, { from: dennis })

				// Carol gets liquidated
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTX_C_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTX_C_Asset)

				assert.isFalse(await sortedVessels.contains(erc20.address, carol))
				// Check Dennis' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH
				const dennis_Deposit_Before_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString()
				const dennis_ETHGain_Before_Asset = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()
				assert.isAtMost(th.getDifference(dennis_Deposit_Before_Asset, spDeposit.sub(liquidatedDebt_Asset)), 1000000)
				assert.isAtMost(th.getDifference(dennis_ETHGain_Before_Asset, liquidatedColl_Asset), 1000)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Attempt to liquidate Dennis

				try {
					const txDennis = await vesselManagerOperations.liquidate(erc20.address, dennis)
					assert.isFalse(txDennis.receipt.status)
				} catch (err) {
					assert.include(err.message, "revert")
					assert.include(err.message, "VesselManagerOperations__VesselNotActive()")
				}

				// Check Dennis' SP deposit does not change after liquidation attempt
				const dennis_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString()
				const dennis_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()

				assert.equal(dennis_Deposit_Before_Asset, dennis_Deposit_After_Asset)
				assert.equal(dennis_ETHGain_Before_Asset, dennis_ETHGain_After_Asset)
			})

			it("liquidate(): does not liquidate a SP depositor's vessel with ICR > 110%, and does not affect their SP deposit or ETH gain", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				const spDeposit = toBN(dec(1, 24))
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraVUSDAmount: spDeposit,
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: carol },
				})

				//Bob provides VUSD to SP
				await stabilityPool.provideToSP(spDeposit, { from: bob })

				// Carol gets liquidated
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const liquidationTX_C_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
				const [liquidatedDebt_Asset, liquidatedColl_Asset, gasComp_Asset] =
					th.getEmittedLiquidationValues(liquidationTX_C_Asset)
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// price bounces back - Bob's vessel is >110% ICR again
				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gt(mv._MCR))

				// Check Bob' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH

				const bob_Deposit_Before_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const bob_ETHGain_Before_Asset = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				assert.isAtMost(th.getDifference(bob_Deposit_Before_Asset, spDeposit.sub(liquidatedDebt_Asset)), 1000000)
				assert.isAtMost(th.getDifference(bob_ETHGain_Before_Asset, liquidatedColl_Asset), 1000)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Attempt to liquidate Bob
				await assertRevert(vesselManagerOperations.liquidate(erc20.address, bob), "VesselManager: nothing to liquidate")

				// Confirm Bob's vessel is still active
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))

				// Check Bob' SP deposit does not change after liquidation attempt

				const bob_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const bob_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				assert.equal(bob_Deposit_Before_Asset, bob_Deposit_After_Asset)
				assert.equal(bob_ETHGain_Before_Asset, bob_ETHGain_After_Asset)
			})

			it("liquidate(): liquidates a SP depositor's vessel with ICR < 110%, and the liquidation correctly impacts their SP deposit and ETH gain", async () => {
				const A_spDeposit = toBN(dec(3, 24))
				const B_spDeposit = toBN(dec(1, 24))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(8, 18)),
					extraVUSDAmount: A_spDeposit,
					extraParams: { from: alice },
				})

				const { collateral: B_collateral_Asset, totalDebt: B_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraVUSDAmount: B_spDeposit,
					extraParams: { from: bob },
				})
				const { collateral: C_collateral_Asset, totalDebt: C_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: carol },
				})

				//Bob provides VUSD to SP
				await stabilityPool.provideToSP(B_spDeposit, { from: bob })

				// Carol gets liquidated
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await vesselManagerOperations.liquidate(erc20.address, carol)

				// Check Bob' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH

				const bob_Deposit_Before_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(bob)
				const bob_ETHGain_Before_Asset = (await stabilityPool.getDepositorGains(bob))[1][1]

				assert.isAtMost(th.getDifference(bob_Deposit_Before_Asset, B_spDeposit.sub(C_debt_Asset)), 1000000)
				assert.isAtMost(th.getDifference(bob_ETHGain_Before_Asset, th.applyLiquidationFee(C_collateral_Asset)), 1000)

				// Alice provides VUSD to SP
				await stabilityPool.provideToSP(A_spDeposit, { from: alice })

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate Bob
				await vesselManagerOperations.liquidate(erc20.address, bob)

				// Confirm Bob's vessel has been closed
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				const bob_Vessel_Status_Asset = (await vesselManager.Vessels(bob, erc20.address))[
					th.VESSEL_STATUS_INDEX
				].toString()
				assert.equal(bob_Vessel_Status_Asset, 3)

				/* Alice's VUSD Loss = (300 / 400) * 200 = 150 VUSD
       Alice's ETH gain = (300 / 400) * 2*0.995 = 1.4925 ETH

       Bob's VUSDLoss = (100 / 400) * 200 = 50 VUSD
       Bob's ETH gain = (100 / 400) * 2*0.995 = 0.4975 ETH

     Check Bob' SP deposit has been reduced to 50 VUSD, and his ETH gain has increased to 1.5 ETH. */
				const alice_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
				const alice_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(alice))[1][1].toString()

				const totalDeposits_Asset = bob_Deposit_Before_Asset.add(A_spDeposit)

				assert.isAtMost(
					th.getDifference(
						alice_Deposit_After_Asset,
						A_spDeposit.sub(B_debt_Asset.mul(A_spDeposit).div(totalDeposits_Asset))
					),
					1000000
				)
				assert.isAtMost(
					th.getDifference(
						alice_ETHGain_After_Asset,
						th.applyLiquidationFee(B_collateral_Asset).mul(A_spDeposit).div(totalDeposits_Asset)
					),
					1000000
				)

				const bob_Deposit_After_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(bob)
				const bob_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(bob))[1][1]

				assert.isAtMost(
					th.getDifference(
						bob_Deposit_After_Asset,
						bob_Deposit_Before_Asset.sub(B_debt_Asset.mul(bob_Deposit_Before_Asset).div(totalDeposits_Asset))
					),
					1000000
				)
				assert.isAtMost(
					th.getDifference(
						bob_ETHGain_After_Asset,
						bob_ETHGain_Before_Asset.add(
							th.applyLiquidationFee(B_collateral_Asset).mul(bob_Deposit_Before_Asset).div(totalDeposits_Asset)
						)
					),
					1000000
				)
			})

			it("liquidate(): does not alter the liquidated user's token balance", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				const { VUSDAmount: A_VUSDAmount_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: toBN(dec(300, 18)),
					extraParams: { from: alice },
				})
				const { VUSDAmount: B_VUSDAmount_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: toBN(dec(200, 18)),
					extraParams: { from: bob },
				})
				const { VUSDAmount: C_VUSDAmount_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: carol },
				})

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				// Check sortedList size
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate A, B and C
				await activePool.getDebtTokenBalance(erc20.address)
				await defaultPool.getDebtTokenBalance(erc20.address)

				await vesselManagerOperations.liquidate(erc20.address, alice)
				await activePool.getDebtTokenBalance(erc20.address)
				await defaultPool.getDebtTokenBalance(erc20.address)

				await vesselManagerOperations.liquidate(erc20.address, bob)
				await activePool.getDebtTokenBalance(erc20.address)
				await defaultPool.getDebtTokenBalance(erc20.address)

				await vesselManagerOperations.liquidate(erc20.address, carol)

				// Confirm A, B, C closed

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// Check sortedList size reduced to 1
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "1")

				// Confirm token balances have not changed
				assert.equal((await debtToken.balanceOf(alice)).toString(), A_VUSDAmount_Asset.toString())
				assert.equal((await debtToken.balanceOf(bob)).toString(), B_VUSDAmount_Asset.toString())
				assert.equal((await debtToken.balanceOf(carol)).toString(), C_VUSDAmount_Asset.toString())
			})

			it("liquidate(): liquidates based on entire/collateral debt (including pending rewards), not raw collateral/debt", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(8, 18)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(221, 16)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: carol },
				})

				// Defaulter opens with 60 VUSD, 0.6 ETH
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: defaulter_1 },
				})

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				const alice_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				const bob_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

				/* Before liquidation:
    Alice ICR: = (2 * 100 / 50) = 400%
    Bob ICR: (1 * 100 / 90.5) = 110.5%
    Carol ICR: (1 * 100 / 100 ) =  100%

    Therefore Alice and Bob above the MCR, Carol is below */

				assert.isTrue(alice_ICR_Before_Asset.gte(mv._MCR))
				assert.isTrue(bob_ICR_Before_Asset.gte(mv._MCR))
				assert.isTrue(carol_ICR_Before_Asset.lte(mv._MCR))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				/* Liquidate defaulter. 30 VUSD and 0.3 ETH is distributed between A, B and C.

    A receives (30 * 2/4) = 15 VUSD, and (0.3*2/4) = 0.15 ETH
    B receives (30 * 1/4) = 7.5 VUSD, and (0.3*1/4) = 0.075 ETH
    C receives (30 * 1/4) = 7.5 VUSD, and (0.3*1/4) = 0.075 ETH
    */
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

				const alice_ICR_After_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				const bob_ICR_After_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_After_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

				/* After liquidation:

    Alice ICR: (10.15 * 100 / 60) = 183.33%
    Bob ICR:(1.075 * 100 / 98) =  109.69%
    Carol ICR: (1.075 *100 /  107.5 ) = 100.0%

    Check Alice is above MCR, Bob below, Carol below. */

				assert.isTrue(alice_ICR_After_Asset.gte(mv._MCR))
				assert.isTrue(bob_ICR_After_Asset.lte(mv._MCR))
				assert.isTrue(carol_ICR_After_Asset.lte(mv._MCR))

				/* Though Bob's true ICR (including pending rewards) is below the MCR,
    check that Bob's raw coll and debt has not changed, and that his "raw" ICR is above the MCR */
				const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
				const bob_Debt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

				const bob_rawICR_Asset = bob_Coll_Asset.mul(toBN(dec(100, 18))).div(bob_Debt_Asset)
				assert.isTrue(bob_rawICR_Asset.gte(mv._MCR))

				// Whale enters system, pulling it into Normal Mode
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate Alice, Bob, Carol
				await assertRevert(
					vesselManagerOperations.liquidate(erc20.address, alice),
					"VesselManager: nothing to liquidate"
				)
				await vesselManagerOperations.liquidate(erc20.address, bob)
				await vesselManagerOperations.liquidate(erc20.address, carol)

				/* Check Alice stays active, Carol gets liquidated, and Bob gets liquidated
   (because his pending rewards bring his ICR < MCR) */

				assert.isTrue(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// Check vessel statuses - A active (1),  B and C liquidated (3)

				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
			})

			it("liquidate(): when SP > 0, triggers GRVT reward event - increases the sum G", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: C },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: defaulter_1 },
				})

				// B provides to SP

				await stabilityPool.provideToSP(dec(100, 18), { from: B })
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), dec(100, 18))

				const G_Before_Asset = await stabilityPool.epochToScaleToG(0, 0)

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Price drops to 1ETH:100VUSD, reducing defaulters to below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await priceFeed.getPrice(erc20.address)
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate vessel

				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				const G_After_Asset = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has increased from the GRVT reward event triggered
				assert.isTrue(G_After_Asset.gt(G_Before_Asset))
			})

			it("liquidate(): when SP is empty, doesn't update G", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: C },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: defaulter_1 },
				})

				// B provides to SP
				await stabilityPool.provideToSP(dec(100, 18), { from: B })

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B withdraws
				await stabilityPool.withdrawFromSP(dec(100, 18), { from: B })

				// Check SP is empty
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), "0")

				// Check G is non-zero
				const G_Before_Asset = await stabilityPool.epochToScaleToG(0, 0)
				assert.isTrue(G_Before_Asset.gt(toBN("0")))

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Price drops to 1ETH:100VUSD, reducing defaulters to below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// liquidate vessel
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				const G_After_Asset = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has not changed
				assert.isTrue(G_After_Asset.eq(G_Before_Asset))
			})

			// --- liquidateVessels() ---

			it("liquidateVessels(): liquidates a Vessel that a) was skipped in a previous liquidation and b) has pending rewards", async () => {
				// A, B, C, D, E open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(333, 16)),
					extraParams: { from: D },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(333, 16)),
					extraParams: { from: E },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: C },
				})

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(175, 18))
				let price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// A gets liquidated, creates pending rewards for all
				const liqTxA_Asset = await vesselManagerOperations.liquidate(erc20.address, A)
				assert.isTrue(liqTxA_Asset.receipt.status)
				assert.isFalse(await sortedVessels.contains(erc20.address, A))

				// A adds 10 VUSD to the SP, but less than C's debt
				await stabilityPool.provideToSP(dec(10, 18), { from: A })

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				price = await priceFeed.getPrice(erc20.address)
				// Confirm system is now in Recovery Mode
				assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm C has ICR > TCR
				const TCR_Asset = await vesselManager.getTCR(erc20.address, price)
				const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, C, price)

				assert.isTrue(ICR_C_Asset.gt(TCR_Asset))

				// Attempt to liquidate B and C, which skips C in the liquidation since it is immune
				const liqTxBC_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 2)
				assert.isTrue(liqTxBC_Asset.receipt.status)
				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isTrue(await sortedVessels.contains(erc20.address, C))
				assert.isTrue(await sortedVessels.contains(erc20.address, D))
				assert.isTrue(await sortedVessels.contains(erc20.address, E))

				// // All remaining vessels D and E repay a little debt, applying their pending rewards
				assert.isTrue((await sortedVessels.getSize(erc20.address)).eq(toBN("3")))
				await borrowerOperations.repayDebtTokens(erc20.address, dec(1, 18), D, D, { from: D })
				await borrowerOperations.repayDebtTokens(erc20.address, dec(1, 18), E, E, { from: E })

				// Check C is the only vessel that has pending rewards

				assert.isTrue(await vesselManager.hasPendingRewards(erc20.address, C))
				assert.isFalse(await vesselManager.hasPendingRewards(erc20.address, D))
				assert.isFalse(await vesselManager.hasPendingRewards(erc20.address, E))

				// Check C's pending coll and debt rewards are <= the coll and debt in the DefaultPool

				const pendingETH_C_Asset = await vesselManager.getPendingAssetReward(erc20.address, C)
				const pendingVUSDDebt_C_Asset = await vesselManager.getPendingDebtTokenReward(erc20.address, C)
				const defaultPoolETH_Asset = await defaultPool.getAssetBalance(erc20.address)
				const defaultPoolVUSDDebt_Asset = await defaultPool.getDebtTokenBalance(erc20.address)

				assert.isTrue(pendingETH_C_Asset.lte(defaultPoolETH_Asset))
				assert.isTrue(pendingVUSDDebt_C_Asset.lte(defaultPoolVUSDDebt_Asset))
				//Check only difference is dust

				assert.isAtMost(th.getDifference(pendingETH_C_Asset, defaultPoolETH_Asset), 1000)
				assert.isAtMost(th.getDifference(pendingVUSDDebt_C_Asset, defaultPoolVUSDDebt_Asset), 1000)

				// Confirm system is still in Recovery Mode
				assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

				// D and E fill the Stability Pool, enough to completely absorb C's debt of 70
				await stabilityPool.provideToSP(dec(50, 18), { from: D })
				await stabilityPool.provideToSP(dec(50, 18), { from: E })

				await priceFeed.setPrice(erc20.address, dec(50, 18))

				// Try to liquidate C again. Check it succeeds and closes C's vessel
				const liqTx2_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 2)

				assert.isTrue(liqTx2_Asset.receipt.status)
				assert.isFalse(await sortedVessels.contains(erc20.address, C))
				assert.isFalse(await sortedVessels.contains(erc20.address, D))
				assert.isTrue(await sortedVessels.contains(erc20.address, E))
				assert.isTrue((await sortedVessels.getSize(erc20.address)).eq(toBN("1")))
			})

			it("liquidateVessels(): closes every Vessel with ICR < MCR, when n > number of undercollateralized vessels", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})

				// create 5 Vessels with varying ICRs

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(195, 16)),
					extraParams: { from: erin },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: flyn },
				})

				// G,H, I open high-ICR vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: graham },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(90, 18)),
					extraParams: { from: harriet },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(80, 18)),
					extraParams: { from: ida },
				})

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(dec(300, 18), { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing Bob and Carol's ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm vessels A-E are ICR < 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).lte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, flyn, price)).lte(mv._MCR))

				// Confirm vessels G, H, I are ICR > 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, graham, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, harriet, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, ida, price)).gte(mv._MCR))

				// Confirm Whale is ICR > 110%
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))

				// Liquidate 5 vessels
				await vesselManagerOperations.liquidateVessels(erc20.address, 5)

				// Confirm vessels A-E have been removed from the system

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))
				assert.isFalse(await sortedVessels.contains(erc20.address, erin))
				assert.isFalse(await sortedVessels.contains(erc20.address, flyn))

				// Check all vessels A-E are now closed by liquidation

				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(flyn, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")

				// Check sorted list has been reduced to length 4
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")
			})

			it("liquidateVessels(): liquidates up to the requested number of undercollateralized vessels", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})

				// Alice, Bob, Carol, Dennis, Erin open vessels with consecutively decreasing collateral ratio
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(202, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(204, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(206, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(208, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraParams: { from: erin },
				})

				// --- TEST ---

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				await vesselManagerOperations.liquidateVessels(erc20.address, 3)

				const VesselOwnersArrayLength_Asset = await vesselManager.getVesselOwnersCount(erc20.address)
				assert.equal(VesselOwnersArrayLength_Asset, "3")

				// Check Alice, Bob, Carol vessels have been closed

				const aliceVesselStatus_Asset = (await vesselManager.getVesselStatus(erc20.address, alice)).toString()
				const bobVesselStatus_Asset = (await vesselManager.getVesselStatus(erc20.address, bob)).toString()
				const carolVesselStatus_Asset = (await vesselManager.getVesselStatus(erc20.address, carol)).toString()

				assert.equal(aliceVesselStatus_Asset, "3")
				assert.equal(bobVesselStatus_Asset, "3")
				assert.equal(carolVesselStatus_Asset, "3")

				//  Check Alice, Bob, and Carol's vessel are no longer in the sorted list

				const alice_isInSortedList_Asset = await sortedVessels.contains(erc20.address, alice)
				const bob_isInSortedList_Asset = await sortedVessels.contains(erc20.address, bob)
				const carol_isInSortedList_Asset = await sortedVessels.contains(erc20.address, carol)

				assert.isFalse(alice_isInSortedList_Asset)
				assert.isFalse(bob_isInSortedList_Asset)
				assert.isFalse(carol_isInSortedList_Asset)

				// Check Dennis, Erin still have active vessels
				const dennisVesselStatus_Asset = (await vesselManager.getVesselStatus(erc20.address, dennis)).toString()
				const erinVesselStatus_Asset = (await vesselManager.getVesselStatus(erc20.address, erin)).toString()

				assert.equal(dennisVesselStatus_Asset, "1")
				assert.equal(erinVesselStatus_Asset, "1")

				// Check Dennis, Erin still in sorted list

				const dennis_isInSortedList_Asset = await sortedVessels.contains(erc20.address, dennis)
				const erin_isInSortedList_Asset = await sortedVessels.contains(erc20.address, erin)

				assert.isTrue(dennis_isInSortedList_Asset)
				assert.isTrue(erin_isInSortedList_Asset)
			})

			it("liquidateVessels(): does nothing if all vessels have ICR > 110%", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(222, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(222, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(222, 16)),
					extraParams: { from: carol },
				})

				// Price drops, but all vessels remain active at 111% ICR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				assert.isTrue(await sortedVessels.contains(erc20.address, whale))
				assert.isTrue(await sortedVessels.contains(erc20.address, alice))
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				assert.isTrue(await sortedVessels.contains(erc20.address, carol))

				const TCR_Before_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
				const listSize_Before_Asset = (await sortedVessels.getSize(erc20.address)).toString()

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gte(mv._MCR))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Attempt liqudation sequence
				await assertRevert(
					vesselManagerOperations.liquidateVessels(erc20.address, 10),
					"VesselManager: nothing to liquidate"
				)

				// Check all vessels remain active

				assert.isTrue(await sortedVessels.contains(erc20.address, whale))
				assert.isTrue(await sortedVessels.contains(erc20.address, alice))
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				assert.isTrue(await sortedVessels.contains(erc20.address, carol))

				const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
				const listSize_After_Asset = (await sortedVessels.getSize(erc20.address)).toString()

				assert.equal(TCR_Before_Asset, TCR_After_Asset)
				assert.equal(listSize_Before_Asset, listSize_After_Asset)
			})

			it("liquidateVessels(): liquidates based on entire/collateral debt (including pending rewards), not raw collateral/debt", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(221, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_1 },
				})

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				const alice_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				const bob_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

				/* Before liquidation:
    Alice ICR: = (2 * 100 / 100) = 200%
    Bob ICR: (1 * 100 / 90.5) = 110.5%
    Carol ICR: (1 * 100 / 100 ) =  100%

    Therefore Alice and Bob above the MCR, Carol is below */
				assert.isTrue(alice_ICR_Before_Asset.gte(mv._MCR))
				assert.isTrue(bob_ICR_Before_Asset.gte(mv._MCR))
				assert.isTrue(carol_ICR_Before_Asset.lte(mv._MCR))

				// Liquidate defaulter. 30 VUSD and 0.3 ETH is distributed uniformly between A, B and C. Each receive 10 VUSD, 0.1 ETH
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

				const alice_ICR_After_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				const bob_ICR_After_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_After_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

				/* After liquidation:

    Alice ICR: (1.0995 * 100 / 60) = 183.25%
    Bob ICR:(1.0995 * 100 / 100.5) =  109.40%
    Carol ICR: (1.0995 * 100 / 110 ) 99.95%

    Check Alice is above MCR, Bob below, Carol below. */
				assert.isTrue(alice_ICR_After_Asset.gte(mv._MCR))
				assert.isTrue(bob_ICR_After_Asset.lte(mv._MCR))
				assert.isTrue(carol_ICR_After_Asset.lte(mv._MCR))

				/* Though Bob's true ICR (including pending rewards) is below the MCR, check that Bob's raw coll and debt has not changed */

				const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
				const bob_Debt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

				const bob_rawICR_Asset = bob_Coll_Asset.mul(toBN(dec(100, 18))).div(bob_Debt_Asset)
				assert.isTrue(bob_rawICR_Asset.gte(mv._MCR))

				// Whale enters system, pulling it into Normal Mode
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraVUSDAmount: dec(1, 24),
					extraParams: { from: whale },
				})

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				//liquidate A, B, C
				await vesselManagerOperations.liquidateVessels(erc20.address, 10)

				// Check A stays active, B and C get liquidated

				assert.isTrue(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// check vessel statuses - A active (1),  B and C closed by liquidation (3)
				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
			})

			it("liquidateVessels(): reverts if n = 0", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(206, 16)),
					extraParams: { from: carol },
				})

				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				const TCR_Before_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()

				// Confirm A, B, C ICRs are below 110%

				const alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

				assert.isTrue(alice_ICR_Asset.lte(mv._MCR))
				assert.isTrue(bob_ICR_Asset.lte(mv._MCR))
				assert.isTrue(carol_ICR_Asset.lte(mv._MCR))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidation with n = 0
				await assertRevert(
					vesselManagerOperations.liquidateVessels(erc20.address, 0),
					"VesselManager: nothing to liquidate"
				)

				// Check all vessels are still in the system

				assert.isTrue(await sortedVessels.contains(erc20.address, whale))
				assert.isTrue(await sortedVessels.contains(erc20.address, alice))
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				assert.isTrue(await sortedVessels.contains(erc20.address, carol))

				const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()

				// Check TCR has not changed after liquidation
				assert.equal(TCR_Before_Asset, TCR_After_Asset)
			})

			it("liquidateVessels(): liquidates vessels with ICR < MCR", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels that will remain active when price drops to 100

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(220, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(230, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(240, 16)),
					extraParams: { from: carol },
				})

				// D, E, F open vessels that will fall below MCR when price drops to 100

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(216, 16)),
					extraParams: { from: erin },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraParams: { from: flyn },
				})

				// Check list size is 7
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "7")

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				const alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
				const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
				const dennis_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
				const erin_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)
				const flyn_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, flyn, price)

				// Check A, B, C have ICR above MCR

				assert.isTrue(alice_ICR_Asset.gte(mv._MCR))
				assert.isTrue(bob_ICR_Asset.gte(mv._MCR))
				assert.isTrue(carol_ICR_Asset.gte(mv._MCR))

				// Check D, E, F have ICR below MCR

				assert.isTrue(dennis_ICR_Asset.lte(mv._MCR))
				assert.isTrue(erin_ICR_Asset.lte(mv._MCR))
				assert.isTrue(flyn_ICR_Asset.lte(mv._MCR))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				//Liquidate sequence
				await vesselManagerOperations.liquidateVessels(erc20.address, 10)

				// check list size reduced to 4
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

				// Check Whale and A, B, C remain in the system

				assert.isTrue(await sortedVessels.contains(erc20.address, whale))
				assert.isTrue(await sortedVessels.contains(erc20.address, alice))
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				assert.isTrue(await sortedVessels.contains(erc20.address, carol))

				// Check D, E, F have been removed

				assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
				assert.isFalse(await sortedVessels.contains(erc20.address, erin))
				assert.isFalse(await sortedVessels.contains(erc20.address, flyn))
			})

			it("liquidateVessels(): does not affect the liquidated user's token balances", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})

				// D, E, F open vessels that will fall below MCR when price drops to 100

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(218, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(216, 16)),
					extraParams: { from: erin },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(210, 16)),
					extraParams: { from: flyn },
				})

				const D_balanceBefore = await debtToken.balanceOf(dennis)
				const E_balanceBefore = await debtToken.balanceOf(erin)
				const F_balanceBefore = await debtToken.balanceOf(flyn)

				// Check list size is 4
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				//Liquidate sequence
				await vesselManagerOperations.liquidateVessels(erc20.address, 10)

				// check list size reduced to 1
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "1")

				// Check Whale remains in the system
				assert.isTrue(await sortedVessels.contains(erc20.address, whale))

				// Check D, E, F have been removed

				assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
				assert.isFalse(await sortedVessels.contains(erc20.address, erin))
				assert.isFalse(await sortedVessels.contains(erc20.address, flyn))

				// Check token balances of users whose vessels were liquidated, have not changed
				assert.equal((await debtToken.balanceOf(dennis)).toString(), D_balanceBefore.toString())
				assert.equal((await debtToken.balanceOf(erin)).toString(), E_balanceBefore.toString())
				assert.equal((await debtToken.balanceOf(flyn)).toString(), F_balanceBefore.toString())
			})

			it("liquidateVessels(): a liquidation sequence containing Pool offsets increases the TCR", async () => {
				// Whale provides 500 VUSD to SP
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: toBN(dec(500, 18)),
					extraParams: { from: whale },
				})

				await stabilityPool.provideToSP(dec(500, 18), { from: whale })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(28, 18)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(8, 18)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(80, 18)),
					extraParams: { from: dennis },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(199, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(156, 16)),
					extraParams: { from: defaulter_2 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(183, 16)),
					extraParams: { from: defaulter_3 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(166, 16)),
					extraParams: { from: defaulter_4 },
				})

				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "9")

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)

				// Check pool has 500 VUSD
				assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), dec(500, 18))

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate vessels
				await vesselManagerOperations.liquidateVessels(erc20.address, 10)

				// Check pool has been emptied by the liquidations
				assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), "0")

				// Check all defaulters have been liquidated

				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))

				// check system sized reduced to 5 vessels
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "5")

				// Check that the liquidation sequence has improved the TCR
				const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
				assert.isTrue(TCR_After_Asset.gte(TCR_Before_Asset))
			})

			it("liquidateVessels(): a liquidation sequence of pure redistributions decreases the TCR, due to gas compensation, but up to 0.5%", async () => {
				const { collateral: W_coll_Asset, totalDebt: W_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})
				const { collateral: A_coll_Asset, totalDebt: A_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				const { collateral: B_coll_Asset, totalDebt: B_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(28, 18)),
					extraParams: { from: bob },
				})
				const { collateral: C_coll_Asset, totalDebt: C_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(8, 18)),
					extraParams: { from: carol },
				})
				const { collateral: D_coll_Asset, totalDebt: D_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(80, 18)),
					extraParams: { from: dennis },
				})

				const { collateral: d1_coll_Asset, totalDebt: d1_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(199, 16)),
					extraParams: { from: defaulter_1 },
				})
				const { collateral: d2_coll_Asset, totalDebt: d2_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(156, 16)),
					extraParams: { from: defaulter_2 },
				})
				const { collateral: d3_coll_Asset, totalDebt: d3_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(183, 16)),
					extraParams: { from: defaulter_3 },
				})
				const { collateral: d4_coll_Asset, totalDebt: d4_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(166, 16)),
					extraParams: { from: defaulter_4 },
				})

				const totalCollNonDefaulters_Asset = W_coll_Asset.add(A_coll_Asset)
					.add(B_coll_Asset)
					.add(C_coll_Asset)
					.add(D_coll_Asset)
				const totalCollDefaulters_Asset = d1_coll_Asset.add(d2_coll_Asset).add(d3_coll_Asset).add(d4_coll_Asset)
				const totalColl_Asset = totalCollNonDefaulters_Asset.add(totalCollDefaulters_Asset)
				const totalDebt_Asset = W_debt_Asset.add(A_debt_Asset)
					.add(B_debt_Asset)
					.add(C_debt_Asset)
					.add(D_debt_Asset)
					.add(d1_debt_Asset)
					.add(d2_debt_Asset)
					.add(d3_debt_Asset)
					.add(d4_debt_Asset)

				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "9")

				// Price drops
				const price = toBN(dec(100, 18))
				await priceFeed.setPrice(erc20.address, price)

				const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
				assert.isAtMost(th.getDifference(TCR_Before_Asset, totalColl_Asset.mul(price).div(totalDebt_Asset)), 1000)

				// Check pool is empty before liquidation
				assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), "0")

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate
				await vesselManagerOperations.liquidateVessels(erc20.address, 10)

				// Check all defaulters have been liquidated

				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))

				// check system sized reduced to 5 vessels
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "5")

				// Check that the liquidation sequence has reduced the TCR
				const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
				// ((100+1+7+2+20)+(1+2+3+4)*0.995)*100/(2050+50+50+50+50+101+257+328+480)

				assert.isAtMost(
					th.getDifference(
						TCR_After_Asset,
						totalCollNonDefaulters_Asset
							.add(th.applyLiquidationFee(totalCollDefaulters_Asset))
							.mul(price)
							.div(totalDebt_Asset)
					),
					1000
				)
				assert.isTrue(TCR_Before_Asset.gte(TCR_After_Asset))
				assert.isTrue(TCR_After_Asset.gte(TCR_Before_Asset.mul(toBN(995)).div(toBN(1000))))
			})

			it("liquidateVessels(): liquidating vessels with SP deposits correctly impacts their SP deposit and ETH gain", async () => {
				// Whale provides 400 VUSD to the SP
				const whaleDeposit = toBN(dec(40000, 18))
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: whaleDeposit,
					extraParams: { from: whale },
				})
				await stabilityPool.provideToSP(whaleDeposit, { from: whale })

				const A_deposit = toBN(dec(10000, 18))
				const B_deposit = toBN(dec(30000, 18))

				const { collateral: A_coll_Asset, totalDebt: A_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: A_deposit,
					extraParams: { from: alice },
				})
				const { collateral: B_coll_Asset, totalDebt: B_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: B_deposit,
					extraParams: { from: bob },
				})
				const { collateral: C_coll_Asset, totalDebt: C_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: carol },
				})

				const liquidatedColl_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)
				const liquidatedDebt_Asset = A_debt_Asset.add(B_debt_Asset).add(C_debt_Asset)

				// A, B provide 100, 300 to the SP

				await stabilityPool.provideToSP(A_deposit, { from: alice })
				await stabilityPool.provideToSP(B_deposit, { from: bob })

				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				// Check 800 VUSD in Pool
				const totalDeposits = whaleDeposit.add(A_deposit).add(B_deposit)
				const totalDeposits_Asset = whaleDeposit.add(A_deposit).add(B_deposit)
				assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), totalDeposits)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate
				await vesselManagerOperations.liquidateVessels(erc20.address, 10)

				// Check all defaulters have been liquidated

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// check system sized reduced to 1 vessels
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "1")

				/* Prior to liquidation, SP deposits were:
    Whale: 400 VUSD
    Alice: 100 VUSD
    Bob:   300 VUSD
    Carol: 0 VUSD

    Total VUSD in Pool: 800 VUSD

    Then, liquidation hits A,B,C:

    Total liquidated debt = 150 + 350 + 150 = 650 VUSD
    Total liquidated ETH = 1.1 + 3.1 + 1.1 = 5.3 ETH

    whale VUSD loss: 650 * (400/800) = 325 VUSD
    alice VUSD loss:  650 *(100/800) = 81.25 VUSD
    bob VUSD loss: 650 * (300/800) = 243.75 VUSD

    whale remaining deposit: (400 - 325) = 75 VUSD
    alice remaining deposit: (100 - 81.25) = 18.75 VUSD
    bob remaining deposit: (300 - 243.75) = 56.25 VUSD

    whale eth gain: 5*0.995 * (400/800) = 2.4875 eth
    alice eth gain: 5*0.995 *(100/800) = 0.621875 eth
    bob eth gain: 5*0.995 * (300/800) = 1.865625 eth

    Total remaining deposits: 150 VUSD
    Total ETH gain: 4.975 ETH */

				// Check remaining VUSD Deposits and ETH gain, for whale and depositors whose vessels were liquidated

				const whale_Deposit_After_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(whale)
				const alice_Deposit_After_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
				const bob_Deposit_After_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(bob)

				const whale_ETHGain_Asset = (await stabilityPool.getDepositorGains(whale))[1][1]
				const alice_ETHGain_Asset = (await stabilityPool.getDepositorGains(alice))[1][1]
				const bob_ETHGain_Asset = (await stabilityPool.getDepositorGains(bob))[1][1]

				assert.isAtMost(
					th.getDifference(
						whale_Deposit_After_Asset,
						whaleDeposit.sub(liquidatedDebt_Asset.mul(whaleDeposit).div(totalDeposits_Asset))
					),
					100000
				)
				assert.isAtMost(
					th.getDifference(
						alice_Deposit_After_Asset,
						A_deposit.sub(liquidatedDebt_Asset.mul(A_deposit).div(totalDeposits_Asset))
					),
					100000
				)
				assert.isAtMost(
					th.getDifference(
						bob_Deposit_After_Asset,
						B_deposit.sub(liquidatedDebt_Asset.mul(B_deposit).div(totalDeposits_Asset))
					),
					100000
				)

				assert.isAtMost(
					th.getDifference(
						whale_ETHGain_Asset,
						th.applyLiquidationFee(liquidatedColl_Asset).mul(whaleDeposit).div(totalDeposits_Asset)
					),
					100000
				)
				assert.isAtMost(
					th.getDifference(
						alice_ETHGain_Asset,
						th.applyLiquidationFee(liquidatedColl_Asset).mul(A_deposit).div(totalDeposits_Asset)
					),
					100000
				)
				assert.isAtMost(
					th.getDifference(
						bob_ETHGain_Asset,
						th.applyLiquidationFee(liquidatedColl_Asset).mul(B_deposit).div(totalDeposits_Asset)
					),
					100000
				)

				// Check total remaining deposits and ETH gain in Stability Pool

				const total_VUSDinSP_Asset = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
				const total_ETHinSP_Asset = (await stabilityPool.getCollateral(erc20.address)).toString()

				assert.isAtMost(th.getDifference(total_VUSDinSP_Asset, totalDeposits_Asset.sub(liquidatedDebt_Asset)), 1000)
				assert.isAtMost(th.getDifference(total_ETHinSP_Asset, th.applyLiquidationFee(liquidatedColl_Asset)), 1000)
			})

			it("liquidateVessels(): when SP > 0, triggers GRVT reward event - increases the sum G", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: C },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(219, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(213, 16)),
					extraParams: { from: defaulter_2 },
				})

				// B provides to SP

				await stabilityPool.provideToSP(dec(100, 18), { from: B })
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), dec(100, 18))

				const G_Before_Asset = await stabilityPool.epochToScaleToG(0, 0)

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Price drops to 1ETH:100VUSD, reducing defaulters to below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await priceFeed.getPrice(erc20.address)
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate vessels

				await vesselManagerOperations.liquidateVessels(erc20.address, 2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const G_After_Asset = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has increased from the GRVT reward event triggered
				assert.isTrue(G_After_Asset.gt(G_Before_Asset))
			})

			it("liquidateVessels(): when SP is empty, doesn't update G", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraVUSDAmount: toBN(dec(100, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraParams: { from: C },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(219, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(213, 16)),
					extraParams: { from: defaulter_2 },
				})

				// B provides to SP
				await stabilityPool.provideToSP(dec(100, 18), { from: B })

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B withdraws
				await stabilityPool.withdrawFromSP(dec(100, 18), { from: B })

				// Check SP is empty
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), "0")

				// Check G is non-zero

				const G_Before_Asset = await stabilityPool.epochToScaleToG(0, 0)
				assert.isTrue(G_Before_Asset.gt(toBN("0")))

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Price drops to 1ETH:100VUSD, reducing defaulters to below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await priceFeed.getPrice(erc20.address)
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// liquidate vessels

				await vesselManagerOperations.liquidateVessels(erc20.address, 2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const G_After_Asset = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has not changed
				assert.isTrue(G_After_Asset.eq(G_Before_Asset))
			})
		})

		// --- batchLiquidateVessels() ---

		describe("Batch Liquidations", async () => {
			it("batchLiquidateVessels(): liquidates a Vessel that a) was skipped in a previous liquidation and b) has pending rewards", async () => {
				// A, B, C, D, E open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(364, 16)),
					extraParams: { from: D },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(364, 16)),
					extraParams: { from: E },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraParams: { from: B },
				})

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(175, 18))
				let price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// A gets liquidated, creates pending rewards for all
				const liqTxA_Asset = await vesselManagerOperations.liquidate(erc20.address, A)
				assert.isTrue(liqTxA_Asset.receipt.status)
				assert.isFalse(await sortedVessels.contains(erc20.address, A))

				// A adds 10 VUSD to the SP, but less than C's debt
				await stabilityPool.provideToSP(dec(10, 18), { from: A })

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				price = await priceFeed.getPrice(erc20.address)
				// Confirm system is now in Recovery Mode
				assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm C has ICR > TCR

				const TCR_Asset = await vesselManager.getTCR(erc20.address, price)
				const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, C, price)

				assert.isTrue(ICR_C_Asset.gt(TCR_Asset))

				// Attempt to liquidate B and C, which skips C in the liquidation since it is immune
				const liqTxBC_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 2)
				assert.isTrue(liqTxBC_Asset.receipt.status)

				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isTrue(await sortedVessels.contains(erc20.address, C))
				assert.isTrue(await sortedVessels.contains(erc20.address, D))
				assert.isTrue(await sortedVessels.contains(erc20.address, E))

				// // All remaining vessels D and E repay a little debt, applying their pending rewards

				assert.isTrue((await sortedVessels.getSize(erc20.address)).eq(toBN("3")))
				await borrowerOperations.repayDebtTokens(erc20.address, dec(1, 18), D, D, { from: D })
				await borrowerOperations.repayDebtTokens(erc20.address, dec(1, 18), E, E, { from: E })

				// Check C is the only vessel that has pending rewards

				assert.isTrue(await vesselManager.hasPendingRewards(erc20.address, C))
				assert.isFalse(await vesselManager.hasPendingRewards(erc20.address, D))
				assert.isFalse(await vesselManager.hasPendingRewards(erc20.address, E))

				// Check C's pending coll and debt rewards are <= the coll and debt in the DefaultPool

				const pendingETH_C_Asset = await vesselManager.getPendingAssetReward(erc20.address, C)
				const pendingVUSDDebt_C_Asset = await vesselManager.getPendingDebtTokenReward(erc20.address, C)
				const defaultPoolETH_Asset = await defaultPool.getAssetBalance(erc20.address)
				const defaultPoolVUSDDebt_Asset = await defaultPool.getDebtTokenBalance(erc20.address)

				assert.isTrue(pendingETH_C_Asset.lte(defaultPoolETH_Asset))
				assert.isTrue(pendingVUSDDebt_C_Asset.lte(defaultPoolVUSDDebt_Asset))
				//Check only difference is dust

				assert.isAtMost(th.getDifference(pendingETH_C_Asset, defaultPoolETH_Asset), 1000)
				assert.isAtMost(th.getDifference(pendingVUSDDebt_C_Asset, defaultPoolVUSDDebt_Asset), 1000)

				// Confirm system is still in Recovery Mode
				assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

				// D and E fill the Stability Pool, enough to completely absorb C's debt of 70

				await stabilityPool.provideToSP(dec(50, 18), { from: D })
				await stabilityPool.provideToSP(dec(50, 18), { from: E })

				await priceFeed.setPrice(erc20.address, dec(50, 18))

				// Try to liquidate C again. Check it succeeds and closes C's vessel
				const liqTx2_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, [C, D])
				assert.isTrue(liqTx2_Asset.receipt.status)

				assert.isFalse(await sortedVessels.contains(erc20.address, C))
				assert.isFalse(await sortedVessels.contains(erc20.address, D))
				assert.isTrue(await sortedVessels.contains(erc20.address, E))
				assert.isTrue((await sortedVessels.getSize(erc20.address)).eq(toBN("1")))
			})

			it("batchLiquidateVessels(): closes every vessel with ICR < MCR in the given array", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2000, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1800, 16)),
					extraParams: { from: erin },
				})

				// Check full sorted list size is 6
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "6")

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(dec(300, 18), { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing A, B, C ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm vessels A-C are ICR < 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))

				// Confirm D-E are ICR > 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).gte(mv._MCR))

				// Confirm Whale is ICR >= 110%
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))

				liquidationArray = [alice, bob, carol, dennis, erin]
				await vesselManagerOperations.batchLiquidateVessels(erc20.address, liquidationArray)

				// Confirm vessels A-C have been removed from the system

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				// Check all vessels A-C are now closed by liquidation

				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")

				// Check sorted list has been reduced to length 3
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "3")
			})

			it("batchLiquidateVessels(): does not liquidate vessels that are not in the given array", async () => {
				// --- SETUP ---

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: toBN(dec(500, 18)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: toBN(dec(500, 18)),
					extraParams: { from: erin },
				})

				// Check full sorted list size is 6
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "6")

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(dec(300, 18), { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing A, B, C ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm vessels A-E are ICR < 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).lt(mv._MCR))

				liquidationArray = [alice, bob] // C-E not included
				await vesselManagerOperations.batchLiquidateVessels(erc20.address, liquidationArray)

				// Confirm vessels A-B have been removed from the system

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				// Check all vessels A-B are now closed by liquidation

				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")

				// Confirm vessels C-E remain in the system

				assert.isTrue(await sortedVessels.contains(erc20.address, carol))
				assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
				assert.isTrue(await sortedVessels.contains(erc20.address, erin))

				// Check all vessels C-E are still active

				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
				assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
				assert.equal((await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")

				// Check sorted list has been reduced to length 4
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")
			})

			it("batchLiquidateVessels(): does not close vessels with ICR >= MCR in the given array", async () => {
				// --- SETUP ---

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(195, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2000, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1800, 16)),
					extraParams: { from: erin },
				})

				// Check full sorted list size is 6
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "6")

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(dec(300, 18), { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing A, B, C ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm vessels A-C are ICR < 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))

				// Confirm D-E are ICR >= 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).gte(mv._MCR))

				// Confirm Whale is ICR > 110%
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))

				liquidationArray = [alice, bob, carol, dennis, erin]
				await vesselManagerOperations.batchLiquidateVessels(erc20.address, liquidationArray)

				// Confirm vessels D-E and whale remain in the system

				assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
				assert.isTrue(await sortedVessels.contains(erc20.address, erin))
				assert.isTrue(await sortedVessels.contains(erc20.address, whale))

				// Check all vessels D-E and whale remain active

				assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
				assert.equal((await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
				assert.isTrue(await sortedVessels.contains(erc20.address, whale))

				// Check sorted list has been reduced to length 3
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "3")
			})

			it("batchLiquidateVessels(): reverts if array is empty", async () => {
				// --- SETUP ---

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(195, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2000, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1800, 16)),
					extraParams: { from: erin },
				})

				// Check full sorted list size is 6
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "6")

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(dec(300, 18), { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing A, B, C ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				liquidationArray = []
				try {
					const tx = await vesselManagerOperations.batchLiquidateVessels(erc20.address, liquidationArray)
					assert.isFalse(tx.receipt.status)
				} catch (error) {
					assert.include(error.message, "VesselManagerOperations__InvalidArraySize()")
				}
			})

			it("batchLiquidateVessels(): skips if vessel is non-existent", async () => {
				// --- SETUP ---
				const spDeposit = toBN(dec(500000, 18))
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: spDeposit,
					extraParams: { from: whale },
				})

				const { totalDebt: A_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: alice },
				})
				const { totalDebt: B_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2000, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1800, 16)),
					extraParams: { from: erin },
				})

				assert.equal(await vesselManager.getVesselStatus(erc20.address, carol), 0) // check vessel non-existent

				// Check full sorted list size is 6
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "5")

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(spDeposit, { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing A, B, C ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm vessels A-B are ICR < 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))

				// Confirm D-E are ICR > 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).gte(mv._MCR))

				// Confirm Whale is ICR >= 110%
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))

				// Liquidate - vessel C in between the ones to be liquidated!
				const liquidationArray = [alice, carol, bob, dennis, erin]
				await vesselManagerOperations.batchLiquidateVessels(erc20.address, liquidationArray)

				// Confirm vessels A-B have been removed from the system

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				// Check all vessels A-B are now closed by liquidation

				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")

				// Check sorted list has been reduced to length 3
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "3")

				// Confirm vessel C non-existent

				assert.isFalse(await sortedVessels.contains(erc20.address, carol))
				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "0")

				// Check Stability pool has only been reduced by A-B
				th.assertIsApproximatelyEqual(
					(await stabilityPool.getTotalDebtTokenDeposits()).toString(),
					spDeposit.sub(A_debt_Asset).sub(B_debt_Asset)
				)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
			})

			it("batchLiquidateVessels(): skips if a vessel has been closed", async () => {
				// --- SETUP ---
				const spDeposit = toBN(dec(500000, 18))
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: spDeposit,
					extraParams: { from: whale },
				})

				const { totalDebt: A_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraParams: { from: alice },
				})
				const { totalDebt: B_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: bob },
				})

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(195, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2000, 16)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1800, 16)),
					extraParams: { from: erin },
				})

				assert.isTrue(await sortedVessels.contains(erc20.address, carol))

				// Check full sorted list size is 6
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "6")

				// Whale puts some tokens in Stability Pool
				await stabilityPool.provideToSP(spDeposit, { from: whale })

				// Whale transfers to Carol so she can close her vessel
				await debtToken.transfer(carol, dec(200, 18), { from: whale })

				// --- TEST ---

				// Price drops to 1ETH:100VUSD, reducing A, B, C ICR below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Carol liquidated, and her vessel is closed
				const txCarolClose_Asset = await borrowerOperations.closeVessel(erc20.address, {
					from: carol,
				})
				assert.isTrue(txCarolClose_Asset.receipt.status)

				assert.isFalse(await sortedVessels.contains(erc20.address, carol))

				assert.equal(await vesselManager.getVesselStatus(erc20.address, carol), 2) // check vessel closed

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Confirm vessels A-B are ICR < 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))

				// Confirm D-E are ICR > 110%

				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).gte(mv._MCR))
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).gte(mv._MCR))

				// Confirm Whale is ICR >= 110%
				assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))

				// Liquidate - vessel C in between the ones to be liquidated!
				const liquidationArray = [alice, carol, bob, dennis, erin]
				await vesselManagerOperations.batchLiquidateVessels(erc20.address, liquidationArray)

				// Confirm vessels A-B have been removed from the system

				assert.isFalse(await sortedVessels.contains(erc20.address, alice))
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				// Check all vessels A-B are now closed by liquidation

				assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
				assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")

				// Vessel C still closed by user
				assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "2")

				// Check sorted list has been reduced to length 3
				assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "3")

				// Check Stability pool has only been reduced by A-B
				th.assertIsApproximatelyEqual(
					(await stabilityPool.getTotalDebtTokenDeposits()).toString(),
					spDeposit.sub(A_debt_Asset).sub(B_debt_Asset)
				)

				// Confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
			})

			it("batchLiquidateVessels: when SP > 0, triggers GRVT reward event - increases the sum G", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(167, 16)),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_2 },
				})

				// B provides to SP
				await stabilityPool.provideToSP(dec(100, 18), { from: B })
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), dec(100, 18))

				const G_Before_Asset = await stabilityPool.epochToScaleToG(0, 0)

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Price drops to 1ETH:100VUSD, reducing defaulters to below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await priceFeed.getPrice(erc20.address)
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// Liquidate vessels

				await vesselManagerOperations.batchLiquidateVessels(erc20.address, [defaulter_1, defaulter_2])
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const G_After_Asset = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has increased from the GRVT reward event triggered
				assert.isTrue(G_After_Asset.gt(G_Before_Asset))
			})

			it("batchLiquidateVessels(): when SP is empty, doesn't update G", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// A, B, C open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(167, 16)),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: defaulter_2 },
				})

				// B provides to SP
				await stabilityPool.provideToSP(dec(100, 18), { from: B })

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B withdraws
				await stabilityPool.withdrawFromSP(dec(100, 18), { from: B })

				// Check SP is empty
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), "0")

				// Check G is non-zero
				const G_Before_Asset = await stabilityPool.epochToScaleToG(0, 0)
				assert.isTrue(G_Before_Asset.gt(toBN("0")))

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Price drops to 1ETH:100VUSD, reducing defaulters to below MCR
				await priceFeed.setPrice(erc20.address, dec(100, 18))
				await priceFeed.getPrice(erc20.address)
				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

				// liquidate vessels

				await vesselManagerOperations.batchLiquidateVessels(erc20.address, [defaulter_1, defaulter_2])
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const G_After_Asset = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has not changed
				assert.isTrue(G_After_Asset.eq(G_Before_Asset))
			})
		})

		// --- redemptions ---

		describe("Redemptions", async () => {
			it("getRedemptionHints(): gets the address of the first Vessel and the final ICR of the last Vessel involved in a redemption", async () => {
				// --- SETUP ---
				const partialRedemptionAmount = toBN(dec(100, 18))
				const { collateral: A_coll, totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(310, 16)),
					extraVUSDAmount: partialRedemptionAmount,
					extraParams: { from: alice },
				})
				const { netDebt: B_debt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraParams: { from: bob },
				})
				const { netDebt: C_debt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(250, 16)),
					extraParams: { from: carol },
				})

				// Dennis' Vessel should be untouched by redemption, because its ICR will be < 110% after the price drop
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(120, 16)),
					extraParams: { from: dennis },
				})

				// Drop the price
				const price = toBN(dec(100, 18))
				await priceFeed.setPrice(erc20.address, price)

				// --- TEST ---
				const redemptionAmount = C_debt.add(B_debt).add(partialRedemptionAmount)

				const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, redemptionAmount, price, 0)

				assert.equal(firstRedemptionHint, carol)
				const expectedICR = A_coll.mul(price)
					.sub(partialRedemptionAmount.mul(mv._1e18BN))
					.div(A_totalDebt.sub(partialRedemptionAmount))
				const errorMargin = toBN(firstRedemptionHint).div(toBN(100)) // allow for a 1% error margin
				th.assertIsApproximatelyEqual(partialRedemptionHintNewICR, expectedICR, Number(errorMargin))
			})

			it("getRedemptionHints(): returns 0 as partialRedemptionHintNICR_Asset when reaching _maxIterations", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(310, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(250, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraParams: { from: dennis },
				})

				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---

				// Get hints for a redemption of 170 + 30 + some extra VUSD. At least 3 iterations are needed
				// for total redemption of the given amount.

				const { 1: partialRedemptionHintNICR_Asset } = await vesselManagerOperations.getRedemptionHints(
					erc20.address,
					"210" + _18_zeros,
					price,
					2
				) // limit _maxIterations to 2

				assert.equal(partialRedemptionHintNICR_Asset, "0")
			}),
				it("redeemCollateral(): soft redemption dates", async () => {
					const redemptionWait = 14 * 24 * 60 * 60 // 14 days
					const redemptionBlock = (await time.latest()) + redemptionWait
					// turn off redemptions for 2 weeks
					await adminContract.setRedemptionBlockTimestamp(erc20.address, redemptionBlock)

					const { netDebt: aliceDebt } = await openVessel({
						asset: erc20.address,
						ICR: toBN(dec(290, 16)),
						extraVUSDAmount: dec(8, 18),
						extraParams: { from: alice },
					})
					const { netDebt: bobDebt } = await openVessel({
						asset: erc20.address,
						ICR: toBN(dec(250, 16)),
						extraVUSDAmount: dec(10, 18),
						extraParams: { from: bob },
					})
					const redemptionAmount = aliceDebt.add(bobDebt)

					await openVessel({
						asset: erc20.address,
						ICR: toBN(dec(100, 18)),
						extraVUSDAmount: redemptionAmount,
						extraParams: { from: dennis },
					})

					const price = await priceFeed.getPrice(erc20.address)

					const { 1: hintNICR } = await vesselManagerOperations.getRedemptionHints(
						erc20.address,
						redemptionAmount,
						price,
						0
					)
					const { 0: upperHint, 1: lowerHint } = await sortedVessels.findInsertPosition(
						erc20.address,
						hintNICR,
						dennis,
						dennis
					)

					// expect tx before the redemption block to revert
					const tx = vesselManagerOperations.redeemCollateral(
						erc20.address,
						redemptionAmount,
						ZERO_ADDRESS,
						upperHint,
						lowerHint,
						hintNICR,
						0,
						th._100pct,
						{ from: dennis }
					)
					await th.assertRevert(tx)

					// skip redemption
					await time.increase(redemptionWait)

					// this time tx should succeed
					await vesselManagerOperations.redeemCollateral(
						erc20.address,
						redemptionAmount,
						ZERO_ADDRESS,
						upperHint,
						lowerHint,
						hintNICR,
						0,
						th._100pct,
						{ from: dennis }
					)
				})

			it("redeemCollateral(): cancels the provided debtTokens with debt from Vessels with the lowest ICRs and sends an equivalent amount of collateral", async () => {
				const { totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(310, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(8, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(250, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: carol },
				})

				const partialRedemptionAmount = toBN(2)
				const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)

				// start Dennis with a high ICR
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: redemptionAmount,
					extraParams: { from: dennis },
				})

				const dennis_CollBalance_Before = toBN(await erc20.balanceOf(dennis))
				const dennis_DebtTokenBalance_Before = await debtToken.balanceOf(dennis)

				const price = await priceFeed.getPrice(erc20.address)

				const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, redemptionAmount, price, 0)

				// We don't need to use getApproxHint for this test, since it's not the subject of this
				// test case, and the list is very small, so the correct position is quickly found
				const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
					erc20.address,
					partialRedemptionHintNewICR,
					dennis,
					dennis
				)

				// skip redemption bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Dennis redeems 20 debt tokens
				// Don't pay for gas, as it makes it easier to calculate the received collateral

				const redemptionTx = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount,
					firstRedemptionHint,
					upperPartialRedemptionHint,
					lowerPartialRedemptionHint,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: dennis }
				)

				const collFee = th.getEmittedRedemptionValues(redemptionTx)[3]

				const alice_Vessel_After = await vesselManager.Vessels(alice, erc20.address)
				const bob_Vessel_After = await vesselManager.Vessels(bob, erc20.address)
				const carol_Vessel_After = await vesselManager.Vessels(carol, erc20.address)

				const alice_debt_After = alice_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const bob_debt_After = bob_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const carol_debt_After = carol_Vessel_After[th.VESSEL_DEBT_INDEX].toString()

				// check that Dennis' redeemed 20 debt tokens have been cancelled with debt from Bobs's Vessel (8) and Carol's Vessel (10).
				// The remaining lot (2) is sent to Alice's Vessel, who had the best ICR.
				// It leaves her with (3) debt tokens + 50 for gas compensation.
				th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
				assert.equal(bob_debt_After, "0")
				assert.equal(carol_debt_After, "0")

				const dennis_CollBalance_After = toBN(await erc20.balanceOf(dennis))
				const receivedColl = dennis_CollBalance_After.sub(dennis_CollBalance_Before)

				const expectedTotalCollDrawn = calcSoftnedAmount(redemptionAmount, price)
				const expectedReceivedColl = expectedTotalCollDrawn.sub(toBN(collFee))

				th.assertIsApproximatelyEqual(expectedReceivedColl, receivedColl)

				const dennis_DebtTokenBalance_After = (await debtToken.balanceOf(dennis)).toString()
				th.assertIsApproximatelyEqual(
					dennis_DebtTokenBalance_After,
					dennis_DebtTokenBalance_Before.sub(redemptionAmount)
				)
			})

			it("redeemCollateral(): with invalid first hint, zero address", async () => {
				const { totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(310, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(8, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(250, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: carol },
				})

				const partialRedemptionAmount = toBN(2)
				const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)

				// start Dennis with a high ICR
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: redemptionAmount,
					extraParams: { from: dennis },
				})

				const dennis_CollBalance_Before = toBN(await erc20.balanceOf(dennis))
				const dennis_DebtTokenBalance_Before = await debtToken.balanceOf(dennis)

				const price = await priceFeed.getPrice(erc20.address)

				// Find hints for redeeming 20 debt tokens
				const { 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
					erc20.address,
					redemptionAmount,
					price,
					0
				)

				// We don't need to use getApproxHint for this test, since it's not the subject of this
				// test case, and the list is very small, so the correct position is quickly found
				const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
					erc20.address,
					partialRedemptionHintNewICR,
					dennis,
					dennis
				)

				// skip redemption bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Dennis redeems 20 debt tokens
				const redemptionTx = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount,
					ZERO_ADDRESS, // invalid first hint
					upperPartialRedemptionHint,
					lowerPartialRedemptionHint,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: dennis }
				)

				const collFee = th.getEmittedRedemptionValues(redemptionTx)[3]

				const alice_Vessel_After = await vesselManager.Vessels(alice, erc20.address)
				const bob_Vessel_After = await vesselManager.Vessels(bob, erc20.address)
				const carol_Vessel_After = await vesselManager.Vessels(carol, erc20.address)

				const alice_debt_After = alice_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const bob_debt_After = bob_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const carol_debt_After = carol_Vessel_After[th.VESSEL_DEBT_INDEX].toString()

				// check that Dennis' redeemed 20 debt tokens have been cancelled with debt from Bobs's Vessel (8) and Carol's Vessel (10).
				// The remaining lot (2) is sent to Alice's Vessel, who had the best ICR.
				// It leaves her with (3) debt tokens + 50 for gas compensation.
				th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
				assert.equal(bob_debt_After, "0")
				assert.equal(carol_debt_After, "0")

				const dennis_CollBalance_After = toBN(await erc20.balanceOf(dennis))
				const receivedColl = dennis_CollBalance_After.sub(dennis_CollBalance_Before)

				const expectedTotalCollDrawn = calcSoftnedAmount(redemptionAmount, price)
				const expectedReceivedColl = expectedTotalCollDrawn.sub(toBN(collFee))

				th.assertIsApproximatelyEqual(expectedReceivedColl, receivedColl)

				const dennis_DebtTokenBalance_After = (await debtToken.balanceOf(dennis)).toString()
				th.assertIsApproximatelyEqual(
					dennis_DebtTokenBalance_After,
					dennis_DebtTokenBalance_Before.sub(redemptionAmount)
				)
			})

			it("redeemCollateral(): with invalid first hint, non-existent vessel", async () => {
				const { totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(310, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(8, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(250, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: carol },
				})

				const partialRedemptionAmount = toBN(2)
				const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)

				// start Dennis with a high ICR
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: redemptionAmount,
					extraParams: { from: dennis },
				})

				const dennis_CollBalance_Before = toBN(await erc20.balanceOf(dennis))
				const dennis_DebtTokenBalance_Before = await debtToken.balanceOf(dennis)
				const price = await priceFeed.getPrice(erc20.address)

				// Find hints for redeeming 20 debt tokens
				const { 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
					erc20.address,
					redemptionAmount,
					price,
					0
				)

				// We don't need to use getApproxHint for this test, since it's not the subject of this
				// test case, and the list is very small, so the correct position is quickly found
				const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
					erc20.address,
					partialRedemptionHintNewICR,
					dennis,
					dennis
				)

				// skip redemption bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Dennis redeems 20 debt tokens
				const redemptionTx = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount,
					erin, // invalid first hint, it doesn’t have a vessel
					upperPartialRedemptionHint,
					lowerPartialRedemptionHint,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: dennis }
				)

				const collFee = th.getEmittedRedemptionValues(redemptionTx)[3]

				const alice_Vessel_After = await vesselManager.Vessels(alice, erc20.address)
				const bob_Vessel_After = await vesselManager.Vessels(bob, erc20.address)
				const carol_Vessel_After = await vesselManager.Vessels(carol, erc20.address)

				const alice_debt_After = alice_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const bob_debt_After = bob_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const carol_debt_After = carol_Vessel_After[th.VESSEL_DEBT_INDEX].toString()

				// check that Dennis' redeemed 20 debt tokens have been cancelled with debt from Bobs's Vessel (8) and Carol's Vessel (10).
				// The remaining lot (2) is sent to Alice's Vessel, who had the best ICR.
				// It leaves her with (3) debt tokens + 50 for gas compensation.
				th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
				assert.equal(bob_debt_After, "0")
				assert.equal(carol_debt_After, "0")

				const dennis_CollBalance_After = toBN(await erc20.balanceOf(dennis))
				const receivedColl = dennis_CollBalance_After.sub(dennis_CollBalance_Before)

				const expectedTotalCollDrawn = calcSoftnedAmount(redemptionAmount, price)
				const expectedReceivedColl = expectedTotalCollDrawn.sub(toBN(collFee))

				th.assertIsApproximatelyEqual(expectedReceivedColl, receivedColl)

				const dennis_DebtTokenBalance_After = (await debtToken.balanceOf(dennis)).toString()
				th.assertIsApproximatelyEqual(
					dennis_DebtTokenBalance_After,
					dennis_DebtTokenBalance_Before.sub(redemptionAmount)
				)
			})

			it("redeemCollateral(): with invalid first hint, vessel below MCR", async () => {
				const { totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(310, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(8, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(250, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: carol },
				})

				const partialRedemptionAmount = toBN(2)
				const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)
				// start Dennis with a high ICR
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: redemptionAmount,
					extraParams: { from: dennis },
				})

				const dennis_CollBalance_Before = toBN(await erc20.balanceOf(dennis))
				const dennis_DebtTokenBalance_Before = await debtToken.balanceOf(dennis)

				const price = await priceFeed.getPrice(erc20.address)

				// Increase price to start Erin, and decrease it again so its ICR is under MCR
				await priceFeed.setPrice(erc20.address, price.mul(toBN(2)))
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: erin },
				})
				await priceFeed.setPrice(erc20.address, price)

				// Find hints for redeeming 20 debt tokens
				const { 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
					erc20.address,
					redemptionAmount,
					price,
					0
				)

				// We don't need to use getApproxHint for this test, since it's not the subject of this
				// test case, and the list is very small, so the correct position is quickly found
				const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
					erc20.address,
					partialRedemptionHintNewICR,
					dennis,
					dennis
				)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Dennis redeems 20 debt tokens
				// Don't pay for gas, as it makes it easier to calculate the received Ether

				const redemptionTx = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount,
					erin, // invalid vessel, below MCR
					upperPartialRedemptionHint,
					lowerPartialRedemptionHint,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: dennis }
				)

				const collFee = th.getEmittedRedemptionValues(redemptionTx)[3]

				const alice_Vessel_After = await vesselManager.Vessels(alice, erc20.address)
				const bob_Vessel_After = await vesselManager.Vessels(bob, erc20.address)
				const carol_Vessel_After = await vesselManager.Vessels(carol, erc20.address)

				const alice_debt_After = alice_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const bob_debt_After = bob_Vessel_After[th.VESSEL_DEBT_INDEX].toString()
				const carol_debt_After = carol_Vessel_After[th.VESSEL_DEBT_INDEX].toString()

				// check that Dennis' redeemed 20 debt tokens have been cancelled with debt from Bobs's Vessel (8) and Carol's Vessel (10).
				// The remaining lot (2) is sent to Alice's Vessel, who had the best ICR.
				// It leaves her with (3) debt tokens + 50 for gas compensation.
				th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))

				assert.equal(bob_debt_After, "0")
				assert.equal(carol_debt_After, "0")

				const dennis_CollBalance_After = toBN(await erc20.balanceOf(dennis))
				const receivedColl = dennis_CollBalance_After.sub(dennis_CollBalance_Before)

				const expectedTotalCollDrawn = calcSoftnedAmount(redemptionAmount, price)
				const expectedReceivedColl = expectedTotalCollDrawn.sub(toBN(collFee))

				th.assertIsApproximatelyEqual(expectedReceivedColl, receivedColl)

				const dennis_DebtTokenBalance_After = (await debtToken.balanceOf(dennis)).toString()
				th.assertIsApproximatelyEqual(
					dennis_DebtTokenBalance_After,
					dennis_DebtTokenBalance_Before.sub(redemptionAmount)
				)
			})

			it("redeemCollateral(): ends the redemption sequence when the token redemption request has been filled", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// Alice, Bob, Carol, Dennis, Erin open vessels
				const { netDebt: A_debt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_debt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_debt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(290, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: carol },
				})
				const { totalDebt: D_totalDebt, collateral: D_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: dennis },
				})
				const { totalDebt: E_totalDebt, collateral: E_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: erin },
				})

				const redemptionAmount = A_debt.add(B_debt).add(C_debt)

				// open vessel from redeemer (flyn), who has highest ICR: 100 coll, 100 debtTokens = 20,000%
				const { VUSDAmount: F_DebtAmount } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 18)),
					extraVUSDAmount: redemptionAmount.mul(toBN(2)),
					extraParams: { from: flyn },
				})

				// skip redemption bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Flyn redeems collateral
				await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount,
					alice,
					alice,
					alice,
					0,
					0,
					th._100pct,
					{ from: flyn }
				)

				// Check Flyn's redemption has reduced his balance from 100 to (100-60) = 40
				const flynBalance = await debtToken.balanceOf(flyn)
				th.assertIsApproximatelyEqual(flynBalance, F_DebtAmount.sub(redemptionAmount))

				// Check debt of Alice, Bob, Carol
				const alice_Debt = await vesselManager.getVesselDebt(erc20.address, alice)
				const bob_Debt = await vesselManager.getVesselDebt(erc20.address, bob)
				const carol_Debt = await vesselManager.getVesselDebt(erc20.address, carol)

				assert.equal(alice_Debt, 0)
				assert.equal(bob_Debt, 0)
				assert.equal(carol_Debt, 0)

				// check Alice, Bob and Carol vessels are closed by redemption
				const alice_Status = await vesselManager.getVesselStatus(erc20.address, alice)
				const bob_Status = await vesselManager.getVesselStatus(erc20.address, bob)
				const carol_Status = await vesselManager.getVesselStatus(erc20.address, carol)

				assert.equal(alice_Status, 4)
				assert.equal(bob_Status, 4)
				assert.equal(carol_Status, 4)

				// check debt and coll of Dennis, Erin has not been impacted by redemption
				const dennis_Debt = await vesselManager.getVesselDebt(erc20.address, dennis)
				const erin_Debt = await vesselManager.getVesselDebt(erc20.address, erin)

				th.assertIsApproximatelyEqual(dennis_Debt, D_totalDebt)
				th.assertIsApproximatelyEqual(erin_Debt, E_totalDebt)

				const dennis_Coll = await vesselManager.getVesselColl(erc20.address, dennis)
				const erin_Coll = await vesselManager.getVesselColl(erc20.address, erin)

				assert.equal(dennis_Coll.toString(), D_coll.toString())
				assert.equal(erin_Coll.toString(), E_coll.toString())
			})

			it("redeemCollateral(): ends the redemption sequence when max iterations have been reached", async () => {
				// --- SETUP ---
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraParams: { from: whale },
				})

				// Alice, Bob, Carol open vessels with equal collateral ratio

				const { netDebt: A_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(286, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(286, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_debt_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(286, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: carol },
				})

				const redemptionAmount_Asset = A_debt_Asset.add(B_debt_Asset)
				const attemptedRedemptionAmount_Asset = redemptionAmount_Asset.add(C_debt_Asset)

				// --- TEST ---

				// open vessel from redeemer.  Redeemer has highest ICR (100ETH, 100 VUSD), 20000%
				const { VUSDAmount: F_VUSDAmount_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 18)),
					extraVUSDAmount: redemptionAmount_Asset.mul(toBN(2)),
					extraParams: { from: flyn },
				})

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Flyn redeems collateral with only two iterations

				await vesselManagerOperations.redeemCollateral(
					erc20.address,
					attemptedRedemptionAmount_Asset,
					alice,
					alice,
					alice,
					0,
					2,
					th._100pct,
					{ from: flyn }
				)

				// Check Flyn's redemption has reduced his balance from 100 to (100-40) = 60 VUSD
				const flynBalance = (await debtToken.balanceOf(flyn)).toString()
				th.assertIsApproximatelyEqual(flynBalance, F_VUSDAmount_Asset.sub(redemptionAmount_Asset))

				// Check debt of Alice, Bob, Carol

				const alice_Debt_Asset = await vesselManager.getVesselDebt(erc20.address, alice)
				const bob_Debt_Asset = await vesselManager.getVesselDebt(erc20.address, bob)
				const carol_Debt_Asset = await vesselManager.getVesselDebt(erc20.address, carol)

				assert.equal(alice_Debt_Asset, 0)
				assert.equal(bob_Debt_Asset, 0)
				th.assertIsApproximatelyEqual(carol_Debt_Asset, C_totalDebt_Asset)

				// check Alice and Bob vessels are closed, but Carol is not

				const alice_Status_Asset = await vesselManager.getVesselStatus(erc20.address, alice)
				const bob_Status_Asset = await vesselManager.getVesselStatus(erc20.address, bob)
				const carol_Status_Asset = await vesselManager.getVesselStatus(erc20.address, carol)

				assert.equal(alice_Status_Asset, 4)
				assert.equal(bob_Status_Asset, 4)
				assert.equal(carol_Status_Asset, 1)
			})

			it("redeemCollateral(): performs partial redemption if resultant debt is > minimum net debt", async () => {
				await borrowerOperations.openVessel(
					erc20.address,
					dec(1_000, "ether"),
					await getOpenVesselVUSDAmount(dec(10_000, 18), erc20.address),
					A,
					A,
					{ from: A }
				)
				await borrowerOperations.openVessel(
					erc20.address,
					dec(1_000, "ether"),
					await getOpenVesselVUSDAmount(dec(20_000, 18), erc20.address),
					B,
					B,
					{ from: B }
				)
				await borrowerOperations.openVessel(
					erc20.address,
					dec(1_000, "ether"),
					await getOpenVesselVUSDAmount(dec(30_000, 18), erc20.address),
					C,
					C,
					{ from: C }
				)

				// A and C send all their tokens to B
				await debtToken.transfer(B, await debtToken.balanceOf(A), { from: A })
				await debtToken.transfer(B, await debtToken.balanceOf(C), { from: C })

				await vesselManager.setBaseRate(erc20.address, 0)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// redemption is $55_000
				const redemptionAmount = dec(55_000, 18)
				await th.redeemCollateralAndGetTxObject(B, contracts.core, redemptionAmount, erc20.address)

				// check that A remains active but B and C are closed
				assert.isTrue(await sortedVessels.contains(erc20.address, A))
				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isFalse(await sortedVessels.contains(erc20.address, C))

				// A's remaining debt = 10,000 (A) + 20,0000 (B) + 30,000 (C) - 55,000 (R) = 5,000
				const A_debt_Asset = await vesselManager.getVesselDebt(erc20.address, A)

				th.assertIsApproximatelyEqual(A_debt_Asset, dec(4600, 18), 1000)
			})

			it("redeemCollateral(): doesn't perform partial redemption if resultant debt would be < minimum net debt", async () => {
				await borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					await getOpenVesselVUSDAmount(dec(6000, 18), erc20.address),
					A,
					A,
					{ from: A }
				)
				await borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					await getOpenVesselVUSDAmount(dec(20000, 18), erc20.address),
					B,
					B,
					{ from: B }
				)
				await borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					await getOpenVesselVUSDAmount(dec(30000, 18), erc20.address),
					C,
					C,
					{ from: C }
				)

				// A and C send all their tokens to B
				await debtToken.transfer(B, await debtToken.balanceOf(A), { from: A })
				await debtToken.transfer(B, await debtToken.balanceOf(C), { from: C })

				await vesselManager.setBaseRate(erc20.address, 0)

				// Skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// VUSD redemption is 55000 VUSD
				const VUSDRedemption = dec(55000, 18)
				await th.redeemCollateralAndGetTxObject(B, contracts.core, VUSDRedemption, erc20.address)

				// Check B, C closed and A remains active

				assert.isTrue(await sortedVessels.contains(erc20.address, A))
				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isFalse(await sortedVessels.contains(erc20.address, C))

				// A's remaining debt would be 29950 + 19950 + 5950 + 50 - 55000 = 900.
				// Since this is below the min net debt of 100, A should be skipped and untouched by the redemption
				const A_debt_Asset = await vesselManager.getVesselDebt(erc20.address, A)
				await th.assertIsApproximatelyEqual(A_debt_Asset, dec(6000, 18))
			})

			it("redeemCollateral(): doesn't perform the final partial redemption in the sequence if the hint is out-of-date", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(363, 16)),
					extraVUSDAmount: dec(5, 18),
					extraParams: { from: alice },
				})
				const { netDebt: B_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(344, 16)),
					extraVUSDAmount: dec(8, 18),
					extraParams: { from: bob },
				})
				const { netDebt: C_netDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(333, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: carol },
				})
				const partialRedemptionAmount = toBN(2)
				const fullfilledRedemptionAmount = C_netDebt.add(B_netDebt)
				const redemptionAmount = fullfilledRedemptionAmount.add(partialRedemptionAmount)

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: redemptionAmount,
					extraParams: { from: dennis },
				})

				const dennis_CollBalance_Before = toBN(await erc20.balanceOf(dennis))
				const dennis_DebtTokenBalance_Before = await debtToken.balanceOf(dennis)
				const price = await priceFeed.getPrice(erc20.address)

				const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, redemptionAmount, price, 0)
				const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
					erc20.address,
					partialRedemptionHintNewICR,
					dennis,
					dennis
				)

				const frontRunRedemption = toBN(dec(1, 18))

				// Oops, another transaction gets in the way
				{
					const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } =
						await vesselManagerOperations.getRedemptionHints(erc20.address, dec(1, 18), price, 0)
					const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } =
						await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNewICR, dennis, dennis)

					// skip redemption bootstrapping phase
					await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

					// Alice redeems 1 debt token from Carol's Vessel
					await vesselManagerOperations.redeemCollateral(
						erc20.address,
						frontRunRedemption,
						firstRedemptionHint,
						upperPartialRedemptionHint,
						lowerPartialRedemptionHint,
						partialRedemptionHintNewICR,
						0,
						th._100pct,
						{ from: alice }
					)
				}

				// Dennis tries to redeem 20 debt tokens
				const redemptionTx = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount,
					firstRedemptionHint,
					upperPartialRedemptionHint,
					lowerPartialRedemptionHint,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: dennis }
				)

				const collFee = th.getEmittedRedemptionValues(redemptionTx)[3]

				// Since Alice already redeemed 1 debt token from Carol's Vessel, Dennis was able to redeem:
				//  - 9 debt tokens from Carol's
				//  - 8 debt tokens from Bob's
				// for a total of 17 debt tokens.

				// Dennis calculated his hint for redeeming 2 debt tokens from Alice's Vessel, but after Alice's transaction
				// got in the way, he would have needed to redeem 3 debt tokens to fully complete his redemption of 20 debt tokens.
				// This would have required a different hint, therefore he ended up with a partial redemption.

				const dennis_CollBalance_After = toBN(await erc20.balanceOf(dennis))
				const receivedColl = dennis_CollBalance_After.sub(dennis_CollBalance_Before)

				// Expect only 17 worth of collateral drawn
				const expectedTotalCollDrawn = calcSoftnedAmount(fullfilledRedemptionAmount.sub(frontRunRedemption), price)
				const expectedReceivedColl = expectedTotalCollDrawn.sub(collFee)

				th.assertIsApproximatelyEqual(expectedReceivedColl, receivedColl)

				const dennis_DebtTokenBalance_After = (await debtToken.balanceOf(dennis)).toString()
				th.assertIsApproximatelyEqual(
					dennis_DebtTokenBalance_After,
					dennis_DebtTokenBalance_Before.sub(fullfilledRedemptionAmount.sub(frontRunRedemption))
				)
			})

			// active debt cannot be zero, as there’s a positive min debt enforced, and at least a vessel must exist
			it.skip("redeemCollateral(): can redeem if there is zero active debt but non-zero debt in DefaultPool", async () => {
				// --- SETUP ---

				const amount = await getOpenVesselVUSDAmount(dec(110, 18))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraVUSDAmount: amount,
					extraParams: { from: bob },
				})

				await debtToken.transfer(carol, amount.mul(toBN(2)), { from: bob })

				const price = dec(100, 18)
				await priceFeed.setPrice(erc20.address, price)

				// Liquidate Bob's Vessel
				await vesselManagerOperations.liquidateVessels(erc20.address, 1)

				// --- TEST ---

				const carol_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(carol))
				console.log(carol_ETHBalance_Before_Asset.toString())

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					amount,
					alice,
					"0x0000000000000000000000000000000000000000",
					"0x0000000000000000000000000000000000000000",
					"10367038690476190477",
					0,
					th._100pct,
					{
						from: carol,
						// gasPrice: 0,
					}
				)

				const ETHFee_Asset = th.getEmittedRedemptionValues(redemptionTx_Asset)[3]

				const carol_ETHBalance_After_Asset = toBN(await erc20.address(carol))

				const expectedTotalETHDrawn = toBN(amount).div(toBN(100)) // convert 100 VUSD to ETH at ETH:USD price of 100
				const expectedReceivedETH_Asset = expectedTotalETHDrawn.sub(ETHFee_Asset)

				const receivedETH_Asset = carol_ETHBalance_After_Asset.sub(carol_ETHBalance_Before_Asset)
				assert.isTrue(expectedReceivedETH_Asset.eq(receivedETH_Asset))

				const carol_VUSDBalance_After = (await debtToken.balanceOf(carol)).toString()
				assert.equal(carol_VUSDBalance_After, "0")
			})
			it("redeemCollateral(): doesn't touch Vessels with ICR < 110%", async () => {
				// --- SETUP ---

				const { netDebt: A_debt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(13, 18)),
					extraParams: { from: alice },
				})
				const { VUSDAmount: B_VUSDAmount_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(133, 16)),
					extraVUSDAmount: A_debt_Asset,
					extraParams: { from: bob },
				})

				await debtToken.transfer(carol, B_VUSDAmount_Asset, { from: bob })

				// Put Bob's Vessel below 110% ICR
				const price = dec(100, 18)
				await priceFeed.setPrice(erc20.address, price)

				// --- TEST ---

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				await vesselManagerOperations.redeemCollateral(
					erc20.address,
					A_debt_Asset,
					alice,
					"0x0000000000000000000000000000000000000000",
					"0x0000000000000000000000000000000000000000",
					0,
					0,
					th._100pct,
					{ from: carol }
				)

				// Alice's Vessel was cleared of debt

				const { debt: alice_Debt_After_Asset } = await vesselManager.Vessels(alice, erc20.address)
				assert.equal(alice_Debt_After_Asset, "0")

				// Bob's Vessel was left untouched
				const { debt: bob_Debt_After_Asset } = await vesselManager.Vessels(bob, erc20.address)
				th.assertIsApproximatelyEqual(bob_Debt_After_Asset, B_totalDebt_Asset)
			})

			it("redeemCollateral(): finds the last Vessel with ICR == 110% even if there is more than one", async () => {
				// --- SETUP ---
				const amount1 = toBN(dec(100, 18))

				const { totalDebt: A_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: amount1,
					extraParams: { from: alice },
				})
				const { totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: amount1,
					extraParams: { from: bob },
				})
				const { totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: amount1,
					extraParams: { from: carol },
				})

				const redemptionAmount_Asset = C_totalDebt_Asset.add(B_totalDebt_Asset).add(A_totalDebt_Asset)
				const { totalDebt: D_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(195, 16)),
					extraVUSDAmount: redemptionAmount_Asset,
					extraParams: { from: dennis },
				})

				// This will put Dennis slightly below 110%, and everyone else exactly at 110%
				const price = "110" + _18_zeros
				await priceFeed.setPrice(erc20.address, price)

				const orderOfVessels = []
				const orderOfVessels_Asset = []
				let current_Asset = await sortedVessels.getFirst(erc20.address)

				while (current_Asset !== "0x0000000000000000000000000000000000000000") {
					orderOfVessels_Asset.push(current_Asset)
					current_Asset = await sortedVessels.getNext(erc20.address, current_Asset)
				}

				assert.deepEqual(orderOfVessels_Asset, [carol, bob, alice, dennis])

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(100, 18)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: whale },
				})

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				const tx_Asset = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					redemptionAmount_Asset,
					carol, // try to trick redeemCollateral by passing a hint that doesn't exactly point to the
					// last Vessel with ICR == 110% (which would be Alice's)
					"0x0000000000000000000000000000000000000000",
					"0x0000000000000000000000000000000000000000",
					0,
					0,
					th._100pct,
					{ from: dennis }
				)

				const { debt: alice_Debt_After_Asset } = await vesselManager.Vessels(alice, erc20.address)
				assert.equal(alice_Debt_After_Asset, "0")

				const { debt: bob_Debt_After_Asset } = await vesselManager.Vessels(bob, erc20.address)
				assert.equal(bob_Debt_After_Asset, "0")

				const { debt: carol_Debt_After_Asset } = await vesselManager.Vessels(carol, erc20.address)
				assert.equal(carol_Debt_After_Asset, "0")

				const { debt: dennis_Debt_After_Asset } = await vesselManager.Vessels(dennis, erc20.address)
				th.assertIsApproximatelyEqual(dennis_Debt_After_Asset, D_totalDebt_Asset)
			})

			it("redeemCollateral(): reverts when TCR < MCR", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(196, 16)),
					extraParams: { from: dennis },
				})

				// This will put Dennis slightly below 110%, and everyone else exactly at 110%

				await priceFeed.setPrice(erc20.address, "110" + _18_zeros)
				const price = await priceFeed.getPrice(erc20.address)

				const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				await assertRevert(
					th.redeemCollateral(carol, contracts.core, dec(270, 18), erc20.address),
					"VesselManager: Cannot redeem when TCR < MCR"
				)
			})

			it("redeemCollateral(): reverts when argument _amount is 0", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})

				// Alice opens vessel and transfers 500VUSD to Erin, the would-be redeemer
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(500, 18),
					extraParams: { from: alice },
				})
				await debtToken.transfer(erin, dec(500, 18), { from: alice })

				// B, C and D open vessels

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: bob },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraParams: { from: dennis },
				})

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Erin attempts to redeem with _amount = 0
				const redemptionTxPromise_Asset = vesselManagerOperations.redeemCollateral(
					erc20.address,
					0,
					erin,
					erin,
					erin,
					0,
					0,
					th._100pct,
					{ from: erin }
				)
				await assertRevert(redemptionTxPromise_Asset, "VesselManager: Amount must be greater than zero")
			})

			it("redeemCollateral(): reverts if max fee > 100%", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(30, 18),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(40, 18),
					extraParams: { from: D },
				})

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, dec(10, 18), erc20.address, dec(2, 18)),
					"Max fee percentage must be between 0.5% and 100%"
				)
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, dec(10, 18), erc20.address, "1000000000000000001"),
					"Max fee percentage must be between 0.5% and 100%"
				)
			})

			it("redeemCollateral(): reverts if max fee < 0.5%", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(10, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(30, 18),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(40, 18),
					extraParams: { from: D },
				})

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, dec(10, 18), erc20.address, 0),
					"Max fee percentage must be between 0.5% and 100%"
				)
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, dec(10, 18), erc20.address, 1),
					"Max fee percentage must be between 0.5% and 100%"
				)
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, dec(10, 18), erc20.address, "4999999999999999"),
					"Max fee percentage must be between 0.5% and 100%"
				)
			})

			it("redeemCollateral(): reverts if fee exceeds max fee percentage", async () => {
				const { totalDebt: A_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(80, 18),
					extraParams: { from: A },
				})
				const { totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(90, 18),
					extraParams: { from: B },
				})
				const { totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				const expectedTotalSupply_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset)

				// Check total VUSD supply
				const totalSupply = await debtToken.totalSupply()
				th.assertIsApproximatelyEqual(totalSupply, expectedTotalSupply_Asset)

				await vesselManager.setBaseRate(erc20.address, 0)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// VUSD redemption is 27 USD: a redemption that incurs a fee of 27/(270 * 2) = 5%
				const attemptedVUSDRedemption_Asset = expectedTotalSupply_Asset.div(toBN(10))

				// Max fee is <5%
				const lessThan5pct = "49999999999999999"
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, attemptedVUSDRedemption_Asset, erc20.address, lessThan5pct),
					"Fee exceeded provided maximum"
				)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Max fee is 1%
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, attemptedVUSDRedemption_Asset, erc20.address, dec(1, 16)),
					"Fee exceeded provided maximum"
				)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Max fee is 3.754%
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, attemptedVUSDRedemption_Asset, erc20.address, dec(3754, 13)),
					"Fee exceeded provided maximum"
				)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Max fee is 0.5%
				await assertRevert(
					th.redeemCollateralAndGetTxObject(A, contracts.core, attemptedVUSDRedemption_Asset, erc20.address, dec(5, 15)),
					"Fee exceeded provided maximum"
				)
			})

			it("redeemCollateral(): succeeds if fee is less than max fee percentage", async () => {
				const { totalDebt: A_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(9500, 18),
					extraParams: { from: A },
				})
				const { totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(395, 16)),
					extraVUSDAmount: dec(9000, 18),
					extraParams: { from: B },
				})
				const { totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(390, 16)),
					extraVUSDAmount: dec(10000, 18),
					extraParams: { from: C },
				})

				const expectedTotalSupply_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset)

				// Check total VUSD supply
				const totalSupply = await debtToken.totalSupply()
				th.assertIsApproximatelyEqual(totalSupply, expectedTotalSupply_Asset)

				await vesselManager.setBaseRate(erc20.address, 0)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// VUSD redemption fee with 10% of the supply will be 0.5% + 1/(10*2)
				const attemptedVUSDRedemption_Asset = expectedTotalSupply_Asset.div(toBN(10))

				// Attempt with maxFee > 5.5%
				const price = await priceFeed.getPrice(erc20.address)
				const ETHDrawn_Asset = attemptedVUSDRedemption_Asset.mul(mv._1e18BN).div(price)

				const slightlyMoreThanFee_Asset = await vesselManager.getRedemptionFeeWithDecay(erc20.address, ETHDrawn_Asset)

				const tx1_Asset = await th.redeemCollateralAndGetTxObject(
					A,
					contracts.core,
					attemptedVUSDRedemption_Asset,
					erc20.address,
					slightlyMoreThanFee_Asset
				)
				assert.isTrue(tx1_Asset.receipt.status)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Attempt with maxFee = 5.5%
				const exactSameFee_Asset = await vesselManager.getRedemptionFeeWithDecay(erc20.address, ETHDrawn_Asset)

				const tx2_Asset = await th.redeemCollateralAndGetTxObject(
					C,
					contracts.core,
					attemptedVUSDRedemption_Asset,
					erc20.address,
					exactSameFee_Asset
				)
				assert.isTrue(tx2_Asset.receipt.status)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Max fee is 10%
				const tx3_Asset = await th.redeemCollateralAndGetTxObject(
					B,
					contracts.core,
					attemptedVUSDRedemption_Asset,
					erc20.address,
					dec(1, 17)
				)
				assert.isTrue(tx3_Asset.receipt.status)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Max fee is 37.659%

				const tx4_Asset = await th.redeemCollateralAndGetTxObject(
					A,
					contracts.core,
					attemptedVUSDRedemption_Asset,
					erc20.address,
					dec(37659, 13)
				)
				assert.isTrue(tx4_Asset.receipt.status)

				await vesselManager.setBaseRate(erc20.address, 0)

				// Max fee is 100%

				const tx5_Asset = await th.redeemCollateralAndGetTxObject(
					C,
					contracts.core,
					attemptedVUSDRedemption_Asset,
					erc20.address,
					dec(1, 18)
				)
				assert.isTrue(tx5_Asset.receipt.status)
			})

			it("redeemCollateral(): doesn't affect the Stability Pool deposits or ETH gain of redeemed-from vessels", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})

				// B, C, D, F open vessel

				const { totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: bob },
				})
				const { totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(195, 16)),
					extraVUSDAmount: dec(200, 18),
					extraParams: { from: carol },
				})
				const { totalDebt: D_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(400, 18),
					extraParams: { from: dennis },
				})
				const { totalDebt: F_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: flyn },
				})

				const redemptionAmount_Asset = B_totalDebt_Asset.add(C_totalDebt_Asset)
					.add(D_totalDebt_Asset)
					.add(F_totalDebt_Asset)

				// Alice opens vessel and transfers VUSD to Erin, the would-be redeemer
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: redemptionAmount_Asset,
					extraParams: { from: alice },
				})
				await debtToken.transfer(erin, redemptionAmount_Asset, {
					from: alice,
				})

				// B, C, D deposit some of their tokens to the Stability Pool

				await stabilityPool.provideToSP(dec(50, 18), { from: bob })
				await stabilityPool.provideToSP(dec(150, 18), { from: carol })
				await stabilityPool.provideToSP(dec(200, 18), { from: dennis })

				let price = await priceFeed.getPrice(erc20.address)

				const bob_ICR_before_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
				const dennis_ICR_before_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				assert.isTrue(await sortedVessels.contains(erc20.address, flyn))

				// Liquidate Flyn
				await vesselManagerOperations.liquidate(erc20.address, flyn)
				assert.isFalse(await sortedVessels.contains(erc20.address, flyn))

				// Price bounces back, bringing B, C, D back above MCRw
				await priceFeed.setPrice(erc20.address, dec(200, 18))

				const bob_SPDeposit_before_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const carol_SPDeposit_before_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(carol)).toString()
				const dennis_SPDeposit_before_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString()

				const bob_ETHGain_before_Asset = (await stabilityPool.getDepositorGains(bob))[1][1].toString()
				const carol_ETHGain_before_Asset = (await stabilityPool.getDepositorGains(carol))[1][1].toString()
				const dennis_ETHGain_before_Asset = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()

				// Check the remaining VUSD and ETH in Stability Pool after liquidation is non-zero

				const VUSDinSP_Asset = await stabilityPool.getTotalDebtTokenDeposits()
				const ETHinSP_Asset = await stabilityPool.getCollateral(erc20.address)

				assert.isTrue(VUSDinSP_Asset.gte(mv._zeroBN))
				assert.isTrue(ETHinSP_Asset.gte(mv._zeroBN))

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Erin redeems VUSD
				await th.redeemCollateral(erin, contracts.core, redemptionAmount_Asset, erc20.address, th._100pct)

				price = await priceFeed.getPrice(erc20.address)

				const bob_ICR_after_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
				const carol_ICR_after_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
				const dennis_ICR_after_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)

				// Check ICR of B, C and D vessels has increased,i.e. they have been hit by redemptions
				assert.isTrue(bob_ICR_after_Asset.gte(bob_ICR_before_Asset))
				assert.isTrue(carol_ICR_after_Asset.gte(carol_ICR_before_Asset))
				assert.isTrue(dennis_ICR_after_Asset.gte(dennis_ICR_before_Asset))

				const bob_SPDeposit_after_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const carol_SPDeposit_after_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(carol)).toString()
				const dennis_SPDeposit_after_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString()

				const bob_ETHGain_after_Asset = (await stabilityPool.getDepositorGains(bob))[1][1].toString()
				const carol_ETHGain_after_Asset = (await stabilityPool.getDepositorGains(carol))[1][1].toString()
				const dennis_ETHGain_after_Asset = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()

				// Check B, C, D Stability Pool deposits and ETH gain have not been affected by redemptions from their vessels
				assert.equal(bob_SPDeposit_before_Asset, bob_SPDeposit_after_Asset)
				assert.equal(carol_SPDeposit_before_Asset, carol_SPDeposit_after_Asset)
				assert.equal(dennis_SPDeposit_before_Asset, dennis_SPDeposit_after_Asset)

				assert.equal(bob_ETHGain_before_Asset, bob_ETHGain_after_Asset)
				assert.equal(carol_ETHGain_before_Asset, carol_ETHGain_after_Asset)
				assert.equal(dennis_ETHGain_before_Asset, dennis_ETHGain_after_Asset)
			})

			it("redeemCollateral(): caller can redeem their entire debtToken balance", async () => {
				const { collateral: W_coll, totalDebt: W_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})

				// Alice opens vessel and transfers 400 debt tokens to Erin, the would-be redeemer
				const { collateral: A_coll, totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(400, 18),
					extraParams: { from: alice },
				})
				await debtToken.transfer(erin, toBN(dec(400, 18)), { from: alice })

				// B, C, D open vessels
				const { collateral: B_coll, totalDebt: B_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(590, 18),
					extraParams: { from: bob },
				})
				const { collateral: C_coll, totalDebt: C_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(1990, 18),
					extraParams: { from: carol },
				})
				const { collateral: D_coll, totalDebt: D_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(500, 16)),
					extraVUSDAmount: dec(1990, 18),
					extraParams: { from: dennis },
				})

				const totalDebt = W_totalDebt.add(A_totalDebt).add(B_totalDebt).add(C_totalDebt).add(D_totalDebt)
				const totalColl = W_coll.add(A_coll).add(B_coll).add(C_coll).add(D_coll)

				// Get active debt and coll before redemption
				const activePool_debt_before = await activePool.getDebtTokenBalance(erc20.address)
				const activePool_coll_before = await activePool.getAssetBalance(erc20.address)

				th.assertIsApproximatelyEqual(activePool_debt_before.toString(), totalDebt)
				assert.equal(activePool_coll_before.toString(), totalColl)

				const price = await priceFeed.getPrice(erc20.address)

				// skip redemption bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Erin attempts to redeem 400 debt tokens
				const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, dec(400, 18), price, 0)

				const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
					erc20.address,
					partialRedemptionHintNewICR,
					erin,
					erin
				)

				await vesselManagerOperations.redeemCollateral(
					erc20.address,
					dec(400, 18),
					firstRedemptionHint,
					upperPartialRedemptionHint,
					lowerPartialRedemptionHint,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: erin }
				)

				// Check activePool debt reduced by 400 debt tokens
				const activePool_debt_after = await activePool.getDebtTokenBalance(erc20.address)
				assert.equal(activePool_debt_before.sub(activePool_debt_after), dec(400, 18))

				// Check ActivePool coll reduced by $400 worth of collateral: at Coll:USD price of $200, this should be 2,
				// therefore, remaining ActivePool coll should be 198 (not accounted for softening)
				const activePool_coll_after = await activePool.getAssetBalance(erc20.address)
				const expectedCollWithdrawn = calcSoftnedAmount(toBN(dec(400, 18)), price)
				assert.equal(activePool_coll_after.toString(), activePool_coll_before.sub(expectedCollWithdrawn))

				// Check Erin's balance after
				const erin_balance_after = (await debtToken.balanceOf(erin)).toString()
				assert.equal(erin_balance_after, "0")
			})

			it("redeemCollateral(): reverts when requested redemption amount exceeds caller's debt token token balance", async () => {
				const { collateral: W_coll_Asset, totalDebt: W_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})

				// Alice opens vessel and transfers 400 VUSD to Erin, the would-be redeemer
				const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(400, 18),
					extraParams: { from: alice },
				})
				await debtToken.transfer(erin, toBN(dec(400, 18)).mul(toBN(2)), { from: alice })

				// Check Erin's balance before
				const erin_balance_before = await debtToken.balanceOf(erin)
				assert.equal(erin_balance_before, toBN(dec(400, 18)).mul(toBN(2)).toString())

				// B, C, D open vessel

				const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(590, 18),
					extraParams: { from: bob },
				})
				const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(1990, 18),
					extraParams: { from: carol },
				})
				const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(500, 16)),
					extraVUSDAmount: dec(1990, 18),
					extraParams: { from: dennis },
				})

				const totalDebt_Asset = W_totalDebt_Asset.add(A_totalDebt_Asset)
					.add(B_totalDebt_Asset)
					.add(C_totalDebt_Asset)
					.add(D_totalDebt_Asset)
				const totalColl_Asset = W_coll_Asset.add(A_coll_Asset).add(B_coll_Asset).add(C_coll_Asset).add(D_coll_Asset)

				// Get active debt and coll before redemption

				const activePool_debt_before_Asset = await activePool.getDebtTokenBalance(erc20.address)
				const activePool_coll_before_Asset = (await activePool.getAssetBalance(erc20.address)).toString()

				th.assertIsApproximatelyEqual(activePool_debt_before_Asset, totalDebt_Asset)
				assert.equal(activePool_coll_before_Asset, totalColl_Asset)

				const price = await priceFeed.getPrice(erc20.address)

				let firstRedemptionHint_Asset
				let partialRedemptionHintNICR_Asset

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Erin tries to redeem 1000 VUSD
				try {
					;({ 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
						await vesselManagerOperations.getRedemptionHints(erc20.address, dec(1000, 18), price, 0))

					const { 0: upperPartialRedemptionHint_1_Asset, 1: lowerPartialRedemptionHint_1_Asset } =
						await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNICR_Asset, erin, erin)

					const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
						erc20.address,
						dec(1000, 18),
						firstRedemptionHint_Asset,
						upperPartialRedemptionHint_1_Asset,
						lowerPartialRedemptionHint_1_Asset,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{ from: erin }
					)

					assert.isFalse(redemptionTx_Asset.receipt.status)
				} catch (error) {
					assert.include(error.message, "revert")
					assert.include(error.message, "VesselManagerOperations__InsufficientDebtTokenBalance")
				}

				// Erin tries to redeem 801 VUSD
				try {
					;({ 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
						await vesselManagerOperations.getRedemptionHints(erc20.address, "801000000000000000000", price, 0))

					const { 0: upperPartialRedemptionHint_2_Asset, 1: lowerPartialRedemptionHint_2_Asset } =
						await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNICR_Asset, erin, erin)

					const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
						erc20.address,
						"801000000000000000000",
						firstRedemptionHint_Asset,
						upperPartialRedemptionHint_2_Asset,
						lowerPartialRedemptionHint_2_Asset,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{ from: erin }
					)

					assert.isFalse(redemptionTx_Asset.receipt.status)
				} catch (error) {
					assert.include(error.message, "revert")
					assert.include(error.message, "VesselManagerOperations__InsufficientDebtTokenBalance")
				}

				// Erin tries to redeem 239482309 VUSD

				try {
					;({ 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
						await vesselManagerOperations.getRedemptionHints(erc20.address, "239482309000000000000000000", price, 0))

					const { 0: upperPartialRedemptionHint_3_Asset, 1: lowerPartialRedemptionHint_3_Asset } =
						await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNICR_Asset, erin, erin)

					const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
						erc20.address,
						"239482309000000000000000000",
						firstRedemptionHint_Asset,
						upperPartialRedemptionHint_3_Asset,
						lowerPartialRedemptionHint_3_Asset,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{ from: erin }
					)

					assert.isFalse(redemptionTx_Asset.receipt.status)
				} catch (error) {
					assert.include(error.message, "revert")
					assert.include(error.message, "VesselManagerOperations__InsufficientDebtTokenBalance")
				}

				// Erin tries to redeem 2^256 - 1 VUSD
				const maxBytes32 = toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

				try {
					;({ 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
						await vesselManagerOperations.getRedemptionHints(erc20.address, "239482309000000000000000000", price, 0))

					const { 0: upperPartialRedemptionHint_4_Asset, 1: lowerPartialRedemptionHint_4_Asset } =
						await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNICR_Asset, erin, erin)

					const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
						erc20.address,
						maxBytes32,
						firstRedemptionHint_Asset,
						upperPartialRedemptionHint_4_Asset,
						lowerPartialRedemptionHint_4_Asset,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{ from: erin }
					)

					assert.isFalse(redemptionTx_Asset.receipt.status)
				} catch (error) {
					assert.include(error.message, "revert")
					assert.include(error.message, "VesselManagerOperations__InsufficientDebtTokenBalance")
				}
			})

			it("redeemCollateral(): value of issued collateral == face value of redeemed debtToken (assuming 1 debtToken has value of $1)", async () => {
				const { collateral: W_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				// Alice opens vessel and transfers $2,000 debt tokens each to Erin, Flyn, Graham
				const { collateral: A_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(400, 16)),
					extraVUSDAmount: dec(4990, 18),
					extraParams: { from: alice },
				})
				await debtToken.transfer(erin, toBN(dec(1_000, 18)).mul(toBN(2)), { from: alice })
				await debtToken.transfer(flyn, toBN(dec(1_000, 18)).mul(toBN(2)), { from: alice })
				await debtToken.transfer(graham, toBN(dec(1_000, 18)).mul(toBN(2)), { from: alice })

				// B, C, D open vessels
				const { collateral: B_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(300, 16)),
					extraVUSDAmount: dec(1_590, 18),
					extraParams: { from: bob },
				})
				const { collateral: C_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(600, 16)),
					extraVUSDAmount: dec(1_090, 18),
					extraParams: { from: carol },
				})
				const { collateral: D_coll } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(800, 16)),
					extraVUSDAmount: dec(1_090, 18),
					extraParams: { from: dennis },
				})

				const totalColl = W_coll.add(A_coll).add(B_coll).add(C_coll).add(D_coll)

				const price = await priceFeed.getPrice(erc20.address)

				const _120_ = "120000000000000000000"
				const _373_ = "373000000000000000000"
				const _950_ = "950000000000000000000"

				// Check assets in activePool
				const activePoolBalance0 = await activePool.getAssetBalance(erc20.address)
				assert.equal(activePoolBalance0, totalColl.toString())

				// skip redemption bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Erin redeems 120 debt tokens
				await ({ 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, _120_, price, 0))
				const { 0: upperPartialRedemptionHint_1, 1: lowerPartialRedemptionHint_1 } =
					await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNewICR, erin, erin)
				const redemption_1 = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					_120_,
					firstRedemptionHint,
					upperPartialRedemptionHint_1,
					lowerPartialRedemptionHint_1,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: erin }
				)
				assert.isTrue(redemption_1.receipt.status)

				// 120 debt tokens redeemed = expect $120 worth of collateral removed
				// At Coll:USD price of $200,
				// Coll removed = (120/200) = 0.6 * 97% (softening) = 0.582
				// Total active collateral = 280 - 0.582 = 279.418

				const activePoolBalance1 = await activePool.getAssetBalance(erc20.address)
				const expectedActivePoolBalance1 = activePoolBalance0.sub(calcSoftnedAmount(toBN(_120_), price))
				assert.equal(activePoolBalance1.toString(), expectedActivePoolBalance1.toString())

				// Flyn redeems 373 debt tokens
				;({ 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
					erc20.address,
					_373_,
					price,
					0
				))
				const { 0: upperPartialRedemptionHint_2, 1: lowerPartialRedemptionHint_2 } =
					await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNewICR, flyn, flyn)
				const redemption_2 = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					_373_,
					firstRedemptionHint,
					upperPartialRedemptionHint_2,
					lowerPartialRedemptionHint_2,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: flyn }
				)
				assert.isTrue(redemption_2.receipt.status)

				// 373 debt tokens redeemed = expect $373 worth of collateral removed
				// At Coll:USD price of $200,
				// Coll removed = (373/200) = 1.865 * 97% (softening) = 1.80905
				// Total active collateral = 279.418 - 1.80905 = 277.60895
				const activePoolBalance2 = await activePool.getAssetBalance(erc20.address)
				const expectedActivePoolBalance2 = activePoolBalance1.sub(calcSoftnedAmount(toBN(_373_), price))
				assert.equal(activePoolBalance2.toString(), expectedActivePoolBalance2.toString())

				// Graham redeems 950 debt tokens
				;({ 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
					erc20.address,
					_950_,
					price,
					0
				))
				const { 0: upperPartialRedemptionHint_3, 1: lowerPartialRedemptionHint_3 } =
					await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNewICR, graham, graham)
				const redemption_3 = await vesselManagerOperations.redeemCollateral(
					erc20.address,
					_950_,
					firstRedemptionHint,
					upperPartialRedemptionHint_3,
					lowerPartialRedemptionHint_3,
					partialRedemptionHintNewICR,
					0,
					th._100pct,
					{ from: graham }
				)
				assert.isTrue(redemption_3.receipt.status)

				// 950 debt tokens redeemed = expect $950 worth of collateral removed
				// At Coll:USD price of $200,
				// Coll removed = (950/200) = 4.75 * 97% (softening) = 4.6075
				// Total active collaterl = 277.60895 - 4.6075 = 273.00145
				const activePoolBalance3 = (await activePool.getAssetBalance(erc20.address)).toString()
				const expectedActivePoolBalance3 = activePoolBalance2.sub(calcSoftnedAmount(toBN(_950_), price))
				assert.equal(activePoolBalance3.toString(), expectedActivePoolBalance3.toString())
			})

			// it doesn’t make much sense as there’s now min debt enforced and at least one vessel must remain active
			// the only way to test it is before any vessel is opened
			it("redeemCollateral(): reverts if there is zero outstanding system debt", async () => {
				// --- SETUP --- illegally mint VUSD to Bob
				await debtToken.unprotectedMint(bob, dec(100, 18))

				assert.equal(await debtToken.balanceOf(bob), dec(100, 18))

				const price = await priceFeed.getPrice(erc20.address)
				// Bob tries to redeem his illegally obtained VUSD

				const { 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, dec(100, 18), price, 0)

				const { 0: upperPartialRedemptionHint_Asset, 1: lowerPartialRedemptionHint_Asset } =
					await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNICR_Asset, bob, bob)
				try {
					await vesselManagerOperations.redeemCollateral(
						erc20.address,
						dec(100, 18),
						firstRedemptionHint_Asset,
						upperPartialRedemptionHint_Asset,
						lowerPartialRedemptionHint_Asset,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{ from: bob }
					)
				} catch (error) {
					console.log(error)
					assert.include(error.message, "VM Exception while processing transaction")
				}
			})

			it("redeemCollateral(): reverts if caller's tries to redeem more than the outstanding system debt", async () => {
				// --- SETUP --- illegally mint VUSD to Bob
				await debtToken.unprotectedMint(bob, "202000000000000000000")

				assert.equal(await debtToken.balanceOf(bob), "202000000000000000000")

				const { totalDebt: C_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1000, 16)),
					extraVUSDAmount: dec(40, 18),
					extraParams: { from: carol },
				})
				const { totalDebt: D_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(1000, 16)),
					extraVUSDAmount: dec(40, 18),
					extraParams: { from: dennis },
				})

				const totalDebt_Asset = C_totalDebt_Asset.add(D_totalDebt_Asset)

				th.assertIsApproximatelyEqual((await activePool.getDebtTokenBalance(erc20.address)).toString(), totalDebt_Asset)

				const price = await priceFeed.getPrice(erc20.address)

				const { 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, "101000000000000000000", price, 0)

				const { 0: upperPartialRedemptionHint_Asset, 1: lowerPartialRedemptionHint_Asset } =
					await sortedVessels.findInsertPosition(erc20.address, partialRedemptionHintNICR_Asset, bob, bob)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// Bob attempts to redeem his ill-gotten 101 VUSD, from a system that has 100 VUSD outstanding debt

				try {
					const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
						erc20.address,
						totalDebt_Asset.add(toBN(dec(100, 18))),
						firstRedemptionHint_Asset,
						upperPartialRedemptionHint_Asset,
						lowerPartialRedemptionHint_Asset,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{ from: bob }
					)
				} catch (error) {
					assert.include(error.message, "VM Exception while processing transaction")
				}
			})

			// Redemption fees
			it("redeemCollateral(): a redemption made when base rate is zero increases the base rate", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// Check baseRate == 0
				assert.equal(await vesselManager.baseRate(erc20.address), "0")

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				const A_balanceBefore = await debtToken.balanceOf(A)

				await th.redeemCollateral(A, contracts.core, dec(10, 18), erc20.address)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(A), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check baseRate is now non-zero
				assert.isTrue((await vesselManager.baseRate(erc20.address)).gt(toBN("0")))
			})

			it("redeemCollateral(): a redemption made when base rate is non-zero increases the base rate, for negligible time passed", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// Check baseRate == 0
				assert.equal(await vesselManager.baseRate(erc20.address), "0")

				const A_balanceBefore = await debtToken.balanceOf(A)
				const B_balanceBefore = await debtToken.balanceOf(B)

				// A redeems 10 VUSD
				const redemptionTx_A_Asset = await th.redeemCollateralAndGetTxObject(A, contracts.core, dec(10, 18), erc20.address)
				const timeStamp_A_Asset = await th.getTimestampFromTx(redemptionTx_A_Asset, web3)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(A), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check baseRate is now non-zero

				const baseRate_1_Asset = await vesselManager.baseRate(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				// B redeems 10 VUSD

				const redemptionTx_B_Asset = await th.redeemCollateralAndGetTxObject(B, contracts.core, dec(10, 18), erc20.address)
				const timeStamp_B_Asset = await th.getTimestampFromTx(redemptionTx_B_Asset, web3)

				// Check B's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(B), B_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check negligible time difference (< 1 minute) between txs
				assert.isTrue(Number(timeStamp_B_Asset) - Number(timeStamp_A_Asset) < 60)

				const baseRate_2_Asset = await vesselManager.baseRate(erc20.address)

				// Check baseRate has again increased
				assert.isTrue(baseRate_2_Asset.gt(baseRate_1_Asset))
			})

			it("redeemCollateral(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation [ @skip-on-coverage ]", async () => {
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				const A_balanceBefore = await debtToken.balanceOf(A)

				// A redeems 10 VUSD
				await th.redeemCollateral(A, contracts.core, dec(10, 18), erc20.address)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(A_balanceBefore.sub(await debtToken.balanceOf(A)).toString(), toBN(dec(10, 18)).toString())

				// Check baseRate is now non-zero

				const baseRate_1_Asset = await vesselManager.baseRate(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				const lastFeeOpTime_1_Asset = await vesselManager.lastFeeOperationTime(erc20.address)

				// 45 seconds pass
				th.fastForwardTime(45, web3.currentProvider)

				// Borrower A triggers a fee
				await th.redeemCollateral(A, contracts.core, dec(1, 18), erc20.address)

				const lastFeeOpTime_2_Asset = await vesselManager.lastFeeOperationTime(erc20.address)

				// Check that the last fee operation time did not update, as borrower A's 2nd redemption occured
				// since before minimum interval had passed
				assert.isTrue(lastFeeOpTime_2_Asset.eq(lastFeeOpTime_1_Asset))

				// 15 seconds passes
				th.fastForwardTime(15, web3.currentProvider)

				// Check that now, at least one hour has passed since lastFeeOpTime_1
				const timeNow = await th.getLatestBlockTimestamp(web3)
				assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1_Asset).gte(3600))

				// Borrower A triggers a fee
				await th.redeemCollateral(A, contracts.core, dec(1, 18), erc20.address)

				const lastFeeOpTime_3_Asset = await vesselManager.lastFeeOperationTime(erc20.address)

				// Check that the last fee operation time DID update, as A's 2rd redemption occured
				// after minimum interval had passed
				assert.isTrue(lastFeeOpTime_3_Asset.gt(lastFeeOpTime_1_Asset))
			})

			it("redeemCollateral(): a redemption made at zero base rate send a non-zero ETHFee to GRVT staking contract", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// Check baseRate == 0
				assert.equal(await vesselManager.baseRate(erc20.address), "0")

				const treasuryBalanceBefore = await erc20.balanceOf(treasury)
				const A_balanceBefore = await debtToken.balanceOf(A)

				// A redeems 10 VUSD
				await th.redeemCollateral(A, contracts.core, dec(10, 18), erc20.address)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(A), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check baseRate is now non-zero

				const baseRate_1_Asset = await vesselManager.baseRate(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				// Check GRVT Staking contract balance after is non-zero

				const treasuryBalanceAfter = await erc20.balanceOf(treasury)
				assert.isTrue(treasuryBalanceAfter.gt(treasuryBalanceBefore))
			})

			it("redeemCollateral(): a redemption made at zero base increases the ETH-fees-per-GRVT-staked in GRVT Staking contract", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// Check baseRate == 0
				assert.equal(await vesselManager.baseRate(erc20.address), "0")

				// Check GRVT Staking ETH-fees-per-GRVT-staked before is zero
				assert.equal(await grvtStaking.F_ASSETS(erc20.address), "0")

				const A_balanceBefore = await debtToken.balanceOf(A)

				// A redeems 10 VUSD
				await th.redeemCollateral(A, contracts.core, dec(10, 18), erc20.address)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(A), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check baseRate is now non-zero

				const baseRate_1_Asset = await vesselManager.baseRate(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				// Check GRVT Staking ETH-fees-per-GRVT-staked after is non-zero
				assert.isTrue((await grvtStaking.F_ASSETS(erc20.address)).gt("0"))
			})

			it("redeemCollateral(): a redemption made at a non-zero base rate send a non-zero ETHFee to GRVT staking contract", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// Check baseRate == 0
				assert.equal(await vesselManager.baseRate(erc20.address), "0")

				const A_balanceBefore = await debtToken.balanceOf(A)
				const B_balanceBefore = await debtToken.balanceOf(B)

				// A redeems 10 VUSD
				await th.redeemCollateral(A, contracts.core, dec(10, 18), erc20.address)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(A), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check baseRate is now non-zero

				const baseRate_1_Asset = await vesselManager.baseRate(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				const treasuryBalanceBefore = await erc20.balanceOf(treasury)

				// B redeems 10 VUSD
				await th.redeemCollateral(B, contracts.core, dec(10, 18), erc20.address)

				// Check B's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(B), B_balanceBefore.sub(toBN(dec(10, 18))).toString())

				const treasuryBalanceAfter = await erc20.balanceOf(treasury)

				// check GRVT Staking balance has increased
				assert.isTrue(treasuryBalanceAfter.gt(treasuryBalanceBefore))
			})

			it("redeemCollateral(): a redemption made at a non-zero base rate increases ETH-per-GRVT-staked in the staking contract", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				// Check baseRate == 0
				assert.equal(await vesselManager.baseRate(erc20.address), "0")

				const A_balanceBefore = await debtToken.balanceOf(A)
				const B_balanceBefore = await debtToken.balanceOf(B)

				// A redeems 10 VUSD
				await th.redeemCollateral(A, contracts.core, dec(10, 18), erc20.address)

				// Check A's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(A), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

				// Check baseRate is now non-zero

				const baseRate_1_Asset = await vesselManager.baseRate(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				const treasuryBalanceBefore = await erc20.balanceOf(treasury)

				// B redeems 10 VUSD
				await th.redeemCollateral(B, contracts.core, dec(10, 18), erc20.address)

				// Check B's balance has decreased by 10 VUSD
				assert.equal(await debtToken.balanceOf(B), B_balanceBefore.sub(toBN(dec(10, 18))).toString())

				const treasuryBalanceAfter = await erc20.balanceOf(treasury)

				// check GRVT Staking balance has increased
				assert.isTrue(treasuryBalanceAfter.gt(treasuryBalanceBefore))
			})

			it.skip("redeemCollateral(): a redemption sends the remainder collateral (CollDrawn - CollFee) to the redeemer", async () => {
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				const { totalDebt: W_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				const { totalDebt: A_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				const { totalDebt: B_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				const { totalDebt: C_totalDebt } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				const totalDebt = W_totalDebt.add(A_totalDebt).add(B_totalDebt).add(C_totalDebt)

				// Confirm baseRate before redemption is 0
				const baseRate = await vesselManager.baseRate(erc20.address)
				assert.equal(baseRate, "0")

				// Check total debtToken supply
				const debtTokensOnActivePool = await activePool.getDebtTokenBalance(erc20.address)
				const debtTokensOnDefaultPool = await defaultPool.getDebtTokenBalance(erc20.address)

				const totalDebtTokenSupply = debtTokensOnActivePool.add(debtTokensOnDefaultPool)
				th.assertIsApproximatelyEqual(totalDebtTokenSupply, totalDebt)

				const A_balanceBefore = toBN(await erc20.balanceOf(A))

				// A redeems $9
				const redemptionAmount = toBN(dec(9, 18))
				await th.redeemCollateral(A, contracts.core, redemptionAmount, erc20.address)

				// At Coll:USD price of 200:
				// collDrawn = (9 / 200) = 0.045 -> 0.04365 after softening
				// redemptionFee = (0.005 + (1/2) *(9/260)) * assetDrawn = 0.00100384615385
				// assetRemainder = 0.045 - 0.001003... = 0.0439961538462

				const A_balanceAfter = toBN(await erc20.balanceOf(A))

				// check A's asset balance has increased by 0.045
				const price = await priceFeed.getPrice(erc20.address)
				const assetDrawn = calcSoftnedAmount(redemptionAmount, price)

				const A_balanceDiff = A_balanceAfter.sub(A_balanceBefore)
				const redemptionFee = toBN(dec(5, 15))
					.add(redemptionAmount.mul(mv._1e18BN).div(totalDebt).div(toBN(2)))
					.mul(assetDrawn)
					.div(mv._1e18BN)
				const expectedDiff = assetDrawn.sub(redemptionFee)

				console.log(`${f(assetDrawn)} -> assetDrawn`)
				console.log(`${f(redemptionFee)} -> redemptionFee`)
				console.log(`${f(A_balanceDiff)} -> balanceDiff`)
				console.log(`${f(expectedDiff)} -> expectedDiff`)
				console.log(`${f(A_balanceDiff.sub(expectedDiff))} -> error`)

				th.assertIsApproximatelyEqual(A_balanceDiff, expectedDiff, 100_000)
			})

			it("redeemCollateral(): a full redemption (leaving vessel with 0 debt), closes the vessel", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				const { netDebt: W_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraVUSDAmount: dec(10000, 18),
					extraParams: { from: whale },
				})
				const { netDebt: A_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				const { netDebt: B_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				const { netDebt: C_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})
				const { netDebt: D_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(280, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: D },
				})

				const redemptionAmount_Asset = A_netDebt_Asset.add(B_netDebt_Asset)
					.add(C_netDebt_Asset)
					.add(toBN(dec(10, 18)))

				const A_balanceBefore_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceBefore_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceBefore_Asset = toBN(await erc20.balanceOf(C))

				// whale redeems 360 VUSD.  Expect this to fully redeem A, B, C, and partially redeem D.
				await th.redeemCollateral(whale, contracts.core, redemptionAmount_Asset, erc20.address)

				// Check A, B, C have been closed

				assert.isFalse(await sortedVessels.contains(erc20.address, A))
				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isFalse(await sortedVessels.contains(erc20.address, C))

				// Check D remains active
				assert.isTrue(await sortedVessels.contains(erc20.address, D))
			})

			const redeemCollateral3Full1Partial = async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				const { netDebt: W_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraVUSDAmount: dec(10000, 18),
					extraParams: { from: whale },
				})
				const { netDebt: A_netDebt_Asset, collateral: A_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				const { netDebt: B_netDebt_Asset, collateral: B_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				const { netDebt: C_netDebt_Asset, collateral: C_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})
				const { netDebt: D_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(280, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: D },
				})

				const redemptionAmount_Asset = A_netDebt_Asset.add(B_netDebt_Asset)
					.add(C_netDebt_Asset)
					.add(toBN(dec(10, 18)))

				const A_balanceBefore_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceBefore_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceBefore_Asset = toBN(await erc20.balanceOf(C))
				const D_balanceBefore_Asset = toBN(await erc20.balanceOf(D))

				const A_collBefore_Asset = await vesselManager.getVesselColl(erc20.address, A)
				const B_collBefore_Asset = await vesselManager.getVesselColl(erc20.address, B)
				const C_collBefore_Asset = await vesselManager.getVesselColl(erc20.address, C)
				const D_collBefore_Asset = await vesselManager.getVesselColl(erc20.address, D)

				// Confirm baseRate before redemption is 0

				const baseRate_Asset = await vesselManager.baseRate(erc20.address)
				assert.equal(baseRate_Asset, "0")

				// whale redeems VUSD.  Expect this to fully redeem A, B, C, and partially redeem D.
				await th.redeemCollateral(whale, contracts.core, redemptionAmount_Asset, erc20.address)

				// Check A, B, C have been closed

				assert.isFalse(await sortedVessels.contains(erc20.address, A))
				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isFalse(await sortedVessels.contains(erc20.address, C))

				// Check D stays active
				assert.isTrue(await sortedVessels.contains(erc20.address, D))

				/*
    At ETH:USD price of 200, with full redemptions from A, B, C:

    ETHDrawn from A = 100/200 = 0.5 ETH --> Surplus = (1-0.5) = 0.5
    ETHDrawn from B = 120/200 = 0.6 ETH --> Surplus = (1-0.6) = 0.4
    ETHDrawn from C = 130/200 = 0.65 ETH --> Surplus = (2-0.65) = 1.35
    */

				const A_balanceAfter_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceAfter_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceAfter_Asset = toBN(await erc20.balanceOf(C))
				const D_balanceAfter_Asset = toBN(await erc20.balanceOf(D))

				// Check A, B, C’s vessel collateral balance is zero (fully redeemed-from vessels)

				const A_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, A)
				const B_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, B)
				const C_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, C)

				assert.isTrue(A_collAfter_Asset.eq(toBN(0)))
				assert.isTrue(B_collAfter_Asset.eq(toBN(0)))
				assert.isTrue(C_collAfter_Asset.eq(toBN(0)))

				// check D's vessel collateral balances have decreased (the partially redeemed-from vessel)

				const D_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, D)
				assert.isTrue(D_collAfter_Asset.lt(D_collBefore_Asset))

				// Check A, B, C (fully redeemed-from vessels), and D's (the partially redeemed-from vessel) balance has not changed

				assert.isTrue(A_balanceAfter_Asset.eq(A_balanceBefore_Asset))
				assert.isTrue(B_balanceAfter_Asset.eq(B_balanceBefore_Asset))
				assert.isTrue(C_balanceAfter_Asset.eq(C_balanceBefore_Asset))
				assert.isTrue(D_balanceAfter_Asset.eq(D_balanceBefore_Asset))

				// D is not closed, so cannot open vessel
				await assertRevert(
					borrowerOperations.openVessel(erc20.address, dec(10, 18), 0, D, D, {
						from: D,
					}),
					"BorrowerOps: Vessel is active"
				)

				return {
					A_netDebt_Asset,
					A_coll_Asset,
					B_netDebt_Asset,
					B_coll_Asset,
					C_netDebt_Asset,
					C_coll_Asset,
				}
			}

			it("redeemCollateral(): emits correct debt and coll values in each redeemed vessel's VesselUpdated event", async () => {
				// VesselUpdated is emitted by the VM contract - and not VMRedemptions - so it isn't captured/decoded in the receipt tx
				const { netDebt: W_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraVUSDAmount: dec(10000, 18),
					extraParams: { from: whale },
				})
				const { netDebt: A_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				const { netDebt: B_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				const { netDebt: C_netDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})
				const { totalDebt: D_totalDebt_Asset, collateral: D_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(280, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: D },
				})

				const partialAmount = toBN(dec(15, 18))
				const redemptionAmount_Asset = A_netDebt_Asset.add(B_netDebt_Asset).add(C_netDebt_Asset).add(partialAmount)

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// whale redeems VUSD.  Expect this to fully redeem A, B, C, and partially redeem 15 VUSD from D.

				const redemptionTx_Asset = await th.redeemCollateralAndGetTxObject(
					whale,
					contracts.core,
					redemptionAmount_Asset,
					erc20.address,
					th._100pct
					// { gasPrice: 0 }
				)

				// Check A, B, C have been closed

				assert.isFalse(await sortedVessels.contains(erc20.address, A))
				assert.isFalse(await sortedVessels.contains(erc20.address, B))
				assert.isFalse(await sortedVessels.contains(erc20.address, C))

				// Check D stays active
				assert.isTrue(await sortedVessels.contains(erc20.address, D))

				//		Skip this part, as the VesselUpdated event is emitted by a nested contract call and is no longer returned by the th

				// 		const vesselUpdatedEvents_Asset = th.getAllEventsByName(redemptionTx_Asset, "VesselUpdated")

				// 		// Get each vessel's emitted debt and coll

				// 		const [A_emittedDebt_Asset, A_emittedColl_Asset] = th.getDebtAndCollFromVesselUpdatedEvents(
				// 			vesselUpdatedEvents_Asset,
				// 			A
				// 		)
				// 		const [B_emittedDebt_Asset, B_emittedColl_Asset] = th.getDebtAndCollFromVesselUpdatedEvents(
				// 			vesselUpdatedEvents_Asset,
				// 			B
				// 		)
				// 		const [C_emittedDebt_Asset, C_emittedColl_Asset] = th.getDebtAndCollFromVesselUpdatedEvents(
				// 			vesselUpdatedEvents_Asset,
				// 			C
				// 		)
				// 		const [D_emittedDebt_Asset, D_emittedColl_Asset] = th.getDebtAndCollFromVesselUpdatedEvents(
				// 			vesselUpdatedEvents_Asset,
				// 			D
				// 		)

				// 		// Expect A, B, C to have 0 emitted debt and coll, since they were closed

				// 		assert.equal(A_emittedDebt_Asset, "0")
				// 		assert.equal(A_emittedColl_Asset, "0")
				// 		assert.equal(B_emittedDebt_Asset, "0")
				// 		assert.equal(B_emittedColl_Asset, "0")
				// 		assert.equal(C_emittedDebt_Asset, "0")
				// 		assert.equal(C_emittedColl_Asset, "0")

				// 		/* Expect D to have lost 15 debt and (at ETH price of 200) 15/200 = 0.075 ETH.
				// So, expect remaining debt = (85 - 15) = 70, and remaining ETH = 1 - 15/200 = 0.925 remaining. */
				// 		const price = await priceFeed.getPrice(erc20.address)

				// 		th.assertIsApproximatelyEqual(D_emittedDebt_Asset, D_totalDebt_Asset.sub(partialAmount))
				// 		th.assertIsApproximatelyEqual(D_emittedColl_Asset, D_coll_Asset.sub(partialAmount.mul(mv._1e18BN).div(price)))
			})

			it("redeemCollateral(): a redemption that closes a vessel leaves the vessel's surplus (collateral - collateral drawn) available for the vessel owner to claim", async () => {
				const { A_netDebt_Asset, A_coll_Asset, B_netDebt_Asset, B_coll_Asset, C_netDebt_Asset, C_coll_Asset } =
					await redeemCollateral3Full1Partial()

				const A_balanceBefore_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceBefore_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceBefore_Asset = toBN(await erc20.balanceOf(C))

				// CollSurplusPool endpoint cannot be called directly
				await assertRevert(
					collSurplusPool.claimColl(erc20.address, A),
					"CollSurplusPool: Caller is not Borrower Operations"
				)

				await borrowerOperations.claimCollateral(erc20.address, { from: A })
				await borrowerOperations.claimCollateral(erc20.address, { from: B })
				await borrowerOperations.claimCollateral(erc20.address, { from: C })

				const A_balanceAfter_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceAfter_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceAfter_Asset = toBN(await erc20.balanceOf(C))

				const price = await priceFeed.getPrice(erc20.address)

				const A_balanceExpected_Asset = A_balanceBefore_Asset.add(
					A_coll_Asset.sub(calcSoftnedAmount(A_netDebt_Asset, price))
				)
				const B_balanceExpected_Asset = B_balanceBefore_Asset.add(
					B_coll_Asset.sub(calcSoftnedAmount(B_netDebt_Asset, price))
				)
				const C_balanceExpected_Asset = C_balanceBefore_Asset.add(
					C_coll_Asset.sub(calcSoftnedAmount(C_netDebt_Asset, price))
				)

				th.assertIsApproximatelyEqual(A_balanceAfter_Asset, A_balanceExpected_Asset)
				th.assertIsApproximatelyEqual(B_balanceAfter_Asset, B_balanceExpected_Asset)
				th.assertIsApproximatelyEqual(C_balanceAfter_Asset, C_balanceExpected_Asset)
			})

			it("redeemCollateral(): a redemption that closes a vessel leaves the vessel's surplus (collateral - collateral drawn) available for the vessel owner after re-opening vessel", async () => {
				const {
					A_netDebt_Asset,
					A_coll_Asset: A_collBefore_Asset,
					B_netDebt_Asset,
					B_coll_Asset: B_collBefore_Asset,
					C_netDebt_Asset,
					C_coll_Asset: C_collBefore_Asset,
				} = await redeemCollateral3Full1Partial()

				const price = await priceFeed.getPrice(erc20.address)

				const A_surplus_Asset = A_collBefore_Asset.sub(calcSoftnedAmount(A_netDebt_Asset, price))
				const B_surplus_Asset = B_collBefore_Asset.sub(calcSoftnedAmount(B_netDebt_Asset, price))
				const C_surplus_Asset = C_collBefore_Asset.sub(calcSoftnedAmount(C_netDebt_Asset, price))

				const { collateral: A_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: A },
				})
				const { collateral: B_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(190, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: B },
				})
				const { collateral: C_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(180, 16)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: C },
				})

				const A_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, A)
				const B_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, B)
				const C_collAfter_Asset = await vesselManager.getVesselColl(erc20.address, C)

				assert.isTrue(A_collAfter_Asset.eq(A_coll_Asset))
				assert.isTrue(B_collAfter_Asset.eq(B_coll_Asset))
				assert.isTrue(C_collAfter_Asset.eq(C_coll_Asset))

				const A_balanceBefore_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceBefore_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceBefore_Asset = toBN(await erc20.balanceOf(C))

				await borrowerOperations.claimCollateral(erc20.address, { from: A })
				await borrowerOperations.claimCollateral(erc20.address, { from: B })
				await borrowerOperations.claimCollateral(erc20.address, { from: C })

				const A_balanceAfter_Asset = toBN(await erc20.balanceOf(A))
				const B_balanceAfter_Asset = toBN(await erc20.balanceOf(B))
				const C_balanceAfter_Asset = toBN(await erc20.balanceOf(C))

				th.assertIsApproximatelyEqual(A_balanceAfter_Asset, A_balanceBefore_Asset.add(A_surplus_Asset))
				th.assertIsApproximatelyEqual(B_balanceAfter_Asset, B_balanceBefore_Asset.add(B_surplus_Asset))
				th.assertIsApproximatelyEqual(C_balanceAfter_Asset, C_balanceBefore_Asset.add(C_surplus_Asset))
			})

			it("redeemCollateral(): reverts if fee eats up all returned collateral", async () => {
				// --- SETUP ---

				const { VUSDAmount: VUSDAmount_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(200, 16)),
					extraVUSDAmount: dec(1, 24),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: bob },
				})

				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---

				// skip bootstrapping phase
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

				// keep redeeming until we get the base rate to the ceiling of 100%

				for (let i = 0; i < 2; i++) {
					// Find hints for redeeming
					const { 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
						await vesselManagerOperations.getRedemptionHints(erc20.address, VUSDAmount_Asset, price, 0)

					// Don't pay for gas, as it makes it easier to calculate the received Ether
					const redemptionTx_Asset = await vesselManagerOperations.redeemCollateral(
						erc20.address,
						VUSDAmount_Asset,
						firstRedemptionHint_Asset,
						alice,
						alice,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{
							from: alice,
							// gasPrice: 0,
						}
					)

					await openVessel({
						asset: erc20.address,
						ICR: toBN(dec(150, 16)),
						extraParams: { from: bob },
					})
					await borrowerOperations.adjustVessel(
						erc20.address,
						VUSDAmount_Asset.mul(mv._1e18BN).div(price),
						0,
						VUSDAmount_Asset,
						true,
						alice,
						alice,
						{ from: alice }
					)
				}

				const { 0: firstRedemptionHint_Asset, 1: partialRedemptionHintNICR_Asset } =
					await vesselManagerOperations.getRedemptionHints(erc20.address, VUSDAmount_Asset, price, 0)

				await assertRevert(
					vesselManagerOperations.redeemCollateral(
						erc20.address,
						VUSDAmount_Asset,
						firstRedemptionHint_Asset,
						alice,
						alice,
						partialRedemptionHintNICR_Asset,
						0,
						th._100pct,
						{
							from: alice,
							// gasPrice: 0,
						}
					),
					"VesselManager: Fee would eat up all returned collateral"
				)
			})
		})

		describe("Extras", async () => {
			it("getPendingDebtTokenReward(): returns 0 if there is no pending VUSDDebt reward", async () => {
				// Make some vessels

				const { totalDebt: totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraVUSDAmount: totalDebt_Asset,
					extraParams: { from: whale },
				})

				await stabilityPool.provideToSP(totalDebt_Asset, { from: whale })

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

				// Confirm defaulter_1 liquidated
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				// Confirm there are no pending rewards from liquidation

				const current_L_VUSDDebt_Asset = await vesselManager.L_Debts(erc20.address)
				assert.equal(current_L_VUSDDebt_Asset, 0)

				const carolSnapshot_L_VUSDDebt_Asset = (await vesselManager.rewardSnapshots(carol, erc20.address))[1]
				assert.equal(carolSnapshot_L_VUSDDebt_Asset, 0)

				const carol_PendingVUSDDebtReward_Asset = await vesselManager.getPendingDebtTokenReward(erc20.address, carol)
				assert.equal(carol_PendingVUSDDebtReward_Asset, 0)
			})

			it("getPendingETHReward(): returns 0 if there is no pending ETH reward", async () => {
				// make some vessels

				const { totalDebt: totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraVUSDAmount: dec(100, 18),
					extraParams: { from: defaulter_1 },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(3, 18)),
					extraVUSDAmount: dec(20, 18),
					extraParams: { from: carol },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraVUSDAmount: totalDebt_Asset,
					extraParams: { from: whale },
				})

				await stabilityPool.provideToSP(totalDebt_Asset, { from: whale })

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

				// Confirm defaulter_1 liquidated
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				// Confirm there are no pending rewards from liquidation

				const current_L_ETH_Asset = await vesselManager.L_Colls(erc20.address)
				assert.equal(current_L_ETH_Asset, 0)

				const carolSnapshot_L_ETH_Asset = (await vesselManager.rewardSnapshots(carol, erc20.address))[0]
				assert.equal(carolSnapshot_L_ETH_Asset, 0)

				const carol_PendingETHReward_Asset = await vesselManager.getPendingAssetReward(erc20.address, carol)
				assert.equal(carol_PendingETHReward_Asset, 0)
			})

			// --- computeICR ---

			it("computeICR(): returns 0 if vessel's coll is worth 0", async () => {
				const price = 0
				const coll = dec(1, "ether")
				const debt = dec(100, 18)

				const ICR = (await vesselManager.computeICR(coll, debt, price)).toString()
				assert.equal(ICR, 0)
			})

			it("computeICR(): returns 2^256-1 for ETH:USD = 100, coll = 1 ETH, debt = 100 VUSD", async () => {
				const price = dec(100, 18)
				const coll = dec(1, "ether")
				const debt = dec(100, 18)

				const ICR = (await vesselManager.computeICR(coll, debt, price)).toString()
				assert.equal(ICR, dec(1, 18))
			})

			it("computeICR(): returns correct ICR for ETH:USD = 100, coll = 200 ETH, debt = 30 VUSD", async () => {
				const price = dec(100, 18)
				const coll = dec(200, "ether")
				const debt = dec(30, 18)

				const ICR = (await vesselManager.computeICR(coll, debt, price)).toString()
				assert.isAtMost(th.getDifference(ICR, "666666666666666666666"), 1000)
			})

			it("computeICR(): returns correct ICR for ETH:USD = 250, coll = 1350 ETH, debt = 127 VUSD", async () => {
				const price = "250000000000000000000"
				const coll = "1350000000000000000000"
				const debt = "127000000000000000000"

				const ICR = await vesselManager.computeICR(coll, debt, price)
				assert.isAtMost(th.getDifference(ICR, "2657480314960630000000"), 1000000)
			})

			it("computeICR(): returns correct ICR for ETH:USD = 100, coll = 1 ETH, debt = 54321 VUSD", async () => {
				const price = dec(100, 18)
				const coll = dec(1, "ether")
				const debt = "54321000000000000000000"

				const ICR = (await vesselManager.computeICR(coll, debt, price)).toString()
				assert.isAtMost(th.getDifference(ICR, "1840908672520756"), 1000)
			})

			it("computeICR(): returns 2^256-1 if vessel has non-zero coll and zero debt", async () => {
				const price = dec(100, 18)
				const coll = dec(1, "ether")
				const debt = 0

				const ICR = web3.utils.toHex(await vesselManager.computeICR(coll, debt, price))
				const maxBytes32 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
				assert.equal(ICR, maxBytes32)
			})
		})

		describe("Recovery Mode", async () => {
			// --- checkRecoveryMode ---

			//TCR < 150%
			it("checkRecoveryMode(): returns true when TCR < 150%", async () => {
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: bob },
				})

				await priceFeed.setPrice(erc20.address, "99999999999999999999")

				const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

				assert.isTrue(TCR_Asset.lte(toBN("1500000000000000000")))

				assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))
			})

			// TCR == 150%
			it("checkRecoveryMode(): returns false when TCR == 150%", async () => {
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: bob },
				})

				const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

				assert.equal(TCR_Asset, "1500000000000000000")

				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
			})

			// > 150%
			it("checkRecoveryMode(): returns false when TCR > 150%", async () => {
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: bob },
				})

				await priceFeed.setPrice(erc20.address, "100000000000000000001")

				const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

				assert.isTrue(TCR_Asset.gte(toBN("1500000000000000000")))

				assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
			})

			// check 0
			it("checkRecoveryMode(): returns false when TCR == 0", async () => {
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: alice },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: bob },
				})

				await priceFeed.setPrice(erc20.address, 0)

				const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()

				assert.equal(TCR_Asset, 0)

				assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))
			})
		})

		describe("Getters", async () => {
			it("getVesselStake(): returns stake", async () => {
				const { collateral: A_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: A },
				})
				const { collateral: B_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: B },
				})

				const A_Stake_Asset = await vesselManager.getVesselStake(erc20.address, A)
				const B_Stake_Asset = await vesselManager.getVesselStake(erc20.address, B)

				assert.equal(A_Stake_Asset, A_coll_Asset.toString())
				assert.equal(B_Stake_Asset, B_coll_Asset.toString())
			})

			it("getVesselColl(): returns coll", async () => {
				const { collateral: A_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: A },
				})
				const { collateral: B_coll_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: B },
				})

				assert.equal(await vesselManager.getVesselColl(erc20.address, A), A_coll_Asset.toString())
				assert.equal(await vesselManager.getVesselColl(erc20.address, B), B_coll_Asset.toString())
			})

			it("getVesselDebt(): returns debt", async () => {
				const { totalDebt: totalDebtA_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: A },
				})
				const { totalDebt: totalDebtB_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: B },
				})

				const A_Debt_Asset = await vesselManager.getVesselDebt(erc20.address, A)
				const B_Debt_Asset = await vesselManager.getVesselDebt(erc20.address, B)

				// Expect debt = requested + 0.5% fee + 50 (due to gas comp)

				assert.equal(A_Debt_Asset, totalDebtA_Asset.toString())
				assert.equal(B_Debt_Asset, totalDebtB_Asset.toString())
			})

			it("getVesselStatus(): returns status", async () => {
				const { totalDebt: B_totalDebt_Asset } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(150, 16)),
					extraVUSDAmount: B_totalDebt_Asset,
					extraParams: { from: A },
				})

				// to be able to repay:
				await debtToken.transfer(B, B_totalDebt_Asset, { from: A })

				await borrowerOperations.closeVessel(erc20.address, { from: B })

				const A_Status_Asset = await vesselManager.getVesselStatus(erc20.address, A)
				const B_Status_Asset = await vesselManager.getVesselStatus(erc20.address, B)
				const C_Status_Asset = await vesselManager.getVesselStatus(erc20.address, C)

				assert.equal(A_Status_Asset, "1") // active
				assert.equal(B_Status_Asset, "2") // closed by user
				assert.equal(C_Status_Asset, "0") // non-existent
			})

			it("hasPendingRewards(): returns false it vessel is not active", async () => {
				assert.isFalse(await vesselManager.hasPendingRewards(erc20.address, alice))
			})
		})
	})
})

contract("Reset chain state", async accounts => {})
