const {
	time,
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")

const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN } = th
const { assert } = require("hardhat")

const ERROR_MARGIN = 1e9
const MAX_FEE_FRACTION = toBN(1e18).div(toBN(1000)).mul(toBN(5)) // 0.5%

contract("FeeCollector", async accounts => {
	const openVessel = async params => th.openVessel(contracts, params)
	const withdrawVUSD = async params => th.withdrawVUSD(contracts, params)

	const [treasury, alice, bob, whale] = accounts

	let contracts

	let asset
	let borrowerOperations
	let debtToken
	let erc20
	let feeCollector
	let priceFeed
	let sortedVessels
	let vesselManager
	let vesselManagerOperations
	let MIN_FEE_DAYS
	let MIN_FEE_SECONDS
	let MIN_FEE_FRACTION
	let FEE_EXPIRATION_SECONDS

	const calcFees = debtAmount => {
		const maxFee = MAX_FEE_FRACTION.mul(debtAmount).div(toBN(1e18))
		const minFee = MIN_FEE_FRACTION.mul(maxFee).div(toBN(1e18))
		return { minFee, maxFee }
	}

	const openOrAjustVessel = async (borrower, asset, debtAmount) => {
		const borrowerOperationsAddress = borrowerOperations.address
		// mimic borrowerOperations._triggerBorrowingFee()
		const { maxFee } = calcFees(debtAmount)
		await impersonateAccount(borrowerOperationsAddress)
		await debtToken.unprotectedMint(feeCollector.address, maxFee, { from: borrowerOperationsAddress })
		const tx = await feeCollector.increaseDebt(borrower, asset, maxFee, { from: borrowerOperationsAddress })
		await stopImpersonatingAccount(borrowerOperationsAddress)
		return tx
	}

	const payVesselDebt = async (borrower, asset, debtPaymentPercent) => {
		const borrowerOperationsAddress = borrowerOperations.address
		await impersonateAccount(borrowerOperationsAddress)
		const tx = await feeCollector.decreaseDebt(borrower, asset, debtPaymentPercent, { from: borrowerOperationsAddress })
		await stopImpersonatingAccount(borrowerOperationsAddress)
		return tx
	}

	const closeVessel = async (borrower, asset) => {
		const borrowerOperationsAddress = borrowerOperations.address
		await impersonateAccount(borrowerOperationsAddress)
		const tx = await feeCollector.decreaseDebt(borrower, asset, toBN(1e18), { from: borrowerOperationsAddress })
		await stopImpersonatingAccount(borrowerOperationsAddress)
		return tx
	}

	describe("Fee Collector", async () => {
		beforeEach(async () => {
			const { coreContracts } = await deploymentHelper.deployTestContracts(treasury, accounts.slice(0, 20))
			contracts = coreContracts
			debtToken = coreContracts.debtToken
			borrowerOperations = coreContracts.borrowerOperations
			feeCollector = coreContracts.feeCollector
			erc20 = coreContracts.erc20
			asset = erc20.address
			priceFeed = coreContracts.priceFeedTestnet
			sortedVessels = coreContracts.sortedVessels
			vesselManager = coreContracts.vesselManager
			vesselManagerOperations = coreContracts.vesselManagerOperations

			// give some gas to the contracts that will be impersonated
			setBalance(borrowerOperations.address, 1e18)
			setBalance(vesselManager.address, 1e18)

			MIN_FEE_DAYS = toBN(String(await feeCollector.MIN_FEE_DAYS()))
			MIN_FEE_SECONDS = toBN(MIN_FEE_DAYS * 24 * 60 * 60)
			MIN_FEE_FRACTION = toBN(String(await feeCollector.MIN_FEE_FRACTION()))
			FEE_EXPIRATION_SECONDS = toBN(String(await feeCollector.FEE_EXPIRATION_SECONDS()))
		})

		describe("Fee yielding & refund generation", async () => {
			it("Simulate refunds", async () => {
				const borrowAmount = toBN(dec(500_000, 18))
				await openOrAjustVessel(alice, asset, borrowAmount)
				const { minFee, maxFee } = calcFees(borrowAmount)
				// simulate 100% payback refund
				let avaiableRefund = await feeCollector.simulateRefund(alice, asset, (1e18).toString())
				assert.equal(maxFee.sub(minFee).toString(), avaiableRefund.toString())
				// simulate 50% payback refund
				avaiableRefund = await feeCollector.simulateRefund(alice, asset, toBN((1e18).toString()).div(toBN(2)))
				assert.equal(maxFee.sub(minFee).div(toBN(2)).toString(), avaiableRefund.toString())
			})

			it("1 loan, 1 expired payback = should yield maximum fee (and generate no refunds)", async () => {
				const borrowAmount = toBN(dec(1_000_000, 18))
				const { minFee, maxFee } = calcFees(borrowAmount)
				// upon vessel creation, platform should collect minimum fee
				const borrowTx = await openOrAjustVessel(alice, asset, borrowAmount)
				const { collector: collector1, amount: collectedFee1 } = th.getAllEventsByName(borrowTx, "FeeCollected")[0].args
				assert.equal(collector1, treasury)
				assert.equal(collectedFee1.toString(), minFee.toString())
				// move forward in time until loan is expired (200 days)
				time.increase(200 * 24 * 60 * 60)
				// expired paybacks should generate no refunds
				const paybackTx = await closeVessel(alice, asset)
				const feeRefundedEvents = th.getAllEventsByName(paybackTx, "FeeRefunded")
				assert.equal(feeRefundedEvents.length, 0)
				const { collector: collector2, amount: collectedFee2 } = th.getAllEventsByName(paybackTx, "FeeCollected")[0]
					.args
				const expectedCollectedFee = maxFee.sub(minFee)
				assert.equal(collector2, treasury)
				assert.equal(collectedFee2.toString(), expectedCollectedFee.toString())
				// check final balances
				const aliceBalance = await debtToken.balanceOf(alice)
				const treasuryBalance = await debtToken.balanceOf(treasury)
				assert.equal(aliceBalance.toString(), "0")
				assert.equal(treasuryBalance.toString(), maxFee.toString())
			})

			it("1 loan, 1 full payback *before* MIN_FEE_DAYS = should generate max refund", async () => {
				const borrowAmount = toBN(dec(1_000_000, 18))
				const { minFee, maxFee } = calcFees(borrowAmount)
				// upon vessel creation, platform should collect minimum fee
				const borrowTx = await openOrAjustVessel(alice, asset, borrowAmount)
				const { collector: collector1, amount: collectedFee1 } = th.getAllEventsByName(borrowTx, "FeeCollected")[0].args
				assert.equal(collector1, treasury)
				assert.equal(collectedFee1.toString(), minFee.toString())
				// move forward in time by 5 days
				const timeIncrease = 5 * 24 * 60 * 60
				await time.increase(timeIncrease)
				// payback should refund remaining fee to borrower
				const expectedRefund = maxFee.sub(collectedFee1)
				const paybackTx = await closeVessel(alice, asset, toBN(1e18)) // 1e18 = 100% payback
				const feeCollectedEvents = th.getAllEventsByName(paybackTx, "FeeCollected")
				assert.equal(feeCollectedEvents.length, 0)
				const { borrower, amount: refundedAmount } = th.getAllEventsByName(paybackTx, "FeeRefunded")[0].args
				assert.equal(borrower, alice)
				assert.equal(refundedAmount.toString(), expectedRefund.toString())
				// check final balances
				const aliceBalance = await debtToken.balanceOf(alice)
				const treasuryBalance = await debtToken.balanceOf(treasury)
				assert.equal(aliceBalance.toString(), refundedAmount.toString())
				assert.equal(treasuryBalance.toString(), collectedFee1.toString())
			})

			it("1 loan, 1 full payback *after* MIN_FEE_DAYS = should yield fee and generate refund", async () => {
				const borrowAmount = toBN(dec(1_000_000, 18))
				const { minFee, maxFee } = calcFees(borrowAmount)
				// upon vessel creation, platform should collect minimum fee
				const borrowTx = await openOrAjustVessel(alice, asset, borrowAmount)
				const loanTimestamp = await time.latest()
				const { collector: collector1, amount: collectedFee1 } = th.getAllEventsByName(borrowTx, "FeeCollected")[0].args
				assert.equal(collector1, treasury)
				assert.equal(collectedFee1.toString(), minFee.toString())
				// move forward in time by 12 days
				const timeIncrease = loanTimestamp + 12 * 24 * 60 * 60
				await time.increaseTo(timeIncrease)
				// payback should refund remaining fee to borrower
				const feeBalance = maxFee.sub(minFee)
				const from = loanTimestamp + MIN_FEE_DAYS * 24 * 60 * 60
				const to = Number(from) + Number(FEE_EXPIRATION_SECONDS)
				const paybackTx = await closeVessel(alice, asset)
				const now = await time.latest()
				const expectedCollectedFee = calcExpiredAmount(from, to, feeBalance, now)
				const expectedRefund = feeBalance.sub(expectedCollectedFee)
				const { amount: collectedFee2 } = th.getAllEventsByName(paybackTx, "FeeCollected")[0].args
				const { borrower, amount: refundedAmount } = th.getAllEventsByName(paybackTx, "FeeRefunded")[0].args
				assert.equal(borrower, alice)
				th.assertIsApproximatelyEqual(refundedAmount, expectedRefund, ERROR_MARGIN)
				th.assertIsApproximatelyEqual(collectedFee2, expectedCollectedFee, ERROR_MARGIN)
				// check final balances
				const aliceBalance = await debtToken.balanceOf(alice)
				const treasuryBalance = await debtToken.balanceOf(treasury)
				assert.equal(aliceBalance.toString(), refundedAmount.toString())
				assert.equal(treasuryBalance.toString(), collectedFee1.add(collectedFee2).toString())
			})

			it("1 loan, 2 paybacks = should yield proportional fees and refunds", async () => {
				const borrowAmount = toBN(dec(1_000_000, 18))
				const { minFee, maxFee } = calcFees(borrowAmount)
				// upon vessel creation, platform should collect minimum fee
				await openOrAjustVessel(alice, asset, borrowAmount)
				const t0 = await time.latest()
				const feeBalance1 = maxFee.sub(minFee)
				// move forward in time to ~33% of lifetime
				const timeIncrease = Math.floor(Number(FEE_EXPIRATION_SECONDS) / 3)
				const t1 = t0 + Number(MIN_FEE_SECONDS) + timeIncrease
				await time.increaseTo(t1)
				// first half of payback
				const decayRate1 = feeBalance1.div(FEE_EXPIRATION_SECONDS)
				const expectedCollectedFee1 = decayRate1.mul(toBN(timeIncrease + 1)) // there's a one-second timestamp increase after openOrAjustVessel()
				const expectedRefund1 = feeBalance1.sub(expectedCollectedFee1).div(toBN(2)) // 50% payback, 50% refund expected
				// validate refund/collect state
				const paybackFraction1 = toBN(0.5 * 10 ** 18) // 50% of debt
				const paybackTx1 = await payVesselDebt(alice, asset, paybackFraction1) // 50%
				const { amount: collectedAmount1 } = th.getAllEventsByName(paybackTx1, "FeeCollected")[0].args
				const { amount: refundedAmount1 } = th.getAllEventsByName(paybackTx1, "FeeRefunded")[0].args
				th.assertIsApproximatelyEqual(refundedAmount1, expectedRefund1, ERROR_MARGIN)
				th.assertIsApproximatelyEqual(expectedCollectedFee1, collectedAmount1, ERROR_MARGIN)
				// prepare second half of payback
				const { from: from2, to: to2 } = th.getAllEventsByName(paybackTx1, "FeeRecordUpdated")[0].args
				const newDuration2 = to2.sub(from2)
				const feeBalance2 = feeBalance1.sub(collectedAmount1).sub(refundedAmount1)
				const decayRate2 = feeBalance2.div(newDuration2)
				// move forward in time to 66% of lifetime
				await time.increaseTo(t1 + timeIncrease)
				const expectedCollectedFee2 = decayRate2.mul(toBN(timeIncrease))
				const expectedRefund2 = feeBalance2.sub(expectedCollectedFee2)
				const paybackFraction2 = toBN(1 * 10 ** 18) // 100% of debt left
				const paybackTx2 = await payVesselDebt(alice, asset, paybackFraction2)
				const { amount: collectedAmount2 } = th.getAllEventsByName(paybackTx2, "FeeCollected")[0].args
				const { amount: refundedAmount2 } = th.getAllEventsByName(paybackTx2, "FeeRefunded")[0].args
				th.assertIsApproximatelyEqual(refundedAmount2, expectedRefund2, ERROR_MARGIN)
				th.assertIsApproximatelyEqual(expectedCollectedFee2, collectedAmount2, ERROR_MARGIN)
				// check final balances
				const aliceBalance = await debtToken.balanceOf(alice)
				const expectedAliceBalance = refundedAmount1.add(refundedAmount2)
				const treasuryBalance = await debtToken.balanceOf(treasury)
				const expectedTreasuryBalance = minFee.add(collectedAmount1).add(collectedAmount2)
				assert.equal(aliceBalance.toString(), expectedAliceBalance.toString())
				assert.equal(treasuryBalance.toString(), expectedTreasuryBalance.toString())
			})

			it.skip("2 loans, 1 full payback = should yield partial fee and generate partial refund", async () => {
				const t0 = await time.latest()
				// first loan
				const borrowAmount1 = toBN(dec(1_000_000, 18))
				const { minFee: minFee1, maxFee: maxFee1 } = calcFees(borrowAmount1)
				const tx1 = await openOrAjustVessel(alice, asset, borrowAmount1)
				const tx1Time = await time.latest()
				const { amount: collectedAmount1 } = th.getAllEventsByName(tx1, "FeeCollected")[0].args
				assert.equal(minFee1.toString(), collectedAmount1.toString())
				const { from: from1, to: to1, amount: amount1 } = th.getAllEventsByName(tx1, "FeeRecordUpdated")[0].args
				assert.equal(from1.toString(), toBN(tx1Time).add(MIN_FEE_SECONDS).toString())
				assert.equal(to1.toString(), FEE_EXPIRATION_SECONDS.add(toBN(tx1Time)).add(MIN_FEE_SECONDS).toString())
				assert.equal(amount1.toString(), maxFee1.sub(minFee1).toString())
				// move forward in time to half life of first loan, take a second loan
				const t1 = t0 + Number(MIN_FEE_SECONDS) + Math.floor(Number(FEE_EXPIRATION_SECONDS) / 2)
				await time.increaseTo(t1)
				const borrowAmount2 = toBN(dec(500_000, 18))
				const tx2 = await openOrAjustVessel(alice, asset, borrowAmount2)
				const tx2Time = await time.latest()
				const { amount: collectedAmount2 } = th.getAllEventsByName(tx2, "FeeCollected")[0].args
				const { from: from2, to: to2, amount: amount2 } = th.getAllEventsByName(tx2, "FeeRecordUpdated")[0].args
				const { minFee: minFee2, maxFee: maxFee2 } = calcFees(borrowAmount2)
				const addedAmount = maxFee2.sub(minFee2)
				const amountAfterCollectionBeforeNewDebt = amount1.div(toBN(2))
				const expectedNewAmount = amountAfterCollectionBeforeNewDebt.add(addedAmount)
				const expectedNewDuration = calcNewDuration(
					amountAfterCollectionBeforeNewDebt,
					Number(to1) - Number(t1),
					addedAmount,
					FEE_EXPIRATION_SECONDS
				)
				const expectedTo2 = expectedNewDuration.add(toBN(t1.toString()))
				assert.equal(from2.toString(), toBN(tx2Time).toString())
				th.assertIsApproximatelyEqual(to2.toString(), expectedTo2.toString(), 1)
				th.assertIsApproximatelyEqual(amount2.toString(), expectedNewAmount.toString(), ERROR_MARGIN)
				// move forward to 75% of time left on refund
				const newTimeToLive = Number(to2.sub(from2))
				const t2 = Math.floor(Number(from2) + (newTimeToLive / 4) * 3)
				await time.increaseTo(t2)
				// payback in full
				const tx3 = await closeVessel(alice, asset)
				const { amount: collectedAmount3 } = th.getAllEventsByName(tx3, "FeeCollected")[0].args
				const { amount: refundedAmount } = th.getAllEventsByName(tx3, "FeeRefunded")[0].args
				const totalFeeGenerated = maxFee1.add(maxFee2)
				const totalFeeCollected = collectedAmount1.add(collectedAmount2).add(collectedAmount3)
				// all fees collected and refunded should add to max fee generated
				assert.equal(totalFeeGenerated.toString(), totalFeeCollected.add(refundedAmount).toString())
				// check final balances
				const aliceBalance = await debtToken.balanceOf(alice)
				const treasuryBalance = await debtToken.balanceOf(treasury)
				assert.equal(aliceBalance.toString(), refundedAmount.toString())
				assert.equal(treasuryBalance.toString(), totalFeeCollected.toString())
			})

			it("1 big loan, then one $1 new loan every week = should have little effect on final date", async () => {
				const t0 = await time.latest()
				await openOrAjustVessel(alice, asset, toBN(dec(1_000_000, 18)))
				const expectedInitialTo = FEE_EXPIRATION_SECONDS.add(toBN(t0))
				for (let i = 1; i <= 26; i++) {
					await time.increase(7 * 24 * 60 * 60)
					await openOrAjustVessel(alice, asset, toBN(dec(1, 18)))
				}
				const record = await feeCollector.feeRecords(alice, asset)
				th.assertIsApproximatelyEqual(expectedInitialTo, record.to, 10 * 24 * 60 * 60) // ~10 days
			})

			it("3 loans, half payback within time, other half expired = should generate partial refund only on first payment", async () => {
				const t0 = await time.latest()
				// first loan
				const borrowAmount1 = toBN(10_000_000)
				await openOrAjustVessel(alice, asset, borrowAmount1)
				// move forward in time to half life of first loan, take a second loan
				const t1 = Math.floor(t0 + Number(MIN_FEE_SECONDS) + Number(FEE_EXPIRATION_SECONDS) / 2)
				await time.increaseTo(t1)
				const borrowAmount2 = toBN(10_000_000)
				const tx2 = await openOrAjustVessel(alice, asset, borrowAmount2)
				const { from: from2, to: to2, amount: amount2 } = th.getAllEventsByName(tx2, "FeeRecordUpdated")[0].args
				// move forward in time to half life of second loan, take a third one
				const timeToLive2 = to2 - from2
				const t2 = Math.floor(Number(from2) + Number(timeToLive2) / 2)
				await time.increaseTo(t2)
				const borrowAmount3 = toBN(5_000_000)
				const tx3 = await openOrAjustVessel(alice, asset, borrowAmount3)
				const { from: from3, to: to3, amount: amount3 } = th.getAllEventsByName(tx3, "FeeRecordUpdated")[0].args
				// move forward in time to half life of third loan, pay back half
				const timeToLive3 = to3 - from3
				const t3 = Math.floor(Number(from3) + Number(timeToLive3) / 2)
				await time.increaseTo(t3)
				const paybackFraction1 = toBN(0.5 * 10 ** 18) // 50% of debt
				const paybackTx1 = await payVesselDebt(alice, asset, paybackFraction1)
				const feeRefundedEvents1 = th.getAllEventsByName(paybackTx1, "FeeRefunded")
				assert.equal(feeRefundedEvents1.length, 1)
				// move forward in time until refund is expired, pay the rest
				await time.increase(t3 + 90 * 24 * 60 * 60)
				const paybackTx2 = await closeVessel(alice, asset, String(1e18))
				const feeRefundedEvents2 = th.getAllEventsByName(paybackTx2, "FeeRefunded")
				// expect no refunds at this point
				assert.equal(feeRefundedEvents2.length, 0)
			})
		})

		describe("Decay rates", async () => {
			it("Add-ons on the very beginning of decay: should generate no extensions", async () => {
				const remainingAmount = toBN(1_000_000)
				const prevTimeToLive = toBN(175 * 24 * 60 * 60)
				const addedAmount1 = toBN(1_000_000)
				const newDuration1 = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount1)
				assert.equal(newDuration1.toString(), FEE_EXPIRATION_SECONDS.toString())
				const addedAmount2 = toBN(100_000_000)
				const newDuration2 = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount2)
				assert.equal(newDuration2.toString(), FEE_EXPIRATION_SECONDS.toString())
				const addedAmount3 = toBN(1)
				const newDuration3 = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount3)
				assert.equal(newDuration3.toString(), FEE_EXPIRATION_SECONDS.toString())
			})

			it("Add-ons on decay's mid-life: should generate proportional extensions", async () => {
				const remainingAmount = toBN(1_000)
				const prevTimeToLive = toBN(87.5 * 24 * 60 * 60)
				const addedAmount1 = toBN(1_000)
				const newDuration1 = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount1)
				th.assertIsApproximatelyEqual(newDuration1, 11340000, 1) // ~131 days
				const addedAmount2 = toBN(10_000_000)
				const newDuration2 = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount2)
				th.assertIsApproximatelyEqual(newDuration2, 15119244, 1) // ~175 days
				const addedAmount3 = toBN(1)
				const newDuration3 = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount3)
				th.assertIsApproximatelyEqual(newDuration3, 7567552, 1) // ~87.5 days
			})

			it("Second loan one day before first one expires = newDuration should be near the full lifetime", async () => {
				const remainingAmount = toBN(100)
				const prevTimeToLive = toBN(24 * 60 * 60)
				const addedAmount1 = toBN(1_000)
				const newDuration = await feeCollector.calcNewDuration(remainingAmount, prevTimeToLive, addedAmount1)
				th.assertIsApproximatelyEqual(newDuration, 13753309, 1) // ~159 days
			})
		})

		describe("Vessel liquidation", async () => {
			it("liquidated vessel: should credit all fees to platform", async () => {
				assert.equal(await debtToken.balanceOf(treasury), "0")

				// whale opens a vessel
				const { totalDebt: totalDebtWhale } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(20, 18)),
					extraParams: { from: whale },
				})
				const netDebtWhale = await th.getOpenVesselVUSDAmount(contracts, totalDebtWhale, erc20.address)
				const { minFee: minFeeWhale } = calcFees(netDebtWhale)
				const treasuryBalance1 = await debtToken.balanceOf(treasury)
				assert.equal(minFeeWhale.toString(), treasuryBalance1.toString())

				// alice opens another vessel
				const { totalDebt: totalDebtAlice } = await openVessel({
					asset: erc20.address,
					ICR: toBN(dec(4, 18)),
					extraParams: { from: alice },
				})
				const netDebtAlice = await th.getOpenVesselVUSDAmount(contracts, totalDebtAlice, erc20.address)

				// alice increases debt, lowering her ICR to 1.11
				const targetICR = toBN("1111111111111111111")
				const { VUSDAmount: extraDebtAlice } = await withdrawVUSD({
					asset: erc20.address,
					ICR: targetICR,
					extraParams: { from: alice },
				})
				const { minFee: minFeeAlice, maxFee: maxFeeAlice } = calcFees(netDebtAlice.add(extraDebtAlice))
				const treasuryBalanceBeforeLiquidation = await debtToken.balanceOf(treasury)

				// treasury must have been paid both borrower's minFees
				th.assertIsApproximatelyEqual(
					minFeeWhale.add(minFeeAlice).toString(),
					treasuryBalanceBeforeLiquidation.toString(),
					100
				)

				// price drops to 1:$100, reducing Alice's ICR below MCR
				await priceFeed.setPrice(erc20.address, "100000000000000000000")

				// confirm system is not in Recovery Mode
				assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

				// liquidate vessel
				await vesselManagerOperations.liquidate(erc20.address, alice, { from: bob })

				const treasuryBalanceAfterLiquidation = await debtToken.balanceOf(treasury)

				// check the vessel is successfully closed, and removed from sortedList
				const status_Asset = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_STATUS_INDEX]

				// status enum 3 corresponds to "Closed by liquidation"
				assert.equal(status_Asset.toString(), "3")
				assert.isFalse(await sortedVessels.contains(erc20.address, alice))

				// treasury must now account for whale's minFee and alice's maxFee
				th.assertIsApproximatelyEqual(
					minFeeWhale.add(maxFeeAlice).toString(),
					treasuryBalanceAfterLiquidation.toString(),
					100
				)
			})
		})

		describe("Batch collect", async () => {
			it("2 loans collected partially and then after they expired. Should collect max fees.", async () => {
				const borrowAmount = toBN(dec(1_000_000, 18))
				// two users borrow the same amount
				await openOrAjustVessel(alice, asset, borrowAmount)
				await openOrAjustVessel(bob, asset, borrowAmount)
				// move forward in time to half life of loan, collect expired fees
				time.increase(87.5 * 24 * 60 * 60)
				const collectTx = await feeCollector.collectFees([alice, bob], [asset, asset])
				const feeCollectedEvents = th.getAllEventsByName(collectTx, "FeeCollected")
				assert.equal(feeCollectedEvents.length, 2)
				// move forward in time to fully expired refunds and collect the remaining fees
				time.increase(100 * 24 * 60 * 60)
				await feeCollector.collectFees([alice, bob], [asset, asset])
				const { maxFee: totalFeesExpected } = calcFees(borrowAmount.mul(toBN(2)))
				// check final balances
				const aliceBalance = await debtToken.balanceOf(alice)
				const bobBalance = await debtToken.balanceOf(bob)
				const treasuryBalance = await debtToken.balanceOf(treasury)
				assert.equal(aliceBalance.toString(), "0")
				assert.equal(bobBalance.toString(), "0")
				assert.equal(treasuryBalance.toString(), totalFeesExpected.toString())
			})
		})
	})
})

/**
 * Mimics the method _calcNewDuration() from FeeCollector.sol
 */
function calcNewDuration(_remainingAmount, _prevTimeToLive, _addedAmount, _feeExpirationSeconds) {
	// transform input into BigNumbers
	const remainingAmount = toBN(_remainingAmount.toString())
	const prevTimeToLive = toBN(_prevTimeToLive.toString())
	const addedAmount = toBN(_addedAmount.toString())
	const feeExpirationSeconds = toBN(_feeExpirationSeconds.toString())
	// apply formula
	const prevWeight = remainingAmount.mul(prevTimeToLive)
	const nextWeight = addedAmount.mul(feeExpirationSeconds)
	return prevWeight.add(nextWeight).div(remainingAmount.add(addedAmount))
}

/**
 * Mimics the method _calcExpiredAmount() from FeeCollector.sol
 */
function calcExpiredAmount(_from, _to, _amount, _now, _debug = false) {
	// transform input into BigNumbers
	const PRECISION = toBN(1e9)
	const from = toBN(_from.toString())
	const to = toBN(_to.toString())
	const now = toBN(_now.toString())
	const amount = toBN(_amount.toString())
	// apply formula
	if (from.gt(now)) {
		return 0
	}
	const lifeTime = to.sub(from)
	const elapsedTime = now.sub(from)
	const decayRate = amount.mul(PRECISION).div(lifeTime)
	const expiredAmount = elapsedTime.mul(decayRate).div(PRECISION)
	if (_debug) {
		console.log(`JS._calcExpiredAmount() :: lifeTime: ${lifeTime} (~${lifeTime / 24 / 60 / 60} days)`)
		console.log(`JS._calcExpiredAmount() :: elapsedTime: ${elapsedTime} (~${elapsedTime / 24 / 60 / 60} days)`)
		console.log(`JS._calcExpiredAmount() :: decayRate: ${decayRate}`)
		console.log(`JS._calcExpiredAmount() :: RESULT = ${expiredAmount}`)
	}
	return expiredAmount
}

contract("Reset chain state", async accounts => {})
