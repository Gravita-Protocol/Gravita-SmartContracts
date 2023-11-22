import { BigNumber } from "ethers"
import { ethers } from "hardhat"

/**
 * Script that retrieves and displays latest `n` rounds from a PriceAggregator in an attempt to estimate its heartbeat.
 */

const AGGREGATOR_ADDRESS = "0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA" // Chainlink wETH:USD on LINEA
const ROUNDS = 500

async function main() {
	const contract = await ethers.getContractAt("AggregatorV3Interface", AGGREGATOR_ADDRESS)
	let latestRoundId = (await contract.latestRoundData()).answeredInRound
	let prevUpdatedAt,
		maxDiff = 0
	for (let i = 0; i <= ROUNDS; i++) {
		const updatedAt = Number((await contract.getRoundData(latestRoundId)).updatedAt)
		if (prevUpdatedAt) {
			const diff = prevUpdatedAt - updatedAt
			if (diff > maxDiff) {
				maxDiff = diff
			}
			console.log(`${i}\t${updatedAt}\t${diff}\t${diff / 3_600}`)
		} else {
			console.log(updatedAt)
		}
		latestRoundId = latestRoundId.sub(BigNumber.from(1))
		prevUpdatedAt = updatedAt
	}
	console.log(`Max diff between rounds: ${maxDiff} (${maxDiff / 3_600})`)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

