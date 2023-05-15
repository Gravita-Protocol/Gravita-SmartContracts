const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")

const DeploymentHelper = require("./deploymentHelper-common.js")

class CoreDeploymentHelper extends DeploymentHelper {
	constructor(hre, configParams, deployerWallet) {
		super(hre, configParams, deployerWallet)
		this.shortTimelockDelay = this.isMainnet() ? 3 * 86_400 : 120 // 3 days || 2 minutes
		this.longTimelockDelay = this.isMainnet() ? 7 * 86_400 : 120 // 7 days || 2 minutes
	}

	async loadOrDeployCoreContracts(state) {
		console.log(`Deploying core contracts...`)

		const ActivePool = await this.getFactory("ActivePool")
		const AdminContract = await this.getFactory("AdminContract")
		const BorrowerOperations = await this.getFactory("BorrowerOperations")
		const CollSurplusPool = await this.getFactory("CollSurplusPool")
		const DebtToken = await this.getFactory("DebtToken")
		const DefaultPool = await this.getFactory("DefaultPool")
		const FeeCollector = await this.getFactory("FeeCollector")
		const GasPool = await this.getFactory("GasPool")
		const PriceFeed = await this.getFactory("PriceFeed")
		const SortedVessels = await this.getFactory("SortedVessels")
		const StabilityPool = await this.getFactory("StabilityPool")
		const Timelock = this.isMainnet() ? await this.getFactory("Timelock") : await this.getFactory("TimelockTester")
		const VesselManager = await this.getFactory("VesselManager")
		const VesselMgrOps = await this.getFactory("VesselManagerOperations")

		// Upgradable (proxy-based) contracts
		const activePool = await this.deployUpgradable(ActivePool, "ActivePool", state)
		const adminContract = await this.deployUpgradable(AdminContract, "AdminContract", state)
		const borrowerOperations = await this.deployUpgradable(BorrowerOperations, "BorrowerOperations", state)
		const collSurplusPool = await this.deployUpgradable(CollSurplusPool, "CollSurplusPool", state)
		const defaultPool = await this.deployUpgradable(DefaultPool, "DefaultPool", state)
		const feeCollector = await this.deployUpgradable(FeeCollector, "FeeCollector", state)
		const priceFeed = await this.deployUpgradable(PriceFeed, "PriceFeed", state)
		const sortedVessels = await this.deployUpgradable(SortedVessels, "SortedVessels", state)
		const stabilityPool = await this.deployUpgradable(StabilityPool, "StabilityPool", state)
		const vesselManager = await this.deployUpgradable(VesselManager, "VesselManager", state)
		const vesselManagerOperations = await this.deployUpgradable(VesselMgrOps, "VesselManagerOperations", state)

		// Non-upgradable contracts
		const gasPool = await this.deployNonUpgradable(GasPool, "GasPool", state)
		const timelock = await this.deployNonUpgradable(Timelock, "Timelock", state, [
			this.shortTimelockDelay,
			this.configParams.SYSTEM_PARAMS_ADMIN,
		])

		const debtTokenParams = [
			vesselManager.address,
			stabilityPool.address,
			borrowerOperations.address,
			timelock.address,
		]
		const debtToken = await this.deployNonUpgradable(DebtToken, "DebtToken", state, debtTokenParams)

		await this.verifyCoreContracts(state, debtTokenParams)

		const coreContracts = {
			activePool,
			adminContract,
			borrowerOperations,
			collSurplusPool,
			debtToken,
			defaultPool,
			feeCollector,
			gasPool,
			priceFeed,
			sortedVessels,
			stabilityPool,
			timelock,
			vesselManager,
			vesselManagerOperations,
		}
		await this.logContractObjects(coreContracts)
		return coreContracts
	}

	async connectCoreContracts(contracts, treasuryAddress) {
		console.log("Connecting core contracts...")

		await this.setAddresses("ActivePool", contracts.activePool, [
			contracts.borrowerOperations.address,
			contracts.collSurplusPool.address,
			contracts.defaultPool.address,
			contracts.stabilityPool.address,
			contracts.vesselManager.address,
			contracts.vesselManagerOperations.address,
		])

		await this.setAddresses("AdminContract", contracts.adminContract, [
			ZERO_ADDRESS,
			contracts.activePool.address,
			contracts.defaultPool.address,
			contracts.stabilityPool.address,
			contracts.collSurplusPool.address,
			contracts.priceFeed.address,
			contracts.timelock.address,
		])

		await this.setAddresses("BorrowerOperations", contracts.borrowerOperations, [
			contracts.vesselManager.address,
			contracts.stabilityPool.address,
			contracts.gasPool.address,
			contracts.collSurplusPool.address,
			contracts.sortedVessels.address,
			contracts.debtToken.address,
			contracts.feeCollector.address,
			contracts.adminContract.address,
		])

		await this.setAddresses("CollSurplusPool", contracts.collSurplusPool, [
			contracts.activePool.address,
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			contracts.vesselManagerOperations.address,
		])

		await this.setAddresses("DefaultPool", contracts.defaultPool, [
			contracts.vesselManager.address,
			contracts.activePool.address,
		])

		await this.setAddresses("FeeCollector", contracts.feeCollector, [
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			ZERO_ADDRESS,
			contracts.debtToken.address,
			treasuryAddress,
			false,
		])

		await this.setAddresses("PriceFeed", contracts.priceFeed, [
			contracts.adminContract.address,
			contracts.timelock.address,
		])

		await this.setAddresses("SortedVessels", contracts.sortedVessels, [
			contracts.vesselManager.address,
			contracts.borrowerOperations.address,
		])

		await this.setAddresses("StabilityPool", contracts.stabilityPool, [
			contracts.borrowerOperations.address,
			contracts.vesselManager.address,
			contracts.activePool.address,
			contracts.debtToken.address,
			contracts.sortedVessels.address,
			ZERO_ADDRESS,
			contracts.adminContract.address,
		])

		await this.setAddresses("VesselManager", contracts.vesselManager, [
			contracts.borrowerOperations.address,
			contracts.stabilityPool.address,
			contracts.gasPool.address,
			contracts.collSurplusPool.address,
			contracts.debtToken.address,
			contracts.feeCollector.address,
			contracts.sortedVessels.address,
			contracts.vesselManagerOperations.address,
			contracts.adminContract.address,
		])

		await this.setAddresses("VesselManagerOperations", contracts.vesselManagerOperations, [
			contracts.vesselManager.address,
			contracts.sortedVessels.address,
			contracts.stabilityPool.address,
			contracts.collSurplusPool.address,
			contracts.debtToken.address,
			contracts.adminContract.address,
		])
	}

	async verifyCoreContracts(state, debtTokenParams) {
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("ActivePool", state)
			await this.verifyContract("AdminContract", state)
			await this.verifyContract("BorrowerOperations", state)
			await this.verifyContract("CollSurplusPool", state)
			await this.verifyContract("DebtToken", state, debtTokenParams)
			await this.verifyContract("DefaultPool", state)
			await this.verifyContract("FeeCollector", state)
			await this.verifyContract("GasPool", state)
			await this.verifyContract("PriceFeed", state)
			await this.verifyContract("SortedVessels", state)
			await this.verifyContract("StabilityPool", state)
			await this.verifyContract("VesselManager", state)
			await this.verifyContract("VesselManagerOperations", state)
			await this.verifyContract("Timelock", state)
		}
	}
}

module.exports = CoreDeploymentHelper
