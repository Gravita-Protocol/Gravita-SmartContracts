const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const SortedVessels = artifacts.require("SortedVessels")
const SortedVesselsTester = artifacts.require("SortedVesselsTester")
const VesselManagerTester = artifacts.require("VesselManagerTester")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS

contract("SortedVessels", async accounts => {
	const assertSortedListIsOrdered = async contracts => {
		const price = await contracts.priceFeedTestnet.getPrice()
		let vessel = await contracts.sortedVessels.getLast()
		while (vessel !== (await contracts.sortedVessels.getFirst(erc20.address))) {
			// Get the adjacent upper vessel ("prev" moves up the list, from lower ICR -> higher ICR)
			const prevVessel = await contracts.sortedVessels.getPrev(erc20.address, vessel)
			const vesselICR = await contracts.vesselManager.getCurrentICR(erc20.address, vessel, price)
			const prevVesselICR = await contracts.vesselManager.getCurrentICR(erc20.address, prevVessel, price)

			assert.isTrue(prevVesselICR.gte(vesselICR))

			const vesselNICR = await contracts.vesselManager.getNominalICR(erc20.address, vessel)
			const prevVesselNICR = await contracts.vesselManager.getNominalICR(erc20.address, prevVessel)

			assert.isTrue(prevVesselNICR.gte(vesselNICR))

			// climb the list
			vessel = prevVessel
		}
	}

	const [owner, alice, bob, carol, dennis, erin, flyn, defaulter_1, A, B, C, D, E, F, G, H, I, J, whale] = accounts

	let contracts

	let borrowerOperations
	let debtToken
	let erc20
	let priceFeed
	let sortedVessels
	let vesselManager
	let vesselManagerOperations

	const openVessel = async params => th.openVessel(contracts, params)

	describe("SortedVessels", () => {
		beforeEach(async () => {
			contracts = await deploymentHelper.deployGravitaCore()
			contracts.vesselManager = await VesselManagerTester.new()
			contracts = await deploymentHelper.deployDebtTokenTester(contracts)
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

			borrowerOperations = contracts.borrowerOperations
			debtToken = contracts.debtToken
			erc20 = contracts.erc20
			priceFeed = contracts.priceFeedTestnet
			sortedVessels = contracts.sortedVessels
			vesselManager = contracts.vesselManager
			vesselManagerOperations = contracts.vesselManagerOperations

			let index = 0
			for (const acc of accounts) {
				await erc20.mint(acc, await web3.eth.getBalance(acc))
				if (++index >= 20) break
			}

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
		})

		it("contains(): returns true for addresses that have opened vessels", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(20, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2000, 18)),
				extraParams: { from: carol },
			})

			// Confirm vessel statuses became active
			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "1")

			// Check sorted list contains vessels
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))
			assert.isTrue(await sortedVessels.contains(erc20.address, bob))
			assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		})

		it("contains(): returns false for addresses that have not opened vessels", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(20, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2000, 18)),
				extraParams: { from: carol },
			})

			// Confirm vessels have non-existent status
			assert.equal((await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_STATUS_INDEX], "0")
			assert.equal((await vesselManager.Vessels(erin, erc20.address))[th.VESSEL_STATUS_INDEX], "0")

			// Check sorted list do not contain vessels
			assert.isFalse(await sortedVessels.contains(erc20.address, dennis))
			assert.isFalse(await sortedVessels.contains(erc20.address, erin))
		})

		it("contains(): returns false for addresses that opened and then closed a vessel", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(1000, 18)),
				extraVUSDAmount: toBN(dec(3000, 18)),
				extraParams: { from: whale },
			})

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(20, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2000, 18)),
				extraParams: { from: carol },
			})

			// to compensate borrowing fees
			await debtToken.transfer(alice, dec(1000, 18), { from: whale })
			await debtToken.transfer(bob, dec(1000, 18), { from: whale })
			await debtToken.transfer(carol, dec(1000, 18), { from: whale })

			// A, B, C close vessels
			await borrowerOperations.closeVessel(erc20.address, { from: alice })
			await borrowerOperations.closeVessel(erc20.address, { from: bob })
			await borrowerOperations.closeVessel(erc20.address, { from: carol })

			// Confirm vessel statuses became closed
			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "2")
			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "2")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "2")

			// Check sorted list does not contain vessels
			assert.isFalse(await sortedVessels.contains(erc20.address, alice))
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))
			assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		})

		// true for addresses that opened -> closed -> opened a vessel
		it("contains(): returns true for addresses that opened, closed and then re-opened a vessel", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(1000, 18)),
				extraVUSDAmount: toBN(dec(3000, 18)),
				extraParams: { from: whale },
			})

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(20, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2000, 18)),
				extraParams: { from: carol },
			})

			// to compensate borrowing fees
			await debtToken.transfer(alice, dec(1000, 18), { from: whale })
			await debtToken.transfer(bob, dec(1000, 18), { from: whale })
			await debtToken.transfer(carol, dec(1000, 18), { from: whale })

			// A, B, C close vessels
			await borrowerOperations.closeVessel(erc20.address, { from: alice })
			await borrowerOperations.closeVessel(erc20.address, { from: bob })
			await borrowerOperations.closeVessel(erc20.address, { from: carol })

			// Confirm vessel statuses became closed
			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "2")
			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "2")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "2")

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(1000, 16)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2000, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(3000, 18)),
				extraParams: { from: carol },
			})

			// Confirm vessel statuses became open again
			assert.equal((await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
			assert.equal((await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_STATUS_INDEX], "1")
			assert.equal((await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_STATUS_INDEX], "1")

			// Check sorted list does  contain vessels
			assert.isTrue(await sortedVessels.contains(erc20.address, alice))
			assert.isTrue(await sortedVessels.contains(erc20.address, bob))
			assert.isTrue(await sortedVessels.contains(erc20.address, carol))
		})

		// false when list size is 0
		it("contains(): returns false when there are no vessels in the system", async () => {
			assert.isFalse(await sortedVessels.contains(erc20.address, alice))
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))
			assert.isFalse(await sortedVessels.contains(erc20.address, carol))
		})

		// true when list size is 1 and the vessel the only one in system
		it("contains(): true when list size is 1 and the vessel the only one in system", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: alice },
			})

			assert.isTrue(await sortedVessels.contains(erc20.address, alice))
		})

		// false when list size is 1 and vessel is not in the system
		it("contains(): false when list size is 1 and vessel is not in the system", async () => {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(150, 16)),
				extraParams: { from: alice },
			})

			assert.isFalse(await sortedVessels.contains(erc20.address, bob))
		})

		// --- getMaxSize ---

		it("getMaxSize(): Returns the maximum list size", async () => {
			// const max = await sortedVessels.getMaxSize(ZERO_ADDRESS)
			// assert.equal(web3.utils.toHex(max), th.maxBytes32)
			// Added an openVessel to set the maxsize to the maximum
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(500, 18)),
				extraParams: { from: whale },
			})
			const maxERC20 = await sortedVessels.getMaxSize(erc20.address)
			assert.equal(web3.utils.toHex(maxERC20), th.maxBytes32)
		})

		// --- findInsertPosition ---

		it("Finds the correct insert position given two addresses that loosely bound the correct position", async () => {
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// NICR sorted in descending order
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(500, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(5, 18)),
				extraParams: { from: B },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(250, 16)),
				extraParams: { from: C },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(166, 16)),
				extraParams: { from: D },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(125, 16)),
				extraParams: { from: E },
			})

			// Expect a vessel with NICR 300% to be inserted between B and C
			const targetNICR = dec(3, 18)

			// Pass addresses that loosely bound the right postiion
			const hints = await sortedVessels.findInsertPosition(erc20.address, targetNICR, A, E)

			// Expect the exact correct insert hints have been returned
			assert.equal(hints[0], B)
			assert.equal(hints[1], C)

			// The price doesn’t affect the hints
			await priceFeed.setPrice(erc20.address, dec(500, 18))
			const hints2 = await sortedVessels.findInsertPosition(erc20.address, targetNICR, A, E)

			// Expect the exact correct insert hints have been returned
			assert.equal(hints2[0], B)
			assert.equal(hints2[1], C)
		})

		//--- Ordering ---
		// infinte ICR (zero collateral) is not possible anymore, therefore, skipping
		it.skip("stays ordered after vessels with 'infinite' ICR receive a redistribution", async () => {
			// make several vessels with 0 debt and collateral, in random order
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, 0, whale, whale, {
				from: whale,
				value: dec(50, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, 0, A, A, {
				from: A,
				value: dec(1, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, 0, B, B, {
				from: B,
				value: dec(37, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, 0, C, C, {
				from: C,
				value: dec(5, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, 0, D, D, {
				from: D,
				value: dec(4, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, 0, E, E, {
				from: E,
				value: dec(19, "ether"),
			})

			// Make some vessels with non-zero debt, in random order
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, dec(5, 19), F, F, {
				from: F,
				value: dec(1, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, dec(3, 18), G, G, {
				from: G,
				value: dec(37, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, dec(2, 20), H, H, {
				from: H,
				value: dec(5, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, dec(17, 18), I, I, {
				from: I,
				value: dec(4, "ether"),
			})
			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, dec(5, 21), J, J, {
				from: J,
				value: dec(1345, "ether"),
			})

			const price_1 = await priceFeed.getPrice(erc20.address)

			// Check vessels are ordered
			await assertSortedListIsOrdered(contracts)

			await borrowerOperations.openVessel(erc20.address, 0, th._100pct, dec(100, 18), defaulter_1, defaulter_1, {
				from: defaulter_1,
				value: dec(1, "ether"),
			})
			assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_1))

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))
			const price_2 = await priceFeed.getPrice(erc20.address)

			// Liquidate a vessel
			await vesselManagerOperations.liquidate(defaulter_1)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

			// Check vessels are ordered
			await assertSortedListIsOrdered(contracts)
		})
	})

	describe("SortedVessels with mock dependencies", () => {
		let sortedVesselsTester

		beforeEach(async () => {
			sortedVessels = await SortedVessels.new()
			sortedVesselsTester = await SortedVesselsTester.new()

			await sortedVessels.setAddresses(sortedVesselsTester.address, sortedVesselsTester.address)
			await sortedVesselsTester.setSortedVessels(sortedVessels.address)
		})

		context("when params are properly set", () => {
			it("insert(): fails if list already contains the node", async () => {
				await sortedVesselsTester.insert(ZERO_ADDRESS, alice, 1, alice, alice)
				await th.assertRevert(
					sortedVesselsTester.insert(ZERO_ADDRESS, alice, 1, alice, alice),
					"SortedVessels: List already contains the node"
				)
			})

			it("insert(): fails if id is zero", async () => {
				await th.assertRevert(
					sortedVesselsTester.insert(ZERO_ADDRESS, th.ZERO_ADDRESS, 1, alice, alice),
					"SortedVessels: Id cannot be zero"
				)
			})

			it("insert(): fails if NICR is zero", async () => {
				await th.assertRevert(
					sortedVesselsTester.insert(ZERO_ADDRESS, alice, 0, alice, alice),
					"SortedVessels: NICR must be positive"
				)
			})

			it("remove(): fails if id is not in the list", async () => {
				await th.assertRevert(
					sortedVesselsTester.remove(ZERO_ADDRESS, alice),
					"SortedVessels: List does not contain the id"
				)
			})

			it("reInsert(): fails if list doesn’t contain the node", async () => {
				await th.assertRevert(
					sortedVesselsTester.reInsert(ZERO_ADDRESS, alice, 1, alice, alice),
					"SortedVessels: List does not contain the id"
				)
			})

			it("reInsert(): fails if new NICR is zero", async () => {
				await sortedVesselsTester.insert(ZERO_ADDRESS, alice, 1, alice, alice)
				assert.isTrue(await sortedVessels.contains(ZERO_ADDRESS, alice), "list should contain element")
				await th.assertRevert(
					sortedVesselsTester.reInsert(ZERO_ADDRESS, alice, 0, alice, alice),
					"SortedVessels: NICR must be positive"
				)
				assert.isTrue(await sortedVessels.contains(ZERO_ADDRESS, alice), "list should contain element")
			})

			it("findInsertPosition(ZERO_ADDRESS,): No prevId for hint - ascend list starting from nextId, result is after the tail", async () => {
				await sortedVesselsTester.insert(ZERO_ADDRESS, alice, 1, alice, alice)
				const pos = await sortedVessels.findInsertPosition(ZERO_ADDRESS, 1, th.ZERO_ADDRESS, alice)
				assert.equal(pos[0], alice, "prevId result should be nextId param")
				assert.equal(pos[1], ZERO_ADDRESS, "nextId result should be zero")
			})
		})
	})
})

contract("Reset chain state", async accounts => {})
