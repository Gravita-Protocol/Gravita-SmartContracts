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
task("deploy-core-arbitrum", "Deploys contracts to Arbitrum").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Arbitrum).run()
)
task("deploy-core-mainnet", "Deploys contracts to Mainnet").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Mainnet).run()
)
task("deploy-core-mantle", "Deploys contracts to Mantle").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Mantle).run()
)
task("deploy-core-polygon-zkevm", "Deploys contracts to Polygon ZkEVM").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.PolygonZkEvm).run()
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
		arbitrum: {
			url: `https://arb1.arbitrum.io/rpc`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		"arbitrum-sepolia": {
			url: `https://sepolia-rollup.arbitrum.io/rpc`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		linea: {
			url: `https://rpc.linea.build`,
			// url: `https://linea-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		mainnet: {
			url: `${process.env.ETHEREUM_NETWORK_ENDPOINT}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		mantle: {
			url: `https://rpc.mantle.xyz`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		},
		optimism: {
			url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
			accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
    },
		"optimism-sepolia": {
			url: `https://sepolia.optimism.io`,
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
			"arbitrum-sepolia": `${process.env.ARBITRUM_ETHERSCAN_API_KEY}`,
			holesky: `${process.env.ETHERSCAN_API_KEY}`,
			linea: `${process.env.LINEA_ETHERSCAN_API_KEY}`,
			mantle: ``,
			"optimism-sepolia": `${process.env.OPTIMISM_ETHERSCAN_API_KEY}`,
			polygonZkEvm: `${process.env.POLYGON_ZKEVM_ETHERSCAN_API_KEY}`,
		},
		customChains: [
			{
				network: "arbitrum",
				chainId: 42_161,
				urls: {
					apiURL: "https://api.arbiscan.io/api",
					browserURL: "https://arbiscan.io/",
				},
			},
			{
				network: "arbitrum-sepolia",
				chainId: 421614,
				urls: {
					apiURL: "https://sepolia.arbiscan.io/api",
					browserURL: "https://sepolia.arbiscan.io",
				},
			},
			{
				network: "holesky",
				chainId: 17_000,
				urls: {
					apiURL: "https://api-holesky.etherscan.io/api",
					browserURL: "https://holesky.etherscan.io/",
				},
			},
			{
				network: "linea",
				chainId: 59_144,
				urls: {
					apiURL: "https://api.lineascan.build/api",
					browserURL: "https://lineascan.build/",
				},
			},
			{
				network: "mantle",
				chainId: 5_000,
				urls: {
					apiURL: "https://explorer.mantle.xyz/api",
					browserURL: "https://explorer.mantle.xyz/",
				},
			},
      {
				network: "optimism-sepolia",
				chainId: 11155420,
				urls: {
					apiURL: "https://sepolia-optimism.etherscan.io/api",
					browserURL: "https://sepolia-optimism.etherscan.io",
        },
      },
			{
				network: "polygonZkEvm",
				chainId: 1_101,
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
