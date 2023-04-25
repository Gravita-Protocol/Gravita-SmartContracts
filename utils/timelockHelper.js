const { ethers } = require("hardhat")

const DEPLOYER_PRIVATEKEY = process.env.DEPLOYER_PRIVATEKEY
const TIMELOCK_ADDRESS = "0xb10DeDc5d6bCFDeE354d2817cf634eD83aCEb8FE" // ShortTimelock

const TARGET_ADDRESS = "0xA6B8bb6E649E5A587CA5Ec680A71736e32653F3e" // AdminContract
const METHOD_SIGNATURE = "setMCR(address, uint256)" // setMCR(address _collateral, uint256 newMCR) shortTimelockOnly
const METHOD_ARG_TYPES = ["address", "uint256"]
const METHOD_ARG_VALUES = ["0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6", "1150000000000000000"]
const QUEUED_TX_ETA = "1682383104259200"

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

async function main() {
	await queueTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES)
	// await cancelTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES, QUEUED_TX_ETA)
	// await executeTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES, QUEUED_TX_ETA)
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

async function executeTransaction(targetAddress, methodSignature, argTypes, argValues, queuedTxETA) {
	console.log(`Executing queued ${methodSignature}`)
	const timelockContract = await getTimelockContract()
	const value = 0
	const data = encodeParameters(argTypes, argValues)
	console.log(data)
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

