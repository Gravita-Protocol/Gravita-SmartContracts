const ActivePool = artifacts.require("./ActivePool.sol")
const AdminContract = artifacts.require("./AdminContract.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const DebtToken = artifacts.require("./DebtToken.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const FeeCollector = artifacts.require("./FeeCollector.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const GasPool = artifacts.require("./GasPool.sol")
const GRVTStaking = artifacts.require("./GRVTStaking.sol")
const LockedGRVT = artifacts.require("./LockedGRVT.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const SortedVessels = artifacts.require("./SortedVessels.sol")
const StabilityPool = artifacts.require("./StabilityPool.sol")
const Timelock = artifacts.require("./Timelock.sol")
const VesselManager = artifacts.require("./VesselManager.sol")
const VesselManagerOperations = artifacts.require("./VesselManagerOperations.sol")

// Tester contracts
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const DebtTokenTester = artifacts.require("./DebtTokenTester.sol")
const DebtTokenWhitelistedTester = artifacts.require("DebtTokenWhitelistedTester")
const ERC20Test = artifacts.require("./ERC20Test.sol")
const GravitaMathTester = artifacts.require("./GravitaMathTester.sol")
const GRVTTokenTester = artifacts.require("./GRVTTokenTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")

// Proxy scripts
const BorrowerOperationsScript = artifacts.require("BorrowerOperationsScript")
const BorrowerWrappersScript = artifacts.require("BorrowerWrappersScript")
const GRVTStakingScript = artifacts.require("GRVTStakingScript")
const StabilityPoolScript = artifacts.require("StabilityPoolScript")
const TokenScript = artifacts.require("TokenScript")

const {
	buildUserProxies,
	BorrowerOperationsProxy,
	BorrowerWrappersProxy,
	VesselManagerProxy,
	StabilityPoolProxy,
	SortedVesselsProxy,
	TokenProxy,
	GRVTStakingProxy,
} = require("../utils/proxyHelpers.js")

/* "Gravita core" consists of all contracts in the core Gravita system.

GRVT contracts consist of only those contracts related to the GRVT Token:

-the GRVT token
-the Lockup factory and lockup contracts
-the GRVTStaking contract
-the CommunityIssuance contract 
*/

const testHelpers = require("./testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec
const shortDelay = 86400 * 3
const longDelay = 86400 * 7

const ZERO_ADDRESS = "0x" + "0".repeat(40)

class DeploymentHelper {
	static async deployGravitaCore() {
		return this.deployGravitaCoreHardhat()
	}

	static async deployGravitaCoreHardhat() {
		const activePool = await ActivePool.new()
		const adminContract = await AdminContract.new()
		const borrowerOperations = await BorrowerOperations.new()
		const collSurplusPool = await CollSurplusPool.new()
		const defaultPool = await DefaultPool.new()
		const erc20 = await ERC20Test.new()
		const erc20B = await ERC20Test.new()
		const feeCollector = await FeeCollector.new()
		const functionCaller = await FunctionCaller.new()
		const gasPool = await GasPool.new()
		const priceFeedTestnet = await PriceFeedTestnet.new()
		const sortedVessels = await SortedVessels.new()
		const stabilityPool = await StabilityPool.new()
		const vesselManager = await VesselManager.new()
		const vesselManagerOperations = await VesselManagerOperations.new()
		const shortTimelock = await Timelock.new(shortDelay)
		const longTimelock = await Timelock.new(longDelay)
		const debtToken = await DebtToken.new(
			vesselManager.address,
			stabilityPool.address,
			borrowerOperations.address,
			shortTimelock.address
		)

		ActivePool.setAsDeployed(activePool)
		AdminContract.setAsDeployed(adminContract)
		BorrowerOperations.setAsDeployed(borrowerOperations)
		CollSurplusPool.setAsDeployed(collSurplusPool)
		DebtToken.setAsDeployed(debtToken)
		DefaultPool.setAsDeployed(defaultPool)
		ERC20Test.setAsDeployed(erc20)
		ERC20Test.setAsDeployed(erc20B)
		FeeCollector.setAsDeployed(feeCollector)
		FunctionCaller.setAsDeployed(functionCaller)
		GasPool.setAsDeployed(gasPool)
		PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
		SortedVessels.setAsDeployed(sortedVessels)
		StabilityPool.setAsDeployed(stabilityPool)
		Timelock.setAsDeployed(shortTimelock)
		Timelock.setAsDeployed(longTimelock)
		VesselManager.setAsDeployed(vesselManager)
		VesselManagerOperations.setAsDeployed(vesselManagerOperations)
		
		await erc20.setDecimals(18)
		await erc20B.setDecimals(18)

		const coreContracts = {
			activePool,
			adminContract,
			borrowerOperations,
			collSurplusPool,
			debtToken,
			defaultPool,
			feeCollector,
			functionCaller,
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
		return coreContracts
	}

	static async deployTesterContractsHardhat() {
		const testerContracts = {}
		// Contract without testers (yet)
		testerContracts.activePool = await ActivePool.new()
		testerContracts.adminContract = await AdminContract.new()
		testerContracts.collSurplusPool = await CollSurplusPool.new()
		testerContracts.defaultPool = await DefaultPool.new()
		testerContracts.erc20 = await ERC20Test.new()
		testerContracts.erc20B = await ERC20Test.new()
		testerContracts.feeCollector = await FeeCollector.new()
		testerContracts.functionCaller = await FunctionCaller.new()
		testerContracts.gasPool = await GasPool.new()
		testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
		testerContracts.sortedVessels = await SortedVessels.new()
		testerContracts.vesselManagerOperations = await VesselManagerOperations.new()
		testerContracts.shortTimelock = await Timelock.new(shortDelay)
		testerContracts.longTimelock = await Timelock.new(longDelay)
		// Actual tester contracts
		testerContracts.borrowerOperations = await BorrowerOperationsTester.new()
		testerContracts.communityIssuance = await CommunityIssuanceTester.new()
		testerContracts.math = await GravitaMathTester.new()
		testerContracts.stabilityPool = await StabilityPoolTester.new()
		testerContracts.vesselManager = await VesselManagerTester.new()
		testerContracts.debtToken = await DebtTokenTester.new(
			testerContracts.vesselManager.address,
			testerContracts.stabilityPool.address,
			testerContracts.borrowerOperations.address,
			testerContracts.shortTimelock.address
		)
		testerContracts.debtTokenWhitelistedTester = await DebtTokenWhitelistedTester.new(testerContracts.debtToken.address)

		return testerContracts
	}

	static async deployGRVTContractsHardhat(treasury) {
		const communityIssuance = await CommunityIssuanceTester.new()
		const grvtStaking = await GRVTStaking.new()
		const lockedGRVT = await LockedGRVT.new()

		CommunityIssuanceTester.setAsDeployed(communityIssuance)
		GRVTStaking.setAsDeployed(grvtStaking)
		LockedGRVT.setAsDeployed(lockedGRVT)

		const grvtToken = await GRVTTokenTester.new(treasury)
		GRVTTokenTester.setAsDeployed(grvtToken)

		const GRVTContracts = {
			communityIssuance,
			grvtStaking,
			grvtToken,
			lockedGRVT,
		}
		return GRVTContracts
	}

	static async deployDebtTokenTester(contracts) {
		contracts.debtToken = await DebtTokenTester.new(
			contracts.vesselManager.address,
			contracts.stabilityPool.address,
			contracts.borrowerOperations.address,
			contracts.shortTimelock.address
		)
		return contracts
	}

	static async deployProxyScripts(contracts, GRVTContracts, owner, users) {
		const proxies = await buildUserProxies(users)

		const borrowerWrappersScript = await BorrowerWrappersScript.new(
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			GRVTContracts.grvtStaking.address
		)
		contracts.borrowerWrappers = new BorrowerWrappersProxy(owner, proxies, borrowerWrappersScript.address)

		const borrowerOperationsScript = await BorrowerOperationsScript.new(contracts.borrowerOperations.address)
		contracts.borrowerOperations = new BorrowerOperationsProxy(
			owner,
			proxies,
			borrowerOperationsScript.address,
			contracts.borrowerOperations
		)

		// const vesselManagerScript = await VesselManagerScript.new(contracts.vesselManager.address)
		// contracts.vesselManager = new VesselManagerProxy(
		// 	owner,
		// 	proxies,
		// 	vesselManagerScript.address,
		// 	contracts.vesselManager
		// )

		const stabilityPoolScript = await StabilityPoolScript.new(contracts.stabilityPool.address)
		contracts.stabilityPool = new StabilityPoolProxy(
			owner,
			proxies,
			stabilityPoolScript.address,
			contracts.stabilityPool
		)

		contracts.sortedVessels = new SortedVesselsProxy(owner, proxies, contracts.sortedVessels)

		const debtTokenScript = await TokenScript.new(contracts.debtToken.address)
		contracts.debtToken = new TokenProxy(owner, proxies, debtTokenScript.address, contracts.debtToken)

		const grvtTokenScript = await TokenScript.new(GRVTContracts.grvtToken.address)
		GRVTContracts.grvtToken = new TokenProxy(owner, proxies, grvtTokenScript.address, GRVTContracts.grvtToken)

		const grvtStakingScript = await GRVTStakingScript.new(GRVTContracts.grvtStaking.address)
		GRVTContracts.grvtStaking = new GRVTStakingProxy(
			owner,
			proxies,
			grvtStakingScript.address,
			GRVTContracts.grvtStaking
		)
	}

	// Connect contracts to their dependencies
	static async connectCoreContracts(contracts, GRVTContracts, treasury = "0x1" + "0".repeat(39)) {

		await contracts.activePool.setAddresses(
			contracts.borrowerOperations.address,
			contracts.collSurplusPool.address,
			contracts.defaultPool.address,
			contracts.stabilityPool.address,
			contracts.vesselManager.address,
			contracts.vesselManagerOperations.address
		)

		await contracts.adminContract.setAddresses(
			GRVTContracts.communityIssuance?.address || ZERO_ADDRESS,
			contracts.activePool.address,
			contracts.defaultPool.address,
			contracts.stabilityPool.address,
			contracts.collSurplusPool.address,
			contracts.priceFeedTestnet.address,
			contracts.shortTimelock.address,
			contracts.longTimelock.address
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
			GRVTContracts.grvtStaking?.address || ZERO_ADDRESS,
			contracts.debtToken.address,
			treasury,
			false
		)

		await contracts.functionCaller.setVesselManagerAddress(contracts.vesselManager.address)
		await contracts.functionCaller.setSortedVesselsAddress(contracts.sortedVessels.address)

		await contracts.priceFeedTestnet.setPrice(contracts.erc20.address, dec(200, 'ether'))
		await contracts.priceFeedTestnet.setPrice(contracts.erc20B.address, dec(100, 'ether'))

		await contracts.sortedVessels.setAddresses(contracts.vesselManager.address, contracts.borrowerOperations.address)

		await contracts.stabilityPool.setAddresses(
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			contracts.activePool.address,
			contracts.debtToken.address,
			contracts.sortedVessels.address,
			GRVTContracts.communityIssuance?.address || ZERO_ADDRESS,
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

	}

	static async connectGRVTContractsToCore(GRVTContracts, coreContracts, skipPool = false, liquitySettings = true) {
		const treasurySig = await GRVTContracts.grvtToken.treasury()

		await GRVTContracts.grvtStaking.setAddresses(
			GRVTContracts.grvtToken.address,
			coreContracts.debtToken.address,
			coreContracts.feeCollector.address,
			coreContracts.vesselManager.address,
			treasurySig
		)

		await GRVTContracts.grvtStaking.unpause()

		await GRVTContracts.communityIssuance.setAddresses(
			GRVTContracts.grvtToken.address,
			coreContracts.stabilityPool.address,
			coreContracts.adminContract.address
		)

		await GRVTContracts.lockedGRVT.setAddresses(GRVTContracts.grvtToken.address)

		if (skipPool) {
			return
		}

		await GRVTContracts.grvtToken.approve(GRVTContracts.communityIssuance.address, ethers.constants.MaxUint256, {
			from: treasurySig,
		})

		const supply = dec(32000000, 18)
		const weeklyReward = dec(32000000 / 4, 18)

		await GRVTContracts.grvtToken.unprotectedMint(treasurySig, supply)

		await coreContracts.adminContract.addNewCollateral(ZERO_ADDRESS, 18, false, { from: treasurySig })
		await coreContracts.adminContract.addNewCollateral(coreContracts.erc20.address, 18, false, { from: treasurySig })
		await coreContracts.adminContract.addNewCollateral(coreContracts.erc20B.address, 18, false, { from: treasurySig })

		await GRVTContracts.communityIssuance.addFundToStabilityPool(weeklyReward)
		await GRVTContracts.communityIssuance.setWeeklyGrvtDistribution(weeklyReward)

		if (!liquitySettings) return

		//Set Liquity Configs (since the tests have been designed with it)
		await coreContracts.adminContract.setCollateralParameters(
			ZERO_ADDRESS,
			"1100000000000000000",
			"1500000000000000000",
			dec(30, 18),
			dec(300, 18),
			100,
			50,
			50,
			dec(1000000, 18)
		)

		await coreContracts.adminContract.setCollateralParameters(
			coreContracts.erc20.address,
			"1100000000000000000",
			"1500000000000000000",
			dec(200, 18),
			dec(1800, 18),
			200,
			50,
			50,
			"10000000000000000000000000000"
		)
	}
}
module.exports = DeploymentHelper
