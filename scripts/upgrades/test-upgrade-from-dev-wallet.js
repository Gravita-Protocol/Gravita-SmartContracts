const { upgrades } = require("hardhat")

const contractList = [
	{
		name: "PriceFeedL2",
		address: "0xF0e0915D233C616CB727E0b2Ca29ff0cbD51B66A",
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
