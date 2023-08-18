import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/opera.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://ftmscan.com/address"

const CONTRACT_UPGRADES_ADMIN = null
const SYSTEM_PARAMS_ADMIN = null
const TREASURY_WALLET = null

/**
 * oracle addresses: https://docs.chain.link/data-feeds/price-feeds/addresses/?network=fantom
 */
const COLLATERAL = [
    {
        name: "WFTM",
        address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83",
        oracleAddress: "0xf4766552D15AE4d256Ad41B6cf2933482B0680dc",
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
