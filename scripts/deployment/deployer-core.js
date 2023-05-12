const { Manifest, getAdminAddress } = require("@openzeppelin/upgrades-core")
const { getParsedEthersError } = require("@enzoferey/ethers-error-parser")

const DeploymentHelper = require("../utils/deploymentHelpers.js")

/**
 * Enum type for available target networks; each should have a matching file in the config folder.
 */
const DeploymentTarget = Object.freeze({
	Localhost: "localhost",
	GoerliTestnet: "goerli",
	Mainnet: "mainnet",
})

/**
 * Exported deployment script, invoked from hardhat tasks defined on hardhat.config.js
 */
class Deployer {
	hre
	helper
	config
	deployerWallet
	deployerBalance
	coreContracts
	grvtContracts = []
	deploymentState

	constructor(hre, targetNetwork) {
		const validTargets = Object.values(DeploymentTarget)
		if (!validTargets.includes(targetNetwork)) {
			console.log(`Please specify a target network. Valid options: ${validTargets.join(" | ")}`)
			throw Error()
		}
		this.targetNetwork = targetNetwork
		this.hre = hre
	}

	async run() {
		console.log(`Deploying Gravita on ${this.targetNetwork}...`)
		this.initConfigArgs()
		await this.printDeployerBalance()

		this.coreContracts = await this.helper.loadOrDeployCoreContracts(this.deploymentState)

		await this.helper.connectCoreContracts(this.coreContracts, this.grvtContracts, this.config.TREASURY_WALLET)

		await this.addCollaterals()

		await this.toggleContractSetupInitialization(this.coreContracts.adminContract)
		await this.toggleContractSetupInitialization(this.coreContracts.debtToken)

		// TODO timelock.setPendingAdmin() via queueTransaction()

		this.helper.saveDeployment(this.deploymentState)

		await this.transferUpgradesProxyAdminOwnerships()

		await this.transferContractsOwnerships()

		await this.printDeployerBalance()
	}

	// Collateral ---------------------------------------------------------------------------------------------------------

	async addCollaterals() {
		console.log("Adding Collateral...")
		for (const coll of this.config.COLLATERAL) {
			if (!coll.address || coll.address == "") {
				console.log(`[${coll.name}] WARNING: No address setup for collateral`)
				continue
			}
			if (!coll.oracleAddress || coll.oracleAddress == "") {
				console.log(`[${coll.name}] WARNING: No price feed oracle address setup for collateral`)
				continue
			}
			await this.addPriceFeedOracle(coll)
			await this.addCollateral(coll)
			await this.setCollateralParams(coll)
		}
	}

	async addPriceFeedOracle(coll) {
		const oracleRecord = await this.coreContracts.priceFeed.oracleRecords(coll.address)

		if (!oracleRecord.exists) {
			console.log(`[${coll.name}] PriceFeed.setOracle()`)
			await this.helper.sendAndWaitForTransaction(
				this.coreContracts.priceFeed.setOracle(
					coll.address,
					coll.oracleAddress,
					coll.oraclePriceDeviation.toString(),
					coll.oracleIsEthIndexed
				)
			)
			console.log(`[${coll.name}] Oracle Price Feed has been set @ ${coll.oracleAddress}`)
		} else {
			if (oracleRecord.chainLinkOracle == coll.oracleAddress) {
				console.log(`[${coll.name}] Oracle Price Feed had already been set @ ${coll.oracleAddress}`)
			} else {
				console.log(
					`[${coll.name}] WARNING: another oracle had already been set, please update via Timelock.setOracle()`
				)
			}
		}
	}

	async addCollateral(coll) {
		const collExists = (await this.coreContracts.adminContract.getMcr(coll.address)).gt(0)

		if (collExists) {
			console.log(`[${coll.name}] NOTICE: collateral has already been added before`)
		} else {
			const decimals = 18
			await this.helper.sendAndWaitForTransaction(
				this.coreContracts.adminContract.addNewCollateral(coll.address, coll.gasCompensation, decimals)
			)
			console.log(`[${coll.name}] Collateral added @ ${coll.address}`)
		}
	}

	async setCollateralParams(coll) {
		const isActive = await this.coreContracts.adminContract.getIsActive(coll.address)
		if (isActive) {
			console.log(`[${coll.name}] NOTICE: collateral params have already been set`)
		} else {
			console.log(`[${coll.name}] Setting collateral params...`)
			const defaultPercentDivisor = await this.coreContracts.adminContract.PERCENT_DIVISOR_DEFAULT()
			const defaultBorrowingFee = await this.coreContracts.adminContract.BORROWING_FEE_DEFAULT()
			const defaultRedemptionFeeFloor = await this.coreContracts.adminContract.REDEMPTION_FEE_FLOOR_DEFAULT()
			await this.helper.sendAndWaitForTransaction(
				this.coreContracts.adminContract.setCollateralParameters(
					coll.address,
					defaultBorrowingFee,
					coll.CCR,
					coll.MCR,
					coll.minNetDebt,
					coll.mintCap,
					defaultPercentDivisor,
					defaultRedemptionFeeFloor
				)
			)
			console.log(`[${coll.name}] AdminContract.setCollateralParameters() -> ok`)
		}
	}

	// Contract ownership -------------------------------------------------------------------------------------------------

	/**
	 * Transfers the ProxyAdmin's Upgrades ownerships to the address defined on config's UPGRADES_PROXY_ADMIN.
	 */
	async transferUpgradesProxyAdminOwnerships() {
		const gnosisSafeAddress = this.config.UPGRADES_PROXY_ADMIN
		if (!gnosisSafeAddress) {
			throw Error("Provide an address for UPGRADES_PROXY_ADMIN in the config file before transferring the ownership.")
		}
		console.log("Transferring ownership of ProxyAdmin (Upgrades)...")

		const manifest = await Manifest.forNetwork(this.hre.network.provider)
		const manifestAdmin = await manifest.getAdmin()
		const proxyAdminAddress = manifestAdmin?.address
		if (proxyAdminAddress === undefined) {
			throw new Error("No ProxyAdmin (Upgrades) was found in the network manifest")
		}
		if (proxyAdminAddress != this.deployerWallet.address) {
			console.log(
				`Manifest's ProxyAdmin (${proxyAdminAddress}) does not match deployer (${this.deployerWallet.address})`
			)
		}
		if (proxyAdminAddress == gnosisSafeAddress) {
			console.log(`ProxyAdmin (Upgrades) is already set to destination address ${gnosisSafeAddress}`)
		} else {
			await upgrades.admin.transferProxyAdminOwnership(gnosisSafeAddress)
			console.log(`Transferred ownership of ProxyAdmin (Upgrades) to UPGRADES_PROXY_ADMIN @ ${gnosisSafeAddress}`)
		}
	}

	/**
	 * Transfers the ownership of all Ownable contracts to the address defined on config's SYSTEM_PARAMS_ADMIN.
	 */
	async transferContractsOwnerships() {
		const sysAdminAddress = this.config.SYSTEM_PARAMS_ADMIN
		if (!sysAdminAddress || sysAdminAddress == this.hre.ethers.constants.AddressZero) {
			throw Error("Provide an address for SYSTEM_PARAMS_ADMIN in the config file before transferring the ownerships.")
		}
		console.log(`Transferring contract ownerships...`)
		for (const contract of Object.values(this.coreContracts)) {
			if (!contract.transferOwnership) {
				console.log(` - ${await contract.NAME()} is NOT Ownable`)
			} else {
				const currentOwner = await contract.owner()
				if (currentOwner == sysAdminAddress) {
					console.log(` - ${await contract.NAME()} -> Owner had already been set to @ ${sysAdminAddress}`)
				} else {
					try {
						await this.helper.sendAndWaitForTransaction(contract.transferOwnership(sysAdminAddress))
						console.log(` - ${await contract.NAME()} -> Owner set to SYSTEM_PARAMS_ADMIN @ ${sysAdminAddress}`)
					} catch (e) {
						const parsedEthersError = getParsedEthersError(e)
						const errorMsg = parsedEthersError.context || parsedEthersError.errorCode
						console.log(` - ${await contract.NAME()} -> ERROR: ${errorMsg} [owner = ${currentOwner}]`)
					}
				}
			}
		}
	}

	// Helper/utils -------------------------------------------------------------------------------------------------------

	initConfigArgs() {
		const configParams = require(`./config/${this.targetNetwork}.js`)
		if (!process.env.DEPLOYER_PRIVATEKEY) {
			throw Error("Provide a value for DEPLOYER_PRIVATEKEY in your .env file")
		}
		this.config = configParams
		this.deployerWallet = new this.hre.ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, this.hre.ethers.provider)
		this.helper = new DeploymentHelper(configParams, this.deployerWallet)
		this.deploymentState = this.helper.loadPreviousDeployment()
	}

	async toggleContractSetupInitialization(contract) {
		const name = await contract.NAME()
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
