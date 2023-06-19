import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/zksync-testnet.json"
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = "https://zksync2-testnet-explorer.zksync.dev/contract_verification"

const CONTRACT_UPGRADES_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const SYSTEM_PARAMS_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

const GRAI_TOKEN_ADDRESS = "0x72aD48cc8f7F6261a2c2c8f0C8Fa89efd617e578"

const COLLATERAL = [
	{
		name: "wETH",
		address: "",
		pythPriceID: "",
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(200),
		gasCompensation: toEther(10),
		mintCap: toEther(1_500_000),
	},
	{
		name: "mock_ERC20",
		address: "", // mock ERC20
		pythPriceID: "",
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
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
