const { ethers } = require("hardhat")

const DEPLOYER_PRIVATEKEY = process.env.DEPLOYER_PRIVATEKEY
const TIMELOCK_ADDRESS = "0xD202c6617525B9f6559F84da9BA52f57F810678f" // Goerli.ShortTimelock

const TARGET_ADDRESS = "0xe5B8E3caC86A3F943FEb5470AB1241606d93C202" // Goerli.PriceFeed
const METHOD_SIGNATURE = "setOracle(address, address, uint256, bool)"
const METHOD_ARG_TYPES = ["address", "address", "uint256", "bool"]
const METHOD_ARG_VALUES = [
	"0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6", // rETH
	"0xbC204BDA3420D15AD526ec3B9dFaE88aBF267Aa9", // ChainlinkAggregator
	ethers.utils.parseUnits("0.5").toString(),
]
const QUEUED_TX_ETA = "1682466840"
const QUEUED_TX_HASH = "0x53f40fcb67abf5b57d5640d4dc82fd92cdfa6c75f86d053c0c95bb7644e12ba9"

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

async function main() {
	// await queueTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES)
	// await cancelTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES, QUEUED_TX_ETA)
	await executeTransaction(
		"0xe5B8E3caC86A3F943FEb5470AB1241606d93C202", // Goerli.PriceFeed
		"setOracle(address, address, uint256, bool)",
		["address", "address", "uint256", "bool"],
		[
			"0x62bc478ffc429161115a6e4090f819ce5c50a5d9", // rETH
			"0xbC204BDA3420D15AD526ec3B9dFaE88aBF267Aa9", // ChainlinkAggregator
			ethers.utils.parseUnits("0.5").toString(),
			"false",
		],
		"1682466840",
		"0x53f40fcb67abf5b57d5640d4dc82fd92cdfa6c75f86d053c0c95bb7644e12ba9"
	)
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
	return (await getBlockTimestamp()) + delay
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

