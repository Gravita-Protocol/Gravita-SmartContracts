const { TestHelper: th } = require("../utils/testHelpers.js")
const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ethers } = require("hardhat")

let helper
let config
let deployerWallet
let deployerBalance
let coreContracts
let grvtContracts = []
let deploymentState

let ADMIN_WALLET
let TREASURY_WALLET

async function mainnetDeploy(configParams) {
	initConfigArgs(configParams)
	await printDeployerBalance()

	coreContracts = await helper.loadOrDeployCoreContracts(deploymentState)

	if (config.DEPLOY_GRVT_CONTRACTS) {
		// grvtContracts = await helper.deployGrvtContracts(TREASURY_WALLET, deploymentState)
		// await deployOnlyGRVTContracts()
		// await helper.connectgrvtContractsToCore(grvtContracts, coreContracts, TREASURY_WALLET)
		// await approveGRVTTokenAllowanceForCommunityIssuance()

		return
	}

	// await helper.connectCoreContracts(coreContracts, grvtContracts, TREASURY_WALLET)

	await addCollaterals()

	// await toggleContractInitialization(coreContracts.adminContract)
	// await toggleContractInitialization(coreContracts.debtToken)

	// TODO timelock.setPendingAdmin() via queueTransaction()

	helper.saveDeployment(deploymentState)

	// await transferContractsOwnerships()

	await printDeployerBalance()
}

// Collateral ---------------------------------------------------------------------------------------------------------

async function addCollaterals() {
	console.log("Adding Collaterals...")
	const cfg = config.externalAddrs
	const maxDeviationBetweenRounds = ethers.utils.parseUnits("0.5") // TODO personalize for each collateral
	const isEthIndexed = false // TODO personalize for each collateral

	// await addCollateral("cbETH", cfg.CBETH_ERC20, cfg.CHAINLINK_CBETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
	await addCollateral("rETH", cfg.RETH_ERC20, cfg.CHAINLINK_RETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
	await addCollateral("wETH", cfg.WETH_ERC20, cfg.CHAINLINK_WETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
	// await addCollateral("wstETH", cfg.WSTETH_ERC20, cfg.CHAINLINK_WSTETH_USD_ORACLE, maxDeviationBetweenRounds, isEthIndexed)
}

async function addCollateral(name, address, chainlinkPriceFeedAddress, maxDeviationBetweenRounds, isEthIndexed) {
	if (!address || address == "") {
		console.log(`[${name}] WARNING: No address found for collateral`)
		return
	}

	if (!chainlinkPriceFeedAddress || chainlinkPriceFeedAddress == "") {
		console.log(`[${name}] WARNING: No chainlink price feed address found for collateral`)
		return
	}

	const collExists = async () => (await coreContracts.adminContract.getMcr(address)).gt(0)

	if (await collExists(address)) {
		console.log(`[${name}] NOTICE: collateral has already been added before`)
	} else {
		const decimals = 18
		const isWrapped = false
		const gasCompensation = th.dec(30, 18)
		await helper.sendAndWaitForTransaction(
			coreContracts.adminContract.addNewCollateral(address, gasCompensation, decimals, isWrapped)
		)
		console.log(`[${name}] Collateral added @ ${address}`)
	}

	const oracleRecord = await coreContracts.priceFeed.oracleRecords(address)

	if (!oracleRecord.exists) {
		console.log(`[${name}] PriceFeed.setOracle()`)
		await helper.sendAndWaitForTransaction(
			coreContracts.priceFeed.setOracle(
				address,
				chainlinkPriceFeedAddress,
				maxDeviationBetweenRounds.toString(),
				isEthIndexed.toString()
			)
		)
		console.log(`[${name}] Chainlink Oracle Price Feed has been set @ ${chainlinkPriceFeedAddress}`)
	} else {
		if (oracleRecord.chainLinkOracle == chainlinkPriceFeedAddress) {
			console.log(`[${name}] Chainlink Oracle Price Feed had already been set @ ${chainlinkPriceFeedAddress}`)
		} else {
			console.log(`[${name}] Timelock.setOracle()`)
			const { txHash, eta } = await setOracleViaTimelock(address, chainlinkPriceFeedAddress, maxDeviationBetweenRounds)
			console.log(
				`[${name}] setOracle() queued on Timelock (TxHash: ${txHash} ETA: ${eta} Feed: ${chainlinkPriceFeedAddress})`
			)
		}
	}
}

async function setOracleViaTimelock(
	collateralAddress,
	chainlinkPriceFeedAddress,
	maxDeviationBetweenRounds,
	isEthIndexed
) {
	const targetAddress = coreContracts.priceFeed.address
	const methodSignature = "setOracle(address, address, uint256, bool)"
	const argTypes = ["address", "address", "uint256", "bool"]
	const argValues = [
		collateralAddress,
		chainlinkPriceFeedAddress,
		maxDeviationBetweenRounds.toString(),
		isEthIndexed.toString(),
	]
	return await queueTimelockTransaction(
		coreContracts.timelock,
		targetAddress,
		methodSignature,
		argTypes,
		argValues
	)
}

// GRVT contracts deployment ------------------------------------------------------------------------------------------

async function deployOnlyGRVTContracts() {
	console.log("INIT GRVT ONLY")
	const partialContracts = await helper.deployPartially(TREASURY_WALLET, deploymentState)
	// create vesting rule to beneficiaries
	console.log("Beneficiaries")
	if ((await partialContracts.GRVTToken.allowance(deployerWallet.address, partialContracts.lockedGrvt.address)) == 0) {
		await partialContracts.GRVTToken.approve(partialContracts.lockedGrvt.address, ethers.constants.MaxUint256)
	}
	for (const [wallet, amount] of Object.entries(config.beneficiaries)) {
		if (amount == 0) continue
		if (!(await partialContracts.lockedGrvt.isEntityExits(wallet))) {
			console.log("Beneficiary: %s for %s", wallet, amount)
			const txReceipt = await helper.sendAndWaitForTransaction(
				partialContracts.lockedGrvt.addEntityVesting(wallet, th.dec(amount, 18))
			)
			deploymentState[wallet] = {
				amount: amount,
				txHash: txReceipt.transactionHash,
			}
			helper.saveDeployment(deploymentState)
		}
	}
	await transferOwnership(partialContracts.lockedGrvt, TREASURY_WALLET)
	const balance = await partialContracts.GRVTToken.balanceOf(deployerWallet.address)
	console.log(`Sending ${balance} GRVT to ${TREASURY_WALLET}`)
	await partialContracts.GRVTToken.transfer(TREASURY_WALLET, balance)
	console.log(`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`)
}

async function approveGRVTTokenAllowanceForCommunityIssuance() {
	const allowance = await grvtContracts.GRVTToken.allowance(
		deployerWallet.address,
		grvtContracts.communityIssuance.address
	)
	if (allowance == 0) {
		await grvtContracts.GRVTToken.approve(grvtContracts.communityIssuance.address, ethers.constants.MaxUint256)
	}
}

// Contract ownership -------------------------------------------------------------------------------------------------

async function transferContractsOwnerships() {
	// TODO review contracts owners and update this function
	const adminOwnedContracts = [
		coreContracts.adminContract,
		coreContracts.debtToken,
		coreContracts.feeCollector,
		grvtContracts.GRVTStaking,
	]
	if ("localhost" != config.targetNetwork) {
		adminOwnedContracts.push(coreContracts.priceFeed) // PriceFeed test contract is not Ownable
	}
	const treasuryOwnedContracts = [coreContracts.lockedGrvt, grvtContracts.communityIssuance]
	for (const contract of adminOwnedContracts) {
		await transferOwnership(contract, ADMIN_WALLET)
	}
	for (const contract of treasuryOwnedContracts) {
		await transferOwnership(contract, TREASURY_WALLET)
	}
}

async function transferOwnership(contract, newOwner) {
	if (!newOwner || newOwner == ethers.constants.AddressZero) {
		throw "Transfering ownership to null/zero address"
	}
	let contractName = "?"
	try {
		contractName = await contract.NAME()
	} catch (e) {}
	const newOwnerName = newOwner == TREASURY_WALLET ? "Treasury" : newOwner == ADMIN_WALLET ? "Admin" : undefined
	if (newOwnerName) {
		console.log(`Transferring ownership: ${contract.address} -> ${newOwner} ${contractName} -> ${newOwnerName}`)
	} else {
		console.log(
			`WARNING!!! Transfer of contract ${contractName} (${contract.address}) ownership to an address ${newOwner} that is neither ADMIN nor TREASURY`
		)
	}
	if ((await contract.owner()) != newOwner) {
		await helper.sendAndWaitForTransaction(contract.transferOwnership(newOwner))
	}
}

// Timelock functions -------------------------------------------------------------------------------------------------

async function queueTimelockTransaction(timelockContract, targetAddress, methodSignature, argTypes, argValues) {
	const abi = new ethers.utils.AbiCoder()
	const eta = await calcTimelockETA(timelockContract)
	const value = 0
	const data = abi.encode(argTypes, argValues)

	const txHash = ethers.utils.keccak256(
		abi.encode(
			["address", "uint256", "string", "bytes", "uint256"],
			[targetAddress, value.toString(), methodSignature, data, eta.toString()]
		)
	)

	await helper.sendAndWaitForTransaction(
		timelockContract.queueTransaction(targetAddress, value, methodSignature, data, eta)
	)

	const queued = await timelockContract.queuedTransactions(txHash)
	if (!queued) {
		console.log(`WARNING: Failed to queue ${methodSignature} function call on Timelock contract`)
	} else {
		console.log(`queueTimelockTransaction() :: ${methodSignature} queued`)
		console.log(`queueTimelockTransaction() :: ETA = ${eta} (${new Date(eta * 1000).toLocaleString()})`)
		console.log(`queueTimelockTransaction() :: Remember to call executeTransaction() upon ETA!`)
	}
	return { txHash, eta }
}

async function calcTimelockETA(timelockContract) {
	const delay = Number(await timelockContract.delay())
	return (await getBlockTimestamp()) + delay + 60
}

// Helper/utils -------------------------------------------------------------------------------------------------------

function initConfigArgs(configParams) {
	config = configParams
	ADMIN_WALLET = config.gravitaAddresses.ADMIN_WALLET
	TREASURY_WALLET = config.gravitaAddresses.TREASURY_WALLET
	deployerWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, ethers.provider)
	// deployerWallet = (await ethers.getSigners())[0]
	assert.equal(deployerWallet.address, config.gravitaAddresses.DEPLOYER_WALLET)

	helper = new MainnetDeploymentHelper(config, deployerWallet)
	deploymentState = helper.loadPreviousDeployment()
}

async function getBlockTimestamp() {
	const currentBlock = await ethers.provider.getBlockNumber()
	return Number((await ethers.provider.getBlock(currentBlock)).timestamp)
}

async function toggleContractInitialization(contract) {
	const isInitialized = await contract.isInitialized()
	if (isInitialized) {
		const name = await contract.NAME()
		console.log(`NOTICE: ${contract.address} -> ${name} is already initialized`)
	} else {
		await helper.sendAndWaitForTransaction(
			contract.setInitialized()
		)		
	}
}

async function printDeployerBalance() {
	const prevBalance = deployerBalance
	deployerBalance = await ethers.provider.getBalance(deployerWallet.address)
	const cost = prevBalance ? ethers.utils.formatUnits(prevBalance.sub(deployerBalance)) : 0
	console.log(
		`${deployerWallet.address} Balance: ${ethers.utils.formatUnits(deployerBalance)} ${
			cost ? `(Deployment cost: ${cost})` : ""
		}`
	)
}

module.exports = {
	mainnetDeploy,
}

