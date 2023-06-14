const targetUpgrade = "StabilityPool"
const targetAddress = "0x0dc482270BFbF18322a4497F4E13406822C394be"

async function main() {
	const newContractVersion = await ethers.getContractFactory(targetUpgrade)
	console.log("Preparing upgrade...")
	await upgrades.upgradeProxy(targetAddress, newContractVersion)
	console.log(`Contract ${targetUpgrade} upgraded.`)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
