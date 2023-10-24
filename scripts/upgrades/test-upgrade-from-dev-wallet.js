const { upgrades } = require("hardhat")

const contractList = [
	{
		name: "VesselManager",
		address: "0x2177946fD433F24666b23c51C8D728c34Af05627",
	},
	{
		name: "VesselManagerOperations",
		address: "0x4FC9067e08B16293b6aB251bB335e832F0e896C9",
	},
	{
		name: "FeeCollector",
		address: "0x9c966245C17F953Fa1e6FCaD8E79B0D7f9d2a872",
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
