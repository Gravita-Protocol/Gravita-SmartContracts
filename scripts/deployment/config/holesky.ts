import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/holesky.json"
const TX_CONFIRMATIONS = 2
const ETHERSCAN_BASE_URL = "https://holesky.etherscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const SYSTEM_PARAMS_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

const COLLATERAL = [
	{
		name: "wETH",
		address: "0x2df77eE5a6FcF23F666650ed53bE071E7288eCb6",
		oracleAddress: "0xC526a88daEEa6685E4D46C99512bEB0c85a8b1c7",
		oracleTimeoutMinutes: 1440,
		oracleIsEthIndexed: false,
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(2_000),
		gasCompensation: toEther(200),
		mintCap: toEther(1_500_000),
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
