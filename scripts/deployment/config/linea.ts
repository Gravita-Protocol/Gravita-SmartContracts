import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/linea.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://explorer.linea.build/address/"

const CONTRACT_UPGRADES_ADMIN = "0x9811AA1e6E2181845C0CA8931792724f3c253cEa"
const SYSTEM_PARAMS_ADMIN = "0x9811AA1e6E2181845C0CA8931792724f3c253cEa"
const TREASURY_WALLET = "0x9811AA1e6E2181845C0CA8931792724f3c253cEa"

const GRAI_TOKEN_ADDRESS = "0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487"

// from https://docs.chain.link/data-feeds/l2-sequencer-feeds
const SEQUENCER_UPTIME_FEED_ADDRESS = ""

const COLLATERAL = [
    {
        name: "wETH",
        address: "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f",
        oracleAddress: "0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA",
        oracleTimeoutSeconds: 4500,
        oracleIsEthIndexed: false,
        MCR: toEther(1.111),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    },
    {
        name: "wstETH",
        address: "0xb5bedd42000b71fdde22d3ee8a79bd49a568fc8f",
        oracleAddress: "0x8eCE1AbA32716FdDe8D6482bfd88E9a0ee01f565",
        oracleTimeoutSeconds: 90000, 
        oracleIsEthIndexed: true,
        MCR: toEther(1.176),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    }
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
