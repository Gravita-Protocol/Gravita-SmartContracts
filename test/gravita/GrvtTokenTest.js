const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN, assertRevert, ZERO_ADDRESS } = th

const deploy = async (treasury, mintingAccounts) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)

	grvtStaking = contracts.grvt.grvtStaking
	grvtToken = contracts.grvt.grvtToken
	communityIssuance = contracts.grvt.communityIssuance
}

contract("GRVTToken", async accounts => {
	const [owner, alice, bob, carol, dennis, treasury] = accounts

	const mintToABC = async () => {
		// mint some tokens
		await grvtToken.unprotectedMint(alice, dec(150, 18))
		await grvtToken.unprotectedMint(bob, dec(100, 18))
		await grvtToken.unprotectedMint(carol, dec(50, 18))
	}

	before(async () => {
		await deploy(treasury, [])
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
		await mintToABC()

		const A_Balance = await grvtToken.balanceOf(alice)
		const B_Balance = await grvtToken.balanceOf(bob)
		const C_Balance = await grvtToken.balanceOf(carol)

		assert.equal(A_Balance.toString(), dec(150, 18))
		assert.equal(B_Balance.toString(), dec(100, 18))
		assert.equal(C_Balance.toString(), dec(50, 18))
	})

	it("totalSupply(): gets the total supply (132e24 due of tests minting extra 32M)", async () => {
		const total = (await grvtToken.totalSupply()).toString()

		assert.equal(total, dec(132, 24))
	})

	it("name(): returns the token's name", async () => {
		const name = await grvtToken.name()
		assert.equal(name, "Gravita")
	})

	it("symbol(): returns the token's symbol", async () => {
		const symbol = await grvtToken.symbol()
		assert.equal(symbol, "GRVT")
	})

	it("decimal(): returns the number of decimal digits used", async () => {
		const decimals = await grvtToken.decimals()
		assert.equal(decimals, "18")
	})

	it("allowance(): returns an account's spending allowance for another account's balance", async () => {
		await mintToABC()

		await grvtToken.approve(alice, dec(100, 18), { from: bob })

		const allowance_A = await grvtToken.allowance(bob, alice)
		const allowance_D = await grvtToken.allowance(bob, dennis)

		assert.equal(allowance_A, dec(100, 18))
		assert.equal(allowance_D, "0")
	})

	it("approve(): approves an account to spend the specified ammount", async () => {
		await mintToABC()

		const allowance_A_before = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_before, "0")

		await grvtToken.approve(alice, dec(100, 18), { from: bob })

		const allowance_A_after = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_after, dec(100, 18))
	})

	it("approve(): reverts when spender param is address(0)", async () => {
		await mintToABC()

		const txPromise = grvtToken.approve(ZERO_ADDRESS, dec(100, 18), { from: bob })
		await assertRevert(txPromise)
	})

	it("approve(): reverts when owner param is address(0)", async () => {
		await mintToABC()

		const txPromise = grvtToken.callInternalApprove(ZERO_ADDRESS, alice, dec(100, 18), {
			from: bob,
		})
		await assertRevert(txPromise)
	})

	it("transferFrom(): successfully transfers from an account which it is approved to transfer from", async () => {
		await mintToABC()

		const allowance_A_0 = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_0, "0")

		await grvtToken.approve(alice, dec(50, 18), { from: bob })

		// Check A's allowance of B's funds has increased
		const allowance_A_1 = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_1, dec(50, 18))

		assert.equal(await grvtToken.balanceOf(carol), dec(50, 18))

		// A transfers from B to C, using up her allowance
		await grvtToken.transferFrom(bob, carol, dec(50, 18), { from: alice })
		assert.equal(await grvtToken.balanceOf(carol), dec(100, 18))

		// Check A's allowance of B's funds has decreased
		const allowance_A_2 = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_2, "0")

		// Check B's balance has decreased
		assert.equal(await grvtToken.balanceOf(bob), dec(50, 18))

		// A tries to transfer more tokens from B's account to C than she's allowed
		const txPromise = grvtToken.transferFrom(bob, carol, dec(50, 18), { from: alice })
		await assertRevert(txPromise)
	})

	it("transfer(): increases the recipient's balance by the correct amount", async () => {
		await mintToABC()

		assert.equal((await grvtToken.balanceOf(alice)).toString(), dec(150, 18))

		await grvtToken.transfer(alice, dec(37, 18), { from: bob })

		assert.equal((await grvtToken.balanceOf(alice)).toString(), dec(187, 18))
	})

	it("transfer(): reverts when amount exceeds sender's balance", async () => {
		await mintToABC()

		assert.equal((await grvtToken.balanceOf(bob)).toString(), dec(100, 18))

		const txPromise = grvtToken.transfer(alice, dec(101, 18), { from: bob })
		await assertRevert(txPromise)
	})

	it("transfer(): transfer to or from the zero-address reverts", async () => {
		await mintToABC()

		const txPromiseFromZero = grvtToken.callInternalTransfer(ZERO_ADDRESS, alice, dec(100, 18), { from: bob })
		const txPromiseToZero = grvtToken.callInternalTransfer(alice, ZERO_ADDRESS, dec(100, 18), { from: bob })
		await assertRevert(txPromiseFromZero)
		await assertRevert(txPromiseToZero)
	})

	it("mint(): issues correct amount of tokens to the given address", async () => {
		const A_balanceBefore = await grvtToken.balanceOf(alice)
		assert.equal(A_balanceBefore.toString(), "0")

		await grvtToken.unprotectedMint(alice, dec(100, 18))

		const A_BalanceAfter = await grvtToken.balanceOf(alice)
		assert.equal(A_BalanceAfter.toString(), dec(100, 18))
	})

	it("mint(): reverts when beneficiary is address(0)", async () => {
		const tx = grvtToken.unprotectedMint(ZERO_ADDRESS, 100)
		await assertRevert(tx)
	})

	it("increaseAllowance(): increases an account's allowance by the correct amount", async () => {
		const allowance_A_Before = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_Before, "0")

		await grvtToken.increaseAllowance(alice, dec(100, 18), { from: bob })

		const allowance_A_After = await grvtToken.allowance(bob, alice)
		assert.equal(allowance_A_After, dec(100, 18))
	})

	it("decreaseAllowance(): decreases an account's allowance by the correct amount", async () => {
		await grvtToken.increaseAllowance(alice, dec(100, 18), { from: bob })

		const A_allowance = await grvtToken.allowance(bob, alice)
		assert.equal(A_allowance, dec(100, 18))

		await grvtToken.decreaseAllowance(alice, dec(100, 18), { from: bob })

		const A_allowanceAfterDecrease = await grvtToken.allowance(bob, alice)
		assert.equal(A_allowanceAfterDecrease, "0")
	})

	it("sendToGRVTStaking(): changes balances of GRVTStaking and calling account by the correct amounts", async () => {
		// mint some tokens to A
		await grvtToken.unprotectedMint(alice, dec(150, 18))

		// Check caller and GRVTStaking balance before
		const A_BalanceBefore = await grvtToken.balanceOf(alice)
		assert.equal(A_BalanceBefore.toString(), dec(150, 18))
		const GRVTStakingBalanceBefore = await grvtToken.balanceOf(grvtStaking.address)
		assert.equal(GRVTStakingBalanceBefore.toString(), "0")

		await grvtToken.unprotectedTransferFrom(alice, grvtStaking.address, dec(37, 18))

		// Check caller and GRVTStaking balance before
		const A_BalanceAfter = await grvtToken.balanceOf(alice)
		assert.equal(A_BalanceAfter, dec(113, 18))
		const GRVTStakingBalanceAfter = await grvtToken.balanceOf(grvtStaking.address)
		assert.equal(GRVTStakingBalanceAfter, dec(37, 18))
	})
})

contract("Reset chain state", async accounts => {})
