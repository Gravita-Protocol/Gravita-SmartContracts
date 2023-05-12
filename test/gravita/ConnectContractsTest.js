const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper

contract("Deployment script - Sets correct contract addresses dependencies after deployment", async accounts => {

	let activePool
	let adminContract
	let borrowerOperations
	let collSurplusPool
	let debtToken
	let defaultPool
	let feeCollector
	let gasPool
	let priceFeed
	let sortedVessels
	let stabilityPool
	let vesselManager
	let vesselManagerOperations
	let timelock

	let communityIssuance
	let grvtStaking
	let grvtToken

	before(async () => {

		const { coreContracts, GRVTContracts } = await deploymentHelper.deployTestContracts(accounts[0])

		activePool = coreContracts.activePool
		adminContract = coreContracts.adminContract
		borrowerOperations = coreContracts.borrowerOperations
		collSurplusPool = coreContracts.collSurplusPool
		debtToken = coreContracts.debtToken
		defaultPool = coreContracts.defaultPool
		feeCollector = coreContracts.feeCollector
		gasPool = coreContracts.gasPool
		priceFeed = coreContracts.priceFeedTestnet
		sortedVessels = coreContracts.sortedVessels
		stabilityPool = coreContracts.stabilityPool
		vesselManager = coreContracts.vesselManager
		vesselManagerOperations = coreContracts.vesselManagerOperations
		shortTimelock = coreContracts.shortTimelock
		longTimelock = coreContracts.longTimelock

		communityIssuance = GRVTContracts.communityIssuance
		grvtStaking = GRVTContracts.grvtStaking
		grvtToken = GRVTContracts.grvtToken
	})

	describe("Core Contracts", async () => {
		it("ActivePool: check addresses", async () => {
			assert.equal(borrowerOperations.address, await activePool.borrowerOperationsAddress())
			assert.equal(collSurplusPool.address, await activePool.collSurplusPool())
			assert.equal(defaultPool.address, await activePool.defaultPool())
			assert.equal(stabilityPool.address, await activePool.stabilityPoolAddress())
			assert.equal(vesselManagerOperations.address, await activePool.vesselManagerOperationsAddress())
		})
		it("AdminContract: check addresses", async () => {
			assert.equal(communityIssuance.address, await adminContract.communityIssuance())
			assert.equal(activePool.address, await adminContract.activePool())
			assert.equal(defaultPool.address, await adminContract.defaultPool())
			assert.equal(stabilityPool.address, await adminContract.stabilityPool())
			assert.equal(collSurplusPool.address, await adminContract.collSurplusPool())
			assert.equal(priceFeed.address, await adminContract.priceFeed())
			assert.equal(shortTimelock.address, await adminContract.timelockAddress())
		})
		it("BorrowerOperations: check addresses", async () => {
			assert.equal(vesselManager.address, await borrowerOperations.vesselManager())
			assert.equal(stabilityPool.address, await borrowerOperations.stabilityPool())
			assert.equal(gasPool.address, await borrowerOperations.gasPoolAddress())
			assert.equal(collSurplusPool.address, await borrowerOperations.collSurplusPool())
			assert.equal(sortedVessels.address, await borrowerOperations.sortedVessels())
			assert.equal(debtToken.address, await borrowerOperations.debtToken())
			assert.equal(feeCollector.address, await borrowerOperations.feeCollector())
			assert.equal(adminContract.address, await borrowerOperations.adminContract())
		})
		it("CollSurplusPool: check addresses", async () => {
			assert.equal(activePool.address, await collSurplusPool.activePoolAddress())
			assert.equal(borrowerOperations.address, await collSurplusPool.borrowerOperationsAddress())
			assert.equal(vesselManager.address, await collSurplusPool.vesselManagerAddress())
			assert.equal(vesselManagerOperations.address, await collSurplusPool.vesselManagerOperationsAddress())
		})
		it("DebtToken: check addresses", async () => {
			assert.equal(vesselManager.address, await debtToken.vesselManagerAddress())
			assert.equal(stabilityPool.address, await debtToken.stabilityPool())
			assert.equal(borrowerOperations.address, await debtToken.borrowerOperationsAddress())
			assert.equal(longTimelock.address, await debtToken.timelockAddress())
		})
		it("DefaultPool: check addresses", async () => {
			assert.equal(vesselManager.address, await defaultPool.vesselManagerAddress())
			assert.equal(activePool.address, await defaultPool.activePoolAddress())
		})
		it("FeeCollector: check addresses", async () => {
			assert.equal(borrowerOperations.address, await feeCollector.borrowerOperationsAddress())
			assert.equal(vesselManager.address, await feeCollector.vesselManagerAddress())
			assert.equal(grvtStaking.address, await feeCollector.grvtStaking())
			assert.equal(debtToken.address, await feeCollector.debtTokenAddress())
		})
		it("SortedVessels: check addresses", async () => {
			assert.equal(vesselManager.address, await sortedVessels.vesselManager())
			assert.equal(borrowerOperations.address, await sortedVessels.borrowerOperationsAddress())
		})
		it("StabilityPool: check addresses", async () => {
			assert.equal(borrowerOperations.address, await stabilityPool.borrowerOperations())
			assert.equal(vesselManager.address, await stabilityPool.vesselManager())
			assert.equal(activePool.address, await stabilityPool.activePool())
			assert.equal(debtToken.address, await stabilityPool.debtToken())
			assert.equal(sortedVessels.address, await stabilityPool.sortedVessels())
			assert.equal(communityIssuance.address, await stabilityPool.communityIssuance())
			assert.equal(adminContract.address, await stabilityPool.adminContract())
		})
		it("VesselManager: check addresses", async () => {
			assert.equal(borrowerOperations.address, await vesselManager.borrowerOperations())
			assert.equal(stabilityPool.address, await vesselManager.stabilityPool())
			assert.equal(gasPool.address, await vesselManager.gasPoolAddress())
			assert.equal(collSurplusPool.address, await vesselManager.collSurplusPool())
			assert.equal(debtToken.address, await vesselManager.debtToken())
			assert.equal(sortedVessels.address, await vesselManager.sortedVessels())
			assert.equal(vesselManagerOperations.address, await vesselManager.vesselManagerOperations())
			assert.equal(adminContract.address, await vesselManager.adminContract())
		})
		it("VesselManagerOperations: check addresses", async () => {
			assert.equal(vesselManager.address, await vesselManagerOperations.vesselManager())
			assert.equal(sortedVessels.address, await vesselManagerOperations.sortedVessels())
			assert.equal(stabilityPool.address, await vesselManagerOperations.stabilityPool())
			assert.equal(collSurplusPool.address, await vesselManagerOperations.collSurplusPool())
			assert.equal(debtToken.address, await vesselManagerOperations.debtToken())
			assert.equal(adminContract.address, await vesselManagerOperations.adminContract())
		})
	})

	describe("GRVT Contracts", async () => {
		it("CommunityIssuance: check addresses", async () => {
			assert.equal(grvtToken.address, await communityIssuance.grvtToken())
			assert.equal(stabilityPool.address, await communityIssuance.stabilityPool())
			assert.equal(adminContract.address, await communityIssuance.adminContract())
		})
		it("GRVTStaking: check addresses", async () => {
			assert.equal(grvtToken.address, await grvtStaking.grvtToken())
			assert.equal(debtToken.address, await grvtStaking.debtToken())
			assert.equal(feeCollector.address, await grvtStaking.feeCollectorAddress())
			assert.equal(vesselManager.address, await grvtStaking.vesselManagerAddress())
		})
	})
})

contract("Reset chain state", async accounts => {})
