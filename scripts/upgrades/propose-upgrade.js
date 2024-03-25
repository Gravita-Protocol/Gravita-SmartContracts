const { defender } = require("hardhat")

const targetUpgrade = "VesselManager"
const targetAddress = "0xdB5DAcB1DFbe16326C3656a88017f0cB4ece0977" // Mainnet VesselManager
const multisig = "0xE9Ac7a720C3511fD048a47f148066B0479102234" // Mainnet Upgrades Multisig

async function main() {
	const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATEKEY, ethers.provider)
	const balance = await ethers.provider.getBalance(wallet.address)
	console.log(`Using wallet ${wallet.address} [Balance: ${ethers.utils.formatUnits(balance)}]`)
	const newContractVersion = await ethers.getContractFactory(targetUpgrade)
	console.log(`Preparing proposal for ${targetUpgrade}...`)
	const proposal = await defender.proposeUpgrade(targetAddress, newContractVersion, { multisig })
	console.log("Upgrade proposal created at:", proposal.url)
	console.log(proposal)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

