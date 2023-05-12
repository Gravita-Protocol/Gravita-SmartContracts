const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const th = testHelpers.TestHelper
const { dec, toBN } = th

contract("AdminContract", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const assertRevert = th.assertRevert
	const DECIMAL_PRECISION = toBN(dec(1, 18))
	const [owner, user, A, C, B, treasury] = accounts

	let contracts
	let adminContract
	let borrowerOperations
	let erc20

	let BORROWING_FEE
	let CCR
	let MCR
	let MIN_NET_DEBT
	let MINT_CAP
	let PERCENT_DIVISOR
	let REDEMPTION_FEE_FLOOR

	const MCR_SAFETY_MAX = toBN(dec(10, 18))
	const MCR_SAFETY_MIN = toBN((1.01e18).toString())

	const CCR_SAFETY_MAX = toBN(dec(10, 18))
	const CCR_SAFETY_MIN = toBN(dec(1, 18))

	const PERCENT_DIVISOR_SAFETY_MAX = toBN(200)
	const PERCENT_DIVISOR_SAFETY_MIN = toBN(2)

	const BORROWING_FEE_SAFETY_MAX = toBN((0.1e18).toString()) // 10%
	const BORROWING_FEE_SAFETY_MIN = toBN(0)

	const MIN_NET_DEBT_SAFETY_MAX = toBN(dec(2_000, 18))
	const MIN_NET_DEBT_SAFETY_MIN = toBN(0)

	const REDEMPTION_FEE_FLOOR_SAFETY_MAX = toBN((0.1e18).toString()) // 10%
	const REDEMPTION_FEE_FLOOR_SAFETY_MIN = toBN((0.001e18).toString()) // 0.1%

	const openVessel = async params => th.openVessel(contracts, params)

	beforeEach(async () => {
		const { coreContracts } = await deploymentHelper.deployTestContracts(treasury, accounts.slice(0, 5))
		contracts = coreContracts
		adminContract = contracts.adminContract
		borrowerOperations = contracts.borrowerOperations
		erc20 = contracts.erc20
		vesselManager = contracts.vesselManager

		BORROWING_FEE = await adminContract.BORROWING_FEE_DEFAULT()
		CCR = await adminContract.CCR_DEFAULT()
		MCR = await adminContract.MCR_DEFAULT()
		MIN_NET_DEBT = await adminContract.MIN_NET_DEBT_DEFAULT()
		MINT_CAP = await adminContract.MINT_CAP_DEFAULT()
		PERCENT_DIVISOR = await adminContract.PERCENT_DIVISOR_DEFAULT()
		REDEMPTION_FEE_FLOOR = await adminContract.REDEMPTION_FEE_FLOOR_DEFAULT()
	})

	it("Formula Checks: Call every function with default value, Should match default values", async () => {
		await adminContract.setBorrowingFee(ZERO_ADDRESS, (0.005e18).toString())
		await adminContract.setCCR(ZERO_ADDRESS, "1500000000000000000")
		await adminContract.setMCR(ZERO_ADDRESS, "1100000000000000000")
		await adminContract.setMinNetDebt(ZERO_ADDRESS, dec(2_000, 18))
		await adminContract.setMintCap(ZERO_ADDRESS, dec(1_000_000, 18))
		await adminContract.setPercentDivisor(ZERO_ADDRESS, 100)
		await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, (0.005e18).toString())

		assert.equal((await adminContract.getBorrowingFee(ZERO_ADDRESS)).toString(), BORROWING_FEE)
		assert.equal((await adminContract.getCcr(ZERO_ADDRESS)).toString(), CCR)
		assert.equal((await adminContract.getMcr(ZERO_ADDRESS)).toString(), MCR)
		assert.equal((await adminContract.getMinNetDebt(ZERO_ADDRESS)).toString(), MIN_NET_DEBT)
		assert.equal((await adminContract.getMintCap(ZERO_ADDRESS)).toString(), MINT_CAP)
		assert.equal((await adminContract.getPercentDivisor(ZERO_ADDRESS)).toString(), PERCENT_DIVISOR)
		assert.equal((await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)).toString(), REDEMPTION_FEE_FLOOR)
	})

	it("Try to edit Parameters as User, Revert Transactions", async () => {
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE,
				CCR,
				MCR,
				MIN_NET_DEBT,
				MINT_CAP,
				PERCENT_DIVISOR,
				REDEMPTION_FEE_FLOOR,
				{ from: user }
			)
		)
		await assertRevert(adminContract.setMCR(ZERO_ADDRESS, MCR, { from: user }))
		await assertRevert(adminContract.setCCR(ZERO_ADDRESS, CCR, { from: user }))
		await assertRevert(adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT, { from: user }))
		await assertRevert(adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR, { from: user }))
		await assertRevert(adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE, { from: user }))
		await assertRevert(adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR, { from: user }))
	})

	it("setMCR: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN.sub(toBN(1))))
		await assertRevert(adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX.add(toBN(1))))
	})

	it("setMCR: Owner change parameter - Valid SafeCheck", async () => {
		await adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN)
		assert.equal(MCR_SAFETY_MIN.toString(), await adminContract.getMcr(ZERO_ADDRESS))

		await adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX)
		assert.equal(MCR_SAFETY_MAX.toString(), await adminContract.getMcr(ZERO_ADDRESS))
	})

	it("setCCR: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN.sub(toBN(1))))
		await assertRevert(adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX.add(toBN(1))))
	})

	it("setCCR: Owner change parameter - Valid SafeCheck", async () => {
		await adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN)
		assert.equal(CCR_SAFETY_MIN.toString(), await adminContract.getCcr(ZERO_ADDRESS))

		await adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX)
		assert.equal(CCR_SAFETY_MAX.toString(), await adminContract.getCcr(ZERO_ADDRESS))
	})

	it("setMinNetDebt: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX.add(toBN(1))))
	})

	it("setMinNetDebt: Owner change parameter - Valid SafeCheck", async () => {
		await adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MIN)
		assert.equal(MIN_NET_DEBT_SAFETY_MIN.toString(), await adminContract.getMinNetDebt(ZERO_ADDRESS))

		await adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX)
		assert.equal(MIN_NET_DEBT_SAFETY_MAX.toString(), await adminContract.getMinNetDebt(ZERO_ADDRESS))
	})

	it("setPercentDivisor: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN.sub(toBN(1))))
		await assertRevert(adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1))))
	})

	it("setPercentDivisor: Owner change parameter - Valid SafeCheck", async () => {
		await adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN)
		assert.equal(PERCENT_DIVISOR_SAFETY_MIN.toString(), await adminContract.getPercentDivisor(ZERO_ADDRESS))

		await adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX)
		assert.equal(PERCENT_DIVISOR_SAFETY_MAX.toString(), await adminContract.getPercentDivisor(ZERO_ADDRESS))
	})

	it("setBorrowingFee: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MAX.add(toBN(1))))
	})

	it("setBorrowingFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
		await adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MIN)
		assert.equal(BORROWING_FEE_SAFETY_MIN.toString(), await adminContract.getBorrowingFee(ZERO_ADDRESS))

		await adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MAX)
		assert.equal(BORROWING_FEE_SAFETY_MAX.toString(), await adminContract.getBorrowingFee(ZERO_ADDRESS))
	})

	it("setRedemptionFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN.sub(toBN(1))))
		await assertRevert(adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))))
	})

	it("setRedemptionFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
		await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN)
		assert.equal(REDEMPTION_FEE_FLOOR_SAFETY_MIN.toString(), await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS))

		await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX)
		assert.equal(REDEMPTION_FEE_FLOOR_SAFETY_MAX.toString(), await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS))
	})

	it("setCollateralParameters: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE_SAFETY_MAX.add(toBN(1)),
				CCR,
				MCR,
				MIN_NET_DEBT,
				MINT_CAP,
				PERCENT_DIVISOR,
				REDEMPTION_FEE_FLOOR
			)
		)
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE,
				CCR_SAFETY_MAX.add(toBN(1)),
				MCR,
				MIN_NET_DEBT,
				MINT_CAP,
				PERCENT_DIVISOR,
				REDEMPTION_FEE_FLOOR
			)
		)
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE,
				CCR,
				MCR_SAFETY_MAX.add(toBN(1)),
				MIN_NET_DEBT,
				MINT_CAP,
				PERCENT_DIVISOR,
				REDEMPTION_FEE_FLOOR
			)
		)
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE,
				CCR,
				MCR,
				MIN_NET_DEBT_SAFETY_MAX.add(toBN(1)),
				MINT_CAP,
				PERCENT_DIVISOR,
				REDEMPTION_FEE_FLOOR
			)
		)
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE,
				CCR,
				MCR,
				MIN_NET_DEBT,
				MINT_CAP,
				PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1)),
				REDEMPTION_FEE_FLOOR
			)
		)
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				BORROWING_FEE,
				CCR,
				MCR,
				MIN_NET_DEBT,
				MINT_CAP,
				PERCENT_DIVISOR,
				REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))
			)
		)
	})

	it("openVessel(): Borrowing at zero base rate charges minimum fee with different borrowingFeeFloor", async () => {
		await adminContract.setBorrowingFee(erc20.address, BORROWING_FEE_SAFETY_MAX)

		assert.equal(BORROWING_FEE_SAFETY_MAX.toString(), await adminContract.getBorrowingFee(erc20.address))

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(5000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(5000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})

		const USDVRequest = toBN(dec(10000, 18))
		const txC_Asset = await borrowerOperations.openVessel(
			erc20.address,
			dec(100, "ether"),
			USDVRequest,
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			{ from: C }
		)
		const _USDVFee_Asset = toBN(th.getEventArgByName(txC_Asset, "BorrowingFeePaid", "_feeAmount"))

		const expectedFee_Asset = (await adminContract.getBorrowingFee(erc20.address))
			.mul(toBN(USDVRequest))
			.div(toBN(dec(1, 18)))
		assert.isTrue(_USDVFee_Asset.eq(expectedFee_Asset))
	})
})

contract("Reset chain state", async accounts => {})
