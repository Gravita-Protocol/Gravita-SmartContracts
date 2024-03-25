// Setup in hardhat.config.ts:
// hardhat: {
// 	accounts: accountsList,
// 	chainId: 1101,
// 	forking: {
// 		url: "https://polygonzkevm-mainnet.g.alchemy.com/v2/[API-KEY]",
// 		blockNumber: 9228745,
// 	},
// },

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

const AdminContract = artifacts.require("AdminContract")
const BorrowerOperations = artifacts.require("BorrowerOperations")
const DebtToken = artifacts.require("DebtToken")
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const VesselManager = artifacts.require("VesselManager")

const asset = '0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38' // osETH on Mainnet
const assetPiggyBank = '0xBA12222222228d8Ba445958a75a0704d566BF2C8' // Balancer Vault
const adminContractAddress = '0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53'

let borrowerOperations, debtToken, priceFeed, vesselManager

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("CollTest", async accounts => {
	const [user] = accounts

	before(async () => {
		const adminContract = await AdminContract.at(adminContractAddress)
		borrowerOperations = await BorrowerOperations.at(await adminContract.borrowerOperations())
		debtToken = await DebtToken.at(await adminContract.debtToken())
		priceFeed = await PriceFeed.at(await adminContract.priceFeed())
		vesselManager = await VesselManager.at(await adminContract.vesselManager())

		const oftOwner = "0x853b5db6310292dF1C8C05Ad0a4fdf0856B772BB"
		await setBalance(oftOwner, p("100"))
		await impersonateAccount(oftOwner)
		console.log("debtToken.setAddresses()")
		await debtToken.setAddresses(
			borrowerOperations.address,
			await adminContract.stabilityPool(),
			vesselManager.address,
			{ from: oftOwner }
		)
		await stopImpersonatingAccount(oftOwner)
	})

	it("openVessel()", async () => {
		const erc20 = await ERC20.at(asset)
		console.log(`Using ${await erc20.symbol()} as collateral`)

		const multisig = await priceFeed.owner()
		await setBalance(multisig, p("100"))
		await impersonateAccount(multisig)

		console.log(`Configuring new oracle...`)
		const isEthIndexed = true
		await priceFeed.setOracle(asset, "0x66ac817f997efd114edfcccdce99f3268557b32c", 0, 90_000, isEthIndexed, false, {
			from: multisig,
		})
		await stopImpersonatingAccount(multisig)

		const price = await priceFeed.fetchPrice(asset)
		console.log(`PriceFeed's price: ${f(price)}`)
		const amount = p("100")

		// piggy bank gives user some of his asset
		await setBalance(assetPiggyBank, p("100"))
		await impersonateAccount(assetPiggyBank)
		await erc20.transfer(user, amount, { from: assetPiggyBank })
		await stopImpersonatingAccount(assetPiggyBank)

		const debt = amount.mul(price.toString()).div(p("2"))
		console.log(`Approving transfer of $${f(amount)} collateral...`)
		await erc20.approve(borrowerOperations.address, amount)
		console.log(`Opening a $${f(debt)} GRAI vessel...`)
		await borrowerOperations.openVessel(asset, amount, debt, user, user)
		const totalDebt = await vesselManager.getVesselDebt(asset, user)
		console.log(`Vessel debt: $${f(totalDebt)} GRAI`)
		assert.equal(debt.toString(), await debtToken.balanceOf(user))
	})
})
