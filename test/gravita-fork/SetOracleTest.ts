import { artifacts, assert, contract, ethers, network } from "hardhat"
import { fetch, setGlobalDispatcher, Agent } from "undici"

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

const PriceFeed = artifacts.require("PriceFeed")
const SwEth2EthPriceAggregator = artifacts.require("SwEth2EthPriceAggregator")

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

setGlobalDispatcher(new Agent({ connect: { timeout: 60_000 } }))

contract("SetOracleTest", async () => {
	it("setOracle()", async () => {
		const swEthPriceFeed = await SwEth2EthPriceAggregator.new()
		console.log(`swETH (ETH) Price: ${f((await swEthPriceFeed.latestRoundData()).answer)}`)

		const priceFeed = await PriceFeed.at("0x89F1ecCF2644902344db02788A790551Bb070351")
		const asset = "0xf951E335afb289353dc249e82926178EaC7DEd78" // swETH
		const timelock = await priceFeed.timelockAddress()

		console.log(`Price before: ${f(await priceFeed.fetchPrice(asset))}`)

		await setBalance(timelock, p("100"))
		await impersonateAccount(timelock)
		await priceFeed.setOracle(asset, swEthPriceFeed.address, 0, 25_200, true, false, { from: timelock })
		await stopImpersonatingAccount(timelock)

		console.log(`Price after: ${f(await priceFeed.fetchPrice(asset))}`)
	})
})
