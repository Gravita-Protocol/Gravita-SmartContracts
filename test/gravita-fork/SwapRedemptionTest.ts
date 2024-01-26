import { BigNumber } from "ethers"
import { artifacts, assert, contract, ethers, network, upgrades } from "hardhat"

const { setBalance, time, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

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

const AdminContract = artifacts.require("AdminContract")
const GRAI = artifacts.require("DebtToken")
const IRamsesSwapRouter = artifacts.require("IRamsesSwapRouter")
const WETH = artifacts.require("IWETH")

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("SwapRedemptionTest", async accounts => {

  const [redeemer] = accounts

  it("SwapRedemptionTest", async () => {

		// await setBalance(redeemer, p("11"))

		const adminContract = await AdminContract.at("0x4928c8F8c20A1E3C295DddBe05095A9aBBdB3d14")
    const grai = await GRAI.at("0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487")
    const swapRouter = await IRamsesSwapRouter.at("0xda3959ed3039455df8cf8a79bd6dd5651135d13a")
    const wETH = await WETH.at("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1")

    console.log(`Depositing ETH for wETH`)
    await wETH.deposit({ value: p("10").toString() })
    console.log(`[wETH] balance: ${f(await wETH.balanceOf(redeemer))}`)

    console.log(`Swapping wETH for GRAI...`)
    await wETH.approve(swapRouter.address, ethers.constants.MaxUint256)
    const exactInputSingleParams = [
      ethers.constants.AddressZero, // tokenIn -> ETH
      "0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487", // tokenOut -> GRAI
      500, // fee
      redeemer, // recipient
      (await time.latest()) + 30, // deadline
      p("1"), // amountIn
      0, // amountOutMinimum
      0 // sqrtPriceLimitX96
    ]
    await swapRouter.exactInputSingle(exactInputSingleParams, { value: p("1").toString() })

    console.log(`[GRAI] balance: ${f(await grai.balanceOf(redeemer))}`)
	})
})
