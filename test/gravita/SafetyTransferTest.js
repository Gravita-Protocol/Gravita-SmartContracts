const SafetyTransferTester = artifacts.require("SafetyTransferTester")
const ERC20DecimalsMock = artifacts.require("ERC20DecimalsMock")

const testHelpers = require("../utils/testHelpers.js")

const { dec, toBN } = testHelpers.TestHelper

contract("SafetyTransfer", async () => {
	let safetyTransfer
  let amount = toBN(dec(1, "ether"))

	before(async () => {
		safetyTransfer = await SafetyTransferTester.new()
	})

	describe("Tests", async () => {
		it("Test ERC20 with 16 decimals", async () => {
			const erc16Decimals = await ERC20DecimalsMock.new(16)
			const result = await safetyTransfer.decimalsCorrection(erc16Decimals.address, amount)
			const expectedResult = 1e16
			assert.equal(result, expectedResult)
		})

		it("Test ERC20 with 18 decimals", async () => {
			const erc18Decimals = await ERC20DecimalsMock.new(18)
			const result = await safetyTransfer.decimalsCorrection(erc18Decimals.address, amount)
			const expectedResult = 1e18
			assert.equal(result, expectedResult)
		})

		it("Test ERC20 with 20 decimals", async () => {
			const erc20Decimals = await ERC20DecimalsMock.new(20)
			const result = await safetyTransfer.decimalsCorrection(erc20Decimals.address, amount)
			const expectedResult = 1e20
			assert.equal(result, expectedResult)
		})
	})
})

contract("Reset chain state", async () => {})
