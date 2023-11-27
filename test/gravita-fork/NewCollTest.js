// Setup in hardhat.config.ts:
// hardhat: {
// 	accounts: accountsList,
// 	chainId: 1,
// 	forking: {
// 		url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
// 		blockNumber: 18664477,
// 	},
// },

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

const AdminContract = artifacts.require("AdminContract")
const BorrowerOperations = artifacts.require("BorrowerOperations")
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const VesselManager = artifacts.require("VesselManager")

const asset = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee' // weETH
const assetPiggyBank = '0xBA12222222228d8Ba445958a75a0704d566BF2C8' // Balancer Vault
const adminContractAddress = '0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53'

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
		console.log(`PriceFeed: ${priceFeed.address}`)
        const price = await priceFeed.fetchPrice(asset)
		console.log(`PriceFeed's price: ${f(price)}`)
		const amount = p('10')

		// piggy bank gives user some of his asset
		await setBalance(assetPiggyBank, p('10'))
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

