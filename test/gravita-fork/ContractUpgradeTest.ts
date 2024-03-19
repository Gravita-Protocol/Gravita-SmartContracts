import { artifacts, assert, contract, ethers, network } from "hardhat"

import { setBalance, impersonateAccount, stopImpersonatingAccount } from "@nomicfoundation/hardhat-network-helpers"

const AdminContract = artifacts.require("AdminContract")
const BorrowerOperations = artifacts.require("BorrowerOperations")
const DebtToken = artifacts.require("DebtToken")
const SortedVessels = artifacts.require("SortedVessels")
const VesselManager = artifacts.require("VesselManager")

const f = (v: any) => ethers.utils.formatEther(v.toString())
const p = (s: any) => ethers.utils.parseEther(s)

const ADMIN_CONTRACT_ARBITRUM = '0x4928c8F8c20A1E3C295DddBe05095A9aBBdB3d14'
const ADMIN_CONTRACT_LINEA = '0xC8a25eA0Cbd92A6F787AeED8387E04559053a9f8'
const ADMIN_CONTRACT_MAINNET = '0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53'
const ADMIN_CONTRACT_MANTLE = '0x4F39F12064D83F6Dd7A2BDb0D53aF8be560356A6'
const ADMIN_CONTRACT_OPTIMISM = '0x326398De2dB419Ee39F97600a5eeE97093cf3B27'
const ADMIN_CONTRACT_POLYGON_ZKEVM = '0x6b42581aC12F442503Dfb3dff2bC75ed83850637'

const NEW_VESSEL_MANAGER_IMPL_ADDRESS = '0x159fc49e0a5935ad6CB715D28BA07FC347854731'

contract("ContractUpgradeTest", async () => {
	it("upgradeTo()", async () => {
		const adminContract = await AdminContract.at(ADMIN_CONTRACT_OPTIMISM)
		const borrowerOperations = await BorrowerOperations.at(await adminContract.borrowerOperations())
		const debtToken = await DebtToken.at(await adminContract.debtToken())
		const sortedVessels = await SortedVessels.at(await adminContract.sortedVessels())
    const vesselManager = await VesselManager.at(await adminContract.vesselManager())
    const owner = await vesselManager.owner()

    const asset = (await adminContract.getValidCollateral())[0]
		console.log(`Asset: ${asset}`)
    const borrower = await sortedVessels.getFirst(asset)

    console.log(`Upgrading...`)
		await setBalance(owner, p("100"))
		await impersonateAccount(owner)
		await vesselManager.upgradeTo(NEW_VESSEL_MANAGER_IMPL_ADDRESS, { from: owner })
		await stopImpersonatingAccount(owner)

		console.log(`Fetching debt...`)
		const graiDebt = await vesselManager.getVesselDebt(asset, borrower)

		console.log(`Whitelisting borrower...`)
		await impersonateAccount(owner)
		await debtToken.addWhitelist(borrower, { from: owner })
		await stopImpersonatingAccount(owner)

		console.log(`Obtaining funds to pay off debt...`)
		await impersonateAccount(borrower)
		await setBalance(borrower, p("100"))
		await debtToken.mintFromWhitelistedContract(graiDebt, { from: borrower })

    console.log(`Closing vessel...`)
		await borrowerOperations.closeVessel(asset, { from: borrower })
		await stopImpersonatingAccount(borrower)
	})
})
