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
task("deploy-core-polygon-zkevm", "Deploys contracts to Polygon ZkEVM").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.PolygonZkEvm).run()
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
		// hardhat: {
		// 	allowUnlimitedContractSize: true,
		// 	// accounts: [{ privateKey: process.env.DEPLOYER_PRIVATEKEY, balance: (10e18).toString() }, ...accountsList],
		// 	accounts: accountsList,
		// },
		// Setup for testing files in test/gravita-fork:
		hardhat: {
			accounts: accountsList,
			chainId: 42161,
			forking: {
				url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
				blockNumber: 174132600,
			},
		},
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
		polygonZkEvm: {
			url: `https://polygon-zkevm.drpc.org`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
	},
	etherscan: {
		apiKey: {
			arbitrum: `${process.env.ARBITRUM_ETHERSCAN_API_KEY}`,
			holesky: `${process.env.ETHERSCAN_API_KEY}`,
			linea: `${process.env.LINEA_ETHERSCAN_API_KEY}`,
			polygonZkEvm: `${process.env.POLYGON_ZKEVM_ETHERSCAN_API_KEY}`,
		},
		customChains: [
			{
				network: "arbitrum",
				chainId: 42161,
				urls: {
					apiURL: "https://api.arbiscan.io/api",
					browserURL: "https://arbiscan.io/",
				},
			},
			{
				network: "holesky",
				chainId: 17000,
				urls: {
					apiURL: "https://api-holesky.etherscan.io/api",
					browserURL: "https://holesky.etherscan.io/",
				},
			},
			{
				network: "linea",
				chainId: 59144,
				urls: {
					apiURL: "https://api.lineascan.build/api",
					browserURL: "https://lineascan.build/",
				},
			},
			{
				network: "polygonZkEvm",
				chainId: 1101,
				urls: {
					apiURL: "https://api-zkevm.polygonscan.com/api",
					browserURL: "https://zkevm.polygonscan.com/",
				},
			},
		],
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
