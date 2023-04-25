const { ethers } = require("hardhat")

const DEPLOYER_PRIVATEKEY = process.env.DEPLOYER_PRIVATEKEY
const TIMELOCK_ADDRESS = "0xb10DeDc5d6bCFDeE354d2817cf634eD83aCEb8FE" // ShortTimelock

const TARGET_ADDRESS = "0xA6B8bb6E649E5A587CA5Ec680A71736e32653F3e" // AdminContract
const METHOD_SIGNATURE = "setMCR(address, uint256)" // setMCR(address _collateral, uint256 newMCR) shortTimelockOnly
const METHOD_ARG_TYPES = ["address", "uint256"]
const METHOD_ARG_VALUES = ["0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6", "1100000000000000000"]

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

async function main() {
	await queueTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES)
	//await executeTransaction(TARGET_ADDRESS, METHOD_SIGNATURE, METHOD_ARG_TYPES, METHOD_ARG_VALUES)
}

async function queueTransaction(targetAddress, methodSignature, argTypes, argValues) {
	const timelockContract = await getTimelockContract()
	const eta = await calcETA(timelockContract)
	const value = 0
	const data = encodeParameters(argTypes, argValues)

	const queuedTxHash = ethers.utils.keccak256(
		encodeParameters(
			["address", "uint256", "string", "bytes", "uint256"],
			[targetAddress, value.toString(), methodSignature, data, eta.toString()]
		)
	)

	// Timelock::queueTransaction(address target, uint value, string signature, bytes data, uint eta)
	const tx = await timelockContract.queueTransaction(targetAddress, value, methodSignature, data, eta)
	await tx.wait(1)

	const queued = await timelockContract.queuedTransactions(queuedTxHash)
	console.log(`QueuedTxHash: ${queuedTxHash} ETA: ${eta} Success: ${queued}`)
}

async function executeTransaction(targetAddress, methodSignature, argTypes, argValues) {
	console.log(`Executing timelocked ${methodSignature}`)
	const timelockContract = await getTimelockContract()
	const eta = await getBlockTimestamp()
	const value = 0
	const data = encodeParameters(argTypes, argValues)
	const tx = await timelockContract.executeTransaction(targetAddress, value, methodSignature, data, eta)
	await tx.wait(1)
	console.log(`Transaction executed`)
}

async function getTimelockContract() {
	const deployerWallet = new ethers.Wallet(DEPLOYER_PRIVATEKEY, ethers.provider)
	return await ethers.getContractAt("Timelock", TIMELOCK_ADDRESS, deployerWallet)
}

async function calcETA(timelockContract) {
	const delay = await timelockContract.delay()
	return (await getBlockTimestamp()) + delay
}

async function getBlockTimestamp() {
	const currentBlock = await ethers.provider.getBlockNumber()
	return (await ethers.provider.getBlock(currentBlock)).timestamp
}

function encodeParameters(types, values) {
	const abi = new ethers.utils.AbiCoder()
	return abi.encode(types, values)
}
