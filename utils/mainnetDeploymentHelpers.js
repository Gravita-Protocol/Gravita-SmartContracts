const { ethers } = require("hardhat")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const fs = require("fs")

const shortDelay = 3 * 86_400 // 3 days
const longDelay = 7 * 86_400 // 7 days

class MainnetDeploymentHelper {
	constructor(configParams, deployerWallet) {
		this.configParams = configParams
		this.deployerWallet = deployerWallet
		this.hre = require("hardhat")
	}

	loadPreviousDeployment() {
		let previousDeployment = {}
		if (fs.existsSync(this.configParams.OUTPUT_FILE)) {
			console.log(`Loading previous deployment from ${this.configParams.OUTPUT_FILE}...`)
			previousDeployment = require("../" + this.configParams.OUTPUT_FILE)
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
				const contract = await (proxy ? upgrades.deployProxy(factory) : factory.deploy(...params))
				await this.deployerWallet.provider.waitForTransaction(
					contract.deployTransaction.hash,
					this.configParams.TX_CONFIRMATIONS,
					timeout
				)
				deploymentState[name] = {
					address: contract.address,
					txHash: contract.deployTransaction.hash,
				}
				this.saveDeployment(deploymentState)
				return contract
			} catch (e) {
				console.log(`[Error: ${e.message}] Retrying...`)
			}
		}
		throw Error(`ERROR: Unable to deploy contract after ${maxRetries} attempts.`)
	}

	async deployMockERC20Contract(deploymentState, name, decimals = 18) {
		const ERC20MockFactory = await this.getFactory("ERC20Mock")
		const erc20Mock = await this.loadOrDeploy(ERC20MockFactory, name, deploymentState, false, [name, name, decimals])
		const mintAmount = "10000".concat("0".repeat(decimals))
		const accounts = await ethers.getSigners()
		for (const { address } of accounts.slice(0, 10)) {
			await erc20Mock.mint(address, mintAmount)
		}
		return erc20Mock.address
	}

	async deployPartially(treasurySigAddress, deploymentState) {
		const GRVTTokenFactory = await this.getFactory("GRVTToken")
		const lockedGrvtFactory = await this.getFactory("LockedGRVT")
		const lockedGrvt = await this.loadOrDeploy(lockedGrvtFactory, "lockedGrvt", deploymentState)
		const GRVTToken = await this.loadOrDeploy(GRVTTokenFactory, "grvtToken", deploymentState, false, [
			treasurySigAddress,
		])
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("lockedGrvt", deploymentState, [treasurySigAddress])
			await this.verifyContract("GRVTToken", deploymentState, [treasurySigAddress])
		}
		;(await this.isOwnershipRenounced(lockedGrvt)) ||
			(await this.sendAndWaitForTransaction(
				lockedGrvt.setAddresses(GRVTToken.address, { gasPrice: this.configParams.GAS_PRICE })
			))
		const grvtContracts = {
			lockedGrvt,
			GRVTToken,
		}
		await this.logContractObjects(grvtContracts)
		return grvtContracts
	}

	async deployCoreContracts(deploymentState) {
		const deployUpgradable = async (factory, name, params = []) => {
			return await this.loadOrDeploy(factory, name, deploymentState, true, params)
		}
		const deployNonUpgradable = async (factory, name, params = []) => {
			return await this.loadOrDeploy(factory, name, deploymentState, false, params)
		}

		console.log("Deploying core contracts...")

		const activePoolFactory = await this.getFactory("ActivePool")
		const adminContractFactory = await this.getFactory("AdminContract")
		const borrowerOperationsFactory = await this.getFactory("BorrowerOperations")
		const collSurplusPoolFactory = await this.getFactory("CollSurplusPool")
		const debtTokenFactory = await this.getFactory("DebtToken")
		const defaultPoolFactory = await this.getFactory("DefaultPool")
		const feeCollectorFactory = await this.getFactory("FeeCollector")
		const gasPoolFactory = await this.getFactory("GasPool")
		const lockedGrvtFactory = await this.getFactory("LockedGRVT")
		const mockAggregatorFactory = await this.getFactory("MockAggregator")
		const mockErc20Factory = await this.getFactory("ERC20Mock")
		const priceFeedFactory = await this.getFactory("PriceFeed")
		const sortedVesselsFactory = await this.getFactory("SortedVessels")
		const stabilityPoolFactory = await this.getFactory("StabilityPool")
		const timelockFactory = await this.getFactory("Timelock")
		const vesselManagerFactory = await this.getFactory("VesselManager")
		const vesselMgrOperationsFactory = await this.getFactory("VesselManagerOperations")

		let mockAggregator_debt
		let mockAggregator_grvt
		let mockAggregator_reth
		let mockAggregator_weth
		let mockAggregator_wsteth
		let mockErc20_reth
		let mockErc20_weth
		let mockErc20_wsteth

		// Local test contracts
		if ("localhost" == this.configParams.targetNetwork) {
			mockAggregator_debt = await deployNonUpgradable(mockAggregatorFactory, "mockAggregator_debt")
			mockAggregator_grvt = await deployNonUpgradable(mockAggregatorFactory, "mockAggregator_grvt")
			mockAggregator_reth = await deployNonUpgradable(mockAggregatorFactory, "mockAggregator_reth")
			mockAggregator_weth = await deployNonUpgradable(mockAggregatorFactory, "mockAggregator_weth")
			mockAggregator_wsteth = await deployNonUpgradable(mockAggregatorFactory, "mockAggregator_wsteth")
			mockErc20_reth = await deployNonUpgradable(mockErc20Factory, "mock_reth", ["mock_reth", "mock_reth", 18])
			mockErc20_weth = await deployNonUpgradable(mockErc20Factory, "mock_weth", ["mock_weth", "mock_weth", 18])
			mockErc20_wsteth = await deployNonUpgradable(mockErc20Factory, "mock_wsteth", ["mock_wsteth", "mock_wsteth", 18])

			const mintAmount = "100000".concat("0".repeat(18))
			const accounts = await ethers.getSigners()
			for (let collateral of [mockErc20_reth, mockErc20_weth, mockErc20_wsteth]) {
				for (const { address } of accounts.slice(0, 10)) {
					await collateral.mint(address, mintAmount)
				}
			}
		}

		// Upgradable (proxy-based) contracts
		const activePool = await deployUpgradable(activePoolFactory, "activePool")
		const borrowerOperations = await deployUpgradable(borrowerOperationsFactory, "borrowerOperations")
		const collSurplusPool = await deployUpgradable(collSurplusPoolFactory, "collSurplusPool")
		const defaultPool = await deployUpgradable(defaultPoolFactory, "defaultPool")
		const feeCollector = await deployUpgradable(feeCollectorFactory, "feeCollector")
		const priceFeed = await deployUpgradable(priceFeedFactory, "priceFeed")
		const sortedVessels = await deployUpgradable(sortedVesselsFactory, "sortedVessels")
		const stabilityPool = await deployUpgradable(stabilityPoolFactory, "stabilityPool")
		const vesselManager = await deployUpgradable(vesselManagerFactory, "vesselManager")
		const vesselManagerOperations = await deployUpgradable(vesselMgrOperationsFactory, "vesselManagerOperations")

		// Non-upgradable contracts
		const adminContract = await deployNonUpgradable(adminContractFactory, "adminContract")
		const gasPool = await deployNonUpgradable(gasPoolFactory, "gasPool")
		const lockedGrvt = await deployNonUpgradable(lockedGrvtFactory, "lockedGrvt")

		// Timelock contracts
		const longTimelock = await deployNonUpgradable(timelockFactory, "longTimelock", [longDelay])
		const shortTimelock = await deployNonUpgradable(timelockFactory, "shortTimelock", [shortDelay])

		const debtTokenParams = [
			vesselManager.address,
			stabilityPool.address,
			borrowerOperations.address,
			shortTimelock.address,
		]
		const debtToken = await deployNonUpgradable(debtTokenFactory, "debtToken", debtTokenParams)

		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("activePool", deploymentState)
			await this.verifyContract("adminContract", deploymentState)
			await this.verifyContract("borrowerOperations", deploymentState)
			await this.verifyContract("collSurplusPool", deploymentState)
			await this.verifyContract("debtToken", deploymentState, debtTokenParams)
			await this.verifyContract("defaultPool", deploymentState)
			await this.verifyContract("feeCollector", deploymentState)
			await this.verifyContract("gasPool", deploymentState)
			await this.verifyContract("gravityParameters", deploymentState)
			await this.verifyContract("lockedGrvt", deploymentState)
			await this.verifyContract("priceFeed", deploymentState)
			await this.verifyContract("sortedVessels", deploymentState)
			await this.verifyContract("shortTimelockContract", deploymentState)
			await this.verifyContract("stabilityPool", deploymentState)
			await this.verifyContract("vesselManager", deploymentState)
			await this.verifyContract("vesselManagerOperations", deploymentState)
		}
		const coreContracts = {
			activePool,
			adminContract,
			borrowerOperations,
			collSurplusPool,
			debtToken,
			defaultPool,
			feeCollector,
			gasPool,
			lockedGrvt,
			longTimelock,
			mockAggregator_debt,
			mockAggregator_grvt,
			mockAggregator_reth,
			mockAggregator_weth,
			mockAggregator_wsteth,
			mockErc20_reth,
			mockErc20_weth,
			mockErc20_wsteth,
			priceFeed,
			sortedVessels,
			shortTimelock,
			stabilityPool,
			vesselManager,
			vesselManagerOperations,
		}
		await this.logContractObjects(coreContracts)
		return coreContracts
	}

	/**
	 * GRVT Token related contracts deployment
	 */
	async deployGRVTTokenContracts(treasurySigAddress, deploymentState) {
		console.log("Deploying GRVT token contracts...")
		const GRVTStakingFactory = await this.getFactory("GRVTStaking")
		const communityIssuanceFactory = await this.getFactory("CommunityIssuance")
		const GRVTTokenFactory = await this.getFactory("GRVTToken")
		const GRVTStaking = await this.loadOrDeploy(GRVTStakingFactory, "GRVTStaking", deploymentState, true)
		const communityIssuance = await this.loadOrDeploy(
			communityIssuanceFactory,
			"communityIssuance",
			deploymentState,
			true
		)
		const GRVTToken = await this.loadOrDeploy(GRVTTokenFactory, "GRVTToken", deploymentState, false, [
			treasurySigAddress,
		])
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("GRVTStaking", deploymentState)
			await this.verifyContract("communityIssuance", deploymentState)
			await this.verifyContract("GRVTToken", deploymentState, [treasurySigAddress])
		}
		const grvtTokenContracts = {
			GRVTStaking,
			communityIssuance,
			GRVTToken,
		}
		await this.logContractObjects(grvtTokenContracts)
		return grvtTokenContracts
	}

	async deployMultiVesselGetterContract(liquityCore, deploymentState) {
		const multiVesselGetterFactory = await this.getFactory("MultiVesselGetter")
		const multiVesselGetterParams = [liquityCore.vesselManager.address, liquityCore.sortedVessels.address]
		const multiVesselGetter = await this.loadOrDeploy(
			multiVesselGetterFactory,
			"multiVesselGetter",
			deploymentState,
			false,
			multiVesselGetterParams
		)
		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("(No Etherscan URL defined, skipping contract verification)")
		} else {
			await this.verifyContract("multiVesselGetter", deploymentState, multiVesselGetterParams)
		}
		return multiVesselGetter
	}

	async isOwnershipRenounced(contract) {
		let name = "?"
		try {
			name = await contract.NAME()
		} catch (e) {}
		if (contract.functions["isInitialized()"]) {
			const isInitialized = await contract.isInitialized()
			console.log(`${contract.address} ${name}.isInitialized() = ${isInitialized}`)
			return isInitialized
		} else {
			console.log(`${contract.address} ${name} is not Initializable`)
			return true
		}
	}

	async setupLocalCollaterals(contracts) {
		const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp
		for (let aggregator of [
			contracts.mockAggregator_reth,
			contracts.mockAggregator_wsteth,
			contracts.mockAggregator_weth,
			contracts.mockAggregator_debt,
			contracts.mockAggregator_grvt,
		]) {
			await aggregator.setPrevRoundId(1)
			await aggregator.setLatestRoundId(2)
			await aggregator.setUpdateTime(blockTimestamp)
		}
		const setPrice = async (aggregator, price) => {
			const price8digits = price.toString().concat("0".repeat(8))
			await aggregator.setPrevPrice(price8digits)
			await aggregator.setPrice(price8digits)
		}
		await setPrice(contracts.mockAggregator_debt, 1)
		await setPrice(contracts.mockAggregator_grvt, 2)
		await setPrice(contracts.mockAggregator_reth, 1952)
		await setPrice(contracts.mockAggregator_wsteth, 1806)
		await setPrice(contracts.mockAggregator_weth, 1830)

		await contracts.priceFeed.setAddresses(
			contracts.adminContract.address,
			contracts.mockErc20_reth.address,
			this.hre.ethers.constants.AddressZero,
			contracts.mockErc20_wsteth.address
		)
		await contracts.priceFeed.addOracle(contracts.debtToken.address, contracts.mockAggregator_debt.address, false)
		await contracts.priceFeed.addOracle(contracts.mockErc20_reth.address, contracts.mockAggregator_reth.address, false)
		await contracts.priceFeed.addOracle(contracts.mockErc20_weth.address, contracts.mockAggregator_weth.address, false)
		await contracts.priceFeed.addOracle(
			contracts.mockErc20_wsteth.address,
			contracts.mockAggregator_wsteth.address,
			false
		)

		await contracts.adminContract.addNewCollateral(contracts.mockErc20_reth.address, 18, true)
		await contracts.adminContract.addNewCollateral(contracts.mockErc20_weth.address, 18, true)
		await contracts.adminContract.addNewCollateral(contracts.mockErc20_wsteth.address, 18, true)

		await contracts.adminContract.setAsDefault(contracts.mockErc20_reth.address)
		await contracts.adminContract.setAsDefault(contracts.mockErc20_weth.address)
		await contracts.adminContract.setAsDefault(contracts.mockErc20_wsteth.address)
	}

	// Connect contracts to their dependencies
	async connectCoreContracts(contracts, GRVTContracts, treasuryAddress) {
		console.log("Connecting core contracts...")
		const gasPrice = this.configParams.GAS_PRICE

		;(await this.isOwnershipRenounced(contracts.activePool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.activePool.setAddresses(
					contracts.borrowerOperations.address,
					contracts.collSurplusPool.address,
					contracts.defaultPool.address,
					contracts.stabilityPool.address,
					contracts.vesselManager.address,
					contracts.vesselManagerOperations.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.adminContract)) ||
			(await this.sendAndWaitForTransaction(
				contracts.adminContract.setAddresses(
					GRVTContracts.communityIssuance.address,
					contracts.activePool.address,
					contracts.defaultPool.address,
					contracts.stabilityPool.address,
					contracts.collSurplusPool.address,
					contracts.priceFeed.address,
					contracts.shortTimelock.address,
					contracts.longTimelock.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.borrowerOperations)) ||
			(await this.sendAndWaitForTransaction(
				contracts.borrowerOperations.setAddresses(
					contracts.vesselManager.address,
					contracts.stabilityPool.address,
					contracts.gasPool.address,
					contracts.collSurplusPool.address,
					contracts.sortedVessels.address,
					contracts.debtToken.address,
					contracts.feeCollector.address,
					contracts.adminContract.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.collSurplusPool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.collSurplusPool.setAddresses(
					contracts.activePool.address,
					contracts.borrowerOperations.address,
					contracts.vesselManager.address,
					contracts.vesselManagerOperations.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.defaultPool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.defaultPool.setAddresses(contracts.vesselManager.address, contracts.activePool.address, { gasPrice })
			))
		;(await this.isOwnershipRenounced(contracts.feeCollector)) ||
			(await this.sendAndWaitForTransaction(
				contracts.feeCollector.setAddresses(
					contracts.borrowerOperations.address,
					contracts.vesselManager.address,
					GRVTContracts.GRVTStaking.address,
					contracts.debtToken.address,
					treasuryAddress,
					false,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.sortedVessels)) ||
			(await this.sendAndWaitForTransaction(
				contracts.sortedVessels.setAddresses(contracts.vesselManager.address, contracts.borrowerOperations.address, {
					gasPrice,
				})
			))
		;(await this.isOwnershipRenounced(contracts.stabilityPool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.stabilityPool.setAddresses(
					contracts.borrowerOperations.address,
					contracts.vesselManager.address,
					contracts.activePool.address,
					contracts.debtToken.address,
					contracts.sortedVessels.address,
					GRVTContracts.communityIssuance.address,
					contracts.adminContract.address
				)
			))
		;(await this.isOwnershipRenounced(contracts.vesselManager)) ||
			(await this.sendAndWaitForTransaction(
				contracts.vesselManager.setAddresses(
					contracts.borrowerOperations.address,
					contracts.stabilityPool.address,
					contracts.gasPool.address,
					contracts.collSurplusPool.address,
					contracts.debtToken.address,
					contracts.feeCollector.address,
					contracts.sortedVessels.address,
					contracts.vesselManagerOperations.address,
					contracts.adminContract.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.vesselManagerOperations)) ||
			(await this.sendAndWaitForTransaction(
				contracts.vesselManagerOperations.setAddresses(
					contracts.vesselManager.address,
					contracts.sortedVessels.address,
					contracts.stabilityPool.address,
					contracts.collSurplusPool.address,
					contracts.debtToken.address,
					contracts.adminContract.address,
					{ gasPrice }
				)
			))

		if ("localhost" == this.configParams.targetNetwork) {
			await this.setupLocalCollaterals(contracts)
		} else {
			// Mainnet and Goerli testnet Oracle setup
			const { CBETH_ERC20, RETH_ERC20, STETH_ERC20, WSTETH_ERC20 } = this.configParams.externalAddrs
			const { CHAINLINK_ETH_USD_ORACLE, CHAINLINK_CBETH_ETH_ORACLE, CHAINLINK_STETH_USD_ORACLE } =
				this.configParams.externalAddrs
			;(await this.isOwnershipRenounced(contracts.priceFeed)) ||
				(await this.sendAndWaitForTransaction(
					contracts.priceFeed.setAddresses(contracts.adminContract.address, RETH_ERC20, STETH_ERC20, WSTETH_ERC20, {
						gasPrice,
					})
				))
			if (CHAINLINK_ETH_USD_ORACLE && CHAINLINK_ETH_USD_ORACLE != "") {
				console.log("Adding ETH-USD Oracle...")
				await contracts.priceFeed.addOracle(ZERO_ADDRESS, CHAINLINK_ETH_USD_ORACLE, false)
			}
			if (CHAINLINK_CBETH_ETH_ORACLE && CHAINLINK_CBETH_ETH_ORACLE != "") {
				console.log("Adding cbETH-ETH Oracle...")
				await contracts.priceFeed.addOracle(CBETH_ERC20, CHAINLINK_CBETH_ETH_ORACLE, true)
			}
			if (CHAINLINK_STETH_USD_ORACLE && CHAINLINK_STETH_USD_ORACLE != "") {
				console.log("Adding stETH-USD Oracle...")
				await contracts.priceFeed.addOracle(STETH_ERC20, CHAINLINK_STETH_USD_ORACLE, false)
			}
		}
	}

	async connectGRVTTokenContractsToCore(GRVTContracts, coreContracts, treasuryAddress) {
		console.log("Connecting GRVT Token Contracts to Core...")
		const gasPrice = this.configParams.GAS_PRICE
		;(await this.isOwnershipRenounced(GRVTContracts.GRVTStaking)) ||
			(await this.sendAndWaitForTransaction(
				GRVTContracts.GRVTStaking.setAddresses(
					GRVTContracts.GRVTToken.address,
					coreContracts.debtToken.address,
					coreContracts.feeCollector.address,
					coreContracts.vesselManager.address,
					treasuryAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(GRVTContracts.communityIssuance)) ||
			(await this.sendAndWaitForTransaction(
				GRVTContracts.communityIssuance.setAddresses(
					GRVTContracts.GRVTToken.address,
					coreContracts.stabilityPool.address,
					coreContracts.adminContract.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(coreContracts.lockedGrvt)) ||
			(await this.sendAndWaitForTransaction(
				coreContracts.lockedGrvt.setAddresses(GRVTContracts.GRVTToken.address, { gasPrice })
			))
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
}

module.exports = MainnetDeploymentHelper
