const DebtTokenTester = artifacts.require("./DebtTokenTester.sol")
const VesselManagerTester = artifacts.require("./VesselManagerTester.sol")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const { ethers } = require("hardhat")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract("StabilityPool: Sum-Product rounding errors", async accounts => {

	const openVessel = async params => th.openVessel(contracts, params)
	const f = val => ethers.utils.formatUnits(val.toString())

	let contracts
	let priceFeed
	let stabilityPool
	let vesselManagerOperations
	let erc20

	beforeEach(async () => {
		contracts = await deploymentHelper.deployGravitaCore()
		contracts.vesselManager = await VesselManagerTester.new()
		contracts = await deploymentHelper.deployDebtTokenTester(contracts)
		VesselManagerTester.setAsDeployed(contracts.vesselManager)
		DebtTokenTester.setAsDeployed(contracts.debtToken)
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

		priceFeed = contracts.priceFeedTestnet
		vesselManagerOperations = contracts.vesselManagerOperations
		stabilityPool = contracts.stabilityPool
		erc20 = contracts.erc20

		let index = 0
		for (const acc of accounts) {
			await erc20.mint(acc, await web3.eth.getBalance(acc))
			if (index++ >= 350) break
		}

		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)
	})

	it("Rounding errors: 100 deposits of $100 into SP, then 200 liquidations of $49", async () => {
		const owner = accounts[0]
		const depositors = accounts.slice(1, 101)
		const defaulters = accounts.slice(101, 301)

		for (let account of depositors) {
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10_000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: account },
			})
			await stabilityPool.provideToSP(dec(100, 18), { from: account })
		}

		// Defaulter opens vessel with 200% ICR
		for (let defaulter of defaulters) {
			await openVessel({
				asset: erc20.address,
				ICR: toBN(dec(2, 18)),
				extraParams: { from: defaulter },
			})
		}

		// price drops by 50% -> defaulter ICR falls to 100%
		await priceFeed.setPrice(dec(105, 18))

		// Defaulters liquidated
		console.log(`Before liquidations:`)
		console.log(` - getTotalDebtTokenDeposits() :: ${f(await stabilityPool.getTotalDebtTokenDeposits())}`)
		console.log(` - getCollateral() :: ${f(await stabilityPool.getCollateral(erc20.address))}`)
		console.log(` - getCompoundedDebtTokenDeposits() :: ${f(await stabilityPool.getCompoundedDebtTokenDeposits(depositors[0]))}`)
		console.log(` - getDepositorGains() :: ${f((await stabilityPool.getDepositorGains(depositors[0]))[0][1])}`)

		for (let defaulter of defaulters) {
			await vesselManagerOperations.liquidate(erc20.address, defaulter, { from: owner })
		}
		const SP_TotalDepositsERC20 = await stabilityPool.getTotalDebtTokenDeposits()
		const SP_ERC20 = await stabilityPool.getCollateral(erc20.address)
		const compoundedDepositERC20 = await stabilityPool.getCompoundedDebtTokenDeposits(depositors[0])
		const GainERC20 = (await stabilityPool.getDepositorGains(depositors[0]))[0][1]

		console.log(`After liquidations:`)
		console.log(` - getTotalDebtTokenDeposits() :: ${f(SP_TotalDepositsERC20)}`)
		console.log(` - getCollateral() :: ${f(SP_ERC20)}`)
		console.log(` - getCompoundedDebtTokenDeposits() :: ${f(compoundedDepositERC20)}`)
		console.log(` - getDepositorGains() :: ${f(GainERC20)}`)

		// Check depositors receive their share without too much error
		assert.isAtMost(
			th.getDifference(
				SP_TotalDepositsERC20.div(th.toBN(depositors.length)),
				compoundedDepositERC20
			),
			100_000
		)
		assert.isAtMost(
			th.getDifference(SP_ERC20.div(th.toBN(depositors.length)), GainERC20),
			100_000
		)
	})
})

contract("Reset chain state", async accounts => {})

