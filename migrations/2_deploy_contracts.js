// Truffle migration script for deployment to Ganache

const SortedVessels = artifacts.require("./SortedVessels.sol")
const ActivePool = artifacts.require("./ActivePool.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const StabilityPool = artifacts.require("./StabilityPool.sol")
const VesselManager = artifacts.require("./VesselManager.sol")
const PriceFeed = artifacts.require("./PriceFeed.sol")
const VUSDToken = artifacts.require("./VUSDToken.sol")
const FunctionCaller = artifacts.require("./FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")

const deploymentHelpers = require("../utils/truffleDeploymentHelpers.js")

const getAddresses = deploymentHelpers.getAddresses
const connectContracts = deploymentHelpers.connectContracts

module.exports = function (deployer) {
	deployer.deploy(BorrowerOperations)
	deployer.deploy(PriceFeed)
	deployer.deploy(SortedVessels)
	deployer.deploy(VesselManager)
	deployer.deploy(ActivePool)
	deployer.deploy(StabilityPool)
	deployer.deploy(DefaultPool)
	deployer.deploy(VUSDToken)
	deployer.deploy(FunctionCaller)

	deployer.then(async () => {
		const borrowerOperations = await BorrowerOperations.deployed()
		const priceFeed = await PriceFeed.deployed()
		const sortedVessels = await SortedVessels.deployed()
		const vesselManager = await VesselManager.deployed()
		const activePool = await ActivePool.deployed()
		const stabilityPool = await StabilityPool.deployed()
		const defaultPool = await DefaultPool.deployed()
		const VUSDToken = await VUSDToken.deployed()
		const functionCaller = await FunctionCaller.deployed()

		const liquityContracts = {
			borrowerOperations,
			priceFeed,
			VUSDToken,
			sortedVessels,
			vesselManager,
			activePool,
			stabilityPool,
			defaultPool,
			functionCaller,
		}

		// Grab contract addresses
		const liquityAddresses = getAddresses(liquityContracts)
		console.log("deploy_contracts.js - Deployed contract addresses: \n")
		console.log(liquityAddresses)
		console.log("\n")

		// Connect contracts to each other
		await connectContracts(liquityContracts, liquityAddresses)
	})
}

