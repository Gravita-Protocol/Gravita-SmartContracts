const { keccak256 } = require("@ethersproject/keccak256")
const { toUtf8Bytes } = require("@ethersproject/strings")
const { hexlify } = require("@ethersproject/bytes")
const { signERC2612Permit } = require("eth-permit")

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const { toBN, assertRevert, assertAssert, dec } = testHelpers.TestHelper

const PERMIT_TYPEHASH = keccak256(
	toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
)

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

		it.skip("permit(): permits and emits an Approval event (replay protected)", async () => {
			const deadline = ethers.constants.MaxUint256
			const sender = (await ethers.getSigners())[0]
			const senderAddress = sender.address
			const spenderAddress = bob
			const value = 1
			const { v, r, s } = await signERC2612Permit(
				sender,
				debtToken.address,
				senderAddress,
				spenderAddress,
				value,
				deadline
			)

			const tx = await debtToken.permit(senderAddress, spenderAddress, value, deadline, v, r, s)
			const event = tx.logs[0]

			// Check that approval was successful
			assert.equal(event.event, "Approval")
			assert.equal(await debtToken.nonces(senderAddress), 1)
			assert.equal(await debtToken.allowance(senderAddress, spenderAddress), value)

			// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
			const tx2 = debtToken.permit(senderAddress, spenderAddress, value, deadline, v, r, s)
			await assertRevert(tx2, "Permit: expired deadline")
		})

		it("permit(): fails for zero address", async () => {
			const deadline = ethers.constants.MaxUint256
			const sender = (await ethers.getSigners())[0]
			const value = 1
			const { r, s } = await signERC2612Permit(sender, debtToken.address, sender.address, bob, value, deadline)
			await assertRevert(
				debtToken.permit("0x0000000000000000000000000000000000000000", bob, value, deadline, "0x99", r, s),
				"ERC20Permit: Invalid signature"
			)
		})

		it("permits(): fails with expired deadline", async () => {
			const deadline = 1
			const sender = (await ethers.getSigners())[0]
			const senderAddress = sender.address
			const spenderAddress = bob
			const value = 1
			const { v, r, s } = await signERC2612Permit(
				sender,
				debtToken.address,
				senderAddress,
				spenderAddress,
				value,
				deadline
			)
			const tx = debtToken.permit(senderAddress, spenderAddress, value, deadline, v, r, s)
			await assertRevert(tx, "Permit: expired deadline")
		})

		it("permits(): fails with the wrong signature", async () => {
			const deadline = ethers.constants.MaxUint256
			const sender = (await ethers.getSigners())[0]
			const senderAddress = sender.address
			const spenderAddress = bob
			const value = 1
			const { v, r, s } = await signERC2612Permit(
				sender,
				debtToken.address,
				senderAddress,
				spenderAddress,
				value,
				deadline
			)
			// use carol as sender should revert
			const tx = debtToken.permit(carol, spenderAddress, value, deadline, v, r, s)
			await assertRevert(tx, "Permit: expired deadline")
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

		it.skip("permit(): permits and emits an Approval event (replay protected)", async () => {
			const deadline = ethers.constants.MaxUint256
			const sender = (await ethers.getSigners())[0]
			const senderAddress = sender.address
			const spenderAddress = bob
			const value = 1
			const { v, r, s } = await signERC2612Permit(
				sender,
				grvtToken.address,
				senderAddress,
				spenderAddress,
				value,
				deadline
			)

			const tx = await grvtToken.permit(senderAddress, spenderAddress, value, deadline, v, r, s)
			const event = tx.logs[0]

			// Check that approval was successful
			assert.equal(event.event, "Approval")
			assert.equal(await grvtToken.nonces(senderAddress), 1)
			assert.equal(await grvtToken.allowance(senderAddress, spenderAddress), value)

			// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
			const tx2 = grvtToken.permit(senderAddress, spenderAddress, value, deadline, v, r, s)
			await assertRevert(tx2, "Permit: expired deadline")
		})

		it("permit(): fails for zero address", async () => {
			const deadline = ethers.constants.MaxUint256
			const sender = (await ethers.getSigners())[0]
			const value = 1
			const { r, s } = await signERC2612Permit(sender, grvtToken.address, sender.address, bob, value, deadline)
			await assertRevert(
				grvtToken.permit("0x0000000000000000000000000000000000000000", bob, value, deadline, "0x99", r, s),
				"ERC20Permit: Invalid signature"
			)
		})

		it("permit(): fails with expired deadline", async () => {
			const deadline = 1
			const sender = (await ethers.getSigners())[0]
			const senderAddress = sender.address
			const spenderAddress = bob
			const value = 1
			const { v, r, s } = await signERC2612Permit(
				sender,
				grvtToken.address,
				senderAddress,
				spenderAddress,
				value,
				deadline
			)
			const tx = grvtToken.permit(senderAddress, spenderAddress, value, deadline, v, r, s)
			await assertRevert(tx, "Permit: expired deadline")
		})

		it("permit(): fails with the wrong signature", async () => {
			const deadline = ethers.constants.MaxUint256
			const sender = (await ethers.getSigners())[0]
			const senderAddress = sender.address
			const spenderAddress = bob
			const value = 1
			const { v, r, s } = await signERC2612Permit(
				sender,
				grvtToken.address,
				senderAddress,
				spenderAddress,
				value,
				deadline
			)
			// use carol as sender should revert
			const tx = grvtToken.permit(carol, spenderAddress, value, deadline, v, r, s)
			await assertRevert(tx, "Permit: expired deadline")
		})
	})
})

contract("Reset chain state", async accounts => {})
