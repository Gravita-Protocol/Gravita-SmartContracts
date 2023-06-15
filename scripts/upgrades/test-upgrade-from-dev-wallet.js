const { run, upgrades: upgrades2 } = require("hardhat")

/// @notice these are arbitrum-goerli addresses
const upgrades = [
	{
		contract: "ActivePool",
		address: "0x443978eb25e2379587246AdD4a6a23f19738B131",
	},
	{
		contract: "BorrowerOperations",
		address: "0xCA2b164fA917645DE35DD3E09E9A2Ef18677b98e",
	},
	{
		contract: "FeeCollector",
		address: "0x2ec9036BA625801866f313Cf5C007B4189B547f2",
	},
	{
		contract: "PriceFeed",
		address: "0x4D18ae2ecba2804fFa7C6759D8c7d8B78343db03",
	},
	{
		contract: "StabilityPool",
		address: "0x0dc482270BFbF18322a4497F4E13406822C394be",
	},
]

async function main() {
	for (const { contract, address } of upgrades) {
		const newContractVersion = await ethers.getContractFactory(contract)
		console.log(`[${address}] Preparing upgrade for ${contract} ...`)
		await upgrades2.upgradeProxy(address, newContractVersion)
		console.log(`[${address}] ${contract} upgraded.`)
		try {
			await run("verify:verify", { address })
			console.log(`[${address}] ${contract} verified.`)
		} catch (error) {
			// if it was already verified, it’s like a success, so let’s move forward and save it
			if (error.name != "NomicLabsHardhatPluginError") {
				console.error(`Error verifying: ${error.name}`)
				console.error(error)
			}
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
