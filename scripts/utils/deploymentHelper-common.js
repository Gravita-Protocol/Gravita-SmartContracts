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

	async loadOrDeployOrUpgrade(contractName, state, isUpgradeable, params) {
		const timeout = 600_000 // 10 minutes
		const factory = await this.getFactory(contractName, this.deployerWallet)
		const address = state[contractName]?.address
		const alreadyDeployed = state[contractName] && address
		if (!isUpgradeable) {
			if (alreadyDeployed) {
				// Non-Upgradeable contract, already deployed
				console.log(`Using previous deployment: ${address} -> ${contractName}`)
				return [await factory.attach(address), false]
			} else {
				// Non-Upgradeable contract, new deployment
				console.log(`(Deploying new ${contractName}...)`)
				const newContract = await factory.deploy(...params)
				await this.deployerWallet.provider.waitForTransaction(
					newContract.deployTransaction.hash,
					this.configParams.TX_CONFIRMATIONS,
					timeout
				)
				await newContract.deployed()
				await this.updateState(contractName, newContract, isUpgradeable, state)
				return [newContract, false]
			}
		}
		if (alreadyDeployed) {
			// Existing upgradeable contract
			console.log(`(Upgrading ${contractName}...)`)
			const upgradedContract = await upgrades.upgradeProxy(address, factory, params)
			await this.deployerWallet.provider.waitForTransaction(
				upgradedContract.deployTransaction.hash,
				this.configParams.TX_CONFIRMATIONS,
				timeout
			)
			await this.updateState(contractName, upgradedContract, isUpgradeable, state)
			return [upgradedContract, true]
		} else {
			// Upgradeable contract, new deployment
			console.log(`(Deploying new ${contractName}...)`)
			let opts = { kind: "uups" }
			if (factory.interface.functions.initialize) {
				opts.initializer = "initialize()"
			}
			const newContract = await upgrades.deployProxy(factory, opts)
			await this.deployerWallet.provider.waitForTransaction(
				newContract.deployTransaction.hash,
				this.configParams.TX_CONFIRMATIONS,
				timeout
			)
			await newContract.deployed()
			await this.updateState(contractName, newContract, isUpgradeable, state)
			return [newContract, false]
		}
	}

	async updateState(contractName, contract, isUpgradeable, state) {
		state[contractName] = {
			address: contract.address,
			txHash: contract.deployTransaction.hash,
		}
		let implAddress
		if (isUpgradeable) {
			implAddress = await getImplementationAddress(this.deployerWallet.provider, contract.address)
			state[contractName].implAddress = implAddress
		}
		this.saveDeployment(state)
	}

	async getContractName(contract) {
		try {
			return await contract.NAME()
		} catch (e) {
			return "?"
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
