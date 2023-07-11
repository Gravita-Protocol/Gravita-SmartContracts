const { expectRevert } = require("@openzeppelin/test-helpers")

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const { assertRevert, assertAssert, dec, ZERO_ADDRESS } = testHelpers.TestHelper

var snapshotId
var initialSnapshotId

contract("DebtToken", async accounts => {
	const [owner, alice, bob, carol, dennis, treasury] = accounts
	let debtToken, stabilityPool

	before(async () => {
		const contracts = await deploymentHelper.deployTestContracts(treasury, [])
		debtToken = contracts.core.debtToken
		stabilityPool = contracts.core.stabilityPool

		debtTokenWhitelistedTester = contracts.core.debtTokenWhitelistedTester
		debtToken.addWhitelist(debtTokenWhitelistedTester.address)
		chainId = await debtToken.getChainId()
		tokenVersion = 1
		tokenName = await debtToken.name()
		await debtToken.unprotectedMint(alice, 150)
		await debtToken.unprotectedMint(bob, 100)
		await debtToken.unprotectedMint(carol, 50)

		initialSnapshotId = await network.provider.send("evm_snapshot")
	})

	beforeEach(async () => {
		snapshotId = await network.provider.send("evm_snapshot")
	})

	afterEach(async () => {
		await network.provider.send("evm_revert", [snapshotId])
	})

	after(async () => {
		await network.provider.send("evm_revert", [initialSnapshotId])
	})

	it("balanceOf(): gets the balance of the account", async () => {
		const aliceBalance = (await debtToken.balanceOf(alice)).toNumber()
		const bobBalance = (await debtToken.balanceOf(bob)).toNumber()
		const carolBalance = (await debtToken.balanceOf(carol)).toNumber()

		assert.equal(aliceBalance, 150)
		assert.equal(bobBalance, 100)
		assert.equal(carolBalance, 50)
	})

	it("totalSupply(): gets the total supply", async () => {
		const total = (await debtToken.totalSupply()).toString()
		assert.equal(total, "300") // 300
	})

	it("name(): returns the token's name", async () => {
		const name = await debtToken.name()
		assert.equal(name, "Gravita Debt Token")
	})

	it("symbol(): returns the token's symbol", async () => {
		const symbol = await debtToken.symbol()
		assert.equal(symbol, "GRAI")
	})

	it("decimal(): returns the number of decimal digits used", async () => {
		const decimals = await debtToken.decimals()
		assert.equal(decimals, "18")
	})

	it("allowance(): returns an account's spending allowance for another account's balance", async () => {
		await debtToken.approve(alice, 100, { from: bob })

		const allowance_A = await debtToken.allowance(bob, alice)
		const allowance_D = await debtToken.allowance(bob, dennis)

		assert.equal(allowance_A, 100)
		assert.equal(allowance_D, "0")
	})

	it("approve(): approves an account to spend the specified amount", async () => {
		const allowance_A_before = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_before, "0")

		await debtToken.approve(alice, 100, { from: bob })

		const allowance_A_after = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_after, 100)
	})

	it("approve(): reverts when spender param is address(0)", async () => {
		const txPromise = debtToken.approve(ZERO_ADDRESS, 100, { from: bob })
		await assertAssert(txPromise)
	})

	it("approve(): reverts when owner param is address(0)", async () => {
		const txPromise = debtToken.callInternalApprove(ZERO_ADDRESS, alice, dec(1000, 18), { from: bob })
		await assertAssert(txPromise)
	})

	it("transferFrom(): successfully transfers from an account which is it approved to transfer from", async () => {
		const allowance_A_0 = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_0, "0")

		await debtToken.approve(alice, 50, { from: bob })

		// Check A's allowance of Bob's funds has increased
		const allowance_A_1 = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_1, 50)

		assert.equal(await debtToken.balanceOf(carol), 50)

		// Alice transfers from bob to Carol, using up her allowance
		await debtToken.transferFrom(bob, carol, 50, { from: alice })
		assert.equal(await debtToken.balanceOf(carol), 100)

		// Check A's allowance of Bob's funds has decreased
		const allowance_A_2 = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_2, "0")

		// Check bob's balance has decreased
		assert.equal(await debtToken.balanceOf(bob), 50)

		// Alice tries to transfer more tokens from bob's account to carol than she's allowed
		await expectRevert.unspecified(debtToken.transferFrom(bob, carol, 50, { from: alice }))
	})

	it("transfer(): increases the recipient's balance by the correct amount", async () => {
		assert.equal(await debtToken.balanceOf(alice), 150)

		await debtToken.transfer(alice, 37, { from: bob })

		assert.equal(await debtToken.balanceOf(alice), 187)
	})

	it("transfer(): reverts if amount exceeds sender's balance", async () => {
		assert.equal(await debtToken.balanceOf(bob), 100)
		await expectRevert.unspecified(debtToken.transfer(alice, 101, { from: bob }))
	})

	it("increaseAllowance(): increases an account's allowance by the correct amount", async () => {
		const allowance_A_Before = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_Before, "0")

		await debtToken.increaseAllowance(alice, 100, { from: bob })

		const allowance_A_After = await debtToken.allowance(bob, alice)
		assert.equal(allowance_A_After, 100)
	})

	it("mint(): issues correct amount of tokens to the given address", async () => {
		const alice_balanceBefore = await debtToken.balanceOf(alice)
		assert.equal(alice_balanceBefore, 150)

		await debtToken.unprotectedMint(alice, 100)

		const alice_BalanceAfter = await debtToken.balanceOf(alice)
		assert.equal(alice_BalanceAfter, 250)
	})

	it("burn(): burns correct amount of tokens from the given address", async () => {
		const alice_balanceBefore = await debtToken.balanceOf(alice)
		assert.equal(alice_balanceBefore, 150)

		await debtToken.unprotectedBurn(alice, 70)

		const alice_BalanceAfter = await debtToken.balanceOf(alice)
		assert.equal(alice_BalanceAfter, 80)
	})

	// TODO: Rewrite this test - it should check the actual debtToken's balance.
	it("sendToPool(): changes balances of Stability pool and user by the correct amounts", async () => {
		const stabilityPool_BalanceBefore = await debtToken.balanceOf(stabilityPool.address)
		const bob_BalanceBefore = await debtToken.balanceOf(bob)
		assert.equal(stabilityPool_BalanceBefore, 0)
		assert.equal(bob_BalanceBefore, 100)

		await debtToken.unprotectedSendToPool(bob, stabilityPool.address, 75)

		const stabilityPool_BalanceAfter = await debtToken.balanceOf(stabilityPool.address)
		const bob_BalanceAfter = await debtToken.balanceOf(bob)
		assert.equal(stabilityPool_BalanceAfter, 75)
		assert.equal(bob_BalanceAfter, 25)
	})

	it("returnFromPool(): changes balances of Stability pool and user by the correct amounts", async () => {
		/// --- SETUP --- give pool 100 debt tokens
		await debtToken.unprotectedMint(stabilityPool.address, 100)

		/// --- TEST ---
		const stabilityPool_BalanceBefore = await debtToken.balanceOf(stabilityPool.address)
		const bob_BalanceBefore = await debtToken.balanceOf(bob)
		assert.equal(stabilityPool_BalanceBefore, 100)
		assert.equal(bob_BalanceBefore, 100)

		await debtToken.unprotectedReturnFromPool(stabilityPool.address, bob, 75)

		const stabilityPool_BalanceAfter = await debtToken.balanceOf(stabilityPool.address)
		const bob_BalanceAfter = await debtToken.balanceOf(bob)
		assert.equal(stabilityPool_BalanceAfter, 25)
		assert.equal(bob_BalanceAfter, 175)
	})

	it("decreaseAllowance(): decreases allowance by the expected amount", async () => {
		await debtToken.approve(bob, dec(3, 18), { from: alice })
		assert.equal((await debtToken.allowance(alice, bob)).toString(), dec(3, 18))
		await debtToken.decreaseAllowance(bob, dec(1, 18), { from: alice })
		assert.equal((await debtToken.allowance(alice, bob)).toString(), dec(2, 18))
	})

	it("decreaseAllowance(): fails trying to decrease more than previously allowed", async () => {
		await debtToken.approve(bob, dec(3, 18), { from: alice })
		assert.equal((await debtToken.allowance(alice, bob)).toString(), dec(3, 18))
		await expectRevert.unspecified(debtToken.decreaseAllowance(bob, dec(4, 18), { from: alice }))
		assert.equal((await debtToken.allowance(alice, bob)).toString(), dec(3, 18))
	})

	it("mintFromWhitelistedContract(): accepts minting from whitelisted contracts", async () => {
		const wlBalanceBefore = await debtToken.balanceOf(debtTokenWhitelistedTester.address)
		assert.equal(wlBalanceBefore, 0)

		await debtTokenWhitelistedTester.mint(100)

		const wlBalanceAfter = await debtToken.balanceOf(debtTokenWhitelistedTester.address)
		assert.equal(wlBalanceAfter, 100)
	})

	it("mintFromWhitelistedContract(): should revert if not whitelisted", async () => {
		const txPromise = debtToken.mintFromWhitelistedContract(100)
		await assertRevert(txPromise, "DebtToken: Caller is not a whitelisted SC")
	})

	it("burnFromWhitelistedContract(): burns correct amount of tokens from whitelisted contracts", async () => {
		await debtTokenWhitelistedTester.mint(100)
		const wlBalanceBefore = await debtToken.balanceOf(debtTokenWhitelistedTester.address)
		assert.equal(wlBalanceBefore, 100)

		await debtTokenWhitelistedTester.burn(50)
		const wlBalanceAfter = await debtToken.balanceOf(debtTokenWhitelistedTester.address)
		assert.equal(wlBalanceAfter, 50)
	})

	it("burnFromWhitelistedContract(): should revert if not whitelisted", async () => {
		const txPromise = debtToken.burnFromWhitelistedContract(100, { from: alice })
		await assertRevert(txPromise, "DebtToken: Caller is not a whitelisted SC")
	})

	it("removeWhitelist(): should revert after contract is removed from WL", async () => {
		await debtToken.removeWhitelist(debtTokenWhitelistedTester.address)
		const txPromise = debtTokenWhitelistedTester.mint(100)
		await assertRevert(txPromise, "DebtToken: Caller is not a whitelisted SC")
	})
})

contract("Reset chain state", async accounts => {})
