const { run, upgrades: upgrades2 } = require("hardhat")

const upgrades = [
	{
		contract: "FeeCollector",
		address: "0x9c966245C17F953Fa1e6FCaD8E79B0D7f9d2a872",
	},
	{
		contract: "VesselManager",
		address: "0x2177946fD433F24666b23c51C8D728c34Af05627",
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