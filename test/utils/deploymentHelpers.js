const ActivePool = artifacts.require("ActivePool")
const AdminContract = artifacts.require("AdminContract")
const BorrowerOperationsTester = artifacts.require("BorrowerOperationsTester")
const CollSurplusPool = artifacts.require("CollSurplusPool")
const CommunityIssuanceTester = artifacts.require("CommunityIssuanceTester")
const DebtTokenTester = artifacts.require("DebtTokenTester")
const DebtTokenWhitelistedTester = artifacts.require("DebtTokenWhitelistedTester")
const DefaultPool = artifacts.require("DefaultPool")
const ERC20Test = artifacts.require("ERC20Test")
const FeeCollectorTester = artifacts.require("FeeCollectorTester")
const GasPool = artifacts.require("GasPool")
const GRVTStaking = artifacts.require("GRVTStaking")
const GRVTTokenTester = artifacts.require("GRVTTokenTester")
const LockedGRVT = artifacts.require("LockedGRVT")
const PriceFeedTestnet = artifacts.require("PriceFeedTestnet")
const SortedVessels = artifacts.require("SortedVessels")
const StabilityPoolTester = artifacts.require("StabilityPoolTester")
const Timelock = artifacts.require("Timelock")
const VesselManagerOperations = artifacts.require("VesselManagerOperations")
const VesselManagerTester = artifacts.require("VesselManagerTester")

const testHelpers = require("./testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec

const EMPTY_ADDRESS = "0x" + "0".repeat(40)
const TIMELOCK_SHORT_DELAY = 86400 * 3
const TIMELOCK_LONG_DELAY = 86400 * 7

/**
 * Deploys Gravita's contracts to Hardhat TEST env
 */
class DeploymentHelper {
	static async deployTestContracts(treasuryAddress, collateralMintingAccounts = []) {
		const core = await this._deployCoreContracts(treasuryAddress)
		const grvt = await this._deployGrvtContracts(treasuryAddress)

		await this._connectCoreContracts(core, grvt, treasuryAddress)
		await this._connectGrvtContracts(grvt, core)

		for (const acc of collateralMintingAccounts) {
			const mintingValue = dec(100_000_000, 18)
			await core.erc20.mint(acc, mintingValue)
			await core.erc20B.mint(acc, mintingValue)
		}

		return { core, grvt }
	}

	static async _deployCoreContracts(treasuryAddress) {
		const activePool = await ActivePool.new()
		const adminContract = await AdminContract.new()
		const borrowerOperations = await BorrowerOperationsTester.new()
		const collSurplusPool = await CollSurplusPool.new()
		const defaultPool = await DefaultPool.new()
		const erc20 = await ERC20Test.new()
		const erc20B = await ERC20Test.new()
		const feeCollector = await FeeCollectorTester.new()
		const gasPool = await GasPool.new()
		const priceFeedTestnet = await PriceFeedTestnet.new()
		const sortedVessels = await SortedVessels.new()
		const stabilityPool = await StabilityPoolTester.new()
		const vesselManager = await VesselManagerTester.new()
		const vesselManagerOperations = await VesselManagerOperations.new()
		const shortTimelock = await Timelock.new(TIMELOCK_SHORT_DELAY, treasuryAddress)
		const longTimelock = await Timelock.new(TIMELOCK_LONG_DELAY, treasuryAddress)
		const debtToken = await DebtTokenTester.new()
		const debtTokenWhitelistedTester = await DebtTokenWhitelistedTester.new(debtToken.address)

		await erc20.setDecimals(18)
		await erc20B.setDecimals(18)

		const core = {
			activePool,
			adminContract,
			borrowerOperations,
			collSurplusPool,
			debtToken,
			debtTokenWhitelistedTester,
			defaultPool,
			feeCollector,
			gasPool,
			priceFeedTestnet,
			vesselManager,
			vesselManagerOperations,
			sortedVessels,
			stabilityPool,
			shortTimelock,
			longTimelock,
			erc20,
			erc20B,
		}

		await this._invokeInitializers(core)
		return core
	}

	static async _deployGrvtContracts(treasury) {
		const grvt = {
			communityIssuance: await CommunityIssuanceTester.new(),
			grvtStaking: await GRVTStaking.new(),
			grvtToken: await GRVTTokenTester.new(treasury),
			lockedGRVT: await LockedGRVT.new(),
		}
		await this._invokeInitializers(grvt)
		return grvt
	}

	/**
	 * Calls the initialize() function on the contracts that provide it; on deployment, that will be handled by upgrades.deployProxy()
	 */
	static async _invokeInitializers(contracts) {
		for (const key in contracts) {
			const contract = contracts[key]
			if (contract.initialize) {
				await contract.initialize()
			}
		}
	}

	/**
	 * Connects contracts to their dependencies.
	 */
	static async _connectCoreContracts(core, grvt, treasuryAddress) {
		const setAddresses = async contract => {
			await contract.setActivePool(core.activePool.address)
			await contract.setAdminContract(core.adminContract.address)
			await contract.setBorrowerOperations(core.borrowerOperations.address)
			await contract.setCollSurplusPool(core.collSurplusPool.address)
			await contract.setCommunityIssuance(grvt.communityIssuance.address)
			await contract.setDebtToken(core.debtToken.address)
			await contract.setDefaultPool(core.defaultPool.address)
			await contract.setFeeCollector(core.feeCollector.address)
			await contract.setGasPool(core.gasPool.address)
			await contract.setGRVTStaking(grvt.grvtStaking.address)
			await contract.setPriceFeed(core.priceFeedTestnet.address)
			await contract.setSortedVessels(core.sortedVessels.address)
			await contract.setStabilityPool(core.stabilityPool.address)
			await contract.setTimelock(core.shortTimelock.address)
			await contract.setTreasury(treasuryAddress)
			await contract.setVesselManager(core.vesselManager.address)
			await contract.setVesselManagerOperations(core.vesselManagerOperations.address)
		}
		for (const key in core) {
			const contract = core[key]
			if (contract.setGasPool) {
				await setAddresses(contract)
			}
		}
		await core.debtToken.setAddresses(
			core.borrowerOperations.address,
			core.stabilityPool.address,
			core.vesselManager.address
		)
		await core.debtToken.addWhitelist(core.feeCollector.address)
		for (const key in grvt) {
			const contract = grvt[key]
			if (contract.setGasPool) {
				await setAddresses(contract)
			}
		}

		// await core.activePool.setAddresses(
		// 	core.borrowerOperations.address,
		// 	core.collSurplusPool.address,
		// 	core.defaultPool.address,
		// 	core.stabilityPool.address,
		// 	core.vesselManager.address,
		// 	core.vesselManagerOperations.address
		// )

		// await core.adminContract.setAddresses(
		// 	grvt.communityIssuance?.address || EMPTY_ADDRESS,
		// 	core.activePool.address,
		// 	core.defaultPool.address,
		// 	core.stabilityPool.address,
		// 	core.collSurplusPool.address,
		// 	core.priceFeedTestnet.address,
		// 	core.shortTimelock.address
		// )

		// await core.borrowerOperations.setAddresses(
		// 	core.vesselManager.address,
		// 	core.stabilityPool.address,
		// 	core.gasPool.address,
		// 	core.collSurplusPool.address,
		// 	core.sortedVessels.address,
		// 	core.debtToken.address,
		// 	core.feeCollector.address,
		// 	core.adminContract.address
		// )

		// await core.collSurplusPool.setAddresses(
		// 	core.activePool.address,
		// 	core.borrowerOperations.address,
		// 	core.vesselManager.address,
		// 	core.vesselManagerOperations.address
		// )

		// await core.defaultPool.setAddresses(core.vesselManager.address, core.activePool.address)

		// await core.feeCollector.setAddresses(
		// 	core.borrowerOperations.address,
		// 	core.vesselManager.address,
		// 	grvt.grvtStaking?.address || EMPTY_ADDRESS,
		// 	core.debtToken.address,
		// 	treasuryAddress,
		// 	false
		// )

		await core.priceFeedTestnet.setPrice(core.erc20.address, dec(200, "ether"))
		await core.priceFeedTestnet.setPrice(core.erc20B.address, dec(100, "ether"))

		// await core.sortedVessels.setAddresses(core.vesselManager.address, core.borrowerOperations.address)

		// await core.stabilityPool.setAddresses(
		// 	core.borrowerOperations.address,
		// 	core.vesselManager.address,
		// 	core.activePool.address,
		// 	core.debtToken.address,
		// 	core.sortedVessels.address,
		// 	grvt.communityIssuance?.address || EMPTY_ADDRESS,
		// 	core.adminContract.address
		// )

		// await core.vesselManager.setAddresses(
		// 	core.borrowerOperations.address,
		// 	core.stabilityPool.address,
		// 	core.gasPool.address,
		// 	core.collSurplusPool.address,
		// 	core.debtToken.address,
		// 	core.feeCollector.address,
		// 	core.sortedVessels.address,
		// 	core.vesselManagerOperations.address,
		// 	core.adminContract.address
		// )

		// await core.vesselManagerOperations.setAddresses(
		// 	core.vesselManager.address,
		// 	core.sortedVessels.address,
		// 	core.stabilityPool.address,
		// 	core.collSurplusPool.address,
		// 	core.debtToken.address,
		// 	core.adminContract.address
		// )

		await core.adminContract.addNewCollateral(EMPTY_ADDRESS, dec(30, 18), 18)
		await core.adminContract.addNewCollateral(core.erc20.address, dec(200, 18), 18)
		await core.adminContract.addNewCollateral(core.erc20B.address, dec(30, 18), 18)

		// Redemption are disabled by default; enable them for testing
		await core.adminContract.setRedemptionBlockTimestamp(EMPTY_ADDRESS, 0)
		await core.adminContract.setRedemptionBlockTimestamp(core.erc20.address, 0)
		await core.adminContract.setRedemptionBlockTimestamp(core.erc20B.address, 0)

		await core.adminContract.setIsActive(EMPTY_ADDRESS, true)
		await core.adminContract.setIsActive(core.erc20.address, true)
		await core.adminContract.setIsActive(core.erc20B.address, true)
	}

	/**
	 * Connects contracts to their dependencies.
	 */
	static async _connectGrvtContracts(grvt, core) {
		const treasuryAddress = await grvt.grvtToken.treasury()

		await grvt.grvtStaking.setAddresses(
			core.debtToken.address,
			core.feeCollector.address,
			grvt.grvtToken.address,
			treasuryAddress,
			core.vesselManager.address
		)

		await grvt.grvtStaking.unpause()

		await grvt.communityIssuance.setAddresses(
			grvt.grvtToken.address,
			core.stabilityPool.address,
			core.adminContract.address
		)

		await grvt.lockedGRVT.setAddresses(grvt.grvtToken.address)

		await grvt.grvtToken.approve(grvt.communityIssuance.address, ethers.constants.MaxUint256, {
			from: treasuryAddress,
		})

		const supply = dec(32_000_000, 18)
		const weeklyReward = dec(32_000_000 / 4, 18)

		await grvt.grvtToken.unprotectedMint(treasuryAddress, supply)

		await grvt.communityIssuance.transferOwnership(treasuryAddress)
		await grvt.communityIssuance.addFundToStabilityPool(weeklyReward, { from: treasuryAddress })
		await grvt.communityIssuance.setWeeklyGrvtDistribution(weeklyReward, { from: treasuryAddress })

		// Set configs (since the tests have been designed with it)
		const defaultFee = (0.005e18).toString() // 0.5%
		await core.adminContract.setCollateralParameters(
			EMPTY_ADDRESS,
			defaultFee, // borrowingFee
			(1.5e18).toString(), // ccr
			(1.1e18).toString(), // mcr
			dec(300, 18), // minNetDebt
			dec(1_000_000, 18), // mintCap
			100, // percentDivisor
			defaultFee // redemptionFeeFloor
		)
		await core.adminContract.setCollateralParameters(
			core.erc20.address,
			defaultFee, // borrowingFee
			(1.5e18).toString(), // ccr
			(1.1e18).toString(), // mcr
			dec(1_800, 18), // minNetDebt
			dec(10_000_000_000, 18), // mintCap
			200, // percentDivisor
			defaultFee // redemptionFeeFloor
		)
		await core.adminContract.setCollateralParameters(
			core.erc20B.address,
			defaultFee, // borrowingFee
			(1.5e18).toString(), // ccr
			(1.1e18).toString(), // mcr
			dec(1_800, 18), // minNetDebt
			dec(10_000_000_000, 18), // mintCap
			200, // percentDivisor
			defaultFee // redemptionFeeFloor
		)
	}
}

module.exports = DeploymentHelper
