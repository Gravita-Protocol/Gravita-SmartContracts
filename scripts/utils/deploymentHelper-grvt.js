const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { getImplementationAddress } = require("@openzeppelin/upgrades-core")
const fs = require("fs")

const DeploymentHelper = require("./deploymentHelper-common.js")

class CoreDeploymentHelper extends DeploymentHelper {
	constructor(hre, configParams, deployerWallet) {
		super(hre, configParams, deployerWallet)
		this.shortTimelockDelay = this.isMainnet() ? 3 * 86_400 : 120 // 3 days || 2 minutes
		this.longTimelockDelay = this.isMainnet() ? 7 * 86_400 : 120 // 7 days || 2 minutes
	}

	isMainnet() {
		return "mainnet" == this.configParams.targetNetwork
	}

	async loadOrDeployCoreContracts(deploymentState, config) {
		const deployUpgradable = async (factory, name, params = []) =>
			await this.loadOrDeploy(factory, name, deploymentState, true, params)

		const deployNonUpgradable = async (factory, name, params = []) =>
			await this.loadOrDeploy(factory, name, deploymentState, false, params)

		console.log(`Deploying core contracts...`)

		const activePoolFactory = await this.getFactory("ActivePool")
		const adminContractFactory = await this.getFactory("AdminContract")
		const borrowerOperationsFactory = await this.getFactory("BorrowerOperations")
		const collSurplusPoolFactory = await this.getFactory("CollSurplusPool")
		const debtTokenFactory = await this.getFactory("DebtToken")
		const defaultPoolFactory = await this.getFactory("DefaultPool")
		const feeCollectorFactory = await this.getFactory("FeeCollector")
		const gasPoolFactory = await this.getFactory("GasPool")
		const priceFeedFactory = await this.getFactory("PriceFeed")
		const sortedVesselsFactory = await this.getFactory("SortedVessels")
		const stabilityPoolFactory = await this.getFactory("StabilityPool")
		const timelockFactory = this.isMainnet()
			? await this.getFactory("Timelock")
			: await this.getFactory("TimelockTester")
		const vesselManagerFactory = await this.getFactory("VesselManager")
		const vesselMgrOperationsFactory = await this.getFactory("VesselManagerOperations")

		// Upgradable (proxy-based) contracts
		const activePool = await deployUpgradable(activePoolFactory, "ActivePool")
		const adminContract = await deployUpgradable(adminContractFactory, "AdminContract")
		const borrowerOperations = await deployUpgradable(borrowerOperationsFactory, "BorrowerOperations")
		const collSurplusPool = await deployUpgradable(collSurplusPoolFactory, "CollSurplusPool")
		const defaultPool = await deployUpgradable(defaultPoolFactory, "DefaultPool")
		const feeCollector = await deployUpgradable(feeCollectorFactory, "FeeCollector")
		const priceFeed = await deployUpgradable(priceFeedFactory, "PriceFeed")
		const sortedVessels = await deployUpgradable(sortedVesselsFactory, "SortedVessels")
		const stabilityPool = await deployUpgradable(stabilityPoolFactory, "StabilityPool")
		const vesselManager = await deployUpgradable(vesselManagerFactory, "VesselManager")
		const vesselManagerOperations = await deployUpgradable(vesselMgrOperationsFactory, "VesselManagerOperations")

		// Non-upgradable contracts
		const gasPool = await deployNonUpgradable(gasPoolFactory, "GasPool")
		const shortTimelock = await deployNonUpgradable(timelockFactory, "ShortTimelock", [
			this.shortTimelockDelay,
			config.SYSTEM_PARAMS_ADMIN,
		])
		//const longTimelock = await deployNonUpgradable(timelockFactory, "LongTimelock", [this.longTimelockDelay])

		const debtTokenParams = [
			vesselManager.address,
			stabilityPool.address,
			borrowerOperations.address,
			shortTimelock.address,
		]
		const debtToken = await deployNonUpgradable(debtTokenFactory, "DebtToken", debtTokenParams)

		await this.verifyCoreContracts(deploymentState, debtTokenParams)

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
			shortTimelock,
			//longTimelock,
			stabilityPool,
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
			contracts.shortTimelock.address,
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
			contracts.shortTimelock.address,
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

	// Helper/utils ---------------------------------------------------------------------------------------------------

	loadPreviousDeployment() {
		let previousDeployment = {}
		if (fs.existsSync(this.configParams.OUTPUT_FILE)) {
			console.log(`Loading previous deployment from ${this.configParams.OUTPUT_FILE}...`)
			previousDeployment = JSON.parse(fs.readFileSync(this.configParams.OUTPUT_FILE))
		}
		return previousDeployment
	}

	saveDeployment(deploymentState) {
		const deploymentStateJSON = JSON.stringify(deploymentState, null, 2)
		fs.writeFileSync(this.configParams.OUTPUT_FILE, deploymentStateJSON)
	}

	async getFactory(name) {
		return await ethers.getContractFactory(name, this.deployerWallet)
	}

	async sendAndWaitForTransaction(txPromise) {
		const tx = await txPromise
		const minedTx = await ethers.provider.waitForTransaction(tx.hash, this.configParams.TX_CONFIRMATIONS)
		if (!minedTx.status) {
			throw ("Transaction Failed", txPromise)
		}
		return minedTx
	}

	async loadOrDeploy(factory, name, deploymentState, proxy, params = []) {
		if (deploymentState[name] && deploymentState[name].address) {
			console.log(`Using previous deployment: ${deploymentState[name].address} -> ${name}`)
			return await factory.attach(deploymentState[name].address)
		}
		console.log(`(Deploying ${name}...)`)
		let retry = 0
		const maxRetries = 10,
			timeout = 600_000 // milliseconds
		while (++retry < maxRetries) {
			try {
				let contract, implAddress
				if (proxy) {
					let opts = factory.interface.functions.initialize
						? { initializer: "initialize()", kind: "uups" }
						: { kind: "uups" }
					contract = await upgrades.deployProxy(factory, opts)
				} else {
					contract = await factory.deploy(...params)
				}
				await this.deployerWallet.provider.waitForTransaction(
					contract.deployTransaction.hash,
					this.configParams.TX_CONFIRMATIONS,
					timeout
				)
				deploymentState[name] = {
					address: contract.address,
					txHash: contract.deployTransaction.hash,
				}
				if (proxy) {
					implAddress = await getImplementationAddress(this.deployerWallet.provider, contract.address)
					deploymentState[name].implAddress = implAddress
				}
				this.saveDeployment(deploymentState)
				return contract
			} catch (e) {
				console.log(`[Error: ${e.message}] Retrying...`)
			}
		}
		throw Error(`ERROR: Unable to deploy contract after ${maxRetries} attempts.`)
	}

	async setAddresses(contractName, contract, addressList) {
		const gasPrice = this.configParams.GAS_PRICE
		try {
			console.log(` - ${contractName}.setAddresses()`)
			await this.sendAndWaitForTransaction(contract.setAddresses(...addressList, { gasPrice }))
			console.log(` - ${contractName}.setAddresses() -> ok`)
		} catch (e) {
			const msg = e.message || ""
			if (msg.toLowerCase().includes("already initialized")) {
				console.log(` - ${contractName}.setAddresses() -> failed (contract was already initialized)`)
			} else {
				console.log(e)
			}
		}
	}

	async isInitialized(contract) {
		let name = "?"
		try {
			name = await contract.NAME()
		} catch (e) {}
		if (contract.functions["isInitialized()"]) {
			const isInitialized = await contract.isInitialized()
			console.log(`${contract.address} ${name}.isInitialized() -> ${isInitialized}`)
			return isInitialized
		} else {
			console.log(`${contract.address} ${name} is not initializable`)
			return true
		}
	}

	async logContractObjects(contracts) {
		const names = []
		Object.keys(contracts).forEach(name => names.push(name))
		names.sort()
		for (let name of names) {
			const contract = contracts[name]
			try {
				name = await contract.NAME()
			} catch (e) {}
			console.log(`Contract deployed: ${contract.address} -> ${name}`)
		}
	}

	async verifyCoreContracts(deploymentState, debtTokenParams) {
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("ActivePool", deploymentState)
			await this.verifyContract("AdminContract", deploymentState)
			await this.verifyContract("BorrowerOperations", deploymentState)
			await this.verifyContract("CollSurplusPool", deploymentState)
			await this.verifyContract("DebtToken", deploymentState, debtTokenParams)
			await this.verifyContract("DefaultPool", deploymentState)
			await this.verifyContract("FeeCollector", deploymentState)
			await this.verifyContract("GasPool", deploymentState)
			await this.verifyContract("PriceFeed", deploymentState)
			await this.verifyContract("SortedVessels", deploymentState)
			await this.verifyContract("StabilityPool", deploymentState)
			await this.verifyContract("VesselManager", deploymentState)
			await this.verifyContract("VesselManagerOperations", deploymentState)
			await this.verifyContract("ShortTimelock", deploymentState)
			//await this.verifyContract("LongTimelock", deploymentState)
		}
	}

	async verifyContract(name, deploymentState, constructorArguments = []) {
		if (!deploymentState[name] || !deploymentState[name].address) {
			console.error(`  --> No deployment state for contract ${name}!!`)
			return
		}
		if (deploymentState[name].verification) {
			console.log(`Contract ${name} already verified`)
			return
		}
		try {
			await this.hre.run("verify:verify", {
				address: deploymentState[name].address,
				constructorArguments,
			})
		} catch (error) {
			// if it was already verified, it’s like a success, so let’s move forward and save it
			if (error.name != "NomicLabsHardhatPluginError") {
				console.error(`Error verifying: ${error.name}`)
				console.error(error)
				return
			}
		}
		deploymentState[name].verification = `${this.configParams.ETHERSCAN_BASE_URL}/${deploymentState[name].address}#code`

		this.saveDeployment(deploymentState)
	}
}

module.exports = CoreDeploymentHelper
