import "@matterlabs/hardhat-zksync-deploy"
import "@matterlabs/hardhat-zksync-solc"
import "@matterlabs/hardhat-zksync-verify"
import "@openzeppelin/hardhat-upgrades"
import { task } from "hardhat/config"

import { CoreDeployer, DeploymentTarget } from "./scripts/deployment/deploy-core"

require("dotenv").config()

task("deploy-core-localhost", "Deploys contracts to Localhost").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Localhost).run()
)

const accounts = () => [`${process.env.DEPLOYER_PRIVATEKEY}`]

module.exports = {
	zksolc: {
		version: "1.3.10",
		compilerSource: "binary",
		settings: {},
	},
	solidity: {
		compilers: [
			{
				version: "0.8.19",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
		],
	},
	defaultNetwork: "zkSyncTestnet",
	networks: {
		zkSyncTestnet: {
			url: "https://testnet.era.zksync.dev",
			ethNetwork: "goerli",
			zksync: true,
			// verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification'
			verifyURL: "https://zksync2-testnet-explorer.zksync.dev/contract_verification",
		},
	},
}
