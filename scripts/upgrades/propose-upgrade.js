const { defender } = require("hardhat")

const targetUpgrade = "VesselManagerOperations"
const targetAddress = "0xc49B737fa56f9142974a54F6C66055468eC631d0"
const multisig = "0xE9Ac7a720C3511fD048a47f148066B0479102234"

async function main() {
	const newContractVersion = await ethers.getContractFactory(targetUpgrade)
	console.log("Preparing proposal...")
	const proposal = await defender.proposeUpgrade(targetAddress, newContractVersion, { multisig })
	console.log("Upgrade proposal created at:", proposal.url)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

