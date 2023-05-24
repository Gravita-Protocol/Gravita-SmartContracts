const { utils } = require("ethers")
const toEther = val => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/mainnet.json"
const TX_CONFIRMATIONS = 2
const ETHERSCAN_BASE_URL = "https://etherscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0xE9Ac7a720C3511fD048a47f148066B0479102234"
const SYSTEM_PARAMS_ADMIN = "0x48c66D21f7204ACe7dE43965Fe28da6a8FB96B80"
const TREASURY_WALLET = "0x6F8Fe995422c5efE6487A7B07f67E84aaD9D4eC8"

// Core Contracts Config ----------------------------------------------------------------------------------------------

const COLLATERAL = [
	{
		name: "wETH",
		address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		oracleAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
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
		address: "0xae78736Cd615f374D3085123A210448E74Fc6393",
		oracleAddress: "0x536218f9E9Eb48863970252233c8F271f554C2d0",
		oraclePriceDeviation: toEther(0.25),
		oracleIsEthIndexed: true,
		MCR: toEther(1.176),
		CCR: toEther(1.4),
		minNetDebt: toEther(2_000),
		gasCompensation: toEther(200),
		mintCap: toEther(1_500_000),
	},
	{
		name: "wstETH",
		address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
		oracleAddress: "0xCA68ad4EE5c96871EC6C6dac2F714a8437A3Fe66",
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
		address: "0xB9D7DdDca9a4AC480991865EfEf82E01273F79C3",
		oracleAddress: "0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487",
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
	// "0x19596e1D6cd97916514B5DBaA4730781eFE49975": 1_000_000,
}

module.exports = {
	COLLATERAL,
	CONTRACT_UPGRADES_ADMIN,
	ETHERSCAN_BASE_URL,
	GRVT_BENEFICIARIES,
	OUTPUT_FILE,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
