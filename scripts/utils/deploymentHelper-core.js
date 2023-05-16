const DeploymentHelper = require("./deploymentHelper-common.js")

const readline = require("readline-sync")

function checkContinue() {
	var userinput = readline.question(`\nContinue? [y/N]\n`);
  if (userinput.toLowerCase() !== 'y') {
		process.exit()
  }
}

class CoreDeploymentHelper extends DeploymentHelper {
	constructor(hre, configParams, deployerWallet) {
		super(hre, configParams, deployerWallet)
		this.shortTimelockDelay = 2 * 86_400 // 2 days
		this.longTimelockDelay = 7 * 86_400 // 7 days
		this.state = this.loadPreviousDeployment()
	}

	async loadOrDeployOrUpgradeCoreContracts() {
		console.log(`Deploying core contracts...`)

		const timelockParams = [this.shortTimelockDelay, this.configParams.SYSTEM_PARAMS_ADMIN]
		const timelock = await this.deployNonUpgradeable("Timelock", timelockParams)
		const debtToken = await this.deployNonUpgradeable("DebtToken")

		process.exit()

		// 11 Upgradeable contracts
		const [activePool, upgraded1] = await this.deployUpgradeable("ActivePool")
		const [adminContract, upgraded2] = await this.deployUpgradeable("AdminContract")
		const [borrowerOperations, upgraded3] = await this.deployUpgradeable("BorrowerOperations")
		checkContinue()
		const [collSurplusPool, upgraded4] = await this.deployUpgradeable("CollSurplusPool")
		const [defaultPool, upgraded5] = await this.deployUpgradeable("DefaultPool")
		const [feeCollector, upgraded6] = await this.deployUpgradeable("FeeCollector")
		checkContinue()
		const [priceFeed, upgraded7] = await this.deployUpgradeable("PriceFeed")
		const [sortedVessels, upgraded8] = await this.deployUpgradeable("SortedVessels")
		const [stabilityPool, upgraded9] = await this.deployUpgradeable("StabilityPool")
		checkContinue()
		const [vesselManager, upgraded10] = await this.deployUpgradeable("VesselManager")
		const [vesselManagerOperations, upgraded11] = await this.deployUpgradeable("VesselManagerOperations")

		const allUpgraded =
			upgraded1 &&
			upgraded2 &&
			upgraded3 &&
			upgraded4 &&
			upgraded5 &&
			upgraded6 &&
			upgraded7 &&
			upgraded8 &&
			upgraded9 &&
			upgraded10 &&
			upgraded11

		// 3 Non-upgradable contracts
		const gasPool = await this.deployNonUpgradeable("GasPool")

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
		return { contracts, allUpgraded }
	}

	async deployUpgradeable(contractName, params = []) {
		const isUpgradeable = true
		return await this.loadOrDeployOrUpgrade(contractName, this.state, isUpgradeable, params)
	}

	async deployNonUpgradeable(contractName, params = []) {
		const isUpgradeable = false
		const result = await this.loadOrDeployOrUpgrade(contractName, this.state, isUpgradeable, params)
		return result[0] // second result item refers to upgrade status, not applicable
	}

	async verifyCoreContracts() {
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("ActivePool", this.state)
			await this.verifyContract("AdminContract", this.state)
			await this.verifyContract("BorrowerOperations", this.state)
			await this.verifyContract("CollSurplusPool", this.state)
			await this.verifyContract("DebtToken", this.state)
			await this.verifyContract("DefaultPool", this.state)
			await this.verifyContract("FeeCollector", this.state)
			await this.verifyContract("GasPool", this.state)
			await this.verifyContract("PriceFeed", this.state)
			await this.verifyContract("SortedVessels", this.state)
			await this.verifyContract("StabilityPool", this.state)
			await this.verifyContract("VesselManager", this.state)
			await this.verifyContract("VesselManagerOperations", this.state)
			await this.verifyContract("Timelock", this.state)
		}
	}
}

module.exports = CoreDeploymentHelper
