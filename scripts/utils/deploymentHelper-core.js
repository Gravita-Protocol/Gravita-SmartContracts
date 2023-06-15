const { DeploymentTestnets } = require("../deployment/deployer-common.js")
const DeploymentHelper = require("./deploymentHelper-common.js")

const readline = require("readline-sync")

class CoreDeploymentHelper extends DeploymentHelper {
	constructor(hre, configParams, deployerWallet, targetNetwork) {
		super(hre, configParams, deployerWallet)
		this.isTestnet = DeploymentTestnets.includes(targetNetwork)
		this.state = this.loadPreviousDeployment()
	}

	async loadOrDeployCoreContracts() {
		console.log(`Deploying core contracts...`)

		const activePool = await this.deployUpgradeable("ActivePool")
		const adminContract = await this.deployUpgradeable("AdminContract")
		const borrowerOperations = await this.deployUpgradeable("BorrowerOperations")
		const collSurplusPool = await this.deployUpgradeable("CollSurplusPool")
		const defaultPool = await this.deployUpgradeable("DefaultPool")
		const feeCollector = await this.deployUpgradeable("FeeCollector")
		const priceFeed = await this.deployUpgradeable("PriceFeed")
		const sortedVessels = await this.deployUpgradeable("SortedVessels")
		const stabilityPool = await this.deployUpgradeable("StabilityPool")
		const vesselManager = await this.deployUpgradeable("VesselManager")
		const vesselManagerOperations = await this.deployUpgradeable("VesselManagerOperations")

		const gasPool = await this.deployNonUpgradeable("GasPool")

		let timelock, timelockDelay, timelockFactory
		if (this.isTestnet) {
			timelockDelay = 5 * 60 // 5 minutes
			timelockFactory = "TimelockTester"
		} else {
			timelockDelay = 2 * 86_400 // 2 days
			timelockFactory = "Timelock"
		}
		const timelockParams = [timelockDelay, this.configParams.SYSTEM_PARAMS_ADMIN]
		timelock = await this.deployNonUpgradeable(timelockFactory, timelockParams)

		// Debt Token is already deployed on L2
		// const debtToken = await this.deployNonUpgradeable("DebtToken")

		const contracts = {
			activePool,
			adminContract,
			borrowerOperations,
			collSurplusPool,
			// debtToken,
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
		return contracts
	}

	async connectCoreContracts(contracts, debtTokenAddress, treasuryAddress) {
		console.log(`debtToken: ${debtTokenAddress} treasury: ${treasuryAddress}`)
		const setAddresses = async contract => {
			await contract.setAddresses([
				contracts.activePool.address,
				contracts.adminContract.address,
				contracts.borrowerOperations.address,
				contracts.collSurplusPool.address,
				debtTokenAddress,
				contracts.defaultPool.address,
				contracts.feeCollector.address,
				contracts.gasPool.address,
				contracts.priceFeed.address,
				contracts.sortedVessels.address,
				contracts.stabilityPool.address,
				contracts.timelock.address,
				treasuryAddress,
				contracts.vesselManager.address,
				contracts.vesselManagerOperations.address,
			])
		}
		for (const key in contracts) {
			const contract = contracts[key]
			if (contract.setAddresses) {
				const isAddressSetupInitialized = await contract.isAddressSetupInitialized()
				if (!isAddressSetupInitialized) {
					console.log(`${key}.setAddresses()...`)
					await setAddresses(contract)
				}
			}
		}
	}

	async deployUpgradeable(contractName, params = []) {
		const isUpgradeable = true
		return await this.loadOrDeployOrUpgrade(contractName, this.state, isUpgradeable, params)
	}

	async deployNonUpgradeable(contractName, params = []) {
		const isUpgradeable = false
		return await this.loadOrDeployOrUpgrade(contractName, this.state, isUpgradeable, params)
	}

	async verifyCoreContracts() {
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("ActivePool", this.state)
			await this.verifyContract("AdminContract", this.state)
			await this.verifyContract("BorrowerOperations", this.state)
			await this.verifyContract("CollSurplusPool", this.state)
			// await this.verifyContract("DebtToken", this.state)
			await this.verifyContract("DefaultPool", this.state)
			await this.verifyContract("FeeCollector", this.state)
			await this.verifyContract("GasPool", this.state)
			await this.verifyContract("PriceFeed", this.state)
			await this.verifyContract("SortedVessels", this.state)
			await this.verifyContract("StabilityPool", this.state)
			await this.verifyContract("VesselManager", this.state)
			await this.verifyContract("VesselManagerOperations", this.state)
			await this.verifyContract(this.isTestnet ? "TimelockTester" : "Timelock", this.state)
		}
	}
}

module.exports = CoreDeploymentHelper
