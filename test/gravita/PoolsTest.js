const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")

const deploymentHelper = require("../utils/deploymentHelpers.js")

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
	lockedGRVT = contracts.grvt.lockedGRVT
}

contract("Pools Test", async accounts => {
	const [token1, token2, token3, treasury] = accounts
	const tokens = [token1, token2, token3]

	before(async () => {
		await deploy(treasury, accounts.slice(0, 5))

		await setBalance(borrowerOperations.address, 1e18)
		await setBalance(vesselManager.address, 1e18)

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

	describe("leftSumColls addition tests", async () => {
		it("_leftSumColls(): increase balances of all of the tokens", async () => {
			const colls1 = [tokens, [1, 2, 3]]
			const sumAmounts = [10, 20, 30]
			const result = await stabilityPool.leftSumColls(colls1, tokens, sumAmounts)
			assert.equal(result[0], 11)
			assert.equal(result[1], 22)
			assert.equal(result[2], 33)
		})

		it("_leftSumColls(): increase balances of some of the tokens", async () => {
			const colls1 = [tokens, [1, 2, 3]]
			const result = await stabilityPool.leftSumColls(colls1, [token2, token3], [20, 30])
			assert.equal(result[0], 1)
			assert.equal(result[1], 22)
			assert.equal(result[2], 33)
		})

		it("_leftSumColls(): balances of tokens unknown to left side should not be added", async () => {
			const colls1 = [[token2], [0]]
			const result = await stabilityPool.leftSumColls(colls1, tokens, [10, 20, 30])
			assert.equal(result[0], 20)
		})
	})

	describe("leftSubColls subtraction tests", async () => {
		it("_leftSubColls(): decrease balances of all of the tokens", async () => {
			const colls1 = [tokens, [100, 100, 100]]
			const subAmounts = [10, 20, 30]
			const result = await stabilityPool.leftSubColls(colls1, tokens, subAmounts)
			assert.equal(result[0], 90)
			assert.equal(result[1], 80)
			assert.equal(result[2], 70)
		})
		it("_leftSubColls(): decrease balances of some of the tokens", async () => {
			const colls1 = [tokens, [100, 100, 100]]
			const result = await stabilityPool.leftSubColls(colls1, [token2, token3], [20, 30])
			assert.equal(result[0], 100)
			assert.equal(result[1], 80)
			assert.equal(result[2], 70)
		})
		it("_leftSubColls(): balances of tokens unknown to left side should not be modified", async () => {
			const colls1 = [[token2], [100]]
			const result = await stabilityPool.leftSubColls(colls1, tokens, [10, 20, 30])
			assert.equal(result[0], 80)
		})
	})

	describe("StabilityPool", async accounts => {
		it("getAssetBalance(): gets the recorded collateral balance", async () => {
			const balance = await stabilityPool.getCollateral(erc20.address)
			assert.equal(balance, 0)
		})
		it("getTotalDebtTokenDeposits(): gets the recorded debt token balance", async () => {
			const balance = await stabilityPool.getTotalDebtTokenDeposits()
			assert.equal(balance, 0)
		})
	})

	describe("ActivePool", async accounts => {
		it("getAssetBalance(): gets the recorded collateral balance", async () => {
			const balance = await activePool.getAssetBalance(erc20.address)
			assert.equal(balance, 0)
		})
		it("getDebtTokenBalance(): gets the recorded debt token balance", async () => {
			const balance = await activePool.getDebtTokenBalance(erc20.address)
			assert.equal(balance, 0)
		})
		it("increaseDebt(): increases the recorded debt token balance by the correct amount", async () => {
			const balanceBefore = await activePool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceBefore, 0)
			const borrowerOperationsAddress = borrowerOperations.address
			await impersonateAccount(borrowerOperationsAddress)
			await activePool.increaseDebt(erc20.address, 100, { from: borrowerOperationsAddress })
			await stopImpersonatingAccount(borrowerOperationsAddress)
			const balanceAfter = await activePool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceAfter, 100)
		})
		it("decreaseDebt(): decreases the recorded debt token balance by the correct amount", async () => {
			const debtTokenAmount = 100
			const borrowerOperationsAddress = borrowerOperations.address
			await impersonateAccount(borrowerOperationsAddress)
			await activePool.increaseDebt(erc20.address, debtTokenAmount, { from: borrowerOperationsAddress })
			const balanceBefore = await activePool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceBefore.toString(), debtTokenAmount)
			await activePool.decreaseDebt(erc20.address, debtTokenAmount, { from: borrowerOperationsAddress })
			await stopImpersonatingAccount(borrowerOperationsAddress)
			const balanceAfter = await activePool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceAfter.toString(), 0)
		})
	})

	describe("DefaultPool", async accounts => {
		beforeEach(async () => {
			await network.provider.send("evm_revert", [initialSnapshotId])
			await setBalance(vesselManager.address, 1e18)
		})
		it("getAssetBalance(): gets the recorded collateral balance", async () => {
			const balance = await defaultPool.getAssetBalance(erc20.address)
			assert.equal(balance, 0)
		})
		it("getDebtTokenBalance(): gets the recorded debt token balance", async () => {
			const balance = await defaultPool.getDebtTokenBalance(erc20.address)
			assert.equal(balance, 0)
		})
		it("increaseDebt(): increases the recorded debt token balance by the correct amount", async () => {
			const balanceBefore = await defaultPool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceBefore, 0)
			const debtTokenAmount = 100
			const vesselManagerAddress = vesselManager.address
			await impersonateAccount(vesselManagerAddress)
			await defaultPool.increaseDebt(erc20.address, debtTokenAmount, { from: vesselManagerAddress })
			await stopImpersonatingAccount(vesselManagerAddress)
			const balanceAfter = await defaultPool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceAfter, debtTokenAmount)
		})
		it("decreaseDebt(): decreases the recorded debt token balance by the correct amount", async () => {
			const debtTokenAmount = 100
			const vesselManagerAddress = vesselManager.address
			await impersonateAccount(vesselManagerAddress)
			await defaultPool.increaseDebt(erc20.address, debtTokenAmount, { from: vesselManagerAddress })
			const balanceBefore = await defaultPool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceBefore.toString(), debtTokenAmount)
			await defaultPool.decreaseDebt(erc20.address, debtTokenAmount, { from: vesselManagerAddress })
			await stopImpersonatingAccount(vesselManagerAddress)
			const balanceAfter = await defaultPool.getDebtTokenBalance(erc20.address)
			assert.equal(balanceAfter, 0)
		})
	})
})

contract("Reset chain state", async accounts => {})
