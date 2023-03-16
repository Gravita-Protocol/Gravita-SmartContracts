const { setBalance, impersonateAccount, stopImpersonatingAccount } = require("@nomicfoundation/hardhat-network-helpers")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const th = testHelpers.TestHelper

contract("StabilityPool", async accounts => {
	beforeEach(async () => {
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])
		contracts = await deploymentHelper.deployGravitaCore()
		stabilityPool = contracts.stabilityPool
		erc20 = contracts.erc20
		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
	})
	it("getAssetBalance(): gets the recorded collateral balance", async () => {
		const balance = await stabilityPool.getCollateral(erc20.address)
		assert.equal(balance, 0)
	})
	it("getTotalDebtTokenDeposits(): gets the recorded debt token balance", async () => {
		const balance = await stabilityPool.getTotalDebtTokenDeposits()
		assert.equal(balance, 0)
	})
})

contract("ActivePool", async accounts => {
	beforeEach(async () => {
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])
		contracts = await deploymentHelper.deployGravitaCore()
		activePool = contracts.activePool
		erc20 = contracts.erc20
		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
		setBalance(contracts.borrowerOperations.address, 1e18)
	})
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
		const borrowerOperationsAddress = contracts.borrowerOperations.address
		await impersonateAccount(borrowerOperationsAddress)
		await activePool.increaseDebt(erc20.address, 100, { from: borrowerOperationsAddress })
		await stopImpersonatingAccount(borrowerOperationsAddress)
		const balanceAfter = await activePool.getDebtTokenBalance(erc20.address)
		assert.equal(balanceAfter, 100)
	})
	it("decreaseDebt(): decreases the recorded debt token balance by the correct amount", async () => {
		const debtTokenAmount = 100
		const borrowerOperationsAddress = contracts.borrowerOperations.address
		await impersonateAccount(borrowerOperationsAddress)
		await activePool.increaseDebt(erc20.address, debtTokenAmount, { from: borrowerOperationsAddress })
		const balanceBefore = await activePool.getDebtTokenBalance(erc20.address)
		assert.equal(balanceBefore, debtTokenAmount)
		await activePool.decreaseDebt(erc20.address, debtTokenAmount, { from: borrowerOperationsAddress })
		await stopImpersonatingAccount(borrowerOperationsAddress)
		const balanceAfter = await activePool.getDebtTokenBalance(erc20.address)
		assert.equal(balanceAfter, 0)
	})
})

contract("DefaultPool", async accounts => {
	beforeEach(async () => {
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])
		contracts = await deploymentHelper.deployGravitaCore()
		defaultPool = contracts.defaultPool
		erc20 = contracts.erc20
		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
		setBalance(contracts.vesselManager.address, 1e18)
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
		const vesselManagerAddress = contracts.vesselManager.address
		await impersonateAccount(vesselManagerAddress)
		await defaultPool.increaseDebt(erc20.address, debtTokenAmount, { from: vesselManagerAddress })
		await stopImpersonatingAccount(vesselManagerAddress)
		const balanceAfter = await defaultPool.getDebtTokenBalance(erc20.address)
		assert.equal(balanceAfter, debtTokenAmount)
	})
	it("decreaseDebt(): decreases the recorded debt token balance by the correct amount", async () => {
    const debtTokenAmount = 100
		const vesselManagerAddress = contracts.vesselManager.address
		await impersonateAccount(vesselManagerAddress)
		await defaultPool.increaseDebt(erc20.address, debtTokenAmount, { from: vesselManagerAddress })
		const balanceBefore = await defaultPool.getDebtTokenBalance(erc20.address)
		assert.equal(balanceBefore, debtTokenAmount)
		await defaultPool.decreaseDebt(erc20.address, debtTokenAmount, { from: vesselManagerAddress })
		await stopImpersonatingAccount(vesselManagerAddress)
		const balanceAfter = await defaultPool.getDebtTokenBalance(erc20.address)
		assert.equal(balanceAfter, 0)
	})
})

contract("Reset chain state", async accounts => {})
