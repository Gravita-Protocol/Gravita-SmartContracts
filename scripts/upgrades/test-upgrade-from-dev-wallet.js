const { upgrades } = require("hardhat")

const contractList = [
	{
		name: "StabilityPool",
		address: "0xD8e4009aE9e22FCF8DE786946E33eF5783eC34Ee",
	}
]

async function main() {
	for (const { name, address } of contractList) {
		const factory = await ethers.getContractFactory(name)
		console.log(`[${address}] Preparing upgrade for ${name} ...`)
		await upgrades.upgradeProxy(address, factory)
		console.log(`[${address}] ${name} upgraded`)
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
