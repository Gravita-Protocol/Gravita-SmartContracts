const { ethers } = require("hardhat")

// Mainnet Timelock URL:
// https://etherscan.io/address/0x57a1953bf194a1ef73396e442ac7dc761dcd23cc#writeContract#F4

const DEPLOYER_PRIVATEKEY = process.env.DEPLOYER_PRIVATEKEY

// Setup:
const QUEUE_EXPIRATION_HOURS = 6;
const TIMELOCK_ADDRESS = "0x57a1953bF194A1EF73396e442Ac7Dc761dCd23cc" // Mainnet::Timelock
const TARGET_ADDRESS = "0x89F1ecCF2644902344db02788A790551Bb070351" // Mainnet::PriceFeed
const METHOD_SIGNATURE = "setOracle(address,address,uint8,uint256,bool,bool)"
const METHOD_ARG_TYPES = ["address","address","uint8","uint256","bool","bool"]
const METHOD_ARG_VALUES = [
	"0xf951E335afb289353dc249e82926178EaC7DEd78",
	"0x0704eEc81ea7CF98Aa4A400c65DC4ED5933bddf7",
	"0",
	"4500",
	"false",
	"false"
]

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
	const eta = await calcETA(timelockContract)
	const data = encodeParameters(METHOD_ARG_TYPES, METHOD_ARG_VALUES)
	console.log(`----------------------------------------------------------------------------------`)
	console.log(`   target: ${TARGET_ADDRESS}`)
	console.log(`    value: 0`)
	console.log(`signature: ${METHOD_SIGNATURE}`)
	console.log(`     data: ${data}`)
	console.log(`      eta: ${eta}`)
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
	return (await getBlockTimestamp()) + delay + QUEUE_EXPIRATION_HOURS * 3_600 // add x hours for multisigning
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
