const { utils } = require("ethers")
const toEther = val => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/localhost.json"
const GAS_PRICE = 20_000_000_000 // 20 Gwei
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = undefined

const CONTRACT_UPGRADES_ADMIN = "0xf99C0eDf98Ed17178B19a6B5a0f3B58753300596"
const SYSTEM_PARAMS_ADMIN = "0xf99C0eDf98Ed17178B19a6B5a0f3B58753300596"
const TREASURY_WALLET = "0xf99C0eDf98Ed17178B19a6B5a0f3B58753300596"

// Core Contracts Config ----------------------------------------------------------------------------------------------

const COLLATERAL = [
	{
		name: "wETH",
		address: "0x1A0A7c9008Aa351cf8150a01b21Ff2BB98D70D2D",
		oracleAddress: "0xF1c0DB770e77a961efde9DD11216e3833ad5c588",
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: false,
		MCR: toEther(1.25),
		CCR: toEther(1.5),
		minNetDebt: toEther(1_800),
		gasCompensation: toEther(300),
		mintCap: toEther(1_500_000),
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
	GAS_PRICE,
	GRVT_BENEFICIARIES,
	OUTPUT_FILE,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
