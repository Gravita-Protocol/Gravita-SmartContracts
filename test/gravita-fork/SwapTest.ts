import { artifacts, assert, contract, ethers, network } from "hardhat"
import {
	impersonateAccount,
	setBalance,
	stopImpersonatingAccount,
	time,
} from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256 } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const deploymentHelper = require("../utils/deploymentHelpers.js")

const AdminContract = artifacts.require("AdminContract")
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const SwapTest = artifacts.require("SwapTest")

const adminContractAddress = "0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53"
const swapRouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564"

const f = (v: any) => ethers.utils.commify(ethers.utils.formatEther(v.toString()))
const bn = (v: any) => ethers.utils.parseEther(v.toString())

const debug = true

let adminContract: any, debtToken: any, erc20: any, priceFeed: any

contract("SwapTest", async accounts => {
	let snapshotId: number, initialSnapshotId: number
	const [treasury, alice, bob] = accounts

	let swapTest: any

	before(async () => {
    const adminContract = await AdminContract.at(adminContractAddress)
		priceFeed = await PriceFeed.at(await adminContract.priceFeed())
		swapTest = await SwapTest.new(swapRouterAddress)
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

	it("single swap test", async () => {
		const asset = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // wETH
		const assetPiggyBank = "0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E"

		const erc20 = await ERC20.at(asset)
    const assetName = await erc20.name()

    console.log(`Using '${assetName}' as asset`)
    
		// piggy bank gives user some of his asset
		await setBalance(assetPiggyBank, bn(10))
		await impersonateAccount(assetPiggyBank)
		await erc20.transfer(alice, bn(10), { from: assetPiggyBank })
		await stopImpersonatingAccount(assetPiggyBank)

    const price = await priceFeed.fetchPrice(asset)
    console.log(`'${assetName}' price: US$${f(price)}`)

    const graiDebt = bn(50)
    console.log(`Debt: $${f(graiDebt)} GRAI`)
    const assetAmountIn = graiDebt.mul(BigNumber.from(String(1e18))).div(BigNumber.from(String(price)))
    console.log(`AmountIn: ${f(assetAmountIn)} '${assetName}'`)
    const assetApproveAmount = bnMulDec(assetAmountIn, 1.05) // allow for 5% slippage
    console.log(`Alice's balance: ${f(await erc20.balanceOf(alice))} '${assetName}'`)
    console.log(`Approving ${f(assetApproveAmount)} (${assetApproveAmount}) '${assetName}' to spender ${swapTest.address}...`)
    await erc20.approve(swapTest.address, assetAmountIn, { from: alice })
    console.log('Swapping...')
		// function swapExactOutputSingle(address asset, uint256 amountOut, uint256 amountInMaximum) external returns (uint256 amountIn)
		await swapTest.swapExactOutputSingle(asset, graiDebt, assetAmountIn, { from: alice })
	})
})

/**
 * Compares x and y, accepting a default error margin of 0.001%
 */
function assertIsApproximatelyEqual(x: any, y: any, errorPercent = 0.001) {
	const margin = Number(x) * (errorPercent / 100)
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, margin)
}

/**
 * Multiplies a BigNumber(ish) by a decimal
 */
function bnMulDec(x: any, y: number) {
	const precision = 1e12
	const multiplicand = BigNumber.from(x.toString())
	const multiplier = BigNumber.from(Math.floor(y * precision).toString())
	const divisor = BigNumber.from(precision)
	return multiplicand.mul(multiplier).div(divisor)
}

function bnMulDiv(x: any, y: any, z: any) {
	const xBn = BigNumber.from(x.toString())
	const yBn = BigNumber.from(y.toString())
	const zBn = BigNumber.from(z.toString())
	return xBn.mul(yBn).div(zBn)
}
