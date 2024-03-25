import { BigNumber } from "ethers"
import { artifacts, assert, contract, ethers, network, upgrades } from "hardhat"

const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

/**
 *  Configure hardhat.config.ts before running:
  
		hardhat: {
			accounts: accountsList,
			chainId: 1,
			forking: {
				url: `https://eth-mainnet.g.alchemy.com/v2/[API-KEY]`,
				blockNumber: 19027577,
			},
		},
 */

const BorrowerOperations = artifacts.require("BorrowerOperations")
const ERC20 = artifacts.require("ERC20")
const PriceFeed = artifacts.require("PriceFeed")
const VesselManager = artifacts.require("VesselManager")

const f = v => ethers.utils.formatEther(v.toString())
const p = s => ethers.utils.parseEther(s)

contract("LastVesselTest", async () => {
	it("Close and reopen last vessel", async () => {
		const borrowerOperations = await BorrowerOperations.at("0x2bCA0300c2aa65de6F19c2d241B54a445C9990E2")
		const vesselManager = await VesselManager.at("0xdB5DAcB1DFbe16326C3656a88017f0cB4ece0977")
		const asset = "0xA35b1B31Ce002FBF2058D22F30f95D405200A15b" // ETHx on Mainnet
		const borrower = "0x7ee02ce5ccce84b892dc42d9fe3b938aca9c2933"
		const grai = "0x15f74458aE0bFdAA1a96CA1aa779D715Cc1Eefe4"
		const graiPiggyBank = "0x4F39F12064D83F6Dd7A2BDb0D53aF8be560356A6" // StabilityPool

		console.log(`Fixing ETHx feed...`)
		const priceFeed = await PriceFeed.at(await borrowerOperations.priceFeed())
		const timelock = await priceFeed.timelockAddress()
		await setBalance(timelock, p("100"))
		await impersonateAccount(timelock)
		await priceFeed.setOracle(asset, "0xFaBEb1474C2Ab34838081BFdDcE4132f640E7D2d", 0, 90_000, false, false, {
			from: timelock,
		})
		await stopImpersonatingAccount(timelock)

		console.log(`Upgrading VesselManager...`)
		const multisig = await vesselManager.owner()
		await setBalance(multisig, p("100"))
		await impersonateAccount(multisig)
		const newVesselManager = await VesselManager.new()
		await vesselManager.upgradeTo(newVesselManager.address, { from: multisig })
		await stopImpersonatingAccount(multisig)

		console.log(`Borrower acquires GRAI for fees...`)
		const graiContract = await ERC20.at(grai)
		await setBalance(graiPiggyBank, p("100"))
		await impersonateAccount(graiPiggyBank)
		await graiContract.transfer(borrower, p("1000"), { from: graiPiggyBank })
		await stopImpersonatingAccount(graiPiggyBank)

		console.log(`Borrower Debt: $${f(await vesselManager.getVesselDebt(asset, borrower))} GRAI`)
		console.log(`Borrower Balance: $${f(await graiContract.balanceOf(borrower))} GRAI`)

		console.log(`getVesselStatus() -> ${await vesselManager.getVesselStatus(asset, borrower)}`)
		console.log(`Borrower closes vessel...`)
		await setBalance(borrower, p("100"))
		await impersonateAccount(borrower)
		await borrowerOperations.closeVessel(asset, { from: borrower })
		console.log(`getVesselOwnersCount() -> ${await vesselManager.getVesselOwnersCount(asset)}`)

    const assetContract = await ERC20.at(asset)
    console.log(`Borrower collateral balance: ${f(await assetContract.balanceOf(borrower))}`)
		console.log(`Borrower opens new vessel...`)
    await assetContract.approve(borrowerOperations.address, p("2"), { from: borrower })
		await borrowerOperations.openVessel(
			asset,
			p("2"),
			p("2000"),
			ethers.constants.AddressZero,
			ethers.constants.AddressZero,
      { from: borrower }
		)

		console.log(`Borrower closes vessel again...`)
		await borrowerOperations.closeVessel(asset, { from: borrower })

		await stopImpersonatingAccount(borrower)
	})
})
