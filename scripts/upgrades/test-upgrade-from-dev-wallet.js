const { upgrades } = require("hardhat")

const contractList = [
	{
		name: "PriceFeed",
		address: "0x5C3B45c9F9C6e3d37De94BC03318622D3DD3f525",
	},
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
