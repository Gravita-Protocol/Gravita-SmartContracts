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
		const coreContracts = await this._deployCoreContracts()
		const GRVTContracts = await this._deployGrvtContracts(treasuryAddress)

		await this._connectCoreContracts(coreContracts, GRVTContracts, treasuryAddress)
		await this._connectGrvtContracts(GRVTContracts, coreContracts)

		for (const acc of collateralMintingAccounts) {
			const mintingValue = dec(100_000_000, 18)
			await coreContracts.erc20.mint(acc, mintingValue)
			await coreContracts.erc20B.mint(acc, mintingValue)
		}

		return { coreContracts, GRVTContracts }
	}

	static async _deployCoreContracts() {
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
		const shortTimelock = await Timelock.new(TIMELOCK_SHORT_DELAY)
		const longTimelock = await Timelock.new(TIMELOCK_LONG_DELAY)
		const debtToken = await DebtTokenTester.new(
			vesselManager.address,
			stabilityPool.address,
			borrowerOperations.address,
			longTimelock.address
		)
		const debtTokenWhitelistedTester = await DebtTokenWhitelistedTester.new(debtToken.address)

		await erc20.setDecimals(18)
		await erc20B.setDecimals(18)

		const coreContracts = {
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

		await this._invokeInitializers(coreContracts)
		return coreContracts
	}

	static async _deployGrvtContracts(treasury) {
		const GRVTContracts = {
			communityIssuance: await CommunityIssuanceTester.new(),
			grvtStaking: await GRVTStaking.new(),
			grvtToken: await GRVTTokenTester.new(treasury),
			lockedGRVT: await LockedGRVT.new(),
		}
		await this._invokeInitializers(GRVTContracts)
		return GRVTContracts
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
	static async _connectCoreContracts(contracts, GRVTContracts, treasury) {
		await contracts.activePool.setAddresses(
			contracts.borrowerOperations.address,
			contracts.collSurplusPool.address,
			contracts.defaultPool.address,
			contracts.stabilityPool.address,
			contracts.vesselManager.address,
			contracts.vesselManagerOperations.address
		)

		await contracts.adminContract.setAddresses(
			GRVTContracts.communityIssuance?.address || EMPTY_ADDRESS,
			contracts.activePool.address,
			contracts.defaultPool.address,
			contracts.stabilityPool.address,
			contracts.collSurplusPool.address,
			contracts.priceFeedTestnet.address,
			contracts.shortTimelock.address
		)

		await contracts.borrowerOperations.setAddresses(
			contracts.vesselManager.address,
			contracts.stabilityPool.address,
			contracts.gasPool.address,
			contracts.collSurplusPool.address,
			contracts.sortedVessels.address,
			contracts.debtToken.address,
			contracts.feeCollector.address,
			contracts.adminContract.address
		)

		await contracts.collSurplusPool.setAddresses(
			contracts.activePool.address,
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			contracts.vesselManagerOperations.address
		)

		await contracts.defaultPool.setAddresses(contracts.vesselManager.address, contracts.activePool.address)

		await contracts.feeCollector.setAddresses(
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			GRVTContracts.grvtStaking?.address || EMPTY_ADDRESS,
			contracts.debtToken.address,
			treasury,
			false
		)

		await contracts.priceFeedTestnet.setPrice(contracts.erc20.address, dec(200, "ether"))
		await contracts.priceFeedTestnet.setPrice(contracts.erc20B.address, dec(100, "ether"))

		await contracts.sortedVessels.setAddresses(contracts.vesselManager.address, contracts.borrowerOperations.address)

		await contracts.stabilityPool.setAddresses(
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			contracts.activePool.address,
			contracts.debtToken.address,
			contracts.sortedVessels.address,
			GRVTContracts.communityIssuance?.address || EMPTY_ADDRESS,
			contracts.adminContract.address
		)

		await contracts.vesselManager.setAddresses(
			contracts.borrowerOperations.address,
			contracts.stabilityPool.address,
			contracts.gasPool.address,
			contracts.collSurplusPool.address,
			contracts.debtToken.address,
			contracts.feeCollector.address,
			contracts.sortedVessels.address,
			contracts.vesselManagerOperations.address,
			contracts.adminContract.address
		)

		await contracts.vesselManagerOperations.setAddresses(
			contracts.vesselManager.address,
			contracts.sortedVessels.address,
			contracts.stabilityPool.address,
			contracts.collSurplusPool.address,
			contracts.debtToken.address,
			contracts.adminContract.address
		)

		await contracts.adminContract.addNewCollateral(EMPTY_ADDRESS, dec(30, 18), 18)
		await contracts.adminContract.addNewCollateral(contracts.erc20.address, dec(200, 18), 18)
		await contracts.adminContract.addNewCollateral(contracts.erc20B.address, dec(30, 18), 18)

		// Redemption are disabled by default; enable them for testing
		await contracts.adminContract.setRedemptionBlockTimestamp(EMPTY_ADDRESS, 0)
		await contracts.adminContract.setRedemptionBlockTimestamp(contracts.erc20.address, 0)
		await contracts.adminContract.setRedemptionBlockTimestamp(contracts.erc20B.address, 0)

		await contracts.adminContract.setIsActive(EMPTY_ADDRESS, true)
		await contracts.adminContract.setIsActive(contracts.erc20.address, true)
		await contracts.adminContract.setIsActive(contracts.erc20B.address, true)
	}

	/**
	 * Connects contracts to their dependencies.
	 */
	static async _connectGrvtContracts(GRVTContracts, coreContracts) {
		const treasuryAddress = await GRVTContracts.grvtToken.treasury()

		await GRVTContracts.grvtStaking.setAddresses(
			GRVTContracts.grvtToken.address,
			coreContracts.debtToken.address,
			coreContracts.feeCollector.address,
			coreContracts.vesselManager.address,
			treasuryAddress
		)

		await GRVTContracts.grvtStaking.unpause()

		await GRVTContracts.communityIssuance.setAddresses(
			GRVTContracts.grvtToken.address,
			coreContracts.stabilityPool.address,
			coreContracts.adminContract.address
		)

		await GRVTContracts.lockedGRVT.setAddresses(GRVTContracts.grvtToken.address)

		await GRVTContracts.grvtToken.approve(GRVTContracts.communityIssuance.address, ethers.constants.MaxUint256, {
			from: treasuryAddress,
		})

		const supply = dec(32000000, 18)
		const weeklyReward = dec(32000000 / 4, 18)

		await GRVTContracts.grvtToken.unprotectedMint(treasuryAddress, supply)

		await GRVTContracts.communityIssuance.transferOwnership(treasuryAddress)
		await GRVTContracts.communityIssuance.addFundToStabilityPool(weeklyReward, { from: treasuryAddress })
		await GRVTContracts.communityIssuance.setWeeklyGrvtDistribution(weeklyReward, { from: treasuryAddress })

		// Set configs (since the tests have been designed with it)
		const defaultFee = (0.005e18).toString() // 0.5%
		await coreContracts.adminContract.setCollateralParameters(
			EMPTY_ADDRESS,
			defaultFee, // borrowingFee
			(1.5e18).toString(), // ccr
			(1.1e18).toString(), // mcr
			dec(300, 18), // minNetDebt
			dec(1_000_000, 18), // mintCap
			100, // percentDivisor
			defaultFee // redemptionFeeFloor
		)
		await coreContracts.adminContract.setCollateralParameters(
			coreContracts.erc20.address,
			defaultFee, // borrowingFee
			(1.5e18).toString(), // ccr
			(1.1e18).toString(), // mcr
			dec(1_800, 18), // minNetDebt
			dec(10_000_000_000, 18), // mintCap
			200, // percentDivisor
			defaultFee // redemptionFeeFloor
		)
		await coreContracts.adminContract.setCollateralParameters(
			coreContracts.erc20B.address,
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
