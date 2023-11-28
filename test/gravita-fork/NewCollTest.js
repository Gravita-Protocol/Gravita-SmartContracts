// Setup in hardhat.config.ts:
// hardhat: {
// 	accounts: accountsList,
// 	chainId: 10,
// 	forking: {
// 		url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
// 		blockNumber: 112763546,
// 	},
// },

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

const AdminContract = artifacts.require("AdminContract")
const BorrowerOperations = artifacts.require("BorrowerOperations")
const DebtToken = artifacts.require("DebtToken")
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const VesselManager = artifacts.require("VesselManager")

const asset = "0x9bcef72be871e61ed4fbbc7630889bee758eb81d" // "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb" // "0x4200000000000000000000000000000000000006"
const assetPiggyBank = "0x724dc807b04555b71ed48a6896b6f41593b8c637" // "0xc45a479877e1e9dfe9fcd4056c699575a1045daa" // "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8"
const adminContractAddress = "0x326398De2dB419Ee39F97600a5eeE97093cf3B27"

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
		console.log(`Using ${await erc20.name()} as collateral`)
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
