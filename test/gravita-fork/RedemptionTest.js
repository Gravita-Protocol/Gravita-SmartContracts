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

const asset = "0x5979D7b546E38E414F7E9822514be443A4800529" // wstETH
const assetPiggyBank = "0x92e305a63646e76bdd3681f7ece7529cd4e8ed5b" // GRAI holder
const adminContractAddress = "0x4928c8F8c20A1E3C295DddBe05095A9aBBdB3d14"

let debtToken, priceFeed, sortedVessels, treasury, vesselManagerOperations

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("CollTest", async accounts => {
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

		const price = await priceFeed.fetchPrice(asset)
		console.log(`PriceFeed's price: ${f(price)}`)

		const redemptionAmount = p("200000")

		// piggy bank gives user some of his GRAI
		console.log(`Acquiring $${f(redemptionAmount)} GRAI`)
		await setBalance(assetPiggyBank, p("100"))
		await impersonateAccount(assetPiggyBank)
		await debtToken.transfer(user, redemptionAmount, { from: assetPiggyBank })
		await stopImpersonatingAccount(assetPiggyBank)

		console.log(`Getting redemption hints 1...`)
		const { 0: firstRedemptionHint, 1: partialRedemptionHintNewICR } = await vesselManagerOperations.getRedemptionHints(
			erc20.address,
			redemptionAmount,
			price,
			0
		)

		console.log(`Getting redemption hints 2...`)
		const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedVessels.findInsertPosition(
			erc20.address,
			partialRedemptionHintNewICR,
			ZERO_ADDRESS,
			ZERO_ADDRESS
		)

		console.log(`_asset: ${erc20.address}`)
		console.log(`_debtTokenAmount: ${redemptionAmount}`)
		console.log(`_upperPartialRedemptionHint: ${upperPartialRedemptionHint}`)
		console.log(`_lowerPartialRedemptionHint: ${lowerPartialRedemptionHint}`)
		console.log(`_firstRedemptionHint: ${firstRedemptionHint}`)
		console.log(`_partialRedemptionHintNICR: ${partialRedemptionHintNewICR}`)
		console.log(`_maxIterations: 0`)
		console.log(`_maxFeePercentage: 1000000000000000000`)

    console.log(`Treasury balance: ${f(await debtToken.balanceOf(treasury))}`)
    console.log(`Redeeming $${f(redemptionAmount)} GRAI...`)
		const redemptionTx = await vesselManagerOperations.redeemCollateral(
			erc20.address,
			redemptionAmount,
			upperPartialRedemptionHint,
			lowerPartialRedemptionHint,
			firstRedemptionHint,
			partialRedemptionHintNewICR,
			0,
			"1000000000000000000"
		)
    console.log(`Treasury balance: ${f(await debtToken.balanceOf(treasury))}`)
	})
})
