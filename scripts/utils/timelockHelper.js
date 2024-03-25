const { ethers } = require("hardhat")

// Mainnet Timelock URL:
// https://etherscan.io/address/0x57a1953bf194a1ef73396e442ac7dc761dcd23cc#writeContract#F4

const DEPLOYER_PRIVATEKEY = process.env.DEPLOYER_PRIVATEKEY

// Setup:
const TIMELOCK_ADDRESS = "0x9D8bB5496332cbeeD59f1211f28dB8b5Eb214B6D"
const TARGET_ADDRESS = "0x5Bd5b45f6565762928A79779F6C2DD43c15c92EE"

// const METHOD_SIGNATURE = "addNewCollateral(address,uint256,uint256)"
// const METHOD_ARG_TYPES = ["address","uint256","uint256"]
// const METHOD_ARG_VALUES = ["0xcD68DFf4415358c35a28f96Fd5bF7083B22De1D6","20000000000000000000",18]

// const METHOD_SIGNATURE = "setCollateralParameters(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"
// const METHOD_ARG_TYPES = ["address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"]
// const METHOD_ARG_VALUES = [
// 	"0xA35b1B31Ce002FBF2058D22F30f95D405200A15b",
// 	"5000000000000000", // borrowingFee
// 	"1400000000000000000", // ccr
// 	"1250000000000000000", // mcr
// 	"2000000000000000000000", // minNetDebt
// 	"1000000000000000000000000", // mintCap
// 	"200", // percentDivisor
// 	"5000000000000000", // redemptionFeeFloor
// ]

// const METHOD_SIGNATURE = "setRedemptionBlockTimestamp(address,uint256)"
// const METHOD_ARG_TYPES = ["address","uint256"]
// const METHOD_ARG_VALUES = ["0xcD68DFf4415358c35a28f96Fd5bF7083B22De1D6","1704844800"]

// const METHOD_SIGNATURE = "setMintCap(address,uint256)"
// const METHOD_ARG_TYPES = ["address","uint256"]
// const METHOD_ARG_VALUES = ["0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee","3000000000000000000000000"]

// const METHOD_SIGNATURE = "setOracle(address,address,uint8,uint256,bool,bool)"
// const METHOD_ARG_TYPES = ["address","address","uint8","uint256","bool","bool"]
// const METHOD_ARG_VALUES = ["0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee","0xddb6f90ffb4d3257dd666b69178e5b3c5bf41136",0,25_200,false,false]

// const METHOD_SIGNATURE = "setRedemptionSofteningParam(uint256)"
// const METHOD_ARG_TYPES = ["uint256"]
// const METHOD_ARG_VALUES = [9950]

const METHOD_SIGNATURE = "setRedemptionSofteningParam(uint256)"
const METHOD_ARG_TYPES = ["uint256"]
const METHOD_ARG_VALUES = [9950]

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

async function main() {
	await previewParameters()
	// await queueTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES)
	// await cancelTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES, QUEUED_TX_ETA)
	// await executeTransaction(
	// 	"0xe5B8E3caC86A3F943FEb5470AB1241606d93C202", // Goerli.PriceFeed
	// 	"setOracle(address, address, uint256, bool)",
	// 	["address", "address", "uint256", "bool"],
	// 	[
	// 		"0x62bc478ffc429161115a6e4090f819ce5c50a5d9", // rETH
	// 		"0xbC204BDA3420D15AD526ec3B9dFaE88aBF267Aa9", // ChainlinkAggregator
	// 		ethers.utils.parseUnits("0.5").toString(),
	// 		"false",
	// 	],
	// 	"1682466840",
	// 	"0x53f40fcb67abf5b57d5640d4dc82fd92cdfa6c75f86d053c0c95bb7644e12ba9"
	// )
}

async function previewParameters() {
	const timelockContract = await getTimelockContract()
	const eta = 1703602800 // await calcETA(timelockContract)
	const data = encodeParameters(METHOD_ARG_TYPES, METHOD_ARG_VALUES)
	const txHash = calcTxHash(TARGET_ADDRESS, 0, METHOD_SIGNATURE, data, eta)
	console.log(`----------------------------------------------------------------------------------`)
	console.log(`   target: ${TARGET_ADDRESS}`)
	console.log(`    value: 0`)
	console.log(`signature: ${METHOD_SIGNATURE}`)
	console.log(`     data: ${data}`)
	console.log(`      eta: ${eta}`)
	console.log(`   txHash: ${txHash}`)
	console.log(`----------------------------------------------------------------------------------`)
}

async function queueTransaction(targetAddress, methodSignature, argTypes, argValues) {
	console.log(`Queueing ${methodSignature}`)
	const timelockContract = await getTimelockContract()
	const eta = await calcETA(timelockContract)
	const value = 0
	const data = encodeParameters(argTypes, argValues)
	const txHash = calcTxHash(targetAddress, value, methodSignature, data, eta)

	console.log(`TxHash: ${txHash}`)
	console.log(`Data: ${data}`)
	console.log(`ETA: ${eta}`)

	let queued = await timelockContract.queuedTransactions(txHash)
	assert(!queued, "Error: Transaction hash already exists in queue!")

	const tx = await timelockContract.queueTransaction(targetAddress, value, methodSignature, data, eta)
	await tx.wait(1)

	queued = await timelockContract.queuedTransactions(txHash)
	console.log(`Success: ${queued}`)
}

async function cancelTransaction(targetAddress, methodSignature, argTypes, argValues, queuedTxETA) {
	console.log(`Canceling queued ${methodSignature}`)
	const timelockContract = await getTimelockContract()
	const value = 0
	const data = encodeParameters(argTypes, argValues)
	const txHash = calcTxHash(targetAddress, value, methodSignature, data, queuedTxETA)

	const queued = await timelockContract.queuedTransactions(txHash)
	assert(!queued, "Transaction does not exist")

	console.log(`TxHash: ${txHash}`)
	console.log(`Data: ${data}`)
	console.log(`ETA: ${queuedTxETA}`)
	const tx = await timelockContract.cancelTransaction(targetAddress, value, methodSignature, data, queuedTxETA)
	await tx.wait(1)

	const stillQueued = await timelockContract.queuedTransactions(txHash)
	console.log(`Success: ${!stillQueued}`)
}

async function executeTransaction(targetAddress, methodSignature, argTypes, argValues, queuedTxETA, queuedTxHash) {
	const timelockContract = await getTimelockContract()
	let queued = await timelockContract.queuedTransactions(queuedTxHash)
	assert(queued, "Error: Transaction does not exist in queue")
	const value = 0
	const data = encodeParameters(argTypes, argValues)
	const txHash = calcTxHash(targetAddress, value, methodSignature, data, queuedTxETA)
	assert(txHash == queuedTxHash, "Error: Calculated txHash does not match queuedTxHash")
	console.log(`Executing queued ${methodSignature}`)
	const tx = await timelockContract.executeTransaction(targetAddress, value, methodSignature, data, queuedTxETA)
	await tx.wait(1)
	console.log(`Transaction executed`)
}

async function getTimelockContract() {
	const wallet = new ethers.Wallet(DEPLOYER_PRIVATEKEY, ethers.provider)
	const balance = await ethers.provider.getBalance(wallet.address)
	console.log(`Using wallet ${wallet.address} [Balance: ${ethers.utils.formatUnits(balance)}]`)
	return await ethers.getContractAt("Timelock", TIMELOCK_ADDRESS, wallet)
}

async function calcETA(timelockContract) {
	const delay = Number(await timelockContract.delay())
	return (await getBlockTimestamp()) + delay + 13 * 3_600
}

async function getBlockTimestamp() {
	const currentBlock = await ethers.provider.getBlockNumber()
	return Number((await ethers.provider.getBlock(currentBlock)).timestamp)
}

function encodeParameters(types, values) {
	const abi = new ethers.utils.AbiCoder()
	return abi.encode(types, values)
}

function calcTxHash(targetAddress, value, methodSignature, data, eta) {
	return ethers.utils.keccak256(
		encodeParameters(
			["address", "uint256", "string", "bytes", "uint256"],
			[targetAddress, value.toString(), methodSignature, data, eta.toString()]
		)
	)
}

// From the deployment script

// const { txHash, eta } = await setOracleViaTimelock(
// 	address,
// 	chainlinkPriceFeedAddress,
// 	maxDeviationBetweenRounds
// )
// console.log(
// 	`[${name}] setOracle() queued on Timelock (TxHash: ${txHash} ETA: ${eta} Feed: ${chainlinkPriceFeedAddress})`
// )

// Timelock functions -------------------------------------------------------------------------------------------------

// async setOracleViaTimelock(collateralAddress, chainlinkPriceFeedAddress, maxDeviationBetweenRounds, isEthIndexed) {
// 	const targetAddress = coreContracts.priceFeed.address
// 	const methodSignature = "setOracle(address, address, uint256, bool)"
// 	const argTypes = ["address", "address", "uint256", "bool"]
// 	const argValues = [
// 		collateralAddress,
// 		chainlinkPriceFeedAddress,
// 		maxDeviationBetweenRounds.toString(),
// 		isEthIndexed.toString(),
// 	]
// 	return await queueTimelockTransaction(coreContracts.timelock, targetAddress, methodSignature, argTypes, argValues)
// }

// async queueTimelockTransaction(timelockContract, targetAddress, methodSignature, argTypes, argValues) {
// 	const abi = new ethers.utils.AbiCoder()
// 	const eta = await calcTimelockETA(timelockContract)
// 	const value = 0
// 	const data = abi.encode(argTypes, argValues)

// 	const txHash = ethers.utils.keccak256(
// 		abi.encode(
// 			["address", "uint256", "string", "bytes", "uint256"],
// 			[targetAddress, value.toString(), methodSignature, data, eta.toString()]
// 		)
// 	)

// 	await helper.sendAndWaitForTransaction(
// 		timelockContract.queueTransaction(targetAddress, value, methodSignature, data, eta)
// 	)

// 	const queued = await timelockContract.queuedTransactions(txHash)
// 	if (!queued) {
// 		console.log(`WARNING: Failed to queue ${methodSignature} function call on Timelock contract`)
// 	} else {
// 		console.log(`queueTimelockTransaction() :: ${methodSignature} queued`)
// 		console.log(`queueTimelockTransaction() :: ETA = ${eta} (${new Date(eta * 1000).toLocaleString()})`)
// 		console.log(`queueTimelockTransaction() :: Remember to call executeTransaction() upon ETA!`)
// 	}
// 	return { txHash, eta }
// }

// async calcTimelockETA(timelockContract) {
// 	const delay = Number(await timelockContract.delay())
// 	return (await getBlockTimestamp()) + delay + 60
// }

// async getBlockTimestamp() {
// 	const currentBlock = await ethers.provider.getBlockNumber()
// 	return Number((await ethers.provider.getBlock(currentBlock)).timestamp)
// }
