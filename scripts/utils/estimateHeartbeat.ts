import { BigNumber } from "ethers"
import { ethers } from "hardhat"

/**
 * Script that retrieves and displays latest `n` rounds from a PriceAggregator in an attempt to estimate its heartbeat.
 */

const AGGREGATOR_ADDRESS = "0x97d9F9A00dEE0004BE8ca0A8fa374d486567eE2D" // Chainlink ETH:USD on Polygon-ZkEVM
const ROUNDS = 500

async function main() {
	const contract = await ethers.getContractAt("AggregatorV3Interface", AGGREGATOR_ADDRESS)
	let latestRoundId = (await contract.latestRoundData()).answeredInRound
	let prevUpdatedAt,
		maxDiff = 0
	for (let i = 0; i <= ROUNDS; i++) {
		try {
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
		} catch (e) {
			break
		}
	}
	console.log(`Max diff between rounds: ${maxDiff} (${maxDiff / 3_600})`)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
