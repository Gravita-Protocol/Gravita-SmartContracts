import { HardhatRuntimeEnvironment } from "hardhat/types"
import { getImplementationAddress, EthereumProvider } from "@openzeppelin/upgrades-core"
import { BigNumber, Contract, Wallet } from "ethers"
import { ZERO_ADDRESS } from "@openzeppelin/test-helpers/src/constants"
import { getParsedEthersError } from "@enzoferey/ethers-error-parser"
import fs from "fs"
import { upgrades } from "hardhat"

/**
 * Available target networks; each should have a matching file in the config folder.
 */
enum DeploymentTarget {
	Localhost = "localhost",
	GoerliTestnet = "goerli",
	ArbitrumGoerliTestnet = "arbitrum-goerli",
	ZkSyncTestnet = "zksync-testnet",
	Mainnet = "mainnet",
}

/**
 * Exported deployment script, invoked from hardhat tasks defined on hardhat.config.js
 */
class CoreDeployer {
	config: any
	coreContracts: any
	deployerBalance: BigNumber
	deployerWallet: Wallet
	hre: HardhatRuntimeEnvironment
	state: any
	targetNetwork: DeploymentTarget

	constructor(hre: HardhatRuntimeEnvironment, targetNetwork: DeploymentTarget) {
		const configParams = require(`./config/${this.targetNetwork}.js`)
		if (!process.env.DEPLOYER_PRIVATEKEY) {
			throw Error("Provide a value for DEPLOYER_PRIVATEKEY in your .env file")
		}
		this.config = configParams
		this.deployerWallet = new this.hre.ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, this.hre.ethers.provider)
		this.hre = hre
		this.targetNetwork = targetNetwork
	}

	async run() {
		console.log(`Deploying Gravita Core on ${this.targetNetwork}...`)

		await this.printDeployerBalance()

		await this.loadOrDeployCoreContracts()
		await this.connectCoreContracts()
		await this.addCollaterals()

		// disable admin->timelock toggle for now
		// await this.toggleContractSetupInitialization(this.coreContracts.adminContract)

		await this.verifyCoreContracts()

		// disable ownership transfer for now
		// await this.transferContractsOwnerships(contracts)

		await this.printDeployerBalance()
	}

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
			if (coll.name == "wETH") {
				// use the same oracle for wETH and ETH
				await this.addPriceFeedOracle({ ...coll, name: "ETH", address: ZERO_ADDRESS })
			}
		}
	}

	async addPriceFeedOracle(coll: any) {
		const oracleRecord = await this.coreContracts.priceFeed.oracles(coll.address)
		if (oracleRecord.decimals == 0) {
			const owner = await this.coreContracts.priceFeed.owner()
			if (owner != this.deployerWallet.address) {
				console.log(
					`[${coll.name}] NOTICE: Cannot call PriceFeed.setOracle(): deployer = ${this.deployerWallet.address}, owner = ${owner}`
				)
				return
			}
			console.log(`[${coll.name}] PriceFeed.setOracle()`)
			const oracleProviderType = 0 // IPriceFeed.sol :: enum ProviderType.Chainlink
			const isFallback = false
			await this.sendAndWaitForTransaction(
				this.coreContracts.priceFeed.setOracle(
					coll.address,
					coll.oracleAddress,
					oracleProviderType,
					coll.oracleTimeoutMinutes,
					coll.oracleIsEthIndexed,
					isFallback
				)
			)
			console.log(`[${coll.name}] Oracle Price Feed has been set @ ${coll.oracleAddress}`)
		} else {
			if (oracleRecord.oracleAddress == coll.oracleAddress) {
				console.log(`[${coll.name}] Oracle Price Feed had already been set @ ${coll.oracleAddress}`)
			} else {
				console.log(
					`[${coll.name}] WARNING: another oracle had already been set, please update via Timelock.setOracle()`
				)
			}
		}
	}

	async addCollateral(coll: any) {
		const collExists = (await this.coreContracts.adminContract.getMcr(coll.address)).gt(0)
		if (collExists) {
			console.log(`[${coll.name}] NOTICE: collateral has already been added before`)
		} else {
			const decimals = 18
			console.log(`[${coll.name}] AdminContract.addNewCollateral() ...`)
			await this.sendAndWaitForTransaction(
				this.coreContracts.adminContract.addNewCollateral(coll.address, coll.gasCompensation, decimals)
			)
			console.log(`[${coll.name}] Collateral added @ ${coll.address}`)
		}
	}

	/**
	 * Configs one collateral on AdminContract based on default values + parameters from the config file.
	 */
	async setCollateralParams(coll: any) {
		const isActive = await this.coreContracts.adminContract.getIsActive(coll.address)
		if (isActive) {
			console.log(`[${coll.name}] NOTICE: collateral params have already been set`)
		} else {
			console.log(`[${coll.name}] Setting collateral params...`)
			const defaultPercentDivisor = await this.coreContracts.adminContract.PERCENT_DIVISOR_DEFAULT()
			const defaultBorrowingFee = await this.coreContracts.adminContract.BORROWING_FEE_DEFAULT()
			const defaultRedemptionFeeFloor = await this.coreContracts.adminContract.REDEMPTION_FEE_FLOOR_DEFAULT()
			await this.sendAndWaitForTransaction(
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

	/**
	 * Transfers the ownership of all Ownable contracts to the address defined on config's CONTRACT_UPGRADES_ADMIN.
	 */
	async transferContractsOwnerships(contracts) {
		const upgradesAdmin = this.config.CONTRACT_UPGRADES_ADMIN
		if (!upgradesAdmin || upgradesAdmin == this.hre.ethers.constants.AddressZero) {
			throw Error(
				"Provide an address for CONTRACT_UPGRADES_ADMIN in the config file before transferring the ownerships."
			)
		}
		console.log(`\r\nTransferring contract ownerships to ${upgradesAdmin}...`)
		for (const contract of Object.values(contracts)) {
			let name = await this.getContractName(contract)
			if (!(contract as any).transferOwnership) {
				console.log(` - ${name} is NOT Ownable`)
			} else {
				const currentOwner = await (contract as any).owner()
				if (currentOwner == upgradesAdmin) {
					console.log(` - ${name} -> Owner had already been set to @ ${upgradesAdmin}`)
				} else {
					try {
						await this.sendAndWaitForTransaction((contract as any).transferOwnership(upgradesAdmin))
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

	/**
	 * If contract has an isSetupInitialized flag, set it to true via setSetupIsInitialized()
	 */
	async toggleContractSetupInitialization(contract: any) {
		let name = await this.getContractName(contract)
		if (!contract.isSetupInitialized) {
			console.log(`[NOTICE] ${name} does not have an isSetupInitialized flag!`)
			return
		}
		const isSetupInitialized = await contract.isSetupInitialized()
		if (isSetupInitialized) {
			console.log(`${name} is already initialized!`)
		} else {
			await this.sendAndWaitForTransaction(contract.setSetupIsInitialized())
			console.log(`${name} has been initialized`)
		}
	}

	async getContractName(contract: any): Promise<string> {
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

	isTestnetDeployment() {
		return this.targetNetwork != DeploymentTarget.Mainnet
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

		let timelockDelay: number
		let timelockFactoryName: string
		if (this.isTestnetDeployment()) {
			timelockDelay = 5 * 60 // 5 minutes
			timelockFactoryName = "TimelockTester"
		} else {
			timelockDelay = 2 * 86_400 // 2 days
			timelockFactoryName = "Timelock"
		}
		const timelockParams = [timelockDelay, this.config.SYSTEM_PARAMS_ADMIN]
		const timelock = await this.deployNonUpgradeable(timelockFactoryName, timelockParams)
		await this.verifyContract(timelockFactoryName, timelockParams)

		let debtToken: Contract
		if (this.config.GRAI_TOKEN_ADDRESS) {
			console.log(`Using existing DebtToken from ${this.config.GRAI_TOKEN_ADDRESS}`)
			debtToken = await this.hre.ethers.getContractAt("DebtToken", this.config.GRAI_TOKEN_ADDRESS)
		} else {
			debtToken = await this.deployNonUpgradeable("DebtToken")
			await debtToken.setAddresses(borrowerOperations.address, stabilityPool.address, vesselManager.address)
		}

		const contracts = {
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
		return contracts
	}

	async connectCoreContracts() {
		const setAddresses = async contract => {
			const addresses = [
				this.coreContracts.activePool.address,
				this.coreContracts.adminContract.address,
				this.coreContracts.borrowerOperations.address,
				this.coreContracts.collSurplusPool.address,
				this.coreContracts.debtToken.address,
				this.coreContracts.defaultPool.address,
				this.coreContracts.feeCollector.address,
				this.coreContracts.gasPool.address,
				this.coreContracts.priceFeed.address,
				this.coreContracts.sortedVessels.address,
				this.coreContracts.stabilityPool.address,
				this.coreContracts.timelock.address,
				this.config.TREASURY_WALLET,
				this.coreContracts.vesselManager.address,
				this.coreContracts.vesselManagerOperations.address,
			]
			for (const [i, addr] of addresses.entries()) {
				if (!addr || addr == ZERO_ADDRESS) {
					throw new Error(`setAddresses :: Invalid address for index ${i}`)
				}
			}
			await contract.setAddresses(addresses)
		}
		for (const key in this.coreContracts) {
			const contract = this.coreContracts[key]
			if (contract.setAddresses && contract.isAddressSetupInitialized) {
				const isAddressSetupInitialized = await contract.isAddressSetupInitialized()
				if (!isAddressSetupInitialized) {
					console.log(`${key}.setAddresses()...`)
					try {
						await setAddresses(contract)
					} catch (e) {
						console.log(`${key}.setAddresses() failed!`)
					}
				} else {
					console.log(`${key}.setAddresses() already set!`)
				}
			} else {
				console.log(`(${key} has no setAddresses() or isAddressSetupInitialized() function)`)
			}
		}
	}

	async deployUpgradeable(contractName: string, params: string[] = []) {
		const isUpgradeable = true
		return await this.loadOrDeploy(contractName, this.state, isUpgradeable, params)
	}

	async deployNonUpgradeable(contractName: string, params: string[] = []) {
		const isUpgradeable = false
		return await this.loadOrDeploy(contractName, this.state, isUpgradeable, params)
	}

	async verifyCoreContracts() {
		if (!this.config.ETHERSCAN_BASE_URL) {
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
		}
	}

	loadPreviousDeployment() {
		let previousDeployment = {}
		if (fs.existsSync(this.config.OUTPUT_FILE)) {
			console.log(`Loading previous deployment from ${this.config.OUTPUT_FILE}...`)
			previousDeployment = JSON.parse(fs.readFileSync(this.config.OUTPUT_FILE, 'utf-8'))
		}
		this.state = previousDeployment
	}

	saveDeployment() {
		const deploymentStateJSON = JSON.stringify(this.state, null, 2)
		fs.writeFileSync(this.config.OUTPUT_FILE, deploymentStateJSON)
	}

	async getFactory(name: string) {
		return await this.hre.ethers.getContractFactory(name, this.deployerWallet)
	}

	async sendAndWaitForTransaction(txPromise) {
		const tx = await txPromise
		const minedTx = await this.hre.ethers.provider.waitForTransaction(tx.hash, this.config.TX_CONFIRMATIONS)
		if (!minedTx.status) {
			throw Error("Transaction Failed")
		}
		return minedTx
	}

	async loadOrDeploy(contractName: string, state: any, isUpgradeable: boolean, params: string[]) {
		let retry = 0
		const maxRetries = 10
		const timeout = 600_000 // 10 minutes
		const factory = await this.getFactory(contractName)
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
							this.config.TX_CONFIRMATIONS,
							timeout
						)
						await contract.deployed()
						await this.updateState(contractName, contract, isUpgradeable)
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
			let opts: any = { kind: "uups" }
			if (factory.interface.functions["initialize()"]) {
				opts.initializer = "initialize()"
			}
			while (++retry < maxRetries) {
				try {
					const newContract = await upgrades.deployProxy(factory, opts)
					await this.deployerWallet.provider.waitForTransaction(
						newContract.deployTransaction.hash,
						this.config.TX_CONFIRMATIONS,
						timeout
					)
					await newContract.deployed()
					await this.updateState(contractName, newContract, isUpgradeable)
					return newContract
				} catch (e) {
					console.log(`[Error: ${e.message}] Retrying...`)
				}
			}
			throw Error(`ERROR: Unable to deploy contract ${contractName} after ${maxRetries} attempts.`)
		}
	}

	async updateState(contractName: string, contract: Contract, isUpgradeable: boolean) {
		this.state[contractName] = {
			address: contract.address,
			txHash: contract.deployTransaction.hash,
		}
		if (isUpgradeable) {
			const provider: EthereumProvider = this.deployerWallet.provider as unknown as EthereumProvider
			const implAddress = await getImplementationAddress(provider, contract.address)
			this.state[contractName].implAddress = implAddress
		}
		this.saveDeployment()
	}

	async logContractObjects(contracts) {
		const names: string[] = []
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

	async verifyContract(name: string, constructorArguments: string[] = []) {
		if (!this.state[name] || !this.state[name].address) {
			console.error(`  --> No deployment state for contract ${name}!!`)
			return
		}
		if (this.state[name].verification) {
			console.log(`Contract ${name} already verified`)
			return
		}
		try {
			await this.hre.run("verify:verify", {
				address: this.state[name].address,
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
		this.state[name].verification = `${this.config.ETHERSCAN_BASE_URL}/${this.state[name].address}#code`
		this.saveDeployment()
	}
}

module.exports = CoreDeployer
