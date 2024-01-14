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
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const VesselManager = artifacts.require("VesselManager")

const asset = '0xb23C20EFcE6e24Acca0Cef9B7B7aA196b84EC942' // rETH on zkEVM
const assetPiggyBank = '0xBA12222222228d8Ba445958a75a0704d566BF2C8' // Balancer Vault
const adminContractAddress = '0x6b42581aC12F442503Dfb3dff2bC75ed83850637'

let priceFeed, borrowerOperations

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("CollTest", async accounts => {

	const [user] = accounts

	before(async () => {
		const adminContract = await AdminContract.at(adminContractAddress)
		priceFeed = await PriceFeed.at(await adminContract.priceFeed())
		borrowerOperations = await BorrowerOperations.at(await adminContract.borrowerOperations())
		vesselManager = await VesselManager.at(await adminContract.vesselManager())
	})

	it("openVessel()", async () => {
		const erc20 = await ERC20.at(asset)
		console.log(`Using ${await erc20.name()} as collateral`)
        const price = await priceFeed.fetchPrice(asset)
		console.log(`PriceFeed's price: ${f(price)}`)
		const amount = p('100')

		// piggy bank gives user some of his asset
		await setBalance(assetPiggyBank, p('100'))
		await impersonateAccount(assetPiggyBank)
		await erc20.transfer(user, amount, { from: assetPiggyBank })
		await stopImpersonatingAccount(assetPiggyBank)

		const debt = amount.mul(price.toString()).div(p('2'))
		console.log(`Approving transfer of $${f(amount)} collateral...`)
		await erc20.approve(borrowerOperations.address, amount)
		console.log(`Opening a $${f(debt)} GRAI vessel...`)
		await borrowerOperations.openVessel(asset, amount, debt, user, user)
		const totalDebt = await vesselManager.getVesselDebt(asset, user)
		console.log(`Vessel debt: $${f(totalDebt)} GRAI`)
	})
})

