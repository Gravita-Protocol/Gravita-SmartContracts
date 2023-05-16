const { utils } = require("ethers")
const toEther = val => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/goerli.json"
const GAS_PRICE = 20_000_000_000 // 20 Gwei
const TX_CONFIRMATIONS = 2
const ETHERSCAN_BASE_URL = "https://goerli.etherscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0x30638E3318F2DF6f83A6ffb237ad66F11Ae9FC53"
const SYSTEM_PARAMS_ADMIN = "0xBC375E1Cc5434a00E8C00C71EBCBd53364426596"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

// Core Contracts Config ----------------------------------------------------------------------------------------------

const COLLATERAL = [
	{
		name: "wETH",
		address: "0x2df77eE5a6FcF23F666650ed53bE071E7288eCb6",
		oracleAddress: "0xC526a88daEEa6685E4D46C99512bEB0c85a8b1c7",
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: false,
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(2_000),
		gasCompensation: toEther(200),
		mintCap: toEther(1_500_000),
	},
	{
		name: "rETH",
		address: "0x178E141a0E3b34152f73Ff610437A7bf9B83267A",
		oracleAddress: "0xbC204BDA3420D15AD526ec3B9dFaE88aBF267Aa9",
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: false,
		MCR: toEther(1.176),
		CCR: toEther(1.4),
		minNetDebt: toEther(2_000),
		gasCompensation: toEther(200),
		mintCap: toEther(1_500_000),
	},
	{
		name: "wstETH",
		address: "0xcef9cd8BB310022b5582E55891AF043213110783",
		oracleAddress: "0x01fDd44216ec3284A7061Cc4e8Fb8d3a98AAcfa8",
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: false,
		MCR: toEther(1.176),
		CCR: toEther(1.4),
		minNetDebt: toEther(2_000),
		gasCompensation: toEther(200),
		mintCap: toEther(1_500_000),
	},
	{
		name: "bLUSD",
		address: "0x9A1Dd4C18aeBaf8A07556248cF4A7A2F2Bb85784",
		oracleAddress: "0xFf92957A8d0544922539c4EA30E7B32Fd6cEC5D3",
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: false,
		MCR: toEther(1.01),
		CCR: toEther(1),
		minNetDebt: toEther(2_000),
		gasCompensation: toEther(0),
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
