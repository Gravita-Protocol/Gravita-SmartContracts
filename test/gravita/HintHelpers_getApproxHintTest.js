const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN } = th

let latestRandomSeed = 31337

const VesselManagerTester = artifacts.require("VesselManagerTester")

contract("VesselManagerOperations-HintHelpers", async accounts => {

	let sortedVessels
	let vesselManager
	let borrowerOperations
	let vesselManagerOperations
	let contracts
	let numAccounts

	/* Open a Vessel for each account. VUSD debt is 200 VUSD each, with collateral beginning at
  1.5 ether, and rising by 0.01 ether per Vessel.  Hence, the ICR of account (i + 1) is always 1% greater than the ICR of account i. 
 */

	// Open Vessels in parallel, then withdraw VUSD in parallel
	const makeVesselsInParallel = async (accounts, n) => {
		activeAccounts = accounts.slice(0, n)
		// console.log(`number of accounts used is: ${activeAccounts.length}`)
		// console.time("makeVesselsInParallel")
		const openVesselpromises = activeAccounts.map((account, index) => openVessel(account, index))
		await Promise.all(openVesselpromises)
		const withdrawVUSDpromises = activeAccounts.map(account => withdrawVUSDfromVessel(account))
		await Promise.all(withdrawVUSDpromises)
		// console.timeEnd("makeVesselsInParallel")
	}

	const openVessel = async (account, index) => {
		const amountFinney = 2000 + index * 10
		const coll = web3.utils.toWei(amountFinney.toString(), "finney")
		await borrowerOperations.openVessel(th._100pct, 0, account, account, {
			from: account,
			value: coll,
		})
	}

	const withdrawVUSDfromVessel = async account => {
		await borrowerOperations.withdrawDebtTokens(th._100pct, "100000000000000000000", account, account, { from: account })
	}

	// Sequentially add coll and withdraw VUSD, 1 account at a time
	const makeVesselsInSequence = async (accounts, n) => {
		activeAccounts = accounts.slice(0, n)
		// console.log(`number of accounts used is: ${activeAccounts.length}`)

		let ICR = 200

		// console.time('makeVesselsInSequence')
		for (const account of activeAccounts) {
			const ICR_BN = toBN(ICR.toString().concat("0".repeat(16)))
			await th.openVessel(contracts, {
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: ICR_BN,
				extraParams: { from: account },
			})

			ICR += 1
		}
		// console.timeEnd('makeVesselsInSequence')
	}

	before(async () => {
		contracts = await deploymentHelper.deployGravitaCore()
		contracts.vesselManager = await VesselManagerTester.new()
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

		sortedVessels = contracts.sortedVessels
		vesselManager = contracts.vesselManager
		borrowerOperations = contracts.borrowerOperations
		vesselManagerOperations = contracts.vesselManagerOperations

		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)

		numAccounts = 10
		erc20 = contracts.erc20
		let index = 0
		for (const acc of accounts) {
			await erc20.mint(acc, await web3.eth.getBalance(acc))
			if (++index >= 20) break
		}

		await contracts.priceFeedTestnet.setPrice(contracts.erc20.address, dec(100, 18))
		await makeVesselsInSequence(accounts, numAccounts)
		// await makeVesselsInParallel(accounts, numAccounts)
	})

	it("setup: makes accounts with nominal ICRs increasing by 1% consecutively", async () => {
		// check first 10 accounts
		const ICR_0 = await vesselManager.getNominalICR(erc20.address, accounts[0])
		const ICR_1 = await vesselManager.getNominalICR(erc20.address, accounts[1])
		const ICR_2 = await vesselManager.getNominalICR(erc20.address, accounts[2])
		const ICR_3 = await vesselManager.getNominalICR(erc20.address, accounts[3])
		const ICR_4 = await vesselManager.getNominalICR(erc20.address, accounts[4])
		const ICR_5 = await vesselManager.getNominalICR(erc20.address, accounts[5])
		const ICR_6 = await vesselManager.getNominalICR(erc20.address, accounts[6])
		const ICR_7 = await vesselManager.getNominalICR(erc20.address, accounts[7])
		const ICR_8 = await vesselManager.getNominalICR(erc20.address, accounts[8])
		const ICR_9 = await vesselManager.getNominalICR(erc20.address, accounts[9])

		assert.isTrue(ICR_0.eq(toBN(dec(200, 16))))
		assert.isTrue(ICR_1.eq(toBN(dec(201, 16))))
		assert.isTrue(ICR_2.eq(toBN(dec(202, 16))))
		assert.isTrue(ICR_3.eq(toBN(dec(203, 16))))
		assert.isTrue(ICR_4.eq(toBN(dec(204, 16))))
		assert.isTrue(ICR_5.eq(toBN(dec(205, 16))))
		assert.isTrue(ICR_6.eq(toBN(dec(206, 16))))
		assert.isTrue(ICR_7.eq(toBN(dec(207, 16))))
		assert.isTrue(ICR_8.eq(toBN(dec(208, 16))))
		assert.isTrue(ICR_9.eq(toBN(dec(209, 16))))
	})

	it("getApproxHint(): returns the address of a Vessel within sqrt(length) positions of the correct insert position", async () => {
		const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

		/* As per the setup, the ICRs of Vessels are monotonic and seperated by 1% intervals. Therefore, the difference in ICR between 
    the given CR and the ICR of the hint address equals the number of positions between the hint address and the correct insert position 
    for a Vessel with the given CR. */

		// CR = 250%
		const CR_250 = "2500000000000000000"
		const CRPercent_250 = Number(web3.utils.fromWei(CR_250, "ether")) * 100

		let hintAddress

			// const hintAddress_250 = await functionCaller.vesselManager_getApproxHint(CR_250, sqrtLength * 10)
		;({ hintAddress, latestRandomSeed } = await vesselManagerOperations.getApproxHint(
			erc20.address,
			CR_250,
			sqrtLength * 10,
			latestRandomSeed
		))
		const ICR_hintAddress_250 = await vesselManager.getNominalICR(erc20.address, hintAddress)
		const ICRPercent_hintAddress_250 = Number(web3.utils.fromWei(ICR_hintAddress_250, "ether")) * 100

		// check the hint position is at most sqrtLength positions away from the correct position
		ICR_Difference_250 = ICRPercent_hintAddress_250 - CRPercent_250
		assert.isBelow(ICR_Difference_250, sqrtLength)

		// CR = 287%
		const CR_287 = "2870000000000000000"
		const CRPercent_287 = Number(web3.utils.fromWei(CR_287, "ether")) * 100

		// const hintAddress_287 = await functionCaller.vesselManager_getApproxHint(CR_287, sqrtLength * 10)
		;({ hintAddress, latestRandomSeed } = await vesselManagerOperations.getApproxHint(
			erc20.address,
			CR_287,
			sqrtLength * 10,
			latestRandomSeed
		))
		const ICR_hintAddress_287 = await vesselManager.getNominalICR(erc20.address, hintAddress)
		const ICRPercent_hintAddress_287 = Number(web3.utils.fromWei(ICR_hintAddress_287, "ether")) * 100

		// check the hint position is at most sqrtLength positions away from the correct position
		ICR_Difference_287 = ICRPercent_hintAddress_287 - CRPercent_287
		assert.isBelow(ICR_Difference_287, sqrtLength)

		// CR = 213%
		const CR_213 = "2130000000000000000"
		const CRPercent_213 = Number(web3.utils.fromWei(CR_213, "ether")) * 100

		// const hintAddress_213 = await functionCaller.vesselManager_getApproxHint(CR_213, sqrtLength * 10)
		;({ hintAddress, latestRandomSeed } = await vesselManagerOperations.getApproxHint(
			erc20.address,
			CR_213,
			sqrtLength * 10,
			latestRandomSeed
		))
		const ICR_hintAddress_213 = await vesselManager.getNominalICR(erc20.address, hintAddress)
		const ICRPercent_hintAddress_213 = Number(web3.utils.fromWei(ICR_hintAddress_213, "ether")) * 100

		// check the hint position is at most sqrtLength positions away from the correct position
		ICR_Difference_213 = ICRPercent_hintAddress_213 - CRPercent_213
		assert.isBelow(ICR_Difference_213, sqrtLength)

		// CR = 201%
		const CR_201 = "2010000000000000000"
		const CRPercent_201 = Number(web3.utils.fromWei(CR_201, "ether")) * 100

		//  const hintAddress_201 = await functionCaller.vesselManager_getApproxHint(CR_201, sqrtLength * 10)
		;({ hintAddress, latestRandomSeed } = await vesselManagerOperations.getApproxHint(
			erc20.address,
			CR_201,
			sqrtLength * 10,
			latestRandomSeed
		))
		const ICR_hintAddress_201 = await vesselManager.getNominalICR(erc20.address, hintAddress)
		const ICRPercent_hintAddress_201 = Number(web3.utils.fromWei(ICR_hintAddress_201, "ether")) * 100

		// check the hint position is at most sqrtLength positions away from the correct position
		ICR_Difference_201 = ICRPercent_hintAddress_201 - CRPercent_201
		assert.isBelow(ICR_Difference_201, sqrtLength)
	})

	/* Pass 100 random collateral ratios to getApproxHint(). For each, check whether the returned hint address is within 
  sqrt(length) positions of where a Vessel with that CR should be inserted. */
	// it("getApproxHint(): for 100 random CRs, returns the address of a Vessel within sqrt(length) positions of the correct insert position", async () => {
	//   const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

	//   for (i = 0; i < 100; i++) {
	//     // get random ICR between 200% and (200 + numAccounts)%
	//     const min = 200
	//     const max = 200 + numAccounts
	//     const ICR_Percent = (Math.floor(Math.random() * (max - min) + min))

	//     // Convert ICR to a duint
	//     const ICR = web3.utils.toWei((ICR_Percent * 10).toString(), 'finney')

	//     const hintAddress = await vesselManagerOperations.getApproxHint(erc20.address,ICR, sqrtLength * 10)
	//     const ICR_hintAddress = await vesselManager.getNominalICR(erc20.address,hintAddress)
	//     const ICRPercent_hintAddress = Number(web3.utils.fromWei(ICR_hintAddress, 'ether')) * 100

	//     // check the hint position is at most sqrtLength positions away from the correct position
	//     ICR_Difference = (ICRPercent_hintAddress - ICR_Percent)
	//     assert.isBelow(ICR_Difference, sqrtLength)
	//   }
	// })

	it("getApproxHint(): returns the head of the list if the CR is the max uint256 value", async () => {
		const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

		// CR = Maximum value, i.e. 2**256 -1
		const CR_Max = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

		let hintAddress

			// const hintAddress_Max = await functionCaller.vesselManager_getApproxHint(CR_Max, sqrtLength * 10)
		;({ hintAddress, latestRandomSeed } = await vesselManagerOperations.getApproxHint(
			erc20.address,
			CR_Max,
			sqrtLength * 10,
			latestRandomSeed
		))

		const ICR_hintAddress_Max = await vesselManager.getNominalICR(erc20.address, hintAddress)
		const ICRPercent_hintAddress_Max = Number(web3.utils.fromWei(ICR_hintAddress_Max, "ether")) * 100

		const firstVessel = await sortedVessels.getFirst(erc20.address)
		const ICR_FirstVessel = await vesselManager.getNominalICR(erc20.address, firstVessel)
		const ICRPercent_FirstVessel = Number(web3.utils.fromWei(ICR_FirstVessel, "ether")) * 100

		// check the hint position is at most sqrtLength positions away from the correct position
		ICR_Difference_Max = ICRPercent_hintAddress_Max - ICRPercent_FirstVessel
		assert.isBelow(ICR_Difference_Max, sqrtLength)
	})

	it("getApproxHint(): returns the tail of the list if the CR is lower than ICR of any Vessel", async () => {
		const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

		// CR = MCR
		const CR_Min = "1100000000000000000"

		let hintAddress

			//  const hintAddress_Min = await functionCaller.vesselManager_getApproxHint(CR_Min, sqrtLength * 10)
		;({ hintAddress, latestRandomSeed } = await vesselManagerOperations.getApproxHint(
			erc20.address,
			CR_Min,
			sqrtLength * 10,
			latestRandomSeed
		))
		const ICR_hintAddress_Min = await vesselManager.getNominalICR(erc20.address, hintAddress)
		const ICRPercent_hintAddress_Min = Number(web3.utils.fromWei(ICR_hintAddress_Min, "ether")) * 100

		const lastVessel = await sortedVessels.getLast(erc20.address)
		const ICR_LastVessel = await vesselManager.getNominalICR(erc20.address, lastVessel)
		const ICRPercent_LastVessel = Number(web3.utils.fromWei(ICR_LastVessel, "ether")) * 100

		// check the hint position is at most sqrtLength positions away from the correct position
		const ICR_Difference_Min = ICRPercent_hintAddress_Min - ICRPercent_LastVessel
		assert.isBelow(ICR_Difference_Min, sqrtLength)
	})

	it("computeNominalCR()", async () => {
		const NICR = await vesselManagerOperations.computeNominalCR(dec(3, 18), dec(200, 18))
		assert.equal(NICR.toString(), dec(150, 16))
	})
})
