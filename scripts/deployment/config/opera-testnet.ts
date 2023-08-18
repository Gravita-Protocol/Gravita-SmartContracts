import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

/**
 * Request testnet FTM https://faucet.fantom.network/
 */

const OUTPUT_FILE = "./scripts/deployment/output/opera-testnet.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://testnet.ftmscan.com/address"

const CONTRACT_UPGRADES_ADMIN = "0x1F246e612a130a81D85E7d736A5375B5aEc6D0CB" // gnosis sage
const SYSTEM_PARAMS_ADMIN = "0xf737F9D7D228DE25CCEC207C65Fcd2796B1BFE19" //gnosis safe
const TREASURY_WALLET = "0x8765bD79913Aad47a6BAfBd6ed06ceA04028d774" //gnosis safe

/**
 * oracle addresses: https://docs.chain.link/data-feeds/price-feeds/addresses/?network=fantom#Fantom%20Testnet
 */
const COLLATERAL = [
	{
		name: "WFTM",
		address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83",
		oracleAddress: "0xe04676B9A9A2973BCb0D1478b5E1E9098BBB7f3D",
		oracleTimeoutMinutes: 1440,
		oracleIsEthIndexed: false,
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(1),
		gasCompensation: toEther(200),
		mintCap: toEther(500_000),
	}
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
