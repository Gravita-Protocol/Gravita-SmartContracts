const { hre, ethers, upgrades } = require("hardhat")

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Goerli Setup
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const lpToken = "0xC3408e89622Bf7F590497F2CADf05DfeCaaF7DfB" // Maverick Position-WBTC-USDC-15
const rewards = "0x1cc742CBD730cAd9E121eC9b95D08E066E6A9780"

async function main() {
	const contractName = `MaverickStakingWrapper`
	console.log(`Deploying ${contractName}...`)
	const factory = await ethers.getContractFactory(contractName)
	let opts: any = { kind: "uups", initializer: false }
	const newContract = await upgrades.deployProxy(factory, opts)
	await newContract.deployed()
  console.log(`Contract deployed at ${newContract.address}, initializing...`)
	await newContract.initialize(lpToken, rewards)
  console.log(`Done.`)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
