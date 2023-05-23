const { keccak256 } = require("@ethersproject/keccak256")
const { defaultAbiCoder } = require("@ethersproject/abi")
const { toUtf8Bytes } = require("@ethersproject/strings")
const { pack } = require("@ethersproject/solidity")
const { hexlify } = require("@ethersproject/bytes")
const { ecsign } = require("ethereumjs-util")
// const { TypedDataUtils } = require("ethers-eip712")
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const { toBN, assertRevert, assertAssert, dec } = testHelpers.TestHelper

const PERMIT_TYPEHASH = keccak256(
	toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
)

// the second account in hardhatAccountsList2k.js
const alicePrivateKey = "0xeaa445c85f7b438dEd6e831d06a4eD0CEBDc2f8527f84Fcda6EBB5fCfAd4C0e9"

const permitValue = 1

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

const buildPermitTx = async (token, sender, spender, value, deadline) => {
	const nonce = (await token.nonces(sender)).toString()

	// Get the EIP712 digest
	const digest = getPermitDigest(await token.domainSeparator(), sender, spender, value, nonce, deadline)

	const { v, r, s } = sign(digest, alicePrivateKey)

	console.log(`js.sender: ${sender}`)
	console.log(`js.spender: ${spender}`)
	const tx = token.permit(sender, spender, value, deadline, v, hexlify(r), hexlify(s))

	return { v, r, s, tx }
}

var contracts
var snapshotId
var initialSnapshotId

contract("ERC20Permit", async accounts => {
	const [owner, alice, bob, carol, treasury] = accounts
	let debtToken, grvtToken

	before(async () => {
		contracts = await deploymentHelper.deployTestContracts(treasury, [])
		debtToken = contracts.core.debtToken
		grvtToken = contracts.grvt.grvtToken

		chainId = await debtToken.getChainId()
		console.log(`js.chainId: ${chainId}`)

		await debtToken.unprotectedMint(alice, dec(150, 18))
		await debtToken.unprotectedMint(bob, dec(100, 18))
		await debtToken.unprotectedMint(carol, dec(50, 18))

		await grvtToken.unprotectedMint(alice, dec(150, 18))
		await grvtToken.unprotectedMint(bob, dec(100, 18))
		await grvtToken.unprotectedMint(carol, dec(50, 18))

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

	// DebtToken tests ------------------------------------------------------------------------------------------------

	describe("DebtToken ERC20Permit Tests", async () => {
		it("Initializes PERMIT_TYPEHASH correctly", async () => {
			assert.equal(await debtToken.PERMIT_TYPEHASH(), PERMIT_TYPEHASH)
		})

		it("Initial nonce for a given address is 0", async function () {
			assert.equal(toBN(await debtToken.nonces(alice)).toString(), "0")
		})

		it.only("permits and emits an Approval event (replay protected)", async () => {
			const deadline = 100_000_000_000_000

			// Approve it
			const { v, r, s, tx } = await buildPermitTx(debtToken, alice, bob, permitValue, deadline)
			const receipt = await tx
			const event = receipt.logs[0]

			// Check that approval was successful
			assert.equal(event.event, "Approval")
			assert.equal(await debtToken.nonces(alice), 1)
			assert.equal(await debtToken.allowance(alice, bob), permitValue)

			// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
			await assertRevert(debtToken.permit(alice, bob, permitValue, deadline, v, r, s), "ERC20Permit: Invalid signature")

			// Check that the zero address fails
			await assertAssert(
				debtToken.permit("0x0000000000000000000000000000000000000000", bob, permitValue, deadline, "0x99", r, s)
			)
		})

		it("permits(): fails with expired deadline", async () => {
			const deadline = 1
			const { tx } = await buildPermitTx(debtToken, alice, bob, permitValue, deadline)
			await assertRevert(tx, "Permit: expired deadline")
		})

		it.only("permits(): fails with the wrong signature", async () => {
			const deadline = 100_000_000_000_000
			const { v, r, s, tx } = await buildPermitTx(debtToken, alice, bob, permitValue, deadline)
			await tx
			// Carol is passed as owner param, rather than Bob
			const txPermit = debtToken.permit(carol, bob, permitValue, deadline, v, hexlify(r), hexlify(s))
			await assertRevert(txPermit, "ERC20Permit: Invalid signature")
		})
	})

	// GRVTToken tests ------------------------------------------------------------------------------------------------

	describe("GrvtToken ERC20Permit Tests", async () => {
		it("Initializes PERMIT_TYPEHASH correctly", async () => {
			assert.equal(await grvtToken.PERMIT_TYPEHASH(), PERMIT_TYPEHASH)
		})

		it("Initial nonce for a given address is 0", async function () {
			assert.equal(toBN(await grvtToken.nonces(alice)).toString(), "0")
		})

		it.only("permit(): permits and emits an Approval event (replay protected)", async () => {
			const deadline = 100_000_000_000_000

			// Approve it
			const { v, r, s, tx } = await buildPermitTx(grvtToken, alice, bob, permitValue, deadline)
			const receipt = await tx
			const event = receipt.logs[0]

			// Check that approval was successful
			assert.equal(event.event, "Approval")
			assert.equal(await grvtToken.nonces(alice), 1)
			assert.equal(await grvtToken.allowance(alice, bob), permitValue)

			// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
			await assertRevert(grvtToken.permit(alice, bob, permitValue, deadline, v, r, s), "ERC20Permit: Invalid signature")

			// Check that the zero address fails
			await assertRevert(
				grvtToken.permit("0x0000000000000000000000000000000000000000", bob, permitValue, deadline, "0x99", r, s),
				"ERC20Permit: Invalid signature"
			)
		})

		it("permit(): fails with expired deadline", async () => {
			const deadline = 1
			const { tx } = await buildPermitTx(grvtToken, alice, bob, permitValue, deadline)
			await assertRevert(tx, "Permit: expired deadline")
		})

		it.only("permit(): fails with the wrong signature", async () => {
			const deadline = 100_000_000_000_000
			const { v, r, s, tx } = await buildPermitTx(grvtToken, alice, bob, permitValue, deadline)
			await tx
			// Carol is passed as owner param, rather than Bob
			const txPermit = grvtToken.permit(carol, bob, permitValue, deadline, v, hexlify(r), hexlify(s))
			await assertRevert(txPermit, "ERC20Permit: Invalid signature")
		})
	})
})

contract("Reset chain state", async accounts => {})

