const { defender } = require("hardhat")

const targetUpgrade = "StabilityPool"
const targetAddress = "0x49387C88Fb723499a9A40DFbb266FAB8028c7e57"
const multisig = "0x30638E3318F2DF6f83A6ffb237ad66F11Ae9FC53"

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
