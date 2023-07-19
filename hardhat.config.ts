import "@nomicfoundation/hardhat-toolbox"
import "@nomiclabs/hardhat-truffle5"
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-etherscan"
// import "@nomiclabs/hardhat-ganache"
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
		hardhat: {
			// url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
			// chainId: 1,
			// accounts: {
			// 	mnemonic: "test test test test test test test test test test test junk",
			// 	count: 20
			// },
			forking: {
				// enabled: true,
				url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
				blockNumber: 17729732 //14075742,
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
		mainnet: {
			url: `${process.env.ETHEREUM_NETWORK_ENDPOINT}`,
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
