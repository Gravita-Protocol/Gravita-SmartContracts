const { utils } = require("ethers")
const toEther = val => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/arbitrum-goerli.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://goerli.arbiscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const SYSTEM_PARAMS_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

const GRAI_TOKEN_ADDRESS = "0x72aD48cc8f7F6261a2c2c8f0C8Fa89efd617e578"

// Core Contracts Config ----------------------------------------------------------------------------------------------

const COLLATERAL = [
	{
		name: "wETH",
		address: "0xE8BAde28E08B469B4EeeC35b9E48B2Ce49FB3FC9", // Mock ERC20
		oracleAddress: "0x1A0A7c9008Aa351cf8150a01b21Ff2BB98D70D2D", // Mock Aggregator
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: false,
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(300),
		gasCompensation: toEther(30),
		mintCap: toEther(5_000_000),
	},
]

// Grvt Contracts Config ----------------------------------------------------------------------------------------------

const GRVT_BENEFICIARIES = {
	"0x19596e1D6cd97916514B5DBaA4730781eFE49975": 1_000_000,
}

module.exports = {
	COLLATERAL,
	CONTRACT_UPGRADES_ADMIN,
	ETHERSCAN_BASE_URL,
  GRAI_TOKEN_ADDRESS,
	GRVT_BENEFICIARIES,
	OUTPUT_FILE,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
