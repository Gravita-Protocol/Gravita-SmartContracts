import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/arbitrum-goerli.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://arbiscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0xfB0214D7Ac08ed0D2D9cA920EA6D4f4be2654EA5"
const SYSTEM_PARAMS_ADMIN = "0xfB0214D7Ac08ed0D2D9cA920EA6D4f4be2654EA5"
const TREASURY_WALLET = "0xfB0214D7Ac08ed0D2D9cA920EA6D4f4be2654EA5"

// Updated 06/20/2023 from Gravita-Protocol/layer-zero branch gravita-proxy file deployments/arbitrum-goerli/GravitaDebtToken.json commit 1564b4d
const GRAI_TOKEN_ADDRESS = "0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487"

// from https://docs.chain.link/data-feeds/l2-sequencer-feeds
const SEQUENCER_UPTIME_FEED_ADDRESS = "0xFdB631F5EE196F0ed6FAa767959853A9F217697D"

const COLLATERAL = [
    {
        name: "wETH",
        address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        oracleAddress: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
        oracleTimeoutMinutes: 4500, // TODO: CHECK
        oracleIsEthIndexed: false,
        MCR: toEther(1.111),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    },
    {
        name: "wstETH",
        address: "0x5979D7b546E38E414F7E9822514be443A4800529",
        oracleAddress: "0x07C5b924399cc23c24a95c8743DE4006a32b7f2a",
        oracleTimeoutMinutes: 4500, // TODO: CHECK
        oracleIsEthIndexed: false,
        MCR: toEther(1.176),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    },
    {
        name: "rETH",
        address: "0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8",
        oracleAddress: "0xF3272CAfe65b190e76caAF483db13424a3e23dD2",
        oracleTimeoutMinutes: 4500, // TODO: CHECK
        oracleIsEthIndexed: false,
        MCR: toEther(1.176),
        CCR: toEther(1.4),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
    },
    {
        name: "aLUSD",
        address: "0x8ffDf2DE812095b1D19CB146E4c004587C0A0692",
        oracleAddress: "",  // TODO: deploy
        oracleTimeoutMinutes: 4500, // TODO: CHECK
        oracleIsEthIndexed: false,
        MCR: toEther(1.111),
        CCR: toEther(1),
        minNetDebt: toEther(200),
        gasCompensation: toEther(20),
        mintCap: toEther(1_000_000),
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
