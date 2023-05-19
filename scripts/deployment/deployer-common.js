const { getParsedEthersError } = require("@enzoferey/ethers-error-parser")

const readline = require("readline-sync")

/**
 * Enum type for available target networks; each should have a matching file in the config folder.
 */
const DeploymentTarget = Object.freeze({
	Localhost: "localhost",
	GoerliTestnet: "goerli",
	Mainnet: "mainnet",
})

function checkContinue() {
	var userinput = readline.question(`\nContinue? [y/N]\n`);
  if (userinput.toLowerCase() !== 'y') {
		process.exit()
  }
}

/**
 * Exported deployment script, invoked from hardhat tasks defined on hardhat.config.js
 */
/* abstract */ class Deployer {
	hre
	config
	deployerWallet
	deployerBalance

	constructor(hre, targetNetwork) {
		if (this.constructor === Deployer) {
			throw new Error("Abstract Class")
		}
		this.hre = hre
		const validTargets = Object.values(DeploymentTarget)
		if (!validTargets.includes(targetNetwork)) {
			console.log(`Please specify a target network. Valid options: ${validTargets.join(" | ")}`)
			throw Error()
		}
		this.targetNetwork = targetNetwork
		const configParams = require(`./config/${this.targetNetwork}.js`)
		if (!process.env.DEPLOYER_PRIVATEKEY) {
			throw Error("Provide a value for DEPLOYER_PRIVATEKEY in your .env file")
		}
		this.config = configParams
		this.deployerWallet = new this.hre.ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, this.hre.ethers.provider)
	}


	// Contract ownership -------------------------------------------------------------------------------------------------

	/**
	 * Transfers the ownership of all Ownable contracts to the address defined on config's CONTRACT_UPGRADES_ADMIN.
	 */
	async transferContractsOwnerships(contracts) {
		const upgradesAdmin = this.config.CONTRACT_UPGRADES_ADMIN
		if (!upgradesAdmin || upgradesAdmin == this.hre.ethers.constants.AddressZero) {
			throw Error("Provide an address for CONTRACT_UPGRADES_ADMIN in the config file before transferring the ownerships.")
		}
		console.log(`\r\nAll Ownable contracts are about to be transferred to the address ${upgradesAdmin}`)
		checkContinue()
		console.log(`\r\nTransferring contract ownerships...`)
		for (const contract of Object.values(contracts)) {
			let name = await this.getContractName(contract)
			if (!contract.transferOwnership) {
				console.log(` - ${name} is NOT Ownable`)
			} else {
				const currentOwner = await contract.owner()
				if (currentOwner == upgradesAdmin) {
					console.log(` - ${name} -> Owner had already been set to @ ${upgradesAdmin}`)
				} else {
					try {
						await this.helper.sendAndWaitForTransaction(contract.transferOwnership(upgradesAdmin))
						console.log(` - ${name} -> Owner set to CONTRACT_UPGRADES_ADMIN @ ${upgradesAdmin}`)
					} catch (e) {
						const parsedEthersError = getParsedEthersError(e)
						const errorMsg = parsedEthersError.context || parsedEthersError.errorCode
						console.log(` - ${name} -> ERROR: ${errorMsg} [owner = ${currentOwner}]`)
					}
				}
			}
		}
	}

	// Helper/utils -------------------------------------------------------------------------------------------------------

	/**
	 * If contract has an isSetupInitialized flag, set it to true via setSetupIsInitialized()
	 */
	async toggleContractSetupInitialization(contract) {
		let name = await this.getContractName(contract)
		if (!contract.isSetupInitialized) {
			console.log(`[NOTICE] ${name} does not have an isSetupInitialized flag!`)
			return
		}
		const isSetupInitialized = await contract.isSetupInitialized()
		if (isSetupInitialized) {
			console.log(`${name} is already initialized!`)
		} else {
			await this.helper.sendAndWaitForTransaction(contract.setSetupIsInitialized())
			console.log(`${name} has been initialized`)
		}
	}

	async getContractName(contract) {
		try {
			return await contract.NAME()
		} catch (e) {
      return "?"
    }
  }

	async printDeployerBalance() {
		const prevBalance = this.deployerBalance
		this.deployerBalance = await this.hre.ethers.provider.getBalance(this.deployerWallet.address)
		const cost = prevBalance ? this.hre.ethers.utils.formatUnits(prevBalance.sub(this.deployerBalance)) : 0
		console.log(
			`${this.deployerWallet.address} Balance: ${this.hre.ethers.utils.formatUnits(this.deployerBalance)} ${
				cost ? `(Deployment cost: ${cost})` : ""
			}`
		)
	}
}

module.exports = {
	Deployer,
	DeploymentTarget,
}
