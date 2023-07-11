import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/localhost.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = undefined

const CONTRACT_UPGRADES_ADMIN = "0xf99C0eDf98Ed17178B19a6B5a0f3B58753300596"
const SYSTEM_PARAMS_ADMIN = "0xf99C0eDf98Ed17178B19a6B5a0f3B58753300596"
const TREASURY_WALLET = "0xf99C0eDf98Ed17178B19a6B5a0f3B58753300596"

const COLLATERAL = [
	{
		name: "wETH",
		address: "0x1A0A7c9008Aa351cf8150a01b21Ff2BB98D70D2D",
		oracleAddress: "0xE8BAde28E08B469B4EeeC35b9E48B2Ce49FB3FC9",
		oracleTimeoutMinutes: 1440,
		oracleIsEthIndexed: false,
		MCR: toEther(1.25),
		CCR: toEther(1.5),
		minNetDebt: toEther(1_800),
		gasCompensation: toEther(300),
		mintCap: toEther(1_500_000),
	},
]

module.exports = {
	COLLATERAL,
	CONTRACT_UPGRADES_ADMIN,
	ETHERSCAN_BASE_URL,
	OUTPUT_FILE,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
