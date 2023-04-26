async function main() {
	console.log("Upgrading PriceFeed...")

	let PriceFeed = await ethers.getContractFactory("PriceFeed")

	let pf = await upgrades.upgradeProxy("0xe5B8E3caC86A3F943FEb5470AB1241606d93C202", PriceFeed)

	console.log("PriceFeed upgraded.")
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
