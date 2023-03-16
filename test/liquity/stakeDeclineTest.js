const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

/* NOTE: Some tests involving ETH redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific ETH gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the VesselManager, which is still TBD based on economic modelling.
 *
 */
contract("VesselManager", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const [A, B, C, D, E, F] = accounts.slice(0, 7)

	let contracts

	let borrowerOperations
	let erc20
	let priceFeed
	let vesselManager

	const getOpenVesselVUSDAmount = async (totalDebt, asset) => th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)

	const getSnapshotsRatio = async asset => {
		const ratio = (await vesselManager.totalStakesSnapshot(asset))
			.mul(toBN(dec(1, 18)))
			.div(await vesselManager.totalCollateralSnapshot(asset))

		return ratio
	}

	beforeEach(async () => {
		contracts = await deploymentHelper.deployGravitaCore()
		contracts.vesselManager = await VesselManagerTester.new()
		contracts = await deploymentHelper.deployDebtTokenTester(contracts)
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

		borrowerOperations = contracts.borrowerOperations
		erc20 = contracts.erc20
		priceFeed = contracts.priceFeedTestnet
		vesselManager = contracts.vesselManager

		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
	})

	it("A given vessel's stake decline is negligible with adjustments and tiny liquidations", async () => {
		await priceFeed.setPrice(erc20.address, dec(100, 18))

		// Make 1 mega vessels A at ~50% total collateral
		await borrowerOperations.openVessel(
			ZERO_ADDRESS,
			dec(2, 29),
			await getOpenVesselVUSDAmount(dec(1, 31), ZERO_ADDRESS),
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: A }
		)

		// Make 5 large vessels B, C, D, E, F at ~10% total collateral
		await borrowerOperations.openVessel(
			ZERO_ADDRESS,
			dec(4, 28),
			await getOpenVesselVUSDAmount(dec(2, 30), ZERO_ADDRESS),
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: B }
		)
		await borrowerOperations.openVessel(
			ZERO_ADDRESS,
			dec(4, 28),
			await getOpenVesselVUSDAmount(dec(2, 30), ZERO_ADDRESS),
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: C }
		)
		await borrowerOperations.openVessel(
			ZERO_ADDRESS,
			dec(4, 28),
			await getOpenVesselVUSDAmount(dec(2, 30), ZERO_ADDRESS),
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: D }
		)
		await borrowerOperations.openVessel(
			ZERO_ADDRESS,
			dec(4, 28),
			await getOpenVesselVUSDAmount(dec(2, 30), ZERO_ADDRESS),
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: E }
		)
		await borrowerOperations.openVessel(
			ZERO_ADDRESS,
			dec(4, 28),
			await getOpenVesselVUSDAmount(dec(2, 30), ZERO_ADDRESS),
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: F }
		)

		// Make 10 tiny vessels at relatively negligible collateral (~1e-9 of total)
		const tinyVessels = accounts.slice(10, 20)
		for (account of tinyVessels) {
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				dec(2, 20),
				await getOpenVesselVUSDAmount(dec(1, 22), ZERO_ADDRESS),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: account }
			)
		}

		// liquidate 1 vessel at ~50% total system collateral
		await priceFeed.setPrice(erc20.address, dec(50, 18))
		assert.isTrue(await vesselManager.checkRecoveryMode(ZERO_ADDRESS, await priceFeed.getPrice(erc20.address)))
		await vesselManager.liquidate(ZERO_ADDRESS, A)

		console.log(`totalStakesSnapshot after L1: ${await vesselManager.totalStakesSnapshot(ZERO_ADDRESS)}`)
		console.log(`totalCollateralSnapshot after L1: ${await vesselManager.totalCollateralSnapshot(ZERO_ADDRESS)}`)
		console.log(`Snapshots ratio after L1: ${await getSnapshotsRatio(ZERO_ADDRESS)}`)
		console.log(`B pending ETH reward after L1: ${await vesselManager.getPendingAssetReward(ZERO_ADDRESS, B)}`)
		console.log(`B stake after L1: ${(await vesselManager.Vessels(B, ZERO_ADDRESS))[th.VESSEL_STAKE_INDEX]}`)

		// adjust vessel B 1 wei: apply rewards
		await borrowerOperations.adjustVessel(ZERO_ADDRESS, 0, th._100pct, 0, 1, false, ZERO_ADDRESS, ZERO_ADDRESS, {
			from: B,
		}) // B repays 1 wei
		console.log(`B stake after A1: ${(await vesselManager.Vessels(B, ZERO_ADDRESS))[th.VESSEL_STAKE_INDEX]}`)
		console.log(`Snapshots ratio after A1: ${await getSnapshotsRatio(ZERO_ADDRESS)}`)

		// Loop over tiny vessels, and alternately:
		// - Liquidate a tiny vessel
		// - Adjust B's collateral by 1 wei
		for (let [idx, vessel] of tinyVessels.entries()) {
			await vesselManager.liquidate(ZERO_ADDRESS, vessel)
			console.log(`B stake after L${idx + 2}: ${(await vesselManager.Vessels(B, ZERO_ADDRESS))[th.VESSEL_STAKE_INDEX]}`)
			console.log(`Snapshots ratio after L${idx + 2}: ${await getSnapshotsRatio(ZERO_ADDRESS)}`)
			await borrowerOperations.adjustVessel(ZERO_ADDRESS, 0, th._100pct, 0, 1, false, ZERO_ADDRESS, ZERO_ADDRESS, {
				from: B,
			}) // A repays 1 wei
			console.log(`B stake after A${idx + 2}: ${(await vesselManager.Vessels(B, ZERO_ADDRESS))[th.VESSEL_STAKE_INDEX]}`)
		}
	})

	// TODO: stake decline for adjustments with sizable liquidations, for comparison
})
