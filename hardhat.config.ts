import "@nomicfoundation/hardhat-toolbox"
import "@nomiclabs/hardhat-truffle5"
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-etherscan"
import "@openzeppelin/hardhat-upgrades"
import "solidity-coverage"

import { task } from "hardhat/config"

require("dotenv").config()

const accounts = require("./hardhatAccountsList2k.js")
const accountsList = accounts.accountsList

import { CoreDeployer, DeploymentTarget } from "./scripts/deployment/deploy-core"

task("deploy-core-localhost", "Deploys contracts to Localhost").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Localhost).run()
)
task("deploy-core-goerli", "Deploys contracts to Goerli Testnet").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.GoerliTestnet).run()
)
task("deploy-core-arbitrum-goerli", "Deploys contracts to Arbitrum-Goerli Testnet").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.ArbitrumGoerliTestnet).run()
)
task("deploy-core-mainnet", "Deploys contracts to Mainnet").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Mainnet).run()
)
task("deploy-core-arbitrum", "Deploys contracts to Arbitrum").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Arbitrum).run()
)
task("deploy-core-linea", "Deploys contracts to Linea").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Linea).run()
)
task("deploy-core-optimism", "Deploys contracts to Linea").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Optimism).run()
)

module.exports = {
	paths: {
		sources: "./contracts",
		tests: "./test/gravita",
		cache: "./cache",
		artifacts: "./artifacts",
	},
	defender: {
		apiKey: process.env.DEFENDER_TEAM_API_KEY,
		apiSecret: process.env.DEFENDER_TEAM_API_SECRET_KEY,
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
					outputSelection: {
						"*": {
							"*": ["storageLayout"],
						},
					},
				},
			},
		],
	},
	networks: {
		hardhat: {
			allowUnlimitedContractSize: true,
			// accounts: [{ privateKey: process.env.DEPLOYER_PRIVATEKEY, balance: (10e18).toString() }, ...accountsList],
			accounts: accountsList,
		},
		// Setup for testing files in test/gravita-fork:
		// hardhat: {
		// 	accounts: accountsList,
		// 	chainId: 10,
		// 	forking: {
		// 		url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
		// 		blockNumber: 112763546,
		// 	},
		// },
		localhost: {
			url: "http://localhost:8545",
			gas: 20_000_000,
		},
		goerli: {
			url: `${process.env.GOERLI_NETWORK_ENDPOINT}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		arbitrum_goerli: {
			url: `${process.env.ARBITRUM_GOERLI_NETWORK_ENDPOINT}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		arbitrum: {
			url: `${process.env.ARBITRUM_NETWORK_ENDPOINT}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		mainnet: {
			url: `${process.env.ETHEREUM_NETWORK_ENDPOINT}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		linea: {
			url: `https://linea-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		optimism: {
			url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
	},
	etherscan: {
		apiKey: {
			linea: `${process.env.ETHERSCAN_API_KEY}`
		},
		customChains: [
			{
				network: "linea",
				chainId: 59144,
				urls: {
					apiURL: "https://api.lineascan.build/api",
					browserURL: "https://lineascan.build/"
				}
			}
		]
	},
	mocha: { timeout: 12_000_000 },
	rpc: {
		host: "localhost",
		port: 8545,
	},
	gasReporter: {
		enabled: false, // `${process.env.REPORT_GAS}`,
		currency: "USD",
		coinmarketcap: `${process.env.COINMARKETCAP_KEY}`,
	},
}
