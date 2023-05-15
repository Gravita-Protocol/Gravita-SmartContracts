const { smock } = require("@defi-wonderland/smock")

describe("Smock Test", async () => {
	it("Overwrite constant", async () => {
		const myContractFactory = await smock.mock("AdminContract")
		const myContract = await myContractFactory.deploy()
		console.log(`before: ${await myContract.readTimelockAddress()}`)
		await myContract.setVariable("timelockAddress", "0x19596e1D6cd97916514B5DBaA4730781eFE49975")
		// myContract.readTimelockAddress.returns("0x19596e1D6cd97916514B5DBaA4730781eFE49975")
		console.log(`after var: ${await myContract.timelockAddress()}`)
		console.log(`after ftn: ${await myContract.readTimelockAddress()}`)
	})
})
