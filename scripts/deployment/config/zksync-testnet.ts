import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/zksync-testnet.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://zksync2-testnet-explorer.zksync.dev/contract_verification"

const CONTRACT_UPGRADES_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const SYSTEM_PARAMS_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

const GRAI_TOKEN_ADDRESS = "0x72aD48cc8f7F6261a2c2c8f0C8Fa89efd617e578"

// Pyth contract addresses are available at https://docs.pyth.network/pythnet-price-feeds/evm
// const PYTH_CONTRACT_ADDRESS = "0xf087c864AEccFb6A2Bf1Af6A0382B0d0f6c5D834" // mainnet
const PYTH_CONTRACT_ADDRESS = "0xC38B1dd611889Abc95d4E0a472A667c3671c08DE" // testnet

const COLLATERAL = [
	{
		name: "wETH",
		address: "",
		// pythPriceID: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // mainnet
		pythPriceID: "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6", // testnet
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(200),
		gasCompensation: toEther(10),
		mintCap: toEther(1_500_000),
	},
]

module.exports = {
	COLLATERAL,
	CONTRACT_UPGRADES_ADMIN,
	ETHERSCAN_BASE_URL,
  GRAI_TOKEN_ADDRESS,
	OUTPUT_FILE,
	PYTH_CONTRACT_ADDRESS,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
