const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const { keccak256 } = require("@ethersproject/keccak256")
const { defaultAbiCoder } = require("@ethersproject/abi")
const { toUtf8Bytes } = require("@ethersproject/strings")
const { pack } = require("@ethersproject/solidity")
const { hexlify } = require("@ethersproject/bytes")
const { ecsign } = require("ethereumjs-util")

// the second account our hardhatenv creates (for EOA A)
// from https://github.com/liquity/dev/blob/main/packages/contracts/hardhatAccountsList2k.js#L3

const th = testHelpers.TestHelper
const { dec, toBN, assertRevert, ZERO_ADDRESS } = th

const deploy = async (treasury, mintingAccounts) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)

	grvtStaking = contracts.grvt.grvtStaking
	grvtToken = contracts.grvt.grvtToken
	communityIssuance = contracts.grvt.communityIssuance
}

contract("GRVT Token", async accounts => {
	const [owner, A, B, C, D, treasury] = accounts

	// Create the approval tx data, for use in permit()
	const approve = {
		owner: A,
		spender: B,
		value: 1,
	}

	const A_PrivateKey = "0xeaa445c85f7b438dEd6e831d06a4eD0CEBDc2f8527f84Fcda6EBB5fCfAd4C0e9"

	const sign = (digest, privateKey) => {
		return ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.slice(2), "hex"))
	}

	const PERMIT_TYPEHASH = keccak256(
		toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
	)

	// Returns the EIP712 hash which should be signed by the user
	// in order to make a call to `permit`
	const getPermitDigest = (domain, owner, spender, value, nonce, deadline) => {
		return keccak256(
			pack(
				["bytes1", "bytes1", "bytes32", "bytes32"],
				[
					"0x19",
					"0x01",
					domain,
					keccak256(
						defaultAbiCoder.encode(
							["bytes32", "address", "address", "uint256", "uint256", "uint256"],
							[PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
						)
					),
				]
			)
		)
	}

	const mintToABC = async () => {
		// mint some tokens
		await grvtToken.unprotectedMint(A, dec(150, 18))
		await grvtToken.unprotectedMint(B, dec(100, 18))
		await grvtToken.unprotectedMint(C, dec(50, 18))
	}

	const buildPermitTx = async deadline => {
		const nonce = (await grvtToken.nonces(approve.owner)).toString()

		// Get the EIP712 digest
		const digest = getPermitDigest(
			await grvtToken.domainSeparator(),
			approve.owner,
			approve.spender,
			approve.value,
			nonce,
			deadline
		)

		const { v, r, s } = sign(digest, A_PrivateKey)

		const tx = grvtToken.permit(
			approve.owner,
			approve.spender,
			approve.value,
			deadline,
			v,
			hexlify(r),
			hexlify(s)
		)

		return { v, r, s, tx }
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

		const A_Balance = await grvtToken.balanceOf(A)
		const B_Balance = await grvtToken.balanceOf(B)
		const C_Balance = await grvtToken.balanceOf(C)

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

		await grvtToken.approve(A, dec(100, 18), { from: B })

		const allowance_A = await grvtToken.allowance(B, A)
		const allowance_D = await grvtToken.allowance(B, D)

		assert.equal(allowance_A, dec(100, 18))
		assert.equal(allowance_D, "0")
	})

	it("approve(): approves an account to spend the specified ammount", async () => {
		await mintToABC()

		const allowance_A_before = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_before, "0")

		await grvtToken.approve(A, dec(100, 18), { from: B })

		const allowance_A_after = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_after, dec(100, 18))
	})

	it("approve(): reverts when spender param is address(0)", async () => {
		await mintToABC()

		const txPromise = grvtToken.approve(ZERO_ADDRESS, dec(100, 18), { from: B })
		await assertRevert(txPromise)
	})

	it("approve(): reverts when owner param is address(0)", async () => {
		await mintToABC()

		const txPromise = grvtToken.callInternalApprove(ZERO_ADDRESS, A, dec(100, 18), {
			from: B,
		})
		await assertRevert(txPromise)
	})

	it("transferFrom(): successfully transfers from an account which it is approved to transfer from", async () => {
		await mintToABC()

		const allowance_A_0 = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_0, "0")

		await grvtToken.approve(A, dec(50, 18), { from: B })

		// Check A's allowance of B's funds has increased
		const allowance_A_1 = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_1, dec(50, 18))

		assert.equal(await grvtToken.balanceOf(C), dec(50, 18))

		// A transfers from B to C, using up her allowance
		await grvtToken.transferFrom(B, C, dec(50, 18), { from: A })
		assert.equal(await grvtToken.balanceOf(C), dec(100, 18))

		// Check A's allowance of B's funds has decreased
		const allowance_A_2 = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_2, "0")

		// Check B's balance has decreased
		assert.equal(await grvtToken.balanceOf(B), dec(50, 18))

		// A tries to transfer more tokens from B's account to C than she's allowed
		const txPromise = grvtToken.transferFrom(B, C, dec(50, 18), { from: A })
		await assertRevert(txPromise)
	})

	it("transfer(): increases the recipient's balance by the correct amount", async () => {
		await mintToABC()

		assert.equal((await grvtToken.balanceOf(A)).toString(), dec(150, 18))

		await grvtToken.transfer(A, dec(37, 18), { from: B })

		assert.equal((await grvtToken.balanceOf(A)).toString(), dec(187, 18))
	})

	it("transfer(): reverts when amount exceeds sender's balance", async () => {
		await mintToABC()

		assert.equal((await grvtToken.balanceOf(B)).toString(), dec(100, 18))

		const txPromise = grvtToken.transfer(A, dec(101, 18), { from: B })
		await assertRevert(txPromise)
	})

	it("transfer(): transfer to or from the zero-address reverts", async () => {
		await mintToABC()

		const txPromiseFromZero = grvtToken.callInternalTransfer(ZERO_ADDRESS, A, dec(100, 18), { from: B })
		const txPromiseToZero = grvtToken.callInternalTransfer(A, ZERO_ADDRESS, dec(100, 18), { from: B })
		await assertRevert(txPromiseFromZero)
		await assertRevert(txPromiseToZero)
	})

	it("mint(): issues correct amount of tokens to the given address", async () => {
		const A_balanceBefore = await grvtToken.balanceOf(A)
		assert.equal(A_balanceBefore.toString(), "0")

		await grvtToken.unprotectedMint(A, dec(100, 18))

		const A_BalanceAfter = await grvtToken.balanceOf(A)
		assert.equal(A_BalanceAfter.toString(), dec(100, 18))
	})

	it("mint(): reverts when beneficiary is address(0)", async () => {
		const tx = grvtToken.unprotectedMint(ZERO_ADDRESS, 100)
		await assertRevert(tx)
	})

	it("increaseAllowance(): increases an account's allowance by the correct amount", async () => {
		const allowance_A_Before = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_Before, "0")

		await grvtToken.increaseAllowance(A, dec(100, 18), { from: B })

		const allowance_A_After = await grvtToken.allowance(B, A)
		assert.equal(allowance_A_After, dec(100, 18))
	})

	it("decreaseAllowance(): decreases an account's allowance by the correct amount", async () => {
		await grvtToken.increaseAllowance(A, dec(100, 18), { from: B })

		const A_allowance = await grvtToken.allowance(B, A)
		assert.equal(A_allowance, dec(100, 18))

		await grvtToken.decreaseAllowance(A, dec(100, 18), { from: B })

		const A_allowanceAfterDecrease = await grvtToken.allowance(B, A)
		assert.equal(A_allowanceAfterDecrease, "0")
	})

	it("sendToGRVTStaking(): changes balances of GRVTStaking and calling account by the correct amounts", async () => {
		// mint some tokens to A
		await grvtToken.unprotectedMint(A, dec(150, 18))

		// Check caller and GRVTStaking balance before
		const A_BalanceBefore = await grvtToken.balanceOf(A)
		assert.equal(A_BalanceBefore.toString(), dec(150, 18))
		const GRVTStakingBalanceBefore = await grvtToken.balanceOf(grvtStaking.address)
		assert.equal(GRVTStakingBalanceBefore.toString(), "0")

		await grvtToken.unprotectedTransferFrom(A, grvtStaking.address, dec(37, 18))

		// Check caller and GRVTStaking balance before
		const A_BalanceAfter = await grvtToken.balanceOf(A)
		assert.equal(A_BalanceAfter, dec(113, 18))
		const GRVTStakingBalanceAfter = await grvtToken.balanceOf(grvtStaking.address)
		assert.equal(GRVTStakingBalanceAfter, dec(37, 18))
	})

	// EIP2612 tests

	it("Initializes PERMIT_TYPEHASH correctly", async () => {
		assert.equal(await grvtToken.PERMIT_TYPEHASH(), PERMIT_TYPEHASH)
	})

	it("Initial nonce for a given address is 0", async function () {
		assert.equal(toBN(await grvtToken.nonces(A)).toString(), "0")
	})

	it("permit(): permits and emits an Approval event (replay protected)", async () => {
		const deadline = 100000000000000

		// Approve it
		const { v, r, s, tx } = await buildPermitTx(deadline)
		const receipt = await tx
		const event = receipt.logs[0]

		// Check that approval was successful
		assert.equal(event.event, "Approval")
		assert.equal(await grvtToken.nonces(approve.owner), 1)
		assert.equal(await grvtToken.allowance(approve.owner, approve.spender), approve.value)

		// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
		await assertRevert(
			grvtToken.permit(approve.owner, approve.spender, approve.value, deadline, v, r, s),
			"GRVT: invalid signature"
		)

		// Check that the zero address fails
		await assertRevert(
			grvtToken.permit(
				"0x0000000000000000000000000000000000000000",
				approve.spender,
				approve.value,
				deadline,
				"0x99",
				r,
				s
			),
			"GRVT: invalid signature"
		)
	})

	it("permit(): fails with expired deadline", async () => {
		const deadline = 1

		const { v, r, s, tx } = await buildPermitTx(deadline)
		await assertRevert(tx, "GRVT: expired deadline")
	})

	it("permit(): fails with the wrong signature", async () => {
		const deadline = 100000000000000

		const { v, r, s } = await buildPermitTx(deadline)

		const tx = grvtToken.permit(
			C,
			approve.spender,
			approve.value, // Carol is passed as spender param, rather than Bob
			deadline,
			v,
			hexlify(r),
			hexlify(s)
		)

		await assertRevert(tx, "GRVT: invalid signature")
	})
})

contract("Reset chain state", async accounts => {})

