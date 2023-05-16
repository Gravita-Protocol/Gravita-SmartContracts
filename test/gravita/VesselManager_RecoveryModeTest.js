const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN, assertRevert } = th
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

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

contract("VesselManager - in Recovery Mode", async accounts => {
	const _1_Ether = web3.utils.toWei("1", "ether")
	const _2_Ether = web3.utils.toWei("2", "ether")
	const _3_Ether = web3.utils.toWei("3", "ether")
	const _3pt5_Ether = web3.utils.toWei("3.5", "ether")
	const _6_Ether = web3.utils.toWei("6", "ether")
	const _10_Ether = web3.utils.toWei("10", "ether")
	const _20_Ether = web3.utils.toWei("20", "ether")
	const _21_Ether = web3.utils.toWei("21", "ether")
	const _22_Ether = web3.utils.toWei("22", "ether")
	const _24_Ether = web3.utils.toWei("24", "ether")
	const _25_Ether = web3.utils.toWei("25", "ether")
	const _30_Ether = web3.utils.toWei("30", "ether")

	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const [
		owner,
		alice,
		bob,
		carol,
		dennis,
		erin,
		freddy,
		greta,
		harry,
		whale,
		defaulter_1,
		defaulter_2,
		defaulter_3,
		defaulter_4,
		A,
		B,
		C,
		D,
		E,
		F,
		G,
		H,
		I,
		treasury
	] = accounts

	let REDEMPTION_SOFTENING_PARAM

	const openVessel = async params => th.openVessel(contracts.core, params)
	const calcSoftnedAmount = (collAmount, price) => collAmount.mul(mv._1e18BN).mul(REDEMPTION_SOFTENING_PARAM).div(toBN(1000)).div(price)

	before(async () => {
		await deploy(treasury, accounts.slice(0, 40))

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

	it("checkRecoveryMode(): Returns true if TCR falls below CCR", async () => {
		// --- SETUP ---
		//  Alice and Bob withdraw such that the TCR is ~150%
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

		const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		assert.equal(TCR_Asset, dec(15, 17))

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// --- TEST ---

		// price drops to 1ETH:150, reducing TCR below 150%. setPrice() calls checkTCRAndSetRecoveryMode() internally.
		await priceFeed.setPrice(erc20.address, dec(15, 17))

		// const price = await priceFeed.getPrice(erc20.address)
		// await vesselManager.checkTCRAndSetRecoveryMode(price)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))
	})

	it("checkRecoveryMode(): Returns true if TCR stays less than CCR", async () => {
		// --- SETUP ---
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

		const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		assert.equal(TCR_Asset, "1500000000000000000")

		// --- TEST ---

		// price drops to 1ETH:150, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "150000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		await borrowerOperations.addColl(erc20.address, 1, alice, alice, { from: alice })

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))
	})

	it("checkRecoveryMode(): returns false if TCR stays above CCR", async () => {
		// --- SETUP ---
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(450, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: bob },
		})

		// --- TEST ---
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		await borrowerOperations.withdrawColl(erc20.address, _1_Ether, alice, alice, {
			from: alice,
		})

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
	})

	it("checkRecoveryMode(): returns false if TCR rises above CCR", async () => {
		// --- SETUP ---
		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: bob },
		})

		const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		assert.equal(TCR_Asset, "1500000000000000000")

		// --- TEST ---
		// price drops to 1ETH:150, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "150000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		await borrowerOperations.addColl(erc20.address, A_coll_Asset, alice, alice, {
			from: alice,
		})

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
	})

	// --- liquidate() with ICR < 100% ---

	it("liquidate(), with ICR < 100%: removes stake and updates totalStakes", async () => {
		// --- SETUP ---
		//  Alice and Bob withdraw such that the TCR is ~150%

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: bob },
		})

		const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		assert.equal(TCR_Asset, "1500000000000000000")

		const bob_Stake_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STAKE_INDEX]
		const totalStakes_Before_Asset = await vesselManager.totalStakes(erc20.address)

		assert.equal(bob_Stake_Before_Asset.toString(), B_coll_Asset)
		assert.equal(totalStakes_Before_Asset.toString(), A_coll_Asset.add(B_coll_Asset))

		// --- TEST ---
		// price drops to 1ETH:100, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check Bob's ICR falls to 75%

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.equal(bob_ICR_Asset, "750000000000000000")

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		const bob_Stake_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STAKE_INDEX]
		const totalStakes_After_Asset = await vesselManager.totalStakes(erc20.address)

		assert.equal(bob_Stake_After_Asset, 0)
		assert.equal(totalStakes_After_Asset.toString(), A_coll_Asset)
	})

	it("liquidate(), with ICR < 100%: updates system snapshots correctly", async () => {
		// --- SETUP ---
		//  Alice, Bob and Dennis withdraw such that their ICRs and the TCR is ~150%

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: bob },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: dennis },
		})

		const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		assert.equal(TCR_Asset, "1500000000000000000")

		// --- TEST ---
		// price drops to 1ETH:100, reducing TCR below 150%, and all Vessels below 100% ICR
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Dennis is liquidated
		await vesselManagerOperations.liquidate(erc20.address, dennis, { from: owner })

		const totalStakesSnaphot_before_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_before_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		assert.equal(totalStakesSnaphot_before_Asset, A_coll_Asset.add(B_coll_Asset))
		assert.equal(
			totalCollateralSnapshot_before_Asset,
			A_coll_Asset.add(B_coll_Asset).add(th.applyLiquidationFee(D_coll_Asset))
		)

		const A_reward_Asset = th.applyLiquidationFee(D_coll_Asset).mul(A_coll_Asset).div(A_coll_Asset.add(B_coll_Asset))
		const B_reward_Asset = th.applyLiquidationFee(D_coll_Asset).mul(B_coll_Asset).div(A_coll_Asset.add(B_coll_Asset))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		const totalStakesSnaphot_After_Asset = await vesselManager.totalStakesSnapshot(erc20.address)
		const totalCollateralSnapshot_After_Asset = await vesselManager.totalCollateralSnapshot(erc20.address)

		assert.equal(totalStakesSnaphot_After_Asset.toString(), A_coll_Asset)
		// total collateral should always be 9 minus gas compensations, as all liquidations in this test case are full redistributions
		assert.isAtMost(
			th.getDifference(
				totalCollateralSnapshot_After_Asset,
				A_coll_Asset.add(A_reward_Asset).add(th.applyLiquidationFee(B_coll_Asset.add(B_reward_Asset)))
			),
			1000
		) // 3 + 4.5*0.995 + 1.5*0.995^2
	})

	it("liquidate(), with ICR < 100%: closes the Vessel and removes it from the Vessel array", async () => {
		// --- SETUP ---
		//  Alice and Bob withdraw such that the TCR is ~150%

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: bob },
		})

		const TCR_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		assert.equal(TCR_Asset, "1500000000000000000")

		const bob_VesselStatus_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_Before_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_Before_Asset, 1)
		assert.isTrue(bob_Vessel_isInSortedList_Before_Asset)

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check Bob's ICR falls to 75%

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.equal(bob_ICR_Asset, "750000000000000000")

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// check Bob's Vessel is successfully closed, and removed from sortedList

		const bob_VesselStatus_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_After_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_After_Asset, 3)
		assert.isFalse(bob_Vessel_isInSortedList_After_Asset)
	})

	it("liquidate(), with ICR < 100%: only redistributes to active Vessels - no offset to Stability Pool", async () => {
		// --- SETUP ---
		//  Alice, Bob and Dennis withdraw such that their ICRs and the TCR is ~150%
		const spDeposit = toBN(dec(390, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraVUSDAmount: spDeposit,
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: dennis },
		})

		// Alice deposits to SP
		await stabilityPool.provideToSP(spDeposit, { from: alice })

		// check rewards-per-unit-staked before
		assert.equal((await stabilityPool.P()).toString(), "1000000000000000000")

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%, and all Vessels below 100% ICR
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// liquidate bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// check SP rewards-per-unit-staked after liquidation - should be no increase

		assert.equal((await stabilityPool.P()).toString(), "1000000000000000000")
	})

	// --- liquidate() with 100% < ICR < 110%

	it("liquidate(), with 100 < ICR < 110%: removes stake and updates totalStakes", async () => {
		// --- SETUP ---
		//  Bob withdraws up to 2000 VUSD of debt, bringing his ICR to 210%

		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: bob },
		})

		let price = await priceFeed.getPrice(erc20.address)

		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isAtMost(
			th.getDifference(
				TCR_Asset,
				A_coll_Asset.add(B_coll_Asset).mul(price).div(A_totalDebt_Asset.add(B_totalDebt_Asset))
			),
			1000
		)

		const bob_Stake_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STAKE_INDEX]
		const totalStakes_Before_Asset = await vesselManager.totalStakes(erc20.address)

		assert.equal(bob_Stake_Before_Asset.toString(), B_coll_Asset)
		assert.equal(totalStakes_Before_Asset.toString(), A_coll_Asset.add(B_coll_Asset))

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR to 117%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check Bob's ICR falls to 105%

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.equal(bob_ICR_Asset, "1050000000000000000")

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		const bob_Stake_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STAKE_INDEX]
		const totalStakes_After_Asset = await vesselManager.totalStakes(erc20.address)

		assert.equal(bob_Stake_After_Asset, 0)
		assert.equal(totalStakes_After_Asset.toString(), A_coll_Asset)
	})

	it("liquidate(), with 100% < ICR < 110%: updates system snapshots correctly", async () => {
		// --- SETUP ---
		//  Alice and Dennis withdraw such that their ICR is ~150%
		//  Bob withdraws up to 20000 VUSD of debt, bringing his ICR to 210%

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraVUSDAmount: dec(20000, 18),
			extraParams: { from: bob },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: dennis },
		})

		const totalStakesSnaphot_1 = (await vesselManager.totalStakesSnapshot(ZERO_ADDRESS)).toString()
		const totalCollateralSnapshot_1 = (await vesselManager.totalCollateralSnapshot(ZERO_ADDRESS)).toString()

		const totalStakesSnaphot_1_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_1_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()
		assert.equal(totalStakesSnaphot_1, 0)
		assert.equal(totalCollateralSnapshot_1, 0)
		assert.equal(totalStakesSnaphot_1_Asset, 0)
		assert.equal(totalCollateralSnapshot_1_Asset, 0)

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%, and all Vessels below 100% ICR
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Dennis is liquidated
		await vesselManagerOperations.liquidate(erc20.address, dennis, { from: owner })

		const A_reward_Asset = th.applyLiquidationFee(D_coll_Asset).mul(A_coll_Asset).div(A_coll_Asset.add(B_coll_Asset))
		const B_reward_Asset = th.applyLiquidationFee(D_coll_Asset).mul(B_coll_Asset).div(A_coll_Asset.add(B_coll_Asset))

		/*
    Prior to Dennis liquidation, total stakes and total collateral were each 27 ether. 
  
    Check snapshots. Dennis' liquidated collateral is distributed and remains in the system. His 
    stake is removed, leaving 24+3*0.995 ether total collateral, and 24 ether total stakes. */

		const totalStakesSnaphot_2_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_2_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		assert.equal(totalStakesSnaphot_2_Asset, A_coll_Asset.add(B_coll_Asset))
		assert.equal(
			totalCollateralSnapshot_2_Asset,
			A_coll_Asset.add(B_coll_Asset).add(th.applyLiquidationFee(D_coll_Asset))
		) // 24 + 3*0.995

		// check Bob's ICR is now in range 100% < ICR 110%
		const _110percent = web3.utils.toBN("1100000000000000000")
		const _100percent = web3.utils.toBN("1000000000000000000")

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)

		assert.isTrue(bob_ICR_Asset.lt(_110percent))
		assert.isTrue(bob_ICR_Asset.gt(_100percent))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		/* After Bob's liquidation, Bob's stake (21 ether) should be removed from total stakes, 
    but his collateral should remain in the system (*0.995). */

		const totalStakesSnaphot_3_Asset = await vesselManager.totalStakesSnapshot(erc20.address)
		const totalCollateralSnapshot_3_Asset = await vesselManager.totalCollateralSnapshot(erc20.address)

		assert.equal(totalStakesSnaphot_3_Asset.toString(), A_coll_Asset)
		// total collateral should always be 27 minus gas compensations, as all liquidations in this test case are full redistributions

		assert.isAtMost(
			th.getDifference(
				totalCollateralSnapshot_3_Asset.toString(),
				A_coll_Asset.add(A_reward_Asset).add(th.applyLiquidationFee(B_coll_Asset.add(B_reward_Asset)))
			),
			1000
		)
	})

	it("liquidate(), with 100% < ICR < 110%: closes the Vessel and removes it from the Vessel array", async () => {
		// --- SETUP ---
		//  Bob withdraws up to 2000 VUSD of debt, bringing his ICR to 210%

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: bob },
		})

		const bob_VesselStatus_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_Before_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_Before_Asset, 1)
		assert.isTrue(bob_Vessel_isInSortedList_Before_Asset)

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check Bob's ICR has fallen to 105%
		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.equal(bob_ICR_Asset, "1050000000000000000")

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// check Bob's Vessel is successfully closed, and removed from sortedList
		const bob_VesselStatus_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_After_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_After_Asset, 3)
		assert.isFalse(bob_Vessel_isInSortedList_After_Asset)
	})

	it("liquidate(), with 100% < ICR < 110%: offsets as much debt as possible with the Stability Pool, then redistributes the remainder coll and debt", async () => {
		// --- SETUP ---
		//  Alice and Dennis withdraw such that their ICR is ~150%
		//  Bob withdraws up to 2000 VUSD of debt, bringing his ICR to 210%
		const spDeposit = toBN(dec(390, 18))

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraVUSDAmount: spDeposit,
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: bob },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(150, 16)),
			extraParams: { from: dennis },
		})

		// Alice deposits 390VUSD to the Stability Pool
		await stabilityPool.provideToSP(spDeposit, { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check Bob's ICR has fallen to 105%

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.equal(bob_ICR_Asset, "1050000000000000000")

		// check pool VUSD before liquidation

		const stabilityPoolVUSD_Before_Asset = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
		assert.equal(stabilityPoolVUSD_Before_Asset, "390000000000000000000")

		// check Pool reward term before liquidation

		assert.equal((await stabilityPool.P()).toString(), "1000000000000000000")

		/* Now, liquidate Bob. Liquidated coll is 21 ether, and liquidated debt is 2000 VUSD.
    
    With 390 VUSD in the StabilityPool, 390 VUSD should be offset with the pool, leaving 0 in the pool.
  
    Stability Pool rewards for alice should be:
    VUSDLoss: 390VUSD
    AssetGain: (390 / 2000) * 21*0.995 = 4.074525 ether
    After offsetting 390 VUSD and 4.074525 ether, the remainders - 1610 VUSD and 16.820475 ether - should be redistributed to all active Vessels.
   */
		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		const aliceDeposit_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
		const aliceETHGain_Asset = (await stabilityPool.getDepositorGains(alice))[1][1]
		const aliceExpectedETHGain_Asset = spDeposit.mul(th.applyLiquidationFee(B_coll_Asset)).div(B_totalDebt_Asset)

		assert.equal(aliceDeposit_Asset.toString(), 0)
		assert.equal(aliceETHGain_Asset.toString(), aliceExpectedETHGain_Asset)

		/* Now, check redistribution to active Vessels. Remainders of 1610 VUSD and 16.82 ether are distributed.
    
    Now, only Alice and Dennis have a stake in the system - 3 ether each, thus total stakes is 6 ether.
  
    Rewards-per-unit-staked from the redistribution should be:
  
    L_VUSDDebt = 1610 / 6 = 268.333 VUSD
    L_ETH = 16.820475 /6 =  2.8034125 ether
    */

		const L_VUSDDebt_Asset = (await vesselManager.L_Debts(erc20.address)).toString()
		const L_ETH_Asset = (await vesselManager.L_Colls(erc20.address)).toString()

		assert.isAtMost(
			th.getDifference(
				L_VUSDDebt_Asset,
				B_totalDebt_Asset.sub(spDeposit).mul(mv._1e18BN).div(A_coll_Asset.add(D_coll_Asset))
			),
			100
		)
		assert.isAtMost(
			th.getDifference(
				L_ETH_Asset,
				th.applyLiquidationFee(
					B_coll_Asset.sub(B_coll_Asset.mul(spDeposit).div(B_totalDebt_Asset))
						.mul(mv._1e18BN)
						.div(A_coll_Asset.add(D_coll_Asset))
				)
			),
			100
		)
	})

	// --- liquidate(), applied to vessel with ICR > 110% that has the lowest ICR

	it("liquidate(), with ICR > 110%, vessel has lowest ICR, and StabilityPool is empty: does nothing", async () => {
		// --- SETUP ---
		// Alice and Dennis withdraw, resulting in ICRs of 266%.
		// Bob withdraws, resulting in ICR of 240%. Bob has lowest ICR.

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's ICR is >110% but still lowest

		const bob_ICR_Asset = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
		const alice_ICR_Asset = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
		const dennis_ICR_Asset = (await vesselManager.getCurrentICR(erc20.address, dennis, price)).toString()

		assert.equal(bob_ICR_Asset, "1200000000000000000")
		assert.equal(alice_ICR_Asset, dec(133, 16))
		assert.equal(dennis_ICR_Asset, dec(133, 16))

		// console.log(`TCR: ${await th.getTCR(contracts)}`)
		// Try to liquidate Bob
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		// Check that Pool rewards don't change
		assert.equal((await stabilityPool.P()).toString(), "1000000000000000000")

		// Check that redistribution rewards don't change
		const L_VUSDDebt_Asset = (await vesselManager.L_Debts(erc20.address)).toString()
		const L_ETH_Asset = (await vesselManager.L_Colls(erc20.address)).toString()

		assert.equal(L_VUSDDebt_Asset, "0")
		assert.equal(L_ETH_Asset, "0")

		// Check that Bob's Vessel and stake remains active with unchanged coll and debt
		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const bob_Debt_Asset = bob_Vessel_Asset[th.VESSEL_DEBT_INDEX].toString()
		const bob_Coll_Asset = bob_Vessel_Asset[th.VESSEL_COLL_INDEX].toString()
		const bob_Stake_Asset = bob_Vessel_Asset[th.VESSEL_STAKE_INDEX].toString()
		const bob_VesselStatus_Asset = bob_Vessel_Asset[th.VESSEL_STATUS_INDEX].toString()
		const bob_isInSortedVesselsList_Asset = await sortedVessels.contains(erc20.address, bob)

		th.assertIsApproximatelyEqual(bob_Debt_Asset.toString(), B_totalDebt_Asset)
		assert.equal(bob_Coll_Asset.toString(), B_coll_Asset)
		assert.equal(bob_Stake_Asset.toString(), B_coll_Asset)
		assert.equal(bob_VesselStatus_Asset, "1")
		assert.isTrue(bob_isInSortedVesselsList_Asset)
	})

	it("liquidate(), with 110% < ICR < TCR, and StabilityPool VUSD > debt to liquidate: offsets the vessel entirely with the pool", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_Asset,
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits VUSD in the Stability Pool
		const spDeposit = B_totalDebt_Asset.add(toBN(1))
		await stabilityPool.provideToSP(spDeposit, { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's ICR is between 110 and TCR

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gt(mv._MCR) && bob_ICR_Asset.lt(TCR_Asset))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		/* Check accrued Stability Pool rewards after. Total Pool deposits was 1490 VUSD, Alice sole depositor.
    As liquidated debt (250 VUSD) was completely offset
    Alice's expected compounded deposit: (1490 - 250) = 1240VUSD
    Alice's expected ETH gain:  Bob's liquidated capped coll (minus gas comp), 2.75*0.995 ether
  
    */
		const aliceExpectedDeposit_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
		const aliceExpectedETHGain_Asset = (await stabilityPool.getDepositorGains(alice))[1][1]

		assert.isAtMost(th.getDifference(aliceExpectedDeposit_Asset.toString(), spDeposit.sub(B_totalDebt_Asset)), 2000)
		assert.isAtMost(
			th.getDifference(
				aliceExpectedETHGain_Asset,
				th.applyLiquidationFee(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
			),
			3000
		)

		// check Bob’s collateral surplus

		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)
		// can claim collateral

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)
	})

	it("liquidate(), with ICR% = 110 < TCR, and StabilityPool VUSD > debt to liquidate: offsets the vessel entirely with the pool, there’s no collateral surplus", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 220%. Bob has lowest ICR.

		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_Asset,
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits VUSD in the Stability Pool
		const spDeposit = B_totalDebt_Asset.add(toBN(1))
		await stabilityPool.provideToSP(spDeposit, { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)
		await th.getTCR(contracts.core)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's ICR = 110

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.eq(mv._MCR))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		/* Check accrued Stability Pool rewards after. Total Pool deposits was 1490 VUSD, Alice sole depositor.
    As liquidated debt (250 VUSD) was completely offset
    Alice's expected compounded deposit: (1490 - 250) = 1240VUSD
    Alice's expected ETH gain:  Bob's liquidated capped coll (minus gas comp), 2.75*0.995 ether
    */

		const aliceExpectedDeposit_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
		const aliceExpectedETHGain_Asset = (await stabilityPool.getDepositorGains(alice))[1][1]

		assert.isAtMost(th.getDifference(aliceExpectedDeposit_Asset.toString(), spDeposit.sub(B_totalDebt_Asset)), 2000)
		assert.isAtMost(
			th.getDifference(
				aliceExpectedETHGain_Asset,
				th.applyLiquidationFee(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
			),
			3000
		)

		// check Bob’s collateral surplus
		th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(erc20.address, bob), "0")
	})

	it("liquidate(), with 110% < ICR < TCR, and StabilityPool VUSD > debt to liquidate: removes stake and updates totalStakes", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_Asset,
			extraParams: { from: alice },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits VUSD in the Stability Pool
		await stabilityPool.provideToSP(B_totalDebt_Asset.add(toBN(1)), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check stake and totalStakes before

		const bob_Stake_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STAKE_INDEX]
		const totalStakes_Before_Asset = await vesselManager.totalStakes(erc20.address)

		assert.equal(bob_Stake_Before_Asset.toString(), B_coll_Asset)
		assert.equal(totalStakes_Before_Asset.toString(), A_coll_Asset.add(B_coll_Asset).add(D_coll_Asset))

		// Check Bob's ICR is between 110 and 150

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gt(mv._MCR) && bob_ICR_Asset.lt(await th.getTCR(contracts.core, erc20.address)))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// check stake and totalStakes after

		const bob_Stake_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STAKE_INDEX]
		const totalStakes_After_Asset = await vesselManager.totalStakes(erc20.address)

		assert.equal(bob_Stake_After_Asset, 0)
		assert.equal(totalStakes_After_Asset.toString(), A_coll_Asset.add(D_coll_Asset))

		// check Bob’s collateral surplus

		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)
		// can claim collateral

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)
	})

	it("liquidate(), with 110% < ICR < TCR, and StabilityPool VUSD > debt to liquidate: updates system snapshots", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_Asset,
			extraParams: { from: alice },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits VUSD in the Stability Pool
		await stabilityPool.provideToSP(B_totalDebt_Asset.add(toBN(1)), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check system snapshots before

		const totalStakesSnaphot_before_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_before_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		assert.equal(totalStakesSnaphot_before_Asset, "0")
		assert.equal(totalCollateralSnapshot_before_Asset, "0")

		// Check Bob's ICR is between 110 and TCR

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gt(mv._MCR) && bob_ICR_Asset.lt(await th.getTCR(contracts.core, erc20.address)))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		const totalStakesSnaphot_After_Asset = await vesselManager.totalStakesSnapshot(erc20.address)
		const totalCollateralSnapshot_After_Asset = await vesselManager.totalCollateralSnapshot(erc20.address)

		// totalStakesSnapshot should have reduced to 22 ether - the sum of Alice's coll( 20 ether) and Dennis' coll (2 ether )
		assert.equal(totalStakesSnaphot_After_Asset.toString(), A_coll_Asset.add(D_coll_Asset))
		// Total collateral should also reduce, since all liquidated coll has been moved to a reward for Stability Pool depositors
		assert.equal(totalCollateralSnapshot_After_Asset.toString(), A_coll_Asset.add(D_coll_Asset))
	})

	it("liquidate(), with 110% < ICR < TCR, and StabilityPool VUSD > debt to liquidate: closes the Vessel", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_Asset,
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits VUSD in the Stability Pool
		await stabilityPool.provideToSP(B_totalDebt_Asset.add(toBN(1)), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's Vessel is active

		const bob_VesselStatus_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_Before_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_Before_Asset, 1)
		assert.isTrue(bob_Vessel_isInSortedList_Before_Asset)

		// Check Bob's ICR is between 110 and TCR
		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gt(mv._MCR) && bob_ICR_Asset.lt(await th.getTCR(contracts.core, erc20.address)))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// Check Bob's Vessel is closed after liquidation

		const bob_VesselStatus_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_After_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_After_Asset, 3)
		assert.isFalse(bob_Vessel_isInSortedList_After_Asset)

		// check Bob’s collateral surplus

		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)
		// can claim collateral

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)
	})

	it("liquidate(), with 110% < ICR < TCR, and StabilityPool VUSD > debt to liquidate: can liquidate vessels out of order", async () => {
		// taking out 1000 VUSD, CR of 200%
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(202, 16)),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(204, 16)),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: freddy },
		})

		const totalLiquidatedDebt_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset)
			.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: totalLiquidatedDebt_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(totalLiquidatedDebt_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check vessels A-D are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))

		// Liquidate out of ICR order: D, B, C.  Confirm Recovery Mode is active prior to each.
		const liquidationTx_D_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const liquidationTx_B_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const liquidationTx_C_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)

		// Check transactions all succeeded

		assert.isTrue(liquidationTx_D_Asset.receipt.status)
		assert.isTrue(liquidationTx_B_Asset.receipt.status)
		assert.isTrue(liquidationTx_C_Asset.receipt.status)

		// Confirm vessels D, B, C removed

		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Confirm vessels have status 'closed by liquidation' (Status enum element idx 3)

		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
		assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
		assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "3")

		// check collateral surplus

		const dennis_remainingCollateral_Asset = D_coll_Asset.sub(D_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const carol_remainingCollateral_Asset = C_coll_Asset.sub(C_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))

		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, dennis),
			dennis_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, carol),
			carol_remainingCollateral_Asset
		)

		// can claim collateral

		const dennis_balanceBefore_Asset = th.toBN(await erc20.balanceOf(dennis))
		await borrowerOperations.claimCollateral(erc20.address, { from: dennis })
		const dennis_balanceAfter_Asset = th.toBN(await erc20.balanceOf(dennis))
		assert.isTrue(
			dennis_balanceAfter_Asset.eq(dennis_balanceBefore_Asset.add(th.toBN(dennis_remainingCollateral_Asset)))
		)

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)

		const carol_balanceBefore_Asset = th.toBN(await erc20.balanceOf(carol))
		await borrowerOperations.claimCollateral(erc20.address, { from: carol })
		const carol_balanceAfter_Asset = th.toBN(await erc20.balanceOf(carol))
		th.assertIsApproximatelyEqual(
			carol_balanceAfter_Asset,
			carol_balanceBefore_Asset.add(th.toBN(carol_remainingCollateral_Asset))
		)
	})

	/* --- liquidate() applied to vessel with ICR > 110% that has the lowest ICR, and Stability Pool 
  VUSD is LESS THAN the liquidated debt: a non fullfilled liquidation --- */

	it("liquidate(), with ICR > 110%, and StabilityPool VUSD < liquidated debt: Vessel remains active", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(1500, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits 1490 VUSD in the Stability Pool
		await stabilityPool.provideToSP("1490000000000000000000", { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's Vessel is active

		const bob_VesselStatus_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_Before_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_Before_Asset, 1)
		assert.isTrue(bob_Vessel_isInSortedList_Before_Asset)

		// Try to liquidate Bob
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		/* Since the pool only contains 100 VUSD, and Bob's pre-liquidation debt was 250 VUSD,
    expect Bob's vessel to remain untouched, and remain active after liquidation */

		const bob_VesselStatus_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_After_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_After_Asset, 1)
		assert.isTrue(bob_Vessel_isInSortedList_After_Asset)
	})

	it("liquidate(), with ICR > 110%, and StabilityPool VUSD < liquidated debt: Vessel remains in VesselOwners array", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(1500, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits 100 VUSD in the Stability Pool
		await stabilityPool.provideToSP(dec(100, 18), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's Vessel is active

		const bob_VesselStatus_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX]
		const bob_Vessel_isInSortedList_Before_Asset = await sortedVessels.contains(erc20.address, bob)

		assert.equal(bob_VesselStatus_Before_Asset, 1)
		assert.isTrue(bob_Vessel_isInSortedList_Before_Asset)

		// Try to liquidate Bob
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		/* Since the pool only contains 100 VUSD, and Bob's pre-liquidation debt was 250 VUSD,
    expect Bob's vessel to only be partially offset, and remain active after liquidation */

		// Check Bob is in Vessel owners array

		const arrayLength_Asset = (await vesselManager.getVesselOwnersCount(erc20.address)).toNumber()
		let addressFound_Asset = false
		let addressIdx_Asset = 0

		for (let i = 0; i < arrayLength_Asset; i++) {
			const address = (await vesselManager.VesselOwners(erc20.address, i)).toString()
			if (address == bob) {
				addressFound_Asset = true
				addressIdx_Asset = i
			}
		}

		assert.isTrue(addressFound_Asset)

		// Check VesselOwners idx on vessel struct == idx of address found in VesselOwners array
		const idxOnStruct_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_ARRAY_INDEX].toString()
		assert.equal(addressIdx_Asset.toString(), idxOnStruct_Asset)
	})

	it("liquidate(), with ICR > 110%, and StabilityPool VUSD < liquidated debt: nothing happens", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(1500, 18),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits 100 VUSD in the Stability Pool
		await stabilityPool.provideToSP(dec(100, 18), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Try to liquidate Bob
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		/*  Since Bob's debt (250 VUSD) is larger than all VUSD in the Stability Pool, Liquidation won’t happen
    After liquidation, totalStakes snapshot should equal Alice's stake (20 ether) + Dennis stake (2 ether) = 22 ether.
    Since there has been no redistribution, the totalCollateral snapshot should equal the totalStakes snapshot: 22 ether.
    Bob's new coll and stake should remain the same, and the updated totalStakes should still equal 25 ether.
    */
		const bob_Vessel = await vesselManager.Vessels(bob, ZERO_ADDRESS)

		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const bob_DebtAfter_Asset = bob_Vessel_Asset[th.VESSEL_DEBT_INDEX].toString()
		const bob_CollAfter_Asset = bob_Vessel_Asset[th.VESSEL_COLL_INDEX].toString()
		const bob_StakeAfter_Asset = bob_Vessel_Asset[th.VESSEL_STAKE_INDEX].toString()

		th.assertIsApproximatelyEqual(bob_DebtAfter_Asset, B_totalDebt_Asset)
		assert.equal(bob_CollAfter_Asset.toString(), B_coll_Asset)
		assert.equal(bob_StakeAfter_Asset.toString(), B_coll_Asset)

		const totalStakes_After_Asset = (await vesselManager.totalStakes(erc20.address)).toString()
		assert.equal(totalStakes_After_Asset.toString(), A_coll_Asset.add(B_coll_Asset).add(D_coll_Asset))
	})

	it("liquidate(), with ICR > 110%, and StabilityPool VUSD < liquidated debt: updates system shapshots", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(1500, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits 100 VUSD in the Stability Pool
		await stabilityPool.provideToSP(dec(100, 18), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check snapshots before

		const totalStakesSnaphot_Before_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_Before_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		assert.equal(totalStakesSnaphot_Before_Asset, 0)
		assert.equal(totalCollateralSnapshot_Before_Asset, 0)

		// Liquidate Bob, it won’t happen as there are no funds in the SP
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		/* After liquidation, totalStakes snapshot should still equal the total stake: 25 ether
    Since there has been no redistribution, the totalCollateral snapshot should equal the totalStakes snapshot: 25 ether.*/

		const totalStakesSnaphot_After_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_After_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		assert.equal(totalStakesSnaphot_After_Asset, totalStakesSnaphot_Before_Asset)
		assert.equal(totalCollateralSnapshot_After_Asset, totalCollateralSnapshot_Before_Asset)
	})

	it("liquidate(), with ICR > 110%, and StabilityPool VUSD < liquidated debt: causes correct Pool offset and ETH gain, and doesn't redistribute to active vessels", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(1500, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})

		// Alice deposits 100 VUSD in the Stability Pool
		await stabilityPool.provideToSP(dec(100, 18), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Try to liquidate Bob. Shouldn’t happen
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		// check Stability Pool rewards. Nothing happened, so everything should remain the same

		const aliceExpectedDeposit_Asset = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
		const aliceExpectedETHGain_Asset = (await stabilityPool.getDepositorGains(alice))[1][1]

		assert.equal(aliceExpectedDeposit_Asset.toString(), dec(100, 18))
		assert.equal(aliceExpectedETHGain_Asset.toString(), "0")

		/* For this Recovery Mode test case with ICR > 110%, there should be no redistribution of remainder to active Vessels. 
    Redistribution rewards-per-unit-staked should be zero. */

		const L_VUSDDebt_After_Asset = (await vesselManager.L_Debts(erc20.address)).toString()
		const L_ETH_After_Asset = (await vesselManager.L_Colls(erc20.address)).toString()

		assert.equal(L_VUSDDebt_After_Asset, "0")
		assert.equal(L_ETH_After_Asset, "0")
	})

	it("liquidate(), with ICR > 110%, and StabilityPool VUSD < liquidated debt: ICR of non liquidated vessel does not change", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, and Dennis up to 150, resulting in ICRs of 266%.
		// Bob withdraws up to 250 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.
		// Carol withdraws up to debt of 240 VUSD, -> ICR of 250%.

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(1500, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(250, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraVUSDAmount: dec(240, 18),
			extraParams: { from: carol },
		})

		// Alice deposits 100 VUSD in the Stability Pool
		await stabilityPool.provideToSP(dec(100, 18), { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		const bob_ICR_Before_Asset = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
		const carol_ICR_Before_Asset = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const bob_Coll_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bob_Debt_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

		// confirm Bob is last vessel in list, and has >110% ICR

		assert.equal((await sortedVessels.getLast(erc20.address)).toString(), bob)
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gt(mv._MCR))

		// L1: Try to liquidate Bob. Nothing happens
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, bob, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		//Check SP VUSD has been completely emptied
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), dec(100, 18))

		// Check Bob remains active
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))

		// Check Bob's collateral and debt remains the same
		const bob_Coll_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bob_Debt_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]
		assert.isTrue(bob_Coll_After_Asset.eq(bob_Coll_Before_Asset))
		assert.isTrue(bob_Debt_After_Asset.eq(bob_Debt_Before_Asset))

		const bob_ICR_After_Asset = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()

		// check Bob's ICR has not changed
		assert.equal(bob_ICR_After_Asset, bob_ICR_Before_Asset)

		// to compensate borrowing fees
		await debtToken.transfer(bob, toBN(dec(100, 18)).mul(toBN(2)), { from: alice })

		// Remove Bob from system to test Carol's vessel: price rises, Bob closes vessel, price drops to 100 again
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		await borrowerOperations.closeVessel(erc20.address, { from: bob })
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Alice provides another 50 VUSD to pool
		await stabilityPool.provideToSP(dec(50, 18), { from: alice })

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const carol_Coll_Before_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const carol_Debt_Before_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_DEBT_INDEX]

		// Confirm Carol is last vessel in list, and has >110% ICR

		assert.equal(await sortedVessels.getLast(erc20.address), carol)
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gt(mv._MCR))

		// L2: Try to liquidate Carol. Nothing happens
		await assertRevert(vesselManagerOperations.liquidate(erc20.address, carol), "VesselManager: nothing to liquidate")

		//Check SP VUSD has been completely emptied
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), dec(150, 18))

		// Check Carol's collateral and debt remains the same
		const carol_Coll_After_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const carol_Debt_After_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_DEBT_INDEX]

		assert.isTrue(carol_Coll_After_Asset.eq(carol_Coll_Before_Asset))
		assert.isTrue(carol_Debt_After_Asset.eq(carol_Debt_Before_Asset))

		const carol_ICR_After_Asset = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()

		// check Carol's ICR has not changed
		assert.equal(carol_ICR_After_Asset, carol_ICR_Before_Asset)

		//Confirm liquidations have not led to any redistributions to vessels

		const L_VUSDDebt_After_Asset = (await vesselManager.L_Debts(erc20.address)).toString()
		const L_ETH_After_Asset = (await vesselManager.L_Colls(erc20.address)).toString()

		assert.equal(L_VUSDDebt_After_Asset, "0")
		assert.equal(L_ETH_After_Asset, "0")
	})

	it("liquidate() with ICR > 110%, and StabilityPool VUSD < liquidated debt: total liquidated coll and debt is correct", async () => {
		// Whale provides 50 VUSD to the SP
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraVUSDAmount: dec(50, 18),
			extraParams: { from: whale },
		})

		await stabilityPool.provideToSP(dec(50, 18), { from: whale })

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(202, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(204, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check C is in range 110% < ICR < 150%
		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(await th.getTCR(contracts.core, erc20.address)))

		const entireSystemCollBefore_Asset = await vesselManager.getEntireSystemColl(erc20.address)
		const entireSystemDebtBefore_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

		// Try to liquidate Alice
		await assertRevert(vesselManagerOperations.liquidate(erc20.address, alice), "VesselManager: nothing to liquidate")

		// Expect system debt and system coll not reduced

		const entireSystemCollAfter_Asset = await vesselManager.getEntireSystemColl(erc20.address)
		const entireSystemDebtAfter_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

		const changeInEntireSystemColl_Asset = entireSystemCollBefore_Asset.sub(entireSystemCollAfter_Asset)
		const changeInEntireSystemDebt_Asset = entireSystemDebtBefore_Asset.sub(entireSystemDebtAfter_Asset)

		assert.equal(changeInEntireSystemColl_Asset, "0")
		assert.equal(changeInEntireSystemDebt_Asset, "0")
	})

	// ---

	it("liquidate(): Doesn't liquidate undercollateralized vessel if it is the only vessel in the system", async () => {
		// Alice creates a single vessel with 0.62 ETH and a debt of 62 VUSD, and provides 10 VUSD to SP
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: alice },
		})
		await stabilityPool.provideToSP(dec(10, 18), { from: alice })

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Set ETH:USD price to 105
		await priceFeed.setPrice(erc20.address, "105000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const alice_ICR_Asset = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
		assert.equal(alice_ICR_Asset, "1050000000000000000")

		const activeVesselsCount_Before_Asset = await vesselManager.getVesselOwnersCount(erc20.address)

		assert.equal(activeVesselsCount_Before_Asset, 1)

		// Try to liquidate the vessel
		await assertRevert(
			vesselManagerOperations.liquidate(erc20.address, alice, { from: owner }),
			"VesselManager: nothing to liquidate"
		)

		// Check Alice's vessel has not been removed

		const activeVesselsCount_After_Asset = await vesselManager.getVesselOwnersCount(erc20.address)
		assert.equal(activeVesselsCount_After_Asset, 1)

		const alice_isInSortedList_Asset = await sortedVessels.contains(erc20.address, alice)
		assert.isTrue(alice_isInSortedList_Asset)
	})

	it("liquidate(): Liquidates undercollateralized vessel if there are two vessels in the system", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: alice },
		})

		// Alice proves 10 VUSD to SP
		await stabilityPool.provideToSP(dec(10, 18), { from: alice })

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Set ETH:USD price to 105
		await priceFeed.setPrice(erc20.address, "105000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const alice_ICR_Asset = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
		assert.equal(alice_ICR_Asset, "1050000000000000000")

		const activeVesselsCount_Before_Asset = await vesselManager.getVesselOwnersCount(erc20.address)

		assert.equal(activeVesselsCount_Before_Asset, 2)

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

	it("liquidate(): does nothing if vessel has >= 110% ICR and the Stability Pool is empty", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraParams: { from: carol },
		})

		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		const TCR_Before_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		const listSize_Before_Asset = (await sortedVessels.getSize(erc20.address)).toString()

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's ICR > 110%

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gte(mv._MCR))

		// Confirm SP is empty

		const VUSDinSP_Asset = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
		assert.equal(VUSDinSP_Asset, "0")

		// Attempt to liquidate bob
		await assertRevert(vesselManagerOperations.liquidate(erc20.address, bob), "VesselManager: nothing to liquidate")

		// check A, B, C remain active

		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))

		const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		const listSize_After_Asset = (await sortedVessels.getSize(erc20.address)).toString()

		// Check TCR and list size have not changed

		assert.equal(TCR_Before_Asset, TCR_After_Asset)
		assert.equal(listSize_Before_Asset, listSize_After_Asset)
	})

	it("liquidate(): does nothing if vessel ICR >= TCR, and SP covers vessel's debt", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(166, 16)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(154, 16)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(142, 16)),
			extraParams: { from: C },
		})

		// C fills SP with 130 VUSD
		await stabilityPool.provideToSP(dec(130, 18), { from: C })

		await priceFeed.setPrice(erc20.address, dec(150, 18))
		const price = await priceFeed.getPrice(erc20.address)
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, A, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, B, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, C, price)

		assert.isTrue(ICR_A_Asset.gt(TCR_Asset))
		// Try to liquidate A
		await assertRevert(vesselManagerOperations.liquidate(erc20.address, A), "VesselManager: nothing to liquidate")

		// Check liquidation of A does nothing - vessel remains in system

		assert.isTrue(await sortedVessels.contains(erc20.address, A))
		assert.equal(await vesselManager.getVesselStatus(erc20.address, A), 1)

		// Check C, with ICR < TCR, can be liquidated

		assert.isTrue(ICR_C_Asset.lt(TCR_Asset))

		const liqTxC_Asset = await vesselManagerOperations.liquidate(erc20.address, C)
		assert.isTrue(liqTxC_Asset.receipt.status)

		assert.isFalse(await sortedVessels.contains(erc20.address, C))
		assert.equal(await vesselManager.getVesselStatus(erc20.address, C), 3)
	})

	it("liquidate(): reverts if vessel is non-existent", async () => {
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

		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Carol does not have an existing vessel

		assert.equal(await vesselManager.getVesselStatus(erc20.address, carol), 0)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		try {
			const txCarol = await vesselManagerOperations.liquidate(erc20.address, carol)
			assert.isFalse(txCarol.receipt.status)
		} catch (err) {
			assert.include(err.message, "revert")
		}
	})

	it("liquidate(): reverts if vessel has been closed", async () => {
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
			ICR: toBN(dec(133, 16)),
			extraParams: { from: carol },
		})

		assert.isTrue(await sortedVessels.contains(erc20.address, carol))

		// Price drops, Carol ICR falls below MCR
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Carol liquidated, and her vessel is closed

		const txCarol_L1_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txCarol_L1_Asset.receipt.status)

		// Check Carol's vessel is closed by liquidation

		assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		assert.equal(await vesselManager.getVesselStatus(erc20.address, carol), 3)

		try {
		} catch (err) {
			assert.include(err.message, "revert")
		}

		try {
			await vesselManagerOperations.liquidate(erc20.address, carol)
		} catch (err) {
			assert.include(err.message, "revert")
		}
	})

	it("liquidate(): liquidates based on entire/collateral debt (including pending rewards), not raw collateral/debt", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})

		// Defaulter opens with 60 VUSD, 0.6 ETH
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: defaulter_1 },
		})

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const alice_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const bob_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const carol_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		/* Before liquidation: 
    Alice ICR: = (1 * 100 / 50) = 200%
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
    Alice ICR: (1.1 * 100 / 60) = 183.33%
    Bob ICR:(1.1 * 100 / 100.5) =  109.45%
    Carol ICR: (1.1 * 100 ) 100%
    Check Alice is above MCR, Bob below, Carol below. */

		assert.isTrue(alice_ICR_After_Asset.gte(mv._MCR))
		assert.isTrue(bob_ICR_After_Asset.lte(mv._MCR))
		assert.isTrue(carol_ICR_After_Asset.lte(mv._MCR))

		/* Though Bob's true ICR (including pending rewards) is below the MCR, 
    check that Bob's raw coll and debt has not changed, and that his "raw" ICR is above the MCR */
		const bob_Coll = (await vesselManager.Vessels(bob, ZERO_ADDRESS))[th.VESSEL_COLL_INDEX]
		const bob_Debt = (await vesselManager.Vessels(bob, ZERO_ADDRESS))[th.VESSEL_DEBT_INDEX]

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bob_Debt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

		const bob_rawICR_Asset = bob_Coll_Asset.mul(th.toBN(dec(100, 18))).div(bob_Debt_Asset)
		assert.isTrue(bob_rawICR_Asset.gte(mv._MCR))

		//liquidate A, B, C

		await assertRevert(vesselManagerOperations.liquidate(erc20.address, alice), "VesselManager: nothing to liquidate")
		await vesselManagerOperations.liquidate(erc20.address, bob)
		await vesselManagerOperations.liquidate(erc20.address, carol)

		/*  Since there is 0 VUSD in the stability Pool, A, with ICR >110%, should stay active.
    Check Alice stays active, Carol gets liquidated, and Bob gets liquidated 
    (because his pending rewards bring his ICR < MCR) */

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// check vessel statuses - A active (1), B and C liquidated (3)

		assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
		assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
		assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
	})

	it("liquidate(): does not affect the SP deposit or ETH gain when called on an SP depositor's address that has no vessel", async () => {
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})
		const spDeposit_Asset = C_totalDebt_Asset.add(toBN(dec(1000, 18)))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: bob },
		})

		// Bob sends tokens to Dennis, who has no vessel
		await debtToken.transfer(dennis, spDeposit_Asset, { from: bob })

		//Dennis provides 200 VUSD to SP
		await stabilityPool.provideToSP(spDeposit_Asset, { from: dennis })

		// Price drop
		await priceFeed.setPrice(erc20.address, dec(105, 18))

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Carol gets liquidated
		await vesselManagerOperations.liquidate(erc20.address, carol)

		// Check Dennis' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH

		const dennis_Deposit_Before_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString()
		const dennis_ETHGain_Before_Asset = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()
		assert.isAtMost(th.getDifference(dennis_Deposit_Before_Asset, spDeposit_Asset.sub(C_totalDebt_Asset)), 1000)
		assert.isAtMost(th.getDifference(dennis_ETHGain_Before_Asset, th.applyLiquidationFee(C_coll_Asset)), 1000)

		// Attempt to liquidate Dennis

		try {
			await vesselManagerOperations.liquidate(erc20.address, dennis)
		} catch (err) {
			assert.include(err.message, "revert")
		}

		// Check Dennis' SP deposit does not change after liquidation attempt

		const dennis_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString()
		const dennis_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()
		assert.equal(dennis_Deposit_Before_Asset, dennis_Deposit_After_Asset)
		assert.equal(dennis_ETHGain_Before_Asset, dennis_ETHGain_After_Asset)
	})

	it("liquidate(): does not alter the liquidated user's token balance", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: dec(1000, 18),
			extraParams: { from: whale },
		})

		const { VUSDAmount: A_VUSDAmount_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(300, 18),
			extraParams: { from: alice },
		})
		const { VUSDAmount: B_VUSDAmount_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(200, 18),
			extraParams: { from: bob },
		})
		const { VUSDAmount: C_VUSDAmount_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: carol },
		})

		await priceFeed.setPrice(erc20.address, dec(105, 18))

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check token balances
		assert.equal((await debtToken.balanceOf(alice)).toString(), A_VUSDAmount_Asset)
		assert.equal((await debtToken.balanceOf(bob)).toString(), B_VUSDAmount_Asset)

		assert.equal((await debtToken.balanceOf(carol)).toString(), C_VUSDAmount_Asset)

		// Check sortedList size is 4
		assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

		// Liquidate A, B and C

		await vesselManagerOperations.liquidate(erc20.address, alice)
		await vesselManagerOperations.liquidate(erc20.address, bob)
		await vesselManagerOperations.liquidate(erc20.address, carol)

		// Confirm A, B, C closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Check sortedList size reduced to 1
		assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "1")

		// Confirm token balances have not changed
		assert.equal((await debtToken.balanceOf(alice)).toString(), A_VUSDAmount_Asset)
		assert.equal((await debtToken.balanceOf(bob)).toString(), B_VUSDAmount_Asset)
		assert.equal((await debtToken.balanceOf(carol)).toString(), C_VUSDAmount_Asset)
	})

	it("liquidate(), with 110% < ICR < TCR, can claim collateral, re-open, be reedemed and claim again", async () => {
		// --- SETUP ---
		// Alice withdraws up to 1500 VUSD of debt, resulting in ICRs of 266%.
		// Bob withdraws up to 480 VUSD of debt, resulting in ICR of 240%. Bob has lowest ICR.

		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: dec(480, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_Asset,
			extraParams: { from: alice },
		})

		// Alice deposits VUSD in the Stability Pool
		await stabilityPool.provideToSP(B_totalDebt_Asset, { from: alice })

		// --- TEST ---
		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		let price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's ICR is between 110 and TCR

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gt(mv._MCR) && bob_ICR_Asset.lt(TCR_Asset))

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// check Bob’s collateral surplus: 5.76 * 100 - 480 * 1.1

		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)
		// can claim collateral

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)

		// skip bootstrapping phase
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

		// Bob re-opens the vessel, price 200, total debt 80 VUSD, ICR = 120% (lowest one)
		// Dennis redeems 30, so Bob has a surplus of (200 * 0.48 - 30) / 200 = 0.33 ETH
		await priceFeed.setPrice(erc20.address, "200000000000000000000")

		const { collateral: B_coll_2_Asset, netDebt: B_netDebt_2_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: bob_remainingCollateral_Asset,
			ICR: toBN(dec(150, 16)),
			extraVUSDAmount: dec(480, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_netDebt_2_Asset,
			extraParams: { from: dennis },
		})

		await th.redeemCollateral(dennis, contracts.core, B_netDebt_2_Asset, erc20.address)

		price = await priceFeed.getPrice(erc20.address)

		const bob_surplus_Asset = B_coll_2_Asset.sub(calcSoftnedAmount(B_netDebt_2_Asset, price))
		th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(erc20.address, bob), bob_surplus_Asset)

		// can claim collateral
		const bob_balanceBefore_2_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_2_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(bob_balanceAfter_2_Asset, bob_balanceBefore_2_Asset.add(th.toBN(bob_surplus_Asset)))
	})

	it("liquidate(), with 110% < ICR < TCR, can claim collateral, after another claim from a redemption", async () => {
		// --- SETUP ---
		// Bob withdraws up to 90 VUSD of debt, resulting in ICR of 222%
		// Dennis withdraws to 150 VUSD of debt, resulting in ICRs of 266%.

		const { collateral: B_coll_Asset, netDebt: B_netDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraVUSDAmount: dec(90, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_netDebt_Asset,
			extraParams: { from: dennis },
		})

		// --- TEST ---
		// skip bootstrapping phase
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

		// Dennis redeems 40, so Bob has a surplus of (200 * 1 - 40) / 200 = 0.8 ETH
		await th.redeemCollateral(dennis, contracts.core, B_netDebt_Asset, erc20.address)
		let price = await priceFeed.getPrice(erc20.address)

		const bob_surplus_Asset = B_coll_Asset.sub(calcSoftnedAmount(B_netDebt_Asset, price))
		th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(erc20.address, bob), bob_surplus_Asset)

		// can claim collateral

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(bob_balanceAfter_Asset, bob_balanceBefore_Asset.add(bob_surplus_Asset))

		// Bob re-opens the vessel, price 200, total debt 250 VUSD, ICR = 240% (lowest one)
		const { collateral: B_coll_2_Asset, totalDebt: B_totalDebt_2_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: _3_Ether,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: bob },
		})
		// Alice deposits VUSD in the Stability Pool

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraVUSDAmount: B_totalDebt_2_Asset,
			extraParams: { from: alice },
		})
		await stabilityPool.provideToSP(B_totalDebt_2_Asset, { from: alice })

		// price drops to 1ETH:100VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "100000000000000000000")
		price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check Bob's ICR is between 110 and TCR

		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		assert.isTrue(bob_ICR_Asset.gt(mv._MCR) && bob_ICR_Asset.lt(TCR_Asset))
		// debt is increased by fee, due to previous redemption
		const bob_debt_Asset = await vesselManager.getVesselDebt(erc20.address, bob)

		// Liquidate Bob
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: owner })

		// check Bob’s collateral surplus

		const bob_remainingCollateral_Asset = B_coll_2_Asset.sub(B_totalDebt_2_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			(await collSurplusPool.getCollateral(erc20.address, bob)).toString(),
			bob_remainingCollateral_Asset.toString()
		)

		// can claim collateral
		const bob_balanceBefore_2_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_2_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_2_Asset,
			bob_balanceBefore_2_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)
	})

	// --- liquidateVessels ---

	it("liquidateVessels(): With all ICRs > 110%, Liquidates Vessels until system leaves recovery mode", async () => {
		// make 8 Vessels accordingly
		// --- SETUP ---

		// Everyone withdraws some VUSD from their Vessel, resulting in different ICRs

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(350, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(286, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(273, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(261, 16)),
			extraParams: { from: erin },
		})
		const { totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: freddy },
		})
		const { totalDebt: G_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(235, 16)),
			extraParams: { from: greta },
		})
		const { totalDebt: H_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraVUSDAmount: dec(5000, 18),
			extraParams: { from: harry },
		})
		const liquidationAmount_Asset = E_totalDebt_Asset.add(F_totalDebt_Asset)
			.add(G_totalDebt_Asset)
			.add(H_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraVUSDAmount: liquidationAmount_Asset,
			extraParams: { from: alice },
		})

		// Alice deposits VUSD to Stability Pool
		await stabilityPool.provideToSP(liquidationAmount_Asset, { from: alice })

		// price drops
		// price drops to 1ETH:90VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "90000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check TCR < 150%
		const _150percent = web3.utils.toBN("1500000000000000000")

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_Before_Asset.lt(_150percent))

		/* 
   After the price drop and prior to any liquidations, ICR should be:
    Vessel         ICR
    Alice       161%
    Bob         158%
    Carol       129%
    Dennis      123%
    Elisa       117%
    Freddy      113%
    Greta       106%
    Harry       100%
    */

		const alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const dennis_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const erin_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)
		const freddy_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, freddy, price)
		const greta_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, greta, price)
		const harry_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, harry, price)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Alice and Bob should have ICR > TCR
		assert.isTrue(alice_ICR_Asset.gt(TCR_Asset))
		assert.isTrue(bob_ICR_Asset.gt(TCR_Asset))

		// All other Vessels should have ICR < TCR

		assert.isTrue(carol_ICR_Asset.lt(TCR_Asset))
		assert.isTrue(dennis_ICR_Asset.lt(TCR_Asset))
		assert.isTrue(erin_ICR_Asset.lt(TCR_Asset))
		assert.isTrue(freddy_ICR_Asset.lt(TCR_Asset))
		assert.isTrue(greta_ICR_Asset.lt(TCR_Asset))
		assert.isTrue(harry_ICR_Asset.lt(TCR_Asset))

		/* Liquidations should occur from the lowest ICR Vessel upwards, i.e. 
    1) Harry, 2) Greta, 3) Freddy, etc.
      Vessel         ICR
    Alice       161%
    Bob         158%
    Carol       129%
    Dennis      123%
    ---- CUTOFF ----
    Elisa       117%
    Freddy      113%
    Greta       106%
    Harry       100%
    If all Vessels below the cutoff are liquidated, the TCR of the system rises above the CCR, to 152%.  (see calculations in Google Sheet)
    Thus, after liquidateVessels(), expect all Vessels to be liquidated up to the cut-off.  
    
    Only Alice, Bob, Carol and Dennis should remain active - all others should be closed. */

		// call liquidate Vessels
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		// check system is no longer in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// After liquidation, TCR should rise to above 150%.
		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_After_Asset.gt(_150percent))

		// get all Vessels

		const alice_Vessel_Asset = await vesselManager.Vessels(alice, erc20.address)
		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const carol_Vessel_Asset = await vesselManager.Vessels(carol, erc20.address)
		const dennis_Vessel_Asset = await vesselManager.Vessels(dennis, erc20.address)
		const erin_Vessel_Asset = await vesselManager.Vessels(erin, erc20.address)
		const freddy_Vessel_Asset = await vesselManager.Vessels(freddy, erc20.address)
		const greta_Vessel_Asset = await vesselManager.Vessels(greta, erc20.address)
		const harry_Vessel_Asset = await vesselManager.Vessels(harry, erc20.address)

		// check that Alice, Bob, Carol, & Dennis' Vessels remain active

		assert.equal(alice_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.equal(bob_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.equal(carol_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.equal(dennis_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, dennis))

		// check all other Vessels are liquidated

		assert.equal(erin_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(freddy_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(greta_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(harry_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
		assert.isFalse(await sortedVessels.contains(erc20.address, greta))
		assert.isFalse(await sortedVessels.contains(erc20.address, harry))
	})

	it("liquidateVessels(): Liquidates Vessels until 1) system has left recovery mode AND 2) it reaches a Vessel with ICR >= 110%", async () => {
		// make 6 Vessels accordingly
		// --- SETUP ---

		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(230, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: erin },
		})
		const { totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: freddy },
		})

		const liquidationAmount_Asset = B_totalDebt_Asset.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(E_totalDebt_Asset)
			.add(F_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraVUSDAmount: liquidationAmount_Asset,
			extraParams: { from: alice },
		})

		// Alice deposits VUSD to Stability Pool
		await stabilityPool.provideToSP(liquidationAmount_Asset, { from: alice })

		// price drops to 1ETH:85VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "85000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		// check Recovery Mode kicks in

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check TCR < 150%
		const _150percent = web3.utils.toBN("1500000000000000000")

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_Before_Asset.lt(_150percent))

		/* 
   After the price drop and prior to any liquidations, ICR should be:
    Vessel         ICR
    Alice       182%
    Bob         102%
    Carol       102%
    Dennis      102%
    Elisa       102%
    Freddy      102%
    */

		alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		dennis_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		erin_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)
		freddy_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, freddy, price)

		// Alice should have ICR > 150%
		assert.isTrue(alice_ICR_Asset.gt(_150percent))
		// All other Vessels should have ICR < 150%
		assert.isTrue(carol_ICR_Asset.lt(_150percent))
		assert.isTrue(dennis_ICR_Asset.lt(_150percent))
		assert.isTrue(erin_ICR_Asset.lt(_150percent))
		assert.isTrue(freddy_ICR_Asset.lt(_150percent))

		/* Liquidations should occur from the lowest ICR Vessel upwards, i.e. 
    1) Freddy, 2) Elisa, 3) Dennis.
    After liquidating Freddy and Elisa, the the TCR of the system rises above the CCR, to 154%.  
   (see calculations in Google Sheet)
    Liquidations continue until all Vessels with ICR < MCR have been closed. 
    Only Alice should remain active - all others should be closed. */

		// call liquidate Vessels
		await vesselManagerOperations.liquidateVessels(erc20.address, 6)

		// check system is no longer in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// After liquidation, TCR should rise to above 150%.

		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_After_Asset.gt(_150percent))

		// get all Vessels
		const alice_Vessel_Asset = await vesselManager.Vessels(alice, erc20.address)
		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const carol_Vessel_Asset = await vesselManager.Vessels(carol, erc20.address)
		const dennis_Vessel_Asset = await vesselManager.Vessels(dennis, erc20.address)
		const erin_Vessel_Asset = await vesselManager.Vessels(erin, erc20.address)
		const freddy_Vessel_Asset = await vesselManager.Vessels(freddy, erc20.address)

		// check that Alice's Vessel remains active

		assert.equal(alice_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.isTrue(await sortedVessels.contains(erc20.address, alice))

		// check all other Vessels are liquidated

		assert.equal(bob_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(carol_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(dennis_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(erin_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(freddy_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)

		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
	})

	it("liquidateVessels(): liquidates only up to the requested number of undercollateralized vessels", async () => {
		await openVessel({
			asset: erc20.address,
			assetSent: dec(300, "ether"),
			ICR: toBN(dec(300, 16)),
			extraParams: { from: whale },
		})

		// --- SETUP ---
		// Alice, Bob, Carol, Dennis, Erin open vessels with consecutively increasing collateral ratio
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(214, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(216, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(218, 16)),
			extraParams: { from: erin },
		})

		await priceFeed.setPrice(erc20.address, dec(100, 18))

		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		assert.isTrue(TCR_Asset.lte(web3.utils.toBN(dec(150, 18))))
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// --- TEST ---

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		await vesselManagerOperations.liquidateVessels(erc20.address, 3)

		// Check system still in Recovery Mode after liquidation tx
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.equal(await vesselManager.getVesselOwnersCount(erc20.address), "3")

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

	it("liquidateVessels(): does nothing if n = 0", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(200, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(300, 18),
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

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Liquidation with n = 0
		await assertRevert(
			vesselManagerOperations.liquidateVessels(erc20.address, 0),
			"VesselManager: nothing to liquidate"
		)

		// Check all vessels are still in the system

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))

		const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()

		// Check TCR has not changed after liquidation
		assert.equal(TCR_Before_Asset, TCR_After_Asset)
	})

	it("liquidateVessels(): closes every Vessel with ICR < MCR, when n > number of undercollateralized vessels", async () => {
		// --- SETUP ---
		await openVessel({
			asset: erc20.address,
			assetSent: dec(300, "ether"),
			ICR: toBN(dec(300, 16)),
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
			ICR: toBN(dec(133, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(300, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(182, 16)),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(111, 16)),
			extraParams: { from: freddy },
		})

		// Whale puts some tokens in Stability Pool
		await stabilityPool.provideToSP(dec(300, 18), { from: whale })

		// --- TEST ---

		// Price drops to 1ETH:100VUSD, reducing Bob and Carol's ICR below MCR
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Confirm vessels A-E are ICR < 110%

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).lte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, freddy, price)).lte(mv._MCR))

		// Confirm Whale is ICR > 110%
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, whale, price)).gte(mv._MCR))

		// Liquidate 5 vessels
		await vesselManagerOperations.liquidateVessels(erc20.address, 5)

		// Confirm vessels A-E have been removed from the system

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))

		// Check all vessels are now liquidated

		assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
		assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
		assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
		assert.equal((await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
		assert.equal((await vesselManager.Vessels(freddy, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
	})

	it("liquidateVessels(): a liquidation sequence containing Pool offsets increases the TCR", async () => {
		// Whale provides 500 VUSD to SP
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(500, 18),
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(dec(500, 18), { from: whale })

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(320, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(340, 16)),
			extraParams: { from: dennis },
		})

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraVUSDAmount: dec(101, 18),
			extraParams: { from: defaulter_1 },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(184, 16)),
			extraVUSDAmount: dec(217, 18),
			extraParams: { from: defaulter_2 },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(183, 16)),
			extraVUSDAmount: dec(328, 18),
			extraParams: { from: defaulter_3 },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(186, 16)),
			extraVUSDAmount: dec(431, 18),
			extraParams: { from: defaulter_4 },
		})

		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(110, 18))
		const price = await priceFeed.getPrice(erc20.address)

		assert.isTrue(await th.ICRbetween100and110(defaulter_1, vesselManager, price, erc20.address))
		assert.isTrue(await th.ICRbetween100and110(defaulter_2, vesselManager, price, erc20.address))
		assert.isTrue(await th.ICRbetween100and110(defaulter_3, vesselManager, price, erc20.address))
		assert.isTrue(await th.ICRbetween100and110(defaulter_4, vesselManager, price, erc20.address))

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Stability Pool has 500 VUSD
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), dec(500, 18))

		await vesselManagerOperations.liquidateVessels(erc20.address, 8)

		assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))

		// Check Stability Pool has been emptied by the liquidations
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), "0")

		// Check that the liquidation sequence has improved the TCR

		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_After_Asset.gte(TCR_Before_Asset))
	})

	it("liquidateVessels(): a liquidation sequence of pure redistributions decreases the TCR, due to gas compensation, but up to 0.5%", async () => {
		const { collateral: W_coll_Asset, totalDebt: W_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraVUSDAmount: dec(500, 18),
			extraParams: { from: whale },
		})
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraParams: { from: alice },
		})
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(600, 16)),
			extraParams: { from: dennis },
		})
		const { collateral: d1_coll_Asset, totalDebt: d1_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraVUSDAmount: dec(101, 18),
			extraParams: { from: defaulter_1 },
		})
		const { collateral: d2_coll_Asset, totalDebt: d2_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(184, 16)),
			extraVUSDAmount: dec(217, 18),
			extraParams: { from: defaulter_2 },
		})
		const { collateral: d3_coll_Asset, totalDebt: d3_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(183, 16)),
			extraVUSDAmount: dec(328, 18),
			extraParams: { from: defaulter_3 },
		})
		const { collateral: d4_coll_Asset, totalDebt: d4_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(166, 16)),
			extraVUSDAmount: dec(431, 18),
			extraParams: { from: defaulter_4 },
		})

		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))
		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))
		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_3))
		assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_4))

		// Price drops
		const price = toBN(dec(100, 18))
		await priceFeed.setPrice(erc20.address, price)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
		// (5+1+2+3+1+2+3+4)*100/(410+50+50+50+101+257+328+480)

		const totalCollBefore_Asset = W_coll_Asset.add(A_coll_Asset)
			.add(C_coll_Asset)
			.add(D_coll_Asset)
			.add(d1_coll_Asset)
			.add(d2_coll_Asset)
			.add(d3_coll_Asset)
			.add(d4_coll_Asset)
		const totalDebtBefore_Asset = W_totalDebt_Asset.add(A_totalDebt_Asset)
			.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(d1_totalDebt_Asset)
			.add(d2_totalDebt_Asset)
			.add(d3_totalDebt_Asset)
			.add(d4_totalDebt_Asset)
		assert.isAtMost(
			th.getDifference(TCR_Before_Asset, totalCollBefore_Asset.mul(price).div(totalDebtBefore_Asset)),
			1000
		)

		// Check pool is empty before liquidation
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), "0")

		// Liquidate
		await vesselManagerOperations.liquidateVessels(erc20.address, 8)

		// Check all defaulters have been liquidated

		assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
		assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))
		assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))
		assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_4))

		// Check that the liquidation sequence has reduced the TCR
		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		// ((5+1+2+3)+(1+2+3+4)*0.995)*100/(410+50+50+50+101+257+328+480)
		const totalCollAfter_Asset = W_coll_Asset.add(A_coll_Asset)
			.add(C_coll_Asset)
			.add(D_coll_Asset)
			.add(th.applyLiquidationFee(d1_coll_Asset.add(d2_coll_Asset).add(d3_coll_Asset).add(d4_coll_Asset)))
		const totalDebtAfter_Asset = W_totalDebt_Asset.add(A_totalDebt_Asset)
			.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(d1_totalDebt_Asset)
			.add(d2_totalDebt_Asset)
			.add(d3_totalDebt_Asset)
			.add(d4_totalDebt_Asset)

		assert.isAtMost(th.getDifference(TCR_After_Asset, totalCollAfter_Asset.mul(price).div(totalDebtAfter_Asset)), 1000)
		assert.isTrue(TCR_Before_Asset.gte(TCR_After_Asset))
		assert.isTrue(TCR_After_Asset.gte(TCR_Before_Asset.mul(th.toBN(995)).div(th.toBN(1000))))
	})

	it("liquidateVessels(): liquidates based on entire/collateral debt (including pending rewards), not raw collateral/debt", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})

		// Defaulter opens with 60 VUSD, 0.6 ETH
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: defaulter_1 },
		})

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const alice_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const bob_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const carol_ICR_Before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		/* Before liquidation: 
    Alice ICR: = (1 * 100 / 50) = 200%
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
    Alice ICR: (1.1 * 100 / 60) = 183.33%
    Bob ICR:(1.1 * 100 / 100.5) =  109.45%
    Carol ICR: (1.1 * 100 ) 100%
    Check Alice is above MCR, Bob below, Carol below. */

		assert.isTrue(alice_ICR_After_Asset.gte(mv._MCR))
		assert.isTrue(bob_ICR_After_Asset.lte(mv._MCR))
		assert.isTrue(carol_ICR_After_Asset.lte(mv._MCR))

		/* Though Bob's true ICR (including pending rewards) is below the MCR, 
   check that Bob's raw coll and debt has not changed, and that his "raw" ICR is above the MCR */
		const bob_Coll = (await vesselManager.Vessels(bob, ZERO_ADDRESS))[th.VESSEL_COLL_INDEX]
		const bob_Debt = (await vesselManager.Vessels(bob, ZERO_ADDRESS))[th.VESSEL_DEBT_INDEX]

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bob_Debt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

		const bob_rawICR_Asset = bob_Coll_Asset.mul(th.toBN(dec(100, 18))).div(bob_Debt_Asset)
		assert.isTrue(bob_rawICR_Asset.gte(mv._MCR))

		// Liquidate A, B, C
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		/*  Since there is 0 VUSD in the stability Pool, A, with ICR >110%, should stay active.
   Check Alice stays active, Carol gets liquidated, and Bob gets liquidated 
   (because his pending rewards bring his ICR < MCR) */

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// check vessel statuses - A active (1),  B and C liquidated (3)

		assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1")
		assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
		assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "3")
	})

	it("liquidateVessels(): does nothing if all vessels have ICR > 110% and Stability Pool is empty", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraParams: { from: carol },
		})

		// Price drops, but all vessels remain active
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))

		const TCR_Before_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		const listSize_Before_Asset = (await sortedVessels.getSize(erc20.address)).toString()

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gte(mv._MCR))

		// Confirm 0 VUSD in Stability Pool
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), "0")

		// Attempt liqudation sequence
		await assertRevert(
			vesselManagerOperations.liquidateVessels(erc20.address, 10),
			"VesselManager: nothing to liquidate"
		)

		// Check all vessels remain active

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))

		const TCR_After_Asset = (await th.getTCR(contracts.core, erc20.address)).toString()
		const listSize_After_Asset = (await sortedVessels.getSize(erc20.address)).toString()

		assert.equal(TCR_Before_Asset, TCR_After_Asset)
		assert.equal(listSize_Before_Asset, listSize_After_Asset)
	})

	it("liquidateVessels(): emits liquidation event with correct values when all vessels have ICR > 110% and Stability Pool covers a subset of vessels", async () => {
		// Vessels to be absorbed by SP

		const { collateral: F_coll_Asset, totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: freddy },
		})
		const { collateral: G_coll_Asset, totalDebt: G_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: greta },
		})

		// Vessels to be spared
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(308, 16)),
			extraParams: { from: dennis },
		})

		// Whale adds VUSD to SP
		const spDeposit_Asset = F_totalDebt_Asset.add(G_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops, but all vessels remain active
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Confirm all vessels have ICR > MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, freddy, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, greta, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gte(mv._MCR))

		// Confirm VUSD in Stability Pool
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), spDeposit_Asset.toString())

		// Attempt liqudation sequence

		const liquidationTx_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 10)
		const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

		// Check F and G were liquidated

		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
		assert.isFalse(await sortedVessels.contains(erc20.address, greta))

		// Check whale and A-D remain active

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
		assert.isTrue(await sortedVessels.contains(erc20.address, whale))

		// Liquidation event emits coll = (F_debt + G_debt)/price*1.1*0.995, and debt = (F_debt + G_debt)

		th.assertIsApproximatelyEqual(liquidatedDebt_Asset, F_totalDebt_Asset.add(G_totalDebt_Asset))
		th.assertIsApproximatelyEqual(
			liquidatedColl_Asset,
			th.applyLiquidationFee(
				F_totalDebt_Asset.add(G_totalDebt_Asset)
					.mul(toBN(dec(11, 17)))
					.div(price)
			)
		)

		// check collateral surplus
		const freddy_remainingCollateral_Asset = F_coll_Asset.sub(F_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const greta_remainingCollateral_Asset = G_coll_Asset.sub(G_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, freddy),
			freddy_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, greta),
			greta_remainingCollateral_Asset
		)

		// can claim collateral
		const freddy_balanceBefore_Asset = th.toBN(await erc20.balanceOf(freddy))
		await borrowerOperations.claimCollateral(erc20.address, { from: freddy })
		const freddy_balanceAfter_Asset = th.toBN(await erc20.balanceOf(freddy))
		th.assertIsApproximatelyEqual(
			freddy_balanceAfter_Asset,
			freddy_balanceBefore_Asset.add(th.toBN(freddy_remainingCollateral_Asset))
		)

		const greta_balanceBefore_Asset = th.toBN(await erc20.balanceOf(greta))
		await borrowerOperations.claimCollateral(erc20.address, { from: greta })
		const greta_balanceAfter_Asset = th.toBN(await erc20.balanceOf(greta))
		th.assertIsApproximatelyEqual(
			greta_balanceAfter_Asset,
			greta_balanceBefore_Asset.add(th.toBN(greta_remainingCollateral_Asset))
		)
	})

	it("liquidateVessels(): emits liquidation event with correct values when all vessels have ICR > 110% and Stability Pool covers a subset of vessels, including a partial", async () => {
		// Vessels to be absorbed by SP

		const { collateral: F_coll_Asset, totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: freddy },
		})
		const { collateral: G_coll_Asset, totalDebt: G_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: greta },
		})

		// Vessels to be spared
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(308, 16)),
			extraParams: { from: dennis },
		})

		// Whale adds VUSD to SP
		const spDeposit_Asset = F_totalDebt_Asset.add(G_totalDebt_Asset).add(A_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops, but all vessels remain active
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Confirm all vessels have ICR > MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, freddy, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, greta, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gte(mv._MCR))

		// Confirm VUSD in Stability Pool
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), spDeposit_Asset.toString())

		// Attempt liqudation sequence

		const liquidationTx_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 10)
		const [liquidatedDebt_Asset, liquidatedColl_Asset] = th.getEmittedLiquidationValues(liquidationTx_Asset)

		// Check F and G were liquidated

		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
		assert.isFalse(await sortedVessels.contains(erc20.address, greta))

		// Check whale and A-D remain active

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
		assert.isTrue(await sortedVessels.contains(erc20.address, whale))

		// Check A's collateral and debt remain the same

		const entireColl_A_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX].add(
			await vesselManager.getPendingAssetReward(erc20.address, alice)
		)
		const entireDebt_A_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX].add(
			await vesselManager.getPendingDebtTokenReward(erc20.address, alice)
		)

		assert.equal(entireColl_A_Asset.toString(), A_coll_Asset)
		assert.equal(entireDebt_A_Asset.toString(), A_totalDebt_Asset)

		/* Liquidation event emits:
    coll = (F_debt + G_debt)/price*1.1*0.995
    debt = (F_debt + G_debt) */

		th.assertIsApproximatelyEqual(liquidatedDebt_Asset, F_totalDebt_Asset.add(G_totalDebt_Asset))
		th.assertIsApproximatelyEqual(
			liquidatedColl_Asset,
			th.applyLiquidationFee(
				F_totalDebt_Asset.add(G_totalDebt_Asset)
					.mul(toBN(dec(11, 17)))
					.div(price)
			)
		)

		// check collateral surplus

		const freddy_remainingCollateral_Asset = F_coll_Asset.sub(F_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const greta_remainingCollateral_Asset = G_coll_Asset.sub(G_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))

		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, freddy),
			freddy_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, greta),
			greta_remainingCollateral_Asset
		)

		// can claim collateral

		const freddy_balanceBefore_Asset = th.toBN(await erc20.balanceOf(freddy))
		await borrowerOperations.claimCollateral(erc20.address, { from: freddy })
		const freddy_balanceAfter_Asset = th.toBN(await erc20.balanceOf(freddy))
		th.assertIsApproximatelyEqual(
			freddy_balanceAfter_Asset,
			freddy_balanceBefore_Asset.add(th.toBN(freddy_remainingCollateral_Asset))
		)

		const greta_balanceBefore_Asset = th.toBN(await erc20.balanceOf(greta))
		await borrowerOperations.claimCollateral(erc20.address, { from: greta })
		const greta_balanceAfter_Asset = th.toBN(await erc20.balanceOf(greta))
		th.assertIsApproximatelyEqual(
			greta_balanceAfter_Asset,
			greta_balanceBefore_Asset.add(th.toBN(greta_remainingCollateral_Asset))
		)
	})

	it("liquidateVessels(): does not affect the liquidated user's token balances", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraParams: { from: whale },
		})

		// D, E, F open vessels that will fall below MCR when price drops to 100

		const { VUSDAmount: VUSDAmountD_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: dennis },
		})
		const { VUSDAmount: VUSDAmountE_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(133, 16)),
			extraParams: { from: erin },
		})
		const { VUSDAmount: VUSDAmountF_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(111, 16)),
			extraParams: { from: freddy },
		})

		// Check list size is 4
		assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

		// Check token balances before
		assert.equal((await debtToken.balanceOf(dennis)).toString(), VUSDAmountD_Asset)
		assert.equal((await debtToken.balanceOf(erin)).toString(), VUSDAmountE_Asset)
		assert.equal((await debtToken.balanceOf(freddy)).toString(), VUSDAmountF_Asset)

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		//Liquidate sequence
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		// Check Whale remains in the system
		assert.isTrue(await sortedVessels.contains(erc20.address, whale))

		// Check D, E, F have been removed

		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))

		// Check token balances of users whose vessels were liquidated, have not changed
		assert.equal((await debtToken.balanceOf(dennis)).toString(), VUSDAmountD_Asset)
		assert.equal((await debtToken.balanceOf(erin)).toString(), VUSDAmountE_Asset)
		assert.equal((await debtToken.balanceOf(freddy)).toString(), VUSDAmountF_Asset)
	})

	it("liquidateVessels(): Liquidating vessels at 100 < ICR < 110 with SP deposits correctly impacts their SP deposit and ETH gain", async () => {
		// Whale provides VUSD to the SP
		const { VUSDAmount: W_VUSDAmount_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraVUSDAmount: dec(4000, 18),
			extraParams: { from: whale },
		})

		await stabilityPool.provideToSP(W_VUSDAmount_Asset, { from: whale })

		const {
			VUSDAmount: A_VUSDAmount_Asset,
			totalDebt: A_totalDebt_Asset,
			collateral: A_coll_Asset,
		} = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(191, 16)),
			extraVUSDAmount: dec(40, 18),
			extraParams: { from: alice },
		})
		const {
			VUSDAmount: B_VUSDAmount_Asset,
			totalDebt: B_totalDebt_Asset,
			collateral: B_coll_Asset,
		} = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(240, 18),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset, collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(209, 16)),
			extraParams: { from: carol },
		})

		// A, B provide to the SP
		await stabilityPool.provideToSP(A_VUSDAmount_Asset, { from: alice })
		await stabilityPool.provideToSP(B_VUSDAmount_Asset, { from: bob })

		const totalDeposit_Asset = W_VUSDAmount_Asset.add(A_VUSDAmount_Asset).add(B_VUSDAmount_Asset)

		assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(105, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check VUSD in Pool
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), totalDeposit_Asset)

		// *** Check A, B, C ICRs 100<ICR<110

		const alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(alice_ICR_Asset.gte(mv._ICR100) && alice_ICR_Asset.lte(mv._MCR))
		assert.isTrue(bob_ICR_Asset.gte(mv._ICR100) && bob_ICR_Asset.lte(mv._MCR))
		assert.isTrue(carol_ICR_Asset.gte(mv._ICR100) && carol_ICR_Asset.lte(mv._MCR))

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
    Alice:  40 VUSD
    Bob:   240 VUSD
    Carol: 0 VUSD
    Total VUSD in Pool: 680 VUSD
    Then, liquidation hits A,B,C: 
    Total liquidated debt = 100 + 300 + 100 = 500 VUSD
    Total liquidated ETH = 1 + 3 + 1 = 5 ETH
    Whale VUSD Loss: 500 * (400/680) = 294.12 VUSD
    Alice VUSD Loss:  500 *(40/680) = 29.41 VUSD
    Bob VUSD Loss: 500 * (240/680) = 176.47 VUSD
    Whale remaining deposit: (400 - 294.12) = 105.88 VUSD
    Alice remaining deposit: (40 - 29.41) = 10.59 VUSD
    Bob remaining deposit: (240 - 176.47) = 63.53 VUSD
    Whale ETH Gain: 5*0.995 * (400/680) = 2.93 ETH
    Alice ETH Gain: 5*0.995 *(40/680) = 0.293 ETH
    Bob ETH Gain: 5*0.995 * (240/680) = 1.76 ETH
    Total remaining deposits: 180 VUSD
    Total ETH gain: 5*0.995 ETH */

		// Check remaining VUSD Deposits and ETH gain, for whale and depositors whose vessels were liquidated

		const whale_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(whale)).toString()
		const alice_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
		const bob_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

		const whale_ETHGain_Asset = (await stabilityPool.getDepositorGains(whale))[1][1].toString()
		const alice_ETHGain_Asset = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
		const bob_ETHGain_Asset = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

		const liquidatedDebt_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset)
		const liquidatedColl_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)

		assert.isAtMost(
			th.getDifference(
				whale_Deposit_After_Asset,
				W_VUSDAmount_Asset.sub(liquidatedDebt_Asset.mul(W_VUSDAmount_Asset).div(totalDeposit_Asset))
			),
			100000
		)
		assert.isAtMost(
			th.getDifference(
				alice_Deposit_After_Asset,
				A_VUSDAmount_Asset.sub(liquidatedDebt_Asset.mul(A_VUSDAmount_Asset).div(totalDeposit_Asset))
			),
			100000
		)
		assert.isAtMost(
			th.getDifference(
				bob_Deposit_After_Asset,
				B_VUSDAmount_Asset.sub(liquidatedDebt_Asset.mul(B_VUSDAmount_Asset).div(totalDeposit_Asset))
			),
			100000
		)

		assert.isAtMost(
			th.getDifference(
				whale_ETHGain_Asset,
				th.applyLiquidationFee(liquidatedColl_Asset.mul(W_VUSDAmount_Asset).div(totalDeposit_Asset))
			),
			2000
		)
		assert.isAtMost(
			th.getDifference(
				alice_ETHGain_Asset,
				th.applyLiquidationFee(liquidatedColl_Asset.mul(A_VUSDAmount_Asset).div(totalDeposit_Asset))
			),
			2000
		)
		assert.isAtMost(
			th.getDifference(
				bob_ETHGain_Asset,
				th.applyLiquidationFee(liquidatedColl_Asset.mul(B_VUSDAmount_Asset).div(totalDeposit_Asset))
			),
			2000
		)

		// Check total remaining deposits and ETH gain in Stability Pool

		const total_VUSDinSP_Asset = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
		const total_ETHinSP_Asset = (await stabilityPool.getCollateral(erc20.address)).toString()

		assert.isAtMost(th.getDifference(total_VUSDinSP_Asset, totalDeposit_Asset.sub(liquidatedDebt_Asset)), 1000)
		assert.isAtMost(th.getDifference(total_ETHinSP_Asset, th.applyLiquidationFee(liquidatedColl_Asset)), 1000)
	})

	it("liquidateVessels(): Liquidating vessels at ICR <=100% with SP deposits does not alter their deposit or ETH gain", async () => {
		// Whale provides 400 VUSD to the SP
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraVUSDAmount: dec(400, 18),
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(dec(400, 18), { from: whale })

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(182, 16)),
			extraVUSDAmount: dec(170, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(180, 16)),
			extraVUSDAmount: dec(300, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(170, 16)),
			extraParams: { from: carol },
		})

		// A, B provide 100, 300 to the SP

		await stabilityPool.provideToSP(dec(100, 18), { from: alice })
		await stabilityPool.provideToSP(dec(300, 18), { from: bob })

		assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "4")

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check VUSD and ETH in Pool  before
		const VUSDinSP_Before_Asset = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
		const ETHinSP_Before_Asset = (await stabilityPool.getCollateral(erc20.address)).toString()

		assert.equal(VUSDinSP_Before_Asset, dec(800, 18))
		assert.equal(ETHinSP_Before_Asset, "0")

		// *** Check A, B, C ICRs < 100

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lte(mv._ICR100))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lte(mv._ICR100))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lte(mv._ICR100))

		// Liquidate
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		// Check all defaulters have been liquidated

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// check system sized reduced to 1 vessels
		assert.equal((await sortedVessels.getSize(erc20.address)).toString(), "1")

		// Check VUSD and ETH in Pool after
		const VUSDinSP_After_Asset = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
		const ETHinSP_After_Asset = (await stabilityPool.getCollateral(erc20.address)).toString()

		assert.equal(VUSDinSP_Before_Asset, VUSDinSP_After_Asset)
		assert.equal(ETHinSP_Before_Asset, ETHinSP_After_Asset)

		// Check remaining VUSD Deposits and ETH gain, for whale and depositors whose vessels were liquidated

		const whale_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(whale)).toString()
		const alice_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
		const bob_Deposit_After_Asset = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

		const whale_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(whale))[1][1].toString()
		const alice_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
		const bob_ETHGain_After_Asset = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

		assert.equal(whale_Deposit_After_Asset, dec(400, 18))
		assert.equal(alice_Deposit_After_Asset, dec(100, 18))
		assert.equal(bob_Deposit_After_Asset, dec(300, 18))

		assert.equal(whale_ETHGain_After_Asset, "0")
		assert.equal(alice_ETHGain_After_Asset, "0")
		assert.equal(bob_ETHGain_After_Asset, "0")
	})

	it("liquidateVessels() with a non fullfilled liquidation: non liquidated vessel remains active", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(300, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D, E vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C, D, E.
    With 253 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated. 
    That leaves 50 VUSD in the Pool to absorb exactly half of Carol's debt (100) */
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		// Check A and B closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Check C remains active

		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1") // check Status is active
	})

	it("liquidateVessels() with a non fullfilled liquidation: non liquidated vessel remains in VesselOwners Array", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(211, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: carol },
		})

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C.
    With 253 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated. 
    That leaves 50 VUSD in the Pool to absorb exactly half of Carol's debt (100) */
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		// Check C is in Vessel owners array
		const arrayLength_Asset = (await vesselManager.getVesselOwnersCount(erc20.address)).toNumber()
		let addressFound_Asset = false
		let addressIdx_Asset = 0

		for (let i = 0; i < arrayLength_Asset; i++) {
			const address_Asset = (await vesselManager.VesselOwners(erc20.address, i)).toString()
			if (address_Asset == carol) {
				addressFound_Asset = true
				addressIdx_Asset = i
			}
		}

		assert.isTrue(addressFound_Asset)

		// Check VesselOwners idx on vessel struct == idx of address found in VesselOwners array
		const idxOnStruct_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_ARRAY_INDEX].toString()
		assert.equal(addressIdx_Asset.toString(), idxOnStruct_Asset)
	})

	it("liquidateVessels() with a non fullfilled liquidation: still can liquidate further vessels after the non-liquidated, emptied pool", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: D_totalDebt_Asset,
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(D_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D, E vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const ICR_E_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_E_Asset.gt(mv._MCR) && ICR_E_Asset.lt(TCR_Asset))

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C, D, E.
     With 300 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated.
     That leaves 97 VUSD in the Pool that won’t be enough to absorb Carol,
     but it will be enough to liquidate Dennis. Afterwards the pool will be empty,
     so Erin won’t liquidated. */

		const tx_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 10)
		// console.log("gasUsed Asset: ", tx_Asset.receipt.gasUsed)

		// Check A, B and D are closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		// console.log(await sortedVessels.contains(erc20.address, carol))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Check whale, C and E stay active

		assert.isTrue(await sortedVessels.contains(erc20.address, whale))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, erin))
	})

	it("liquidateVessels() with a non fullfilled liquidation: still can liquidate further vessels after the non-liquidated, non emptied pool", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: D_totalDebt_Asset,
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(D_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D, E vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const ICR_E_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_E_Asset.gt(mv._MCR) && ICR_E_Asset.lt(TCR_Asset))

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C, D, E.
     With 301 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated.
     That leaves 97 VUSD in the Pool that won’t be enough to absorb Carol,
     but it will be enough to liquidate Dennis. Afterwards the pool will be empty,
     so Erin won’t liquidated.
     Note that, compared to the previous test, this one will make 1 more loop iteration,
     so it will consume more gas. */

		const tx_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 10)
		// console.log("gasUsed: ", tx_Asset.receipt.gasUsed)

		// Check A, B and D are closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Check whale, C and E stay active

		assert.isTrue(await sortedVessels.contains(erc20.address, whale))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, erin))
	})

	it("liquidateVessels() with a non fullfilled liquidation: total liquidated coll and debt is correct", async () => {
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		const entireSystemCollBefore_Asset = await vesselManager.getEntireSystemColl(erc20.address)
		const entireSystemDebtBefore_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C, D, E.
    With 253 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated. 
    That leaves 50 VUSD in the Pool that won’t be enough to absorb any other vessel */
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		// Expect system debt reduced by 203 VUSD and system coll 2.3 ETH
		const entireSystemCollAfter_Asset = await vesselManager.getEntireSystemColl(erc20.address)
		const entireSystemDebtAfter_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

		const changeInEntireSystemColl_Asset = entireSystemCollBefore_Asset.sub(entireSystemCollAfter_Asset)
		const changeInEntireSystemDebt_Asset = entireSystemDebtBefore_Asset.sub(entireSystemDebtAfter_Asset)

		assert.equal(changeInEntireSystemColl_Asset.toString(), A_coll_Asset.add(B_coll_Asset))
		th.assertIsApproximatelyEqual(changeInEntireSystemDebt_Asset.toString(), A_totalDebt_Asset.add(B_totalDebt_Asset))
	})

	it("liquidateVessels() with a non fullfilled liquidation: emits correct liquidation event values", async () => {
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(211, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C, D, E.
    With 253 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated. 
    That leaves 50 VUSD in the Pool which won’t be enough for any other liquidation */
		const liquidationTx_Asset = await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		const [liquidatedDebt_Asset, liquidatedColl_Asset, collGasComp_Asset, VUSDGasComp_Asset] =
			th.getEmittedLiquidationValues(liquidationTx_Asset)

		th.assertIsApproximatelyEqual(liquidatedDebt_Asset, A_totalDebt_Asset.add(B_totalDebt_Asset))
		const equivalentColl_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset)
			.mul(toBN(dec(11, 17)))
			.div(price)
		th.assertIsApproximatelyEqual(liquidatedColl_Asset, th.applyLiquidationFee(equivalentColl_Asset))
		th.assertIsApproximatelyEqual(
			collGasComp_Asset,
			equivalentColl_Asset.sub(th.applyLiquidationFee(equivalentColl_Asset))
		) // 0.5% of 283/120*1.1
		assert.equal(VUSDGasComp_Asset.toString(), dec(400, 18))

		// check collateral surplus

		const alice_remainingCollateral_Asset = A_coll_Asset.sub(A_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, alice),
			alice_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)

		// can claim collateral

		const alice_balanceBefore_Asset = th.toBN(await erc20.balanceOf(alice))
		await borrowerOperations.claimCollateral(erc20.address, { from: alice })
		const alice_balanceAfter_Asset = th.toBN(await erc20.balanceOf(alice))
		th.assertIsApproximatelyEqual(
			alice_balanceAfter_Asset,
			alice_balanceBefore_Asset.add(th.toBN(alice_remainingCollateral_Asset))
		)

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)
	})

	it("liquidateVessels() with a non fullfilled liquidation: ICR of non liquidated vessel does not change", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Before_Asset.gt(mv._MCR) && ICR_C_Before_Asset.lt(TCR_Asset))

		/* Liquidate vessels. Vessels are ordered by ICR, from low to high:  A, B, C, D, E.
    With 253 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated. 
    That leaves 50 VUSD in the Pool to absorb exactly half of Carol's debt (100) */
		await vesselManagerOperations.liquidateVessels(erc20.address, 10)

		const ICR_C_After_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		assert.equal(ICR_C_Before_Asset.toString(), ICR_C_After_Asset)
	})

	// TODO: LiquidateVessels tests that involve vessels with ICR > TCR

	// --- batchLiquidateVessels() ---

	it("batchLiquidateVessels(): Liquidates all vessels with ICR < 110%, transitioning Normal -> Recovery Mode", async () => {
		// make 6 Vessels accordingly
		// --- SETUP ---

		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(230, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: erin },
		})
		const { totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: freddy },
		})

		const spDeposit_Asset = B_totalDebt_Asset.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(E_totalDebt_Asset)
			.add(F_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(426, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: alice },
		})

		// Alice deposits VUSD to Stability Pool
		await stabilityPool.provideToSP(spDeposit_Asset, { from: alice })

		// price drops to 1ETH:85VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "85000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		// check Recovery Mode kicks in

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check TCR < 150%
		const _150percent = web3.utils.toBN("1500000000000000000")

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_Before_Asset.lt(_150percent))

		/* 
    After the price drop and prior to any liquidations, ICR should be:
    Vessel         ICR
    Alice       182%
    Bob         102%
    Carol       102%
    Dennis      102%
    Elisa       102%
    Freddy      102%
    */

		alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		dennis_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		erin_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)
		freddy_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, freddy, price)

		// Alice should have ICR > 150%
		assert.isTrue(alice_ICR_Asset.gt(_150percent))
		// All other Vessels should have ICR < 150%
		assert.isTrue(carol_ICR_Asset.lt(_150percent))
		assert.isTrue(dennis_ICR_Asset.lt(_150percent))
		assert.isTrue(erin_ICR_Asset.lt(_150percent))
		assert.isTrue(freddy_ICR_Asset.lt(_150percent))

		/* After liquidating Bob and Carol, the the TCR of the system rises above the CCR, to 154%.  
    (see calculations in Google Sheet)
    Liquidations continue until all Vessels with ICR < MCR have been closed. 
    Only Alice should remain active - all others should be closed. */

		// call batchLiquidateVessels
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, [alice, bob, carol, dennis, erin, freddy])

		// check system is no longer in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// After liquidation, TCR should rise to above 150%.

		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_After_Asset.gt(_150percent))

		// get all Vessels
		const alice_Vessel_Asset = await vesselManager.Vessels(alice, erc20.address)
		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const carol_Vessel_Asset = await vesselManager.Vessels(carol, erc20.address)
		const dennis_Vessel_Asset = await vesselManager.Vessels(dennis, erc20.address)
		const erin_Vessel_Asset = await vesselManager.Vessels(erin, erc20.address)
		const freddy_Vessel_Asset = await vesselManager.Vessels(freddy, erc20.address)

		// check that Alice's Vessel remains active

		assert.equal(alice_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.isTrue(await sortedVessels.contains(erc20.address, alice))

		// check all other Vessels are liquidated

		assert.equal(bob_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(carol_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(dennis_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(erin_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(freddy_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)

		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
	})

	it("batchLiquidateVessels(): Liquidates all vessels with ICR < 110%, transitioning Recovery -> Normal Mode", async () => {
		/* This is essentially the same test as before, but changing the order of the batch,
		 * now the remaining vessel (alice) goes at the end.
		 * This way alice will be skipped in a different part of the code, as in the previous test,
		 * when attempting alice the system was in Recovery mode, while in this test,
		 * when attempting alice the system has gone back to Normal mode
		 * (see function `_getTotalFromBatchLiquidate_RecoveryMode`)
		 */
		// make 6 Vessels accordingly
		// --- SETUP ---

		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(230, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: erin },
		})
		const { totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: freddy },
		})

		const spDeposit_Asset = B_totalDebt_Asset.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(E_totalDebt_Asset)
			.add(F_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(426, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: alice },
		})

		// Alice deposits VUSD to Stability Pool
		await stabilityPool.provideToSP(spDeposit_Asset, { from: alice })

		// price drops to 1ETH:85VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "85000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		// check Recovery Mode kicks in

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check TCR < 150%
		const _150percent = web3.utils.toBN("1500000000000000000")

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_Before_Asset.lt(_150percent))

		/*
    After the price drop and prior to any liquidations, ICR should be:
    Vessel         ICR
    Alice       182%
    Bob         102%
    Carol       102%
    Dennis      102%
    Elisa       102%
    Freddy      102%
    */

		const alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const dennis_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const erin_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)
		const freddy_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, freddy, price)

		// Alice should have ICR > 150%
		assert.isTrue(alice_ICR_Asset.gt(_150percent))
		// All other Vessels should have ICR < 150%

		assert.isTrue(carol_ICR_Asset.lt(_150percent))
		assert.isTrue(dennis_ICR_Asset.lt(_150percent))
		assert.isTrue(erin_ICR_Asset.lt(_150percent))
		assert.isTrue(freddy_ICR_Asset.lt(_150percent))

		/* After liquidating Bob and Carol, the the TCR of the system rises above the CCR, to 154%.  
    (see calculations in Google Sheet)
    Liquidations continue until all Vessels with ICR < MCR have been closed. 
    Only Alice should remain active - all others should be closed. */

		// call batchLiquidateVessels
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, [bob, carol, dennis, erin, freddy, alice])

		// check system is no longer in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// After liquidation, TCR should rise to above 150%.

		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_After_Asset.gt(_150percent))

		// get all Vessels
		const alice_Vessel_Asset = await vesselManager.Vessels(alice, erc20.address)
		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const carol_Vessel_Asset = await vesselManager.Vessels(carol, erc20.address)
		const dennis_Vessel_Asset = await vesselManager.Vessels(dennis, erc20.address)
		const erin_Vessel_Asset = await vesselManager.Vessels(erin, erc20.address)
		const freddy_Vessel_Asset = await vesselManager.Vessels(freddy, erc20.address)

		// check that Alice's Vessel remains active

		assert.equal(alice_Vessel_Asset[th.VESSEL_STATUS_INDEX], 1)
		assert.isTrue(await sortedVessels.contains(erc20.address, alice))

		// check all other Vessels are liquidated

		assert.equal(bob_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(carol_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(dennis_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(erin_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(freddy_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)

		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
	})

	it("batchLiquidateVessels(): Liquidates all vessels with ICR < 110%, transitioning Normal -> Recovery Mode", async () => {
		// This is again the same test as the before the last one, but now Alice is skipped because she is not active
		// It also skips bob, as he is added twice, for being already liquidated
		// make 6 Vessels accordingly
		// --- SETUP ---

		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(230, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: erin },
		})
		const { totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(240, 16)),
			extraParams: { from: freddy },
		})

		const spDeposit_Asset = B_totalDebt_Asset.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(E_totalDebt_Asset)
			.add(F_totalDebt_Asset)
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(426, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(426, 16)),
			extraVUSDAmount: A_totalDebt_Asset,
			extraParams: { from: whale },
		})

		// Alice deposits VUSD to Stability Pool
		await stabilityPool.provideToSP(spDeposit_Asset, { from: alice })

		// to compensate borrowing fee
		await debtToken.transfer(alice, A_totalDebt_Asset, { from: whale })
		// Alice closes vessel
		await borrowerOperations.closeVessel(erc20.address, { from: alice })

		// price drops to 1ETH:85VUSD, reducing TCR below 150%
		await priceFeed.setPrice(erc20.address, "85000000000000000000")
		const price = await priceFeed.getPrice(erc20.address)

		// check Recovery Mode kicks in

		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// check TCR < 150%
		const _150percent = web3.utils.toBN("1500000000000000000")

		const TCR_Before_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_Before_Asset.lt(_150percent))

		/*
    After the price drop and prior to any liquidations, ICR should be:
    Vessel         ICR
    Alice       182%
    Bob         102%
    Carol       102%
    Dennis      102%
    Elisa       102%
    Freddy      102%
    */

		alice_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		bob_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		carol_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		dennis_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		erin_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)
		freddy_ICR_Asset = await vesselManager.getCurrentICR(erc20.address, freddy, price)

		// Alice should have ICR > 150%
		assert.isTrue(alice_ICR_Asset.gt(_150percent))
		// All other Vessels should have ICR < 150%

		assert.isTrue(carol_ICR_Asset.lt(_150percent))
		assert.isTrue(dennis_ICR_Asset.lt(_150percent))
		assert.isTrue(erin_ICR_Asset.lt(_150percent))
		assert.isTrue(freddy_ICR_Asset.lt(_150percent))

		/* After liquidating Bob and Carol, the the TCR of the system rises above the CCR, to 154%.
    (see calculations in Google Sheet)
    Liquidations continue until all Vessels with ICR < MCR have been closed.
    Only Alice should remain active - all others should be closed. */

		// call batchLiquidateVessels
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, [alice, bob, bob, carol, dennis, erin, freddy])

		// check system is no longer in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// After liquidation, TCR should rise to above 150%.

		const TCR_After_Asset = await th.getTCR(contracts.core, erc20.address)
		assert.isTrue(TCR_After_Asset.gt(_150percent))

		// get all Vessels
		const alice_Vessel_Asset = await vesselManager.Vessels(alice, erc20.address)
		const bob_Vessel_Asset = await vesselManager.Vessels(bob, erc20.address)
		const carol_Vessel_Asset = await vesselManager.Vessels(carol, erc20.address)
		const dennis_Vessel_Asset = await vesselManager.Vessels(dennis, erc20.address)
		const erin_Vessel_Asset = await vesselManager.Vessels(erin, erc20.address)
		const freddy_Vessel_Asset = await vesselManager.Vessels(freddy, erc20.address)

		// check that Alice's Vessel is closed
		assert.equal(alice_Vessel_Asset[th.VESSEL_STATUS_INDEX], 2)

		// check all other Vessels are liquidated

		assert.equal(bob_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(carol_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(dennis_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(erin_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)
		assert.equal(freddy_Vessel_Asset[th.VESSEL_STATUS_INDEX], 3)

		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: non liquidated vessel remains active", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(211, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		const vesselsToLiquidate = [alice, bob, carol]
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)

		// Check A and B closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Check C remains active

		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX].toString(), "1") // check Status is active
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: non liquidated vessel remains in Vessel Owners array", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(211, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP
		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		const vesselsToLiquidate = [alice, bob, carol]
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)

		// Check C is in Vessel owners array

		// Check C is in Vessel owners array
		const arrayLength_Asset = (await vesselManager.getVesselOwnersCount(erc20.address)).toNumber()
		let addressFound_Asset = false
		let addressIdx_Asset = 0

		for (let i = 0; i < arrayLength_Asset; i++) {
			const address_Asset = (await vesselManager.VesselOwners(erc20.address, i)).toString()
			if (address_Asset == carol) {
				addressFound_Asset = true
				addressIdx_Asset = i
			}
		}

		assert.isTrue(addressFound_Asset)

		// Check VesselOwners idx on vessel struct == idx of address found in VesselOwners array
		const idxOnStruct_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_ARRAY_INDEX].toString()
		assert.equal(addressIdx_Asset.toString(), idxOnStruct_Asset)
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: still can liquidate further vessels after the non-liquidated, emptied pool", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: D_totalDebt_Asset,
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D, E vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const ICR_E_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_E_Asset.gt(mv._MCR) && ICR_E_Asset.lt(TCR_Asset))

		/* With 300 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated.
     That leaves 97 VUSD in the Pool that won’t be enough to absorb Carol,
     but it will be enough to liquidate Dennis. Afterwards the pool will be empty,
     so Erin won’t liquidated. */
		const vesselsToLiquidate = [alice, bob, carol, dennis, erin]
		const tx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)
		// console.log("gasUsed: ", tx_Asset.receipt.gasUsed)

		// Check A, B and D are closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Check whale, C, D and E stay active

		assert.isTrue(await sortedVessels.contains(erc20.address, whale))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, erin))
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: still can liquidate further vessels after the non-liquidated, non emptied pool", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: D_totalDebt_Asset,
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D, E vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const ICR_E_Asset = await vesselManager.getCurrentICR(erc20.address, erin, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_E_Asset.gt(mv._MCR) && ICR_E_Asset.lt(TCR_Asset))

		/* With 301 in the SP, Alice (102 debt) and Bob (101 debt) should be entirely liquidated.
     That leaves 97 VUSD in the Pool that won’t be enough to absorb Carol,
     but it will be enough to liquidate Dennis. Afterwards the pool will be empty,
     so Erin won’t liquidated.
     Note that, compared to the previous test, this one will make 1 more loop iteration,
     so it will consume more gas. */
		const vesselsToLiquidate = [alice, bob, carol, dennis, erin]

		const tx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)
		// console.log("gasUsed Asset: ", tx_Asset.receipt.gasUsed)

		// Check A, B and D are closed

		assert.isFalse(await sortedVessels.contains(erc20.address, alice))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Check whale, C, D and E stay active

		assert.isTrue(await sortedVessels.contains(erc20.address, whale))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, erin))
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: total liquidated coll and debt is correct", async () => {
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(208, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D, E vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		const entireSystemCollBefore_Asset = await vesselManager.getEntireSystemColl(erc20.address)
		const entireSystemDebtBefore_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

		const vesselsToLiquidate = [alice, bob, carol]
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)

		// Expect system debt reduced by 203 VUSD and system coll by 2 ETH

		const entireSystemCollAfter_Asset = await vesselManager.getEntireSystemColl(erc20.address)
		const entireSystemDebtAfter_Asset = await vesselManager.getEntireSystemDebt(erc20.address)

		const changeInEntireSystemColl_Asset = entireSystemCollBefore_Asset.sub(entireSystemCollAfter_Asset)
		const changeInEntireSystemDebt_Asset = entireSystemDebtBefore_Asset.sub(entireSystemDebtAfter_Asset)

		assert.equal(changeInEntireSystemColl_Asset.toString(), A_coll_Asset.add(B_coll_Asset))
		th.assertIsApproximatelyEqual(changeInEntireSystemDebt_Asset.toString(), A_totalDebt_Asset.add(B_totalDebt_Asset))
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: emits correct liquidation event values", async () => {
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(211, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		const vesselsToLiquidate = [alice, bob, carol]
		const liquidationTx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)

		const [liquidatedDebt_Asset, liquidatedColl_Asset, collGasComp_Asset, VUSDGasComp_Asset] =
			th.getEmittedLiquidationValues(liquidationTx_Asset)

		th.assertIsApproximatelyEqual(liquidatedDebt_Asset, A_totalDebt_Asset.add(B_totalDebt_Asset))

		const equivalentColl_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset)
			.mul(toBN(dec(11, 17)))
			.div(price)

		th.assertIsApproximatelyEqual(liquidatedColl_Asset, th.applyLiquidationFee(equivalentColl_Asset))
		th.assertIsApproximatelyEqual(
			collGasComp_Asset,
			equivalentColl_Asset.sub(th.applyLiquidationFee(equivalentColl_Asset))
		) // 0.5% of 283/120*1.1

		assert.equal(VUSDGasComp_Asset.toString(), dec(400, 18))

		// check collateral surplus

		const alice_remainingCollateral_Asset = A_coll_Asset.sub(A_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const bob_remainingCollateral_Asset = B_coll_Asset.sub(B_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))

		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, alice),
			alice_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, bob),
			bob_remainingCollateral_Asset
		)

		// can claim collateral

		const alice_balanceBefore_Asset = th.toBN(await erc20.balanceOf(alice))
		await borrowerOperations.claimCollateral(erc20.address, { from: alice })
		const alice_balanceAfter_Asset = th.toBN(await erc20.balanceOf(alice))
		th.assertIsApproximatelyEqual(
			alice_balanceAfter_Asset,
			alice_balanceBefore_Asset.add(th.toBN(alice_remainingCollateral_Asset))
		)

		const bob_balanceBefore_Asset = th.toBN(await erc20.balanceOf(bob))
		await borrowerOperations.claimCollateral(erc20.address, { from: bob })
		const bob_balanceAfter_Asset = th.toBN(await erc20.balanceOf(bob))
		th.assertIsApproximatelyEqual(
			bob_balanceAfter_Asset,
			bob_balanceBefore_Asset.add(th.toBN(bob_remainingCollateral_Asset))
		)
	})

	it("batchLiquidateVessels() with a non fullfilled liquidation: ICR of non liquidated vessel does not change", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(211, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(212, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: erin },
		})

		// Whale provides VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(220, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C vessels are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Before_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Before_Asset.gt(mv._MCR) && ICR_C_Before_Asset.lt(TCR_Asset))

		const vesselsToLiquidate = [alice, bob, carol]
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)

		const ICR_C_After_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		assert.equal(ICR_C_Before_Asset.toString(), ICR_C_After_Asset)
	})

	it("batchLiquidateVessels(), with 110% < ICR < TCR, and StabilityPool VUSD > debt to liquidate: can liquidate vessels out of order", async () => {
		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(202, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(204, 16)),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(206, 16)),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(280, 16)),
			extraVUSDAmount: dec(500, 18),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(282, 16)),
			extraVUSDAmount: dec(500, 18),
			extraParams: { from: freddy },
		})

		// Whale provides 1000 VUSD to the SP

		const spDeposit_Asset = A_totalDebt_Asset.add(C_totalDebt_Asset).add(D_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(219, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check vessels A-D are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, dennis, price)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))

		// Liquidate out of ICR order: D, B, C. A (lowest ICR) not included.
		const vesselsToLiquidate = [dennis, bob, carol]
		const liquidationTx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)

		// Check transaction succeeded
		assert.isTrue(liquidationTx_Asset.receipt.status)

		// Confirm vessels D, B, C removed

		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Confirm vessels have status 'liquidated' (Status enum element idx 3)

		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "3")
	})

	it("batchLiquidateVessels(), with 110% < ICR < TCR, and StabilityPool empty: doesn't liquidate any vessels", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: alice },
		})
		const { totalDebt: bobDebt_Before_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(224, 16)),
			extraParams: { from: bob },
		})
		const { totalDebt: carolDebt_Before_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(226, 16)),
			extraParams: { from: carol },
		})
		const { totalDebt: dennisDebt_Before_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(228, 16)),
			extraParams: { from: dennis },
		})

		const bobColl_Before_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const carolColl_Before_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const dennisColl_Before_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(228, 16)),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(230, 16)),
			extraParams: { from: freddy },
		})

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(120, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Check Recovery Mode is active
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check vessels A-D are in range 110% < ICR < TCR

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, alice, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, bob, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, carol, price)

		assert.isTrue(ICR_A_Asset.gt(mv._MCR) && ICR_A_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_B_Asset.gt(mv._MCR) && ICR_B_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_C_Asset.gt(mv._MCR) && ICR_C_Asset.lt(TCR_Asset))

		// Liquidate out of ICR order: D, B, C. A (lowest ICR) not included.
		const vesselsToLiquidate = [dennis, bob, carol]
		await assertRevert(
			vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate),
			"VesselManager: nothing to liquidate"
		)

		// Confirm vessels D, B, C remain in system

		assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))

		// Confirm vessels have status 'active' (Status enum element idx 1)

		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
		assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "1")

		// Confirm D, B, C coll & debt have not changed

		const dennisDebt_After_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_DEBT_INDEX].add(
			await vesselManager.getPendingDebtTokenReward(erc20.address, dennis)
		)
		const bobDebt_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX].add(
			await vesselManager.getPendingDebtTokenReward(erc20.address, bob)
		)
		const carolDebt_After_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_DEBT_INDEX].add(
			await vesselManager.getPendingDebtTokenReward(erc20.address, carol)
		)

		const dennisColl_After_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX].add(
			await vesselManager.getPendingAssetReward(erc20.address, dennis)
		)
		const bobColl_After_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].add(
			await vesselManager.getPendingAssetReward(erc20.address, bob)
		)
		const carolColl_After_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX].add(
			await vesselManager.getPendingAssetReward(erc20.address, carol)
		)

		assert.isTrue(dennisColl_After_Asset.eq(dennisColl_Before_Asset))
		assert.isTrue(bobColl_After_Asset.eq(bobColl_Before_Asset))
		assert.isTrue(carolColl_After_Asset.eq(carolColl_Before_Asset))

		th.assertIsApproximatelyEqual(th.toBN(dennisDebt_Before_Asset).toString(), dennisDebt_After_Asset.toString())
		th.assertIsApproximatelyEqual(th.toBN(bobDebt_Before_Asset).toString(), bobDebt_After_Asset.toString())
		th.assertIsApproximatelyEqual(th.toBN(carolDebt_Before_Asset).toString(), carolDebt_After_Asset.toString())
	})

	it("batchLiquidateVessels(): skips liquidation of vessels with ICR > TCR, regardless of Stability Pool size", async () => {
		// Vessels that will fall into ICR range 100-MCR

		const { totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(194, 16)),
			extraParams: { from: A },
		})
		const { totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(196, 16)),
			extraParams: { from: B },
		})
		const { totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(198, 16)),
			extraParams: { from: C },
		})

		// Vessels that will fall into ICR range 110-TCR
		const { totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(221, 16)),
			extraParams: { from: D },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(223, 16)),
			extraParams: { from: E },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(225, 16)),
			extraParams: { from: F },
		})

		// Vessels that will fall into ICR range >= TCR

		const { totalDebt: G_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: G },
		})
		const { totalDebt: H_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(270, 16)),
			extraParams: { from: H },
		})
		const { totalDebt: I_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(290, 16)),
			extraParams: { from: I },
		})

		// Whale adds VUSD to SP

		const spDeposit_Asset = A_totalDebt_Asset.add(C_totalDebt_Asset)
			.add(D_totalDebt_Asset)
			.add(G_totalDebt_Asset)
			.add(H_totalDebt_Asset)
			.add(I_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(245, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops, but all vessels remain active
		await priceFeed.setPrice(erc20.address, dec(110, 18))
		const price = await priceFeed.getPrice(erc20.address)
		const TCR_Asset = await th.getTCR(contracts.core, erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		const G_collBefore_Asset = (await vesselManager.Vessels(G, erc20.address))[th.VESSEL_COLL_INDEX]
		const G_debtBefore_Asset = (await vesselManager.Vessels(G, erc20.address))[th.VESSEL_DEBT_INDEX]
		const H_collBefore_Asset = (await vesselManager.Vessels(H, erc20.address))[th.VESSEL_COLL_INDEX]
		const H_debtBefore_Asset = (await vesselManager.Vessels(H, erc20.address))[th.VESSEL_DEBT_INDEX]
		const I_collBefore_Asset = (await vesselManager.Vessels(I, erc20.address))[th.VESSEL_COLL_INDEX]
		const I_debtBefore_Asset = (await vesselManager.Vessels(I, erc20.address))[th.VESSEL_DEBT_INDEX]

		const ICR_A_Asset = await vesselManager.getCurrentICR(erc20.address, A, price)
		const ICR_B_Asset = await vesselManager.getCurrentICR(erc20.address, B, price)
		const ICR_C_Asset = await vesselManager.getCurrentICR(erc20.address, C, price)
		const ICR_D_Asset = await vesselManager.getCurrentICR(erc20.address, D, price)
		const ICR_E_Asset = await vesselManager.getCurrentICR(erc20.address, E, price)
		const ICR_F_Asset = await vesselManager.getCurrentICR(erc20.address, F, price)
		const ICR_G_Asset = await vesselManager.getCurrentICR(erc20.address, G, price)
		const ICR_H_Asset = await vesselManager.getCurrentICR(erc20.address, H, price)
		const ICR_I_Asset = await vesselManager.getCurrentICR(erc20.address, I, price)

		// Check A-C are in range 100-110

		assert.isTrue(ICR_A_Asset.gte(mv._ICR100) && ICR_A_Asset.lt(mv._MCR))
		assert.isTrue(ICR_B_Asset.gte(mv._ICR100) && ICR_B_Asset.lt(mv._MCR))
		assert.isTrue(ICR_C_Asset.gte(mv._ICR100) && ICR_C_Asset.lt(mv._MCR))

		// Check D-F are in range 110-TCR

		assert.isTrue(ICR_D_Asset.gt(mv._MCR) && ICR_D_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_E_Asset.gt(mv._MCR) && ICR_E_Asset.lt(TCR_Asset))
		assert.isTrue(ICR_F_Asset.gt(mv._MCR) && ICR_F_Asset.lt(TCR_Asset))

		// Check G-I are in range >= TCR

		assert.isTrue(ICR_G_Asset.gte(TCR_Asset))
		assert.isTrue(ICR_H_Asset.gte(TCR_Asset))
		assert.isTrue(ICR_I_Asset.gte(TCR_Asset))

		// Attempt to liquidate only vessels with ICR > TCR%
		await assertRevert(
			vesselManagerOperations.batchLiquidateVessels(erc20.address, [G, H, I]),
			"VesselManager: nothing to liquidate"
		)

		// Check G, H, I remain in system

		assert.isTrue(await sortedVessels.contains(erc20.address, G))
		assert.isTrue(await sortedVessels.contains(erc20.address, H))
		assert.isTrue(await sortedVessels.contains(erc20.address, I))

		// Check G, H, I coll and debt have not changed
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()

		assert.equal(G_collBefore_Asset.eq(await vesselManager.Vessels(G, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(G_debtBefore_Asset.eq(await vesselManager.Vessels(G, erc20.address))[th.VESSEL_DEBT_INDEX])
		assert.equal(H_collBefore_Asset.eq(await vesselManager.Vessels(H, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(H_debtBefore_Asset.eq(await vesselManager.Vessels(H, erc20.address))[th.VESSEL_DEBT_INDEX])
		assert.equal(I_collBefore_Asset.eq(await vesselManager.Vessels(I, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(I_debtBefore_Asset.eq(await vesselManager.Vessels(I, erc20.address))[th.VESSEL_DEBT_INDEX])

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Attempt to liquidate a variety of vessels with SP covering whole batch.
		// Expect A, C, D to be liquidated, and G, H, I to remain in system
		await vesselManagerOperations.batchLiquidateVessels(erc20.address, [C, D, G, H, A, I])

		// Confirm A, C, D liquidated

		assert.isFalse(await sortedVessels.contains(erc20.address, C))
		assert.isFalse(await sortedVessels.contains(erc20.address, A))
		assert.isFalse(await sortedVessels.contains(erc20.address, D))

		// Check G, H, I remain in system

		assert.isTrue(await sortedVessels.contains(erc20.address, G))
		assert.isTrue(await sortedVessels.contains(erc20.address, H))
		assert.isTrue(await sortedVessels.contains(erc20.address, I))

		// Check coll and debt have not changed
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()

		assert.equal(G_collBefore_Asset.eq(await vesselManager.Vessels(G, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(G_debtBefore_Asset.eq(await vesselManager.Vessels(G, erc20.address))[th.VESSEL_DEBT_INDEX])
		assert.equal(H_collBefore_Asset.eq(await vesselManager.Vessels(H, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(H_debtBefore_Asset.eq(await vesselManager.Vessels(H, erc20.address))[th.VESSEL_DEBT_INDEX])
		assert.equal(I_collBefore_Asset.eq(await vesselManager.Vessels(I, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(I_debtBefore_Asset.eq(await vesselManager.Vessels(I, erc20.address))[th.VESSEL_DEBT_INDEX])

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Whale withdraws entire deposit, and re-deposits 132 VUSD
		// Increasing the price for a moment to avoid pending liquidations to block withdrawal
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		await stabilityPool.withdrawFromSP(spDeposit_Asset, { from: whale })
		await priceFeed.setPrice(erc20.address, dec(110, 18))
		await stabilityPool.provideToSP(B_totalDebt_Asset.add(toBN(dec(50, 18))), {
			from: whale,
		})

		// B and E are still in range 110-TCR.
		// Attempt to liquidate B, G, H, I, E.
		// Expected Stability Pool to fully absorb B (92 VUSD + 10 virtual debt),
		// but not E as there are not enough funds in Stability Pool

		const stabilityBefore_Asset = await stabilityPool.getTotalDebtTokenDeposits()
		const dEbtBefore_Asset = (await vesselManager.Vessels(E, erc20.address))[th.VESSEL_DEBT_INDEX]

		await vesselManagerOperations.batchLiquidateVessels(erc20.address, [B, G, H, I, E])

		const dEbtAfter_Asset = (await vesselManager.Vessels(E, erc20.address))[th.VESSEL_DEBT_INDEX]
		const stabilityAfter_Asset = await stabilityPool.getTotalDebtTokenDeposits()

		const stabilityDelta_Asset = stabilityBefore_Asset.sub(stabilityAfter_Asset)
		const dEbtDelta_Asset = dEbtBefore_Asset.sub(dEbtAfter_Asset)

		th.assertIsApproximatelyEqual(stabilityDelta_Asset, B_totalDebt_Asset)
		assert.equal(dEbtDelta_Asset.toString(), "0")

		// Confirm B removed and E active

		assert.isFalse(await sortedVessels.contains(erc20.address, B))
		assert.isTrue(await sortedVessels.contains(erc20.address, E))

		// Check G, H, I remain in system

		assert.isTrue(await sortedVessels.contains(erc20.address, G))
		assert.isTrue(await sortedVessels.contains(erc20.address, H))
		assert.isTrue(await sortedVessels.contains(erc20.address, I))

		// Check coll and debt have not changed
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()
		assert.equal()

		assert.equal(G_collBefore_Asset.eq(await vesselManager.Vessels(G, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(G_debtBefore_Asset.eq(await vesselManager.Vessels(G, erc20.address))[th.VESSEL_DEBT_INDEX])
		assert.equal(H_collBefore_Asset.eq(await vesselManager.Vessels(H, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(H_debtBefore_Asset.eq(await vesselManager.Vessels(H, erc20.address))[th.VESSEL_DEBT_INDEX])
		assert.equal(I_collBefore_Asset.eq(await vesselManager.Vessels(I, erc20.address))[th.VESSEL_COLL_INDEX])
		assert.equal(I_debtBefore_Asset.eq(await vesselManager.Vessels(I, erc20.address))[th.VESSEL_DEBT_INDEX])
	})

	it("batchLiquidateVessels(): emits liquidation event with correct values when all vessels have ICR > 110% and Stability Pool covers a subset of vessels", async () => {
		// Vessels to be absorbed by SP

		const { collateral: F_coll_Asset, totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: freddy },
		})
		const { collateral: G_coll_Asset, totalDebt: G_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: greta },
		})

		// Vessels to be spared
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(308, 16)),
			extraParams: { from: dennis },
		})

		// Whale adds VUSD to SP

		const spDeposit_Asset = F_totalDebt_Asset.add(G_totalDebt_Asset)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops, but all vessels remain active
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Confirm all vessels have ICR > MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, freddy, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, greta, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gte(mv._MCR))

		// Confirm VUSD in Stability Pool
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), spDeposit_Asset.toString())

		const vesselsToLiquidate = [freddy, greta, alice, bob, carol, dennis, whale]

		// Attempt liqudation sequence

		const liquidationTx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)
		const [liquidatedDebt_Asset, liquidatedColl_Asset, gasComp_Asset] =
			th.getEmittedLiquidationValues(liquidationTx_Asset)

		// Check F and G were liquidated

		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
		assert.isFalse(await sortedVessels.contains(erc20.address, greta))

		// Check whale and A-D remain active

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
		assert.isTrue(await sortedVessels.contains(erc20.address, whale))

		// Liquidation event emits coll = (F_debt + G_debt)/price*1.1*0.995, and debt = (F_debt + G_debt)

		th.assertIsApproximatelyEqual(liquidatedDebt_Asset, F_totalDebt_Asset.add(G_totalDebt_Asset))
		th.assertIsApproximatelyEqual(
			liquidatedColl_Asset,
			th.applyLiquidationFee(
				F_totalDebt_Asset.add(G_totalDebt_Asset)
					.mul(toBN(dec(11, 17)))
					.div(price)
			)
		)

		// check collateral surplus

		const freddy_remainingCollateral_Asset = F_coll_Asset.sub(F_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const greta_remainingCollateral_Asset = G_coll_Asset.sub(G_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))

		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, freddy),
			freddy_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, greta),
			greta_remainingCollateral_Asset
		)

		// can claim collateral

		const freddy_balanceBefore_Asset = th.toBN(await erc20.balanceOf(freddy))
		await borrowerOperations.claimCollateral(erc20.address, { from: freddy })
		const freddy_balanceAfter_Asset = th.toBN(await erc20.balanceOf(freddy))
		th.assertIsApproximatelyEqual(
			freddy_balanceAfter_Asset,
			freddy_balanceBefore_Asset.add(th.toBN(freddy_remainingCollateral_Asset))
		)

		const greta_balanceBefore_Asset = th.toBN(await erc20.balanceOf(greta))
		await borrowerOperations.claimCollateral(erc20.address, { from: greta })
		const greta_balanceAfter_Asset = th.toBN(await erc20.balanceOf(greta))
		th.assertIsApproximatelyEqual(
			greta_balanceAfter_Asset,
			greta_balanceBefore_Asset.add(th.toBN(greta_remainingCollateral_Asset))
		)
	})

	it("batchLiquidateVessels(): emits liquidation event with correct values when all vessels have ICR > 110% and Stability Pool covers a subset of vessels, including a partial", async () => {
		// Vessels to be absorbed by SP

		const { collateral: F_coll_Asset, totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: freddy },
		})
		const { collateral: G_coll_Asset, totalDebt: G_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(222, 16)),
			extraParams: { from: greta },
		})

		// Vessels to be spared
		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(250, 16)),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(266, 16)),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(308, 16)),
			extraParams: { from: dennis },
		})

		// Whale opens vessel and adds 220 VUSD to SP

		const spDeposit_Asset = F_totalDebt_Asset.add(G_totalDebt_Asset).add(A_totalDebt_Asset.div(toBN(2)))
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(285, 16)),
			extraVUSDAmount: spDeposit_Asset,
			extraParams: { from: whale },
		})
		await stabilityPool.provideToSP(spDeposit_Asset, { from: whale })

		// Price drops, but all vessels remain active
		await priceFeed.setPrice(erc20.address, dec(100, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Confirm Recovery Mode
		assert.isTrue(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Confirm all vessels have ICR > MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, freddy, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, greta, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).gte(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).gte(mv._MCR))

		// Confirm VUSD in Stability Pool
		assert.equal((await stabilityPool.getTotalDebtTokenDeposits()).toString(), spDeposit_Asset.toString())

		const vesselsToLiquidate = [freddy, greta, alice, bob, carol, dennis, whale]

		// Attempt liqudation sequence

		const liquidationTx_Asset = await vesselManagerOperations.batchLiquidateVessels(erc20.address, vesselsToLiquidate)
		const [liquidatedDebt_Asset, liquidatedColl_Asset, gasComp_Asset] =
			th.getEmittedLiquidationValues(liquidationTx_Asset)

		// Check F and G were liquidated
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))
		assert.isFalse(await sortedVessels.contains(erc20.address, greta))

		// Check whale and A-D remain active

		assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		assert.isTrue(await sortedVessels.contains(erc20.address, bob))
		assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		assert.isTrue(await sortedVessels.contains(erc20.address, dennis))
		assert.isTrue(await sortedVessels.contains(erc20.address, whale))

		// Check A's collateral and debt are the same

		const entireColl_A_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX].add(
			await vesselManager.getPendingAssetReward(erc20.address, alice)
		)
		const entireDebt_A_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX].add(
			await vesselManager.getPendingDebtTokenReward(erc20.address, alice)
		)

		assert.equal(entireColl_A_Asset.toString(), A_coll_Asset)

		th.assertIsApproximatelyEqual(entireDebt_A_Asset.toString(), A_totalDebt_Asset)

		/* Liquidation event emits:
    coll = (F_debt + G_debt)/price*1.1*0.995
    debt = (F_debt + G_debt) */

		th.assertIsApproximatelyEqual(liquidatedDebt_Asset, F_totalDebt_Asset.add(G_totalDebt_Asset))
		th.assertIsApproximatelyEqual(
			liquidatedColl_Asset,
			th.applyLiquidationFee(
				F_totalDebt_Asset.add(G_totalDebt_Asset)
					.mul(toBN(dec(11, 17)))
					.div(price)
			)
		)

		// check collateral surplus

		const freddy_remainingCollateral_Asset = F_coll_Asset.sub(F_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		const greta_remainingCollateral_Asset = G_coll_Asset.sub(G_totalDebt_Asset.mul(th.toBN(dec(11, 17))).div(price))
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, freddy),
			freddy_remainingCollateral_Asset
		)
		th.assertIsApproximatelyEqual(
			await collSurplusPool.getCollateral(erc20.address, greta),
			greta_remainingCollateral_Asset
		)

		// can claim collateral

		const freddy_balanceBefore_Asset = th.toBN(await erc20.balanceOf(freddy))
		await borrowerOperations.claimCollateral(erc20.address, { from: freddy })
		const freddy_balanceAfter_Asset = th.toBN(await erc20.balanceOf(freddy))
		th.assertIsApproximatelyEqual(
			freddy_balanceAfter_Asset,
			freddy_balanceBefore_Asset.add(th.toBN(freddy_remainingCollateral_Asset))
		)

		const greta_balanceBefore_Asset = th.toBN(await erc20.balanceOf(greta))
		await borrowerOperations.claimCollateral(erc20.address, { from: greta })
		const greta_balanceAfter_Asset = th.toBN(await erc20.balanceOf(greta))
		th.assertIsApproximatelyEqual(
			greta_balanceAfter_Asset,
			greta_balanceBefore_Asset.add(th.toBN(greta_remainingCollateral_Asset))
		)
	})
})

contract("Reset chain state", async accounts => {})
