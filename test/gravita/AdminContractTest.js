const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract("AdminContract", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const assertRevert = th.assertRevert
	const DECIMAL_PRECISION = toBN(dec(1, 18))
	const [owner, user, A, C, B, multisig] = accounts

	let contracts
	let priceFeed
	let borrowerOperations
	let adminContract
	let erc20

	let MCR
	let CCR
	let GAS_COMPENSATION
	let MIN_NET_DEBT
	let PERCENT_DIVISOR
	let BORROWING_FEE
	let MAX_BORROWING_FEE
	let REDEMPTION_FEE_FLOOR
	let MINT_CAP

	const MCR_SAFETY_MAX = toBN(dec(1000, 18)).div(toBN(100))
	const MCR_SAFETY_MIN = toBN(dec(101, 18)).div(toBN(100))

	const CCR_SAFETY_MAX = toBN(dec(1000, 18)).div(toBN(100))
	const CCR_SAFETY_MIN = toBN(dec(101, 18)).div(toBN(100))

	const PERCENT_DIVISOR_SAFETY_MAX = toBN(200)
	const PERCENT_DIVISOR_SAFETY_MIN = toBN(2)

	const BORROWING_FEE_SAFETY_MAX = toBN(1000) //10%
	const BORROWING_FEE_SAFETY_MIN = toBN(0)

	const GRVT_GAS_COMPENSATION_SAFETY_MAX = toBN(dec(400, 18))
	const GRVT_GAS_COMPENSATION_SAFETY_MIN = toBN(dec(1, 18))

	const MIN_NET_DEBT_SAFETY_MAX = toBN(dec(1800, 18))
	const MIN_NET_DEBT_SAFETY_MIN = toBN(0)

	const REDEMPTION_FEE_FLOOR_SAFETY_MAX = toBN(1000)
	const REDEMPTION_FEE_FLOOR_SAFETY_MIN = toBN(10)

	const openVessel = async params => th.openVessel(contracts, params)

	function applyDecimalPrecision(value) {
		return DECIMAL_PRECISION.div(toBN(10000)).mul(toBN(value.toString()))
	}

	describe("Admin Contracts", async () => {
		beforeEach(async () => {
			contracts = await deploymentHelper.deployGravitaCore()
			contracts.vesselManager = await VesselManagerTester.new()
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

			priceFeed = contracts.priceFeedTestnet
			vesselManager = contracts.vesselManager
			activePool = contracts.activePool
			defaultPool = contracts.defaultPool
			borrowerOperations = contracts.borrowerOperations
			adminContract = contracts.adminContract
			erc20 = contracts.erc20

			MCR = await adminContract.MCR_DEFAULT()
			CCR = await adminContract.CCR_DEFAULT()
			GAS_COMPENSATION = await adminContract.DEBT_TOKEN_GAS_COMPENSATION_DEFAULT()
			MIN_NET_DEBT = await adminContract.MIN_NET_DEBT_DEFAULT()
			PERCENT_DIVISOR = await adminContract.PERCENT_DIVISOR_DEFAULT()
			BORROWING_FEE = await adminContract.BORROWING_FEE_DEFAULT()
			REDEMPTION_FEE_FLOOR = await adminContract.REDEMPTION_FEE_FLOOR_DEFAULT()
			MINT_CAP = await adminContract.MINT_CAP_DEFAULT()

			let index = 0
			for (const acc of accounts) {
				await erc20.mint(acc, await web3.eth.getBalance(acc))
				index++

				if (index >= 20) break
			}

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts, false)
		})

		it("Formula Checks: Call every function with default value, Should match default values", async () => {
			await adminContract.setAsDefault(ZERO_ADDRESS) // Set initial values

			await adminContract.setMCR(ZERO_ADDRESS, "1100000000000000000")
			await adminContract.setCCR(ZERO_ADDRESS, "1500000000000000000")
			await adminContract.setPercentDivisor(ZERO_ADDRESS, 100)
			await adminContract.setBorrowingFee(ZERO_ADDRESS, 50)
			await adminContract.setDebtTokenGasCompensation(ZERO_ADDRESS, dec(30, 18))
			await adminContract.setMinNetDebt(ZERO_ADDRESS, dec(300, 18))
			await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, 50)
			await adminContract.setMintCap(ZERO_ADDRESS, dec(1000000, 18))

			assert.equal((await adminContract.getMcr(ZERO_ADDRESS)).toString(), MCR)
			assert.equal((await adminContract.getCcr(ZERO_ADDRESS)).toString(), CCR)
			assert.equal(
				(await adminContract.getPercentDivisor(ZERO_ADDRESS)).toString(),
				PERCENT_DIVISOR
			)
			assert.equal(
				(await adminContract.getBorrowingFee(ZERO_ADDRESS)).toString(),
				BORROWING_FEE
			)
			assert.equal(
				(await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)).toString(),
				GAS_COMPENSATION
			)
			assert.equal((await adminContract.getMinNetDebt(ZERO_ADDRESS)).toString(), MIN_NET_DEBT)
			assert.equal(
				(await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)).toString(),
				REDEMPTION_FEE_FLOOR
			)
			assert.equal((await adminContract.getMintCap(ZERO_ADDRESS)).toString(), MINT_CAP)
		})

		it("Try to edit Parameters as User, Revert Transactions", async () => {
			await assertRevert(adminContract.setAsDefault(ZERO_ADDRESS, { from: user }))
			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					MINT_CAP,
					{ from: user }
				)
			)

			await assertRevert(adminContract.setMCR(ZERO_ADDRESS, MCR, { from: user }))
			await assertRevert(adminContract.setCCR(ZERO_ADDRESS, CCR, { from: user }))
			await assertRevert(
				adminContract.setDebtTokenGasCompensation(ZERO_ADDRESS, GAS_COMPENSATION, { from: user })
			)
			await assertRevert(
				adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT, { from: user })
			)
			await assertRevert(
				adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR, { from: user })
			)
			await assertRevert(
				adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE, { from: user })
			)
			await assertRevert(
				adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR, { from: user })
			)
		})

		it("sanitizeParameters: User call sanitizeParameters on Non-Configured Collateral - Set Default Values", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS, { from: user })

			assert.equal(MCR.toString(), await adminContract.getMcr(ZERO_ADDRESS))
			assert.equal(CCR.toString(), await adminContract.getCcr(ZERO_ADDRESS))
			assert.equal(
				GAS_COMPENSATION.toString(),
				(await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)).toString()
			)
			assert.equal(MIN_NET_DEBT.toString(), await adminContract.getMinNetDebt(ZERO_ADDRESS))
			assert.equal(
				PERCENT_DIVISOR.toString(),
				await adminContract.getPercentDivisor(ZERO_ADDRESS)
			)
			assert.equal(
				BORROWING_FEE.toString(),
				await adminContract.getBorrowingFee(ZERO_ADDRESS)
			)
			assert.equal(
				REDEMPTION_FEE_FLOOR.toString(),
				await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)
			)
			assert.equal(MINT_CAP.toString(), await adminContract.getMintCap(ZERO_ADDRESS))
		})

		it("sanitizeParameters: User call sanitizeParamaters on Configured Collateral - Ignore it", async () => {
			const newMCR = MCR_SAFETY_MAX
			const newCCR = CCR_SAFETY_MIN
			const newGasComp = GRVT_GAS_COMPENSATION_SAFETY_MAX
			const newMinNetDebt = MIN_NET_DEBT_SAFETY_MIN
			const newPercentDivisor = PERCENT_DIVISOR_SAFETY_MAX
			const newBorrowingFee = BORROWING_FEE_SAFETY_MAX
			const newRedemptionFeeFloor = REDEMPTION_FEE_FLOOR_SAFETY_MAX

			const expectedBorrowingFee = applyDecimalPrecision(newBorrowingFee)
			const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor)

			await adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				newMCR,
				newCCR,
				newGasComp,
				newMinNetDebt,
				newPercentDivisor,
				newBorrowingFee,
				newRedemptionFeeFloor,
				MINT_CAP,
				{ from: owner }
			)

			await adminContract.sanitizeParameters(ZERO_ADDRESS, { from: user })

			assert.equal(newMCR.toString(), await adminContract.getMcr(ZERO_ADDRESS))
			assert.equal(newCCR.toString(), await adminContract.getCcr(ZERO_ADDRESS))
			assert.equal(
				newGasComp.toString(),
				await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)
			)
			assert.equal(newMinNetDebt.toString(), await adminContract.getMinNetDebt(ZERO_ADDRESS))
			assert.equal(
				newPercentDivisor.toString(),
				await adminContract.getPercentDivisor(ZERO_ADDRESS)
			)
			assert.equal(
				expectedBorrowingFee.toString(),
				await adminContract.getBorrowingFee(ZERO_ADDRESS)
			)
			assert.equal(
				expectedRedemptionFeeFloor.toString(),
				await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)
			)
			assert.equal(MINT_CAP.toString(), await adminContract.getMintCap(ZERO_ADDRESS))
		})

		it("setMCR: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN.sub(toBN(1))))
			await assertRevert(adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX.add(toBN(1))))
		})

		it("setMCR: Owner change parameter - Valid SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN)
			assert.equal(MCR_SAFETY_MIN.toString(), await adminContract.getMcr(ZERO_ADDRESS))

			await adminContract.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX)
			assert.equal(MCR_SAFETY_MAX.toString(), await adminContract.getMcr(ZERO_ADDRESS))
		})

		it("setCCR: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN.sub(toBN(1))))
			await assertRevert(adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX.add(toBN(1))))
		})

		it("setCCR: Owner change parameter - Valid SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN)
			assert.equal(CCR_SAFETY_MIN.toString(), await adminContract.getCcr(ZERO_ADDRESS))

			await adminContract.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX)
			assert.equal(CCR_SAFETY_MAX.toString(), await adminContract.getCcr(ZERO_ADDRESS))
		})

		it("setDebtTokenGasCompensation: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				adminContract.setDebtTokenGasCompensation(
					ZERO_ADDRESS,
					GRVT_GAS_COMPENSATION_SAFETY_MIN.sub(toBN(1))
				)
			)
			await assertRevert(
				adminContract.setDebtTokenGasCompensation(
					ZERO_ADDRESS,
					GRVT_GAS_COMPENSATION_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setDebtTokenGasCompensation: Owner change parameter - Valid SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await adminContract.setDebtTokenGasCompensation(
				ZERO_ADDRESS,
				GRVT_GAS_COMPENSATION_SAFETY_MIN
			)
			assert.equal(
				GRVT_GAS_COMPENSATION_SAFETY_MIN.toString(),
				await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)
			)

			await adminContract.setDebtTokenGasCompensation(
				ZERO_ADDRESS,
				GRVT_GAS_COMPENSATION_SAFETY_MAX
			)
			assert.equal(
				GRVT_GAS_COMPENSATION_SAFETY_MAX.toString(),
				await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)
			)
		})

		it("setMinNetDebt: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)
			await assertRevert(
				adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX.add(toBN(1)))
			)
		})

		it("setMinNetDebt: Owner change parameter - Valid SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MIN)
			assert.equal(
				MIN_NET_DEBT_SAFETY_MIN.toString(),
				await adminContract.getMinNetDebt(ZERO_ADDRESS)
			)

			await adminContract.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX)
			assert.equal(
				MIN_NET_DEBT_SAFETY_MAX.toString(),
				await adminContract.getMinNetDebt(ZERO_ADDRESS)
			)
		})

		it("setPercentDivisor: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN.sub(toBN(1)))
			)
			await assertRevert(
				adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1)))
			)
		})

		it("setPercentDivisor: Owner change parameter - Valid SafeCheck", async () => {
			await adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN)
			assert.equal(
				PERCENT_DIVISOR_SAFETY_MIN.toString(),
				await adminContract.getPercentDivisor(ZERO_ADDRESS)
			)

			await adminContract.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX)
			assert.equal(
				PERCENT_DIVISOR_SAFETY_MAX.toString(),
				await adminContract.getPercentDivisor(ZERO_ADDRESS)
			)
		})

		it("setBorrowingFee: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				adminContract.setBorrowingFee(
					ZERO_ADDRESS,
					BORROWING_FEE_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setBorrowingFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
			const expectedMin = applyDecimalPrecision(BORROWING_FEE_SAFETY_MIN)
			const expectedMax = applyDecimalPrecision(BORROWING_FEE_SAFETY_MAX)

			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MIN)
			assert.equal(
				expectedMin.toString(),
				await adminContract.getBorrowingFee(ZERO_ADDRESS)
			)

			await adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MAX)
			assert.equal(
				expectedMax.toString(),
				await adminContract.getBorrowingFee(ZERO_ADDRESS)
			)
		})

		it("setRedemptionFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				adminContract.setRedemptionFeeFloor(
					ZERO_ADDRESS,
					REDEMPTION_FEE_FLOOR_SAFETY_MIN.sub(toBN(1))
				)
			)
			await assertRevert(
				adminContract.setRedemptionFeeFloor(
					ZERO_ADDRESS,
					REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setRedemptionFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
			const expectedMin = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MIN)
			const expectedMax = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MAX)

			await adminContract.sanitizeParameters(ZERO_ADDRESS)

			await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN)
			assert.equal(
				expectedMin.toString(),
				await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)
			)

			await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX)
			assert.equal(
				expectedMax.toString(),
				await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)
			)
		})

		it("setCollateralParameters: Owner change parameter - Failing SafeCheck", async () => {
			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR_SAFETY_MAX.add(toBN(1)),
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					MINT_CAP
				)
			)

			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR_SAFETY_MAX.add(toBN(1)),
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					MINT_CAP
				)
			)

			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GRVT_GAS_COMPENSATION_SAFETY_MAX.add(toBN(1)),
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					MINT_CAP
				)
			)

			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT_SAFETY_MAX.add(toBN(1)),
					PERCENT_DIVISOR,
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					MINT_CAP
				)
			)

			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1)),
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					MINT_CAP
				)
			)

			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_SAFETY_MAX.add(toBN(1)),
					REDEMPTION_FEE_FLOOR,
					MINT_CAP
				)
			)

			await assertRevert(
				adminContract.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE,
					REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1)),
					MINT_CAP
				)
			)
		})

		it("setCollateralParameters: Owner change parameter - Valid SafeCheck Then Reset", async () => {
			const newMCR = MCR_SAFETY_MAX
			const newCCR = CCR_SAFETY_MIN
			const newGasComp = GRVT_GAS_COMPENSATION_SAFETY_MAX
			const newMinNetDebt = MIN_NET_DEBT_SAFETY_MAX
			const newPercentDivisor = PERCENT_DIVISOR_SAFETY_MIN
			const newBorrowingFee = BORROWING_FEE_SAFETY_MAX
			const newRedemptionFeeFloor = REDEMPTION_FEE_FLOOR_SAFETY_MIN
			const newMintCap = toBN(1111111)

			const expectedBorrowingFee = applyDecimalPrecision(newBorrowingFee)
			const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor)

			await adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				newMCR,
				newCCR,
				newGasComp,
				newMinNetDebt,
				newPercentDivisor,
				newBorrowingFee,
				newRedemptionFeeFloor,
				newMintCap,
				{ from: owner }
			)

			assert.equal(newMCR.toString(), await adminContract.getMcr(ZERO_ADDRESS))
			assert.equal(newCCR.toString(), await adminContract.getCcr(ZERO_ADDRESS))
			assert.equal(
				newGasComp.toString(),
				await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)
			)
			assert.equal(newMinNetDebt.toString(), await adminContract.getMinNetDebt(ZERO_ADDRESS))
			assert.equal(
				newPercentDivisor.toString(),
				await adminContract.getPercentDivisor(ZERO_ADDRESS)
			)
			assert.equal(
				expectedBorrowingFee.toString(),
				await adminContract.getBorrowingFee(ZERO_ADDRESS)
			)
			assert.equal(
				expectedRedemptionFeeFloor.toString(),
				await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)
			)
			assert.equal(newMintCap.toString(), await adminContract.getMintCap(ZERO_ADDRESS))

			await adminContract.setAsDefault(ZERO_ADDRESS)

			assert.equal(MCR.toString(), await adminContract.getMcr(ZERO_ADDRESS))
			assert.equal(CCR.toString(), await adminContract.getCcr(ZERO_ADDRESS))
			assert.equal(
				GAS_COMPENSATION.toString(),
				await adminContract.getDebtTokenGasCompensation(ZERO_ADDRESS)
			)
			assert.equal(MIN_NET_DEBT.toString(), await adminContract.getMinNetDebt(ZERO_ADDRESS))
			assert.equal(
				PERCENT_DIVISOR.toString(),
				await adminContract.getPercentDivisor(ZERO_ADDRESS)
			)
			assert.equal(
				BORROWING_FEE.toString(),
				await adminContract.getBorrowingFee(ZERO_ADDRESS)
			)
			assert.equal(
				REDEMPTION_FEE_FLOOR.toString(),
				await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)
			)
			assert.equal(MINT_CAP.toString(), await adminContract.getMintCap(ZERO_ADDRESS))
		})

		it("openVessel(): Borrowing at zero base rate charges minimum fee with different borrowingFeeFloor", async () => {
			await adminContract.sanitizeParameters(erc20.address)

			await adminContract.setBorrowingFee(erc20.address, BORROWING_FEE_SAFETY_MAX)

			assert.equal(
				applyDecimalPrecision(BORROWING_FEE_SAFETY_MAX).toString(),
				await adminContract.getBorrowingFee(erc20.address)
			)

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
			const _USDVFee_Asset = toBN(
				th.getEventArgByName(txC_Asset, "BorrowingFeePaid", "_feeAmount")
			)

			const expectedFee_Asset = (await adminContract.getBorrowingFee(erc20.address))
				.mul(toBN(USDVRequest))
				.div(toBN(dec(1, 18)))
			assert.isTrue(_USDVFee_Asset.eq(expectedFee_Asset))
		})
	})
})

contract("Reset chain state", async accounts => {})
