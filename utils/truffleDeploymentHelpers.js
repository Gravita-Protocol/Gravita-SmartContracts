const SortedVessels = artifacts.require("./SortedVessels.sol")
const VesselManager = artifacts.require("./VesselManager.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const VUSDToken = artifacts.require("./VUSDToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const StabilityPool = artifacts.require("./StabilityPool.sol")
const FunctionCaller = artifacts.require("./FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")

const deployLiquity = async () => {
	const priceFeedTestnet = await PriceFeedTestnet.new()
	const sortedVessels = await SortedVessels.new()
	const vesselManager = await VesselManager.new()
	const activePool = await ActivePool.new()
	const stabilityPool = await StabilityPool.new()
	const defaultPool = await DefaultPool.new()
	const functionCaller = await FunctionCaller.new()
	const borrowerOperations = await BorrowerOperations.new()
	const VUSDToken = await VUSDToken.new(
		vesselManager.address,
		stabilityPool.address,
		borrowerOperations.address
	)
	DefaultPool.setAsDeployed(defaultPool)
	PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
	VUSDToken.setAsDeployed(VUSDToken)
	SortedVessels.setAsDeployed(sortedVessels)
	VesselManager.setAsDeployed(vesselManager)
	ActivePool.setAsDeployed(activePool)
	StabilityPool.setAsDeployed(stabilityPool)
	FunctionCaller.setAsDeployed(functionCaller)
	BorrowerOperations.setAsDeployed(borrowerOperations)

	const contracts = {
		priceFeedTestnet,
		VUSDToken,
		sortedVessels,
		vesselManager,
		activePool,
		stabilityPool,
		defaultPool,
		functionCaller,
		borrowerOperations,
	}
	return contracts
}

const getAddresses = contracts => {
	return {
		BorrowerOperations: contracts.borrowerOperations.address,
		PriceFeedTestnet: contracts.priceFeedTestnet.address,
		VUSDToken: contracts.vusdToken.address,
		SortedVessels: contracts.sortedVessels.address,
		VesselManager: contracts.vesselManager.address,
		StabilityPool: contracts.stabilityPool.address,
		ActivePool: contracts.activePool.address,
		DefaultPool: contracts.defaultPool.address,
		FunctionCaller: contracts.functionCaller.address,
	}
}

// Connect contracts to their dependencies
const connectContracts = async (contracts, addresses) => {
	// set VesselManager addr in SortedVessels
	await contracts.sortedVessels.setVesselManager(addresses.VesselManager)

	// set contract addresses in the FunctionCaller
	await contracts.functionCaller.setVesselManagerAddress(addresses.VesselManager)
	await contracts.functionCaller.setSortedVesselsAddress(addresses.SortedVessels)

	// set VesselManager addr in PriceFeed
	await contracts.priceFeedTestnet.setVesselManagerAddress(addresses.VesselManager)

	// set contracts in the Vessel Manager
	await contracts.vesselManager.setUSDVToken(addresses.VUSDToken)
	await contracts.vesselManager.setSortedVessels(addresses.SortedVessels)
	await contracts.vesselManager.setPriceFeed(addresses.PriceFeedTestnet)
	await contracts.vesselManager.setActivePool(addresses.ActivePool)
	await contracts.vesselManager.setDefaultPool(addresses.DefaultPool)
	await contracts.vesselManager.setStabilityPool(addresses.StabilityPool)
	await contracts.vesselManager.setBorrowerOperations(addresses.BorrowerOperations)

	// set contracts in BorrowerOperations
	await contracts.borrowerOperations.setSortedVessels(addresses.SortedVessels)
	await contracts.borrowerOperations.setPriceFeed(addresses.PriceFeedTestnet)
	await contracts.borrowerOperations.setActivePool(addresses.ActivePool)
	await contracts.borrowerOperations.setDefaultPool(addresses.DefaultPool)
	await contracts.borrowerOperations.setVesselManager(addresses.VesselManager)

	// set contracts in the Pools
	await contracts.stabilityPool.setActivePoolAddress(addresses.ActivePool)
	await contracts.stabilityPool.setDefaultPoolAddress(addresses.DefaultPool)

	await contracts.activePool.setStabilityPoolAddress(addresses.StabilityPool)
	await contracts.activePool.setDefaultPoolAddress(addresses.DefaultPool)

	await contracts.defaultPool.setStabilityPoolAddress(addresses.StabilityPool)
	await contracts.defaultPool.setActivePoolAddress(addresses.ActivePool)
}

const connectEchidnaProxy = async (echidnaProxy, addresses) => {
	echidnaProxy.setVesselManager(addresses.VesselManager)
	echidnaProxy.setBorrowerOperations(addresses.BorrowerOperations)
}

module.exports = {
	connectEchidnaProxy: connectEchidnaProxy,
	getAddresses: getAddresses,
	deployLiquity: deployLiquity,
	connectContracts: connectContracts,
}

