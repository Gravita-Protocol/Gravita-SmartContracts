const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const DebtTokenTester = artifacts.require("DebtTokenTester")
const VesselManagerTester = artifacts.require("VesselManagerTester")

const ZERO_ADDRESS = th.ZERO_ADDRESS

contract("StabilityPool", async accounts => {
	const [owner, defaulter_1, defaulter_2, defaulter_3, whale, alice, bob, carol, dennis, erin, flyn, E] =
		accounts

	let contracts
	let priceFeed
	let priceFeedB
	let debtToken
	let sortedVessels
	let vesselManager
	let vesselManagerOperations
	let activePool
	let stabilityPool
	let defaultPool
	let borrowerOperations
	let grvtToken
	let communityIssuance
	let erc20
	let erc20B
	let adminContract

	let gasPriceInWei

	const getOpenVesselVUSDAmount = async (totalDebt, asset) => th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)
	const openVessel = async params => th.openVessel(contracts, params)
	const assertRevert = th.assertRevert

	describe("Stability Pool Mechanisms", async () => {
		async function deployContractsFixture() {
			contracts = await deploymentHelper.deployGravitaCore()
			contracts.vesselManager = await VesselManagerTester.new()
			contracts = await deploymentHelper.deployDebtTokenTester(contracts)
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

			priceFeed = contracts.priceFeedTestnet
			priceFeedB = contracts.priceFeedTestnetB
			debtToken = contracts.debtToken
			sortedVessels = contracts.sortedVessels
			vesselManager = contracts.vesselManager
			vesselManagerOperations = contracts.vesselManagerOperations
			activePool = contracts.activePool
			defaultPool = contracts.defaultPool
			borrowerOperations = contracts.borrowerOperations
			adminContract = contracts.adminContract
			stabilityPool = contracts.stabilityPool

			grvtToken = GRVTContracts.grvtToken
			communityIssuance = GRVTContracts.communityIssuance

			erc20 = contracts.erc20
			erc20B = contracts.erc20B

			let index = 0
			for (const acc of accounts) {
				await erc20.mint(acc, await web3.eth.getBalance(acc))
				await erc20B.mint(acc, await web3.eth.getBalance(acc))
				index++

				if (index >= 100) break
			}

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
		}
		before(async () => {
			gasPriceInWei = await web3.eth.getGasPrice()
			// Create snapshot of the protocol to start each test with
		})

		beforeEach(async () => {
			await loadFixture(deployContractsFixture)
		})
		// --- provideToSP() ---
		// increases recorded VUSD at Stability Pool
		it("provideToSP(): increases the Stability Pool VUSD balance", async () => {
			// --- SETUP --- Give Alice a least 200
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(200),
				ICR: toBN(dec(2, 18)), // 200%
				extraParams: { from: alice },
			})

			// --- TEST ---

			// provideToSP()
			await stabilityPool.provideToSP(200, { from: alice })

			// check VUSD balances after
			assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), 200)
		})

		it("provideToSP(): reverts when trying to make a SP deposit without VUSD balance", async () => {
			const aliceTxPromise = stabilityPool.provideToSP(200, { from: alice })
			await assertRevert(aliceTxPromise, "revert")
		})

		it("provideToSP(): updates the user's deposit record in StabilityPool", async () => {
			// --- SETUP --- Give Alice a least 200
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(200),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// --- TEST ---
			// check user's deposit record before
			assert.equal(await stabilityPool.deposits(alice), 0)

			// provideToSP()
			await stabilityPool.provideToSP(200, { from: alice })

			// check user's deposit record after
			assert.equal(await stabilityPool.deposits(alice), 200)
		})

		it("provideToSP(): reduces the user's VUSD balance by the correct amount", async () => {
			// --- SETUP --- Give Alice at least 200
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(200),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			// --- TEST ---
			// get user's deposit record before
			const alice_VUSDBalance_Before = await debtToken.balanceOf(alice)
			// provideToSP()
			await stabilityPool.provideToSP(400, { from: alice })

			// check user's VUSD balance change
			const alice_VUSDBalance_After = await debtToken.balanceOf(alice)
			assert.equal(alice_VUSDBalance_Before.sub(alice_VUSDBalance_After), "400")
		})

		it("provideToSP(): Correctly updates user snapshots of accumulated rewards per unit staked", async () => {
			// --- SETUP ---

			// Whale opens Vessel and deposits to SP
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			const whaleVUSD = (await debtToken.balanceOf(whale)).div(toBN(2))
			await stabilityPool.provideToSP(whaleVUSD, { from: whale })

			// 2 Vessels opened, each withdraws minimum debt
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// Alice makes Vessel and withdraws 100 VUSD
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(100, 18)),
				ICR: toBN(dec(5, 18)),
				extraParams: { from: alice },
			})

			// price drops: defaulter's Vessels fall below MCR, whale doesn't
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			const SPVUSD_Before = await stabilityPool.getTotalDebtTokenDeposits()

			// Vessels are closed
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

			// Confirm SP has decreased
			const SPVUSD_After = await stabilityPool.getTotalDebtTokenDeposits()
			assert.isTrue(SPVUSD_After.lt(SPVUSD_Before))
			// --- TEST ---
			const P_Before = await stabilityPool.P()
			const S_Before = await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)
			const G_Before = await stabilityPool.epochToScaleToG(0, 0)

			assert.isTrue(P_Before.gt(toBN("0")))
			assert.isTrue(S_Before.gt(toBN("0")))

			// Check 'Before' snapshots
			const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
			const alice_snapshot_S_Before = await stabilityPool.S(alice, erc20.address) // alice_snapshot_Before[0].toString()
			const alice_snapshot_P_Before = alice_snapshot_Before["P"].toString()
			const alice_snapshot_G_Before = alice_snapshot_Before["G"].toString()

			assert.equal(alice_snapshot_S_Before, "0")
			assert.equal(alice_snapshot_P_Before, "0")
			assert.equal(alice_snapshot_G_Before, "0")

			// Make deposit
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })

			// Check 'After' snapshots
			const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
			const alice_snapshot_S_After = await stabilityPool.S(alice, erc20.address) //alice_snapshot_After[0].toString()
			const alice_snapshot_P_After = alice_snapshot_After["P"].toString()
			const alice_snapshot_G_After = alice_snapshot_After["G"].toString()

			assert.equal(alice_snapshot_S_After.toString(), S_Before.toString())
			assert.equal(alice_snapshot_P_After, P_Before)
			assert.equal(alice_snapshot_G_After, G_Before)
		})

		it("provideToSP(): multiple deposits = updates user's deposit and snapshots", async () => {
			// --- SETUP ---
			// Whale opens Vessel and deposits to SP
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			const whaleVUSD = (await debtToken.balanceOf(whale)).div(toBN(2))
			await stabilityPool.provideToSP(whaleVUSD, { from: whale })

			// 3 Vessels opened. Two users withdraw 160 VUSD each
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_3 },
			})

			// --- TEST ---

			// Alice opens a vessel receiving 250VUSD
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(250, 18)),
				ICR: toBN(dec(3, 18)),
				extraParams: { from: alice },
			})
			// makes deposit #1: 150 VUSD to the SP
			await stabilityPool.provideToSP(dec(150, 18), { from: alice })

			const alice_Snapshot_0 = await stabilityPool.depositSnapshots(alice)
			const alice_Snapshot_S_0 = await stabilityPool.S(alice, erc20.address) //alice_Snapshot_0[0]
			const alice_Snapshot_P_0 = alice_Snapshot_0["P"]
			assert.equal(alice_Snapshot_S_0, 0)
			assert.equal(alice_Snapshot_P_0, "1000000000000000000")

			// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// 2 users with Vessel with 180 VUSD drawn are closed
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			const alice_compoundedDeposit_1 = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
			const alice_topUp_1 = toBN(dec(100, 18))
			await stabilityPool.provideToSP(alice_topUp_1, { from: alice })

			const alice_newDeposit_1 = (await stabilityPool.deposits(alice)).toString()
			assert.equal(alice_compoundedDeposit_1.add(alice_topUp_1), alice_newDeposit_1)

			// get system reward terms
			const P_1 = await stabilityPool.P()
			const S_1 = await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)
			assert.isTrue(P_1.lt(toBN(dec(1, 18))))
			assert.isTrue(S_1.gt(toBN("0")))

			// check Alice's new snapshot is correct
			const alice_Snapshot_1 = await stabilityPool.depositSnapshots(alice)
			const alice_Snapshot_S_1 = await stabilityPool.S(alice, erc20.address) // alice_Snapshot_1[0]
			const alice_Snapshot_P_1 = alice_Snapshot_1["P"]
			assert.isTrue(alice_Snapshot_S_1.eq(S_1))
			assert.isTrue(alice_Snapshot_P_1.eq(P_1))

			// Bob opens vessel and deposits to StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await stabilityPool.provideToSP(dec(427, 18), { from: bob })

			// Defaulter 3 Vessel is closed
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			const alice_compoundedDeposit_2 = await stabilityPool.getCompoundedDebtTokenDeposits(alice)

			const P_2 = await stabilityPool.P()
			const S_2 = await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)
			assert.isTrue(P_2.lt(P_1))
			assert.isTrue(S_2.gt(S_1))

			// Alice makes deposit #3:  100VUSD
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })

			// check Alice's new snapshot is correct
			const alice_Snapshot_2 = await stabilityPool.depositSnapshots(alice)
			const alice_Snapshot_S_2 = await stabilityPool.S(alice, erc20.address) //alice_Snapshot_2[0]
			const alice_Snapshot_P_2 = alice_Snapshot_2["P"]
			assert.isTrue(alice_Snapshot_S_2.eq(S_2))
			assert.isTrue(alice_Snapshot_P_2.eq(P_2))
		})

		it("provideToSP(): reverts if user tries to provide more than their VUSD balance", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const aliceVUSDbal = await debtToken.balanceOf(alice)
			const bobVUSDbal = await debtToken.balanceOf(bob)

			// Alice, attempts to deposit 1 wei more than her balance

			const aliceTxPromise = stabilityPool.provideToSP(aliceVUSDbal.add(toBN(1)), {
				from: alice,
			})
			await assertRevert(aliceTxPromise, "revert")

			// Bob, attempts to deposit 235534 more than his balance

			const bobTxPromise = stabilityPool.provideToSP(bobVUSDbal.add(toBN(dec(235534, 18))), {
				from: bob,
			})
			await assertRevert(bobTxPromise, "revert")
		})
		it("provideToSP(): reverts if user tries to provide 2^256-1 VUSD, which exceeds their balance", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

			// Alice attempts to deposit 2^256-1 VUSD
			try {
				aliceTx = await stabilityPool.provideToSP(maxBytes32, { from: alice })
				assert.isFalse(aliceTx.receipt.status)
			} catch (error) {
				assert.include(error.message, "revert")
			}
		})

		it("provideToSP(): doesn't impact other users' deposits or collateral gains", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

			// D opens a vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(300, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})

			// Would-be defaulters open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// Defaulters are liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

			const alice_VUSDDeposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
			const bob_VUSDDeposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
			const carol_VUSDDeposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(carol)).toString()

			const alice_gain_Before = (await stabilityPool.getDepositorGains(alice))[1].toString()
			const bob_gain_Before = (await stabilityPool.getDepositorGains(bob))[1].toString()
			const carol_gain_Before = (await stabilityPool.getDepositorGains(carol))[1].toString()

			//check non-zero VUSD and collateral in the Stability Pool
			const VUSDinSP = await stabilityPool.getTotalDebtTokenDeposits()
			const balanceInSP = await stabilityPool.getCollateral(erc20.address)
			assert.isTrue(VUSDinSP.gt(mv._zeroBN))
			assert.isTrue(balanceInSP.gt(mv._zeroBN))

			// D makes an SP deposit
			await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
			assert.equal((await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString(), dec(1000, 18))

			const alice_VUSDDeposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
			const bob_VUSDDeposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
			const carol_VUSDDeposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(carol)).toString()

			const alice_gain_After = (await stabilityPool.getDepositorGains(alice))[1].toString()
			const bob_gain_After = (await stabilityPool.getDepositorGains(bob))[1].toString()
			const carol_gain_After = (await stabilityPool.getDepositorGains(carol))[1].toString()

			// Check compounded deposits and collateral gains for A, B and C have not changed
			assert.equal(alice_VUSDDeposit_Before, alice_VUSDDeposit_After)
			assert.equal(bob_VUSDDeposit_Before, bob_VUSDDeposit_After)
			assert.equal(carol_VUSDDeposit_Before, carol_VUSDDeposit_After)

			assert.equal(alice_gain_Before, alice_gain_After)
			assert.equal(bob_gain_Before, bob_gain_After)
			assert.equal(carol_gain_Before, carol_gain_After)
		})

		it("provideToSP(): doesn't impact system debt, collateral or TCR", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

			// D opens a vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})

			// Would-be defaulters open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: 0,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// Defaulters are liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

			const activeDebt_BeforeERC20 = (await activePool.getDebtTokenBalance(erc20.address)).toString()
			const defaultedDebt_BeforeERC20 = (await defaultPool.getDebtTokenBalance(erc20.address)).toString()
			const activeColl_BeforeERC20 = (await activePool.getAssetBalance(erc20.address)).toString()
			const defaultedColl_BeforeERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
			const TCR_BeforeERC20 = (await th.getTCR(contracts, erc20.address)).toString()

			// D makes an SP deposit
			await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
			assert.equal((await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString(), dec(1000, 18))

			const activeDebt_AfterERC20 = (await activePool.getDebtTokenBalance(erc20.address)).toString()
			const defaultedDebt_AfterERC20 = (await defaultPool.getDebtTokenBalance(erc20.address)).toString()
			const activeColl_AfterERC20 = (await activePool.getAssetBalance(erc20.address)).toString()
			const defaultedColl_AfterERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
			const TCR_AfterERC20 = (await th.getTCR(contracts, erc20.address)).toString()

			// Check total system debt, collateral and TCR have not changed after a Stability deposit is made
			assert.equal(activeDebt_BeforeERC20, activeDebt_AfterERC20)
			assert.equal(defaultedDebt_BeforeERC20, defaultedDebt_AfterERC20)
			assert.equal(activeColl_BeforeERC20, activeColl_AfterERC20)
			assert.equal(defaultedColl_BeforeERC20, defaultedColl_AfterERC20)
			assert.equal(TCR_BeforeERC20, TCR_AfterERC20)
		})

		it("provideToSP(): doesn't impact any vessels, including the caller's vessel", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A and B provide to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(2000, 18), { from: bob })

			// D opens a vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			const price = await priceFeed.getPrice(erc20.address)

			// Get debt, collateral and ICR of all existing vessels
			const whale_Debt_BeforeERC20 = (await vesselManager.Vessels(whale, erc20.address))[0].toString()
			const alice_Debt_BeforeERC20 = (await vesselManager.Vessels(alice, erc20.address))[0].toString()
			const bob_Debt_BeforeERC20 = (await vesselManager.Vessels(bob, erc20.address))[0].toString()
			const carol_Debt_BeforeERC20 = (await vesselManager.Vessels(carol, erc20.address))[0].toString()
			const dennis_Debt_BeforeERC20 = (await vesselManager.Vessels(dennis, erc20.address))[0].toString()

			const whale_Coll_BeforeERC20 = (await vesselManager.Vessels(whale, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const alice_Coll_BeforeERC20 = (await vesselManager.Vessels(alice, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const bob_Coll_BeforeERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const carol_Coll_BeforeERC20 = (await vesselManager.Vessels(carol, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const dennis_Coll_BeforeERC20 = (await vesselManager.Vessels(dennis, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()

			const whale_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, whale, price)).toString()
			const alice_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
			const bob_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
			const carol_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()
			const dennis_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, dennis, price)).toString()

			// D makes an SP deposit
			await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
			assert.equal((await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString(), dec(1000, 18))

			const whale_Debt_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[0].toString()
			const alice_Debt_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[0].toString()
			const bob_Debt_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[0].toString()
			const carol_Debt_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[0].toString()
			const dennis_Debt_AfterERC20 = (await vesselManager.Vessels(dennis, erc20.address))[0].toString()

			const whale_Coll_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const alice_Coll_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const bob_Coll_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const carol_Coll_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const dennis_Coll_AfterERC20 = (await vesselManager.Vessels(dennis, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()

			const whale_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, whale, price)).toString()
			const alice_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
			const bob_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
			const carol_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()
			const dennis_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, dennis, price)).toString()

			assert.equal(whale_Debt_BeforeERC20, whale_Debt_AfterERC20)
			assert.equal(alice_Debt_BeforeERC20, alice_Debt_AfterERC20)
			assert.equal(bob_Debt_BeforeERC20, bob_Debt_AfterERC20)
			assert.equal(carol_Debt_BeforeERC20, carol_Debt_AfterERC20)
			assert.equal(dennis_Debt_BeforeERC20, dennis_Debt_AfterERC20)

			assert.equal(whale_Coll_BeforeERC20, whale_Coll_AfterERC20)
			assert.equal(alice_Coll_BeforeERC20, alice_Coll_AfterERC20)
			assert.equal(bob_Coll_BeforeERC20, bob_Coll_AfterERC20)
			assert.equal(carol_Coll_BeforeERC20, carol_Coll_AfterERC20)
			assert.equal(dennis_Coll_BeforeERC20, dennis_Coll_AfterERC20)

			assert.equal(whale_ICR_BeforeERC20, whale_ICR_AfterERC20)
			assert.equal(alice_ICR_BeforeERC20, alice_ICR_AfterERC20)
			assert.equal(bob_ICR_BeforeERC20, bob_ICR_AfterERC20)
			assert.equal(carol_ICR_BeforeERC20, carol_ICR_AfterERC20)
			assert.equal(dennis_ICR_BeforeERC20, dennis_ICR_AfterERC20)
		})

		it("provideToSP(): doesn't protect the depositor's vessel from liquidation", async () => {
			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B provide 100 VUSD to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(1000, 18), { from: bob })

			// Confirm Bob has an active vessel in the system
			assert.isTrue(await sortedVessels.contains(erc20.address, bob))
			assert.equal((await vesselManager.getVesselStatus(erc20.address, bob)).toString(), "1")

			// Confirm Bob has a Stability deposit
			assert.equal((await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString(), dec(1000, 18))

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			const price = await priceFeed.getPrice(erc20.address)

			// Liquidate bob
			await vesselManagerOperations.liquidate(erc20.address, bob)

			// Check Bob's vessel has been removed from the system
			assert.isFalse(await sortedVessels.contains(erc20.address, bob))
			assert.equal((await vesselManager.getVesselStatus(erc20.address, bob)).toString(), "3")
		})

		it("provideToSP(): providing 0 VUSD reverts", async () => {
			// --- SETUP ---
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B, C provides 100, 50, 30 VUSD to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(50, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30, 18), { from: carol })

			const bob_Deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
			const VUSDinSP_Before = (await stabilityPool.getTotalDebtTokenDeposits()).toString()

			assert.equal(VUSDinSP_Before, dec(180, 18))

			// Bob provides 0 VUSD to the Stability Pool
			const txPromise_B = stabilityPool.provideToSP(0, { from: bob })
			await th.assertRevert(txPromise_B)
		})

		// --- GRVT functionality ---
		it("provideToSP(): new deposit = when SP > 0, triggers GRVT reward event - increases the sum G", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A provides to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })

			let currentEpoch = await stabilityPool.currentEpoch()
			let currentScale = await stabilityPool.currentScale()
			const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// B provides to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: bob })

			currentEpoch = await stabilityPool.currentEpoch()
			currentScale = await stabilityPool.currentScale()
			const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)
			// Expect G has increased from the GRVT reward event triggered
			assert.isTrue(G_After.gt(G_Before))
		})

		it("provideToSP(): new deposit = when SP is empty, doesn't update G", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A provides to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// A withdraws
			await stabilityPool.withdrawFromSP(dec(1000, 18), { from: alice })

			// Check SP is empty
			assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), "0")

			// Check G is non-zero
			let currentEpoch = await stabilityPool.currentEpoch()
			let currentScale = await stabilityPool.currentScale()
			const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

			assert.isTrue(G_Before.gt(toBN("0")))

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// B provides to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: bob })

			currentEpoch = await stabilityPool.currentEpoch()
			currentScale = await stabilityPool.currentScale()
			const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

			// Expect G has not changed
			assert.isTrue(G_After.eq(G_Before))
		})

		it("provideToSP(): new deposit - sets the correct front end tag", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, C, D open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})

			// A, B, C, D provides to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(3000, 18), { from: carol })
			await stabilityPool.provideToSP(dec(4000, 18), { from: dennis })
		})

		it("provideToSP(): new deposit = depositor does not receive any GRVT rewards", async () => {
			await openVessel({
				asset: erc20.address,
				assetSent: dec(50, "ether"),
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})

			// A, B, open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Get A, B, C GRVT balances before and confirm they're zero
			const A_GRVTBalance_Before = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_Before = await grvtToken.balanceOf(bob)

			assert.equal(A_GRVTBalance_Before, "0")
			assert.equal(B_GRVTBalance_Before, "0")

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// A, B provide to SP
			await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(2000, 18), { from: bob })

			// Get A, B, C GRVT balances after, and confirm they're still zero
			const A_GRVTBalance_After = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_After = await grvtToken.balanceOf(bob)

			assert.equal(A_GRVTBalance_After, "0")
			assert.equal(B_GRVTBalance_After, "0")
		})

		it("provideToSP(): new deposit after past full withdrawal = depositor does not receive any GRVT rewards", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C, open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(4000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// --- SETUP ---

			const initialDeposit_A = (await debtToken.balanceOf(alice)).div(toBN(2))
			const initialDeposit_B = (await debtToken.balanceOf(bob)).div(toBN(2))
			// A, B provide to SP
			await stabilityPool.provideToSP(initialDeposit_A, { from: alice })
			await stabilityPool.provideToSP(initialDeposit_B, { from: bob })

			// time passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// C deposits. A, and B earn GRVT
			await stabilityPool.provideToSP(dec(5, 18), { from: carol })

			// Price drops, defaulter is liquidated, A, B and C earn collateral
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			// price bounces back to 200
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// A and B fully withdraw from the pool
			await stabilityPool.withdrawFromSP(initialDeposit_A, { from: alice })
			await stabilityPool.withdrawFromSP(initialDeposit_B, { from: bob })

			// --- TEST ---

			// Get A, B, C GRVT balances before and confirm they're non-zero
			const A_GRVTBalance_Before = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_Before = await grvtToken.balanceOf(bob)
			assert.isTrue(A_GRVTBalance_Before.gt(toBN("0")))
			assert.isTrue(B_GRVTBalance_Before.gt(toBN("0")))

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// A, B provide to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(200, 18), { from: bob })

			// Get A, B, C GRVT balances after, and confirm they have not changed
			const A_GRVTBalance_After = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_After = await grvtToken.balanceOf(bob)

			assert.isTrue(A_GRVTBalance_After.eq(A_GRVTBalance_Before))
			assert.isTrue(B_GRVTBalance_After.eq(B_GRVTBalance_Before))
		})

		it("provideToSP(): new deposit = depositor does not receive gains", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// Whale transfers VUSD to A, B
			await debtToken.transfer(alice, dec(200, 18), { from: whale })
			await debtToken.transfer(bob, dec(400, 18), { from: whale })

			// C, D open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})

			// --- TEST ---

			// get current ETH balances
			const A_Balance_BeforeERC20 = await erc20.balanceOf(alice)
			const B_Balance_BeforeERC20 = await erc20.balanceOf(bob)
			const C_Balance_BeforeERC20 = await erc20.balanceOf(carol)
			const D_Balance_BeforeERC20 = await erc20.balanceOf(dennis)

			// A, B, C, D provide to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(200, 18), { from: bob })
			await stabilityPool.provideToSP(dec(300, 18), { from: carol })
			await stabilityPool.provideToSP(dec(400, 18), { from: dennis })

			const A_ETHBalance_AfterERC20 = await erc20.balanceOf(alice)
			const B_ETHBalance_AfterERC20 = await erc20.balanceOf(bob)
			const C_ETHBalance_AfterERC20 = await erc20.balanceOf(carol)
			const D_ETHBalance_AfterERC20 = await erc20.balanceOf(dennis)

			// Check balances have not changed
			assert.equal(A_ETHBalance_AfterERC20, A_Balance_BeforeERC20.toString())
			assert.equal(B_ETHBalance_AfterERC20, B_Balance_BeforeERC20.toString())
			assert.equal(C_ETHBalance_AfterERC20, C_Balance_BeforeERC20.toString())
			assert.equal(D_ETHBalance_AfterERC20, D_Balance_BeforeERC20.toString())
		})

		it("provideToSP(): new deposit after past full withdrawal = depositor does not receive gains", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// Whale transfers VUSD to A, B
			await debtToken.transfer(alice, dec(2000, 18), { from: whale })
			await debtToken.transfer(bob, dec(2000, 18), { from: whale })

			// C, D open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(4000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// --- SETUP ---
			// A, B, C, D provide to SP
			await stabilityPool.provideToSP(dec(105, 18), { from: alice })
			await stabilityPool.provideToSP(dec(105, 18), { from: bob })
			await stabilityPool.provideToSP(dec(105, 18), { from: carol })
			await stabilityPool.provideToSP(dec(105, 18), { from: dennis })

			// time passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// B deposits. A,B,C,D earn GRVT
			await stabilityPool.provideToSP(dec(5, 18), { from: bob })

			// Price drops, defaulter is liquidated, A, B, C, D earn ETH
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			// Price bounces back
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// A B,C, D fully withdraw from the pool
			await stabilityPool.withdrawFromSP(dec(105, 18), { from: alice })
			await stabilityPool.withdrawFromSP(dec(105, 18), { from: bob })
			await stabilityPool.withdrawFromSP(dec(105, 18), { from: carol })
			await stabilityPool.withdrawFromSP(dec(105, 18), { from: dennis })

			// --- TEST ---

			const A_Balance_BeforeERC20 = await erc20.balanceOf(alice)
			const B_Balance_BeforeERC20 = await erc20.balanceOf(bob)
			const C_Balance_BeforeERC20 = await erc20.balanceOf(carol)
			const D_Balance_BeforeERC20 = await erc20.balanceOf(dennis)

			// A, B, C, D provide to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(200, 18), { from: bob })
			await stabilityPool.provideToSP(dec(300, 18), { from: carol })
			await stabilityPool.provideToSP(dec(400, 18), { from: dennis })

			const A_Balance_AfterERC20 = await erc20.balanceOf(alice)
			const B_Balance_AfterERC20 = await erc20.balanceOf(bob)
			const C_Balance_AfterERC20 = await erc20.balanceOf(carol)
			const D_Balance_AfterERC20 = await erc20.balanceOf(dennis)

			assert.equal(A_Balance_AfterERC20.toString(), A_Balance_BeforeERC20.toString())
			assert.equal(B_Balance_AfterERC20.toString(), B_Balance_BeforeERC20.toString())
			assert.equal(C_Balance_AfterERC20.toString(), C_Balance_BeforeERC20.toString())
			assert.equal(D_Balance_AfterERC20.toString(), D_Balance_BeforeERC20.toString())
		})

		it("provideToSP(): topup = triggers GRVT reward event - increases the sum G", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(3000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B, C provide to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(50, 18), { from: bob })
			await stabilityPool.provideToSP(dec(50, 18), { from: carol })

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			const G_Before = await stabilityPool.epochToScaleToG(0, 0)

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// B tops up
			await stabilityPool.provideToSP(dec(100, 18), { from: bob })

			const G_After = await stabilityPool.epochToScaleToG(0, 0)

			// Expect G has increased from the GRVT reward event triggered by B's topup
			assert.isTrue(G_After.gt(G_Before))
		})

		it("provideToSP(): topup = depositor receives GRVT rewards", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(200, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(300, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B, C, provide to SP
			await stabilityPool.provideToSP(dec(10, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30, 18), { from: carol })

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// Get A, B, C GRVT balance before
			const A_GRVTBalance_Before = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_Before = await grvtToken.balanceOf(bob)
			const C_GRVTBalance_Before = await grvtToken.balanceOf(carol)

			// A, B, C top up
			await stabilityPool.provideToSP(dec(10, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30, 18), { from: carol })

			// Get GRVT balance after
			const A_GRVTBalance_After = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_After = await grvtToken.balanceOf(bob)
			const C_GRVTBalance_After = await grvtToken.balanceOf(carol)

			// Check GRVT Balance of A, B, C has increased
			assert.isTrue(A_GRVTBalance_After.gt(A_GRVTBalance_Before))
			assert.isTrue(B_GRVTBalance_After.gt(B_GRVTBalance_Before))
			assert.isTrue(C_GRVTBalance_After.gt(C_GRVTBalance_Before))
		})

		it("provideToSP(): reverts when amount is zero", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(2000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			// Whale transfers VUSD to C, D
			await debtToken.transfer(carol, dec(200, 18), { from: whale })
			await debtToken.transfer(dennis, dec(200, 18), { from: whale })

			txPromise_A = stabilityPool.provideToSP(0, { from: alice })
			txPromise_B = stabilityPool.provideToSP(0, { from: bob })
			txPromise_C = stabilityPool.provideToSP(0, { from: carol })
			txPromise_D = stabilityPool.provideToSP(0, { from: dennis })

			await th.assertRevert(txPromise_A, "StabilityPool: Amount must be non-zero")
			await th.assertRevert(txPromise_B, "StabilityPool: Amount must be non-zero")
			await th.assertRevert(txPromise_C, "StabilityPool: Amount must be non-zero")
			await th.assertRevert(txPromise_D, "StabilityPool: Amount must be non-zero")
		})

		// --- withdrawFromSP ---

		it("withdrawFromSP(): reverts when user has no active deposit", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: bob },
			})

			await stabilityPool.provideToSP(dec(100, 18), { from: alice })

			const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
			const bob_initialDeposit = (await stabilityPool.deposits(bob)).toString()

			assert.equal(alice_initialDeposit, dec(100, 18))
			assert.equal(bob_initialDeposit, "0")

			try {
				const txBob = await stabilityPool.withdrawFromSP(dec(100, 18), { from: bob })
				assert.isFalse(txBob.receipt.status)
			} catch (err) {
				assert.include(err.message, "revert")
				// TODO: infamous issue #99
				//assert.include(err.message, "User must have a non-zero deposit")
			}
		})

		it("withdrawFromSP(): reverts when amount > 0 and system has an undercollateralized vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			await stabilityPool.provideToSP(dec(100, 18), { from: alice })

			const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
			assert.equal(alice_initialDeposit, dec(100, 18))

			// defaulter opens vessel
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// price drops, defaulter is in liquidation range (but not liquidated yet)
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await th.assertRevert(stabilityPool.withdrawFromSP(dec(100, 18), { from: alice }))
		})

		it("withdrawFromSP(): partial retrieval - retrieves correct VUSD amount and the entire collateral gain, and updates deposit", async () => {
			// --- SETUP ---
			// Whale deposits 185000 VUSD in StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 24)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

			// 2 Vessels opened
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// --- TEST ---

			// Alice makes deposit #1: 15000 VUSD

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

			// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// 2 users with Vessel with 170 VUSD drawn are closed
			const liquidationTX_1 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			}) // 170 VUSD closed
			const liquidationTX_2 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			}) // 170 VUSD closed

			const [liquidatedDebt_1] = th.getEmittedLiquidationValues(liquidationTX_1)
			const [liquidatedDebt_2] = th.getEmittedLiquidationValues(liquidationTX_2)

			// Alice VUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
			const expectedVUSDLoss_A = liquidatedDebt_1
				.mul(toBN(dec(15000, 18)))
				.div(toBN(dec(200000, 18)))
				.add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

			const expectedCompoundedVUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedVUSDLoss_A)
			const compoundedVUSDDeposit_A = await stabilityPool.getCompoundedDebtTokenDeposits(alice)

			assert.isAtMost(th.getDifference(expectedCompoundedVUSDDeposit_A, compoundedVUSDDeposit_A), 100000)

			// Alice retrieves part of her entitled VUSD: 9000 VUSD
			await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

			const expectedNewDeposit_A = compoundedVUSDDeposit_A.sub(toBN(dec(9000, 18)))

			// check Alice's deposit has been updated to equal her compounded deposit minus her withdrawal */
			const newDeposit = (await stabilityPool.deposits(alice)).toString()
			assert.isAtMost(th.getDifference(newDeposit, expectedNewDeposit_A), 100000)

			// Expect Alice has withdrawn all gains
			const alice_pendingETHGain = (await stabilityPool.getDepositorGains(alice))[1][1]
			assert.equal(alice_pendingETHGain, 0)
		})

		it("withdrawFromSP(): partial retrieval - leaves the correct amount of VUSD in the Stability Pool", async () => {
			// --- SETUP ---
			// Whale deposits 185000 VUSD in StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 24)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

			// 2 Vessels opened
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})
			// --- TEST ---

			// Alice makes deposit #1: 15000 VUSD
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

			const SP_VUSD_Before = await stabilityPool.getTotalDebtTokenDeposits()
			assert.equal(SP_VUSD_Before, dec(200000, 18))

			// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// 2 users liquidated
			const liquidationTX_1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			const liquidationTX_2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})

			const [liquidatedDebt_1ERC20] = await th.getEmittedLiquidationValues(liquidationTX_1ERC20)
			const [liquidatedDebt_2ERC20] = await th.getEmittedLiquidationValues(liquidationTX_2ERC20)

			// Alice retrieves part of her entitled VUSD: 9000 VUSD
			await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

			/* Check SP has reduced from 2 liquidations and Alice's withdrawal
	  		Expect VUSD in SP = (200000 - liquidatedDebt_1 - liquidatedDebt_2 - 9000) */
			const expectedSPVUSDERC20 = toBN(dec(200000, 18))
				.sub(toBN(liquidatedDebt_1ERC20))
				.sub(toBN(liquidatedDebt_2ERC20))
				.sub(toBN(dec(9000, 18)))

			const SP_VUSD_After = (await stabilityPool.getTotalDebtTokenDeposits()).toString()

			th.assertIsApproximatelyEqual(SP_VUSD_After, expectedSPVUSDERC20)
		})

		it("withdrawFromSP(): full retrieval - leaves the correct amount of VUSD in the Stability Pool", async () => {
			// --- SETUP ---
			// Whale deposits 185000 VUSD in StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

			// 2 Vessels opened
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// --- TEST ---

			// Alice makes deposit #1
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

			const SP_VUSD_Before = await stabilityPool.getTotalDebtTokenDeposits()
			assert.equal(SP_VUSD_Before, dec(200000, 18))

			// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// 2 defaulters liquidated
			const liquidationTX_1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			const liquidationTX_2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})

			const [liquidatedDebt_1ERC20] = await th.getEmittedLiquidationValues(liquidationTX_1ERC20)
			const [liquidatedDebt_2ERC20] = await th.getEmittedLiquidationValues(liquidationTX_2ERC20)

			// Alice VUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
			const expectedVUSDLoss_AERC20 = liquidatedDebt_1ERC20
				.mul(toBN(dec(15000, 18)))
				.div(toBN(dec(200000, 18)))
				.add(liquidatedDebt_2ERC20.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

			const expectedCompoundedVUSDDeposit_AERC20 = toBN(dec(15000, 18)).sub(expectedVUSDLoss_AERC20)
			const compoundedVUSDDeposit_AERC20 = await stabilityPool.getCompoundedDebtTokenDeposits(alice)

			assert.isAtMost(th.getDifference(expectedCompoundedVUSDDeposit_AERC20, compoundedVUSDDeposit_AERC20), 100000)

			const VUSDinSPBefore = await stabilityPool.getTotalDebtTokenDeposits()

			// Alice retrieves all of her entitled VUSD:
			await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

			const expectedVUSDinSPAfterERC20 = VUSDinSPBefore.sub(compoundedVUSDDeposit_AERC20)

			const VUSDinSPAfterERC20 = await stabilityPool.getTotalDebtTokenDeposits()
			assert.isAtMost(th.getDifference(expectedVUSDinSPAfterERC20, VUSDinSPAfterERC20), 100000)
		})

		it("withdrawFromSP(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero collateral", async () => {
			// --- SETUP ---
			// Whale deposits 1850 VUSD in StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(dec(18500, 18), { from: whale })

			// 2 defaulters open
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})
			// --- TEST ---

			// Alice makes deposit #1: 15000 VUSD
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

			// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// defaulters liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Alice retrieves all of her entitled VUSD:
			await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })
			assert.equal((await stabilityPool.getDepositorGains(alice))[1].length, 0)

			// Alice makes second deposit
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			assert.equal((await stabilityPool.getDepositorGains(alice))[1][1], "0")

			const ERC20inSP_Before = (await stabilityPool.getCollateral(erc20.address)).toString()

			// Alice attempts second withdrawal
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
			assert.equal((await stabilityPool.getDepositorGains(alice))[1].length, 0)

			// Check collateral in pool does not change
			const ERC20inSP_1 = (await stabilityPool.getCollateral(erc20.address)).toString()
			assert.equal(ERC20inSP_Before, ERC20inSP_1)
		})

		it("withdrawFromSP(): it correctly updates the user's VUSD and collateral snapshots of entitled reward per unit staked", async () => {
			// --- SETUP ---
			// Whale deposits 185000 VUSD in StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

			// 2 defaulters open
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// --- TEST ---

			// Alice makes deposit #1: 15000 VUSD
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

			// check 'Before' snapshots
			const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
			const alice_snapshot_S_Before = await stabilityPool.S(alice, erc20.address) // alice_snapshot_Before[0].toString()
			const alice_snapshot_P_Before = alice_snapshot_Before["P"].toString()
			assert.equal(alice_snapshot_S_Before, 0)
			assert.equal(alice_snapshot_P_Before, "1000000000000000000")

			// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// 2 defaulters liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Alice retrieves part of her entitled VUSD: 9000 VUSD
			await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

			const P = (await stabilityPool.P()).toString()
			const S = (await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)).toString()
			// check 'After' snapshots
			const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
			const alice_snapshot_S_After = await stabilityPool.S(alice, erc20.address) //alice_snapshot_After[0].toString()
			const alice_snapshot_P_After = alice_snapshot_After["P"].toString()
			assert.equal(alice_snapshot_S_After, S)
			assert.equal(alice_snapshot_P_After, P)
		})

		it("withdrawFromSP(): decreases StabilityPool ERC20", async () => {
			// --- SETUP ---
			// Whale deposits 185,000 VUSD in StabilityPool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1_000_000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})
			await stabilityPool.provideToSP(dec(185_000, 18), { from: whale })

			// 1 defaulter opens
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// --- TEST ---

			// Alice makes deposit #1: 15,000 VUSD
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15_000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(15_000, 18), { from: alice })

			// price drops: defaulter's Vessel falls below MCR, alice and whale Vessel remain active
			await priceFeed.setPrice(erc20.address, dec("100", 18))

			// defaulter's Vessel is closed.
			const liquidationTx_1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			}) // 180 VUSD closed
			const [, liquidatedCollERC20] = th.getEmittedLiquidationValues(liquidationTx_1ERC20)

			// Get ActivePool and StabilityPool collateral before retrieval:
			const active_col_BeforeERC20 = await activePool.getAssetBalance(erc20.address)
			const stability_col_BeforeERC20 = await stabilityPool.getCollateral(erc20.address)

			// Expect alice to be entitled to 15000/200000 of the liquidated coll

			const aliceExpectedGainERC20 = liquidatedCollERC20.mul(toBN(dec(15_000, 18))).div(toBN(dec(200_000, 18)))
			const aliceGainERC20 = (await stabilityPool.getDepositorGains(alice))[1][1]
			assert.isTrue(aliceExpectedGainERC20.eq(aliceGainERC20))

			// Alice retrieves all of her deposit
			await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

			const active_col_AfterERC20 = await activePool.getAssetBalance(erc20.address)
			const stability_col_AfterERC20 = await stabilityPool.getCollateral(erc20.address)

			const active_col_DifferenceERC20 = active_col_BeforeERC20.sub(active_col_AfterERC20)
			const stability_col_DifferenceERC20 = stability_col_BeforeERC20.sub(stability_col_AfterERC20)

			assert.equal(active_col_DifferenceERC20, "0")

			// Expect StabilityPool to have decreased by Alice's AssetGain
			assert.isAtMost(th.getDifference(stability_col_DifferenceERC20, aliceGainERC20), 10000)
		})

		it("withdrawFromSP(): All depositors are able to withdraw from the SP to their account", async () => {
			// Whale opens vessel
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// 1 defaulter open
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// 6 Accounts open vessels and provide to SP
			const depositors = [alice, bob, carol, dennis, erin, flyn]
			for (account of depositors) {
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: account },
				})
				await stabilityPool.provideToSP(dec(10000, 18), { from: account })
			}

			await priceFeed.setPrice(erc20.address, dec(105, 18))
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			await priceFeed.setPrice(erc20.address, dec(200, 18))
			// All depositors attempt to withdraw
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
			assert.equal((await stabilityPool.deposits(alice)).toString(), "0")
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
			assert.equal((await stabilityPool.deposits(alice)).toString(), "0")
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: carol })
			assert.equal((await stabilityPool.deposits(alice)).toString(), "0")
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: dennis })
			assert.equal((await stabilityPool.deposits(alice)).toString(), "0")
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: erin })
			assert.equal((await stabilityPool.deposits(alice)).toString(), "0")
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: flyn })
			assert.equal((await stabilityPool.deposits(alice)).toString(), "0")

			const totalDeposits = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
			assert.isAtMost(th.getDifference(totalDeposits, "0"), 100000)
		})

		it("withdrawFromSP(): increases depositor's VUSD token balance by the expected amount", async () => {
			// Whale opens vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// 1 defaulter opens vessel
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			const defaulterDebtERC20 = (await vesselManager.getEntireDebtAndColl(erc20.address, defaulter_1))[0]

			// 6 Accounts open vessels and provide to SP
			const depositors = [alice, bob, carol, dennis, erin, flyn]

			for (account of depositors) {
				await openVessel({
					asset: erc20.address,
					extraVUSDAmount: toBN(dec(10000, 18)),
					ICR: toBN(dec(2, 18)),
					extraParams: { from: account },
				})
				await stabilityPool.provideToSP(dec(10000, 18), { from: account })
			}

			await priceFeed.setPrice(erc20.address, dec(105, 18))
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			const aliceBalBefore = await debtToken.balanceOf(alice)
			const bobBalBefore = await debtToken.balanceOf(bob)

			/* From an offset of 10000 VUSD, each depositor receives
	  VUSDLoss = 1666.6666666666666666 VUSD

	  and thus with a deposit of 10000 VUSD, each should withdraw 8333.3333333333333333 VUSD (in practice, slightly less due to rounding error)
	  */

			// Price bounces back to $200 per ETH
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Bob issues a further $5000 debt from his vessel
			await borrowerOperations.withdrawDebtTokens(erc20.address, dec(5000, 18), bob, bob, { from: bob })

			// Expect Alice's debt token balance increase be very close to 8333.3333333333333333 VUSD
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
			const aliceBalance = await debtToken.balanceOf(alice)
			assert.isAtMost(th.getDifference(aliceBalance.sub(aliceBalBefore), toBN("8333333333333333333333")), 100000)

			// expect Bob's debt token balance increase to be very close to  13333.33333333333333333 VUSD
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
			const bobBalance = await debtToken.balanceOf(bob)
			assert.isAtMost(th.getDifference(bobBalance.sub(bobBalBefore), toBN("13333333333333333333333")), 100000)
		})

		it("withdrawFromSP(): doesn't impact other users Stability deposits or ETH gains", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

			// Would-be defaulters open vessels
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// Defaulters are liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

			const alice_VUSDDeposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
			const bob_VUSDDeposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

			const alice_Gain_Before = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
			const bob_Gain_Before = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

			//check non-zero VUSD and AssetGain in the Stability Pool
			const VUSDinSP = await stabilityPool.getTotalDebtTokenDeposits()
			const ColinSP = await stabilityPool.getCollateral(erc20.address)
			assert.isTrue(VUSDinSP.gt(mv._zeroBN))
			assert.isTrue(ColinSP.gt(mv._zeroBN))

			// Price rises
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Carol withdraws her Stability deposit
			assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))

			await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })

			assert.equal((await stabilityPool.deposits(carol)).toString(), "0")

			const alice_VUSDDeposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
			const bob_VUSDDeposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

			const alice_Gain_After = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
			const bob_Gain_After = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

			// Check compounded deposits and Collateral gains for A and B have not changed
			assert.equal(alice_VUSDDeposit_Before, alice_VUSDDeposit_After)
			assert.equal(bob_VUSDDeposit_Before, bob_VUSDDeposit_After)
			assert.equal(alice_Gain_Before, alice_Gain_After)
			assert.equal(bob_Gain_Before, bob_Gain_After)
		})

		it("withdrawFromSP(): doesn't impact system debt, collateral or TCR ", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

			// Would-be defaulters open vessels
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// Defaulters are liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

			// Price rises
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			const activeDebt_BeforeERC20 = (await activePool.getDebtTokenBalance(erc20.address)).toString()
			const defaultedDebt_BeforeERC20 = (await defaultPool.getDebtTokenBalance(erc20.address)).toString()
			const activeColl_BeforeERC20 = (await activePool.getAssetBalance(erc20.address)).toString()
			const defaultedColl_BeforeERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
			const TCR_BeforeERC20 = (await th.getTCR(contracts, erc20.address)).toString()

			// Carol withdraws her Stability deposit
			assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
			await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
			assert.equal((await stabilityPool.deposits(carol)).toString(), "0")

			const activeDebt_AfterERC20 = (await activePool.getDebtTokenBalance(erc20.address)).toString()
			const defaultedDebt_AfterERC20 = (await defaultPool.getDebtTokenBalance(erc20.address)).toString()
			const activeColl_AfterERC20 = (await activePool.getAssetBalance(erc20.address)).toString()
			const defaultedColl_AfterERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
			const TCR_AfterERC20 = (await th.getTCR(contracts, erc20.address)).toString()

			// Check total system debt, collateral and TCR have not changed after a Stability deposit is made
			assert.equal(activeDebt_BeforeERC20, activeDebt_AfterERC20)
			assert.equal(defaultedDebt_BeforeERC20, defaultedDebt_AfterERC20)
			assert.equal(activeColl_BeforeERC20, activeColl_AfterERC20)
			assert.equal(defaultedColl_BeforeERC20, defaultedColl_AfterERC20)
			assert.equal(TCR_BeforeERC20, TCR_AfterERC20)
		})

		it("withdrawFromSP(): doesn't impact any vessels, including the caller's vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B and C provide to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			const price = await priceFeed.getPrice(erc20.address)

			// Get debt, collateral and ICR of all existing vessels
			const whale_Debt_BeforeERC20 = (await vesselManager.Vessels(whale, erc20.address))[0].toString()
			const alice_Debt_BeforeERC20 = (await vesselManager.Vessels(alice, erc20.address))[0].toString()
			const bob_Debt_BeforeERC20 = (await vesselManager.Vessels(bob, erc20.address))[0].toString()
			const carol_Debt_BeforeERC20 = (await vesselManager.Vessels(carol, erc20.address))[0].toString()

			const whale_Coll_BeforeERC20 = (await vesselManager.Vessels(whale, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const alice_Coll_BeforeERC20 = (await vesselManager.Vessels(alice, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const bob_Coll_BeforeERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const carol_Coll_BeforeERC20 = (await vesselManager.Vessels(carol, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()

			const whale_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, whale, price)).toString()
			const alice_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
			const bob_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
			const carol_ICR_BeforeERC20 = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()

			// price rises
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Carol withdraws her Stability deposit
			assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
			await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
			assert.equal((await stabilityPool.deposits(carol)).toString(), "0")

			const whale_Debt_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[0].toString()
			const alice_Debt_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[0].toString()
			const bob_Debt_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[0].toString()
			const carol_Debt_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[0].toString()

			const whale_Coll_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const alice_Coll_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const bob_Coll_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].toString()
			const carol_Coll_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX].toString()

			const whale_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, whale, price)).toString()
			const alice_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
			const bob_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
			const carol_ICR_AfterERC20 = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()

			// Check all vessels are unaffected by Carol's Stability deposit withdrawal
			assert.equal(whale_Debt_BeforeERC20, whale_Debt_AfterERC20)
			assert.equal(alice_Debt_BeforeERC20, alice_Debt_AfterERC20)
			assert.equal(bob_Debt_BeforeERC20, bob_Debt_AfterERC20)
			assert.equal(carol_Debt_BeforeERC20, carol_Debt_AfterERC20)

			assert.equal(whale_Coll_BeforeERC20, whale_Coll_AfterERC20)
			assert.equal(alice_Coll_BeforeERC20, alice_Coll_AfterERC20)
			assert.equal(bob_Coll_BeforeERC20, bob_Coll_AfterERC20)
			assert.equal(carol_Coll_BeforeERC20, carol_Coll_AfterERC20)

			assert.equal(whale_ICR_BeforeERC20, whale_ICR_AfterERC20)
			assert.equal(alice_ICR_BeforeERC20, alice_ICR_AfterERC20)
			assert.equal(bob_ICR_BeforeERC20, bob_ICR_AfterERC20)
			assert.equal(carol_ICR_BeforeERC20, carol_ICR_AfterERC20)
		})

		it("withdrawFromSP(): succeeds when amount is 0 and system has an undercollateralized vessel", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})

			await stabilityPool.provideToSP(dec(100, 18), { from: alice })

			const A_initialDeposit = (await stabilityPool.deposits(alice)).toString()
			assert.equal(A_initialDeposit, dec(100, 18))

			// defaulters opens vessel
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})

			// price drops, defaulters are in liquidation range
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			const price = await priceFeed.getPrice(erc20.address)
			assert.isTrue(await th.ICRbetween100and110(defaulter_1, vesselManager, price, erc20.address))

			await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

			// Liquidate d1
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

			// Check d2 is undercollateralized
			assert.isTrue(await th.ICRbetween100and110(defaulter_2, vesselManager, price, erc20.address))
			assert.isTrue(await sortedVessels.contains(erc20.address, defaulter_2))

			const A_BalBeforeERC20 = toBN(await erc20.balanceOf(alice))
			const A_GRVTBalBefore = await grvtToken.balanceOf(alice)

			// Check Alice has gains to withdraw
			const A_pendingColGain = (await stabilityPool.getDepositorGains(alice))[1][1]
			const A_pendingGRVTGain = await stabilityPool.getDepositorGRVTGain(alice)
			assert.isTrue(A_pendingColGain.gt(toBN("0")))
			assert.isTrue(A_pendingGRVTGain.gt(toBN("0")))

			// Check withdrawal of 0 succeeds
			const tx = await stabilityPool.withdrawFromSP(0, { from: alice })
			assert.isTrue(tx.receipt.status)

			const A_BalAfterERC20 = toBN(await erc20.balanceOf(alice))

			const A_GRVTBalAfter = await grvtToken.balanceOf(alice)
			const A_GRVTBalDiff = A_GRVTBalAfter.sub(A_GRVTBalBefore)

			// Check A's collateral and GRVT balances have increased correctly
			assert.isTrue(A_BalAfterERC20.sub(A_BalBeforeERC20).eq(A_pendingColGain))
			assert.isTrue(A_GRVTBalDiff.sub(A_pendingGRVTGain).eq(toBN("0")))
		})

		it("withdrawFromSP(): withdrawing 0 VUSD doesn't alter the caller's deposit or the total VUSD in the Stability Pool", async () => {
			// --- SETUP ---
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B, C provides 100, 50, 30 VUSD to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(50, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30, 18), { from: carol })

			const bob_Deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
			const VUSDinSP_Before = (await stabilityPool.getTotalDebtTokenDeposits()).toString()

			assert.equal(VUSDinSP_Before, dec(180, 18))

			// Bob withdraws 0 VUSD from the Stability Pool
			await stabilityPool.withdrawFromSP(0, { from: bob })

			// check Bob's deposit and total VUSD in Stability Pool has not changed
			const bob_Deposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
			const VUSDinSP_After = (await stabilityPool.getTotalDebtTokenDeposits()).toString()

			assert.equal(bob_Deposit_Before, bob_Deposit_After)
			assert.equal(VUSDinSP_Before, VUSDinSP_After)
		})

		it("withdrawFromSP(): withdrawing 0 Collateral Gain does not alter the caller's Collateral balance, their vessel collateral, or the collateral in the Stability Pool", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// Would-be defaulter open vessel
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			// Defaulter 1 liquidated, full offset
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			// Dennis opens vessel and deposits to Stability Pool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: dennis },
			})
			await stabilityPool.provideToSP(dec(100, 18), { from: dennis })

			// Check Dennis has 0 collateral gains
			const dennis_ETHGain = (await stabilityPool.getDepositorGains(dennis))[1][1].toString()
			assert.equal(dennis_ETHGain, "0")

			const dennis_Balance_BeforeERC20 = (await erc20.balanceOf(dennis)).toString()
			const dennis_Collateral_BeforeERC20 = (await vesselManager.Vessels(dennis, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const ColinSP_BeforeERC20 = (await stabilityPool.getCollateral(erc20.address)).toString()

			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Dennis withdraws his full deposit and collateral gains to his account
			await stabilityPool.withdrawFromSP(dec(100, 18), { from: dennis })

			// Check withdrawal does not alter Dennis' collateral balance or his vessel's collateral
			const dennis_Balance_AfterERC20 = (await erc20.balanceOf(dennis)).toString()
			const dennis_Collateral_AfterERC20 = (await vesselManager.Vessels(dennis, erc20.address))[
				th.VESSEL_COLL_INDEX
			].toString()
			const ColinSP_AfterERC20 = (await stabilityPool.getCollateral(erc20.address)).toString()

			assert.equal(dennis_Balance_BeforeERC20, dennis_Balance_AfterERC20)
			assert.equal(dennis_Collateral_BeforeERC20, dennis_Collateral_AfterERC20)

			// Check withdrawal has not altered the collateral in the Stability Pool
			assert.equal(ColinSP_BeforeERC20, ColinSP_AfterERC20)
		})

		it("withdrawFromSP(): Request to withdraw > caller's deposit only withdraws the caller's compounded deposit", async () => {
			// --- SETUP ---
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels and make Stability Pool deposits
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// A, B, C provide VUSD to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// Liquidate defaulter 1
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			const alice_VUSD_Balance_Before = await debtToken.balanceOf(alice)
			const bob_VUSD_Balance_Before = await debtToken.balanceOf(bob)

			const alice_Deposit_Before = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
			const bob_Deposit_Before = await stabilityPool.getCompoundedDebtTokenDeposits(bob)

			const VUSDinSP_Before = await stabilityPool.getTotalDebtTokenDeposits()

			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Bob attempts to withdraws 1 wei more than his compounded deposit from the Stability Pool
			await stabilityPool.withdrawFromSP(bob_Deposit_Before.add(toBN(1)), { from: bob })

			// Check Bob's VUSD balance has risen by only the value of his compounded deposit
			const bob_expectedVUSDBalance = bob_VUSD_Balance_Before.add(bob_Deposit_Before).toString()
			const bob_VUSD_Balance_After = (await debtToken.balanceOf(bob)).toString()
			assert.equal(bob_VUSD_Balance_After, bob_expectedVUSDBalance)

			// Alice attempts to withdraws 2309842309.000000000000000000 VUSD from the Stability Pool
			await stabilityPool.withdrawFromSP("2309842309000000000000000000", { from: alice })

			// Check Alice's VUSD balance has risen by only the value of her compounded deposit
			const alice_expectedVUSDBalance = alice_VUSD_Balance_Before.add(alice_Deposit_Before).toString()
			const alice_VUSD_Balance_After = (await debtToken.balanceOf(alice)).toString()
			assert.equal(alice_VUSD_Balance_After, alice_expectedVUSDBalance)

			// Check VUSD in Stability Pool has been reduced by only Alice's compounded deposit and Bob's compounded deposit
			const expectedVUSDinSP = VUSDinSP_Before.sub(alice_Deposit_Before).sub(bob_Deposit_Before).toString()
			const VUSDinSP_After = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
			assert.equal(VUSDinSP_After, expectedVUSDinSP)
		})

		it("withdrawFromSP(): Request to withdraw 2^256-1 VUSD only withdraws the caller's compounded deposit", async () => {
			// --- SETUP ---
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			// A, B, C provides 100, 50, 30 VUSD to SP
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })
			await stabilityPool.provideToSP(dec(50, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30, 18), { from: carol })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Liquidate defaulter 1
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			const bob_VUSD_Balance_Before = await debtToken.balanceOf(bob)

			const bob_Deposit_Before = await stabilityPool.getCompoundedDebtTokenDeposits(bob)

			const VUSDinSP_Before = await stabilityPool.getTotalDebtTokenDeposits()

			const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// Bob attempts to withdraws maxBytes32 VUSD from the Stability Pool
			await stabilityPool.withdrawFromSP(maxBytes32, { from: bob })

			// Check Bob's VUSD balance has risen by only the value of his compounded deposit
			const bob_expectedVUSDBalance = bob_VUSD_Balance_Before.add(bob_Deposit_Before).toString()
			const bob_VUSD_Balance_After = (await debtToken.balanceOf(bob)).toString()
			assert.equal(bob_VUSD_Balance_After, bob_expectedVUSDBalance)

			// Check VUSD in Stability Pool has been reduced by only  Bob's compounded deposit
			const expectedVUSDinSP = VUSDinSP_Before.sub(bob_Deposit_Before).toString()
			const VUSDinSP_After = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
			assert.equal(VUSDinSP_After, expectedVUSDinSP)
		})

		it("withdrawFromSP(): caller can withdraw full deposit and collateral gain during Recovery Mode", async () => {
			// --- SETUP ---

			// Price doubles
			await priceFeed.setPrice(erc20.address, dec(400, 18))
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: whale },
			})
			// Price halves
			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// A, B, C open vessels and make Stability Pool deposits
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(4, 18)),
				extraParams: { from: alice },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(4, 18)),
				extraParams: { from: bob },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(4, 18)),
				extraParams: { from: carol },
			})

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), ZERO_ADDRESS),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// A, B, C provides 10000, 5000, 3000 VUSD to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(5000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

			// Price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			const price = await priceFeed.getPrice(erc20.address)

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// Liquidate defaulter 1
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

			const alice_VUSD_Balance_Before = await debtToken.balanceOf(alice)
			const bob_VUSD_Balance_Before = await debtToken.balanceOf(bob)
			const carol_VUSD_Balance_Before = await debtToken.balanceOf(carol)

			const alice_Balance_BeforeERC20 = web3.utils.toBN(await erc20.balanceOf(alice))
			const bob_Balance_BeforeERC20 = web3.utils.toBN(await erc20.balanceOf(bob))
			const carol_Balance_BeforeERC20 = web3.utils.toBN(await erc20.balanceOf(carol))

			const alice_Deposit_Before = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
			const bob_Deposit_Before = await stabilityPool.getCompoundedDebtTokenDeposits(bob)
			const carol_Deposit_Before = await stabilityPool.getCompoundedDebtTokenDeposits(carol)

			const alice_Gain_Before = (await stabilityPool.getDepositorGains(alice))[1][1]
			const bob_Gain_Before = (await stabilityPool.getDepositorGains(bob))[1][1]
			const carol_Gain_Before = (await stabilityPool.getDepositorGains(carol))[1][1]

			const VUSDinSP_Before = await stabilityPool.getTotalDebtTokenDeposits()
			const VUSDinSP_BeforeERC20 = await stabilityPool.getTotalDebtTokenDeposits()

			// Price rises
			await priceFeed.setPrice(erc20.address, dec(220, 18))

			assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

			// A, B, C withdraw their full deposits from the Stability Pool
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
			await stabilityPool.withdrawFromSP(dec(5000, 18), { from: bob })
			await stabilityPool.withdrawFromSP(dec(3000, 18), { from: carol })

			// Check VUSD balances of A, B, C have risen by the value of their compounded deposits, respectively
			const alice_expectedVUSDBalance = alice_VUSD_Balance_Before.add(alice_Deposit_Before).toString()
			const bob_expectedVUSDBalance = bob_VUSD_Balance_Before.add(bob_Deposit_Before).toString()
			const carol_expectedVUSDBalance = carol_VUSD_Balance_Before.add(carol_Deposit_Before).toString()

			const alice_VUSD_Balance_After = (await debtToken.balanceOf(alice)).toString()
			const bob_VUSD_Balance_After = (await debtToken.balanceOf(bob)).toString()
			const carol_VUSD_Balance_After = (await debtToken.balanceOf(carol)).toString()

			assert.equal(alice_VUSD_Balance_After, alice_expectedVUSDBalance)
			assert.equal(bob_VUSD_Balance_After, bob_expectedVUSDBalance)
			assert.equal(carol_VUSD_Balance_After, carol_expectedVUSDBalance)

			// Check collateral balances of A, B, C have increased by the value of their collateral gain from liquidations, respectively
			const alice_expectedColBalance = alice_Balance_BeforeERC20.add(alice_Gain_Before).toString()
			const bob_expectedETHBalance = bob_Balance_BeforeERC20.add(bob_Gain_Before).toString()
			const carol_expectedETHBalance = carol_Balance_BeforeERC20.add(carol_Gain_Before).toString()

			const alice_Balance_AfterERC20 = (await erc20.balanceOf(alice)).toString()
			const bob_Balance_AfterERC20 = (await erc20.balanceOf(bob)).toString()
			const carol_Balance_AfterERC20 = (await erc20.balanceOf(carol)).toString()

			assert.equal(alice_expectedColBalance, alice_Balance_AfterERC20)
			assert.equal(bob_expectedETHBalance, bob_Balance_AfterERC20)
			assert.equal(carol_expectedETHBalance, carol_Balance_AfterERC20)

			// Check VUSD in Stability Pool has been reduced by A, B and C's compounded deposit
			const expectedVUSDinSP = VUSDinSP_Before.sub(alice_Deposit_Before)
				.sub(bob_Deposit_Before)
				.sub(carol_Deposit_Before)
				.toString()
			const VUSDinSP_After = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
			assert.equal(VUSDinSP_After, expectedVUSDinSP)

			// Check ETH in SP has reduced to zero
			const ColinSP_After = (await stabilityPool.getCollateral(erc20.address)).toString()
			assert.isAtMost(th.getDifference(ColinSP_After, "0"), 100000)
		})

		it("getDepositorGains(): depositor does not earn further collateral gains from liquidations while their compounded deposit == 0: ", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 24)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// defaulters open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(15000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_2 },
			})
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_3 },
			})

			// A, B, provide 10000, 5000 VUSD to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(5000, 18), { from: bob })

			//price drops
			await priceFeed.setPrice(erc20.address, dec(105, 18))

			// Liquidate defaulter 1. Empties the Pool
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

			const VUSDinSP = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
			assert.equal(VUSDinSP, "0")

			// Check Stability deposits have been fully cancelled with debt, and are now all zero
			const alice_Deposit = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
			const bob_Deposit = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

			assert.equal(alice_Deposit, "0")
			assert.equal(bob_Deposit, "0")

			// Get collateral gain for A and B
			const alice_Gain_1 = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
			const bob_Gain_1 = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

			// Whale deposits 10000 VUSD to Stability Pool
			await stabilityPool.provideToSP(dec(1, 24), { from: whale })

			// Liquidation 2
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

			// Check Alice and Bob have not received ETH gain from liquidation 2 while their deposit was 0
			const alice_Gain_2 = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
			const bob_Gain_2 = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

			assert.equal(alice_Gain_1, alice_Gain_2)
			assert.equal(bob_Gain_1, bob_Gain_2)

			// Liquidation 3
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))

			// Check Alice and Bob have not received collateral gain from liquidation 3 while their deposit was 0
			const alice_Gain_3 = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
			const bob_Gain_3 = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

			assert.equal(alice_Gain_1, alice_Gain_3)
			assert.equal(bob_Gain_1, bob_Gain_3)
		})

		// --- GRVT functionality ---
		it("withdrawFromSP(): triggers GRVT reward event - increases the sum G", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1, 24)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A and B provide to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(10000, 18), { from: bob })

			const G_Before = await stabilityPool.epochToScaleToG(0, 0)

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// A withdraws from SP
			await stabilityPool.withdrawFromSP(dec(5000, 18), { from: alice })

			const G_1 = await stabilityPool.epochToScaleToG(0, 0)

			// Expect G has increased from the GRVT reward event triggered
			assert.isTrue(G_1.gt(G_Before))

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// A withdraws from SP
			await stabilityPool.withdrawFromSP(dec(5000, 18), { from: bob })

			const G_2 = await stabilityPool.epochToScaleToG(0, 0)

			// Expect G has increased from the GRVT reward event triggered
			assert.isTrue(G_2.gt(G_1))
		})

		it("withdrawFromSP(): partial withdrawal = depositor receives GRVT rewards", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A, B, C open vessels
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
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: carol },
			})

			// A, B, C, provide to SP
			await stabilityPool.provideToSP(dec(10, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30, 18), { from: carol })

			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

			// Get A, B, C GRVT balance before
			const A_GRVTBalance_Before = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_Before = await grvtToken.balanceOf(bob)
			const C_GRVTBalance_Before = await grvtToken.balanceOf(carol)

			// A, B, C withdraw
			await stabilityPool.withdrawFromSP(dec(1, 18), { from: alice })
			await stabilityPool.withdrawFromSP(dec(2, 18), { from: bob })
			await stabilityPool.withdrawFromSP(dec(3, 18), { from: carol })

			// Get GRVT balance after
			const A_GRVTBalance_After = await grvtToken.balanceOf(alice)
			const B_GRVTBalance_After = await grvtToken.balanceOf(bob)
			const C_GRVTBalance_After = await grvtToken.balanceOf(carol)

			// Check GRVT Balance of A, B, C has increased
			assert.isTrue(A_GRVTBalance_After.gt(A_GRVTBalance_Before))
			assert.isTrue(B_GRVTBalance_After.gt(B_GRVTBalance_Before))
			assert.isTrue(C_GRVTBalance_After.gt(C_GRVTBalance_Before))
		})

		it("withdrawFromSP(): full withdrawal = zero's depositor's snapshots", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(1000000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			//  SETUP: Execute a series of operations to make G, S > 0 and P < 1

			// E opens vessel and makes a deposit
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(20000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: E },
			})
			await stabilityPool.provideToSP(dec(10000, 18), { from: E })

			// Fast-forward time and make a second deposit, to trigger GRVT reward and make G > 0
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
			await stabilityPool.provideToSP(dec(10000, 18), { from: E })

			// perform a liquidation to make 0 < P < 1, and S > 0
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)

			const currentEpoch = await stabilityPool.currentEpoch()
			const currentScale = await stabilityPool.currentScale()

			const S_Before = await stabilityPool.epochToScaleToSum(erc20.address, currentEpoch, currentScale)
			const P_Before = await stabilityPool.P()
			const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

			// Confirm 0 < P < 1
			assert.isTrue(P_Before.gt(toBN("0")) && P_Before.lt(toBN(dec(1, 18))))
			// Confirm S, G are both > 0
			assert.isTrue(S_Before.gt(toBN("0")))
			assert.isTrue(G_Before.gt(toBN("0")))

			// --- TEST ---

			// Whale transfers to A, B
			await debtToken.transfer(alice, dec(20000, 18), { from: whale })
			await debtToken.transfer(bob, dec(40000, 18), { from: whale })

			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// C, D open vessels
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(30000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: carol },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(40000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: dennis },
			})

			// A, B, C, D make their initial deposits
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
			await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
			await stabilityPool.provideToSP(dec(30000, 18), { from: carol })
			await stabilityPool.provideToSP(dec(40000, 18), { from: dennis })

			// Check deposits snapshots are non-zero

			for (depositor of [alice, bob, carol, dennis]) {
				const snapshot = await stabilityPool.depositSnapshots(depositor)

				const ZERO = toBN("0")
				// Check S,P, G snapshots are non-zero
				assert.isTrue((await stabilityPool.S(depositor, erc20.address)).eq(S_Before))
				//assert.isTrue(snapshot[0].eq(S_Before)) // S
				assert.isTrue(snapshot["P"].eq(P_Before)) // P
				assert.isTrue(snapshot["G"].gt(ZERO)) // G increases a bit between each depositor op, so just check it is non-zero
				assert.equal(snapshot["scale"], "0") // scale
				assert.equal(snapshot["epoch"], "0") // epoch
			}

			// All depositors make full withdrawal
			await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
			await stabilityPool.withdrawFromSP(dec(20000, 18), { from: bob })
			await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
			await stabilityPool.withdrawFromSP(dec(40000, 18), { from: dennis })

			// Check all depositors' snapshots have been zero'd
			for (depositor of [alice, bob, carol, dennis]) {
				const snapshot = await stabilityPool.depositSnapshots(depositor)

				// Check S, P, G snapshots are now zero
				assert.equal(await stabilityPool.S(depositor, erc20.address), "0")
				assert.equal(snapshot["P"], "0") // P
				assert.equal(snapshot["G"], "0") // G increases a bit between each depositor op, so just check it is non-zero
				assert.equal(snapshot["scale"], "0") // scale
				assert.equal(snapshot["epoch"], "0") // epoch
			}
		})

		it("withdrawFromSP(): reverts when initial deposit value is 0", async () => {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(100000, 18)),
				ICR: toBN(dec(10, 18)),
				extraParams: { from: whale },
			})

			// A opens vessel and join the Stability Pool
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10100, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: alice },
			})
			await stabilityPool.provideToSP(dec(10000, 18), { from: alice })

			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter_1 },
			})

			//  SETUP: Execute a series of operations to trigger GRVT and ETH rewards for depositor A

			// Fast-forward time and make a second deposit, to trigger GRVT reward and make G > 0
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
			await stabilityPool.provideToSP(dec(100, 18), { from: alice })

			// perform a liquidation to make 0 < P < 1, and S > 0
			await priceFeed.setPrice(erc20.address, dec(105, 18))
			assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

			await priceFeed.setPrice(erc20.address, dec(200, 18))

			// A successfully withraws deposit and all gains
			await stabilityPool.withdrawFromSP(dec(10100, 18), { from: alice })

			// Confirm A's recorded deposit is 0
			assert.equal(await stabilityPool.deposits(alice), "0")

			// --- TEST ---
			const expectedRevertMessage = "StabilityPool: User must have a non-zero deposit"

			// Further withdrawal attempt from A
			await th.assertRevert(stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice }), expectedRevertMessage)

			// Withdrawal attempt of a non-existent deposit, from C
			await th.assertRevert(stabilityPool.withdrawFromSP(dec(10000, 18), { from: carol }), expectedRevertMessage)
		})
	})
})

contract("Reset chain state", async accounts => {})
