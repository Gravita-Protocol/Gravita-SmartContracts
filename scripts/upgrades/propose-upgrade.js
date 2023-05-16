const { defender } = require("hardhat")

async function main() {
	const proxyAddress = "0x5C1e1732274630Ac9E9cCaF05dB09da64bE190B5"
	const BoxV2 = await ethers.getContractFactory("BoxV2")
	console.log("Preparing proposal...")
	const proposal = await defender.proposeUpgrade(proxyAddress, BoxV2)
	console.log("Upgrade proposal created at:", proposal.url)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
