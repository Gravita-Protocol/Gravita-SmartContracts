const { hre, ethers, upgrades } = require("hardhat")

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Goerli Setup
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const lpTokenAddress = "0xC3408e89622Bf7F590497F2CADf05DfeCaaF7DfB" // Maverick Position-WBTC-USDC-15
const rewardsAddress = "0x1cc742CBD730cAd9E121eC9b95D08E066E6A9780"
const adminContractAddress = "0x0f3F21BBA51f6903C86048BfD1087051BA0D5658"

async function main() {
	const contractName = `MaverickStakingWrapper`
	console.log(`Deploying ${contractName}...`)
	const factory = await ethers.getContractFactory(contractName)
	let opts: any = { kind: "uups", initializer: false }
	const wrapper = await upgrades.deployProxy(factory, opts)
	await wrapper.deployed()
	console.log(`Contract deployed at ${wrapper.address}, initializing...`)
	await wrapper.initialize(lpTokenAddress, rewardsAddress)
	console.log(`Contract initialized, setting addresses...`)
	const adminContract = await ethers.getContractAt("AdminContract", adminContractAddress)
	await wrapper.setAddresses([
		await adminContract.activePool(),
		adminContractAddress,
		await adminContract.borrowerOperations(),
		await adminContract.collSurplusPool(),
		await adminContract.debtToken(),
		await adminContract.defaultPool(),
		await adminContract.feeCollector(),
		await adminContract.gasPoolAddress(),
		await adminContract.priceFeed(),
		await adminContract.sortedVessels(),
		await adminContract.stabilityPool(),
		await adminContract.timelockAddress(),
		await adminContract.treasuryAddress(),
		await adminContract.vesselManager(),
		await adminContract.vesselManagerOperations(),
	])
	console.log(`Done.`)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

