import { artifacts, assert, network } from "hardhat"

/**
 *  Configure hardhat.config.ts for an Arbitrum fork before running:
  
 		hardhat: {
			accounts: accountsList,
			chainId: 42161,
      forking:{
        url: "https://arb1.arbitrum.io/rpc",
				blockNumber: 133331300,
			},
		},
 */

const AggregatorV3Interface = artifacts.require("AggregatorV3Interface")
const SfrxEth2EthPriceAggregator = artifacts.require("SfrxEth2EthPriceAggregator")

let sfrxEth2FrxEthPriceAggregator: any
let frxEth2EthPriceAggregator: any
let sfrxEth2EthPriceAggregator: any

let snapshotId: number, initialSnapshotId: number

describe("SfrxEth2EthPriceAggregator", async () => {
	before(async () => {
		sfrxEth2EthPriceAggregator = await SfrxEth2EthPriceAggregator.new()
		sfrxEth2FrxEthPriceAggregator = await AggregatorV3Interface.at(
			await sfrxEth2EthPriceAggregator.sfrxEth2FrxEthAggregator()
		)
		frxEth2EthPriceAggregator = await AggregatorV3Interface.at(await sfrxEth2EthPriceAggregator.frxEth2EthAggregator())

		initialSnapshotId = await network.provider.send("evm_snapshot")
	})

	beforeEach(async () => {
		snapshotId = await network.provider.send("evm_snapshot")
	})

	afterEach(async () => {
		await network.provider.send("evm_revert", [snapshotId])
	})

	after(async () => {
		await network.provider.send("evm_revert", [initialSnapshotId])
	})

	it("latestRoundData()", async () => {
		// at block 133331300:
		// sfrxEth:frxEth = 1.058386517973250159
		// frxEth:Eth = 1e18
		const sfrxEth2frxEth = (await sfrxEth2FrxEthPriceAggregator.latestRoundData()).answer
    const frxEth2Eth = (await frxEth2EthPriceAggregator.latestRoundData()).answer
    const sfrxEth2Eth = (await sfrxEth2EthPriceAggregator.latestRoundData()).answer

    assert.equal(sfrxEth2frxEth.toString(), "1058386517973250159")
    assert.equal(frxEth2Eth.toString(), "1000000000000000000")
    assert.equal(sfrxEth2Eth.toString(), "1058386517973250159")
	})
})
