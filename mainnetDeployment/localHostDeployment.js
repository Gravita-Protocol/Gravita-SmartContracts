const { mainnetDeploy } = require('./mainnetDeployment.js')
const configParams = require("./deploymentParams.localFork.js")

async function main() {
	console.log("Deploying on localhost...")
  await mainnetDeploy(configParams)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
