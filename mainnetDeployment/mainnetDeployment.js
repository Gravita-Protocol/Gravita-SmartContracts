const { TestHelper: th } = require("../utils/testHelpers.js")
const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ethers } = require("hardhat")

let helper
let config
let deployerWallet
let coreContracts
let grvtTokenContracts
let deploymentState

let ADMIN_WALLET
let TREASURY_WALLET

async function mainnetDeploy(configParams) {
	config = configParams

	ADMIN_WALLET = config.gravityAddresses.ADMIN_WALLET
	TREASURY_WALLET = config.gravityAddresses.TREASURY_WALLET
	deployerWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, ethers.provider)
	// deployerWallet = (await ethers.getSigners())[0]
	const initialBalance = await ethers.provider.getBalance(deployerWallet.address)
	console.log(`Deployer: ${deployerWallet.address}`)
	console.log(`Initial balance: ${ethers.utils.formatUnits(initialBalance)}`)

	helper = new MainnetDeploymentHelper(config, deployerWallet)
	deploymentState = helper.loadPreviousDeployment()

	assert.equal(deployerWallet.address, config.gravityAddresses.DEPLOYER_WALLET)

	if (config.GRVT_TOKEN_ONLY) {
		await deployOnlyGRVTContract()
		return
	}

	coreContracts = await helper.deployCoreContracts(deploymentState, ADMIN_WALLET)
	grvtTokenContracts = await helper.deployGRVTTokenContracts(
		TREASURY_WALLET, // multisig GRVT endowment address
		deploymentState
	)

	await helper.connectCoreContracts(coreContracts, grvtTokenContracts, TREASURY_WALLET)
	await helper.connectGRVTTokenContractsToCore(grvtTokenContracts, coreContracts, TREASURY_WALLET)

	await approveGRVTTokenAllowanceForCommunityIssuance()
	await addCollaterals()
	await coreContracts.adminContract.setInitialized()

	helper.saveDeployment(deploymentState)

	// await helper.deployMultiVesselGetterContract(coreContracts, deploymentState)

	await transferContractsOwnerships()

	const finalBalance = await ethers.provider.getBalance(deployerWallet.address)
	console.log(`Final balance: ${ethers.utils.formatUnits(finalBalance)}`)
	console.log(`Deployment cost: ${ethers.utils.formatUnits(initialBalance.sub(finalBalance))}`)
}

async function approveGRVTTokenAllowanceForCommunityIssuance() {
	const allowance = await grvtTokenContracts.GRVTToken.allowance(
		deployerWallet.address,
		grvtTokenContracts.communityIssuance.address
	)
	if (allowance == 0) {
		await grvtTokenContracts.GRVTToken.approve(
			grvtTokenContracts.communityIssuance.address,
			ethers.constants.MaxUint256
		)
	}
}

async function addCollaterals() {
	console.log("Adding Collaterals...")
	await addCollateral("wETH", "WETH_ERC20")
	await addCollateral("rETH", "RETH_ERC20")
	await addCollateral("stETH", "STETH_ERC20")
	await addCollateral("wstETH", "WSTETH_ERC20")
}

async function addCollateral(name, configKey) {
	const address =
		"localhost" == config.targetNetwork
			? await helper.deployMockERC20Contract(deploymentState, name, 18)
			: config.externalAddrs[configKey]
	if (!address || address == "") {
		throw `No address found for collateral ${name} using config var externalAddrs.${configKey}`
	}
	console.log(`Collateral added: ${address} -> ${name}`)
	await helper.sendAndWaitForTransaction(coreContracts.adminContract.addNewCollateral(address, 18, true))
	await helper.sendAndWaitForTransaction(coreContracts.adminContract.setAsDefault(address))
}

async function transferContractsOwnerships() {
	const adminOwnedContracts = [
		coreContracts.adminContract, 
		coreContracts.debtToken,
		coreContracts.feeCollector,
		grvtTokenContracts.GRVTStaking
	]
	if ("localhost" != config.targetNetwork) {
		adminOwnedContracts.push(coreContracts.priceFeed) // test contract is not Ownable
	}
	const treasuryOwnedContracts = [
		coreContracts.lockedGrvt, 
		grvtTokenContracts.communityIssuance
	]
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

async function deployOnlyGRVTContract() {
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

module.exports = {
	mainnetDeploy,
}

