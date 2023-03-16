const { TestHelper: th } = require("../utils/testHelpers.js")
const dh = require("./deploymentHelpers.js")

// const [borrower, A, B, C] = (() => Array.from(Array(4), x => web3.eth.accounts.create().address))()

async function main() {
	const accounts = await web3.eth.getAccounts()
	const [borrower, A, B] = accounts

	const coreContracts = await dh.deployLiquityCoreHardhat()
	const GRVTContracts = await dh.deployGRVTContractsHardhat(accounts[0])

	const { vesselManager, borrowerOperations, hintHelpers, sortedVessels, priceFeedTestnet } =
		coreContracts

	await dh.connectCoreContracts(coreContracts, GRVTContracts)
	await dh.connectGRVTContractsToCore(GRVTContracts, coreContracts)

	// Examples of off-chain hint calculation for Open Vessel

	const toWei = web3.utils.toWei
	const toBN = web3.utils.toBN

	const price = toBN(toWei("2500"))
	await priceFeedTestnet.setPrice(toBN(toWei("2500")))

	const VUSDAmount = toBN(toWei("2500")) // borrower wants to withdraw 2500 VUSD
	const ETHColl = toBN(toWei("5")) // borrower wants to lock 5 ETH collateral

	// Call deployed VesselManager contract to read the liquidation reserve and latest borrowing fee
	const liquidationReserve = await vesselManager.VUSD_GAS_COMPENSATION()
	const expectedFee = await vesselManager.getBorrowingFeeWithDecay(VUSDAmount)

	// Total debt of the new vessel = VUSD amount drawn, plus fee, plus the liquidation reserve
	const expectedDebt = VUSDAmount.add(expectedFee).add(liquidationReserve)

	// Get the nominal NICR of the new vessel
	const _1e20 = toBN(toWei("100"))
	let NICR = ETHColl.mul(_1e20).div(expectedDebt)

	// Get an approximate address hint from the deployed HintHelper contract. Use (15 * number of vessels) trials
	// to get an approx. hint that is close to the right position.
	let numVessels = await sortedVessels.getSize()
	let numTrials = numVessels.mul(toBN("15"))
	let { 0: approxHint } = await hintHelpers.getApproxHint(NICR, numTrials, 42) // random seed of 42

	// Use the approximate hint to get the exact upper and lower hints from the deployed SortedVessels contract
	let { 0: upperHint, 1: lowerHint } = await sortedVessels.findInsertPosition(
		NICR,
		approxHint,
		approxHint
	)

	// Finally, call openVessel with the exact upperHint and lowerHint
	const maxFee = "5".concat("0".repeat(16)) // Slippage protection: 5%
	await borrowerOperations.openVessel(maxFee, VUSDAmount, upperHint, lowerHint, {
		value: ETHColl,
	})

	// --- adjust vessel ---

	const collIncrease = toBN(toWei("1")) // borrower wants to add 1 ETH
	const VUSDRepayment = toBN(toWei("230")) // borrower wants to repay 230 VUSD

	// Get vessel's current debt and coll
	const { 0: debt, 1: coll } = await vesselManager.getEntireDebtAndColl(borrower)

	const newDebt = debt.sub(VUSDRepayment)
	const newColl = coll.add(collIncrease)

	NICR = newColl.mul(_1e20).div(newDebt)

	// Get an approximate address hint from the deployed HintHelper contract. Use (15 * number of vessels) trials
	// to get an approx. hint that is close to the right position.
	numVessels = await sortedVessels.getSize()
	numTrials = numVessels.mul(toBN("15"))(
		({ 0: approxHint } = await hintHelpers.getApproxHint(NICR, numTrials, 42))
	)(
		// Use the approximate hint to get the exact upper and lower hints from the deployed SortedVessels contract
		({ 0: upperHint, 1: lowerHint } = await sortedVessels.findInsertPosition(
			NICR,
			approxHint,
			approxHint
		))
	)

	// Call adjustVessel with the exact upperHint and lowerHint
	await borrowerOperations.adjustVessel(maxFee, 0, VUSDRepayment, false, upperHint, lowerHint, {
		value: collIncrease,
	})

	// --- RedeemCollateral ---

	// Get the redemptions hints from the deployed HintHelpers contract
	const redemptionhint = await hintHelpers.getRedemptionHints(VUSDAmount, price, 50)

	const {
		0: firstRedemptionHint,
		1: partialRedemptionNewICR,
		2: truncatedVUSDAmount,
	} = redemptionhint

	// Get the approximate partial redemption hint
	const { hintAddress: approxPartialRedemptionHint, latestRandomSeed } =
		await contracts.hintHelpers.getApproxHint(partialRedemptionNewICR, numTrials, 42)

	/* Use the approximate partial redemption hint to get the exact partial redemption hint from the
	 * deployed SortedVessels contract
	 */
	const exactPartialRedemptionHint = await sortedVessels.findInsertPosition(
		partialRedemptionNewICR,
		approxPartialRedemptionHint,
		approxPartialRedemptionHint
	)

	/* Finally, perform the on-chain redemption, passing the truncated VUSD amount, the correct hints, and the expected
	 * ICR of the final partially redeemed vessel in the sequence.
	 */
	await vesselManager.redeemCollateral(
		truncatedVUSDAmount,
		firstRedemptionHint,
		exactPartialRedemptionHint[0],
		exactPartialRedemptionHint[1],
		partialRedemptionNewICR,
		0,
		maxFee,
		{ from: redeemer }
	)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

