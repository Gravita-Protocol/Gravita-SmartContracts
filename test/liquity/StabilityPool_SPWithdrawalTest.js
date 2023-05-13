const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const DebtTokenTester = artifacts.require("DebtTokenTester")

const { dec, toBN } = testHelpers.TestHelper
const th = testHelpers.TestHelper

contract("StabilityPool - Withdrawal of stability deposit - Reward calculations", async accounts => {
	const EVENT_ASSET_GAIN_NAME = "GainsWithdrawn"
	const EVENT_ASSET_GAIN_PARAM = "_amounts"

	const [
		owner,
		defaulter_1,
		defaulter_2,
		defaulter_3,
		defaulter_4,
		defaulter_5,
		defaulter_6,
		whale,
		// whale_2,
		alice,
		bob,
		carol,
		dennis,
		erin,
		flyn,
		graham,
		harriet,
		A,
		B,
		C,
		D,
		E,
		F,
	] = accounts

	const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

	let contracts

	let priceFeed
	let debtToken
	let sortedVessels
	let vesselManager
	let vesselManagerOperations
	let activePool
	let stabilityPool
	let stabilityPoolERC20
	let defaultPool
	let borrowerOperations
	let erc20

	let gasPriceInWei

	const ZERO_ADDRESS = th.ZERO_ADDRESS

	const getOpenVesselVUSDAmount = async (totalDebt, asset) => th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)

	describe("Stability Pool Withdrawal", async () => {
		async function deployContractsFixture() {
			contracts = await deploymentHelper.deployGravitaCore()
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])
			contracts.vesselManager = await VesselManagerTester.new()
			contracts = await deploymentHelper.deployDebtTokenTester(contracts)
			VesselManagerTester.setAsDeployed(contracts.vesselManager)
			DebtTokenTester.setAsDeployed(contracts.debtToken)

			priceFeed = contracts.priceFeedTestnet
			debtToken = contracts.debtToken
			sortedVessels = contracts.sortedVessels
			vesselManager = contracts.vesselManager
			vesselManagerOperations = contracts.vesselManagerOperations
			activePool = contracts.activePool
			defaultPool = contracts.defaultPool
			borrowerOperations = contracts.borrowerOperations
			erc20 = contracts.erc20
			stabilityPoolERC20 = contracts.stabilityPool

			let index = 0
			for (const acc of accounts) {
				await erc20.mint(acc, await web3.eth.getBalance(acc))
				index++

				if (index >= 50) break
			}

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
		}

		before(async () => {
			gasPriceInWei = await web3.eth.getGasPrice()
		})

		beforeEach(async () => {
			await loadFixture(deployContractsFixture)
		})

		// --- Compounding tests ---

		// --- withdrawFromSP()

		// --- Identical deposits, identical liquidation amounts---
		it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct compounded deposit and ETH Gain after one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(10000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter opens vessel with 200% ICR and 10k VUSD net debt
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			// Check depositors' compounded deposit is 6666.66 VUSD and ETH Gain is 33.16 ETH

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)[1]
				.toString()
			console.log(alice_ETHWithdrawnERC20)
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
				console.log(bob_ETHWithdrawnERC20)
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			console.log((await debtToken.balanceOf(alice)).toString())

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("6666666666666666666666")),
				20000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("6666666666666666666666")),
				20000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("6666666666666666666666")),
				20000
			)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "3316666666"), 10000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "3316666666"), 10000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "3316666666"), 10000)
		})

		it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct compounded deposit and ETH Gain after two identical liquidations", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Check depositors' compounded deposit is 3333.33 VUSD and ETH Gain is 66.33 ETH

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("3333333333333333333333")),
				20000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("3333333333333333333333")),
				20000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("3333333333333333333333")),
				20000
			)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "6633333333"), 10000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "6633333333"), 10000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "6633333333"), 10000)
		})

		it("withdrawFromSP():  Depositors with equal initial deposit withdraw correct compounded deposit and ETH Gain after three identical liquidations", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Three defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			// Check depositors' compounded deposit is 0 VUSD and ETH Gain is 99.5 ETH

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), "0"), 10000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), "0"), 10000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(carol)).toString(), "0"), 10000)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(99500, 5)), 10000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(99500, 5)), 10000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(99500, 5)), 10000)
		})

		// --- Identical deposits, increasing liquidation amounts ---
		it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct compounded deposit and ETH Gain after two liquidations of increasing VUSD", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				"50000000000000000000",
				await getOpenVesselVUSDAmount(dec(5000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"70000000000000000000",
				await getOpenVesselVUSDAmount(dec(7000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Check depositors' compounded deposit

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("6000000000000000000000")),
				20000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("6000000000000000000000")),
				20000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("6000000000000000000000")),
				20000
			)

			// (0.5 + 0.7) * 99.5 / 3

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(398, 7)), 10000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(398, 7)), 10000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(398, 7)), 10000)
		})

		it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct compounded deposit and ETH Gain after three liquidations of increasing VUSD", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				"50000000000000000000",
				await getOpenVesselVUSDAmount(dec(5000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"60000000000000000000",
				await getOpenVesselVUSDAmount(dec(6000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"70000000000000000000",
				await getOpenVesselVUSDAmount(dec(7000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Three defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			// Check depositors' compounded deposit

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("4000000000000000000000")),
				10000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("4000000000000000000000")),
				10000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("4000000000000000000000")),
				10000
			)

			// (0.5 + 0.6 + 0.7) * 99.5 / 3

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(597, 7)), 10000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(597, 7)), 10000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(597, 7)), 10000)
		})

		// --- Increasing deposits, identical liquidation amounts ---
		it("withdrawFromSP(): Depositors with varying deposits withdraw correct compounded deposit and ETH Gain after two identical liquidations", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k, 20k, 30k VUSD to A, B and C respectively who then deposit it to the SP
			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await debtToken.transfer(carol, dec(30000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
			await debtToken.transfer(carol, dec(30000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: carol })

			// 2 Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Three defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Depositors attempt to withdraw everything

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(20000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("6666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("13333333333333333333333")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("20000000000000000000000")),
				100000
			)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "3316666666"), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "6633333333"), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(995, 7)), 100000)
		})

		it("withdrawFromSP(): Depositors with varying deposits withdraw correct compounded deposit and ETH Gain after three identical liquidations", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k, 20k, 30k VUSD to A, B and C respectively who then deposit it to the SP
			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await debtToken.transfer(carol, dec(30000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
			await debtToken.transfer(carol, dec(30000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: carol })

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Three defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			// Depositors attempt to withdraw everything

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(20000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("5000000000000000000000")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("10000000000000000000000")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("15000000000000000000000")),
				100000
			)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "4975000000"), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "14925000000"), 100000)
		})

		// --- Varied deposits and varied liquidation amount ---
		it("withdrawFromSP(): Depositors with varying deposits withdraw correct compounded deposit and ETH Gain after three varying liquidations", async () => {
			// Whale opens Vessel with 1m ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(1000000, "ether"),
				await getOpenVesselVUSDAmount(dec(1000000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			/* Depositors provide:-
      Alice:  2000 VUSD
      Bob:  456000 VUSD
      Carol: 13100 VUSD */
			// Whale transfers VUSD to  A, B and C respectively who then deposit it to the SP
			await debtToken.transfer(alice, dec(2000, 18), { from: whale })
			await debtToken.transfer(bob, dec(456000, 18), { from: whale })
			await debtToken.transfer(carol, dec(13100, 18), { from: whale })

			await debtToken.transfer(alice, dec(2000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: alice })
			await debtToken.transfer(bob, dec(456000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(456000, 18), { from: bob })
			await debtToken.transfer(carol, dec(13100, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(13100, 18), { from: carol })

			/* Defaulters open vessels
     
      Defaulter 1: 207000 VUSD & 2160 ETH
      Defaulter 2: 5000 VUSD & 50 ETH
      Defaulter 3: 46700 VUSD & 500 ETH
      */

			await borrowerOperations.openVessel(
				erc20.address,
				dec(2160, 18),
				await getOpenVesselVUSDAmount("207000000000000000000000"),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(50, "ether"),
				await getOpenVesselVUSDAmount(dec(5, 21)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(500, "ether"),
				await getOpenVesselVUSDAmount("46700000000000000000000"),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Three defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			// Depositors attempt to withdraw everything

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(500000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(500000, 18), {
				from: bob,
			})
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(500000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// ()
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("901719380174061000000")),
				100000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("205592018679686000000000")),
				10000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("5906261940140100000000")),
				10000000000
			)

			// 2710 * 0.995 * {2000, 456000, 13100}/4711

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "1144746338"), 10000000000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "261002165145"), 10000000000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "7498088516"), 10000000000)
		})

		// --- Deposit enters at t > 0

		it("withdrawFromSP(): A, B, C Deposit -> 2 liquidations -> D deposits -> 1 liquidation. All deposits and liquidations = 100 VUSD.  A, B, C, D withdraw correct VUSD deposit and ETH Gain", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// First two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Whale transfers 10k to Dennis who then provides to SP
			await debtToken.transfer(dennis, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: dennis })

			// Third defaulter liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			console.log()
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("1666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("1666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("1666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("5000000000000000000000")),
				100000
			)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "8291666666"), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "8291666666"), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "8291666666"), 100000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "4975000000"), 100000)
		})

		it("withdrawFromSP(): A, B, C Deposit -> 2 liquidations -> D deposits -> 2 liquidations. All deposits and liquidations = 100 VUSD.  A, B, C, D withdraw correct VUSD deposit and ETH Gain", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// First two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Dennis opens a vessel and provides to SP
			await debtToken.transfer(dennis, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: dennis })

			// Third and fourth defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(carol)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(dennis)).toString(), "0"), 100000)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, dec(995, 7)), 100000)
		})

		it("withdrawFromSP(): A, B, C Deposit -> 2 liquidations -> D deposits -> 2 liquidations. Various deposit and liquidation vals.  A, B, C, D withdraw correct VUSD deposit and ETH Gain", async () => {
			// Whale opens Vessel with 1m ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(1000000, "ether"),
				await getOpenVesselVUSDAmount(dec(1000000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			/* Depositors open vessels and make SP deposit:
      Alice: 60000 VUSD
      Bob: 20000 VUSD
      Carol: 15000 VUSD
      */
			// Whale transfers VUSD to  A, B and C respectively who then deposit it to the SP
			await debtToken.transfer(alice, dec(60000, 18), { from: whale })
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await debtToken.transfer(carol, dec(15000, 18), { from: whale })

			await debtToken.transfer(alice, dec(60000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(60000, 18), { from: alice })
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
			await debtToken.transfer(carol, dec(15000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: carol })

			/* Defaulters open vessels:
      Defaulter 1:  10000 VUSD, 100 ETH
      Defaulter 2:  25000 VUSD, 250 ETH
      Defaulter 3:  5000 VUSD, 50 ETH
      Defaulter 4:  40000 VUSD, 400 ETH
      */

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"250000000000000000000",
				await getOpenVesselVUSDAmount(dec(25000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"50000000000000000000",
				await getOpenVesselVUSDAmount(dec(5000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(400, "ether"),
				await getOpenVesselVUSDAmount(dec(40000, 18)),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// First two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Dennis provides 25000 VUSD
			await debtToken.transfer(dennis, dec(25000, 18), { from: whale })

			await debtToken.transfer(dennis, dec(25000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(25000, 18), { from: dennis })

			// Last two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			// Each depositor withdraws as much as possible

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: bob,
			})
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: dennis,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("17832817337461300000000")),
				100000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("5944272445820430000000")),
				100000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("4458204334365320000000")),
				100000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("11764705882352900000000")),
				100000000000
			)

			// 3.5*0.995 * {60000,20000,15000,0} / 95000 + 450*0.995 * {60000/950*{60000,20000,15000},25000} / (120000-35000)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "41956346749"), 100000000000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "13985448916"), 100000000000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "10489086687"), 100000000000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "13169117647"), 100000000000)
		})

		// --- Depositor leaves ---

		it("withdrawFromSP(): A, B, C, D deposit -> 2 liquidations -> D withdraws -> 2 liquidations. All deposits and liquidations = 100 VUSD.  A, B, C, D withdraw correct VUSD deposit and ETH Gain", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and C who then deposit it to the SP
			const depositors = [alice, bob, carol, dennis]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// First two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Dennis withdraws his deposit and ETH gain
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("5000000000000000000000")),
				100000
			)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "4975000000"), 100000)

			// Two more defaulters are liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txA, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th.getEventArgByName(txB, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM).toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txC, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), "0"), 1000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), "0"), 1000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(carol)).toString(), "0"), 1000)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(995, 17)), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 17)), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(995, 17)), 100000)
		})

		it("withdrawFromSP(): A, B, C, D deposit -> 2 liquidations -> D withdraws -> 2 liquidations. Various deposit and liquidation vals. A, B, C, D withdraw correct VUSD deposit and ETH Gain", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			/* Initial deposits:
      Alice: 20000 VUSD
      Bob: 25000 VUSD
      Carol: 12500 VUSD
      Dennis: 40000 VUSD
      */
			// Whale transfers VUSD to  A, B,C and D respectively who then deposit it to the SP
			await debtToken.transfer(alice, dec(20000, 18), { from: whale })
			await debtToken.transfer(bob, dec(25000, 18), { from: whale })
			await debtToken.transfer(carol, dec(12500, 18), { from: whale })
			await debtToken.transfer(dennis, dec(40000, 18), { from: whale })

			await debtToken.transfer(alice, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: alice })
			await debtToken.transfer(bob, dec(25000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(25000, 18), { from: bob })
			await debtToken.transfer(carol, dec(12500, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(12500, 18), { from: carol })
			await debtToken.transfer(dennis, dec(40000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(40000, 18), { from: dennis })

			/* Defaulters open vessels:
      Defaulter 1: 10000 VUSD
      Defaulter 2: 20000 VUSD
      Defaulter 3: 30000 VUSD
      Defaulter 4: 5000 VUSD
      */

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(300, "ether"),
				await getOpenVesselVUSDAmount(dec(30000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"50000000000000000000",
				await getOpenVesselVUSDAmount(dec(5000, 18)),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// First two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Dennis withdraws his deposit and ETH gain
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(40000, 18), {
				from: dennis,
			})
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("27692307692307700000000")),
				100000000000
			)
			// 300*0.995 * 40000/97500
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "12246153846"), 100000000000)

			// Two more defaulters are liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: bob,
			})
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txA, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th.getEventArgByName(txB, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM).toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txC, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("1672240802675590000000")),
				10000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("2090301003344480000000")),
				100000000000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("1045150501672240000000")),
				100000000000
			)

			// 300*0.995 * {20000,25000,12500}/97500 + 350*0.995 * {20000,25000,12500}/57500

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "182361204013377919900"), 100000000000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "227951505016722411000"), 100000000000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "113975752508361205500"), 100000000000)
		})

		// --- One deposit enters at t > 0, and another leaves later ---
		it("withdrawFromSP(): A, B, D deposit -> 2 liquidations -> C makes deposit -> 1 liquidation -> D withdraws -> 1 liquidation. All deposits: 100 VUSD. Liquidations: 100,100,100,50.  A, B, C, D withdraw correct VUSD deposit and ETH Gain", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B and D who then deposit it to the SP
			const depositors = [alice, bob, dennis]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulters open vessels

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				"50000000000000000000",
				await getOpenVesselVUSDAmount(dec(5000, 18)),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// First two defaulters liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Carol makes deposit
			await debtToken.transfer(carol, dec(10000, 18), { from: whale })

			await debtToken.transfer(carol, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: carol })

			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			// Dennis withdraws his deposit and ETH gain
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("1666666666666666666666")),
				100000
			)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "8291666666"), 100000)

			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(alice)).toString(), toBN("666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("2000000000000000000000")),
				100000
			)

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, "9286666666"), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "9286666666"), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "7960000000"), 100000)
		})

		// --- Tests for full offset - Pool empties to 0 ---

		// A, B deposit 10000
		// L1 cancels 20000, 200
		// C, D deposit 10000
		// L2 cancels 10000,100

		// A, B withdraw 0VUSD & 100e
		// C, D withdraw 5000VUSD  & 500e
		it("withdrawFromSP(): Depositor withdraws correct compounded deposit after liquidation empties the pool", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B who then deposit it to the SP
			const depositors = [alice, bob]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// 2 Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1 liquidated. 20000 VUSD fully offset with pool.
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			// Carol, Dennis each deposit 10000 VUSD
			const depositors_2 = [carol, dennis]
			for (account of depositors_2) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter 2 liquidated. 10000 VUSD offset
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// Expect Alice And Bob's compounded deposit to be 0 VUSD
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), "0"), 10000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), "0"), 10000)

			// Expect Alice and Bob's ETH Gain to be 100 ETH

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 7)), 100000)

			// Expect Carol And Dennis' compounded deposit to be 50 VUSD
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("5000000000000000000000")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("5000000000000000000000")),
				100000
			)

			// Expect Carol and and Dennis ETH Gain to be 50 ETH

			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "4975000000"), 100000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "4975000000"), 100000)
		})

		// A, B deposit 10000
		// L1 cancels 10000, 1
		// L2 10000, 200 empties Pool
		// C, D deposit 10000
		// L3 cancels 10000, 1
		// L2 20000, 200 empties Pool
		it("withdrawFromSP(): Pool-emptying liquidation increases epoch by one, resets scaleFactor to 0, and resets P to 1e18", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B who then deposit it to the SP
			const depositors = [alice, bob]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// 4 Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			const epoch_0 = (await stabilityPool.currentEpoch()).toString()
			const scale_0 = (await stabilityPool.currentScale()).toString()
			const P_0 = (await stabilityPool.P()).toString()

			const epoch_0ERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
			const scale_0ERC20 = (await stabilityPoolERC20.currentScale()).toString()
			const P_0ERC20 = (await stabilityPoolERC20.P()).toString()

			assert.equal(epoch_0, "0")
			assert.equal(scale_0, "0")
			assert.equal(P_0, dec(1, 18))

			assert.equal(epoch_0ERC20, "0")
			assert.equal(scale_0ERC20, "0")
			assert.equal(P_0ERC20, dec(1, 18))

			// Defaulter 1 liquidated. 10--0 VUSD fully offset, Pool remains non-zero
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			//Check epoch, scale and sum
			const epoch_1 = (await stabilityPool.currentEpoch()).toString()
			const scale_1 = (await stabilityPool.currentScale()).toString()
			const P_1 = (await stabilityPool.P()).toString()

			const epoch_1ERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
			const scale_1ERC20 = (await stabilityPoolERC20.currentScale()).toString()
			const P_1ERC20 = (await stabilityPoolERC20.P()).toString()

			assert.equal(epoch_1, "0")
			assert.equal(scale_1, "0")
			assert.isAtMost(th.getDifference(P_1, dec(5, 17)), 1000)

			assert.equal(epoch_1ERC20, "0")
			assert.equal(scale_1ERC20, "0")
			assert.isAtMost(th.getDifference(P_1ERC20, dec(5, 17)), 1000)

			// Defaulter 2 liquidated. 1--00 VUSD, empties pool
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			//Check epoch, scale and sum
			const epoch_2 = (await stabilityPool.currentEpoch()).toString()
			const scale_2 = (await stabilityPool.currentScale()).toString()
			const P_2 = (await stabilityPool.P()).toString()

			const epoch_2ERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
			const scale_2ERC20 = (await stabilityPoolERC20.currentScale()).toString()
			const P_2ERC20 = (await stabilityPoolERC20.P()).toString()

			assert.equal(epoch_2, "1")
			assert.equal(scale_2, "0")
			assert.equal(P_2, dec(1, 18))

			assert.equal(epoch_2ERC20, "1")
			assert.equal(scale_2ERC20, "0")
			assert.equal(P_2ERC20, dec(1, 18))

			// Carol, Dennis each deposit 10000 VUSD
			const depositors_2 = [carol, dennis]
			for (account of depositors_2) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter 3 liquidated. 10000 VUSD fully offset, Pool remains non-zero
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			//Check epoch, scale and sum
			const epoch_3 = (await stabilityPool.currentEpoch()).toString()
			const scale_3 = (await stabilityPool.currentScale()).toString()
			const P_3 = (await stabilityPool.P()).toString()

			const epoch_3ERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
			const scale_3ERC20 = (await stabilityPoolERC20.currentScale()).toString()
			const P_3ERC20 = (await stabilityPoolERC20.P()).toString()

			assert.equal(epoch_3, "1")
			assert.equal(scale_3, "0")
			assert.isAtMost(th.getDifference(P_3, dec(5, 17)), 1000)

			assert.equal(epoch_3ERC20, "1")
			assert.equal(scale_3ERC20, "0")
			assert.isAtMost(th.getDifference(P_3ERC20, dec(5, 17)), 1000)

			// Defaulter 4 liquidated. 10000 VUSD, empties pool
			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			//Check epoch, scale and sum
			const epoch_4 = (await stabilityPool.currentEpoch()).toString()
			const scale_4 = (await stabilityPool.currentScale()).toString()
			const P_4 = (await stabilityPool.P()).toString()

			const epoch_4ERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
			const scale_4ERC20 = (await stabilityPoolERC20.currentScale()).toString()
			const P_4ERC20 = (await stabilityPoolERC20.P()).toString()

			assert.equal(epoch_4, "2")
			assert.equal(scale_4, "0")
			assert.equal(P_4, dec(1, 18))

			assert.equal(epoch_4ERC20, "2")
			assert.equal(scale_4ERC20, "0")
			assert.equal(P_4ERC20, dec(1, 18))
		})

		// A, B deposit 10000
		// L1 cancels 20000, 200
		// C, D, E deposit 10000, 20000, 30000
		// L2 cancels 10000,100

		// A, B withdraw 0 VUSD & 100e
		// C, D withdraw 5000 VUSD  & 50e
		it("withdrawFromSP(): Depositors withdraw correct compounded deposit after liquidation empties the pool", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18, erc20.address)),
				whale,
				whale,
				{ from: whale }
			)

			// Whale transfers 10k VUSD to A, B who then deposit it to the SP
			const depositors = [alice, bob]
			for (account of depositors) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// 2 Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1 liquidated. 20000 VUSD fully offset with pool.
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			// Carol, Dennis, Erin each deposit 10000, 20000, 30000 VUSD respectively
			await debtToken.transfer(carol, dec(10000, 18), { from: whale })
			await debtToken.transfer(dennis, dec(20000, 18), { from: whale })
			await debtToken.transfer(erin, dec(30000, 18), { from: whale })

			await debtToken.transfer(carol, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: carol })
			await debtToken.transfer(dennis, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: dennis })
			await debtToken.transfer(erin, dec(30000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: erin })

			// Defaulter 2 liquidated. 10000 VUSD offset
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(20000, 18), {
				from: dennis,
			})
			const txEERC20 = await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), {
				from: erin,
			})

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const erin_ETHWithdrawnERC20 = th
				.getEventArgByName(txEERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// Expect Alice And Bob's compounded deposit to be 0 VUSD
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), "0"), 10000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), "0"), 10000)

			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN("8333333333333333333333")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN("16666666666666666666666")),
				100000
			)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(erin)).toString(), toBN("25000000000000000000000")),
				100000
			)

			//Expect Alice and Bob's ETH Gain to be 1 ETH

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "1658333333"), 100000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "3316666666"), 100000)
			assert.isAtMost(th.getDifference(erin_ETHWithdrawnERC20, "4975000000"), 100000)
		})

		// A deposits 10000
		// L1, L2, L3 liquidated with 10000 VUSD each
		// A withdraws all
		// Expect A to withdraw 0 deposit and ether only from reward L1
		it("withdrawFromSP(): single deposit fully offset. After subsequent liquidations, depositor withdraws 0 deposit and *only* the ETH Gain from one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1,2,3 withdraw 10000 VUSD

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(10000, 18), erc20.address),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1, 2  and 3 liquidated

			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})

			// Grab the ETH gain from the emitted event in the tx log
			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), 0), 100000)
			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(995, 7)), 100000)
		})

		//--- Serial full offsets ---

		// A,B deposit 10000 VUSD
		// L1 cancels 20000 VUSD, 2E
		// B,C deposits 10000 VUSD
		// L2 cancels 20000 VUSD, 2E
		// E,F deposit 10000 VUSD
		// L3 cancels 20000, 200E
		// G,H deposits 10000
		// L4 cancels 20000, 200E

		// Expect all depositors withdraw 0 VUSD and 100 ETH

		it("withdrawFromSP(): Depositor withdraws correct compounded deposit after liquidation empties the pool", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// 4 Defaulters open vessel with 200% ICR

			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18), erc20.address),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(20000, 18), erc20.address),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%: defaulter ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Alice, Bob each deposit 10k VUSD
			const depositors_1 = [alice, bob]
			for (account of depositors_1) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter 1 liquidated. 20k VUSD fully offset with pool.
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			// Carol, Dennis each deposit 10000 VUSD
			const depositors_2 = [carol, dennis]
			for (account of depositors_2) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter 2 liquidated. 10000 VUSD offset
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			// Erin, Flyn each deposit 10000 VUSD
			const depositors_3 = [erin, flyn]
			for (account of depositors_3) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter 3 liquidated. 10000 VUSD offset
			await vesselManagerOperations.liquidate(erc20.address, defaulter_3, { from: owner })

			// Graham, Harriet each deposit 10000 VUSD
			const depositors_4 = [graham, harriet]
			for (account of depositors_4) {
				await debtToken.transfer(account, dec(20000, 18), { from: whale })
				await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
			}

			// Defaulter 4 liquidated. 10k VUSD offset
			await vesselManagerOperations.liquidate(erc20.address, defaulter_4, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})
			const txEERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: erin,
			})
			const txFERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: flyn,
			})
			const txGERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: graham,
			})
			const txHERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: harriet,
			})

			const alice_ETHWithdrawnERC20 = th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const erin_ETHWithdrawnERC20 = th
				.getEventArgByName(txEERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const flyn_ETHWithdrawnERC20 = th
				.getEventArgByName(txFERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const graham_ETHWithdrawnERC20 = th
				.getEventArgByName(txGERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const harriet_ETHWithdrawnERC20 = th
				.getEventArgByName(txHERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// Expect all deposits to be 0 VUSD
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(alice)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(carol)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(dennis)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(erin)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(flyn)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(graham)).toString(), "0"), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(harriet)).toString(), "0"), 100000)

			/* Expect all ETH gains to be 100 ETH:  Since each liquidation of empties the pool, depositors
      should only earn ETH from the single liquidation that cancelled with their deposit */

			assert.isAtMost(th.getDifference(alice_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(erin_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(flyn_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(graham_ETHWithdrawnERC20, dec(995, 7)), 100000)
			assert.isAtMost(th.getDifference(harriet_ETHWithdrawnERC20, dec(995, 7)), 100000)

			const finalEpoch = (await stabilityPool.currentEpoch()).toString()
			const finalEpochERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
			assert.equal(finalEpoch, 4)
			assert.equal(finalEpochERC20, 4)
		})

		// --- Scale factor tests ---

		// A deposits 10000
		// L1 brings P close to boundary, i.e. 9e-9: liquidate 9999.99991
		// A withdraws all
		// B deposits 10000
		// L2 of 9900 VUSD, should bring P slightly past boundary i.e. 1e-9 -> 1e-10

		// expect d(B) = d0(B)/100
		// expect correct ETH gain, i.e. all of the reward
		it("withdrawFromSP(): deposit spans one scale factor change: Single depositor withdraws correct compounded deposit and ETH Gain after one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			await debtToken.transfer(alice, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 withdraws 'almost' 10000 VUSD:  9999.99991 VUSD
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999999910000000000000", erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPoolERC20.currentScale(), "0")

			// Defaulter 2 withdraws 9900 VUSD
			await borrowerOperations.openVessel(
				erc20.address,
				dec(60, "ether"),
				await getOpenVesselVUSDAmount(dec(9900, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1 liquidated.  Value of P reduced to 9e9.
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			assert.equal((await stabilityPool.P()).toString(), dec(9, 9))
			assert.equal((await stabilityPoolERC20.P()).toString(), dec(9, 9))

			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice })
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: bob })

			// Defaulter 2 liquidated.  9900 VUSD liquidated. P altered by a factor of 1-(9900/10000) = 0.01.  Scale changed.
			await vesselManagerOperations.liquidate(erc20.address, defaulter_2, { from: owner })

			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const bob_ETHWithdrawnERC20 = await th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// Expect Bob to withdraw 1% of initial deposit (100 VUSD) and all the liquidated ETH (60 ether)
			assert.isAtMost(
				th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN("100000000000000000000")),
				100000
			)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "5970000000"), 100000)
		})

		// A deposits 10000
		// L1 brings P close to boundary, i.e. 9e-9: liquidate 9999.99991 VUSD
		// A withdraws all
		// B, C, D deposit 10000, 20000, 30000
		// L2 of 59400, should bring P slightly past boundary i.e. 1e-9 -> 1e-10

		// expect d(B) = d0(B)/100
		// expect correct ETH gain, i.e. all of the reward
		it("withdrawFromSP(): Several deposits of varying amounts span one scale factor change. Depositors withdraw correct compounded deposit and ETH Gain after one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			await debtToken.transfer(alice, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 withdraws 'almost' 10k VUSD.
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999999910000000000000", erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// Defaulter 2 withdraws 59400 VUSD
			await borrowerOperations.openVessel(
				erc20.address,
				dec(330, "ether"),
				await getOpenVesselVUSDAmount("59400000000000000000000", erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1 liquidated.  Value of P reduced to 9e9
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			assert.equal((await stabilityPool.P()).toString(), dec(9, 9))
			assert.equal(await stabilityPool.currentScale(), "0")

			assert.equal((await stabilityPoolERC20.P()).toString(), dec(9, 9))
			assert.equal(await stabilityPoolERC20.currentScale(), "0")

			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice })
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			//B, C, D deposit to Stability Pool
			await debtToken.transfer(bob, dec(10000, 18), { from: whale })
			await debtToken.transfer(carol, dec(20000, 18), { from: whale })
			await debtToken.transfer(dennis, dec(30000, 18), { from: whale })

			await debtToken.transfer(bob, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: bob })
			await debtToken.transfer(carol, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: carol })
			await debtToken.transfer(dennis, dec(30000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: dennis })

			// 54000 VUSD liquidated.  P altered by a factor of 1-(59400/60000) = 0.01. Scale changed.
			assert.isTrue(txL2.receipt.status)
			const txL2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})
			assert.isTrue(txL2ERC20.receipt.status)

			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(20000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), {
				from: dennis,
			})

			/* Expect depositors to withdraw 1% of their initial deposit, and an ETH gain 
      in proportion to their initial deposit:
     
      Bob:  1000 VUSD, 55 Ether
      Carol:  2000 VUSD, 110 Ether
      Dennis:  3000 VUSD, 165 Ether
     
      Total: 6000 VUSD, 300 Ether
      */
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN(dec(100, 18))), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(carol)).toString(), toBN(dec(200, 18))), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN(dec(300, 18))), 100000)

			const bob_ETHWithdrawnERC20 = await th
				.getEventArgByName(txB, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = await th
				.getEventArgByName(txC, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = await th
				.getEventArgByName(txD, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, "54725000000000000000"), 100000)
			assert.isAtMost(th.getDifference(carol_ETHWithdrawnERC20, "109450000000000000000"), 100000)
			assert.isAtMost(th.getDifference(dennis_ETHWithdrawnERC20, "164175000000000000000"), 100000)
		})

		// Deposit's ETH reward spans one scale change - deposit reduced by correct amount

		// A make deposit 10000 VUSD
		// L1 brings P to 1e-5*P. L1:  9999.9000000000000000 VUSD
		// A withdraws
		// B makes deposit 10000 VUSD
		// L2 decreases P again by 1e-5, over the scale boundary: 9999.9000000000000000 (near to the 10000 VUSD total deposits)
		// B withdraws
		// expect d(B) = d0(B) * 1e-5
		// expect B gets entire ETH gain from L2
		it("withdrawFromSP(): deposit spans one scale factor change: Single depositor withdraws correct compounded deposit and ETH Gain after one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			await debtToken.transfer(alice, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 and default 2 each withdraw 9999.999999999 VUSD

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%: defaulter 1 ICR falls to 100%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1 liquidated.  Value of P updated to  to 1e13
			const txL1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			assert.isTrue(txL1.receipt.status)
			assert.isTrue(txL1ERC20.receipt.status)
			assert.equal(await stabilityPool.P(), dec(1, 13)) // P decreases. P = 1e(18-5) = 1e13
			assert.equal(await stabilityPool.currentScale(), "0")

			assert.equal(await stabilityPoolERC20.P(), dec(1, 13)) // P decreases. P = 1e(18-5) = 1e13
			assert.equal(await stabilityPoolERC20.currentScale(), "0")

			// Alice withdraws
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice })
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Bob deposits 10k VUSD
			await debtToken.transfer(bob, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: bob })

			// Defaulter 2 liquidated
			assert.isTrue(txL2.receipt.status)

			const txL2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})
			assert.isTrue(txL2ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 17)) // Scale changes and P changes. P = 1e(13-5+9) = 1e17
			assert.equal(await stabilityPool.currentScale(), "1")

			assert.equal(await stabilityPoolERC20.P(), dec(1, 17)) // Scale changes and P changes. P = 1e(13-5+9) = 1e17
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const bob_ETHWithdrawnERC20 = await th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// Bob should withdraw 1e-5 of initial deposit: 0.1 VUSD and the full ETH gain of 100 ether
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), toBN(dec(1, 17))), 100000)
			assert.isAtMost(th.getDifference(bob_ETHWithdrawnERC20, dec(995, 7)), 100000000000)
		})

		// A make deposit 10000 VUSD
		// L1 brings P to 1e-5*P. L1:  9999.9000000000000000 VUSD
		// A withdraws
		// B,C D make deposit 10000, 20000, 30000
		// L2 decreases P again by 1e-5, over boundary. L2: 59999.4000000000000000  (near to the 60000 VUSD total deposits)
		// B withdraws
		// expect d(B) = d0(B) * 1e-5
		// expect B gets entire ETH gain from L2
		it("withdrawFromSP(): Several deposits of varying amounts span one scale factor change. Depositors withdraws correct compounded deposit and ETH Gain after one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 and default 2 withdraw up to debt of 9999.9 VUSD and 59999.4 VUSD

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999900000000000000000"),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(600, "ether"),
				await getOpenVesselVUSDAmount("59999400000000000000000", erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// Defaulter 1 liquidated.  Value of P updated to  to 9999999, i.e. in decimal, ~1e-10
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })
			assert.equal(await stabilityPool.P(), dec(1, 13)) // P decreases. P = 1e(18-5) = 1e13
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 13)) // P decreases. P = 1e(18-5) = 1e13
			assert.equal(await stabilityPoolERC20.currentScale(), "0")

			// Alice withdraws
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			await stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: alice })
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// B, C, D deposit 10000, 20000, 30000 VUSD
			await debtToken.transfer(bob, dec(10000, 18), { from: whale })
			await debtToken.transfer(carol, dec(20000, 18), { from: whale })
			await debtToken.transfer(dennis, dec(30000, 18), { from: whale })

			await debtToken.transfer(bob, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: bob })
			await debtToken.transfer(carol, dec(20000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: carol })
			await debtToken.transfer(dennis, dec(30000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: dennis })

			// Defaulter 2 liquidated
			assert.isTrue(txL2.receipt.status)

			const txL2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})
			assert.isTrue(txL2ERC20.receipt.status)
			assert.equal(await stabilityPool.P(), dec(1, 17)) // P decreases. P = 1e(13-5+9) = 1e17
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 17)) // P decreases. P = 1e(13-5+9) = 1e17
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			// {B, C, D} should have a compounded deposit of {0.1, 0.2, 0.3} VUSD
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(bob)).toString(), dec(1, 17)), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(carol)).toString(), dec(2, 17)), 100000)
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(dennis)).toString(), dec(3, 17)), 100000)
		})

		// A make deposit 10000 VUSD
		// L1 brings P to (~1e-10)*P. L1: 9999.9999999000000000 VUSD
		// Expect A to withdraw 0 deposit
		it("withdrawFromSP(): Deposit that decreases to less than 1e-9 of it's original value is reduced to 0", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// Defaulters 1 withdraws 9999.9999999 VUSD
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999999999900000000000", erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// Price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 liquidated. P -> (~1e-10)*P
			assert.isTrue(txL1.receipt.status)

			const txL1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			assert.isTrue(txL1ERC20.receipt.status)

			const aliceDeposit = (await stabilityPool.getCompoundedDebtTokenDeposits(alice)).toString()
			const aliceDepositERC20 = (await stabilityPoolERC20.getCompoundedDebtTokenDeposits(alice)).toString()
			console.log(`alice deposit: ${aliceDeposit}`)
			assert.equal(aliceDeposit, 0)
			assert.equal(aliceDepositERC20, 0)
		})

		// --- Serial scale changes ---

		/* A make deposit 10000 VUSD
    L1 brings P to 0.0001P. L1:  9999.900000000000000000 VUSD, 1 ETH
    B makes deposit 9999.9, brings SP to 10k
    L2 decreases P by(~1e-5)P. L2:  9999.900000000000000000 VUSD, 1 ETH
    C makes deposit 9999.9, brings SP to 10k
    L3 decreases P by(~1e-5)P. L3:  9999.900000000000000000 VUSD, 1 ETH
    D makes deposit 9999.9, brings SP to 10k
    L4 decreases P by(~1e-5)P. L4:  9999.900000000000000000 VUSD, 1 ETH
    expect A, B, C, D each withdraw ~100 Ether
    */
		it("withdrawFromSP(): Several deposits of 10000 VUSD span one scale factor change. Depositors withdraws correct compounded deposit and ETH Gain after one liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// Defaulters 1-4 each withdraw 9999.9 VUSD

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999900000000000000000", erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999900000000000000000", erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999900000000000000000", erc20.address),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount("9999900000000000000000", erc20.address),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 liquidated.
			assert.isTrue(txL1.receipt.status)

			const txL1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			assert.isTrue(txL1ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 13)) // P decreases to 1e(18-5) = 1e13
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 13)) // P decreases to 1e(18-5) = 1e13
			assert.equal(await stabilityPoolERC20.currentScale(), "0")

			// B deposits 9999.9 VUSD
			await debtToken.transfer(bob, dec(99999, 17), { from: whale })

			await debtToken.transfer(bob, dec(99999, 17), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: bob })

			// Defaulter 2 liquidated
			assert.isTrue(txL2.receipt.status)

			const txL2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})
			assert.isTrue(txL2ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 17)) // Scale changes and P changes to 1e(13-5+9) = 1e17
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 17)) // Scale changes and P changes to 1e(13-5+9) = 1e17
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			// C deposits 9999.9 VUSD
			await debtToken.transfer(carol, dec(99999, 17), { from: whale })

			await debtToken.transfer(carol, dec(99999, 17), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: carol })

			// Defaulter 3 liquidated
			assert.isTrue(txL3.receipt.status)

			const txL3ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_3, {
				from: owner,
			})
			assert.isTrue(txL3ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 12)) // P decreases to 1e(17-5) = 1e12
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 12)) // P decreases to 1e(17-5) = 1e12
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			// D deposits 9999.9 VUSD
			await debtToken.transfer(dennis, toBN(dec(99999, 17)), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: dennis })

			// Defaulter 4 liquidated
			assert.isTrue(txL4.receipt.status)

			const txL4ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_4, {
				from: owner,
			})
			assert.isTrue(txL4ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 16)) // Scale changes and P changes to 1e(12-5+9) = 1e16
			assert.equal(await stabilityPool.currentScale(), "2")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 16)) // Scale changes and P changes to 1e(12-5+9) = 1e16
			assert.equal(await stabilityPoolERC20.currentScale(), "2")

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: alice,
			})
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: carol,
			})
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), {
				from: dennis,
			})

			const alice_ETHWithdrawnERC20 = await th
				.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const bob_ETHWithdrawnERC20 = await th
				.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const carol_ETHWithdrawnERC20 = await th
				.getEventArgByName(txCERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()
			const dennis_ETHWithdrawnERC20 = await th
				.getEventArgByName(txDERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
				.toString()

			// A, B, C should withdraw 0 - their deposits have been completely used up
			assert.equal(await debtToken.balanceOf(alice), "0")
			assert.equal(await debtToken.balanceOf(alice), "0")
			assert.equal(await debtToken.balanceOf(alice), "0")
			// D should withdraw around 0.9999 VUSD, since his deposit of 9999.9 was reduced by a factor of 1e-5
			assert.isAtMost(th.getDifference((await debtToken.balanceOf(dennis)).toString(), toBN(dec(99999, 12))), 100000)

			// 99.5 ETH is offset at each L, 0.5 goes to gas comp
			// Each depositor gets ETH rewards of around 99.5 ETH - 1e17 error tolerance
			assert.isTrue(
				toBN(alice_ETHWithdrawn)
					.sub(toBN(dec(995, 17)))
					.abs()
					.lte(toBN(dec(1, 17)))
			)
			assert.isTrue(
				toBN(bob_ETHWithdrawn)
					.sub(toBN(dec(995, 17)))
					.abs()
					.lte(toBN(dec(1, 17)))
			)
			assert.isTrue(
				toBN(carol_ETHWithdrawn)
					.sub(toBN(dec(995, 17)))
					.abs()
					.lte(toBN(dec(1, 17)))
			)
			assert.isTrue(
				toBN(dennis_ETHWithdrawn)
					.sub(toBN(dec(995, 17)))
					.abs()
					.lte(toBN(dec(1, 17)))
			)

			assert.isTrue(
				toBN(alice_ETHWithdrawnERC20)
					.sub(toBN(dec(995, 7)))
					.abs()
					.lte(toBN(dec(1, 7)))
			)
			assert.isTrue(
				toBN(bob_ETHWithdrawnERC20)
					.sub(toBN(dec(995, 7)))
					.abs()
					.lte(toBN(dec(1, 7)))
			)
			assert.isTrue(
				toBN(carol_ETHWithdrawnERC20)
					.sub(toBN(dec(995, 7)))
					.abs()
					.lte(toBN(dec(1, 7)))
			)
			assert.isTrue(
				toBN(dennis_ETHWithdrawnERC20)
					.sub(toBN(dec(995, 7)))
					.abs()
					.lte(toBN(dec(1, 7)))
			)
		})

		it("withdrawFromSP(): 2 depositors can withdraw after each receiving half of a pool-emptying liquidation", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// Defaulters 1-3 each withdraw 24100, 24300, 24500 VUSD (inc gas comp)

			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(24100, 18), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(24300, 18), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(200, "ether"),
				await getOpenVesselVUSDAmount(dec(24500, 18), erc20.address),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			// A, B provide 10k VUSD
			await debtToken.transfer(A, dec(10000, 18), { from: whale })
			await debtToken.transfer(B, dec(10000, 18), { from: whale })

			await debtToken.transfer(A, dec(10000, 18), { from: whale })
			await debtToken.transfer(B, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: B })

			// Defaulter 1 liquidated. SP emptied
			assert.isTrue(txL1.receipt.status)

			const txL1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			assert.isTrue(txL1ERC20.receipt.status)

			// Check compounded deposits
			const A_deposit = await stabilityPool.getCompoundedDebtTokenDeposits(A)
			const B_deposit = await stabilityPool.getCompoundedDebtTokenDeposits(B)

			const A_depositERC20 = await stabilityPoolERC20.getCompoundedDebtTokenDeposits(A)
			const B_depositERC20 = await stabilityPoolERC20.getCompoundedDebtTokenDeposits(B)
			// console.log(`A_deposit: ${A_deposit}`)
			// console.log(`B_deposit: ${B_deposit}`)
			assert.equal(A_deposit, "0")
			assert.equal(B_deposit, "0")
			assert.equal(A_depositERC20, "0")
			assert.equal(B_depositERC20, "0")

			// Check SP tracker is zero
			const VUSDinSP_1 = await stabilityPool.getTotalDebtTokenDeposits()
			assert.equal(VUSDinSP_1, "0")

			const VUSDinSP_1ERC20 = await stabilityPoolERC20.getTotalDebtTokenDeposits()
			assert.equal(VUSDinSP_1ERC20, "0")

			// Check SP VUSD balance is zero
			const SPVUSDBalance_1 = await debtToken.balanceOf(stabilityPool.address)
			assert.equal(SPVUSDBalance_1, "0")

			// Attempt withdrawals
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: A })
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: B })
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			assert.isTrue(txA.receipt.status)
			assert.isTrue(txB.receipt.status)
			assert.isTrue(txAERC20.receipt.status)
			assert.isTrue(txBERC20.receipt.status)

			// ==========

			// C, D provide 10k VUSD
			await debtToken.transfer(C, dec(10000, 18), { from: whale })
			await debtToken.transfer(D, dec(10000, 18), { from: whale })

			await debtToken.transfer(C, dec(10000, 18), { from: whale })
			await debtToken.transfer(D, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: C })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: D })

			// Defaulter 2 liquidated.  SP emptied
			assert.isTrue(txL2.receipt.status)

			const txL2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})
			assert.isTrue(txL2ERC20.receipt.status)

			// Check compounded deposits
			const C_deposit = await stabilityPool.getCompoundedDebtTokenDeposits(C)
			const D_deposit = await stabilityPool.getCompoundedDebtTokenDeposits(D)
			assert.equal(C_deposit, "0")
			assert.equal(D_deposit, "0")

			const C_depositERC20 = await stabilityPoolERC20.getCompoundedDebtTokenDeposits(C)
			const D_depositERC20 = await stabilityPoolERC20.getCompoundedDebtTokenDeposits(D)
			assert.equal(C_depositERC20, "0")
			assert.equal(D_depositERC20, "0")

			// Check SP tracker is zero
			const VUSDinSP_2 = await stabilityPool.getTotalDebtTokenDeposits()
			assert.equal(VUSDinSP_2, "0")

			const VUSDinSP_2ERC20 = await stabilityPoolERC20.getTotalDebtTokenDeposits()
			assert.equal(VUSDinSP_2ERC20, "0")

			// Check SP VUSD balance is zero
			const SPVUSDBalance_2 = await debtToken.balanceOf(stabilityPool.address)
			assert.equal(SPVUSDBalance_2, "0")

			// Attempt withdrawals
			// Increasing the price for a moment to avoid pending liquidations to block withdrawal
			await priceFeed.setPrice(erc20.address, dec(200, 18))
			const txCERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: C })
			const txDERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: D })
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			assert.isTrue(txC.receipt.status)
			assert.isTrue(txD.receipt.status)

			assert.isTrue(txCERC20.receipt.status)
			assert.isTrue(txDERC20.receipt.status)

			// ============

			// E, F provide 10k VUSD
			await debtToken.transfer(E, dec(10000, 18), { from: whale })
			await debtToken.transfer(F, dec(10000, 18), { from: whale })

			await debtToken.transfer(E, dec(10000, 18), { from: whale })
			await debtToken.transfer(F, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: E })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: F })

			// Defaulter 3 liquidated. SP emptied
			assert.isTrue(txL3.receipt.status)

			const txL3ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_3, {
				from: owner,
			})
			assert.isTrue(txL3ERC20.receipt.status)

			// Check compounded deposits
			const E_deposit = await stabilityPool.getCompoundedDebtTokenDeposits(E)
			const F_deposit = await stabilityPool.getCompoundedDebtTokenDeposits(F)
			assert.equal(E_deposit, "0")
			assert.equal(F_deposit, "0")

			const E_depositERC20 = await stabilityPoolERC20.getCompoundedDebtTokenDeposits(E)
			const F_depositERC20 = await stabilityPoolERC20.getCompoundedDebtTokenDeposits(F)
			assert.equal(E_depositERC20, "0")
			assert.equal(F_depositERC20, "0")

			// Check SP tracker is zero
			const VUSDinSP_3 = await stabilityPool.getTotalDebtTokenDeposits()
			assert.equal(VUSDinSP_3, "0")

			const VUSDinSP_3ERC20 = await stabilityPoolERC20.getTotalDebtTokenDeposits()
			assert.equal(VUSDinSP_3ERC20, "0")

			// Check SP VUSD balance is zero
			const SPVUSDBalance_3 = await debtToken.balanceOf(stabilityPool.address)
			assert.equal(SPVUSDBalance_3, "0")

			const SPVUSDBalance_3ERC20 = await debtToken.balanceOf(stabilityPoolERC20.address)
			assert.equal(SPVUSDBalance_3ERC20, "0")

			// Attempt withdrawals
			assert.isTrue(txE.receipt.status)
			assert.isTrue(txF.receipt.status)

			const txEERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: E })
			const txFERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: F })
			assert.isTrue(txEERC20.receipt.status)
			assert.isTrue(txFERC20.receipt.status)
		})

		it("withdrawFromSP(): Depositor's ETH gain stops increasing after two scale changes", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// Defaulters 1-5 each withdraw up to debt of 9999.9999999 VUSD

			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_2,
				defaulter_2,
				{ from: defaulter_2 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_3,
				defaulter_3,
				{ from: defaulter_3 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_4,
				defaulter_4,
				{ from: defaulter_4 }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				await getOpenVesselVUSDAmount(dec(99999, 17), erc20.address),
				defaulter_5,
				defaulter_5,
				{ from: defaulter_5 }
			)

			// price drops by 50%
			await priceFeed.setPrice(erc20.address, dec(100, 18))

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })

			await debtToken.transfer(alice, dec(10000, 18), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

			// Defaulter 1 liquidated.
			assert.isTrue(txL1.receipt.status)
			const txL1ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_1, {
				from: owner,
			})
			assert.isTrue(txL1ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 13)) // P decreases to 1e(18-5) = 1e13
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 13)) // P decreases to 1e(18-5) = 1e13
			assert.equal(await stabilityPoolERC20.currentScale(), "0")

			// B deposits 9999.9 VUSD
			await debtToken.transfer(bob, dec(99999, 17), { from: whale })

			await debtToken.transfer(bob, dec(99999, 17), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: bob })

			// Defaulter 2 liquidated
			assert.isTrue(txL2.receipt.status)

			const txL2ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_2, {
				from: owner,
			})
			assert.isTrue(txL2ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 17)) // Scale changes and P changes to 1e(13-5+9) = 1e17
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 17)) // Scale changes and P changes to 1e(13-5+9) = 1e17
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			// C deposits 9999.9 VUSD
			await debtToken.transfer(carol, dec(99999, 17), { from: whale })

			await debtToken.transfer(carol, dec(99999, 17), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: carol })

			// Defaulter 3 liquidated
			assert.isTrue(txL3.receipt.status)

			const txL3ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_3, {
				from: owner,
			})
			assert.isTrue(txL3ERC20.receipt.status)

			assert.equal(await stabilityPool.P(), dec(1, 12)) // P decreases to 1e(17-5) = 1e12
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPoolERC20.P(), dec(1, 12)) // P decreases to 1e(17-5) = 1e12
			assert.equal(await stabilityPoolERC20.currentScale(), "1")

			// D deposits 9999.9 VUSD
			await debtToken.transfer(dennis, dec(99999, 17), { from: whale })

			await debtToken.transfer(dennis, dec(99999, 17), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: dennis })

			// Defaulter 4 liquidated
			assert.isTrue(txL4.receipt.status)
			assert.equal(await stabilityPool.P(), dec(1, 16)) // Scale changes and P changes to 1e(12-5+9) = 1e16
			assert.equal(await stabilityPool.currentScale(), "2")

			const txL4ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_4, {
				from: owner,
			})
			assert.isTrue(txL4ERC20.receipt.status)
			assert.equal(await stabilityPoolERC20.P(), dec(1, 16)) // Scale changes and P changes to 1e(12-5+9) = 1e16
			assert.equal(await stabilityPoolERC20.currentScale(), "2")

			const alice_ETHGainAt2ndScaleChange = (await stabilityPool.getDepositorAssetGain(alice)).toString()
			const alice_ETHGainAt2ndScaleChangeERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()

			// E deposits 9999.9 VUSD
			await debtToken.transfer(erin, dec(99999, 17), { from: whale })

			await debtToken.transfer(erin, dec(99999, 17), { from: whale })
			await stabilityPoolERC20.provideToSP(dec(99999, 17), { from: erin })

			// Defaulter 5 liquidated
			assert.isTrue(txL5.receipt.status)
			assert.equal(await stabilityPool.P(), dec(1, 11)) // P decreases to 1e(16-5) = 1e11
			assert.equal(await stabilityPool.currentScale(), "2")

			const txL5ERC20 = await vesselManagerOperations.liquidate(erc20.address, defaulter_5, {
				from: owner,
			})
			assert.isTrue(txL5ERC20.receipt.status)
			assert.equal(await stabilityPoolERC20.P(), dec(1, 11)) // P decreases to 1e(16-5) = 1e11
			assert.equal(await stabilityPoolERC20.currentScale(), "2")

			const alice_ETHGainAfterFurtherLiquidation = (await stabilityPool.getDepositorAssetGain(alice)).toString()
			const alice_scaleSnapshot = (await stabilityPool.depositSnapshots(alice))[2].toString()

			assert.equal(alice_scaleSnapshot, "0")
			assert.equal(alice_ETHGainAt2ndScaleChange, alice_ETHGainAfterFurtherLiquidation)

			const alice_ETHGainAfterFurtherLiquidationERC20 = (
				await stabilityPoolERC20.getDepositorAssetGain(alice)
			).toString()
			const alice_scaleSnapshotERC20 = (await stabilityPoolERC20.depositSnapshots(alice))[2].toString()

			assert.equal(alice_scaleSnapshotERC20, "0")
			assert.equal(alice_ETHGainAt2ndScaleChangeERC20, alice_ETHGainAfterFurtherLiquidationERC20)
		})

		// --- Extreme values, confirm no overflows ---

		it("withdrawFromSP(): Large liquidated coll/debt, deposits and ETH price", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// ETH:USD price is $2 billion per ETH
			await priceFeed.setPrice(erc20.address, dec(2, 27))

			const depositors = [alice, bob]
			for (account of depositors) {
				await borrowerOperations.openVessel(erc20.address, dec(2, 27), dec(1, 36), account, account, { from: account })
				await stabilityPoolERC20.provideToSP(dec(1, 36), { from: account })
			}

			// Defaulter opens vessel with 200% ICR
			await borrowerOperations.openVessel(
				erc20.address,
				dec(1, 27),
				await getOpenVesselVUSDAmount(dec(1, 36), erc20.address),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// ETH:USD price drops to $1 billion per ETH
			await priceFeed.setPrice(erc20.address, dec(1, 27))

			// Defaulter liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1, 36), { from: alice })
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1, 36), { from: bob })

			// Grab the ETH gain from the emitted event in the tx log

			const alice_ETHWithdrawnERC20 = th.getEventArgByName(txA, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
			const bob_ETHWithdrawnERC20 = th.getEventArgByName(txB, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)

			// Check VUSD balances
			const aliceVUSDBalance = await debtToken.balanceOf(alice)
			const aliceExpectedVUSDBalance = web3.utils.toBN(dec(5, 35))
			const aliceVUSDBalDiff = aliceVUSDBalance.sub(aliceExpectedVUSDBalance).abs()

			assert.isTrue(aliceVUSDBalDiff.lte(toBN(dec(1, 18)))) // error tolerance of 1e18

			const bobVUSDBalance = await debtToken.balanceOf(bob)
			const bobExpectedVUSDBalance = toBN(dec(5, 35))
			const bobVUSDBalDiff = bobVUSDBalance.sub(bobExpectedVUSDBalance).abs()

			assert.isTrue(bobVUSDBalDiff.lte(toBN(dec(1, 18))))

			// Check ETH gains
			const aliceExpectedETHGain = toBN(dec(4975, 23))
			const aliceETHDiff = aliceExpectedETHGain.sub(toBN(alice_ETHWithdrawn))
			const aliceETHDiffERC20 = aliceExpectedETHGain.sub(toBN(alice_ETHWithdrawnERC20))

			assert.isTrue(aliceETHDiff.lte(toBN(dec(1, 18))))
			assert.isTrue(aliceETHDiffERC20.lte(toBN(dec(1, 18))))

			const bobExpectedETHGain = toBN(dec(4975, 23))
			const bobETHDiff = bobExpectedETHGain.sub(toBN(bob_ETHWithdrawn))
			const bobETHDiffERC20 = bobExpectedETHGain.sub(toBN(bob_ETHWithdrawnERC20))

			assert.isTrue(bobETHDiff.lte(toBN(dec(1, 18))))
			assert.isTrue(bobETHDiffERC20.lte(toBN(dec(1, 18))))
		})

		it("withdrawFromSP(): Small liquidated coll/debt, large deposits and ETH price", async () => {
			// Whale opens Vessel with 100k ETH
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100000, "ether"),
				await getOpenVesselVUSDAmount(dec(100000, 18), erc20.address),
				whale,
				whale,
				{ from: whale }
			)

			// ETH:USD price is $2 billion per ETH
			await priceFeed.setPrice(erc20.address, dec(2, 27))
			await priceFeed.getPrice(erc20.address)

			const depositors = [alice, bob]
			for (account of depositors) {
				await borrowerOperations.openVessel(erc20.address, dec(2, 29), dec(1, 38), account, account, { from: account })
				await stabilityPoolERC20.provideToSP(dec(1, 38), { from: account })
			}

			// Defaulter opens vessel with 50e-7 ETH and  5000 VUSD. 200% ICR
			await borrowerOperations.openVessel(
				erc20.address,
				"5000000000000",
				await getOpenVesselVUSDAmount(dec(5000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// ETH:USD price drops to $1 billion per ETH
			await priceFeed.setPrice(erc20.address, dec(1, 27))

			// Defaulter liquidated
			await vesselManagerOperations.liquidate(erc20.address, defaulter_1, { from: owner })

			const txAERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1, 38), { from: alice })
			const txBERC20 = await stabilityPoolERC20.withdrawFromSP(dec(1, 38), { from: bob })

			const alice_ETHWithdrawnERC20 = th.getEventArgByName(txAERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)
			const bob_ETHWithdrawnERC20 = th.getEventArgByName(txBERC20, EVENT_ASSET_GAIN_NAME, EVENT_ASSET_GAIN_PARAM)

			const aliceVUSDBalance = await debtToken.balanceOf(alice)
			const aliceExpectedVUSDBalance = toBN("99999999999999997500000000000000000000")
			const aliceVUSDBalDiff = aliceVUSDBalance.sub(aliceExpectedVUSDBalance).abs()

			assert.isTrue(aliceVUSDBalDiff.lte(toBN(dec(1, 18))))

			const bobVUSDBalance = await debtToken.balanceOf(bob)
			const bobExpectedVUSDBalance = toBN("99999999999999997500000000000000000000")
			const bobVUSDBalDiff = bobVUSDBalance.sub(bobExpectedVUSDBalance).abs()

			assert.isTrue(bobVUSDBalDiff.lte(toBN("100000000000000000000")))

			// Expect ETH gain per depositor of ~1e11 wei to be rounded to 0 by the ETHGainedPerUnitStaked calculation (e / D), where D is ~1e36.
			assert.equal(alice_ETHWithdrawn.toString(), "0")
			assert.equal(bob_ETHWithdrawn.toString(), "0")
			assert.equal(alice_ETHWithdrawnERC20.toString(), "0")
			assert.equal(bob_ETHWithdrawnERC20.toString(), "0")
		})
	})
})

contract("Reset chain state", async accounts => {})

