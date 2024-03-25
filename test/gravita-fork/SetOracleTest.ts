import { artifacts, assert, contract, ethers, network } from "hardhat"

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

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

const PriceFeed = artifacts.require("PriceFeed")

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("SetOracleTest", async () => {
	it("setOracle()", async () => {

    const priceFeed = await PriceFeed.at("0x89F1ecCF2644902344db02788A790551Bb070351")
    const asset = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"
    const timelock = "0x57a1953bF194A1EF73396e442Ac7Dc761dCd23cc"
    console.log(`Price before: ${f(await priceFeed.fetchPrice(asset))}`)

    const newOracle = "0xddb6f90ffb4d3257dd666b69178e5b3c5bf41136"
    await setBalance(timelock, p("100"))
		await impersonateAccount(timelock)
		await priceFeed.setOracle(asset, newOracle, 0, 25_200, false, false, { from: timelock })
		await stopImpersonatingAccount(timelock)

    console.log(`Price after: ${f(await priceFeed.fetchPrice(asset))}`)
	})
})
