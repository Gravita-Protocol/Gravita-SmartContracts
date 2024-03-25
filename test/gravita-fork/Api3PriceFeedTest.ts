import { BigNumber } from "ethers"
import { artifacts, assert, contract, ethers, network, upgrades } from "hardhat"

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

/**
 *  Configure hardhat.config.ts for an Arbitrum fork before running:
  
		hardhat: {
			accounts: accountsList,
			chainId: 42161,
			forking: {
				url: `https://arb-mainnet.g.alchemy.com/v2/[API-KEY]`,
				blockNumber: 169116600,
			},
		},
 */

const PriceFeed = artifacts.require("PriceFeedL2")
const MockApi3Proxy = artifacts.require("MockApi3Proxy")

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("Api3PriceFeedTest", async () => {
	it("Upgrade and read test", async () => {
		const asset = "0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe" // weETH on Arb
		const priceFeed = await PriceFeed.at("0xF0e0915D233C616CB727E0b2Ca29ff0cbD51B66A")

		console.log(`ETH price: $${f(await priceFeed.fetchPrice(ethers.constants.AddressZero))}`)

		const mockApi3Proxy = await MockApi3Proxy.new()
		const newPriceFeed = await PriceFeed.new()

		const multisig = await priceFeed.owner()
		await setBalance(multisig, p("100"))
		await impersonateAccount(multisig)

		console.log(`Upgrading PriceFeed...`)
		await priceFeed.upgradeTo(newPriceFeed.address, { from: multisig })

		console.log(`Configuring new oracle...`)
		const api3EnumType = 1
		const isEthIndexed = true
		await priceFeed.setOracle(asset, mockApi3Proxy.address, api3EnumType, 25_200, isEthIndexed, false, {
			from: multisig,
		})
		await stopImpersonatingAccount(multisig)

		const newAssetPrice = await priceFeed.fetchPrice(asset)
		console.log(`New Asset Price: $${f(newAssetPrice)}`)

		const ethPrice = BigNumber.from(String(await priceFeed.fetchPrice(ethers.constants.AddressZero)))
		const expectedPrice = BigNumber.from("1012695777067725000").mul(ethPrice).div(ethers.constants.WeiPerEther)

		assert.equal(newAssetPrice.toString(), expectedPrice.toString())
	})
})
