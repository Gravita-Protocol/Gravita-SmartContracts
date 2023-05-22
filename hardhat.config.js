require("@nomicfoundation/hardhat-toolbox")
require("@nomiclabs/hardhat-truffle5")
require("@nomiclabs/hardhat-ethers")
require("@nomiclabs/hardhat-etherscan")
require("@openzeppelin/hardhat-upgrades")
// require("hardhat-gas-reporter")
// require("hardhat-contract-sizer")
// require("hardhat-interface-generator")
require("@openzeppelin/hardhat-defender")
require("solidity-coverage")
require("dotenv").config()

const accounts = require("./hardhatAccountsList2k.js")
const accountsList = accounts.accountsList

const CoreDeployer = require("./scripts/deployment/deployer-core.js")
const { DeploymentTarget } = require("./scripts/deployment/deployer-common.js")

task("deploy-core-localhost", "Deploys contracts to Localhost").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.Localhost).run()
)
task("deploy-core-goerli", "Deploys contracts to Goerli Testnet").setAction(
	async (_, hre) => await new CoreDeployer(hre, DeploymentTarget.GoerliTestnet).run()
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
				version: "0.8.20",
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
			accounts: [{ privateKey: process.env.DEPLOYER_PRIVATEKEY, balance: (10e18).toString() }, ...accountsList],
		},
		localhost: {
			url: "http://localhost:8545",
			gas: 20_000_000,
		},
		goerli: {
			url: `${process.env.GOERLI_NETWORK_ENDPOINT}`,
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

