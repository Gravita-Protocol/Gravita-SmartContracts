main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

async function main() {

  const deployerPrivateKey = process.env.DEPLOYER_PRIVATEKEY
  if (!deployerPrivateKey) {
    throw Error("Please set DEPLOYER_PRIVATEKEY on your .env file")
  }
	if (network.name != 'arbitrum') {
    throw Error("Please call this script with --network arbitrum")
	}

  const txConfirmations = 1
	const timeout = 600_000 // milliseconds
	const deployerWallet = new ethers.Wallet(deployerPrivateKey, ethers.provider)

  console.log(`\r\nDeploying SfrxEth2EthPriceAggregator...`)
	const factory1 = await ethers.getContractFactory("SfrxEth2EthPriceAggregator", deployerWallet)
	const contract1 = await factory1.deploy()
	await deployerWallet.provider.waitForTransaction(contract1.deployTransaction.hash, txConfirmations, timeout)
  console.log(`${contract1.address} -> deployed!`)
}
