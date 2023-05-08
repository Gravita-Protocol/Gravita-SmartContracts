const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")
const th = testHelpers.TestHelper
const { dec, toBN } = th

const PriceFeed = artifacts.require("./PriceFeed.sol")
const TransparentUpgradeableProxy = artifacts.require("./TransparentUpgradeableProxy.sol")
const AdminContract = artifacts.require("./AdminContract.sol")

contract("AdminContract", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const assertRevert = th.assertRevert
	const DECIMAL_PRECISION = toBN(dec(1, 18))
	const [owner, user, A, C, B] = accounts

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

	const MIN_NET_DEBT_SAFETY_MAX = toBN(dec(1800, 18))
	const MIN_NET_DEBT_SAFETY_MIN = toBN(0)

	const REDEMPTION_FEE_FLOOR_SAFETY_MAX = toBN(1000)
	const REDEMPTION_FEE_FLOOR_SAFETY_MIN = toBN(10)

	const openVessel = async params => th.openVessel(contracts, params)

	function applyDecimalPrecision(value) {
		return DECIMAL_PRECISION.div(toBN(10000)).mul(toBN(value.toString()))
	}

	before(async () => {
		const AdminContract = artifacts.require("AdminContract")
		adminContract = await AdminContract.new()
		MCR = await adminContract.MCR_DEFAULT()
		CCR = await adminContract.CCR_DEFAULT()
		GAS_COMPENSATION = toBN(dec(30, 18))
		MIN_NET_DEBT = await adminContract.MIN_NET_DEBT_DEFAULT()
		PERCENT_DIVISOR = await adminContract.PERCENT_DIVISOR_DEFAULT()
		BORROWING_FEE = await adminContract.BORROWING_FEE_DEFAULT()
		REDEMPTION_FEE_FLOOR = await adminContract.REDEMPTION_FEE_FLOOR_DEFAULT()
		MINT_CAP = await adminContract.MINT_CAP_DEFAULT()
	})

	beforeEach(async () => {
		contracts = await deploymentHelper.deployGravitaCore()
		contracts.vesselManager = await VesselManagerTester.new()
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])
		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
		priceFeed = contracts.priceFeedTestnet
		vesselManager = contracts.vesselManager
		activePool = contracts.activePool
		defaultPool = contracts.defaultPool
		borrowerOperations = contracts.borrowerOperations
		adminContract = contracts.adminContract
		erc20 = contracts.erc20

		for (const acc of [A, B, C]) {
			await erc20.mint(acc, await web3.eth.getBalance(acc))
		}
	})

	it("Formula Checks: Call every function with default value, Should match default values", async () => {
		await adminContract.setMCR(ZERO_ADDRESS, "1100000000000000000")
		await adminContract.setCCR(ZERO_ADDRESS, "1500000000000000000")
		await adminContract.setPercentDivisor(ZERO_ADDRESS, 100)
		await adminContract.setBorrowingFee(ZERO_ADDRESS, 50)
		await adminContract.setMinNetDebt(ZERO_ADDRESS, dec(300, 18))
		await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, 50)
		await adminContract.setMintCap(ZERO_ADDRESS, dec(1000000, 18))

		assert.equal((await adminContract.getMcr(ZERO_ADDRESS)).toString(), MCR)
		assert.equal((await adminContract.getCcr(ZERO_ADDRESS)).toString(), CCR)
		assert.equal((await adminContract.getPercentDivisor(ZERO_ADDRESS)).toString(), PERCENT_DIVISOR)
		assert.equal((await adminContract.getBorrowingFee(ZERO_ADDRESS)).toString(), BORROWING_FEE)
		assert.equal((await adminContract.getMinNetDebt(ZERO_ADDRESS)).toString(), MIN_NET_DEBT)
		assert.equal((await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS)).toString(), REDEMPTION_FEE_FLOOR)
		assert.equal((await adminContract.getMintCap(ZERO_ADDRESS)).toString(), MINT_CAP)
	})

	it("Try to edit Parameters as User, Revert Transactions", async () => {
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				MCR,
				CCR,
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
		const expectedMin = applyDecimalPrecision(BORROWING_FEE_SAFETY_MIN)
		const expectedMax = applyDecimalPrecision(BORROWING_FEE_SAFETY_MAX)

		await adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MIN)
		assert.equal(expectedMin.toString(), await adminContract.getBorrowingFee(ZERO_ADDRESS))

		await adminContract.setBorrowingFee(ZERO_ADDRESS, BORROWING_FEE_SAFETY_MAX)
		assert.equal(expectedMax.toString(), await adminContract.getBorrowingFee(ZERO_ADDRESS))
	})

	it("setRedemptionFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN.sub(toBN(1))))
		await assertRevert(adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))))
	})

	it("setRedemptionFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
		const expectedMin = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MIN)
		const expectedMax = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MAX)

		await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN)
		assert.equal(expectedMin.toString(), await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS))

		await adminContract.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX)
		assert.equal(expectedMax.toString(), await adminContract.getRedemptionFeeFloor(ZERO_ADDRESS))
	})

	it("setCollateralParameters: Owner change parameter - Failing SafeCheck", async () => {
		await assertRevert(
			adminContract.setCollateralParameters(
				ZERO_ADDRESS,
				MCR_SAFETY_MAX.add(toBN(1)),
				CCR,
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
				MIN_NET_DEBT,
				PERCENT_DIVISOR,
				BORROWING_FEE,
				REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1)),
				MINT_CAP
			)
		)
	})

	it("openVessel(): Borrowing at zero base rate charges minimum fee with different borrowingFeeFloor", async () => {
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
		const _USDVFee_Asset = toBN(th.getEventArgByName(txC_Asset, "BorrowingFeePaid", "_feeAmount"))

		const expectedFee_Asset = (await adminContract.getBorrowingFee(erc20.address))
			.mul(toBN(USDVRequest))
			.div(toBN(dec(1, 18)))
		assert.isTrue(_USDVFee_Asset.eq(expectedFee_Asset))
	})

	it("upgrade contracts instantly", async () => {
		const impl1 = await PriceFeed.new()
		const proxy = await TransparentUpgradeableProxy.new(impl1.address, adminContract.address, "0x")

		assert.equal(await adminContract.getProxyImplementation(proxy.address), impl1.address)

		const impl2 = await PriceFeed.new()
		await adminContract.upgrade(proxy.address, impl2.address)

		assert.equal(await adminContract.getProxyImplementation(proxy.address), impl2.address)
	})

	it("change Proxy's Admin instantly", async () => {
		const impl = await PriceFeed.new()
		const proxy = await TransparentUpgradeableProxy.new(impl.address, adminContract.address, "0x")

		assert.equal(await adminContract.getProxyAdmin(proxy.address), adminContract.address)

		const newAdmin = await AdminContract.new()
		await adminContract.changeProxyAdmin(proxy.address, newAdmin.address)

		assert.equal(await newAdmin.getProxyAdmin(proxy.address), newAdmin.address)
	})
})

contract("Reset chain state", async accounts => {})

