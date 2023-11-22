const {
	time,
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { assert, web3 } = require("hardhat")

const deploymentHelper = require("../utils/deploymentHelpers.js")

const { TestHelper } = require("../utils/testHelpers.js")
const { assertRevert, fastForwardTime } = TestHelper

const DEFAULT_DIGITS = 18
const LUSD_ADDRESS = "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0"
const lusdHolder = "0x24Cbbef882a77c5AAA9ABd6558E68B4c648453c5"

/**
 * The following setting was used to run these tests
 * hardhat: {
			forking: {
				url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
				blockNumber: 17835000,
			},
		},
 */
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

		it("Sell LUSD reverts if not enough balance", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 100)
			await assertRevert(lusdPsm.sellLUSD(100, { from: lusdHolder }))
		})

		it("Sell LUSD reverts if amount == 0", async () => {
			await impersonateAccount(lusdHolder)
			await assertRevert(lusdPsm.sellLUSD(0), { from: lusdHolder })
		})

		it("Owner withdraws amount from AAVE", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 100)
			await lusdPsm.sellLUSD(100, { from: lusdHolder })

			await fastForwardTime(100000000, web3.currentProvider)
			await lusdPsm.withdrawExcessFromDeposits(105)
			assert.equal(await lusd.balanceOf(treasury), 106)
		})

		it("Withdraw reverts if not owner", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 100)
			await lusdPsm.sellLUSD(100, { from: lusdHolder })

			await fastForwardTime(100000000, web3.currentProvider)
			await assertRevert(lusdPsm.collectYield({ from: alice }))
		})

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

		it("Buy LUSD reverts if not enough LUSD", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 102)
			await lusdPsm.sellLUSD(102, { from: lusdHolder })
			const balance = await debtToken.balanceOf(lusdHolder)

			const balanceLusdBefore = await lusd.balanceOf(lusdHolder)
			await debtToken.approve(lusdPsm.address, 102, { from: lusdHolder })
			await assertRevert(lusdPsm.buyLUSD(105, { from: lusdHolder }))
		})

		it("Buy LUSD reverts if amount == 0", async () => {
			await assertRevert(lusdPsm.buyLUSD(0))
		})

		it("Collect yield withdraws amount over what needs to be kept to back minted GRAI", async () => {
			await impersonateAccount(lusdHolder)
			holder = await ethers.getSigner(lusdHolder)
			await lusd.connect(holder).approve(lusdPsm.address, 100)
			await lusdPsm.sellLUSD(100, { from: lusdHolder })
			await lusd.connect(holder).approve(lusdPsm.address, 1000)
			await lusdPsm.sellLUSD(1000, { from: lusdHolder })
			await fastForwardTime(100000000, web3.currentProvider)
			await lusdPsm.collectYield()
		})
	})
})

contract("Reset chain state", async accounts => {})

