const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const { dec, toBN } = th
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

contract("StabilityPool", async accounts => {
	const [
		owner,
		defaulter_1,
		defaulter_2,
		defaulter_3,
		defaulter_4,
		defaulter_5,
		defaulter_6,
		whale,
		alice,
		bob,
		carol,
		dennis,
		erin,
		flyn,
		graham,
		treasury
	] = accounts

	let contracts

	let activePool
	let borrowerOperations
	let debtToken
	let defaultPool
	let erc20
	let erc20B
	let grvtToken
	let priceFeed
	let sortedVessels
	let stabilityPool
	let vesselManager
	let vesselManagerOperations

	const getOpenVesselVUSDAmount = async (totalDebt, asset) => th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)
	const openVessel = async params => th.openVessel(contracts, params)
	const assertRevert = th.assertRevert

	async function _openVessel(erc20Contract, extraDebtTokenAmt, sender) {
		await _openVesselWithICR(erc20Contract, extraDebtTokenAmt, 2, sender)
	}

	async function _openVesselWithICR(erc20Contract, extraDebtTokenAmt, icr, sender) {
		await th.openVessel(contracts, {
			asset: erc20Contract.address,
			extraVUSDAmount: toBN(dec(extraDebtTokenAmt, 18)),
			ICR: toBN(dec(icr, 18)),
			extraParams: { from: sender },
		})
	}

	async function _openVesselWithCollAmt(erc20Contract, collAmt, extraDebtTokenAmt, sender) {
		await th.openVessel(contracts, {
			asset: erc20Contract.address,
			assetSent: toBN(dec(collAmt, 18)),
			extraVUSDAmount: toBN(dec(extraDebtTokenAmt, 18)),
			//ICR: toBN(dec(2, 18)),
			extraParams: { from: sender },
		})
	}

	async function openWhaleVessel(erc20Contract, icr = 2, extraDebtTokenAmt = 100_000) {
		await openVessel({
			asset: erc20Contract.address,
			assetSent: toBN(dec(50, 18)),
			extraVUSDAmount: toBN(dec(extraDebtTokenAmt, 18)),
			ICR: toBN(dec(icr, 18)),
			extraParams: { from: whale },
		})
	}

	async function dropPriceByPercent(erc20Contract, pct) {
		const price = await priceFeed.getPrice(erc20Contract.address)
		const newPrice = price.mul(toBN(100 - pct)).div(toBN(100))
		await priceFeed.setPrice(erc20Contract.address, newPrice)
	}

	describe("Stability Pool Mechanisms", async () => {
		beforeEach(async () => {
			const { coreContracts, GRVTContracts } = await deploymentHelper.deployTestContracts(treasury, accounts.slice(0, 20))

			contracts = coreContracts
			activePool = contracts.activePool
			borrowerOperations = contracts.borrowerOperations
			debtToken = contracts.debtToken
			defaultPool = contracts.defaultPool
			erc20 = contracts.erc20
			erc20B = contracts.erc20B
			priceFeed = contracts.priceFeedTestnet
			sortedVessels = contracts.sortedVessels
			stabilityPool = contracts.stabilityPool
			vesselManager = contracts.vesselManager
			vesselManagerOperations = contracts.vesselManagerOperations

			grvtToken = GRVTContracts.grvtToken
		})

		describe("Providing", async () => {
			it("provideToSP(): increases the Stability Pool balance", async () => {
				await _openVessel(erc20, (extraDebtTokenAmt = 200), alice)
				await stabilityPool.provideToSP(200, { from: alice })
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), 200)
			})

			it("provideToSP(): reverts when trying to make a SP deposit without debt token balance", async () => {
				const aliceTxPromise = stabilityPool.provideToSP(200, { from: alice })
				await assertRevert(aliceTxPromise, "revert")
			})

			it("provideToSP(): updates the user's deposit record in StabilityPool", async () => {
				await _openVessel(erc20, (extraDebtTokenAmt = 200), alice)
				assert.equal(await stabilityPool.deposits(alice), 0)
				await stabilityPool.provideToSP(200, { from: alice })
				assert.equal(await stabilityPool.deposits(alice), 200)
			})

			it("provideToSP(): reduces the user's debt token balance by the correct amount", async () => {
				await _openVessel(erc20, (extraDebtTokenAmt = 200), alice)
				const alice_balance_Before = await debtToken.balanceOf(alice)
				await stabilityPool.provideToSP(400, { from: alice })
				const alice_balance_After = await debtToken.balanceOf(alice)
				assert.equal(alice_balance_Before.sub(alice_balance_After), "400")
			})

			it("provideToSP(): Correctly updates user snapshots of accumulated rewards per unit staked", async () => {
				await openWhaleVessel(erc20)
				await openWhaleVessel(erc20B)

				const whaleDebtTokenBalance = await debtToken.balanceOf(whale)
				await stabilityPool.provideToSP(whaleDebtTokenBalance.div(toBN(2)), { from: whale })

				// 2 Vessels opened, each withdraws minimum debt
				await _openVessel(erc20, (extraDebtTokenAmt = 0), defaulter_1)
				await _openVessel(erc20B, (extraDebtTokenAmt = 0), defaulter_2)

				// Alice opens Vessels and withdraws 100
				await _openVesselWithICR(erc20, (extraDebtTokenAmt = 100), (icr = 5), alice)
				await _openVesselWithICR(erc20B, (extraDebtTokenAmt = 100), (icr = 5), alice)

				// Prices drop by 40%: defaulter's Vessels fall below MCR, whale doesn't
				await dropPriceByPercent(erc20, 40)
				await dropPriceByPercent(erc20B, 40)

				const debtTokenDepositsBefore = await stabilityPool.getTotalDebtTokenDeposits()

				// Vessels are closed
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
				await vesselManagerOperations.liquidate(erc20B.address, defaulter_2, { from: owner })

				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20B.address, defaulter_2))

				// Confirm SP has decreased
				const debtTokenDepositsAfter = await stabilityPool.getTotalDebtTokenDeposits()
				assert.isTrue(debtTokenDepositsAfter.lt(debtTokenDepositsBefore))

				const P_Before = await stabilityPool.P()
				const S_Before_ERC1 = await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)
				const S_Before_ERC2 = await stabilityPool.epochToScaleToSum(erc20B.address, 0, 0)
				const G_Before = await stabilityPool.epochToScaleToG(0, 0)

				assert.isTrue(P_Before.gt(toBN("0")))
				assert.isTrue(S_Before_ERC1.gt(toBN("0")))
				assert.isTrue(S_Before_ERC2.gt(toBN("0")))

				// Check 'Before' snapshots
				const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
				const alice_snapshot_S_Before_ERC1 = await stabilityPool.S(alice, erc20.address)
				const alice_snapshot_S_Before_ERC2 = await stabilityPool.S(alice, erc20B.address)
				const alice_snapshot_P_Before = alice_snapshot_Before["P"].toString()
				const alice_snapshot_G_Before = alice_snapshot_Before["G"].toString()

				assert.equal(alice_snapshot_S_Before_ERC1, "0")
				assert.equal(alice_snapshot_S_Before_ERC2, "0")
				assert.equal(alice_snapshot_P_Before, "0")
				assert.equal(alice_snapshot_G_Before, "0")

				// Make deposit
				await stabilityPool.provideToSP(dec(100, 18), { from: alice })

				// Check 'After' snapshots
				const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
				const alice_snapshot_S_After_A = await stabilityPool.S(alice, erc20.address)
				const alice_snapshot_S_After_B = await stabilityPool.S(alice, erc20B.address)
				const alice_snapshot_P_After = alice_snapshot_After["P"].toString()
				const alice_snapshot_G_After = alice_snapshot_After["G"].toString()

				assert.equal(alice_snapshot_S_After_A.toString(), S_Before_ERC1.toString())
				assert.equal(alice_snapshot_S_After_B.toString(), S_Before_ERC2.toString())
				assert.equal(alice_snapshot_P_After, P_Before)
				assert.equal(alice_snapshot_G_After, G_Before)
			})

			it("provideToSP(): multiple deposits = updates user's deposit and snapshots", async () => {
				await openWhaleVessel(erc20)
				const whaleDebtTokenBalance = await debtToken.balanceOf(whale)
				await stabilityPool.provideToSP(whaleDebtTokenBalance.div(toBN(2)), { from: whale })

				// 3 Vessels opened for each collateral
				await _openVessel(erc20, (extraDebtTokenAmt = 160), defaulter_1) // ICR = 2,000000000000000000
				await _openVessel(erc20, (extraDebtTokenAmt = 160), defaulter_2)
				await _openVessel(erc20, (extraDebtTokenAmt = 160), defaulter_3)

				await _openVessel(erc20B, (extraDebtTokenAmt = 160), defaulter_4) // ICR = 2,000000000000000000
				await _openVessel(erc20B, (extraDebtTokenAmt = 160), defaulter_5)
				await _openVessel(erc20B, (extraDebtTokenAmt = 160), defaulter_6)

				// Alice & Dennis open vessels receiving 250 & depositing 150 to SP
				await _openVesselWithICR(erc20, (extraDebtTokenAmt = 250), (icr = 3), alice)
				await stabilityPool.provideToSP(dec(150, 18), { from: alice })

				await _openVesselWithICR(erc20B, (extraDebtTokenAmt = 250), (icr = 3), dennis)
				await stabilityPool.provideToSP(dec(150, 18), { from: dennis })

				const alice_Snapshot_0 = await stabilityPool.depositSnapshots(alice)
				const alice_Snapshot_S_0_ERC1 = await stabilityPool.S(alice, erc20.address)
				const alice_Snapshot_P_0 = alice_Snapshot_0["P"]
				assert.equal(alice_Snapshot_S_0_ERC1, 0)
				assert.equal(alice_Snapshot_P_0, (1e18).toString())

				const dennis_Snapshot_0 = await stabilityPool.depositSnapshots(dennis)
				const dennis_Snapshot_S_0_ERC2 = await stabilityPool.S(dennis, erc20B.address)
				const dennis_Snapshot_P_0 = dennis_Snapshot_0["P"]
				assert.equal(dennis_Snapshot_S_0_ERC2, 0)
				assert.equal(dennis_Snapshot_P_0, (1e18).toString())

				// price drops: defaulters' Vessels fall below MCR, but alice, dennis and whale Vessels remain active
				await dropPriceByPercent(erc20, 45)
				await dropPriceByPercent(erc20B, 48)

				await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
				await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
				await vesselManagerOperations.liquidate(erc20B.address, defaulter_4, { from: owner })
				await vesselManagerOperations.liquidate(erc20B.address, defaulter_5, { from: owner })

				const alice_compoundedDeposit_1 = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
				const alice_topUp_1 = toBN(dec(100, 18))
				await stabilityPool.provideToSP(alice_topUp_1, { from: alice })
				const alice_newDeposit_1 = (await stabilityPool.deposits(alice)).toString()
				assert.equal(alice_compoundedDeposit_1.add(alice_topUp_1), alice_newDeposit_1)

				const dennis_compoundedDeposit_1 = await stabilityPool.getCompoundedDebtTokenDeposits(dennis)
				const dennis_topUp_1 = toBN(dec(100, 18))
				await stabilityPool.provideToSP(dennis_topUp_1, { from: dennis })
				const dennis_newDeposit_1 = (await stabilityPool.deposits(dennis)).toString()
				assert.equal(dennis_compoundedDeposit_1.add(dennis_topUp_1), dennis_newDeposit_1)

				// get system reward terms
				const P_1 = await stabilityPool.P()
				const S_1_ERC1 = await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)
				const S_1_ERC2 = await stabilityPool.epochToScaleToSum(erc20B.address, 0, 0)
				assert.isTrue(P_1.lt(toBN(dec(1, 18))))
				assert.isTrue(S_1_ERC1.gt(toBN("0")))
				assert.isTrue(S_1_ERC2.gt(toBN("0")))

				// check Alice's and Dennis' new snapshots are correct
				const alice_Snapshot_1 = await stabilityPool.depositSnapshots(alice)
				const alice_Snapshot_S_1 = await stabilityPool.S(alice, erc20.address)
				const alice_Snapshot_P_1 = alice_Snapshot_1["P"]
				assert.isTrue(alice_Snapshot_S_1.eq(S_1_ERC1))
				assert.isTrue(alice_Snapshot_P_1.eq(P_1))

				const dennis_Snapshot_1 = await stabilityPool.depositSnapshots(dennis)
				const dennis_Snapshot_S_1 = await stabilityPool.S(dennis, erc20B.address)
				const dennis_Snapshot_P_1 = dennis_Snapshot_1["P"]
				assert.isTrue(dennis_Snapshot_S_1.eq(S_1_ERC2))
				assert.isTrue(dennis_Snapshot_P_1.eq(P_1))

				// Bob and Erin open vessels and deposit to StabilityPool
				await _openVessel(erc20, (extraDebtTokenAmt = 1_000), bob)
				await stabilityPool.provideToSP(dec(800, 18), { from: bob })

				await _openVessel(erc20B, (extraDebtTokenAmt = 1_000), erin)
				await stabilityPool.provideToSP(dec(800, 18), { from: erin })

				// Defaulters 3 and 6 Vessels are closed
				await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })
				await vesselManagerOperations.liquidate(erc20B.address, defaulter_6, { from: owner })

				const P_2 = await stabilityPool.P()
				const S_2_ERC1 = await stabilityPool.epochToScaleToSum(erc20.address, 0, 0)
				const S_2_ERC2 = await stabilityPool.epochToScaleToSum(erc20B.address, 0, 0)

				assert.isTrue(P_2.lt(P_1))
				assert.isTrue(S_2_ERC1.gt(S_1_ERC1))
				assert.isTrue(S_2_ERC2.gt(S_1_ERC2))

				// Alice and Dennis make deposit #3: 100
				await stabilityPool.provideToSP(dec(100, 18), { from: alice })
				await stabilityPool.provideToSP(dec(100, 18), { from: dennis })

				// check their new snapshots are correct
				const alice_Snapshot_2 = await stabilityPool.depositSnapshots(alice)
				const alice_Snapshot_S_2 = await stabilityPool.S(alice, erc20.address)
				const alice_Snapshot_P_2 = alice_Snapshot_2["P"]
				assert.isTrue(alice_Snapshot_S_2.eq(S_2_ERC1))
				assert.isTrue(alice_Snapshot_P_2.eq(P_2))

				const dennis_Snapshot_2 = await stabilityPool.depositSnapshots(dennis)
				const dennis_Snapshot_S_2 = await stabilityPool.S(dennis, erc20B.address)
				const dennis_Snapshot_P_2 = dennis_Snapshot_2["P"]
				assert.isTrue(dennis_Snapshot_S_2.eq(S_2_ERC2))
				assert.isTrue(dennis_Snapshot_P_2.eq(P_2))
			})

			it("provideToSP(): reverts if user tries to provide more than their debt token balance", async () => {
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20, 10_000, bob)

				const aliceBal = await debtToken.balanceOf(alice)
				const bobBal = await debtToken.balanceOf(bob)

				// Alice attempts to deposit 1 wei more than her balance
				const aliceTxPromise = stabilityPool.provideToSP(aliceBal.add(toBN(1)), { from: alice })
				await assertRevert(aliceTxPromise, "revert")

				// Bob attempts to deposit 235534 more than his balance
				const bobTxPromise = stabilityPool.provideToSP(bobBal.add(toBN(dec(235534, 18))), { from: bob })
				await assertRevert(bobTxPromise, "revert")
			})

			it("provideToSP(): reverts if user tries to provide 2^256-1 debt tokens, which exceeds their balance", async () => {
				await _openVessel(erc20, 10_000, alice)
				const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
				// Alice attempts to deposit 2^256-1
				try {
					aliceTx = await stabilityPool.provideToSP(maxBytes32, { from: alice })
					assert.isFalse(aliceTx.receipt.status)
				} catch (error) {
					assert.include(error.message, "revert")
				}
			})

			it("provideToSP(): doesn't impact other users' deposits or collateral gains", async () => {
				await openWhaleVessel(erc20)
				await openWhaleVessel(erc20B)

				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(2_000, 18), { from: bob })
				await stabilityPool.provideToSP(dec(3_000, 18), { from: carol })

				// D opens a vessel
				await _openVessel(erc20, 300, dennis)

				// Would-be defaulters open vessels
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(105, 18))

				// Defaulters are liquidated
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const alice_deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
				const bob_deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const carol_deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(carol)).toString()

				const alice_gain_Before = (await stabilityPool.getDepositorGains(alice))[1].toString()
				const bob_gain_Before = (await stabilityPool.getDepositorGains(bob))[1].toString()
				const carol_gain_Before = (await stabilityPool.getDepositorGains(carol))[1].toString()

				// check non-zero debt token and collateral in the Stability Pool
				const poolDebtBalance = await stabilityPool.getTotalDebtTokenDeposits()
				const poolCollBalance = await stabilityPool.getCollateral(erc20.address)
				assert.isTrue(poolDebtBalance.gt(mv._zeroBN))
				assert.isTrue(poolCollBalance.gt(mv._zeroBN))

				// D makes an SP deposit
				await stabilityPool.provideToSP(dec(1_000, 18), { from: dennis })
				assert.equal((await stabilityPool.getCompoundedDebtTokenDeposits(dennis)).toString(), dec(1000, 18))

				const alice_deposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
				const bob_deposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const carol_deposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(carol)).toString()

				const alice_gain_After = (await stabilityPool.getDepositorGains(alice))[1].toString()
				const bob_gain_After = (await stabilityPool.getDepositorGains(bob))[1].toString()
				const carol_gain_After = (await stabilityPool.getDepositorGains(carol))[1].toString()

				// Check compounded deposits and collateral gains for A, B and C have not changed
				assert.equal(alice_deposit_Before, alice_deposit_After)
				assert.equal(bob_deposit_Before, bob_deposit_After)
				assert.equal(carol_deposit_Before, carol_deposit_After)

				assert.equal(alice_gain_Before, alice_gain_After)
				assert.equal(bob_gain_Before, bob_gain_After)
				assert.equal(carol_gain_Before, carol_gain_After)
			})

			it("provideToSP(): doesn't impact system debt, collateral or TCR", async () => {
				await openWhaleVessel(erc20)

				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(2_000, 18), { from: bob })
				await stabilityPool.provideToSP(dec(3_000, 18), { from: carol })

				// D opens a vessel
				await _openVessel(erc20, 3_000, dennis)

				// Would-be defaulters open vessels
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

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
				await openWhaleVessel(erc20)

				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				// A and B provide to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(2_000, 18), { from: bob })

				// D opens a vessel
				await _openVessel(erc20, 1_000, dennis)

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

				const whale_Coll_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[
					th.VESSEL_COLL_INDEX
				].toString()
				const alice_Coll_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[
					th.VESSEL_COLL_INDEX
				].toString()
				const bob_Coll_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].toString()
				const carol_Coll_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[
					th.VESSEL_COLL_INDEX
				].toString()
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
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				// A, B provide to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(1_000, 18), { from: bob })

				// Confirm Bob has an active vessel in the system
				assert.isTrue(await sortedVessels.contains(erc20.address, bob))
				assert.equal((await vesselManager.getVesselStatus(erc20.address, bob)).toString(), "1")

				// Confirm Bob has a Stability deposit
				assert.equal((await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString(), dec(1_000, 18))

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(105, 18))
				const price = await priceFeed.getPrice(erc20.address)

				// Liquidate bob
				await vesselManagerOperations.liquidate(erc20.address, bob)

				// Check Bob's vessel has been removed from the system
				assert.isFalse(await sortedVessels.contains(erc20.address, bob))
				assert.equal((await vesselManager.getVesselStatus(erc20.address, bob)).toString(), "3")
			})

			it("provideToSP(): providing 0 reverts", async () => {
				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				// A, B, C provide 100, 50, 30 to SP
				await stabilityPool.provideToSP(dec(100, 18), { from: alice })
				await stabilityPool.provideToSP(dec(50, 18), { from: bob })
				await stabilityPool.provideToSP(dec(30, 18), { from: carol })

				const poolBalance = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
				assert.equal(poolBalance, dec(180, 18))

				// Bob attempts to provide 0
				const txPromise_B = stabilityPool.provideToSP(0, { from: bob })
				await th.assertRevert(txPromise_B)
			})

			it("provideToSP(): new deposit = when SP > 0, triggers GRVT reward event - increases the sum G", async () => {
				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				// A provides to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })

				let currentEpoch = await stabilityPool.currentEpoch()
				let currentScale = await stabilityPool.currentScale()
				const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B provides to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: bob })

				currentEpoch = await stabilityPool.currentEpoch()
				currentScale = await stabilityPool.currentScale()
				const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

				// Expect G has increased from the GRVT reward event triggered
				assert.isTrue(G_After.gt(G_Before))
			})

			it("provideToSP(): new deposit when SP is empty, doesn't update G", async () => {
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

				// A provides to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// A withdraws
				await stabilityPool.withdrawFromSP(dec(1_000, 18), { from: alice })

				// Check SP is empty
				assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), "0")

				// Check G is non-zero
				let currentEpoch = await stabilityPool.currentEpoch()
				let currentScale = await stabilityPool.currentScale()
				const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

				assert.isTrue(G_Before.gt(toBN("0")))

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B provides to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: bob })

				currentEpoch = await stabilityPool.currentEpoch()
				currentScale = await stabilityPool.currentScale()
				const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

				// Expect G has not changed
				assert.isTrue(G_After.eq(G_Before))
			})

			it("provideToSP(): new deposit = depositor does not receive any GRVT rewards", async () => {
				// A, B, open vessels
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)

				// Get balances before and confirm they are zero
				const A_GRVTBalance_Before = await grvtToken.balanceOf(alice)
				const B_GRVTBalance_Before = await grvtToken.balanceOf(bob)
				assert.equal(A_GRVTBalance_Before, "0")
				assert.equal(B_GRVTBalance_Before, "0")

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// A, B provide to SP
				await stabilityPool.provideToSP(dec(1_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(2_000, 18), { from: bob })

				// Get GRVT balances after, and confirm they're still zero
				const A_GRVTBalance_After = await grvtToken.balanceOf(alice)
				const B_GRVTBalance_After = await grvtToken.balanceOf(bob)

				assert.equal(A_GRVTBalance_After, "0")
				assert.equal(B_GRVTBalance_After, "0")
			})

			it("provideToSP(): new deposit after past full withdrawal = depositor does not receive any GRVT rewards", async () => {
				await openWhaleVessel(erc20, (icr = 10))

				// A, B, C, open vessels
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)
				await _openVessel(erc20, 4_000, dennis)
				await _openVesselWithICR(erc20, (extraDebtTokenAmt = 0), (icr = 2), defaulter_1)

				const initialDeposit_A = (await debtToken.balanceOf(alice)).div(toBN(2))
				const initialDeposit_B = (await debtToken.balanceOf(bob)).div(toBN(2))
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
				await openWhaleVessel(erc20)

				// Whale transfers debt tokens to A, B
				await debtToken.transfer(alice, dec(200, 18), { from: whale })
				await debtToken.transfer(bob, dec(400, 18), { from: whale })

				// C, D open vessels
				await _openVessel(erc20, 1_000, carol)
				await _openVessel(erc20, 2_000, dennis)

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
				await openWhaleVessel(erc20, (icr = 10))

				// Whale transfers tokens to A, B
				await debtToken.transfer(alice, dec(2000, 18), { from: whale })
				await debtToken.transfer(bob, dec(2000, 18), { from: whale })

				// C, D open vessels
				await _openVessel(erc20, 4_000, carol)
				await _openVessel(erc20, 5_000, dennis)
				await _openVessel(erc20, 0, defaulter_1)

				// A, B, C, D provide to SP
				await stabilityPool.provideToSP(dec(105, 18), { from: alice })
				await stabilityPool.provideToSP(dec(105, 18), { from: bob })
				await stabilityPool.provideToSP(dec(105, 18), { from: carol })
				await stabilityPool.provideToSP(dec(105, 18), { from: dennis })

				// time passes
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B deposits. A,B,C,D earn GRVT
				await stabilityPool.provideToSP(dec(5, 18), { from: bob })

				// Price drops, defaulter is liquidated, A, B, C, D earn collaterals
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
				// A, B, C open vessels
				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)
				await _openVessel(erc20, 3_000, carol)

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
				// A, B, C open vessels
				await _openVessel(erc20, 100, alice)
				await _openVessel(erc20, 200, bob)
				await _openVessel(erc20, 300, carol)

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
				await openWhaleVessel(erc20, (icr = 10))

				await _openVessel(erc20, 1_000, alice)
				await _openVessel(erc20, 2_000, bob)

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
		})

		describe("Withdrawing", async () => {
			it("withdrawFromSP(): reverts when user has no active deposit", async () => {
				await _openVessel(erc20, 100, alice)
				await _openVessel(erc20, 100, bob)

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
				}
			})

			it("withdrawFromSP(): reverts when amount > 0 and system has an undercollateralized vessel", async () => {
				await _openVessel(erc20, 100, alice)
				await stabilityPool.provideToSP(dec(100, 18), { from: alice })

				const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
				assert.equal(alice_initialDeposit, dec(100, 18))

				// defaulter opens vessel
				await _openVessel(erc20, 0, defaulter_1)

				// price drops, defaulter is in liquidation range (but not liquidated yet)
				await priceFeed.setPrice(erc20.address, dec(100, 18))

				await th.assertRevert(stabilityPool.withdrawFromSP(dec(100, 18), { from: alice }))
			})

			it("withdrawFromSP(): partial retrieval - retrieves correct debt token amount and the entire collateral gain, and updates deposit", async () => {
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))
				await stabilityPool.provideToSP(dec(185_000, 18), { from: whale })

				// 2 Vessels opened
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

				// Alice makes deposit #1: 15_000
				await _openVesselWithICR(erc20, 15_000, (icr = 10), alice)
				await stabilityPool.provideToSP(dec(15_000, 18), { from: alice })

				// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
				await priceFeed.setPrice(erc20.address, dec(105, 18))

				// 2 users with Vessel with 170 debt tokens drawn are closed
				const liquidationTX_1 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
					from: owner,
				}) // 170 closed
				const liquidationTX_2 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
					from: owner,
				}) // 170 closed

				const [liquidatedDebt_1] = th.getEmittedLiquidationValues(liquidationTX_1)
				const [liquidatedDebt_2] = th.getEmittedLiquidationValues(liquidationTX_2)

				// Alice debtTokenLoss is ((15_000/20_0000) * liquidatedDebt), for each liquidation
				const expectedLoss_A = liquidatedDebt_1
					.mul(toBN(dec(15_000, 18)))
					.div(toBN(dec(200_000, 18)))
					.add(liquidatedDebt_2.mul(toBN(dec(15_000, 18))).div(toBN(dec(200_000, 18))))

				const expectedCompoundedDeposit_A = toBN(dec(15_000, 18)).sub(expectedLoss_A)
				const compoundedDeposit_A = await stabilityPool.getCompoundedDebtTokenDeposits(alice)

				assert.isAtMost(th.getDifference(expectedCompoundedDeposit_A, compoundedDeposit_A), 100_000)

				// Alice retrieves part of her entitled gains: 9_000 debt tokens
				await stabilityPool.withdrawFromSP(dec(9_000, 18), { from: alice })

				const expectedNewDeposit_A = compoundedDeposit_A.sub(toBN(dec(9_000, 18)))

				// check Alice's deposit has been updated to equal her compounded deposit minus her withdrawal 
				const newDeposit = (await stabilityPool.deposits(alice)).toString()
				assert.isAtMost(th.getDifference(newDeposit, expectedNewDeposit_A), 100_000)

				// Expect Alice has withdrawn all gains
				const alice_pendingAssetGain = (await stabilityPool.getDepositorGains(alice))[1][1]
				assert.equal(alice_pendingAssetGain, 0)
			})

			it("withdrawFromSP(): partial retrieval - leaves the correct amount of debt tokens in the Stability Pool", async () => {
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))
				await stabilityPool.provideToSP(dec(185_000, 18), { from: whale })

				// 2 Vessels opened
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

				// Alice makes deposit #1: 15_000
				await _openVesselWithICR(erc20, 15_000, (icr = 10), alice)
				await stabilityPool.provideToSP(dec(15_000, 18), { from: alice })

				const poolDepositsBefore = await stabilityPool.getTotalDebtTokenDeposits()
				assert.equal(poolDepositsBefore, dec(200_000, 18))

				// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
				await priceFeed.setPrice(erc20.address, dec(105, 18))

				// 2 users liquidated
				const liquidationTx1 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
				const liquidationTx2 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

				const [liquidatedDebt1] = th.getEmittedLiquidationValues(liquidationTx1)
				const [liquidatedDebt2] = th.getEmittedLiquidationValues(liquidationTx2)

				// Alice retrieves part of her entitled debt tokens: 9_000
				await stabilityPool.withdrawFromSP(dec(9_000, 18), { from: alice })

				// Check SP has reduced from 2 liquidations and Alice's withdrawal
	  			// Expected tokens in SP = (200_000 - liquidatedDebt1 - liquidatedDebt2 - 9_000)
				const expectedPoolDeposits = toBN(dec(200_000, 18))
					.sub(toBN(liquidatedDebt1))
					.sub(toBN(liquidatedDebt2))
					.sub(toBN(dec(9_000, 18)))

				const poolDepositsAfter = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
				th.assertIsApproximatelyEqual(poolDepositsAfter, expectedPoolDeposits)
			})

			it("withdrawFromSP(): full retrieval - leaves the correct amount of debt tokens in the Stability Pool", async () => {
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))
				await stabilityPool.provideToSP(dec(185_000, 18), { from: whale })

				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

				// --- TEST ---

				// Alice makes deposit #1
				await _openVesselWithICR(erc20, 15_000, (icr = 10), alice)
				await stabilityPool.provideToSP(dec(15_000, 18), { from: alice })

				const poolDepositsBefore = await stabilityPool.getTotalDebtTokenDeposits()
				assert.equal(poolDepositsBefore, dec(200_000, 18))

				// price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
				await priceFeed.setPrice(erc20.address, dec(105, 18))

				// 2 defaulters liquidated
				const liquidationTx1 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
				const liquidationTx2 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

				const [liquidatedDebt1] = th.getEmittedLiquidationValues(liquidationTx1)
				const [liquidatedDebt2] = th.getEmittedLiquidationValues(liquidationTx2)

				// Alice loss is ((15_000/200_000) * liquidatedDebt), for each liquidation
				const expectedLoss = liquidatedDebt1
					.mul(toBN(dec(15_000, 18)))
					.div(toBN(dec(200_000, 18)))
					.add(liquidatedDebt2.mul(toBN(dec(15_000, 18))).div(toBN(dec(200_000, 18))))

				const expectedCompoundedDeposit = toBN(dec(15_000, 18)).sub(expectedLoss)
				const compoundedDeposit = await stabilityPool.getCompoundedDebtTokenDeposits(alice)

				assert.isAtMost(th.getDifference(expectedCompoundedDeposit, compoundedDeposit), 100_000)

				const poolDeposits = await stabilityPool.getTotalDebtTokenDeposits()

				// Alice retrieves all of her entitled tokens
				await stabilityPool.withdrawFromSP(dec(15_000, 18), { from: alice })

				const expectedPoolDeposits = poolDeposits.sub(compoundedDeposit)
				const poolDepositsAfter = await stabilityPool.getTotalDebtTokenDeposits()
				assert.isAtMost(th.getDifference(expectedPoolDeposits, poolDepositsAfter), 100_000)
			})

			it("withdrawFromSP(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero collateral", async () => {
				// --- SETUP ---
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))
				await stabilityPool.provideToSP(dec(18_500, 18), { from: whale })

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
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))
				await stabilityPool.provideToSP(dec(185_000, 18), { from: whale })

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
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))
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
				await openWhaleVessel(erc20, (icr = 10))

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
				await openWhaleVessel(erc20, (icr = 10))

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

			it("withdrawFromSP(): doesn't impact other users Stability deposits or collateral gains", async () => {
				await openWhaleVessel(erc20, (icr = 10))

				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20, 20_000, bob)
				await _openVessel(erc20, 30_000, carol)

				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(20_000, 18), { from: bob })
				await stabilityPool.provideToSP(dec(30_000, 18), { from: carol })

				// Would-be defaulters open vessels
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(105, 18))

				// Defaulters are liquidated
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				const alice_Deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
				const bob_Deposit_Before = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

				const alice_Gain_Before = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
				const bob_Gain_Before = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				// Check non-zero balance and AssetGain in the Stability Pool
				const debtInPool = await stabilityPool.getTotalDebtTokenDeposits()
				const collInPool = await stabilityPool.getCollateral(erc20.address)
				assert.isTrue(debtInPool.gt(mv._zeroBN))
				assert.isTrue(collInPool.gt(mv._zeroBN))

				// Price rises
				await priceFeed.setPrice(erc20.address, dec(200, 18))

				// Carol withdraws her Stability deposit
				assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30_000, 18))
				await stabilityPool.withdrawFromSP(dec(30_000, 18), { from: carol })
				assert.equal((await stabilityPool.deposits(carol)).toString(), "0")

				const alice_Deposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
				const bob_Deposit_After = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()
				const alice_Gain_After = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
				const bob_Gain_After = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				// Check compounded deposits and Collateral gains for A and B have not changed
				assert.equal(alice_Deposit_Before, alice_Deposit_After)
				assert.equal(bob_Deposit_Before, bob_Deposit_After)
				assert.equal(alice_Gain_Before, alice_Gain_After)
				assert.equal(bob_Gain_Before, bob_Gain_After)
			})

			it("withdrawFromSP(): doesn't impact system debt, collateral or TCR ", async () => {
				await openWhaleVessel(erc20, (icr = 10))

				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20, 20_000, bob)
				await _openVessel(erc20, 30_000, carol)

				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(20_000, 18), { from: bob })
				await stabilityPool.provideToSP(dec(30_000, 18), { from: carol })

				// Would-be defaulters open vessels
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

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
				await openWhaleVessel(erc20, (icr = 10))

				// A, B, C open vessels and make Stability Pool deposits
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20, 20_000, bob)
				await _openVessel(erc20, 30_000, carol)

				// A, B and C provide to SP
				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(20_000, 18), { from: bob })
				await stabilityPool.provideToSP(dec(30_000, 18), { from: carol })

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

				// Price rises
				await priceFeed.setPrice(erc20.address, dec(200, 18))

				// Carol withdraws her Stability deposit
				assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
				await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
				assert.equal((await stabilityPool.deposits(carol)).toString(), "0")

				const whale_Debt_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[0].toString()
				const alice_Debt_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[0].toString()
				const bob_Debt_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[0].toString()
				const carol_Debt_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[0].toString()

				const whale_Coll_AfterERC20 = (await vesselManager.Vessels(whale, erc20.address))[
					th.VESSEL_COLL_INDEX
				].toString()
				const alice_Coll_AfterERC20 = (await vesselManager.Vessels(alice, erc20.address))[
					th.VESSEL_COLL_INDEX
				].toString()
				const bob_Coll_AfterERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX].toString()
				const carol_Coll_AfterERC20 = (await vesselManager.Vessels(carol, erc20.address))[
					th.VESSEL_COLL_INDEX
				].toString()

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
				await _openVessel(erc20, 100, alice)
				await stabilityPool.provideToSP(dec(100, 18), { from: alice })

				const A_initialDeposit = (await stabilityPool.deposits(alice)).toString()
				assert.equal(A_initialDeposit, dec(100, 18))

				// defaulters open vessels
				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)

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
				await openWhaleVessel(erc20, (icr = 10))

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
				await openWhaleVessel(erc20, (icr = 10))

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
				await openWhaleVessel(erc20, (icr = 10))

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
				await openWhaleVessel(erc20, (icr = 10))

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
				// Price doubles
				await priceFeed.setPrice(erc20.address, dec(400, 18))
				await openWhaleVessel(erc20, (icr = 2), (extraDebtTokenAmt = 1_000_000))

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
					await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
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

			it("withdrawFromSP(): triggers GRVT reward event - increases the sum G", async () => {
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))

				// A, B, C open vessels
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20B, 20_000, bob)
				await _openVessel(erc20, 20_000, carol)

				// A and B provide to SP
				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(10_000, 18), { from: bob })

				const G_Before = await stabilityPool.epochToScaleToG(0, 0)

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// A withdraws from SP
				await stabilityPool.withdrawFromSP(dec(5_000, 18), { from: alice })
				const G_1 = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has increased from the GRVT reward event triggered
				assert.isTrue(G_1.gt(G_Before))

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// B withdraws from SP
				await stabilityPool.withdrawFromSP(dec(5_000, 18), { from: bob })
				const G_2 = await stabilityPool.epochToScaleToG(0, 0)

				// Expect G has increased from the GRVT reward event triggered
				assert.isTrue(G_2.gt(G_1))
			})

			it("withdrawFromSP(): partial withdrawal = depositor receives GRVT rewards", async () => {
				await openWhaleVessel(erc20)

				// A, B, C, D open vessels
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20, 20_000, bob)
				await _openVessel(erc20B, 1_000, carol)
				await _openVessel(erc20B, 500, dennis)

				// A, B, C, D provide to SP
				await stabilityPool.provideToSP(dec(10, 18), { from: alice })
				await stabilityPool.provideToSP(dec(20, 18), { from: bob })
				await stabilityPool.provideToSP(dec(30, 18), { from: carol })
				await stabilityPool.provideToSP(dec(40, 18), { from: dennis })

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

				// Get A, B, C GRVT balance before
				const A_GRVTBalance_Before = await grvtToken.balanceOf(alice)
				const B_GRVTBalance_Before = await grvtToken.balanceOf(bob)
				const C_GRVTBalance_Before = await grvtToken.balanceOf(carol)
				const D_GRVTBalance_Before = await grvtToken.balanceOf(dennis)

				// A, B, C withdraw
				await stabilityPool.withdrawFromSP(dec(1, 18), { from: alice })
				await stabilityPool.withdrawFromSP(dec(2, 18), { from: bob })
				await stabilityPool.withdrawFromSP(dec(3, 18), { from: carol })
				await stabilityPool.withdrawFromSP(dec(4, 18), { from: dennis })

				// Get GRVT balance after
				const A_GRVTBalance_After = await grvtToken.balanceOf(alice)
				const B_GRVTBalance_After = await grvtToken.balanceOf(bob)
				const C_GRVTBalance_After = await grvtToken.balanceOf(carol)
				const D_GRVTBalance_After = await grvtToken.balanceOf(dennis)

				// Check GRVT Balance of A, B, C has increased
				assert.isTrue(A_GRVTBalance_After.gt(A_GRVTBalance_Before))
				assert.isTrue(B_GRVTBalance_After.gt(B_GRVTBalance_Before))
				assert.isTrue(C_GRVTBalance_After.gt(C_GRVTBalance_Before))
				assert.isTrue(D_GRVTBalance_After.gt(D_GRVTBalance_Before))
			})

			it("withdrawFromSP(): full withdrawal = zero's depositor's snapshots", async () => {
				await openWhaleVessel(erc20)
				await openWhaleVessel(erc20B)

				await _openVessel(erc20, 0, defaulter_1)
				await _openVessel(erc20B, 0, defaulter_2)

				//  SETUP: Execute a series of operations to make G, S > 0 and P < 1

				// Graham opens vessels and make deposits
				await _openVesselWithICR(erc20, 20_000, (icr = 10), graham)
				await _openVesselWithICR(erc20B, 20_000, (icr = 10), graham)
				await stabilityPool.provideToSP(dec(10_000, 18), { from: graham })

				// Fast-forward time and make a second deposit, to trigger GRVT reward and make G > 0
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
				await stabilityPool.provideToSP(dec(10_000, 18), { from: graham })

				// perform a liquidation to make 0 < P < 1, and S > 0
				await dropPriceByPercent(erc20, 50)
				await dropPriceByPercent(erc20B, 50)

				assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))
				assert.isFalse(await th.checkRecoveryMode(contracts, erc20B.address))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				await vesselManagerOperations.liquidate(erc20B.address, defaulter_2)

				const currentEpoch = await stabilityPool.currentEpoch()
				const currentScale = await stabilityPool.currentScale()

				const S_Before_erc20A = await stabilityPool.epochToScaleToSum(erc20.address, currentEpoch, currentScale)
				const S_Before_erc20B = await stabilityPool.epochToScaleToSum(erc20B.address, currentEpoch, currentScale)
				const P_Before = await stabilityPool.P()
				const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

				// Confirm 0 < P < 1
				assert.isTrue(P_Before.gt(toBN("0")) && P_Before.lt(toBN(dec(1, 18))))
				// Confirm S, G are both > 0
				assert.isTrue(S_Before_erc20A.gt(toBN("0")))
				assert.isTrue(S_Before_erc20B.gt(toBN("0")))
				assert.isTrue(G_Before.gt(toBN("0")))

				// --- TEST ---

				// Whale transfers to A, B
				await debtToken.transfer(alice, dec(20_000, 18), { from: whale })
				await debtToken.transfer(bob, dec(40_000, 18), { from: whale })

				await priceFeed.setPrice(erc20.address, dec(200, 18))
				await priceFeed.setPrice(erc20B.address, dec(200, 18))

				// C, D, E open vessels
				await _openVesselWithICR(erc20, 30_000, (icr = 10), carol)
				await _openVesselWithICR(erc20, 40_000, (icr = 10), dennis)
				await _openVesselWithICR(erc20B, 30_000, (icr = 10), erin)

				// A, B, C, D make their initial deposits
				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(20_000, 18), { from: bob })
				await stabilityPool.provideToSP(dec(30_000, 18), { from: carol })
				await stabilityPool.provideToSP(dec(40_000, 18), { from: dennis })
				await stabilityPool.provideToSP(dec(30_000, 18), { from: erin })

				const ZERO = toBN("0")
				// Check ERC20 "a" deposits snapshots are non-zero
				for (depositor of [alice, bob, carol, dennis]) {
					const S = await stabilityPool.S(depositor, erc20.address)
					assert.isTrue(S.eq(S_Before_erc20A))
					// Check S,P, G snapshots are non-zero
					const snapshot = await stabilityPool.depositSnapshots(depositor)
					assert.isTrue(snapshot["P"].eq(P_Before))
					assert.isTrue(snapshot["G"].gt(ZERO)) // G increases a bit between each depositor op, so just check it is non-zero
					assert.equal(snapshot["scale"], "0")
					assert.equal(snapshot["epoch"], "0")
				}
				// Check ERC20 "b" deposits snapshots are non-zero
				for (depositor of [erin]) {
					const S = await stabilityPool.S(depositor, erc20B.address)
					assert.isTrue(S.eq(S_Before_erc20B))
					// Check S,P, G snapshots are non-zero
					const snapshot = await stabilityPool.depositSnapshots(depositor)
					assert.isTrue(snapshot["P"].eq(P_Before))
					assert.isTrue(snapshot["G"].gt(ZERO)) // G increases a bit between each depositor op, so just check it is non-zero
					assert.equal(snapshot["scale"], "0")
					assert.equal(snapshot["epoch"], "0")
				}

				// All depositors make full withdrawal
				await stabilityPool.withdrawFromSP(dec(10_000, 18), { from: alice })
				await stabilityPool.withdrawFromSP(dec(20_000, 18), { from: bob })
				await stabilityPool.withdrawFromSP(dec(30_000, 18), { from: carol })
				await stabilityPool.withdrawFromSP(dec(40_000, 18), { from: dennis })
				await stabilityPool.withdrawFromSP(dec(30_000, 18), { from: erin })

				async function checkSnapshotIsZeroed(depositor, erc20Address) {
					const S = await stabilityPool.S(depositor, erc20Address)
					assert.equal(S, "0")
					const snapshot = await stabilityPool.depositSnapshots(depositor)
					assert.equal(snapshot["P"], "0") // P
					assert.equal(snapshot["G"], "0") // G increases a bit between each depositor op, so just check it is non-zero
					assert.equal(snapshot["scale"], "0") // scale
					assert.equal(snapshot["epoch"], "0") // epoch
				}

				// Check all depositors' snapshots have been zero'd
				for (depositor of [alice, bob, carol, dennis]) {
					await checkSnapshotIsZeroed(depositor, erc20.address)
				}
				for (depositor of [erin]) {
					await checkSnapshotIsZeroed(depositor, erc20B.address)
				}
			})

			it("withdrawFromSP(): reverts when initial deposit value is 0", async () => {
				await openWhaleVessel(erc20, (icr = 10))

				// Alice opens vessel and joins the Stability Pool
				await _openVessel(erc20, 10_100, alice)
				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })

				await _openVessel(erc20, 0, defaulter_1)

				//  SETUP: Execute a series of operations to trigger GRVT and collateral rewards for depositor A

				// Fast-forward time and make a second deposit, to trigger GRVT reward and make G > 0
				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
				await stabilityPool.provideToSP(dec(100, 18), { from: alice })

				// perform a liquidation to make 0 < P < 1, and S > 0
				await priceFeed.setPrice(erc20.address, dec(105, 18))
				assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				await priceFeed.setPrice(erc20.address, dec(200, 18))

				// Alice successfully withdraws deposit and all gains
				await stabilityPool.withdrawFromSP(dec(10_100, 18), { from: alice })
				assert.equal(await stabilityPool.deposits(alice), "0")

				const expectedRevertMessage = "StabilityPool: User must have a non-zero deposit"

				// Further withdrawal attempt from Alice
				await th.assertRevert(stabilityPool.withdrawFromSP(dec(10_000, 18), { from: alice }), expectedRevertMessage)

				// Withdrawal attempt of a non-existent deposit, from Carol
				await th.assertRevert(stabilityPool.withdrawFromSP(dec(10_000, 18), { from: carol }), expectedRevertMessage)
			})
		})

		describe("Depositor Gains", async () => {
			it("getDepositorGains(): depositor does not earn further collateral gains from liquidations while their compounded deposit == 0: ", async () => {
				await openWhaleVessel(erc20, (icr = 10), (extraDebtTokenAmt = 1_000_000))

				// A, B, C open vessels
				await _openVessel(erc20, 10_000, alice)
				await _openVessel(erc20, 20_000, bob)
				await _openVessel(erc20, 30_000, carol)

				// defaulters open vessels
				await _openVessel(erc20, 15_000, defaulter_1)
				await _openVessel(erc20, 0, defaulter_2)
				await _openVessel(erc20, 0, defaulter_3)

				// A, B, provide 10_000, 5_000 tokens to SP
				await stabilityPool.provideToSP(dec(10_000, 18), { from: alice })
				await stabilityPool.provideToSP(dec(5_000, 18), { from: bob })

				// Price drops
				await priceFeed.setPrice(erc20.address, dec(105, 18))

				// Liquidate defaulter 1. Empties the Pool
				await vesselManagerOperations.liquidate(erc20.address, defaulter_1)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

				const poolBalance = (await stabilityPool.getTotalDebtTokenDeposits()).toString()
				assert.equal(poolBalance, "0")

				// Check Stability deposits have been fully cancelled with debt, and are now all zero
				const alice_Deposit = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
				const bob_Deposit = (await stabilityPool.getCompoundedDebtTokenDeposits(bob)).toString()

				assert.equal(alice_Deposit, "0")
				assert.equal(bob_Deposit, "0")

				// Get collateral gain for A and B
				const alice_Gain_1 = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
				const bob_Gain_1 = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				// Whale deposits 10_000 tokens to Stability Pool
				await stabilityPool.provideToSP(dec(1, 24), { from: whale })

				// Liquidation 2
				await vesselManagerOperations.liquidate(erc20.address, defaulter_2)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_2))

				// Check Alice and Bob have not received collateral gains from liquidation 2 while their deposit was 0
				const alice_Gain_2 = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
				const bob_Gain_2 = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				assert.equal(alice_Gain_1, alice_Gain_2)
				assert.equal(bob_Gain_1, bob_Gain_2)

				// Liquidation 3
				await vesselManagerOperations.liquidate(erc20.address, defaulter_3)
				assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_3))

				// Check Alice and Bob have not received collateral gains from liquidation 3 while their deposit was 0
				const alice_Gain_3 = (await stabilityPool.getDepositorGains(alice))[1][1].toString()
				const bob_Gain_3 = (await stabilityPool.getDepositorGains(bob))[1][1].toString()

				assert.equal(alice_Gain_1, alice_Gain_3)
				assert.equal(bob_Gain_1, bob_Gain_3)
			})
		})
	})
})

contract("Reset chain state", async accounts => {})

