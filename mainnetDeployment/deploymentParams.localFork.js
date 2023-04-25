const targetNetwork = "localhost"
const DEPLOY_GRVT_CONTRACTS = false
const OUTPUT_FILE = "./mainnetDeployment/localForkDeploymentOutput.json"
const GAS_PRICE = 20_000_000_000 // 20 Gwei
const TX_CONFIRMATIONS = 1
const ETHERSCAN_BASE_URL = undefined

const externalAddrs = {
	CBETH_ERC20: undefined, // mock ERC20s are deployed on local env
	RETH_ERC20: undefined, // mock ERC20s are deployed on local env
	WETH_ERC20: "0xFC623e91a3A638718cDA6dCC108BD60a9F8109E1", // mock ERC20s are deployed on local env
	WSTETH_ERC20: undefined, // mock ERC20s are deployed on local env
	CHAINLINK_CBETH_USD_ORACLE: undefined, // there are no oracles on local env
	CHAINLINK_RETH_USD_ORACLE: undefined, // there are no oracles on local env
	CHAINLINK_WETH_USD_ORACLE: "0x3DaD300A888CE2c31925079c1EBEb54feEE847B9", // there are no oracles on local env
	CHAINLINK_WSTETH_USD_ORACLE: undefined, // there are no oracles on local env
}

const gravitaAddresses = {
	ADMIN_WALLET: "0x19596e1D6cd97916514B5DBaA4730781eFE49975",
	TREASURY_WALLET: "0x19596e1D6cd97916514B5DBaA4730781eFE49975",
	DEPLOYER_WALLET: "0x19596e1D6cd97916514B5DBaA4730781eFE49975",
}

const beneficiaries = {
	//CORE TEAM
	"0x56b421C0aAcA80be6447B7C330222C5A1CE27D4f": 2_100_000,
	"0x1e0573136e42F7896870dB0f2bBE76e24852915b": 2_100_000,
	//ANGELS
	"0x9c5083dd4838e120dbeac44c052179692aa5dac5": 1_000_000,
	"0x238eDaB57c91D1DB2f05FE85295B5F32d355567c": 600_000,
	"0x50664edE715e131F584D3E7EaAbd7818Bb20A068": 400_000,
}

module.exports = {
	externalAddrs,
	gravitaAddresses,
	beneficiaries,
	OUTPUT_FILE,
	GAS_PRICE,
	TX_CONFIRMATIONS,
	ETHERSCAN_BASE_URL,
	targetNetwork,
	DEPLOY_GRVT_CONTRACTS,
}

