import { artifacts, assert, contract, ethers, network } from "hardhat"

import { setBalance, impersonateAccount, stopImpersonatingAccount } from "@nomicfoundation/hardhat-network-helpers"

const BorrowerOperations = artifacts.require("BorrowerOperations")
const VesselManager = artifacts.require("VesselManager")

const f = (v: any) => ethers.utils.formatEther(v.toString())
const p = (s: any) => ethers.utils.parseEther(s)

contract("ContractUpgradeTest", async () => {
	it("upgradeTo()", async () => {
		const borrowerOperations = await BorrowerOperations.at("0x2bCA0300c2aa65de6F19c2d241B54a445C9990E2")
    const vesselManager = await VesselManager.at(await borrowerOperations.vesselManager())
    const owner = await vesselManager.owner()

    const asset = "0xA35b1B31Ce002FBF2058D22F30f95D405200A15b" // ETHx
    const borrower = "0x7ee02ce5ccce84b892dc42d9fe3b938aca9c2933"
    const newImplAddress = "0xF2f6dD29A5fdaa4e8443f195f06f400A592eB15e"

    console.log(`Upgrading...`)
		await setBalance(owner, p("100"))
		await impersonateAccount(owner)
		await vesselManager.upgradeTo(newImplAddress, { from: owner })
		await stopImpersonatingAccount(owner)

    console.log(`Closing vessel...`)
		await impersonateAccount(borrower)
		await setBalance(borrower, p("100"))
		await borrowerOperations.closeVessel(asset, { from: borrower })
		await stopImpersonatingAccount(borrower)
	})
})
