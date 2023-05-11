const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN, getDifference } = th

contract("VesselManager - Redistribution reward calculations", async accounts => {
	const [owner, alice, bob, carol, dennis, erin, freddy, A, B, C, D, E, treasury] = accounts

	let priceFeed
	let debtToken
	let sortedVessels
	let vesselManager
	let vesselManagerOperations
	let activePool
	let defaultPool
	let borrowerOperations
	let erc20

	let contracts

	const getNetBorrowingAmount = async (debtWithFee, asset) => th.getNetBorrowingAmount(contracts, debtWithFee, asset)
	const openVessel = async params => th.openVessel(contracts, params)

	beforeEach(async () => {
		const { coreContracts } = await deploymentHelper.deployTestContracts(treasury, accounts.slice(0, 20))

		contracts = coreContracts
		activePool = contracts.activePool
		borrowerOperations = contracts.borrowerOperations
		debtToken = contracts.debtToken
		defaultPool = contracts.defaultPool
		erc20 = contracts.erc20
		priceFeed = contracts.priceFeedTestnet
		sortedVessels = contracts.sortedVessels
		vesselManager = contracts.vesselManager
		vesselManagerOperations = contracts.vesselManagerOperations
	})

	it("redistribution: A, B Open. B Liquidated. C, D Open. D Liquidated. Distributes correct rewards", async () => {
		// A, B open vessel

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: bob },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

		// L1: B liquidated

		const txB_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)
		assert.isTrue(txB_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		// C, D open vessels

		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

		// L2: D Liquidated

		const txD_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txD_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Get entire coll of A and C

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()
		const carol_Coll_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()

		/* Expected collateral:
    A: Alice receives 0.995 ETH from L1, and ~3/5*0.995 ETH from L2.
    expect aliceColl = 2 + 0.995 + 2.995/4.995 * 0.995 = 3.5916 ETH
    C: Carol receives ~2/5 ETH from L2
    expect carolColl = 2 + 2/4.995 * 0.995 = 2.398 ETH
    Total coll = 4 + 2 * 0.995 ETH
    */

		const A_collAfterL1_Asset = A_coll_Asset.add(th.applyLiquidationFee(B_coll_Asset))
		assert.isAtMost(
			th.getDifference(
				alice_Coll_Asset,
				A_collAfterL1_Asset.add(
					A_collAfterL1_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_collAfterL1_Asset.add(C_coll_Asset))
				)
			),
			1000
		)
		assert.isAtMost(
			th.getDifference(
				carol_Coll_Asset,
				C_coll_Asset.add(
					C_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_collAfterL1_Asset.add(C_coll_Asset))
				)
			),
			1000
		)

		const entireSystemColl_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()
		assert.equal(
			entireSystemColl_Asset,
			A_coll_Asset.add(C_coll_Asset).add(th.applyLiquidationFee(B_coll_Asset.add(D_coll_Asset)))
		)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	it("redistribution: A, B, C Open. C Liquidated. D, E, F Open. F Liquidated. Distributes correct rewards", async () => {
		// A, B C open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: carol },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

		// L1: C liquidated

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		// D, E, F open vessels

		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: dennis },
		})
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: erin },
		})
		const { collateral: F_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: freddy },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Confirm not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

		// L2: F Liquidated

		const txF_Asset = await vesselManagerOperations.liquidate(erc20.address, freddy)
		assert.isTrue(txF_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))

		// Get entire coll of A, B, D and E

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()
		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()
		const dennis_Coll_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, dennis))
			.toString()
		const erin_Coll_Asset = (await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, erin))
			.toString()

		/* Expected collateral:
    A and B receives 1/2 ETH * 0.995 from L1.
    total Coll: 3
    A, B, receive (2.4975)/8.995 * 0.995 ETH from L2.
    
    D, E receive 2/8.995 * 0.995 ETH from L2.
    expect A, B coll  = 2 +  0.4975 + 0.2763  =  ETH
    expect D, E coll  = 2 + 0.2212  =  ETH
    Total coll = 8 (non-liquidated) + 2 * 0.995 (liquidated and redistributed)
    */

		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(C_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset))
		)
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(C_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset))
		)
		const totalBeforeL2_Asset = A_collAfterL1_Asset.add(B_collAfterL1_Asset).add(D_coll_Asset).add(E_coll_Asset)
		const expected_A_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalBeforeL2_Asset)
		)
		const expected_B_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalBeforeL2_Asset)
		)
		const expected_D_Asset = D_coll_Asset.add(
			D_coll_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalBeforeL2_Asset)
		)
		const expected_E_Asset = E_coll_Asset.add(
			E_coll_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalBeforeL2_Asset)
		)

		assert.isAtMost(th.getDifference(alice_Coll_Asset, expected_A_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_Asset), 1000)
		assert.isAtMost(th.getDifference(dennis_Coll_Asset, expected_D_Asset), 1000)
		assert.isAtMost(th.getDifference(erin_Coll_Asset, expected_E_Asset), 1000)

		const entireSystemColl_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()

		assert.equal(
			entireSystemColl_Asset,
			A_coll_Asset.add(B_coll_Asset)
				.add(D_coll_Asset)
				.add(E_coll_Asset)
				.add(th.applyLiquidationFee(C_coll_Asset.add(F_coll_Asset)))
		)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})
	////

	it("redistribution: Sequence of alternate opening/liquidation: final surviving vessel has ETH from all previously liquidated vessels", async () => {
		// A, B  open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: bob },
		})

		// Price drops to 1 $/E
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// L1: A liquidated

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, alice)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, alice))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		// C, opens vessel
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: carol },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// L2: B Liquidated

		const txB_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)
		assert.isTrue(txB_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		// D opens vessel
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// L3: C Liquidated

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		// E opens vessel
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: erin },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// L4: D Liquidated

		const txD_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txD_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		// F opens vessel
		const { collateral: F_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(210, 16)),
			extraParams: { from: freddy },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// L5: E Liquidated

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, erin)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))

		// Get entire coll of A, B, D, E and F

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()
		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()
		const carol_Coll_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()
		const dennis_Coll_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, dennis))
			.toString()
		const erin_Coll_Asset = (await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, erin))
			.toString()

		const freddy_rawColl_Asset = (await vesselManager.Vessels(freddy, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const freddy_ETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, freddy)).toString()

		/* Expected collateral:
     A-E should have been liquidated
     vessel F should have acquired all ETH in the system: 1 ETH initial coll, and 0.995^5+0.995^4+0.995^3+0.995^2+0.995 from rewards = 5.925 ETH
    */

		assert.isAtMost(th.getDifference(alice_Coll_Asset, "0"), 1000)
		assert.isAtMost(th.getDifference(bob_Coll_Asset, "0"), 1000)
		assert.isAtMost(th.getDifference(carol_Coll_Asset, "0"), 1000)
		assert.isAtMost(th.getDifference(dennis_Coll_Asset, "0"), 1000)
		assert.isAtMost(th.getDifference(erin_Coll_Asset, "0"), 1000)

		assert.isAtMost(th.getDifference(freddy_rawColl_Asset, F_coll_Asset), 1000)

		const gainedETH_Asset = th.applyLiquidationFee(
			E_coll_Asset.add(
				th.applyLiquidationFee(
					D_coll_Asset.add(
						th.applyLiquidationFee(
							C_coll_Asset.add(th.applyLiquidationFee(B_coll_Asset.add(th.applyLiquidationFee(A_coll_Asset))))
						)
					)
				)
			)
		)
		assert.isAtMost(th.getDifference(freddy_ETHReward_Asset, gainedETH_Asset), 1000)

		const entireSystemColl_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()

		assert.isAtMost(th.getDifference(entireSystemColl_Asset, F_coll_Asset.add(gainedETH_Asset)), 1000)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(1000, 18)).toString())
	})

	// ---Vessel adds collateral ---

	// Test based on scenario in: https://docs.google.com/spreadsheets/d/1F5p3nZy749K5jwO-bwJeTsRoY7ewMfWIQ3QHtokxqzo/edit?usp=sharing
	it("redistribution: A,B,C,D,E open. Liq(A). B adds coll. Liq(C). B and D have correct coll and debt", async () => {
		// A, B, C, D, E open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: A },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: B },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: C },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(20000, 16)),
			extraVUSDAmount: dec(10, 18),
			extraParams: { from: D },
		})
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: E },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate A
		// console.log(`ICR A: ${await vesselManager.getCurrentICR(A, price)}`)

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, A)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, A))

		// Check entireColl for each vessel:

		const B_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, B, erc20.address)).entireColl
		const C_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, C, erc20.address)).entireColl
		const D_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, D, erc20.address)).entireColl
		const E_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, E, erc20.address)).entireColl

		const totalCollAfterL1_Asset = B_coll_Asset.add(C_coll_Asset).add(D_coll_Asset).add(E_coll_Asset)
		const B_collAfterL1_Asset = B_coll_Asset.add(
			th.applyLiquidationFee(A_coll_Asset).mul(B_coll_Asset).div(totalCollAfterL1_Asset)
		)
		const C_collAfterL1_Asset = C_coll_Asset.add(
			th.applyLiquidationFee(A_coll_Asset).mul(C_coll_Asset).div(totalCollAfterL1_Asset)
		)
		const D_collAfterL1_Asset = D_coll_Asset.add(
			th.applyLiquidationFee(A_coll_Asset).mul(D_coll_Asset).div(totalCollAfterL1_Asset)
		)
		const E_collAfterL1_Asset = E_coll_Asset.add(
			th.applyLiquidationFee(A_coll_Asset).mul(E_coll_Asset).div(totalCollAfterL1_Asset)
		)

		assert.isAtMost(getDifference(B_entireColl_1_Asset, B_collAfterL1_Asset), 1e8)
		assert.isAtMost(getDifference(C_entireColl_1_Asset, C_collAfterL1_Asset), 1e8)
		assert.isAtMost(getDifference(D_entireColl_1_Asset, D_collAfterL1_Asset), 1e8)
		assert.isAtMost(getDifference(E_entireColl_1_Asset, E_collAfterL1_Asset), 1e8)

		// Bob adds 1 ETH to his vessel
		const addedColl1 = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, addedColl1, B, B, { from: B })

		// Liquidate C

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, C)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, C))

		const B_entireColl_2_Asset = (await th.getEntireCollAndDebt(contracts, B, erc20.address)).entireColl
		const D_entireColl_2_Asset = (await th.getEntireCollAndDebt(contracts, D, erc20.address)).entireColl
		const E_entireColl_2_Asset = (await th.getEntireCollAndDebt(contracts, E, erc20.address)).entireColl

		const totalCollAfterL2_Asset = B_collAfterL1_Asset.add(addedColl1).add(D_collAfterL1_Asset).add(E_collAfterL1_Asset)
		const B_collAfterL2_Asset = B_collAfterL1_Asset.add(addedColl1).add(
			th.applyLiquidationFee(C_collAfterL1_Asset).mul(B_collAfterL1_Asset.add(addedColl1)).div(totalCollAfterL2_Asset)
		)
		const D_collAfterL2_Asset = D_collAfterL1_Asset.add(
			th.applyLiquidationFee(C_collAfterL1_Asset).mul(D_collAfterL1_Asset).div(totalCollAfterL2_Asset)
		)
		const E_collAfterL2_Asset = E_collAfterL1_Asset.add(
			th.applyLiquidationFee(C_collAfterL1_Asset).mul(E_collAfterL1_Asset).div(totalCollAfterL2_Asset)
		)

		// console.log(`D_entireColl_2: ${D_entireColl_2}`)
		// console.log(`E_entireColl_2: ${E_entireColl_2}`)
		//assert.isAtMost(getDifference(B_entireColl_2, B_collAfterL2), 1e8)

		assert.isAtMost(getDifference(D_entireColl_2_Asset, D_collAfterL2_Asset), 1e8)
		assert.isAtMost(getDifference(E_entireColl_2_Asset, E_collAfterL2_Asset), 1e8)

		// Bob adds 1 ETH to his vessel
		const addedColl2 = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, addedColl2, B, B, { from: B })

		// Liquidate E

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, E)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, E))

		const totalCollAfterL3_Asset = B_collAfterL2_Asset.add(addedColl2).add(D_collAfterL2_Asset)
		const B_collAfterL3_Asset = B_collAfterL2_Asset.add(addedColl2).add(
			th.applyLiquidationFee(E_collAfterL2_Asset).mul(B_collAfterL2_Asset.add(addedColl2)).div(totalCollAfterL3_Asset)
		)
		const D_collAfterL3_Asset = D_collAfterL2_Asset.add(
			th.applyLiquidationFee(E_collAfterL2_Asset).mul(D_collAfterL2_Asset).div(totalCollAfterL3_Asset)
		)

		const B_entireColl_3_Asset = (await th.getEntireCollAndDebt(contracts, B, erc20.address)).entireColl
		const D_entireColl_3_Asset = (await th.getEntireCollAndDebt(contracts, D, erc20.address)).entireColl

		const diff_entireColl_B_Asset = getDifference(B_entireColl_3_Asset, B_collAfterL3_Asset)
		const diff_entireColl_D_Asset = getDifference(D_entireColl_3_Asset, D_collAfterL3_Asset)

		assert.isAtMost(diff_entireColl_B_Asset, 1e8)
		assert.isAtMost(diff_entireColl_D_Asset, 1e8)
	})

	// Test based on scenario in: https://docs.google.com/spreadsheets/d/1F5p3nZy749K5jwO-bwJeTsRoY7ewMfWIQ3QHtokxqzo/edit?usp=sharing
	it("redistribution: A,B,C,D open. Liq(A). B adds coll. Liq(C). B and D have correct coll and debt", async () => {
		// A, B, C, D, E open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: A },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: B },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: C },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(20000, 16)),
			extraVUSDAmount: dec(10, 18),
			extraParams: { from: D },
		})
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100000, 18),
			extraParams: { from: E },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Check entireColl for each vessel:

		const A_entireColl_0_Asset = (await th.getEntireCollAndDebt(contracts, A, erc20.address)).entireColl
		const B_entireColl_0_Asset = (await th.getEntireCollAndDebt(contracts, B, erc20.address)).entireColl
		const C_entireColl_0_Asset = (await th.getEntireCollAndDebt(contracts, C, erc20.address)).entireColl
		const D_entireColl_0_Asset = (await th.getEntireCollAndDebt(contracts, D, erc20.address)).entireColl
		const E_entireColl_0_Asset = (await th.getEntireCollAndDebt(contracts, E, erc20.address)).entireColl

		// entireSystemColl, excluding A
		const denominatorColl_1_Asset = (await vesselManager.getEntireSystemColl(erc20.address)).sub(A_entireColl_0_Asset)

		// Liquidate A
		// console.log(`ICR A: ${await vesselManager.getCurrentICR(A, price)}`)

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, A)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, A))

		const A_collRedistribution_Asset = A_entireColl_0_Asset.mul(toBN(995)).div(toBN(1000)) // remove the gas comp

		// console.log(`A_collRedistribution: ${A_collRedistribution}`)
		// Check accumulated ETH gain for each vessel

		const B_ETHGain_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, B)
		const C_ETHGain_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, C)
		const D_ETHGain_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, D)
		const E_ETHGain_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, E)

		// Check gains are what we'd expect from a distribution proportional to each vessel's entire coll

		const B_expectedPendingETH_1_Asset =
			A_collRedistribution_Asset.mul(B_entireColl_0_Asset).div(denominatorColl_1_Asset)
		const C_expectedPendingETH_1_Asset =
			A_collRedistribution_Asset.mul(C_entireColl_0_Asset).div(denominatorColl_1_Asset)
		const D_expectedPendingETH_1_Asset =
			A_collRedistribution_Asset.mul(D_entireColl_0_Asset).div(denominatorColl_1_Asset)
		const E_expectedPendingETH_1_Asset =
			A_collRedistribution_Asset.mul(E_entireColl_0_Asset).div(denominatorColl_1_Asset)

		assert.isAtMost(getDifference(B_expectedPendingETH_1_Asset, B_ETHGain_1_Asset), 1e8)
		assert.isAtMost(getDifference(C_expectedPendingETH_1_Asset, C_ETHGain_1_Asset), 1e8)
		assert.isAtMost(getDifference(D_expectedPendingETH_1_Asset, D_ETHGain_1_Asset), 1e8)
		assert.isAtMost(getDifference(E_expectedPendingETH_1_Asset, E_ETHGain_1_Asset), 1e8)

		// // Bob adds 1 ETH to his vessel
		await borrowerOperations.addColl(erc20.address, dec(1, "ether"), B, B, { from: B })

		// Check entireColl for each vessel

		const B_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, B, erc20.address)).entireColl
		const C_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, C, erc20.address)).entireColl
		const D_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, D, erc20.address)).entireColl
		const E_entireColl_1_Asset = (await th.getEntireCollAndDebt(contracts, E, erc20.address)).entireColl

		// entireSystemColl, excluding C
		const denominatorColl_2_Asset = (await vesselManager.getEntireSystemColl(erc20.address)).sub(C_entireColl_1_Asset)

		// Liquidate C

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, C)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, C))

		const C_collRedistribution_Asset = C_entireColl_1_Asset.mul(toBN(995)).div(toBN(1000)) // remove the gas comp
		// console.log(`C_collRedistribution: ${C_collRedistribution}`)

		const B_ETHGain_2_Asset = await vesselManager.getPendingAssetReward(erc20.address, B)
		const D_ETHGain_2_Asset = await vesselManager.getPendingAssetReward(erc20.address, D)
		const E_ETHGain_2_Asset = await vesselManager.getPendingAssetReward(erc20.address, E)

		// Since B topped up, he has no previous pending ETH gain

		const B_expectedPendingETH_2_Asset =
			C_collRedistribution_Asset.mul(B_entireColl_1_Asset).div(denominatorColl_2_Asset)

		// D & E's accumulated pending ETH gain includes their previous gain

		const D_expectedPendingETH_2_Asset = C_collRedistribution_Asset.mul(D_entireColl_1_Asset)
			.div(denominatorColl_2_Asset)
			.add(D_expectedPendingETH_1_Asset)

		const E_expectedPendingETH_2_Asset = C_collRedistribution_Asset.mul(E_entireColl_1_Asset)
			.div(denominatorColl_2_Asset)
			.add(E_expectedPendingETH_1_Asset)

		assert.isAtMost(getDifference(B_expectedPendingETH_2_Asset, B_ETHGain_2_Asset), 1e8)
		assert.isAtMost(getDifference(D_expectedPendingETH_2_Asset, D_ETHGain_2_Asset), 1e8)
		assert.isAtMost(getDifference(E_expectedPendingETH_2_Asset, E_ETHGain_2_Asset), 1e8)

		// // Bob adds 1 ETH to his vessel
		await borrowerOperations.addColl(erc20.address, dec(1, "ether"), B, B, { from: B })

		// Check entireColl for each vessel

		const B_entireColl_2_Asset = (await th.getEntireCollAndDebt(contracts, B, erc20.address)).entireColl
		const D_entireColl_2_Asset = (await th.getEntireCollAndDebt(contracts, D, erc20.address)).entireColl
		const E_entireColl_2_Asset = (await th.getEntireCollAndDebt(contracts, E, erc20.address)).entireColl

		// entireSystemColl, excluding E
		const denominatorColl_3_Asset = (await vesselManager.getEntireSystemColl(erc20.address)).sub(E_entireColl_2_Asset)

		// Liquidate E

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, E)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, E))

		const E_collRedistribution_Asset = E_entireColl_2_Asset.mul(toBN(995)).div(toBN(1000)) // remove the gas comp
		// console.log(`E_collRedistribution: ${E_collRedistribution}`)

		const B_ETHGain_3_Asset = await vesselManager.getPendingAssetReward(erc20.address, B)
		const D_ETHGain_3_Asset = await vesselManager.getPendingAssetReward(erc20.address, D)

		// Since B topped up, he has no previous pending ETH gain

		const B_expectedPendingETH_3_Asset =
			E_collRedistribution_Asset.mul(B_entireColl_2_Asset).div(denominatorColl_3_Asset)

		// D'S accumulated pending ETH gain includes their previous gain

		const D_expectedPendingETH_3_Asset = E_collRedistribution_Asset.mul(D_entireColl_2_Asset)
			.div(denominatorColl_3_Asset)
			.add(D_expectedPendingETH_2_Asset)

		assert.isAtMost(getDifference(B_expectedPendingETH_3_Asset, B_ETHGain_3_Asset), 1e8)
		assert.isAtMost(getDifference(D_expectedPendingETH_3_Asset, D_ETHGain_3_Asset), 1e8)
	})

	it("redistribution: A,B,C Open. Liq(C). B adds coll. Liq(A). B acquires all coll and debt", async () => {
		// A, B, C open vessels

		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Carol

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		//Bob adds ETH to his vessel
		const addedColl = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, addedColl, bob, bob, { from: bob })

		// Alice withdraws
		await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			await getNetBorrowingAmount(A_totalDebt_Asset, erc20.address),
			alice,
			alice,
			{ from: alice }
		)

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Alice

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, alice)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, alice))

		// Expect Bob now holds all Ether and VUSDDebt in the system: 2 + 0.4975+0.4975*0.995+0.995 Ether and 110*3 VUSD (10 each for gas compensation)

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const bob_VUSDDebt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]
			.add(await vesselManager.getPendingDebtTokenReward(erc20.address, bob))
			.toString()

		const expected_B_coll_Asset = B_coll_Asset.add(addedColl)
			.add(th.applyLiquidationFee(A_coll_Asset))
			.add(th.applyLiquidationFee(C_coll_Asset).mul(B_coll_Asset).div(A_coll_Asset.add(B_coll_Asset)))
			.add(
				th.applyLiquidationFee(
					th.applyLiquidationFee(C_coll_Asset).mul(A_coll_Asset).div(A_coll_Asset.add(B_coll_Asset))
				)
			)

		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(
			th.getDifference(
				bob_VUSDDebt_Asset,
				A_totalDebt_Asset.mul(toBN(2)).add(B_totalDebt_Asset).add(C_totalDebt_Asset)
			),
			1000
		)
	})

	it("redistribution: A,B,C Open. Liq(C). B tops up coll. D Opens. Liq(D). Distributes correct rewards.", async () => {
		// A, B, C open vessels

		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Carol

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		//Bob adds ETH to his vessel
		const addedColl = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, addedColl, bob, bob, { from: bob })

		// D opens vessel

		const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate D

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		/* Bob rewards:
     L1: 1/2*0.995 ETH, 55 VUSD
     L2: (2.4975/3.995)*0.995 = 0.622 ETH , 110*(2.4975/3.995)= 68.77 VUSDDebt
    coll: 3.1195 ETH
    debt: 233.77 VUSDDebt
     Alice rewards:
    L1 1/2*0.995 ETH, 55 VUSD
    L2 (1.4975/3.995)*0.995 = 0.3730 ETH, 110*(1.4975/3.995) = 41.23 VUSDDebt
    coll: 1.8705 ETH
    debt: 146.23 VUSDDebt
    totalColl: 4.99 ETH
    totalDebt 380 VUSD (includes 50 each for gas compensation)
    */

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const bob_VUSDDebt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]
			.add(await vesselManager.getPendingDebtTokenReward(erc20.address, bob))
			.toString()

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const alice_VUSDDebt_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX]
			.add(await vesselManager.getPendingDebtTokenReward(erc20.address, alice))
			.toString()

		const totalCollAfterL1_Asset = A_coll_Asset.add(B_coll_Asset)
			.add(addedColl)
			.add(th.applyLiquidationFee(C_coll_Asset))
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(C_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset))
		).add(addedColl)
		const expected_B_coll_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const expected_B_debt_Asset = B_totalDebt_Asset.add(
			B_coll_Asset.mul(C_totalDebt_Asset).div(A_coll_Asset.add(B_coll_Asset))
		).add(B_collAfterL1_Asset.mul(D_totalDebt_Asset).div(totalCollAfterL1_Asset))

		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_VUSDDebt_Asset, expected_B_debt_Asset), 10000)

		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(C_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset))
		)
		const expected_A_coll_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const expected_A_debt_Asset = A_totalDebt_Asset.add(
			A_coll_Asset.mul(C_totalDebt_Asset).div(A_coll_Asset.add(B_coll_Asset))
		).add(A_collAfterL1_Asset.mul(D_totalDebt_Asset).div(totalCollAfterL1_Asset))

		assert.isAtMost(th.getDifference(alice_Coll_Asset, expected_A_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(alice_VUSDDebt_Asset, expected_A_debt_Asset), 10000)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	it("redistribution: Vessel with the majority stake tops up. A,B,C, D open. Liq(D). C tops up. E Enters, Liq(E). Distributes correct rewards", async () => {
		const _998_Ether = toBN("998000000000000000000")
		// A, B, C, D open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: _998_Ether,
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: dec(1000, "ether"),
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Dennis

		const txD_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txD_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		// Expected rewards:  alice: 1 ETH, bob: 1 ETH, carol: 998 ETH

		const alice_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, alice)
		const bob_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, bob)
		const carol_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, carol)

		//Expect 1000 + 1000*0.995 ETH in system now
		const entireSystemColl_1_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()

		assert.equal(
			entireSystemColl_1_Asset,
			A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset).add(th.applyLiquidationFee(D_coll_Asset))
		)

		const totalColl_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)

		th.assertIsApproximatelyEqual(
			alice_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(A_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			bob_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(B_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			carol_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(C_coll_Asset).div(totalColl_Asset)
		)

		//Carol adds 1 ETH to her vessel, brings it to 1992.01 total coll
		const C_addedColl = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, dec(1, "ether"), carol, carol, {
			from: carol,
		})

		//Expect 1996 ETH in system now
		const entireSystemColl_2_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		// E opens with another 1996 ETH
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: entireSystemColl_2_Asset,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: erin },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Erin

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, erin)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))

		/* Expected ETH rewards: 
     Carol = 1992.01/1996 * 1996*0.995 = 1982.05 ETH
     Alice = 1.995/1996 * 1996*0.995 = 1.985025 ETH
     Bob = 1.995/1996 * 1996*0.995 = 1.985025 ETH
    therefore, expected total collateral:
    Carol = 1991.01 + 1991.01 = 3974.06
    Alice = 1.995 + 1.985025 = 3.980025 ETH
    Bob = 1.995 + 1.985025 = 3.980025 ETH
    total = 3982.02 ETH
    */

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const carol_Coll_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()

		const totalCollAfterL1_Asset = A_coll_Asset.add(B_coll_Asset)
			.add(C_coll_Asset)
			.add(th.applyLiquidationFee(D_coll_Asset))
			.add(C_addedColl)
		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		)
		const expected_A_coll_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		)
		const expected_B_coll_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const C_collAfterL1_Asset = C_coll_Asset.add(
			C_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).add(C_addedColl)
		const expected_C_coll_Asset = C_collAfterL1_Asset.add(
			C_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)

		assert.isAtMost(th.getDifference(alice_Coll_Asset, expected_A_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(carol_Coll_Asset, expected_C_coll_Asset), 1000)

		//Expect 3982.02 ETH in system now
		const entireSystemColl_3_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()

		th.assertIsApproximatelyEqual(
			entireSystemColl_3_Asset,
			totalCollAfterL1_Asset.add(th.applyLiquidationFee(E_coll_Asset))
		)

		// check VUSD gas compensation
		th.assertIsApproximatelyEqual((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	it("redistribution: Vessel with the majority stake tops up. A,B,C, D open. Liq(D). A, B, C top up. E Enters, Liq(E). Distributes correct rewards", async () => {
		const _998_Ether = toBN("998000000000000000000")
		// A, B, C open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: _998_Ether,
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: dec(1000, "ether"),
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Dennis

		const txD_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txD_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		// Expected rewards:  alice: 1 ETH, bob: 1 ETH, carol: 998 ETH (*0.995)

		const alice_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, alice)
		const bob_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, bob)
		const carol_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, carol)

		//Expect 1995 ETH in system now
		const entireSystemColl_1_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()

		assert.equal(
			entireSystemColl_1_Asset,
			A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset).add(th.applyLiquidationFee(D_coll_Asset))
		)

		const totalColl_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)

		th.assertIsApproximatelyEqual(
			alice_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(A_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			bob_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(B_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			carol_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(C_coll_Asset).div(totalColl_Asset)
		)

		/* Alice, Bob, Carol each adds 1 ETH to their vessels, 
    bringing them to 2.995, 2.995, 1992.01 total coll each. */

		const addedColl = toBN(dec(1, "ether"))

		await borrowerOperations.addColl(erc20.address, addedColl, alice, alice, { from: alice })
		await borrowerOperations.addColl(erc20.address, addedColl, bob, bob, { from: bob })
		await borrowerOperations.addColl(erc20.address, addedColl, carol, carol, { from: carol })

		//Expect 1998 ETH in system now
		const entireSystemColl_2_Asset = (await activePool.getAssetBalance(erc20.address))
			.add(await defaultPool.getAssetBalance(erc20.address))
			.toString()

		// E opens with another 1998 ETH
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: entireSystemColl_2_Asset,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: erin },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Erin

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, erin)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))

		/* Expected ETH rewards: 
     Carol = 1992.01/1998 * 1998*0.995 = 1982.04995 ETH
     Alice = 2.995/1998 * 1998*0.995 = 2.980025 ETH
     Bob = 2.995/1998 * 1998*0.995 = 2.980025 ETH
    therefore, expected total collateral:
    Carol = 1992.01 + 1982.04995 = 3974.05995
    Alice = 2.995 + 2.980025 = 5.975025 ETH
    Bob = 2.995 + 2.980025 = 5.975025 ETH
    total = 3986.01 ETH
    */

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const carol_Coll_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()

		const totalCollAfterL1_Asset = A_coll_Asset.add(B_coll_Asset)
			.add(C_coll_Asset)
			.add(th.applyLiquidationFee(D_coll_Asset))
			.add(addedColl.mul(toBN(3)))
		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).add(addedColl)
		const expected_A_coll_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).add(addedColl)
		const expected_B_coll_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const C_collAfterL1_Asset = C_coll_Asset.add(
			C_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).add(addedColl)
		const expected_C_coll_Asset = C_collAfterL1_Asset.add(
			C_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)

		assert.isAtMost(th.getDifference(alice_Coll_Asset, expected_A_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(carol_Coll_Asset, expected_C_coll_Asset), 1000)

		//Expect 3986.01 ETH in system now
		const entireSystemColl_3_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		th.assertIsApproximatelyEqual(
			entireSystemColl_3_Asset,
			totalCollAfterL1_Asset.add(th.applyLiquidationFee(E_coll_Asset))
		)

		// check VUSD gas compensation
		th.assertIsApproximatelyEqual((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	// --- Vessel withdraws collateral ---

	it("redistribution: A,B,C Open. Liq(C). B withdraws coll. Liq(A). B acquires all coll and debt", async () => {
		// A, B, C open vessels

		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Carol

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		//Bob withdraws 0.5 ETH from his vessel
		const withdrawnColl = toBN(dec(500, "finney"))
		await borrowerOperations.withdrawColl(erc20.address, withdrawnColl, bob, bob, {
			from: bob,
		})

		// Alice withdraws
		await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			await getNetBorrowingAmount(A_totalDebt_Asset, erc20.address),
			alice,
			alice,
			{ from: alice }
		)

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Alice

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, alice)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, alice))

		// Expect Bob now holds all Ether and VUSDDebt in the system: 2.5 Ether and 300 VUSD
		// 1 + 0.995/2 - 0.5 + 1.4975*0.995

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const bob_VUSDDebt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]
			.add(await vesselManager.getPendingDebtTokenReward(erc20.address, bob))
			.toString()

		const expected_B_coll_Asset = B_coll_Asset.sub(withdrawnColl)
			.add(th.applyLiquidationFee(A_coll_Asset))
			.add(th.applyLiquidationFee(C_coll_Asset).mul(B_coll_Asset).div(A_coll_Asset.add(B_coll_Asset)))
			.add(
				th.applyLiquidationFee(
					th.applyLiquidationFee(C_coll_Asset).mul(A_coll_Asset).div(A_coll_Asset.add(B_coll_Asset))
				)
			)

		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(
			th.getDifference(
				bob_VUSDDebt_Asset,
				A_totalDebt_Asset.mul(toBN(2)).add(B_totalDebt_Asset).add(C_totalDebt_Asset)
			),
			1000
		)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	it("redistribution: A,B,C Open. Liq(C). B withdraws coll. D Opens. Liq(D). Distributes correct rewards.", async () => {
		// A, B, C open vessels

		const { collateral: A_coll_Asset, totalDebt: A_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset, totalDebt: B_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset, totalDebt: C_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Carol

		const txC_Asset = await vesselManagerOperations.liquidate(erc20.address, carol)
		assert.isTrue(txC_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, carol))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		//Bob  withdraws 0.5 ETH from his vessel
		const withdrawnColl = toBN(dec(500, "finney"))
		await borrowerOperations.withdrawColl(erc20.address, withdrawnColl, bob, bob, {
			from: bob,
		})

		// D opens vessel

		const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate D

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		/* Bob rewards:
     L1: 0.4975 ETH, 55 VUSD
     L2: (0.9975/2.495)*0.995 = 0.3978 ETH , 110*(0.9975/2.495)= 43.98 VUSDDebt
    coll: (1 + 0.4975 - 0.5 + 0.3968) = 1.3953 ETH
    debt: (110 + 55 + 43.98 = 208.98 VUSDDebt 
     Alice rewards:
    L1 0.4975, 55 VUSD
    L2 (1.4975/2.495)*0.995 = 0.5972 ETH, 110*(1.4975/2.495) = 66.022 VUSDDebt
    coll: (1 + 0.4975 + 0.5972) = 2.0947 ETH
    debt: (50 + 55 + 66.022) = 171.022 VUSD Debt
    totalColl: 3.49 ETH
    totalDebt 380 VUSD (Includes 50 in each vessel for gas compensation)
    */

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const bob_VUSDDebt_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]
			.add(await vesselManager.getPendingDebtTokenReward(erc20.address, bob))
			.toString()

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const alice_VUSDDebt_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX]
			.add(await vesselManager.getPendingDebtTokenReward(erc20.address, alice))
			.toString()

		const totalCollAfterL1_Asset = A_coll_Asset.add(B_coll_Asset)
			.sub(withdrawnColl)
			.add(th.applyLiquidationFee(C_coll_Asset))
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(C_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset))
		).sub(withdrawnColl)
		const expected_B_coll_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const expected_B_debt_Asset = B_totalDebt_Asset.add(
			B_coll_Asset.mul(C_totalDebt_Asset).div(A_coll_Asset.add(B_coll_Asset))
		).add(B_collAfterL1_Asset.mul(D_totalDebt_Asset).div(totalCollAfterL1_Asset))

		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_VUSDDebt_Asset, expected_B_debt_Asset), 10000)

		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(C_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset))
		)
		const expected_A_coll_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const expected_A_debt_Asset = A_totalDebt_Asset.add(
			A_coll_Asset.mul(C_totalDebt_Asset).div(A_coll_Asset.add(B_coll_Asset))
		).add(A_collAfterL1_Asset.mul(D_totalDebt_Asset).div(totalCollAfterL1_Asset))

		assert.isAtMost(th.getDifference(alice_Coll_Asset, expected_A_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(alice_VUSDDebt_Asset, expected_A_debt_Asset), 10000)

		const entireSystemColl_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		th.assertIsApproximatelyEqual(
			entireSystemColl_Asset,
			A_coll_Asset.add(B_coll_Asset)
				.add(th.applyLiquidationFee(C_coll_Asset))
				.sub(withdrawnColl)
				.add(th.applyLiquidationFee(D_coll_Asset))
		)

		const entireSystemDebt_Asset = (await activePool.getDebtTokenBalance(erc20.address)).add(
			await defaultPool.getDebtTokenBalance(erc20.address)
		)
		th.assertIsApproximatelyEqual(
			entireSystemDebt_Asset,
			A_totalDebt_Asset.add(B_totalDebt_Asset).add(C_totalDebt_Asset).add(D_totalDebt_Asset)
		)

		// check VUSD gas compensation
		th.assertIsApproximatelyEqual((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	it("redistribution: Vessel with the majority stake withdraws. A,B,C,D open. Liq(D). C withdraws some coll. E Enters, Liq(E). Distributes correct rewards", async () => {
		const _998_Ether = toBN("998000000000000000000")
		// A, B, C, D open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: _998_Ether,
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: dec(1000, "ether"),
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Dennis

		const txD_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txD_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		// Expected rewards:  alice: 1 ETH, bob: 1 ETH, carol: 998 ETH (*0.995)

		const alice_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, alice)
		const bob_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, bob)
		const carol_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, carol)

		//Expect 1995 ETH in system now
		const entireSystemColl_1_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		th.assertIsApproximatelyEqual(
			entireSystemColl_1_Asset,
			A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset).add(th.applyLiquidationFee(D_coll_Asset))
		)

		const totalColl_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)

		th.assertIsApproximatelyEqual(
			alice_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(A_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			bob_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(B_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			carol_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(C_coll_Asset).div(totalColl_Asset)
		)

		//Carol wthdraws 1 ETH from her vessel, brings it to 1990.01 total coll
		const C_withdrawnColl = toBN(dec(1, "ether"))
		await borrowerOperations.withdrawColl(erc20.address, C_withdrawnColl, carol, carol, {
			from: carol,
		})

		//Expect 1994 ETH in system now
		const entireSystemColl_2_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		// E opens with another 1994 ETH
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: entireSystemColl_2_Asset,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: erin },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Erin

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, erin)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))

		/* Expected ETH rewards: 
     Carol = 1990.01/1994 * 1994*0.995 = 1980.05995 ETH
     Alice = 1.995/1994 * 1994*0.995 = 1.985025 ETH
     Bob = 1.995/1994 * 1994*0.995 = 1.985025 ETH
    therefore, expected total collateral:
    Carol = 1990.01 + 1980.05995 = 3970.06995
    Alice = 1.995 + 1.985025 = 3.980025 ETH
    Bob = 1.995 + 1.985025 = 3.980025 ETH
    total = 3978.03 ETH
    */

		const alice_Coll_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const bob_Coll_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const carol_Coll_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()

		const totalCollAfterL1_Asset = A_coll_Asset.add(B_coll_Asset)
			.add(C_coll_Asset)
			.add(th.applyLiquidationFee(D_coll_Asset))
			.sub(C_withdrawnColl)
		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		)
		const expected_A_coll_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		)
		const expected_B_coll_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const C_collAfterL1_Asset = C_coll_Asset.add(
			C_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).sub(C_withdrawnColl)
		const expected_C_coll_Asset = C_collAfterL1_Asset.add(
			C_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)

		assert.isAtMost(th.getDifference(alice_Coll_Asset, expected_A_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_Coll_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(carol_Coll_Asset, expected_C_coll_Asset), 1000)

		//Expect 3978.03 ETH in system now
		const entireSystemColl_3_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		th.assertIsApproximatelyEqual(
			entireSystemColl_3_Asset,
			totalCollAfterL1_Asset.add(th.applyLiquidationFee(E_coll_Asset))
		)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	it("redistribution: Vessel with the majority stake withdraws. A,B,C,D open. Liq(D). A, B, C withdraw. E Enters, Liq(E). Distributes correct rewards", async () => {
		const _998_Ether = toBN("998000000000000000000")
		// A, B, C, D open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(400, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: _998_Ether,
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: carol },
		})
		const { collateral: D_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: dec(1000, "ether"),
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Dennis

		const txD_Asset = await vesselManagerOperations.liquidate(erc20.address, dennis)
		assert.isTrue(txD_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, dennis))

		// Price bounces back to 200 $/E
		await priceFeed.setPrice(erc20.address, dec(200, 18))

		// Expected rewards:  alice: 1 ETH, bob: 1 ETH, carol: 998 ETH (*0.995)

		const alice_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, alice)
		const bob_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, bob)
		const carol_ETHReward_1_Asset = await vesselManager.getPendingAssetReward(erc20.address, carol)

		//Expect 1995 ETH in system now
		const entireSystemColl_1_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		th.assertIsApproximatelyEqual(
			entireSystemColl_1_Asset,
			A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset).add(th.applyLiquidationFee(D_coll_Asset))
		)

		const totalColl_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)

		th.assertIsApproximatelyEqual(
			alice_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(A_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			bob_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(B_coll_Asset).div(totalColl_Asset)
		)
		th.assertIsApproximatelyEqual(
			carol_ETHReward_1_Asset.toString(),
			th.applyLiquidationFee(D_coll_Asset).mul(C_coll_Asset).div(totalColl_Asset)
		)

		/* Alice, Bob, Carol each withdraw 0.5 ETH to their vessels, 
    bringing them to 1.495, 1.495, 1990.51 total coll each. */
		const withdrawnColl = toBN(dec(500, "finney"))

		await borrowerOperations.withdrawColl(erc20.address, withdrawnColl, alice, alice, {
			from: alice,
		})
		await borrowerOperations.withdrawColl(erc20.address, withdrawnColl, bob, bob, {
			from: bob,
		})
		await borrowerOperations.withdrawColl(erc20.address, withdrawnColl, carol, carol, {
			from: carol,
		})

		const alice_Coll_1_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const carol_Coll_1_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()

		const totalColl_1_Asset = A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset)

		//Expect 1993.5 ETH in system now
		const entireSystemColl_2_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		// E opens with another 1993.5 ETH
		const { collateral: E_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: entireSystemColl_2_Asset,
			ICR: toBN(dec(200, 16)),
			extraParams: { from: erin },
		})

		// Price drops to 100 $/E
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Liquidate Erin

		const txE_Asset = await vesselManagerOperations.liquidate(erc20.address, erin)
		assert.isTrue(txE_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, erin))

		/* Expected ETH rewards: 
     Carol = 1990.51/1993.5 * 1993.5*0.995 = 1980.55745 ETH
     Alice = 1.495/1993.5 * 1993.5*0.995 = 1.487525 ETH
     Bob = 1.495/1993.5 * 1993.5*0.995 = 1.487525 ETH
    therefore, expected total collateral:
    Carol = 1990.51 + 1980.55745 = 3971.06745
    Alice = 1.495 + 1.487525 = 2.982525 ETH
    Bob = 1.495 + 1.487525 = 2.982525 ETH
    total = 3977.0325 ETH
    */

		const alice_Coll_2_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, alice))
			.toString()

		const bob_Coll_2_Asset = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, bob))
			.toString()

		const carol_Coll_2_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
			.add(await vesselManager.getPendingAssetReward(erc20.address, carol))
			.toString()

		const totalCollAfterL1_Asset = A_coll_Asset.add(B_coll_Asset)
			.add(C_coll_Asset)
			.add(th.applyLiquidationFee(D_coll_Asset))
			.sub(withdrawnColl.mul(toBN(3)))
		const A_collAfterL1_Asset = A_coll_Asset.add(
			A_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).sub(withdrawnColl)
		const expected_A_coll_Asset = A_collAfterL1_Asset.add(
			A_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const B_collAfterL1_Asset = B_coll_Asset.add(
			B_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).sub(withdrawnColl)
		const expected_B_coll_Asset = B_collAfterL1_Asset.add(
			B_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)
		const C_collAfterL1_Asset = C_coll_Asset.add(
			C_coll_Asset.mul(th.applyLiquidationFee(D_coll_Asset)).div(A_coll_Asset.add(B_coll_Asset).add(C_coll_Asset))
		).sub(withdrawnColl)
		const expected_C_coll_Asset = C_collAfterL1_Asset.add(
			C_collAfterL1_Asset.mul(th.applyLiquidationFee(E_coll_Asset)).div(totalCollAfterL1_Asset)
		)

		assert.isAtMost(th.getDifference(alice_Coll_2_Asset, expected_A_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(bob_Coll_2_Asset, expected_B_coll_Asset), 1000)
		assert.isAtMost(th.getDifference(carol_Coll_2_Asset, expected_C_coll_Asset), 1000)

		//Expect 3977.0325 ETH in system now
		const entireSystemColl_3_Asset = (await activePool.getAssetBalance(erc20.address)).add(
			await defaultPool.getAssetBalance(erc20.address)
		)

		th.assertIsApproximatelyEqual(
			entireSystemColl_3_Asset,
			totalCollAfterL1_Asset.add(th.applyLiquidationFee(E_coll_Asset))
		)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(400, 18)).toString())
	})

	// For calculations of correct values used in test, see scenario 1:
	// https://docs.google.com/spreadsheets/d/1F5p3nZy749K5jwO-bwJeTsRoY7ewMfWIQ3QHtokxqzo/edit?usp=sharing
	it("redistribution, all operations: A,B,C open. Liq(A). D opens. B adds, C withdraws. Liq(B). E & F open. D adds. Liq(F). Distributes correct rewards", async () => {
		// A, B, C open vessels

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: carol },
		})

		// Price drops to 1 $/E
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// Liquidate A

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, alice)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, alice))

		// Check rewards for B and C

		const B_pendingRewardsAfterL1_Asset = th
			.applyLiquidationFee(A_coll_Asset)
			.mul(B_coll_Asset)
			.div(B_coll_Asset.add(C_coll_Asset))
		const C_pendingRewardsAfterL1_Asset = th
			.applyLiquidationFee(A_coll_Asset)
			.mul(C_coll_Asset)
			.div(B_coll_Asset.add(C_coll_Asset))

		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, bob), B_pendingRewardsAfterL1_Asset),
			1000000
		)
		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, carol), C_pendingRewardsAfterL1_Asset),
			1000000
		)

		const totalStakesSnapshotAfterL1_Asset = B_coll_Asset.add(C_coll_Asset)
		const totalCollateralSnapshotAfterL1_Asset = totalStakesSnapshotAfterL1_Asset.add(
			th.applyLiquidationFee(A_coll_Asset)
		)
		th.assertIsApproximatelyEqual(
			await vesselManager.totalStakesSnapshot(erc20.address),
			totalStakesSnapshotAfterL1_Asset
		)
		th.assertIsApproximatelyEqual(
			await vesselManager.totalCollateralSnapshot(erc20.address),
			totalCollateralSnapshotAfterL1_Asset
		)

		// Price rises to 1000
		await priceFeed.setPrice(erc20.address, dec(1000, 18))

		// D opens vessel

		const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: dennis },
		})

		//Bob adds 1 ETH to his vessel
		const B_addedColl = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, B_addedColl, bob, bob, { from: bob })

		//Carol  withdraws 1 ETH from her vessel
		const C_withdrawnColl = toBN(dec(1, "ether"))
		await borrowerOperations.withdrawColl(erc20.address, C_withdrawnColl, carol, carol, {
			from: carol,
		})

		const B_collAfterL1_Asset = B_coll_Asset.add(B_pendingRewardsAfterL1_Asset).add(B_addedColl)
		const C_collAfterL1_Asset = C_coll_Asset.add(C_pendingRewardsAfterL1_Asset).sub(C_withdrawnColl)

		// Price drops
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// Liquidate B

		const txB_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)
		assert.isTrue(txB_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Check rewards for C and D

		const C_pendingRewardsAfterL2_Asset = C_collAfterL1_Asset.mul(th.applyLiquidationFee(B_collAfterL1_Asset)).div(
			C_collAfterL1_Asset.add(D_coll_Asset)
		)
		const D_pendingRewardsAfterL2_Asset = D_coll_Asset.mul(th.applyLiquidationFee(B_collAfterL1_Asset)).div(
			C_collAfterL1_Asset.add(D_coll_Asset)
		)

		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, carol), C_pendingRewardsAfterL2_Asset),
			1000000
		)
		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, dennis), D_pendingRewardsAfterL2_Asset),
			1000000
		)

		const totalStakesSnapshotAfterL2_Asset = totalStakesSnapshotAfterL1_Asset
			.add(D_coll_Asset.mul(totalStakesSnapshotAfterL1_Asset).div(totalCollateralSnapshotAfterL1_Asset))
			.sub(B_coll_Asset)
			.sub(C_withdrawnColl.mul(totalStakesSnapshotAfterL1_Asset).div(totalCollateralSnapshotAfterL1_Asset))
		const defaultedAmountAfterL2_Asset = th
			.applyLiquidationFee(B_coll_Asset.add(B_addedColl).add(B_pendingRewardsAfterL1_Asset))
			.add(C_pendingRewardsAfterL1_Asset)
		const totalCollateralSnapshotAfterL2_Asset = C_coll_Asset.sub(C_withdrawnColl)
			.add(D_coll_Asset)
			.add(defaultedAmountAfterL2_Asset)

		th.assertIsApproximatelyEqual(
			await vesselManager.totalStakesSnapshot(erc20.address),
			totalStakesSnapshotAfterL2_Asset
		)
		th.assertIsApproximatelyEqual(
			await vesselManager.totalCollateralSnapshot(erc20.address),
			totalCollateralSnapshotAfterL2_Asset
		)

		// Price rises to 1000
		await priceFeed.setPrice(erc20.address, dec(1000, 18))

		// E and F open vessels

		const { collateral: E_coll_Asset, totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: erin },
		})
		const { collateral: F_coll_Asset, totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 16)),
			extraVUSDAmount: dec(110, 18),
			extraParams: { from: freddy },
		})

		// D tops up
		const D_addedColl = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, D_addedColl, dennis, dennis, {
			from: dennis,
		})

		// Price drops to 1
		await priceFeed.setPrice(erc20.address, dec(1, 18))

		// Liquidate F

		const txF_Asset = await vesselManagerOperations.liquidate(erc20.address, freddy)
		assert.isTrue(txF_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))

		// Grab remaining vessels' collateral

		const carol_rawColl_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const carol_pendingETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, carol)).toString()

		const dennis_rawColl_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const dennis_pendingETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, dennis)).toString()

		const erin_rawColl_Asset = (await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const erin_pendingETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, erin)).toString()

		// Check raw collateral of C, D, E

		const C_collAfterL2_Asset = C_collAfterL1_Asset.add(C_pendingRewardsAfterL2_Asset)
		const D_collAfterL2_Asset = D_coll_Asset.add(D_pendingRewardsAfterL2_Asset).add(D_addedColl)
		const totalCollForL3_Asset = C_collAfterL2_Asset.add(D_collAfterL2_Asset).add(E_coll_Asset)
		const C_collAfterL3_Asset = C_collAfterL2_Asset.add(
			C_collAfterL2_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalCollForL3_Asset)
		)
		const D_collAfterL3_Asset = D_collAfterL2_Asset.add(
			D_collAfterL2_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalCollForL3_Asset)
		)
		const E_collAfterL3_Asset = E_coll_Asset.add(
			E_coll_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalCollForL3_Asset)
		)

		assert.isAtMost(th.getDifference(carol_rawColl_Asset, C_collAfterL1_Asset), 1000)
		assert.isAtMost(th.getDifference(dennis_rawColl_Asset, D_collAfterL2_Asset), 1000000)
		assert.isAtMost(th.getDifference(erin_rawColl_Asset, E_coll_Asset), 1000)

		// Check pending ETH rewards of C, D, E

		assert.isAtMost(
			th.getDifference(carol_pendingETHReward_Asset, C_collAfterL3_Asset.sub(C_collAfterL1_Asset)),
			1000000
		)
		assert.isAtMost(
			th.getDifference(dennis_pendingETHReward_Asset, D_collAfterL3_Asset.sub(D_collAfterL2_Asset)),
			1000000
		)
		assert.isAtMost(th.getDifference(erin_pendingETHReward_Asset, E_collAfterL3_Asset.sub(E_coll_Asset)), 1000000)

		// Check systemic collateral

		const activeColl_Asset = (await activePool.getAssetBalance(erc20.address)).toString()
		const defaultColl_Asset = (await defaultPool.getAssetBalance(erc20.address)).toString()

		assert.isAtMost(
			th.getDifference(activeColl_Asset, C_collAfterL1_Asset.add(D_collAfterL2_Asset.add(E_coll_Asset))),
			1000000
		)
		assert.isAtMost(
			th.getDifference(
				defaultColl_Asset,
				C_collAfterL3_Asset.sub(C_collAfterL1_Asset)
					.add(D_collAfterL3_Asset.sub(D_collAfterL2_Asset))
					.add(E_collAfterL3_Asset.sub(E_coll_Asset))
			),
			1000000
		)

		// Check system snapshots

		const totalStakesSnapshotAfterL3_Asset = totalStakesSnapshotAfterL2_Asset.add(
			D_addedColl.add(E_coll_Asset).mul(totalStakesSnapshotAfterL2_Asset).div(totalCollateralSnapshotAfterL2_Asset)
		)
		const totalCollateralSnapshotAfterL3_Asset = C_coll_Asset.sub(C_withdrawnColl)
			.add(D_coll_Asset)
			.add(D_addedColl)
			.add(E_coll_Asset)
			.add(defaultedAmountAfterL2_Asset)
			.add(th.applyLiquidationFee(F_coll_Asset))
		const totalStakesSnapshot_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		th.assertIsApproximatelyEqual(totalStakesSnapshot_Asset, totalStakesSnapshotAfterL3_Asset)
		th.assertIsApproximatelyEqual(totalCollateralSnapshot_Asset, totalCollateralSnapshotAfterL3_Asset)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(600, 18)).toString())
	})

	// For calculations of correct values used in test, see scenario 2:
	// https://docs.google.com/spreadsheets/d/1F5p3nZy749K5jwO-bwJeTsRoY7ewMfWIQ3QHtokxqzo/edit?usp=sharing
	it("redistribution, all operations: A,B,C open. Liq(A). D opens. B adds, C withdraws. Liq(B). E & F open. D adds. Liq(F). Varying coll. Distributes correct rewards", async () => {
		/* A, B, C open vessels.
    A: 450 ETH
    B: 8901 ETH
    C: 23.902 ETH
    */

		const { collateral: A_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: toBN("450000000000000000000"),
			ICR: toBN(dec(90000, 16)),
			extraParams: { from: alice },
		})
		const { collateral: B_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: toBN("8901000000000000000000"),
			ICR: toBN(dec(1800000, 16)),
			extraParams: { from: bob },
		})
		const { collateral: C_coll_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: toBN("23902000000000000000"),
			ICR: toBN(dec(4600, 16)),
			extraParams: { from: carol },
		})

		// Price drops
		await priceFeed.setPrice(erc20.address, "1")

		// Liquidate A

		const txA_Asset = await vesselManagerOperations.liquidate(erc20.address, alice)
		assert.isTrue(txA_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, alice))

		// Check rewards for B and C

		const B_pendingRewardsAfterL1_Asset = th
			.applyLiquidationFee(A_coll_Asset)
			.mul(B_coll_Asset)
			.div(B_coll_Asset.add(C_coll_Asset))
		const C_pendingRewardsAfterL1_Asset = th
			.applyLiquidationFee(A_coll_Asset)
			.mul(C_coll_Asset)
			.div(B_coll_Asset.add(C_coll_Asset))

		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, bob), B_pendingRewardsAfterL1_Asset),
			1000000
		)
		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, carol), C_pendingRewardsAfterL1_Asset),
			1000000
		)

		const totalStakesSnapshotAfterL1_Asset = B_coll_Asset.add(C_coll_Asset)
		const totalCollateralSnapshotAfterL1_Asset = totalStakesSnapshotAfterL1_Asset.add(
			th.applyLiquidationFee(A_coll_Asset)
		)

		th.assertIsApproximatelyEqual(
			await vesselManager.totalStakesSnapshot(erc20.address),
			totalStakesSnapshotAfterL1_Asset
		)
		th.assertIsApproximatelyEqual(
			await vesselManager.totalCollateralSnapshot(erc20.address),
			totalCollateralSnapshotAfterL1_Asset
		)

		// Price rises
		await priceFeed.setPrice(erc20.address, dec(1, 27))

		// D opens vessel: 0.035 ETH

		const { collateral: D_coll_Asset, totalDebt: D_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: toBN(dec(35, 15)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: dennis },
		})

		// Bob adds 11.33909 ETH to his vessel
		const B_addedColl = toBN("11339090000000000000")
		await borrowerOperations.addColl(erc20.address, B_addedColl, bob, bob, { from: bob })

		// Carol withdraws 15 ETH from her vessel
		const C_withdrawnColl = toBN(dec(15, "ether"))
		await borrowerOperations.withdrawColl(erc20.address, C_withdrawnColl, carol, carol, {
			from: carol,
		})

		const B_collAfterL1_Asset = B_coll_Asset.add(B_pendingRewardsAfterL1_Asset).add(B_addedColl)
		const C_collAfterL1_Asset = C_coll_Asset.add(C_pendingRewardsAfterL1_Asset).sub(C_withdrawnColl)

		// Price drops
		await priceFeed.setPrice(erc20.address, "1")

		// Liquidate B

		const txB_Asset = await vesselManagerOperations.liquidate(erc20.address, bob)
		assert.isTrue(txB_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, bob))

		// Check rewards for C and D

		const C_pendingRewardsAfterL2_Asset = C_collAfterL1_Asset.mul(th.applyLiquidationFee(B_collAfterL1_Asset)).div(
			C_collAfterL1_Asset.add(D_coll_Asset)
		)
		const D_pendingRewardsAfterL2_Asset = D_coll_Asset.mul(th.applyLiquidationFee(B_collAfterL1_Asset)).div(
			C_collAfterL1_Asset.add(D_coll_Asset)
		)
		const C_collAfterL2_Asset = C_collAfterL1_Asset.add(C_pendingRewardsAfterL2_Asset)

		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, carol), C_pendingRewardsAfterL2_Asset),
			10000000
		)
		assert.isAtMost(
			th.getDifference(await vesselManager.getPendingAssetReward(erc20.address, dennis), D_pendingRewardsAfterL2_Asset),
			10000000
		)

		const totalStakesSnapshotAfterL2_Asset = totalStakesSnapshotAfterL1_Asset
			.add(D_coll_Asset.mul(totalStakesSnapshotAfterL1_Asset).div(totalCollateralSnapshotAfterL1_Asset))
			.sub(B_coll_Asset)
			.sub(C_withdrawnColl.mul(totalStakesSnapshotAfterL1_Asset).div(totalCollateralSnapshotAfterL1_Asset))
		const defaultedAmountAfterL2_Asset = th
			.applyLiquidationFee(B_coll_Asset.add(B_addedColl).add(B_pendingRewardsAfterL1_Asset))
			.add(C_pendingRewardsAfterL1_Asset)
		const totalCollateralSnapshotAfterL2_Asset = C_coll_Asset.sub(C_withdrawnColl)
			.add(D_coll_Asset)
			.add(defaultedAmountAfterL2_Asset)

		th.assertIsApproximatelyEqual(
			await vesselManager.totalStakesSnapshot(erc20.address),
			totalStakesSnapshotAfterL2_Asset
		)
		th.assertIsApproximatelyEqual(
			await vesselManager.totalCollateralSnapshot(erc20.address),
			totalCollateralSnapshotAfterL2_Asset
		)

		// Price rises
		await priceFeed.setPrice(erc20.address, dec(1, 27))

		/* E and F open vessels.
    E: 10000 ETH
    F: 0.0007 ETH
    */
		const { collateral: E_coll_Asset, totalDebt: E_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: toBN(dec(1, 22)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: erin },
		})
		const { collateral: F_coll_Asset, totalDebt: F_totalDebt_Asset } = await openVessel({
			asset: erc20.address,
			assetSent: toBN("700000000000000"),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: freddy },
		})

		// D tops up
		const D_addedColl = toBN(dec(1, "ether"))
		await borrowerOperations.addColl(erc20.address, D_addedColl, dennis, dennis, {
			from: dennis,
		})

		const D_collAfterL2_Asset = D_coll_Asset.add(D_pendingRewardsAfterL2_Asset).add(D_addedColl)

		// Price drops
		await priceFeed.setPrice(erc20.address, "1")

		// Liquidate F

		const txF_Asset = await vesselManagerOperations.liquidate(erc20.address, freddy)
		assert.isTrue(txF_Asset.receipt.status)
		assert.isFalse(await sortedVessels.contains(erc20.address, freddy))

		// Grab remaining vessels' collateral

		const carol_rawColl_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const carol_pendingETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, carol)).toString()
		const carol_Stake_Asset = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STAKE_INDEX].toString()

		const dennis_rawColl_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const dennis_pendingETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, dennis)).toString()
		const dennis_Stake_Asset = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STAKE_INDEX].toString()

		const erin_rawColl_Asset = (await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_COLL_INDEX].toString()
		const erin_pendingETHReward_Asset = (await vesselManager.getPendingAssetReward(erc20.address, erin)).toString()
		const erin_Stake_Asset = (await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_STAKE_INDEX].toString()

		// Check raw collateral of C, D, E

		const totalCollForL3_Asset = C_collAfterL2_Asset.add(D_collAfterL2_Asset).add(E_coll_Asset)
		const C_collAfterL3_Asset = C_collAfterL2_Asset.add(
			C_collAfterL2_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalCollForL3_Asset)
		)
		const D_collAfterL3_Asset = D_collAfterL2_Asset.add(
			D_collAfterL2_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalCollForL3_Asset)
		)
		const E_collAfterL3_Asset = E_coll_Asset.add(
			E_coll_Asset.mul(th.applyLiquidationFee(F_coll_Asset)).div(totalCollForL3_Asset)
		)

		assert.isAtMost(th.getDifference(carol_rawColl_Asset, C_collAfterL1_Asset), 1000)
		assert.isAtMost(th.getDifference(dennis_rawColl_Asset, D_collAfterL2_Asset), 1000000)
		assert.isAtMost(th.getDifference(erin_rawColl_Asset, E_coll_Asset), 1000)

		// Check pending ETH rewards of C, D, E

		assert.isAtMost(
			th.getDifference(carol_pendingETHReward_Asset, C_collAfterL3_Asset.sub(C_collAfterL1_Asset)),
			1000000
		)
		assert.isAtMost(
			th.getDifference(dennis_pendingETHReward_Asset, D_collAfterL3_Asset.sub(D_collAfterL2_Asset)),
			1000000
		)
		assert.isAtMost(th.getDifference(erin_pendingETHReward_Asset, E_collAfterL3_Asset.sub(E_coll_Asset)), 1000000)

		// Check systemic collateral

		const activeColl_Asset = (await activePool.getAssetBalance(erc20.address)).toString()
		const defaultColl_Asset = (await defaultPool.getAssetBalance(erc20.address)).toString()

		assert.isAtMost(
			th.getDifference(activeColl_Asset, C_collAfterL1_Asset.add(D_collAfterL2_Asset.add(E_coll_Asset))),
			1000000
		)
		assert.isAtMost(
			th.getDifference(
				defaultColl_Asset,
				C_collAfterL3_Asset.sub(C_collAfterL1_Asset)
					.add(D_collAfterL3_Asset.sub(D_collAfterL2_Asset))
					.add(E_collAfterL3_Asset.sub(E_coll_Asset))
			),
			1000000
		)

		// Check system snapshots

		const totalStakesSnapshotAfterL3_Asset = totalStakesSnapshotAfterL2_Asset.add(
			D_addedColl.add(E_coll_Asset).mul(totalStakesSnapshotAfterL2_Asset).div(totalCollateralSnapshotAfterL2_Asset)
		)
		const totalCollateralSnapshotAfterL3_Asset = C_coll_Asset.sub(C_withdrawnColl)
			.add(D_coll_Asset)
			.add(D_addedColl)
			.add(E_coll_Asset)
			.add(defaultedAmountAfterL2_Asset)
			.add(th.applyLiquidationFee(F_coll_Asset))
		const totalStakesSnapshot_Asset = (await vesselManager.totalStakesSnapshot(erc20.address)).toString()
		const totalCollateralSnapshot_Asset = (await vesselManager.totalCollateralSnapshot(erc20.address)).toString()

		th.assertIsApproximatelyEqual(totalStakesSnapshot_Asset, totalStakesSnapshotAfterL3_Asset)
		th.assertIsApproximatelyEqual(totalCollateralSnapshot_Asset, totalCollateralSnapshotAfterL3_Asset)

		// check VUSD gas compensation
		assert.equal((await debtToken.balanceOf(owner)).toString(), toBN(dec(600, 18)).toString())
	})
})

contract("Reset chain state", async accounts => {})
