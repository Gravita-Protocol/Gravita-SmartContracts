const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const StabilityPool = artifacts.require("StabilityPool.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

const ZERO_ADDRESS = th.ZERO_ADDRESS

const ZERO = toBN("0")

/*
 * Naive fuzz test that checks whether all SP depositors can successfully withdraw from the SP, after a random sequence
 * of deposits and liquidations.
 *
 * The test cases tackle different size ranges for liquidated collateral and SP deposits.
 */

contract(
	"Stability - random liquidations/deposits, then check all depositors can withdraw",
	async accounts => {
		const whale = accounts[accounts.length - 1]
		const bountyAddress = accounts[998]
		const lpRewardsAddress = accounts[999]

		let priceFeed
		let VUSDToken
		let vesselManager
		let stabilityPool
		let sortedVessels
		let borrowerOperations

		const skyrocketPriceAndCheckAllVesselsSafe = async () => {
			// price skyrockets, therefore no undercollateralized troes
			await priceFeed.setPrice(dec(1000, 18))
			const lowestICR = await vesselManager.getCurrentICR(
				await sortedVessels.getLast(),
				dec(1000, 18)
			)
			assert.isTrue(lowestICR.gt(toBN(dec(110, 16))))
		}

		const performLiquidation = async (remainingDefaulters, liquidatedAccountsDict) => {
			if (remainingDefaulters.length === 0) {
				return
			}

			const randomDefaulterIndex = Math.floor(Math.random() * remainingDefaulters.length)
			const randomDefaulter = remainingDefaulters[randomDefaulterIndex]

			const liquidatedUSDV = (await vesselManager.Vessels(randomDefaulter))[0]
			const liquidatedETH = (await vesselManager.Vessels(randomDefaulter))[1]

			const price = await priceFeed.getPrice()
			const ICR = (await vesselManager.getCurrentICR(randomDefaulter, price)).toString()
			const ICRPercent = ICR.slice(0, ICR.length - 16)

			console.log(`SP address: ${stabilityPool.address}`)
			const USDVinPoolBefore = await stabilityPool.getTotalVUSDDeposits()
			const liquidatedTx = await vesselManager.liquidate(randomDefaulter, {
				from: accounts[0],
			})
			const USDVinPoolAfter = await stabilityPool.getTotalVUSDDeposits()

			assert.isTrue(liquidatedTx.receipt.status)

			if (liquidatedTx.receipt.status) {
				liquidatedAccountsDict[randomDefaulter] = true
				remainingDefaulters.splice(randomDefaulterIndex, 1)
			}
			if (await vesselManager.checkRecoveryMode(price)) {
				console.log("recovery mode: TRUE")
			}

			console.log(
				`Liquidation. addr: ${th.squeezeAddr(
					randomDefaulter
				)} ICR: ${ICRPercent}% coll: ${liquidatedETH} debt: ${liquidatedUSDV} SP VUSD before: ${USDVinPoolBefore} SP VUSD after: ${USDVinPoolAfter} tx success: ${
					liquidatedTx.receipt.status
				}`
			)
		}

		const performSPDeposit = async (
			depositorAccounts,
			currentDepositors,
			currentDepositorsDict
		) => {
			const randomIndex = Math.floor(Math.random() * depositorAccounts.length)
			const randomDepositor = depositorAccounts[randomIndex]

			const userBalance = await VUSDToken.balanceOf(randomDepositor)
			const maxUSDVDeposit = userBalance.div(toBN(dec(1, 18)))

			const randomVUSDAmount = th.randAmountInWei(1, maxUSDVDeposit)

			const depositTx = await stabilityPool.provideToSP(randomVUSDAmount, ZERO_ADDRESS, {
				from: randomDepositor,
			})

			assert.isTrue(depositTx.receipt.status)

			if (depositTx.receipt.status && !currentDepositorsDict[randomDepositor]) {
				currentDepositorsDict[randomDepositor] = true
				currentDepositors.push(randomDepositor)
			}

			console.log(
				`SP deposit. addr: ${th.squeezeAddr(
					randomDepositor
				)} amount: ${randomVUSDAmount} tx success: ${depositTx.receipt.status} `
			)
		}

		const randomOperation = async (
			depositorAccounts,
			remainingDefaulters,
			currentDepositors,
			liquidatedAccountsDict,
			currentDepositorsDict
		) => {
			const randomSelection = Math.floor(Math.random() * 2)

			if (randomSelection === 0) {
				await performLiquidation(remainingDefaulters, liquidatedAccountsDict)
			} else if (randomSelection === 1) {
				await performSPDeposit(depositorAccounts, currentDepositors, currentDepositorsDict)
			}
		}

		const systemContainsVesselUnder110 = async price => {
			const lowestICR = await vesselManager.getCurrentICR(await sortedVessels.getLast(), price)
			console.log(
				`lowestICR: ${lowestICR}, lowestICR.lt(dec(110, 16)): ${lowestICR.lt(
					toBN(dec(110, 16))
				)}`
			)
			return lowestICR.lt(dec(110, 16))
		}

		const systemContainsVesselUnder100 = async price => {
			const lowestICR = await vesselManager.getCurrentICR(await sortedVessels.getLast(), price)
			console.log(
				`lowestICR: ${lowestICR}, lowestICR.lt(dec(100, 16)): ${lowestICR.lt(
					toBN(dec(100, 16))
				)}`
			)
			return lowestICR.lt(dec(100, 16))
		}

		const getTotalDebtFromUndercollateralizedVessels = async (n, price) => {
			let totalDebt = ZERO
			let vessel = await sortedVessels.getLast()

			for (let i = 0; i < n; i++) {
				const ICR = await vesselManager.getCurrentICR(vessel, price)
				const debt = ICR.lt(toBN(dec(110, 16)))
					? (await vesselManager.getEntireDebtAndColl(vessel))[0]
					: ZERO

				totalDebt = totalDebt.add(debt)
				vessel = await sortedVessels.getPrev(vessel)
			}

			return totalDebt
		}

		const clearAllUndercollateralizedVessels = async price => {
			/* Somewhat arbitrary way to clear under-collateralized vessels:
			 *
			 * - If system is in Recovery Mode and contains vessels with ICR < 100, whale draws the lowest vessel's debt amount
			 * and sends to lowest vessel owner, who then closes their vessel.
			 *
			 * - If system contains vessels with ICR < 110, whale simply draws and makes an SP deposit
			 * equal to the debt of the last 50 vessels, before a liquidateVessels tx hits the last 50 vessels.
			 *
			 * The intent is to avoid the system entering an endless loop where the SP is empty and debt is being forever liquidated/recycled
			 * between active vessels, and the existence of some under-collateralized vessels blocks all SP depositors from withdrawing.
			 *
			 * Since the purpose of the fuzz test is to see if SP depositors can indeed withdraw *when they should be able to*,
			 * we first need to put the system in a state with no under-collateralized vessels (which are supposed to block SP withdrawals).
			 */
			while (
				(await systemContainsVesselUnder100(price)) &&
				(await vesselManager.checkRecoveryMode())
			) {
				const lowestVessel = await sortedVessels.getLast()
				const lastVesselDebt = (await vesselManager.getEntireDebtAndColl(vessel))[0]
				await borrowerOperations.adjustVessel(0, 0, lastVesselDebt, true, whale, {
					from: whale,
				})
				await VUSDToken.transfer(lowestVessel, lowestVesselDebt, { from: whale })
				await borrowerOperations.closeVessel({ from: lowestVessel })
			}

			while (await systemContainsVesselUnder110(price)) {
				const debtLowest50Vessels = await getTotalDebtFromUndercollateralizedVessels(50, price)

				if (debtLowest50Vessels.gt(ZERO)) {
					await borrowerOperations.adjustVessel(0, 0, debtLowest50Vessels, true, whale, {
						from: whale,
					})
					await stabilityPool.provideToSP(debtLowest50Vessels, { from: whale })
				}

				await vesselManager.liquidateVessels(50)
			}
		}

		const attemptWithdrawAllDeposits = async currentDepositors => {
			// First, liquidate all remaining undercollateralized vessels, so that SP depositors may withdraw

			console.log("\n")
			console.log("--- Attempt to withdraw all deposits ---")
			console.log(`Depositors count: ${currentDepositors.length}`)

			for (depositor of currentDepositors) {
				const initialDeposit = (await stabilityPool.deposits(depositor))[0]
				const finalDeposit = await stabilityPool.getCompoundedDebtTokenDeposits(depositor)
				const AssetGain = await stabilityPool.getDepositorETHGain(depositor)
				const ETHinSP = (await stabilityPool.getETH()).toString()
				const USDVinSP = (await stabilityPool.getTotalVUSDDeposits()).toString()

				// Attempt to withdraw
				const withdrawalTx = await stabilityPool.withdrawFromSP(dec(1, 36), {
					from: depositor,
				})

				const ETHinSPAfter = (await stabilityPool.getETH()).toString()
				const USDVinSPAfter = (await stabilityPool.getTotalVUSDDeposits()).toString()
				const USDVBalanceSPAfter = await VUSDToken.balanceOf(stabilityPool.address)
				const depositAfter = await stabilityPool.getCompoundedDebtTokenDeposits(depositor)

				console.log(`--Before withdrawal--
                    withdrawer addr: ${th.squeezeAddr(depositor)}
                     initial deposit: ${initialDeposit}
                     ETH gain: ${AssetGain}
                     ETH in SP: ${ETHinSP}
                     compounded deposit: ${finalDeposit} 
                     VUSD in SP: ${USDVinSP}
                    
                    --After withdrawal--
                     Withdrawal tx success: ${withdrawalTx.receipt.status} 
                     Deposit after: ${depositAfter}
                     ETH remaining in SP: ${ETHinSPAfter}
                     SP VUSD deposits tracker after: ${USDVinSPAfter}
                     SP VUSD balance after: ${USDVBalanceSPAfter}
                     `)
				// Check each deposit can be withdrawn
				assert.isTrue(withdrawalTx.receipt.status)
				assert.equal(depositAfter, "0")
			}
		}

		describe("Stability Pool Withdrawals", async () => {
			before(async () => {
				console.log(`Number of accounts: ${accounts.length}`)
			})

			beforeEach(async () => {
				contracts = await deploymentHelper.deployGravityCore()
				const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

				priceFeed = contracts.priceFeedTestnet
				VUSDToken = contracts.vusdToken
				vesselManager = contracts.vesselManager
				borrowerOperations = contracts.borrowerOperations
				sortedVessels = contracts.sortedVessels

				await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
				await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
				stabilityPool = contracts.stabilityPool
			})

			// mixed deposits/liquidations

			// ranges: low-low, low-high, high-low, high-high, full-full

			// full offsets, partial offsets
			// ensure full offset with whale2 in S
			// ensure partial offset with whale 3 in L

			// TODO adapt tests to consider ER20 deposits
			it("Defaulters' Collateral in range [1, 1e8]. SP Deposits in range [100, 1e10]. ETH:USD = 100", async () => {
				// whale adds coll that holds TCR > 150%
				await borrowerOperations.openVessel(0, 0, whale, whale, {
					from: whale,
					value: dec(5, 29),
				})

				const numberOfOps = 5
				const defaulterAccounts = accounts.slice(1, numberOfOps)
				const depositorAccounts = accounts.slice(numberOfOps + 1, numberOfOps * 2)

				const defaulterCollMin = 1
				const defaulterCollMax = 100000000
				const defaulterUSDVProportionMin = 91
				const defaulterUSDVProportionMax = 180

				const depositorCollMin = 1
				const depositorCollMax = 100000000
				const depositorUSDVProportionMin = 100
				const depositorUSDVProportionMax = 100

				const remainingDefaulters = [...defaulterAccounts]
				const currentDepositors = []
				const liquidatedAccountsDict = {}
				const currentDepositorsDict = {}

				// setup:
				// account set L all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					defaulterCollMin,
					defaulterCollMax,
					defaulterAccounts,
					contracts,
					defaulterUSDVProportionMin,
					defaulterUSDVProportionMax,
					true
				)

				// account set S all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					depositorCollMin,
					depositorCollMax,
					depositorAccounts,
					contracts,
					depositorUSDVProportionMin,
					depositorUSDVProportionMax,
					true
				)

				// price drops, all L liquidateable
				await priceFeed.setPrice(dec(1, 18))

				// Random sequence of operations: liquidations and SP deposits
				for (i = 0; i < numberOfOps; i++) {
					await randomOperation(
						depositorAccounts,
						remainingDefaulters,
						currentDepositors,
						liquidatedAccountsDict,
						currentDepositorsDict
					)
				}

				await skyrocketPriceAndCheckAllVesselsSafe()

				const totalUSDVDepositsBeforeWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsBeforeWithdrawals = await stabilityPool.getETH()

				await attemptWithdrawAllDeposits(currentDepositors)

				const totalUSDVDepositsAfterWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsAfterWithdrawals = await stabilityPool.getETH()

				console.log(
					`Total VUSD deposits before any withdrawals: ${totalUSDVDepositsBeforeWithdrawals}`
				)
				console.log(
					`Total ETH rewards before any withdrawals: ${totalETHRewardsBeforeWithdrawals}`
				)

				console.log(
					`Remaining VUSD deposits after withdrawals: ${totalUSDVDepositsAfterWithdrawals}`
				)
				console.log(
					`Remaining ETH rewards after withdrawals: ${totalETHRewardsAfterWithdrawals}`
				)

				console.log(`current depositors length: ${currentDepositors.length}`)
				console.log(`remaining defaulters length: ${remainingDefaulters.length}`)
			})

			it("Defaulters' Collateral in range [1, 10]. SP Deposits in range [1e8, 1e10]. ETH:USD = 100", async () => {
				// whale adds coll that holds TCR > 150%
				await borrowerOperations.openVessel(0, 0, whale, whale, {
					from: whale,
					value: dec(5, 29),
				})

				const numberOfOps = 5
				const defaulterAccounts = accounts.slice(1, numberOfOps)
				const depositorAccounts = accounts.slice(numberOfOps + 1, numberOfOps * 2)

				const defaulterCollMin = 1
				const defaulterCollMax = 10
				const defaulterUSDVProportionMin = 91
				const defaulterUSDVProportionMax = 180

				const depositorCollMin = 1000000
				const depositorCollMax = 100000000
				const depositorUSDVProportionMin = 100
				const depositorUSDVProportionMax = 100

				const remainingDefaulters = [...defaulterAccounts]
				const currentDepositors = []
				const liquidatedAccountsDict = {}
				const currentDepositorsDict = {}

				// setup:
				// account set L all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					defaulterCollMin,
					defaulterCollMax,
					defaulterAccounts,
					contracts,
					defaulterUSDVProportionMin,
					defaulterUSDVProportionMax
				)

				// account set S all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					depositorCollMin,
					depositorCollMax,
					depositorAccounts,
					contracts,
					depositorUSDVProportionMin,
					depositorUSDVProportionMax
				)

				// price drops, all L liquidateable
				await priceFeed.setPrice(dec(100, 18))

				// Random sequence of operations: liquidations and SP deposits
				for (i = 0; i < numberOfOps; i++) {
					await randomOperation(
						depositorAccounts,
						remainingDefaulters,
						currentDepositors,
						liquidatedAccountsDict,
						currentDepositorsDict
					)
				}

				await skyrocketPriceAndCheckAllVesselsSafe()

				const totalUSDVDepositsBeforeWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsBeforeWithdrawals = await stabilityPool.getETH()

				await attemptWithdrawAllDeposits(currentDepositors)

				const totalUSDVDepositsAfterWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsAfterWithdrawals = await stabilityPool.getETH()

				console.log(
					`Total VUSD deposits before any withdrawals: ${totalUSDVDepositsBeforeWithdrawals}`
				)
				console.log(
					`Total ETH rewards before any withdrawals: ${totalETHRewardsBeforeWithdrawals}`
				)

				console.log(
					`Remaining VUSD deposits after withdrawals: ${totalUSDVDepositsAfterWithdrawals}`
				)
				console.log(
					`Remaining ETH rewards after withdrawals: ${totalETHRewardsAfterWithdrawals}`
				)

				console.log(`current depositors length: ${currentDepositors.length}`)
				console.log(`remaining defaulters length: ${remainingDefaulters.length}`)
			})

			it("Defaulters' Collateral in range [1e6, 1e8]. SP Deposits in range [100, 1000]. Every liquidation empties the Pool. ETH:USD = 100", async () => {
				// whale adds coll that holds TCR > 150%
				await borrowerOperations.openVessel(0, 0, whale, whale, {
					from: whale,
					value: dec(5, 29),
				})

				const numberOfOps = 5
				const defaulterAccounts = accounts.slice(1, numberOfOps)
				const depositorAccounts = accounts.slice(numberOfOps + 1, numberOfOps * 2)

				const defaulterCollMin = 1000000
				const defaulterCollMax = 100000000
				const defaulterUSDVProportionMin = 91
				const defaulterUSDVProportionMax = 180

				const depositorCollMin = 1
				const depositorCollMax = 10
				const depositorUSDVProportionMin = 100
				const depositorUSDVProportionMax = 100

				const remainingDefaulters = [...defaulterAccounts]
				const currentDepositors = []
				const liquidatedAccountsDict = {}
				const currentDepositorsDict = {}

				// setup:
				// account set L all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					defaulterCollMin,
					defaulterCollMax,
					defaulterAccounts,
					contracts,
					defaulterUSDVProportionMin,
					defaulterUSDVProportionMax
				)

				// account set S all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					depositorCollMin,
					depositorCollMax,
					depositorAccounts,
					contracts,
					depositorUSDVProportionMin,
					depositorUSDVProportionMax
				)

				// price drops, all L liquidateable
				await priceFeed.setPrice(dec(100, 18))

				// Random sequence of operations: liquidations and SP deposits
				for (i = 0; i < numberOfOps; i++) {
					await randomOperation(
						depositorAccounts,
						remainingDefaulters,
						currentDepositors,
						liquidatedAccountsDict,
						currentDepositorsDict
					)
				}

				await skyrocketPriceAndCheckAllVesselsSafe()

				const totalUSDVDepositsBeforeWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsBeforeWithdrawals = await stabilityPool.getETH()

				await attemptWithdrawAllDeposits(currentDepositors)

				const totalUSDVDepositsAfterWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsAfterWithdrawals = await stabilityPool.getETH()

				console.log(
					`Total VUSD deposits before any withdrawals: ${totalUSDVDepositsBeforeWithdrawals}`
				)
				console.log(
					`Total ETH rewards before any withdrawals: ${totalETHRewardsBeforeWithdrawals}`
				)

				console.log(
					`Remaining VUSD deposits after withdrawals: ${totalUSDVDepositsAfterWithdrawals}`
				)
				console.log(
					`Remaining ETH rewards after withdrawals: ${totalETHRewardsAfterWithdrawals}`
				)

				console.log(`current depositors length: ${currentDepositors.length}`)
				console.log(`remaining defaulters length: ${remainingDefaulters.length}`)
			})

			it("Defaulters' Collateral in range [1e6, 1e8]. SP Deposits in range [1e8 1e10]. ETH:USD = 100", async () => {
				// whale adds coll that holds TCR > 150%
				await borrowerOperations.openVessel(0, 0, whale, whale, {
					from: whale,
					value: dec(5, 29),
				})

				// price drops, all L liquidateable
				const numberOfOps = 5
				const defaulterAccounts = accounts.slice(1, numberOfOps)
				const depositorAccounts = accounts.slice(numberOfOps + 1, numberOfOps * 2)

				const defaulterCollMin = 1000000
				const defaulterCollMax = 100000000
				const defaulterUSDVProportionMin = 91
				const defaulterUSDVProportionMax = 180

				const depositorCollMin = 1000000
				const depositorCollMax = 100000000
				const depositorUSDVProportionMin = 100
				const depositorUSDVProportionMax = 100

				const remainingDefaulters = [...defaulterAccounts]
				const currentDepositors = []
				const liquidatedAccountsDict = {}
				const currentDepositorsDict = {}

				// setup:
				// account set L all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					defaulterCollMin,
					defaulterCollMax,
					defaulterAccounts,
					contracts,
					defaulterUSDVProportionMin,
					defaulterUSDVProportionMax
				)

				// account set S all add coll and withdraw VUSD
				await th.openVessel_allAccounts_randomETH_randomVUSD(
					depositorCollMin,
					depositorCollMax,
					depositorAccounts,
					contracts,
					depositorUSDVProportionMin,
					depositorUSDVProportionMax
				)

				// price drops, all L liquidateable
				await priceFeed.setPrice(dec(100, 18))

				// Random sequence of operations: liquidations and SP deposits
				for (i = 0; i < numberOfOps; i++) {
					await randomOperation(
						depositorAccounts,
						remainingDefaulters,
						currentDepositors,
						liquidatedAccountsDict,
						currentDepositorsDict
					)
				}

				await skyrocketPriceAndCheckAllVesselsSafe()

				const totalUSDVDepositsBeforeWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsBeforeWithdrawals = await stabilityPool.getETH()

				await attemptWithdrawAllDeposits(currentDepositors)

				const totalUSDVDepositsAfterWithdrawals = await stabilityPool.getTotalVUSDDeposits()
				const totalETHRewardsAfterWithdrawals = await stabilityPool.getETH()

				console.log(
					`Total VUSD deposits before any withdrawals: ${totalUSDVDepositsBeforeWithdrawals}`
				)
				console.log(
					`Total ETH rewards before any withdrawals: ${totalETHRewardsBeforeWithdrawals}`
				)

				console.log(
					`Remaining VUSD deposits after withdrawals: ${totalUSDVDepositsAfterWithdrawals}`
				)
				console.log(
					`Remaining ETH rewards after withdrawals: ${totalETHRewardsAfterWithdrawals}`
				)

				console.log(`current depositors length: ${currentDepositors.length}`)
				console.log(`remaining defaulters length: ${remainingDefaulters.length}`)
			})
		})
	}
)

