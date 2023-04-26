require("@nomiclabs/hardhat-truffle5")
require("@nomiclabs/hardhat-ethers")
require("@nomiclabs/hardhat-etherscan")
require("@openzeppelin/hardhat-upgrades")
//require("hardhat-gas-reporter")
require("hardhat-contract-sizer")
require("hardhat-interface-generator")
require("solidity-coverage")
require("dotenv").config()

const accounts = require("./hardhatAccountsList2k.js")
const accountsList = accounts.accountsList

module.exports = {
	paths: {
		sources: "./contracts",
		tests: "./test/gravita",
		cache: "./cache",
		artifacts: "./artifacts",
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
				//viaIR: true,
				},
			},
		],
	},
	networks: {
		hardhat: {
			allowUnlimitedContractSize: true,
			accounts: accountsList,
			gas: 10_000_000, // tx gas limit
			gasPrice: 50_000_000_000,
		},
		localhost: {
			url: "http://localhost:8545",
			gas: 20_000_000, // tx gas limit
		},
		// mainnet: {
		// 	url: `${process.env.ETHEREUM_NETWORK_ENDPOINT}`,
		// 	gasPrice: process.env.GAS_PRICE ? parseInt(process.env.GAS_PRICE) : 20000000000,
		// 	accounts: [`${process.env.DEPLOYER_PRIVATEKEY}`],
		// },
		goerli: {
			url: `${process.env.GOERLI_NETWORK_ENDPOINT}`,
			gas: 30_000_000, // tx gas limit
			accounts: [`${process.env.GOERLI_DEPLOYER_PRIVATEKEY}`],
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
		enabled: `${process.env.REPORT_GAS}`,
		currency: "USD",
		coinmarketcap: `${process.env.COINMARKETCAP_KEY}`,
	},
}

