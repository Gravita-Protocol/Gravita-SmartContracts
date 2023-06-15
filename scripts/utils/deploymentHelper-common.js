const { getImplementationAddress } = require("@openzeppelin/upgrades-core")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")

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
		let retry = 0
		const maxRetries = 10
		const timeout = 600_000 // 10 minutes
		const factory = await this.getFactory(contractName, this.deployerWallet)
		const address = state[contractName]?.address
		const alreadyDeployed = state[contractName] && address
		if (!isUpgradeable) {
			if (alreadyDeployed) {
				// Non-Upgradeable contract, already deployed
				console.log(`Using previous deployment: ${address} -> ${contractName}`)
				return await factory.attach(address)
			} else {
				// Non-Upgradeable contract, new deployment
				console.log(`(Deploying ${contractName}...)`)
				while (++retry < maxRetries) {
					try {
						const contract = await factory.deploy(...params)
						await this.deployerWallet.provider.waitForTransaction(
							contract.deployTransaction.hash,
							this.configParams.TX_CONFIRMATIONS,
							timeout
						)
						await contract.deployed()
						await this.updateState(contractName, contract, isUpgradeable, state)
						return contract
					} catch (e) {
						console.log(`[Error: ${e.message}] Retrying...`)
					}
				}
				throw Error(`ERROR: Unable to deploy contract ${contractName} after ${maxRetries} attempts.`)
			}
		}
		if (alreadyDeployed) {
			// Existing upgradeable contract
			const existingContract = await factory.attach(address)
			console.log(`Using previous deployment: ${address} -> ${contractName}`)
			return existingContract
		} else {
			// Upgradeable contract, new deployment
			console.log(`(Deploying ${contractName}...)`)
			let opts = { kind: "uups" }
			if (factory.interface.functions["initialize()"]) {
				opts.initializer = "initialize()"
			}
			while (++retry < maxRetries) {
				try {
					const newContract = await upgrades.deployProxy(factory, opts)
					await this.deployerWallet.provider.waitForTransaction(
						newContract.deployTransaction.hash,
						this.configParams.TX_CONFIRMATIONS,
						timeout
					)
					await newContract.deployed()
					await this.updateState(contractName, newContract, isUpgradeable, state)
					return newContract
				} catch (e) {
					console.log(`[Error: ${e.message}] Retrying...`)
				}
			}
			throw Error(`ERROR: Unable to deploy contract ${contractName} after ${maxRetries} attempts.`)
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
