import fs from "fs"
import inputJson from "./input.json"
import batchTemplate from "./batch_template_body.json"
import transactionTemplate from "./batch_template_transaction.json"
import { ethers } from "ethers"

const etaWindow = 24 // hours for multisig

async function main() {
	const eta = _calcETA()
	for (const chain of inputJson) {
		let batch = JSON.parse(JSON.stringify(batchTemplate))
		batch.chainId = String(chain.id)
		batch.createdAt = String(Date.now())
		batch.meta.createdFromSafeAddress = chain.multisig
		for (const entry of chain.fees) {
			let tx = JSON.parse(JSON.stringify(transactionTemplate))
			tx.to = chain.timelock
			tx.contractInputsValues.target = chain.adminContract
			tx.contractInputsValues.data = _encodeData(entry.address, entry.percent)
			tx.contractInputsValues.eta = String(eta)
			// @ts-ignore
			batch.transactions.push(tx)
		}
		let output = JSON.stringify(batch, null, 4)
		fs.writeFileSync(`./scripts/admin/mintcap/output/${chain.network}-queue.json`, output)
		for (const tx of batch.transactions) {
			tx.contractMethod.name = "executeTransaction"
		}
		output = JSON.stringify(batch, null, 4)
		fs.writeFileSync(`./scripts/admin/mintcap/output/${chain.network}-execute.json`, output)
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

function _calcETA(): number {
	const timelockWait = 48 // 48 hours
	return Math.floor(Date.now() / 1_000 + (timelockWait + etaWindow) * 60 * 60)
}

function _encodeData(address: string, feePercent: number): string {
	const fee = String(feePercent * 10 ** 16)
	const types = ["address", "uint256"]
	const values = [address, fee]
	const abi = new ethers.utils.AbiCoder()
	return abi.encode(types, values)
}