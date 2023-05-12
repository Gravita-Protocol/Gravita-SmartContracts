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
		console.log(`Deploying on ${this.targetNetwork}...`)
		this.initConfigArgs()
		await this.printDeployerBalance()

		this.coreContracts = await this.helper.loadOrDeployCoreContracts(this.deploymentState)

		if (this.config.DEPLOY_GRVT_CONTRACTS) {
			// grvtContracts = await helper.deployGrvtContracts(TREASURY_WALLET, deploymentState)
			// await deployOnlyGRVTContracts()
			// await helper.connectgrvtContractsToCore(grvtContracts, coreContracts, TREASURY_WALLET)
			// await approveGRVTTokenAllowanceForCommunityIssuance()
			// await this.transferGrvtContractsOwnerships()
			return
		}

		await this.helper.connectCoreContracts(
			this.coreContracts,
			this.grvtContracts,
			this.config.TREASURY_WALLET
		)

		await this.addCollaterals()

		await this.toggleContractInitialization(this.coreContracts.adminContract)
		await this.toggleContractInitialization(this.coreContracts.debtToken)

		// TODO timelock.setPendingAdmin() via queueTransaction()

		this.helper.saveDeployment(this.deploymentState)

		await this.transferUpgradesProxyAdminOwnership()

		await this.transferCoreContractsOwnerships()

		await this.printDeployerBalance()
	}

	// Collateral ---------------------------------------------------------------------------------------------------------

	async addCollaterals() {
		console.log("Adding Collaterals...")
		const cfg = this.config.COLLATERAL_ADDRESSES
		const maxDeviationBetweenRounds = this.hre.ethers.utils.parseUnits("0.5") // TODO personalize for each collateral
		const isEthIndexed = false // TODO personalize for each collateral

		await this.addCollateral("rETH", cfg.RETH_ERC20, cfg.RETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
		await this.addCollateral("wETH", cfg.WETH_ERC20, cfg.WETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
		await this.addCollateral("wstETH", cfg.WSTETH_ERC20, cfg.WSTETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
	}

	async addCollateral(name, address, chainlinkPriceFeedAddress, maxDeviationBetweenRounds, isEthIndexed) {
		if (!address || address == "") {
			console.log(`[${name}] WARNING: No address found for collateral`)
			return
		}

		if (!chainlinkPriceFeedAddress || chainlinkPriceFeedAddress == "") {
			console.log(`[${name}] WARNING: No chainlink price feed address found for collateral`)
			return
		}

		const collExists = async () => (await this.coreContracts.adminContract.getMcr(address)).gt(0)

		if (await collExists(address)) {
			console.log(`[${name}] NOTICE: collateral has already been added before`)
		} else {
			const decimals = 18
			const isWrapped = false // TODO remove this property from the contracts (unused)
			const gasCompensation = this.hre.ethers.utils.parseUnits("30")
			await this.helper.sendAndWaitForTransaction(
				this.coreContracts.adminContract.addNewCollateral(address, gasCompensation, decimals, isWrapped)
			)
			console.log(`[${name}] Collateral added @ ${address}`)
		}

		const oracleRecord = await this.coreContracts.priceFeed.oracleRecords(address)

		if (!oracleRecord.exists) {
			console.log(`[${name}] PriceFeed.setOracle()`)
			await this.helper.sendAndWaitForTransaction(
				this.coreContracts.priceFeed.setOracle(
					address,
					chainlinkPriceFeedAddress,
					maxDeviationBetweenRounds.toString(),
					isEthIndexed
				)
			)
			console.log(`[${name}] Chainlink Oracle Price Feed has been set @ ${chainlinkPriceFeedAddress}`)
		} else {
			if (oracleRecord.chainLinkOracle == chainlinkPriceFeedAddress) {
				console.log(`[${name}] Chainlink Oracle Price Feed had already been set @ ${chainlinkPriceFeedAddress}`)
			} else {
				console.log(`[${name}] NOTICE: another oracle has already been set, please update via Timelock.setOracle()`)
			}
		}

		const isActive = await this.coreContracts.adminContract.getIsActive(address)
		if (!isActive) {
			console.log(`[${name}] Activating collateral...`)
			await this.helper.sendAndWaitForTransaction(this.coreContracts.adminContract.setActive(address, true))
			console.log(`[${name}] AdminContract.setActive() -> ok`)
		}
	}

	// GRVT contracts deployment ------------------------------------------------------------------------------------------

	// async deployOnlyGRVTContracts() {
	// 	console.log("INIT GRVT ONLY")
	// 	const partialContracts = await helper.deployPartially(TREASURY_WALLET, deploymentState)
	// 	// create vesting rule to beneficiaries
	// 	console.log("Beneficiaries")
	// 	if (
	// 		(await partialContracts.GRVTToken.allowance(deployerWallet.address, partialContracts.lockedGrvt.address)) == 0
	// 	) {
	// 		await partialContracts.GRVTToken.approve(partialContracts.lockedGrvt.address, ethers.constants.MaxUint256)
	// 	}
	// 	for (const [wallet, amount] of Object.entries(config.GRVT_BENEFICIARIES)) {
	// 		if (amount == 0) continue
	// 		if (!(await partialContracts.lockedGrvt.isEntityExits(wallet))) {
	// 			console.log("Beneficiary: %s for %s", wallet, amount)
	// 			const txReceipt = await helper.sendAndWaitForTransaction(
	// 				partialContracts.lockedGrvt.addEntityVesting(wallet, amount.concat("0".repeat(18)))
	// 			)
	// 			deploymentState[wallet] = {
	// 				amount: amount,
	// 				txHash: txReceipt.transactionHash,
	// 			}
	// 			helper.saveDeployment(deploymentState)
	// 		}
	// 	}
	// 	await transferOwnership(partialContracts.lockedGrvt, TREASURY_WALLET)
	// 	const balance = await partialContracts.GRVTToken.balanceOf(deployerWallet.address)
	// 	console.log(`Sending ${balance} GRVT to ${TREASURY_WALLET}`)
	// 	await partialContracts.GRVTToken.transfer(TREASURY_WALLET, balance)
	// 	console.log(`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`)
	// }

	// async approveGRVTTokenAllowanceForCommunityIssuance() {
	// 	const allowance = await grvtContracts.GRVTToken.allowance(
	// 		deployerWallet.address,
	// 		grvtContracts.communityIssuance.address
	// 	)
	// 	if (allowance == 0) {
	// 		await grvtContracts.GRVTToken.approve(grvtContracts.communityIssuance.address, ethers.constants.MaxUint256)
	// 	}
	// }

	// Contract ownership -------------------------------------------------------------------------------------------------

	/**
	 * Transfers the ProxyAdmin's Upgrades ownership to the address defined on config's UPGRADES_PROXY_ADMIN.
	 */
	async transferUpgradesProxyAdminOwnership() {
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
	 * Transfers the ownership of all (core) Ownable contracts to the address defined on config's SYSTEM_PARAMS_ADMIN.
	 */
	async transferCoreContractsOwnerships() {
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

	async transferGrvtContractsOwnerships() {
		// TODO
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

	async toggleContractInitialization(contract) {
		const name = await contract.NAME()
		const isInitialized = await contract.isInitialized()
		if (isInitialized) {
			console.log(`${name} is already initialized!`)
		} else {
			await this.helper.sendAndWaitForTransaction(contract.setInitialized())
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
