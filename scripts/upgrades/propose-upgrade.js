const { defender } = require("hardhat")

const multisig = "0x4828528085FA6a14408fe5b81934481f5397a3F3"

async function main() {
	const proxyAddress = "0x655D09c912248fa6fE55657633BA4B92a1F9be1F"
	const NewContract = await ethers.getContractFactory("PriceFeed")
	console.log("Preparing proposal...")
	const proposal = await defender.proposeUpgrade(proxyAddress, NewContract, { multisig })
	console.log("Upgrade proposal created at:", proposal.url)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
