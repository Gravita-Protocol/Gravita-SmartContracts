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
	config = configParams
	ADMIN_WALLET = config.gravitaAddresses.ADMIN_WALLET
	TREASURY_WALLET = config.gravitaAddresses.TREASURY_WALLET
	deployerWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, ethers.provider)
	// deployerWallet = (await ethers.getSigners())[0]
	assert.equal(deployerWallet.address, config.gravitaAddresses.DEPLOYER_WALLET)

	await printDeployerBalance()

	helper = new MainnetDeploymentHelper(config, deployerWallet)
	deploymentState = helper.loadPreviousDeployment()
	coreContracts = await helper.loadOrDeployCoreContracts(deploymentState)

	if (config.DEPLOY_GRVT_CONTRACTS) {
		// grvtContracts = await helper.deployGrvtContracts(TREASURY_WALLET, deploymentState)
		// await deployOnlyGRVTContracts()
		// await helper.connectgrvtContractsToCore(grvtContracts, coreContracts, TREASURY_WALLET)
		// await approveGRVTTokenAllowanceForCommunityIssuance()

		return
	}

	await helper.connectCoreContracts(coreContracts, grvtContracts, TREASURY_WALLET)

	await addCollaterals()

	await coreContracts.adminContract.setInitialized()
	await coreContracts.debtToken.setInitialized()
	// TODO set the admin address for the timelock contracts

	helper.saveDeployment(deploymentState)

	await transferContractsOwnerships()

	await printDeployerBalance()
}

// Collateral ---------------------------------------------------------------------------------------------------------

async function addCollaterals() {
	console.log("Adding Collaterals...")
	const cfg = config.externalAddrs
	// await addCollateral("cbETH", cfg.CBETH_ERC20, cfg.CHAINLINK_CBETH_USD_ORACLE)
	await addCollateral("rETH", cfg.RETH_ERC20, cfg.CHAINLINK_RETH_USD_ORACLE)
	await addCollateral("wETH", cfg.WETH_ERC20, cfg.CHAINLINK_WETH_USD_ORACLE)
	// await addCollateral("wstETH", cfg.WSTETH_ERC20, cfg.CHAINLINK_WSTETH_USD_ORACLE)
}

async function addCollateral(name, address, chainlinkPriceFeedAddress) {
	if (!address || address == "") {
		throw `Error: No address found for collateral ${name}`
	}
	if (!chainlinkPriceFeedAddress || chainlinkPriceFeedAddress == "") {
		throw `Error: No chainlink price feed address found for collateral ${name}`
	}
	const decimals = 18
	const isWrapped = true
	const gasCompensation = dec(30, 18)
	await helper.sendAndWaitForTransaction(
		coreContracts.adminContract.addNewCollateral(address, gasCompensation, decimals, isWrapped)
	)
	console.log(`[${name}] Collateral added (${address})`)
	const { queuedTxHash, eta } = await setOracle(address, chainlinkPriceFeedAddress)
	console.log(
		`[${name}] Price Feed queued (QueuedTxHash: ${queuedTxHash} ETA: ${eta} Feed: ${chainlinkPriceFeedAddress})`
	)
}

async function setOracle(collateralAddress, chainlinkPriceFeedAddress) {
	const targetAddress = coreContracts.priceFeed.address
	const maxDeviationBetweenRounds = ethers.utils.parseUnits("0.5")
	const isEthIndexed = false
	const methodSignature = "setOracle(address, address, uint256, bool)"
	const argTypes = ["address", "address", "uint256", "bool"]
	const argValues = [
		collateralAddress,
		chainlinkPriceFeedAddress,
		maxDeviationBetweenRounds.toString(),
		isEthIndexed.toString(),
	]
	const { queuedTxHash, eta } = await queueTimelockTransaction(
		coreContracts.shortTimelock,
		targetAddress,
		methodSignature,
		argTypes,
		argValues
	)
	return { queuedTxHash, eta }
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
	if ((await contract.owner()) != newOwner) await contract.transferOwnership(newOwner)
}

// Helper/utils -------------------------------------------------------------------------------------------------------

async function queueTimelockTransaction(timelockContract, targetAddress, methodSignature, argTypes, argValues) {
	const { encode: abiEncode } = new ethers.utils.AbiCoder()
	const eta = await calcETA(timelockContract)
	const value = 0
	const data = abiEncode(argTypes, argValues)

	const queuedTxHash = ethers.utils.keccak256(
		abiEncode(
			["address", "uint256", "string", "bytes", "uint256"],
			[targetAddress, value.toString(), methodSignature, data, eta.toString()]
		)
	)

	await helper.sendAndWaitForTransaction(
		timelockContract.queueTransaction(targetAddress, value, methodSignature, data, eta)
	)

	const queued = await timelockContract.queuedTransactions(queuedTxHash)
	if (!queued) {
		console.log(`WARNING: Failed to queue setOracle() function call on Timelock contract`)
	}
	return { queuedTxHash, eta }
}

async function printDeployerBalance() {
	const prevBalance = deployerBalance
	deployerBalance = await ethers.provider.getBalance(deployerWallet.address)
	const cost = prevBalance ? ethers.utils.formatUnits(prevBalance.sub(balance)) : 0
	console.log(
		`${deployerWallet.address} Balance: ${ethers.utils.formatUnits(deployerBalance)} ${
			cost ? `(Deployment cost: ${cost})` : ""
		}`
	)
}

module.exports = {
	mainnetDeploy,
}
