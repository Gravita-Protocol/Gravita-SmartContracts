import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/optimism-goerli.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://goerli-optimism.etherscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const SYSTEM_PARAMS_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

// Updated 06/20/2023 from Gravita-Protocol/layer-zero branch gravita-proxy file deployments/optimism-goerli/GravitaDebtToken.json commit 1564b4d
const GRAI_TOKEN_ADDRESS = "0x32185feF1Ec11cB79298595fc6dF1398808Cb4E6"

// from https://docs.chain.link/data-feeds/l2-sequencer-feeds
const SEQUENCER_UPTIME_FEED_ADDRESS = "0x4C4814aa04433e0FB31310379a4D6946D5e1D353"

const COLLATERAL = [
	{
		name: "wETH",
		address: "", // Mock ERC20
		oracleAddress: "", // Mock Aggregator
		oracleTimeoutMinutes: 1440,
		oracleIsEthIndexed: false,
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(300),
		gasCompensation: toEther(30),
		mintCap: toEther(5_000_000),
	},
]

module.exports = {
	COLLATERAL,
	CONTRACT_UPGRADES_ADMIN,
	ETHERSCAN_BASE_URL,
	GRAI_TOKEN_ADDRESS,
	OUTPUT_FILE,
	SEQUENCER_UPTIME_FEED_ADDRESS,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
