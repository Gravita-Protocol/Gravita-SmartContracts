import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/optimism.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://optimistic.etherscan.io/address/"

const CONTRACT_UPGRADES_ADMIN = "0x853b5db6310292dF1C8C05Ad0a4fdf0856B772BB"
const SYSTEM_PARAMS_ADMIN = "0x853b5db6310292dF1C8C05Ad0a4fdf0856B772BB"
const TREASURY_WALLET = "0x853b5db6310292dF1C8C05Ad0a4fdf0856B772BB"

const GRAI_TOKEN_ADDRESS = "0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487"

// from https://docs.chain.link/data-feeds/l2-sequencer-feeds
const SEQUENCER_UPTIME_FEED_ADDRESS = "0x371EAD81c9102C9BF4874A9075FFFf170F2Ee389"

const COLLATERAL = [
    {
        name: "wETH",
        address: "0x4200000000000000000000000000000000000006",
        oracleAddress: "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
        oracleTimeoutSeconds: 4_500,
        oracleIsEthIndexed: false,
        borrowingFee: toEther(0.01),
        MCR: toEther(1.111),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    },
    {
        name: "wstETH",
        address: "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb",
        oracleAddress: "0x698B585CbC4407e2D54aa898B2600B53C68958f7",
        oracleTimeoutSeconds: 90_000, 
        oracleIsEthIndexed: false,
        borrowingFee: toEther(0.01),
        MCR: toEther(1.176),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    },
    {
        name: "rETH",
        address: "0x9bcef72be871e61ed4fbbc7630889bee758eb81d",
        oracleAddress: "0x22F3727be377781d1579B7C9222382b21c9d1a8f",
        borrowingFee: toEther(0.01),
        oracleTimeoutSeconds: 90_000, 
        oracleIsEthIndexed: true,  // <-- ETH-indexed oracle
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
