const { mainnetDeploy } = require("./mainnetDeployment.js")
const configParams = require("./deploymentParams.goerli.js")

async function main() {
	console.log("Deploying on Goerli Testnet...")
	await mainnetDeploy(configParams)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

