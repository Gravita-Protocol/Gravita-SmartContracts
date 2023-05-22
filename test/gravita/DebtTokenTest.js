const { keccak256 } = require("@ethersproject/keccak256")
const { defaultAbiCoder } = require("@ethersproject/abi")
const { toUtf8Bytes } = require("@ethersproject/strings")
const { pack } = require("@ethersproject/solidity")
const { hexlify } = require("@ethersproject/bytes")
const { ecsign } = require("ethereumjs-util")
const { expectRevert } = require("@openzeppelin/test-helpers")

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const { toBN, assertRevert, assertAssert, dec, ZERO_ADDRESS } = testHelpers.TestHelper

const PERMIT_TYPEHASH = keccak256(
	toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
)

const sign = (digest, privateKey) => {
	return ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.slice(2), "hex"))
}

// Returns the EIP712 hash which should be signed by the user
// in order to make a call to `permit`
const getPermitDigest = (domain, owner, spender, value, nonce, deadline) => {
	// Counters.Counter storage nonce = _nonces[owner];
	// bytes32 hashStruct = keccak256(
	// 	abi.encode(PERMIT_TYPEHASH, owner, spender, amount, nonce.current(), deadline)
	// );
	// bytes32 _hash = keccak256(abi.encodePacked(uint16(0x1901), domainSeparator(), hashStruct));
	// address signer = ECDSA.recover(_hash, v, r, s);

	console.log(`js.owner: ${owner}`)
	console.log(`js.spender: ${spender}`)

	const hashStruct = keccak256(
		pack(
			["uint16", "bytes32", "bytes32"],
			[
				"0x1901",
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
	return hashStruct
}

var contracts
var snapshotId
var initialSnapshotId

const deploy = async (treasury, mintingAccounts) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)

	activePool = contracts.core.activePool
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	collSurplusPool = contracts.core.collSurplusPool
	debtToken = contracts.core.debtToken
	defaultPool = contracts.core.defaultPool
	erc20 = contracts.core.erc20
	feeCollector = contracts.core.feeCollector
	gasPool = contracts.core.gasPool
	priceFeed = contracts.core.priceFeedTestnet
	sortedVessels = contracts.core.sortedVessels
	stabilityPool = contracts.core.stabilityPool
	vesselManager = contracts.core.vesselManager
	vesselManagerOperations = contracts.core.vesselManagerOperations
	shortTimelock = contracts.core.shortTimelock
	longTimelock = contracts.core.longTimelock

	grvtStaking = contracts.grvt.grvtStaking
	grvtToken = contracts.grvt.grvtToken
	communityIssuance = contracts.grvt.communityIssuance
}

contract("DebtToken", async accounts => {
	const [owner, alice, bob, carol, dennis, treasury] = accounts

	// the second account our hardhatenv creates (for Alice)
	// from https://github.com/liquity/dev/blob/main/packages/contracts/hardhatAccountsList2k.js#L3
	const alicePrivateKey = "0xeaa445c85f7b438dEd6e831d06a4eD0CEBDc2f8527f84Fcda6EBB5fCfAd4C0e9"

	// Create the approval tx data
	const approve = {
		owner: alice,
		spender: bob,
		value: 1,
	}

	const buildPermitTx = async deadline => {
		const nonce = (await debtToken.nonces(approve.owner)).toString()

		// Get the EIP712 digest
		const digest = getPermitDigest(
			await debtToken.domainSeparator(),
			approve.owner,
			approve.spender,
			approve.value,
			nonce,
			deadline
		)

		const { v, r, s } = sign(digest, alicePrivateKey)

		const tx = debtToken.permit(approve.owner, approve.spender, approve.value, deadline, v, hexlify(r), hexlify(s))

		return { v, r, s, tx }
	}

	before(async () => {
		await deploy(treasury, [])

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

	// EIP2612 tests

	it("Initializes PERMIT_TYPEHASH correctly", async () => {
		assert.equal(await debtToken.PERMIT_TYPEHASH(), PERMIT_TYPEHASH)
	})

	it("Initial nonce for a given address is 0", async function () {
		assert.equal(toBN(await debtToken.nonces(alice)).toString(), "0")
	})

	it.only("permits and emits an Approval event (replay protected)", async () => {
		const deadline = 100_000_000_000_000

		// Approve it
		const { v, r, s, tx } = await buildPermitTx(deadline)
		const receipt = await tx
		const event = receipt.logs[0]

		// Check that approval was successful
		assert.equal(event.event, "Approval")
		assert.equal(await debtToken.nonces(approve.owner), 1)
		assert.equal(await debtToken.allowance(approve.owner, approve.spender), approve.value)

		// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
		await assertRevert(
			debtToken.permit(approve.owner, approve.spender, approve.value, deadline, v, r, s),
			"Permit: invalid signature"
		)

		// Check that the zero address fails
		await assertAssert(
			debtToken.permit(
				"0x0000000000000000000000000000000000000000",
				approve.spender,
				approve.value,
				deadline,
				"0x99",
				r,
				s
			)
		)
	})

	it("permits(): fails with expired deadline", async () => {
		const deadline = 1

		const { v, r, s, tx } = await buildPermitTx(deadline)
		await assertRevert(tx, "Permit: expired deadline")
	})

	it("permits(): fails with the wrong signature", async () => {
		const deadline = 100_000_000_000_000

		const { v, r, s } = await buildPermitTx(deadline)

		const tx = debtToken.permit(carol, approve.spender, approve.value, deadline, v, hexlify(r), hexlify(s))

		await assertRevert(tx, "Permit: invalid signature")
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
