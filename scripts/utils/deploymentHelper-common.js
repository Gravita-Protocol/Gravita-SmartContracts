const { getImplementationAddress } = require("@openzeppelin/upgrades-core")
const fs = require("fs")

/* abstract */ class DeploymentHelper {
	constructor(hre, configParams, deployerWallet) {
		if (this.constructor === DeploymentHelper) {
			throw new Error("Abstract Class")
		}
		this.hre = hre
		this.configParams = configParams
		this.deployerWallet = deployerWallet
	}

	isMainnet() {
		return "mainnet" == this.configParams.targetNetwork
	}

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

  async deployUpgradable(factory, contractName, state, params = []) {
		const isUpgradeable = true
		return await this.loadOrDeploy(factory, contractName, state, isUpgradeable, params)
	}

	async deployNonUpgradable(factory, contractName, state, params = []) {
		const isUpgradeable = false
		return await this.loadOrDeploy(factory, contractName, state, isUpgradeable, params)
	}

	async loadOrDeploy(factory, contractName, deploymentState, isUpgradeable, params) {
		if (deploymentState[contractName] && deploymentState[contractName].address) {
			console.log(`Using previous deployment: ${deploymentState[contractName].address} -> ${contractName}`)
			return await factory.attach(deploymentState[contractName].address)
		}
		console.log(`(Deploying ${contractName}...)`)
		let retry = 0
		const maxRetries = 10,
			timeout = 600_000 // milliseconds
		while (++retry < maxRetries) {
			try {
				let contract, implAddress
				if (isUpgradeable) {
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
				deploymentState[contractName] = {
					address: contract.address,
					txHash: contract.deployTransaction.hash,
				}
				if (isUpgradeable) {
					implAddress = await getImplementationAddress(this.deployerWallet.provider, contract.address)
					deploymentState[contractName].implAddress = implAddress
				}
				this.saveDeployment(deploymentState)
				return contract
			} catch (e) {
				console.log(`[Error: ${e.message}] Retrying...`)
			}
		}
		throw Error(`ERROR: Unable to deploy contract ${contractName} after ${maxRetries} attempts.`)
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

	async getContractName(contract) {
		try {
			return await contract.NAME()
		} catch (e) {
			return "?"
		}
	}

	async isInitialized(contract) {
		let name = await this.getContractName()
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

module.exports = DeploymentHelper
