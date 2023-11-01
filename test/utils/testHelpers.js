const { expectRevert } = require("@openzeppelin/test-helpers")
const { web3 } = require("@openzeppelin/test-helpers/src/setup")
const BN = require("bn.js")
const fromWei = web3.utils.fromWei
// const Destructible = artifacts.require("./TestContracts/Destructible.sol")

const MoneyValues = {
	negative_5e17: "-" + web3.utils.toWei("500", "finney"),
	negative_1e18: "-" + web3.utils.toWei("1", "ether"),
	negative_10e18: "-" + web3.utils.toWei("10", "ether"),
	negative_50e18: "-" + web3.utils.toWei("50", "ether"),
	negative_100e18: "-" + web3.utils.toWei("100", "ether"),
	negative_101e18: "-" + web3.utils.toWei("101", "ether"),
	negative_eth: amount => "-" + web3.utils.toWei(amount, "ether"),

	_zeroBN: web3.utils.toBN("0"),
	_1e18BN: web3.utils.toBN("1000000000000000000"),
	_10e18BN: web3.utils.toBN("10000000000000000000"),
	_100e18BN: web3.utils.toBN("100000000000000000000"),
	_100BN: web3.utils.toBN("100"),
	_110BN: web3.utils.toBN("110"),
	_150BN: web3.utils.toBN("150"),

	_MCR: web3.utils.toBN("1100000000000000000"),
	_ICR100: web3.utils.toBN("1000000000000000000"),
	_CCR: web3.utils.toBN("1500000000000000000"),
}

const TimeValues = {
	SECONDS_IN_ONE_MINUTE: 60,
	SECONDS_IN_ONE_HOUR: 60 * 60,
	SECONDS_IN_ONE_DAY: 60 * 60 * 24,
	SECONDS_IN_ONE_WEEK: 60 * 60 * 24 * 7,
	SECONDS_IN_SIX_WEEKS: 60 * 60 * 24 * 7 * 6,
	SECONDS_IN_ONE_MONTH: 60 * 60 * 24 * 30,
	SECONDS_IN_ONE_YEAR: 60 * 60 * 24 * 365,
	MINUTES_IN_ONE_WEEK: 60 * 24 * 7,
	MINUTES_IN_ONE_MONTH: 60 * 24 * 30,
	MINUTES_IN_ONE_YEAR: 60 * 24 * 365,
}

const EMPTY_ADDRESS = "0x" + "0".repeat(40)

class TestHelper {
	static dec(val, scale) {
		let zerosCount

		if (scale == "ether") {
			zerosCount = 18
		} else if (scale == "finney") zerosCount = 15
		else {
			zerosCount = scale
		}

		const strVal = val.toString()
		const strZeros = "0".repeat(zerosCount)

		return strVal.concat(strZeros)
	}

	static squeezeAddr(address) {
		const len = address.length
		return address
			.slice(0, 6)
			.concat("...")
			.concat(address.slice(len - 4, len))
	}

	static getDifference(x, y) {
		const x_BN = web3.utils.toBN(x)
		const y_BN = web3.utils.toBN(y)

		return Number(x_BN.sub(y_BN).abs())
	}

	static getDifferenceEther(x, y) {
		return Number(fromWei(this.getDifference(x, y).toString()))
	}

	static toUnit(value, unit = "ether") {
		return web3.utils.toWei(value, unit)
	}

	static toUnitNumber(value, unit = "ether") {
		return parseInt(web3.utils.toWei(value, unit))
	}

	static assertIsApproximatelyEqual(x, y, error = 1000) {
		assert.isAtMost(this.getDifference(x, y), error)
	}

	static zipToObject(array1, array2) {
		let obj = {}
		array1.forEach((element, idx) => (obj[element] = array2[idx]))
		return obj
	}

	static getGasMetrics(gasCostList) {
		const minGas = Math.min(...gasCostList)
		const maxGas = Math.max(...gasCostList)

		let sum = 0
		for (const gas of gasCostList) {
			sum += gas
		}

		if (sum === 0) {
			return {
				gasCostList: gasCostList,
				minGas: undefined,
				maxGas: undefined,
				meanGas: undefined,
				medianGas: undefined,
			}
		}
		const meanGas = sum / gasCostList.length

		// median is the middle element (for odd list size) or element adjacent-right of middle (for even list size)
		const sortedGasCostList = [...gasCostList].sort()
		const medianGas = sortedGasCostList[Math.floor(sortedGasCostList.length / 2)]
		return { gasCostList, minGas, maxGas, meanGas, medianGas }
	}

	static getGasMinMaxAvg(gasCostList) {
		const metrics = th.getGasMetrics(gasCostList)

		const minGas = metrics.minGas
		const maxGas = metrics.maxGas
		const meanGas = metrics.meanGas
		const medianGas = metrics.medianGas

		return { minGas, maxGas, meanGas, medianGas }
	}

	static getEndOfAccount(account) {
		const accountLast2bytes = account.slice(account.length - 4, account.length)
		return accountLast2bytes
	}

	static randDecayFactor(min, max) {
		const amount = Math.random() * (max - min) + min
		const amountInWei = web3.utils.toWei(amount.toFixed(18), "ether")
		return amountInWei
	}

	static randAmountInWei(min, max) {
		const amount = Math.random() * (max - min) + min
		const amountInWei = web3.utils.toWei(amount.toString(), "ether")
		return amountInWei
	}

	static randAmountInGWei(min, max) {
		const amount = Math.floor(Math.random() * (max - min) + min)
		const amountInWei = web3.utils.toWei(amount.toString(), "gwei")
		return amountInWei
	}

	static makeWei(num) {
		return web3.utils.toWei(num.toString(), "ether")
	}

	static appendData(results, message, data) {
		data.push(message + `\n`)
		for (const key in results) {
			data.push(key + "," + results[key] + "\n")
		}
	}

	static getRandICR(min, max) {
		const ICR_Percent = Math.floor(Math.random() * (max - min) + min)

		// Convert ICR to a duint
		const ICR = web3.utils.toWei((ICR_Percent * 10).toString(), "finney")
		return ICR
	}

	static computeICR(coll, debt, price) {
		const collBN = web3.utils.toBN(coll)
		const debtBN = web3.utils.toBN(debt)
		const priceBN = web3.utils.toBN(price)

		const ICR = debtBN.eq(this.toBN("0"))
			? this.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
			: collBN.mul(priceBN).div(debtBN)

		return ICR
	}

	static async ICRbetween100and110(account, vesselManager, price, asset) {
		if (!asset) asset = this.ZERO_ADDRESS

		const ICR = await vesselManager.getCurrentICR(asset, account, price)
		return ICR.gt(MoneyValues._ICR100) && ICR.lt(MoneyValues._MCR)
	}

	static async isUndercollateralized(account, vesselManager, price) {
		const ICR = await vesselManager.getCurrentICR(account, price)
		return ICR.lt(MoneyValues._MCR)
	}
	q

	static toBN(num) {
		return web3.utils.toBN(num)
	}

	static gasUsed(tx) {
		const gas = tx.receipt.gasUsed
		return gas
	}

	static applyLiquidationFee(ethAmount) {
		return ethAmount.mul(this.toBN(this.dec(995, 15))).div(MoneyValues._1e18BN)
	}
	// --- Logging functions ---

	static logGasMetrics(gasResults, message) {
		console.log(
			`\n ${message} \n
      min gas: ${gasResults.minGas} \n
      max gas: ${gasResults.maxGas} \n
      mean gas: ${gasResults.meanGas} \n
      median gas: ${gasResults.medianGas} \n`
		)
	}

	static logAllGasCosts(gasResults) {
		console.log(`all gas costs: ${gasResults.gasCostList} \n`)
	}

	static logGas(gas, message) {
		console.log(
			`\n ${message} \n
      gas used: ${gas} \n`
		)
	}

	static async logActiveAccounts(contracts, n) {
		const asset = contracts.erc20.address
		const count = await contracts.sortedVessels.getSize(asset)
		const price = await contracts.priceFeedTestnet.getPrice(asset)

		n = typeof n == "undefined" ? count : n

		let account = await contracts.sortedVessels.getLast(asset)
		const head = await contracts.sortedVessels.getFirst(asset)

		console.log(`Total active accounts: ${count}`)
		console.log(`First ${n} accounts, in ascending ICR order:`)

		let i = 0
		while (i < n) {
			const squeezedAddr = this.squeezeAddr(account)
			const coll = (await contracts.vesselManager.Vessels(account, asset))[1]
			const debt = (await contracts.vesselManager.Vessels(account, asset))[0]
			const ICR = await contracts.vesselManager.getCurrentICR(asset, account, price)

			console.log(`acct: ${squeezedAddr} coll: ${coll} debt: ${debt} ICR: ${ICR}`)

			if (account == head) {
				break
			}

			account = await contracts.sortedVessels.getPrev(asset, account)

			i++
		}
	}

	static async logAccountsArray(accounts, vesselManager, price, n) {
		const length = accounts.length

		n = typeof n == "undefined" ? length : n

		console.log(`Number of accounts in array: ${length}`)
		console.log(`First ${n} accounts of array:`)

		for (let i = 0; i < accounts.length; i++) {
			const account = accounts[i]

			const squeezedAddr = this.squeezeAddr(account)
			const coll = (await vesselManager.Vessels(account))[1]
			const debt = (await vesselManager.Vessels(account))[0]
			const ICR = await vesselManager.getCurrentICR(account, price)

			console.log(`Acct: ${squeezedAddr}  coll:${coll}  debt: ${debt}  ICR: ${ICR}`)
		}
	}

	static logBN(label, x) {
		x = x.toString().padStart(18, "0")
		// TODO: thousand separators
		const integerPart = x.slice(0, x.length - 18) ? x.slice(0, x.length - 18) : "0"
		console.log(`${label}:`, integerPart + "." + x.slice(-18))
	}

	// --- TCR and Recovery Mode functions ---

	// These functions use the PriceFeedTestNet view price function getPrice() which is sufficient for testing.
	// the mainnet contract PriceFeed uses fetchPrice, which is non-view and writes to storage.

	// To checkRecoveryMode / getTCR from the Liquity mainnet contracts, pass a price value - this can be the last price record
	// stored in Liquity, or the current Chainlink ETHUSD price, etc.

	static async checkRecoveryMode(contracts, asset) {
		if (!asset) asset = EMPTY_ADDRESS
		const price = await contracts.priceFeedTestnet.getPrice(asset)
		return contracts.vesselManager.checkRecoveryMode(asset, price)
	}

	static async getTCR(contracts, asset) {
		if (!asset) asset = EMPTY_ADDRESS
		const price = await contracts.priceFeedTestnet.getPrice(asset)
		return contracts.vesselManager.getTCR(asset, price)
	}

	// --- Gas compensation calculation functions ---

	// Given a composite debt, returns the actual debt  - i.e. subtracts the virtual debt.
	static async getNetDebt(debt, contracts, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		const gasCompensation = await contracts.adminContract.getDebtTokenGasCompensation(asset)
		return web3.utils.toBN(debt).sub(gasCompensation)
	}

	// Adds the gas compensation (50 GRAI)
	static async getCompositeDebt(contracts, debt, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		const compositeDebt = contracts.borrowerOperations.getCompositeDebt(asset, debt)
		return compositeDebt
	}

	static async getVesselEntireColl(contracts, vessel, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		return this.toBN((await contracts.vesselManager.getEntireDebtAndColl(asset, vessel))[1])
	}

	static async getVesselEntireDebt(contracts, vessel, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		return this.toBN((await contracts.vesselManager.getEntireDebtAndColl(asset, vessel))[0])
	}

	static async getVesselStake(contracts, vessel, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		return contracts.vesselManager.getVesselStake(asset, vessel)
	}

	/*
	 * given the requested GRAI amomunt in openVessel, returns the total debt
	 * So, it adds the gas compensation and the borrowing fee
	 */
	static async getOpenVesselTotalDebt(contracts, GRAIAmount, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		const fee = await contracts.vesselManager.getBorrowingFee(asset, GRAIAmount)
		const compositeDebt = await this.getCompositeDebt(contracts, GRAIAmount, asset)
		return compositeDebt.add(fee)
	}

	/*
	 * given the desired total debt, returns the GRAI amount that needs to be requested in openVessel
	 * So, it subtracts the gas compensation and then the borrowing fee
	 */
	static async getOpenVesselGRAIAmount(contracts, totalDebt, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		const actualDebt = await this.getNetDebt(totalDebt, contracts, asset)
		const netDebt = await this.getNetBorrowingAmount(contracts, actualDebt.toString(), asset)
		return netDebt
	}

	// Subtracts the borrowing fee
	static async getNetBorrowingAmount(contracts, debtWithFee, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		const borrowingRate = await contracts.vesselManager.getBorrowingRate(asset)
		return this.toBN(debtWithFee)
			.mul(MoneyValues._1e18BN)
			.div(MoneyValues._1e18BN.add(borrowingRate))
	}

	// Adds the borrowing fee
	static async getAmountWithBorrowingFee(contracts, GRAIAmount, asset) {
		if (!asset) asset = this.ZERO_ADDRESS
		const fee = await contracts.vesselManager.getBorrowingFee(asset, GRAIAmount)
		return GRAIAmount.add(fee)
	}

	// Adds the redemption fee
	static async getRedemptionGrossAmount(contracts, expected) {
		const redemptionRate = await contracts.vesselManager.getRedemptionRate()
		return expected.mul(MoneyValues._1e18BN).div(MoneyValues._1e18BN.add(redemptionRate))
	}

	// Get's total collateral minus total gas comp, for a series of vessels.
	static async getExpectedTotalCollMinusTotalGasComp(vesselList, contracts) {
		let totalCollRemainder = web3.utils.toBN("0")

		for (const vessel of vesselList) {
			const remainingColl = this.getCollMinusGasComp(vessel, contracts)
			totalCollRemainder = totalCollRemainder.add(remainingColl)
		}
		return totalCollRemainder
	}

	static getEmittedRedemptionValues(redemptionTx) {
		for (let i = 0; i < redemptionTx.logs.length; i++) {
			if (redemptionTx.logs[i].event === "Redemption") {
				const GRAIAmount = redemptionTx.logs[i].args[1]
				const totalGRAIRedeemed = redemptionTx.logs[i].args[2]
				const totalAssetDrawn = redemptionTx.logs[i].args[3]
				const ETHFee = redemptionTx.logs[i].args[4]

				return [GRAIAmount, totalGRAIRedeemed, totalAssetDrawn, ETHFee]
			}
		}
		throw "The transaction logs do not contain a redemption event"
	}

	static getEmittedLiquidationValues(liquidationTx) {
		for (let i = 0; i < liquidationTx.logs.length; i++) {
			if (liquidationTx.logs[i].event === "Liquidation") {
				const liquidatedDebt = liquidationTx.logs[i].args[1]
				const liquidatedColl = liquidationTx.logs[i].args[2]
				const collGasComp = liquidationTx.logs[i].args[3]
				const GRAIGasComp = liquidationTx.logs[i].args[4]

				return [liquidatedDebt, liquidatedColl, collGasComp, GRAIGasComp]
			}
		}
		throw "The transaction logs do not contain a liquidation event"
	}

	static getEmittedLiquidatedDebt(liquidationTx) {
		return this.getLiquidationEventArg(liquidationTx, 0) // LiquidatedDebt is position 0 in the Liquidation event
	}

	static getEmittedLiquidatedColl(liquidationTx) {
		return this.getLiquidationEventArg(liquidationTx, 1) // LiquidatedColl is position 1 in the Liquidation event
	}

	static getEmittedGasComp(liquidationTx) {
		return this.getLiquidationEventArg(liquidationTx, 2) // GasComp is position 2 in the Liquidation event
	}

	static getLiquidationEventArg(liquidationTx, arg) {
		for (let i = 0; i < liquidationTx.logs.length; i++) {
			if (liquidationTx.logs[i].event === "Liquidation") {
				return liquidationTx.logs[i].args[arg]
			}
		}

		throw "The transaction logs do not contain a liquidation event"
	}

	static getGRAIFeeFromGRAIBorrowingEvent(tx) {
		for (let i = 0; i < tx.logs.length; i++) {
			if (tx.logs[i].event === "BorrowingFeePaid") {
				return tx.logs[i].args[2].toString()
			}
		}
		throw "The transaction logs do not contain an BorrowingFeePaid event"
	}

	static getEventArgByIndex(tx, eventName, argIndex) {
		for (let i = 0; i < tx.logs.length; i++) {
			if (tx.logs[i].event === eventName) {
				return tx.logs[i].args[argIndex]
			}
		}
		throw `The transaction logs do not contain event ${eventName}`
	}

	static getEventArgByName(tx, eventName, argName) {
		for (let i = 0; i < tx.logs.length; i++) {
			if (tx.logs[i].event === eventName) {
				const keys = Object.keys(tx.logs[i].args)
				for (let j = 0; j < keys.length; j++) {
					if (keys[j] === argName) {
						return tx.logs[i].args[keys[j]]
					}
				}
			}
		}

		throw `The transaction logs do not contain event ${eventName} and arg ${argName}`
	}

	static getAllEventsByName(tx, eventName) {
		const events = []
		for (let i = 0; i < tx.logs.length; i++) {
			if (tx.logs[i].event === eventName) {
				events.push(tx.logs[i])
			}
		}
		return events
	}

	static getDebtAndCollFromVesselUpdatedEvents(vesselUpdatedEvents, address) {
		const event = vesselUpdatedEvents.filter(event => event.args[1] === address)[0]
		return [event.args[2], event.args[3]]
	}

	static async getBorrowerOpsListHint(contracts, newColl, newDebt) {
		const newNICR = await contracts.hintHelpers.computeNominalCR(newColl, newDebt)
		const { hintAddress: approxfullListHint, latestRandomSeed } =
			await contracts.hintHelpers.getApproxHint(newNICR, 5, this.latestRandomSeed)
		this.latestRandomSeed = latestRandomSeed

		const { 0: upperHint, 1: lowerHint } = await contracts.sortedVessels.findInsertPosition(
			newNICR,
			approxfullListHint,
			approxfullListHint
		)
		return { upperHint, lowerHint }
	}

	static async getEntireCollAndDebt(contracts, account, asset) {
		if (!asset) asset = this.ZERO_ADDRESS

		// console.log(`account: ${account}`)
		const rawColl = (await contracts.vesselManager.Vessels(account, asset))[
			this.VESSEL_COLL_INDEX
		]
		const rawDebt = (await contracts.vesselManager.Vessels(account, asset))[
			this.VESSEL_DEBT_INDEX
		]
		const pendingAssetReward = await contracts.vesselManager.getPendingAssetReward(
			asset,
			account
		)
		const pendingGRAIDebtReward = await contracts.vesselManager.getPendingDebtTokenReward(
			asset,
			account
		)
		const entireColl = rawColl.add(pendingAssetReward)
		const entireDebt = rawDebt.add(pendingGRAIDebtReward)

		return { entireColl, entireDebt }
	}

	static async getCollAndDebtFromAddColl(contracts, account, amount) {
		const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account)

		const newColl = entireColl.add(this.toBN(amount))
		const newDebt = entireDebt
		return { newColl, newDebt }
	}

	static async getCollAndDebtFromWithdrawColl(contracts, account, amount) {
		const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account)
		// console.log(`entireColl  ${entireColl}`)
		// console.log(`entireDebt  ${entireDebt}`)

		const newColl = entireColl.sub(this.toBN(amount))
		const newDebt = entireDebt
		return { newColl, newDebt }
	}

	static async getCollAndDebtFromWithdrawGRAI(contracts, account, amount) {
		const fee = await contracts.vesselManager.getBorrowingFee(amount)
		const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account)

		const newColl = entireColl
		const newDebt = entireDebt.add(this.toBN(amount)).add(fee)

		return { newColl, newDebt }
	}

	static async getCollAndDebtFromRepayGRAI(contracts, account, amount) {
		const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account)

		const newColl = entireColl
		const newDebt = entireDebt.sub(this.toBN(amount))

		return { newColl, newDebt }
	}

	static async getCollAndDebtFromAdjustment(contracts, account, ETHChange, GRAIChange) {
		const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account)

		// const coll = (await contracts.vesselManager.Vessels(account))[1]
		// const debt = (await contracts.vesselManager.Vessels(account))[0]

		const fee = GRAIChange.gt(this.toBN("0"))
			? await contracts.vesselManager.getBorrowingFee(GRAIChange)
			: this.toBN("0")
		const newColl = entireColl.add(ETHChange)
		const newDebt = entireDebt.add(GRAIChange).add(fee)

		return { newColl, newDebt }
	}

	// --- BorrowerOperations gas functions ---

	static async openVessel_allAccounts(accounts, contracts, ETHAmount, GRAIAmount) {
		const gasCostList = []
		const totalDebt = await this.getOpenVesselTotalDebt(contracts, GRAIAmount)

		for (const account of accounts) {
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				ETHAmount,
				totalDebt
			)

			const tx = await contracts.borrowerOperations.openVessel(
				this._100pct,
				GRAIAmount,
				upperHint,
				lowerHint,
				{ from: account, value: ETHAmount }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async openVessel_allAccounts_randomETH(
		minETH,
		maxETH,
		accounts,
		contracts,
		GRAIAmount
	) {
		const gasCostList = []
		const totalDebt = await this.getOpenVesselTotalDebt(contracts, GRAIAmount)

		for (const account of accounts) {
			const randCollAmount = this.randAmountInWei(minETH, maxETH)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				randCollAmount,
				totalDebt
			)

			const tx = await contracts.borrowerOperations.openVessel(
				this._100pct,
				GRAIAmount,
				upperHint,
				lowerHint,
				{ from: account, value: randCollAmount }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async openVessel_allAccounts_randomETH_ProportionalGRAI(
		minETH,
		maxETH,
		accounts,
		contracts,
		proportion
	) {
		const gasCostList = []

		for (const account of accounts) {
			const randCollAmount = this.randAmountInWei(minETH, maxETH)
			const proportionalGRAI = web3.utils.toBN(proportion).mul(web3.utils.toBN(randCollAmount))
			const totalDebt = await this.getOpenVesselTotalDebt(contracts, proportionalGRAI)

			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				randCollAmount,
				totalDebt
			)

			const tx = await contracts.borrowerOperations.openVessel(
				this._100pct,
				proportionalGRAI,
				upperHint,
				lowerHint,
				{ from: account, value: randCollAmount }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async openVessel_allAccounts_randomETH_randomGRAI(
		minETH,
		maxETH,
		accounts,
		contracts,
		minGRAIProportion,
		maxGRAIProportion,
		logging = false
	) {
		const gasCostList = []
		const price = await contracts.priceFeedTestnet.getPrice(EMPTY_ADDRESS)
		const _1e18 = web3.utils.toBN("1000000000000000000")

		let i = 0
		for (const account of accounts) {
			const randCollAmount = this.randAmountInWei(minETH, maxETH)
			// console.log(`randCollAmount ${randCollAmount }`)
			const randGRAIProportion = this.randAmountInWei(minGRAIProportion, maxGRAIProportion)
			const proportionalGRAI = web3.utils
				.toBN(randGRAIProportion)
				.mul(web3.utils.toBN(randCollAmount).div(_1e18))
			const totalDebt = await this.getOpenVesselTotalDebt(contracts, proportionalGRAI)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				randCollAmount,
				totalDebt
			)

			const feeFloor = this.dec(5, 16)
			const tx = await contracts.borrowerOperations.openVessel(
				this._100pct,
				proportionalGRAI,
				upperHint,
				lowerHint,
				{ from: account, value: randCollAmount }
			)

			if (logging && tx.receipt.status) {
				i++
				const ICR = await contracts.vesselManager.getCurrentICR(account, price)
				// console.log(`${i}. Vessel opened. addr: ${this.squeezeAddr(account)} coll: ${randCollAmount} debt: ${proportionalGRAI} ICR: ${ICR}`)
			}
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async openVessel_allAccounts_randomGRAI(
		minGRAI,
		maxGRAI,
		accounts,
		contracts,
		ETHAmount
	) {
		const gasCostList = []

		for (const account of accounts) {
			const randGRAIAmount = this.randAmountInWei(minGRAI, maxGRAI)
			const totalDebt = await this.getOpenVesselTotalDebt(contracts, randGRAIAmount)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				ETHAmount,
				totalDebt
			)

			const tx = await contracts.borrowerOperations.openVessel(
				this._100pct,
				randGRAIAmount,
				upperHint,
				lowerHint,
				{ from: account, value: ETHAmount }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async closeVessel_allAccounts(accounts, contracts) {
		const gasCostList = []

		for (const account of accounts) {
			const tx = await contracts.borrowerOperations.closeVessel({ from: account })
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async openVessel_allAccounts_decreasingGRAIAmounts(
		accounts,
		contracts,
		ETHAmount,
		maxGRAIAmount
	) {
		const gasCostList = []

		let i = 0
		for (const account of accounts) {
			const GRAIAmount = (maxGRAIAmount - i).toString()
			const GRAIAmountWei = web3.utils.toWei(GRAIAmount, "ether")
			const totalDebt = await this.getOpenVesselTotalDebt(contracts, GRAIAmountWei)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				ETHAmount,
				totalDebt
			)

			const tx = await contracts.borrowerOperations.openVessel(
				this._100pct,
				GRAIAmountWei,
				upperHint,
				lowerHint,
				{ from: account, value: ETHAmount }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
			i += 1
		}
		return this.getGasMetrics(gasCostList)
	}

	static async openVessel(
		contracts,
		{
			asset,
			assetSent,
			extraGRAIAmount,
			upperHint,
			lowerHint,
			ICR,
			extraParams,
		}
	) {
		if (!asset) asset = this.ZERO_ADDRESS
		if (!extraGRAIAmount) extraGRAIAmount = this.toBN(0)
		else if (typeof extraGRAIAmount == "string") extraGRAIAmount = this.toBN(extraGRAIAmount)
		if (!upperHint) upperHint = this.ZERO_ADDRESS
		if (!lowerHint) lowerHint = this.ZERO_ADDRESS

		const MIN_DEBT = (
			await this.getNetBorrowingAmount(
				contracts,
				await contracts.adminContract.getMinNetDebt(asset),
				asset
			)
		).add(this.toBN(1)) // add 1 to avoid rounding issues
		const GRAIAmount = MIN_DEBT.add(extraGRAIAmount)

		if (
			!ICR &&
			((asset == this.ZERO_ADDRESS && !extraParams.value) ||
				(asset != this.ZERO_ADDRESS && !assetSent))
		) {
			ICR = this.toBN(this.dec(15, 17)) // 150%
		} else if (typeof ICR == "string") ICR = this.toBN(ICR)

		const totalDebt = await this.getOpenVesselTotalDebt(contracts, GRAIAmount, asset)
		const netDebt = await this.getNetDebt(totalDebt, contracts, asset)

		if (extraParams.value) {
			assetSent = extraParams.value
		}

		if (ICR) {
			const price = await contracts.priceFeedTestnet.getPrice(asset)
			assetSent = ICR.mul(totalDebt).div(price)

			if (asset == this.ZERO_ADDRESS) {
				extraParams.value = assetSent
			}
		}

		const tx = await contracts.borrowerOperations.openVessel(
			asset,
			assetSent,
			GRAIAmount,
			upperHint,
			lowerHint,
			extraParams
		)

		return {
			GRAIAmount,
			netDebt,
			totalDebt,
			ICR,
			collateral: assetSent,
			tx,
		}
	}

	static async withdrawGRAI(
		contracts,
		{ asset, GRAIAmount, ICR, upperHint, lowerHint, extraParams }
	) {
		if (!asset) asset = this.ZERO_ADDRESS
		if (!upperHint) upperHint = this.ZERO_ADDRESS
		if (!lowerHint) lowerHint = this.ZERO_ADDRESS

		assert(
			!(GRAIAmount && ICR) && (GRAIAmount || ICR),
			"Specify either GRAI amount or target ICR, but not both"
		)

		let increasedTotalDebt
		if (ICR) {
			assert(extraParams.from, "A from account is needed")
			const { debt, coll } = await contracts.vesselManager.getEntireDebtAndColl(
				asset,
				extraParams.from
			)
			const price = await contracts.priceFeedTestnet.getPrice(asset)
			const targetDebt = coll.mul(price).div(ICR)
			assert(targetDebt > debt, "ICR is already greater than or equal to target")
			increasedTotalDebt = targetDebt.sub(debt)
			GRAIAmount = await this.getNetBorrowingAmount(contracts, increasedTotalDebt)
		} else {
			increasedTotalDebt = await this.getAmountWithBorrowingFee(contracts, GRAIAmount)
		}

		await contracts.borrowerOperations.withdrawDebtTokens(
			asset,
			GRAIAmount,
			upperHint,
			lowerHint,
			extraParams
		)

		return {
			GRAIAmount,
			increasedTotalDebt,
		}
	}

	static async adjustVessel_allAccounts(accounts, contracts, ETHAmount, GRAIAmount) {
		const gasCostList = []

		for (const account of accounts) {
			let tx

			let ETHChangeBN = this.toBN(ETHAmount)
			let GRAIChangeBN = this.toBN(GRAIAmount)

			const { newColl, newDebt } = await this.getCollAndDebtFromAdjustment(
				contracts,
				account,
				ETHChangeBN,
				GRAIChangeBN
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const zero = this.toBN("0")

			let isDebtIncrease = GRAIChangeBN.gt(zero)
			GRAIChangeBN = GRAIChangeBN.abs()

			// Add ETH to vessel
			if (ETHChangeBN.gt(zero)) {
				tx = await contracts.borrowerOperations.adjustVessel(
					this._100pct,
					0,
					GRAIChangeBN,
					isDebtIncrease,
					upperHint,
					lowerHint,
					{ from: account, value: ETHChangeBN }
				)
				// Withdraw ETH from vessel
			} else if (ETHChangeBN.lt(zero)) {
				ETHChangeBN = ETHChangeBN.neg()
				tx = await contracts.borrowerOperations.adjustVessel(
					this._100pct,
					ETHChangeBN,
					GRAIChangeBN,
					isDebtIncrease,
					upperHint,
					lowerHint,
					{ from: account }
				)
			}

			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async adjustVessel_allAccounts_randomAmount(
		accounts,
		contracts,
		ETHMin,
		ETHMax,
		GRAIMin,
		GRAIMax
	) {
		const gasCostList = []

		for (const account of accounts) {
			let tx

			let ETHChangeBN = this.toBN(this.randAmountInWei(ETHMin, ETHMax))
			let GRAIChangeBN = this.toBN(this.randAmountInWei(GRAIMin, GRAIMax))

			const { newColl, newDebt } = await this.getCollAndDebtFromAdjustment(
				contracts,
				account,
				ETHChangeBN,
				GRAIChangeBN
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const zero = this.toBN("0")

			let isDebtIncrease = GRAIChangeBN.gt(zero)
			GRAIChangeBN = GRAIChangeBN.abs()

			// Add ETH to vessel
			if (ETHChangeBN.gt(zero)) {
				tx = await contracts.borrowerOperations.adjustVessel(
					this._100pct,
					0,
					GRAIChangeBN,
					isDebtIncrease,
					upperHint,
					lowerHint,
					{ from: account, value: ETHChangeBN }
				)
				// Withdraw ETH from vessel
			} else if (ETHChangeBN.lt(zero)) {
				ETHChangeBN = ETHChangeBN.neg()
				tx = await contracts.borrowerOperations.adjustVessel(
					this._100pct,
					ETHChangeBN,
					GRAIChangeBN,
					isDebtIncrease,
					lowerHint,
					upperHint,
					{ from: account }
				)
			}

			const gas = this.gasUsed(tx)
			// console.log(`ETH change: ${ETHChangeBN},  GRAIChange: ${GRAIChangeBN}, gas: ${gas} `)

			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async addColl_allAccounts(accounts, contracts, amount) {
		const gasCostList = []
		for (const account of accounts) {
			const { newColl, newDebt } = await this.getCollAndDebtFromAddColl(
				contracts,
				account,
				amount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.addColl(upperHint, lowerHint, {
				from: account,
				value: amount,
			})
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async addColl_allAccounts_randomAmount(min, max, accounts, contracts) {
		const gasCostList = []
		for (const account of accounts) {
			const randCollAmount = this.randAmountInWei(min, max)

			const { newColl, newDebt } = await this.getCollAndDebtFromAddColl(
				contracts,
				account,
				randCollAmount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.addColl(upperHint, lowerHint, {
				from: account,
				value: randCollAmount,
			})
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawColl_allAccounts(accounts, contracts, amount) {
		const gasCostList = []
		for (const account of accounts) {
			const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawColl(
				contracts,
				account,
				amount
			)
			// console.log(`newColl: ${newColl} `)
			// console.log(`newDebt: ${newDebt} `)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.withdrawColl(
				amount,
				upperHint,
				lowerHint,
				{ from: account }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawColl_allAccounts_randomAmount(min, max, accounts, contracts) {
		const gasCostList = []

		for (const account of accounts) {
			const randCollAmount = this.randAmountInWei(min, max)

			const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawColl(
				contracts,
				account,
				randCollAmount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.withdrawColl(
				randCollAmount,
				upperHint,
				lowerHint,
				{ from: account }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
			// console.log("gasCostlist length is " + gasCostList.length)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawGRAI_allAccounts(accounts, contracts, amount) {
		const gasCostList = []

		for (const account of accounts) {
			const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawGRAI(
				contracts,
				account,
				amount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.withdrawDebtTokens(
				this._100pct,
				amount,
				upperHint,
				lowerHint,
				{ from: account }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawGRAI_allAccounts_randomAmount(min, max, accounts, contracts) {
		const gasCostList = []

		for (const account of accounts) {
			const randGRAIAmount = this.randAmountInWei(min, max)

			const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawGRAI(
				contracts,
				account,
				randGRAIAmount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.withdrawDebtTokens(
				this._100pct,
				randGRAIAmount,
				upperHint,
				lowerHint,
				{ from: account }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async repayGRAI_allAccounts(accounts, contracts, amount) {
		const gasCostList = []

		for (const account of accounts) {
			const { newColl, newDebt } = await this.getCollAndDebtFromRepayGRAI(
				contracts,
				account,
				amount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.repayDebtTokens(amount, upperHint, lowerHint, {
				from: account,
			})
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async repayGRAI_allAccounts_randomAmount(min, max, accounts, contracts) {
		const gasCostList = []

		for (const account of accounts) {
			const randGRAIAmount = this.randAmountInWei(min, max)

			const { newColl, newDebt } = await this.getCollAndDebtFromRepayGRAI(
				contracts,
				account,
				randGRAIAmount
			)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				newDebt
			)

			const tx = await contracts.borrowerOperations.repayGRAI(
				randGRAIAmount,
				upperHint,
				lowerHint,
				{ from: account }
			)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async getCurrentICR_allAccounts(accounts, contracts, functionCaller) {
		const gasCostList = []
		const price = await contracts.priceFeedTestnet.getPrice(EMPTY_ADDRESS)

		for (const account of accounts) {
			const tx = await functionCaller.vesselManager_getCurrentICR(account, price)
			const gas = this.gasUsed(tx) - 21000
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	// --- Redemption functions ---

	static async redeemCollateral(
		redeemer,
		contracts,
		GRAIAmount,
		asset,
		maxFee = this._100pct
	) {
		if (!asset) asset = this.ZERO_ADDRESS

		const price = await contracts.priceFeedTestnet.getPrice(asset)
		const tx = await this.performRedemptionTx(
			redeemer,
			price,
			contracts,
			GRAIAmount,
			asset,
			maxFee
		)
		const gas = await this.gasUsed(tx)
		return gas
	}

	static async redeemCollateralAndGetTxObject(
		redeemer,
		contracts,
		GRAIAmount,
		asset,
		maxFee = this._100pct
	) {
		if (!asset) asset = this.ZERO_ADDRESS

		const price = await contracts.priceFeedTestnet.getPrice(asset)
		const tx = await this.performRedemptionTx(
			redeemer,
			price,
			contracts,
			GRAIAmount,
			asset,
			maxFee
		)
		return tx
	}

	static async redeemCollateral_allAccounts_randomAmount(
		min,
		max,
		accounts,
		contracts,
		asset
	) {
		if (!asset) asset = this.ZERO_ADDRESS

		const gasCostList = []
		const price = await contracts.priceFeedTestnet.getPrice(asset)

		for (const redeemer of accounts) {
			const randGRAIAmount = this.randAmountInWei(min, max)

			await this.performRedemptionTx(redeemer, price, contracts, randGRAIAmount, asset)
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async performRedemptionTx(redeemer, price, contracts, GRAIAmount, asset, maxFee = 0) {
		if (!asset) asset = this.ZERO_ADDRESS

		const redemptionhint = await contracts.vesselManager.getRedemptionHints(
			asset,
			GRAIAmount,
			price,
			0
		)

		const firstRedemptionHint = redemptionhint[0]
		const partialRedemptionNewICR = redemptionhint[1]

		const { hintAddress: approxPartialRedemptionHint, latestRandomSeed } =
			await contracts.vesselManager.getApproxHint(
				asset,
				partialRedemptionNewICR,
				50,
				this.latestRandomSeed
			)
		this.latestRandomSeed = latestRandomSeed

		const exactPartialRedemptionHint = await contracts.sortedVessels.findInsertPosition(
			asset,
			partialRedemptionNewICR,
			approxPartialRedemptionHint,
			approxPartialRedemptionHint
		)
		const tx = await contracts.vesselManagerOperations.redeemCollateral(
			asset,
			GRAIAmount,
			firstRedemptionHint,
			exactPartialRedemptionHint[0],
			exactPartialRedemptionHint[1],
			partialRedemptionNewICR,
			0,
			maxFee,
			{ from: redeemer }
		)

		return tx
	}

	// --- Composite functions ---

	static async makeVesselsIncreasingICR(accounts, contracts) {
		let amountFinney = 2000

		for (const account of accounts) {
			const coll = web3.utils.toWei(amountFinney.toString(), "finney")

			await contracts.borrowerOperations.openVessel(
				this._100pct,
				"200000000000000000000",
				account,
				account,
				{ from: account, value: coll }
			)

			amountFinney += 10
		}
	}

	// --- StabilityPool gas functions ---

	static async provideToSP_allAccounts(accounts, stabilityPool, amount) {
		const gasCostList = []
		for (const account of accounts) {
			const tx = await stabilityPool.provideToSP(amount, this.ZERO_ADDRESS, { from: account })
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async provideToSP_allAccounts_randomAmount(min, max, accounts, stabilityPool) {
		const gasCostList = []
		for (const account of accounts) {
			const randomGRAIAmount = this.randAmountInWei(min, max)
			const tx = await stabilityPool.provideToSP(randomGRAIAmount, this.ZERO_ADDRESS, {
				from: account,
			})
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawFromSP_allAccounts(accounts, stabilityPool, amount) {
		const gasCostList = []
		for (const account of accounts) {
			const tx = await stabilityPool.withdrawFromSP(amount, { from: account })
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawFromSP_allAccounts_randomAmount(min, max, accounts, stabilityPool) {
		const gasCostList = []
		for (const account of accounts) {
			const randomGRAIAmount = this.randAmountInWei(min, max)
			const tx = await stabilityPool.withdrawFromSP(randomGRAIAmount, { from: account })
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	static async withdrawETHGainToVessel_allAccounts(accounts, contracts) {
		const gasCostList = []
		for (const account of accounts) {
			let { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account)
			console.log(`entireColl: ${entireColl}`)
			console.log(`entireDebt: ${entireDebt}`)
			const AssetGain = await contracts.stabilityPool.getDepositorETHGain(account)
			const newColl = entireColl.add(AssetGain)
			const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
				contracts,
				newColl,
				entireDebt
			)

			const tx = await contracts.stabilityPool.withdrawETHGainToVessel(upperHint, lowerHint, {
				from: account,
			})
			const gas = this.gasUsed(tx)
			gasCostList.push(gas)
		}
		return this.getGasMetrics(gasCostList)
	}

	// --- Time functions ---

	static async fastForwardTime(seconds, currentWeb3Provider) {
		if (web3.utils.isBigNumber(seconds) || web3.utils.isBN(seconds))
			seconds = seconds.toNumber()

		await currentWeb3Provider.send(
			{
				id: 0,
				jsonrpc: "2.0",
				method: "evm_increaseTime",
				params: [seconds],
			},
			err => {
				if (err) console.log(err)
			}
		)

		await currentWeb3Provider.send(
			{
				id: 0,
				jsonrpc: "2.0",
				method: "evm_mine",
			},
			err => {
				if (err) console.log(err)
			}
		)
	}

	static async getLatestBlockTimestamp(web3Instance) {
		const blockNumber = await web3Instance.eth.getBlockNumber()
		const block = await web3Instance.eth.getBlock(blockNumber)

		return block.timestamp
	}

	static async getTimestampFromTx(tx, web3Instance) {
		return this.getTimestampFromTxReceipt(tx.receipt, web3Instance)
	}

	static async getTimestampFromTxReceipt(txReceipt, web3Instance) {
		const block = await web3Instance.eth.getBlock(txReceipt.blockNumber)
		return block.timestamp
	}

	static secondsToDays(seconds) {
		return Number(seconds) / (60 * 60 * 24)
	}

	static daysToSeconds(days) {
		return Number(days) * (60 * 60 * 24)
	}

	static async getTimeFromSystemDeployment(grvtToken, web3, timePassedSinceDeployment) {
		const deploymentTime = await grvtToken.getDeploymentStartTime()
		return this.toBN(deploymentTime).add(this.toBN(timePassedSinceDeployment))
	}

	// --- Assert functions ---

	static async assertRevert(txPromise, message = undefined) {
		await expectRevert.unspecified(txPromise)
	}

	static async assertAssert(txPromise) {
		try {
			const tx = await txPromise
			assert.isFalse(tx.receipt.status) // when this assert fails, the expected revert didn't occur, i.e. the tx succeeded
		} catch (err) {
			assert.include(err.message, "reverted")
		}
	}

	// --- Misc. functions  ---

	// static async forceSendEth(from, receiver, value) {
	//   const destructible = await Destructible.new()
	//   await web3.eth.sendTransaction({ to: destructible.address, from, value })
	//   await destructible.destruct(receiver)
	// }

	static hexToParam(hexValue) {
		return ("0".repeat(64) + hexValue.slice(2)).slice(-64)
	}

	static formatParam(param) {
		let formattedParam = param
		if (
			typeof param == "number" ||
			typeof param == "object" ||
			(typeof param == "string" && new RegExp("[0-9]*").test(param))
		) {
			formattedParam = web3.utils.toHex(formattedParam)
		} else if (typeof param == "boolean") {
			formattedParam = param ? "0x01" : "0x00"
		} else if (param.slice(0, 2) != "0x") {
			formattedParam = web3.utils.asciiToHex(formattedParam)
		}

		return this.hexToParam(formattedParam)
	}
	static getTransactionData(signatureString, params) {
		/*
     console.log('signatureString: ', signatureString)
     console.log('params: ', params)
     console.log('params: ', params.map(p => typeof p))
     */
		return (
			web3.utils.sha3(signatureString).slice(0, 10) +
			params.reduce((acc, p) => acc + this.formatParam(p), "")
		)
	}
}

TestHelper.ZERO_ADDRESS = "0x" + "0".repeat(40)
TestHelper.maxBytes32 = "0x" + "f".repeat(64)
TestHelper._100pct = "1000000000000000000"
TestHelper.latestRandomSeed = 31337

TestHelper.VESSEL_DEBT_INDEX = 0
TestHelper.VESSEL_COLL_INDEX = 1
TestHelper.VESSEL_STAKE_INDEX = 2
TestHelper.VESSEL_STATUS_INDEX = 3
TestHelper.VESSEL_ARRAY_INDEX = 4

module.exports = {
	TestHelper,
	MoneyValues,
	TimeValues,
}