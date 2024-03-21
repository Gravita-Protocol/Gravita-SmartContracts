import "@nomicfoundation/hardhat-toolbox"
import "@nomiclabs/hardhat-truffle5"
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-etherscan"
import "@openzeppelin/hardhat-upgrades"
import "@openzeppelin/hardhat-defender"
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
		// hardhat: {
		// 	accounts: accountsList,
		// 	chainId: 10,
		// 	forking: {
		// 		url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
		// 		// url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
		// 		blockNumber: 117603555,
		// 	},
		// },
		// Setup for testing files in test/gravita-fork:
		// hardhat: {
		// 	accounts: accountsList,
		// 	chainId: 42161,
		// 	forking: {
		// 		url: `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
		// 		blockNumber: 145845570,
		// 	},
		// },
		arbitrum: {
			url: `https://arb1.arbitrum.io/rpc`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		linea: {
			url: `https://linea.drpc.org`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		mainnet: {
			url: `${process.env.ETHEREUM_NETWORK_ENDPOINT}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		optimism: {
			url: `https://optimism-mainnet.rpc.grove.city/v1/cd187dcbe5aa7aebe71850b9`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		polygonZkEvm: {
			url: `https://polygon-zkevm.drpc.org`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
	},
	etherscan: {
		apiKey: `${process.env.ETHERSCAN_API_KEY}`,
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

