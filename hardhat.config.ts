import "@matterlabs/hardhat-zksync-deploy"
import "@matterlabs/hardhat-zksync-solc"
import "@matterlabs/hardhat-zksync-verify"
import "@openzeppelin/hardhat-upgrades"

require("dotenv").config()

function accounts() {
	return [`${process.env.DEPLOYER_PRIVATEKEY}`]
}

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
