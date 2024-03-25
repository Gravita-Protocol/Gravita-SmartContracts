// Setup in hardhat.config.ts:
// hardhat: {
// 	accounts: accountsList,
// 	chainId: 1,
// 	forking: {
// 		url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
// 		blockNumber: 18392400,
// 	},
// },

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")

const AdminContract = artifacts.require("AdminContract")
const DebtToken = artifacts.require("DebtToken")
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const SortedVessels = artifacts.require("SortedVessels")
const VesselManagerOperations = artifacts.require("VesselManagerOperations")

const asset = "0xae78736Cd615f374D3085123A210448E74Fc6393"
const assetPiggyBank = "0x4F39F12064D83F6Dd7A2BDb0D53aF8be560356A6" // StabilityPool
const adminContractAddress = "0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53"

let debtToken, priceFeed, sortedVessels, treasury, vesselManagerOperations

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("RedemptionTest", async accounts => {
	const [user] = accounts

	before(async () => {
		const adminContract = await AdminContract.at(adminContractAddress)
		debtToken = await DebtToken.at(await adminContract.debtToken())
		priceFeed = await PriceFeed.at(await adminContract.priceFeed())
		sortedVessels = await SortedVessels.at(await adminContract.sortedVessels())
		treasury = await adminContract.treasuryAddress()
		vesselManagerOperations = await VesselManagerOperations.at(await adminContract.vesselManagerOperations())
	})

	it("redeemCollateral()", async () => {
		const erc20 = await ERC20.at(asset)
		console.log(`Using ${await erc20.name()} as collateral`)

		const assetPrice = await priceFeed.fetchPrice(asset)
		const ethPrice = await priceFeed.fetchPrice(ZERO_ADDRESS)
		console.log(`Coll price: $${f(assetPrice)}`)
		console.log(`ETH price: $${f(ethPrice)}`)

		const redemptionAmount = p("20000")

		// piggy bank gives user some of his GRAI
		console.log(`Acquiring $${f(redemptionAmount)} GRAI`)
		await setBalance(assetPiggyBank, p("100"))
		await impersonateAccount(assetPiggyBank)
		await debtToken.transfer(user, redemptionAmount, { from: assetPiggyBank })
		await stopImpersonatingAccount(assetPiggyBank)

		// console.log(`Getting redemption hints 1...`)
		// const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
		// 	erc20.address,
		// 	redemptionAmount,
		// 	assetPrice,
		// 	0
		// )

		// console.log(`Getting redemption hints 2...`)
		// const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
		// 	erc20.address,
		// 	partialRedemptionHintNewICR,
		// 	ZERO_ADDRESS,
		// 	ZERO_ADDRESS
		// )

		// console.log(`_asset: ${erc20.address}`)
		// console.log(`_debtTokenAmount: ${redemptionAmount}`)
		// console.log(`_upperPartialRedemptionHint: ${upperPartialRedemptionHint}`)
		// console.log(`_lowerPartialRedemptionHint: ${lowerPartialRedemptionHint}`)
		// console.log(`_firstRedemptionHint: ${firstRedemptionHint}`)
		// console.log(`_partialRedemptionHintNICR: ${partialRedemptionHintNewICR}`)
		// console.log(`_maxIterations: 0`)
		// console.log(`_maxFeePercentage: 50000000000000000`)

		const block = await hre.ethers.provider.getBlock("latest")
    console.log(`Redeeming $${f(redemptionAmount)} GRAI @ block ${block.number}...`)
		const redemptionTx = await vesselManagerOperations.redeemCollateral(
			erc20.address,
			redemptionAmount,
			"0xfdd86a96f47015d9c457c841e1D52D06EDe16A92", // upperPartialRedemptionHint,
			"0x41Bc7d0687e6Cea57Fa26da78379DfDC5627C56d", // lowerPartialRedemptionHint,
			"0x85a216FeC9E0deeB4A3e884C2F31681e47424bdd", // firstRedemptionHint,
			"137395346557122837", // partialRedemptionHintNewICR,
			0,
			"50000000000000000"
		)
		console.log(`cumulativeGasUsed: ${redemptionTx.receipt.cumulativeGasUsed}`)
		console.log(`effectiveGasPrice: ${redemptionTx.receipt.effectiveGasPrice}`)
		const gasUsed = BigInt(redemptionTx.receipt.cumulativeGasUsed) * BigInt(redemptionTx.receipt.effectiveGasPrice)
		console.log(`gas used: ${gasUsed}`)
		console.log(`tx cost: $${f(gasUsed * BigInt(ethPrice.toString()) / BigInt(10 ** 18))}`)
	})
})
