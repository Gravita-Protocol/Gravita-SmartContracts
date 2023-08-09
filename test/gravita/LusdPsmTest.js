const {
	time,
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { assert } = require("hardhat")

const deploymentHelper = require("../utils/deploymentHelpers.js")

const { TestHelper } = require("../utils/testHelpers.js")
const { dec, assertRevert, toBN } = TestHelper

const DEFAULT_DIGITS = 18
const DEFAULT_PRICE = dec(100, DEFAULT_DIGITS)
const LUSD_ADDRESS = "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0"
const lusdHolder = "0x24Cbbef882a77c5AAA9ABd6558E68B4c648453c5"

contract("LusdPsm", async accounts => {
	const [owner, alice, bob, carol, dennis, treasury] = accounts

	beforeEach(async () => {
		const contracts = await deploymentHelper.deployTestContracts(treasury, [alice], LUSD_ADDRESS)
		lusdPsm = await contracts.core.lusdPsm
		debtToken = await contracts.core.debtToken
		await debtToken.addWhitelist(lusdPsm.address)
		lusd = await ethers.getContractAt("ERC20Mock", LUSD_ADDRESS)
	})

	describe("Sell LUSD", async () => {
		it("Sell LUSD moves the correct amount of GRAI and LUSD", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 100)
			await lusdPsm.sellLUSD(100, { from: lusdHolder })
			const balance = await debtToken.balanceOf(lusdHolder)
			assert.equal(balance.toString(), "99")
		})
	})

	describe("Buy LUSD", async () => {
		it("Buy LUSD moves the correct amount of GRAI and LUSD", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 102)
			await lusdPsm.sellLUSD(102, { from: lusdHolder })
			const balance = await debtToken.balanceOf(lusdHolder)

			const balanceLusdBefore = await lusd.balanceOf(lusdHolder)
			await debtToken.approve(lusdPsm.address, 102, { from: lusdHolder })
			await lusdPsm.buyLUSD(100, { from: lusdHolder })
			const balanceGrai = await debtToken.balanceOf(lusdHolder)
			const balanceLusdAfter = await lusd.balanceOf(lusdHolder)
			assert.equal(balanceGrai.toString(), "0")
			assert.equal(balanceLusdAfter.sub(balanceLusdBefore).toString(), 100)
		})
	})
})

contract("Reset chain state", async accounts => {})

