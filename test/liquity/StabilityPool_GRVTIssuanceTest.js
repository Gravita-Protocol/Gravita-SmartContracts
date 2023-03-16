const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const toBN = th.toBN
const getDifference = th.getDifference

const VesselManagerTester = artifacts.require("VesselManagerTester")
const VUSDTokenTester = artifacts.require("VUSDTokenTester")
const StabilityPool = artifacts.require("StabilityPool.sol")

contract("StabilityPool - GRVT Rewards", async accounts => {
	const [
		owner,
		whale,
		A,
		B,
		C,
		D,
		E,
		F,
		G,
		H,
		defaulter_1,
		defaulter_2,
		defaulter_3,
		defaulter_4,
		defaulter_5,
		defaulter_6,
	] = accounts

	const [bountyAddress, lpRewardsAddress, multisig, treasury] = accounts.slice(996, 1000)

	let contracts

	let priceFeed
	let vusdToken
	let stabilityPool
	let stabilityPoolERC20
	let erc20
	let sortedVessels
	let vesselManager
	let borrowerOperations
	let grvtToken
	let communityIssuanceTester

	let issuance_M1 = toBN(dec(Math.round(204_425 * 4.28575), 18))
	let issuance_M2 = toBN(dec(Math.round(204_425 * 4.28575 * 2), 18))

	const ZERO_ADDRESS = th.ZERO_ADDRESS

	const getOpenVesselVUSDAmount = async (totalDebt, asset) =>
		th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)

	const openVessel = async params => th.openVessel(contracts, params)
	describe("GRVT Rewards", async () => {
		beforeEach(async () => {
			contracts = await deploymentHelper.deployLiquityCore()
			contracts.vesselManager = await VesselManagerTester.new()
			contracts.vusdToken = await VUSDTokenTester.new(
				contracts.vesselManager.address,
				contracts.stabilityPoolManager.address,
				contracts.borrowerOperations.address
			)
			const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(treasury)

			priceFeed = contracts.priceFeedTestnet
			vusdToken = contracts.vusdToken
			sortedVessels = contracts.sortedVessels
			vesselManager = contracts.vesselManager
			borrowerOperations = contracts.borrowerOperations
			erc20 = contracts.erc20

			grvtToken = GRVTContracts.grvtToken
			communityIssuanceTester = GRVTContracts.communityIssuance

			let index = 0
			for (const acc of accounts) {
				await erc20.mint(acc, await web3.eth.getBalance(acc))
				index++

				if (index >= 100) break
			}

			await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
			await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)

			stabilityPool = await StabilityPool.at(
				await contracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS)
			)
			stabilityPoolERC20 = await StabilityPool.at(
				await contracts.stabilityPoolManager.getAssetStabilityPool(erc20.address)
			)

			// Check community issuance starts with 32 million GRVT
			assert.isAtMost(
				getDifference(
					toBN(await grvtToken.balanceOf(communityIssuanceTester.address)),
					"64000000000000000000000000"
				),
				1000
			)

			await communityIssuanceTester.setWeeklyGrvtDistribution(
				stabilityPool.address,
				dec(204_425, 18)
			)
			await communityIssuanceTester.setWeeklyGrvtDistribution(
				stabilityPoolERC20.address,
				dec(204_425, 18)
			)
		})

		// using the result of this to advance time by the desired amount from the deployment time, whether or not some extra time has passed in the meanwhile
		const getDuration = async expectedDuration => {
			const deploymentTime = (
				await communityIssuanceTester.lastUpdateTime(stabilityPool.address)
			).toNumber()
			const deploymentTimeERC = (
				await communityIssuanceTester.lastUpdateTime(stabilityPoolERC20.address)
			).toNumber()

			const time = Math.max(deploymentTime, deploymentTimeERC)
			const currentTime = await th.getLatestBlockTimestamp(web3)
			const duration = Math.max(expectedDuration - (currentTime - time), 0)

			return duration
		}

		it("liquidation < 1 minute after a deposit does not change totalGRVTIssued", async () => {
			await openVessel({
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})

			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openVessel({
				asset: erc20.address,
				extraVUSDAmount: toBN(dec(10000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})

			// A, B provide to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: A })
			await stabilityPool.provideToSP(dec(5000, 18), { from: B })

			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
			await stabilityPoolERC20.provideToSP(dec(5000, 18), { from: B })

			await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

			await priceFeed.setPrice(dec(105, 18))

			// B adjusts, triggering GRVT issuance for all
			await stabilityPool.provideToSP(dec(1, 18), { from: B })
			await stabilityPoolERC20.provideToSP(dec(1, 18), { from: B })
			const blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

			// Check GRVT has been issued
			const totalGRVTIssued_1 = await communityIssuanceTester.totalGRVTIssued(
				stabilityPool.address
			)
			assert.isTrue(totalGRVTIssued_1.gt(toBN("0")))

			const totalGRVTIssued_1ERC20 = await communityIssuanceTester.totalGRVTIssued(
				stabilityPoolERC20.address
			)
			assert.isTrue(totalGRVTIssued_1ERC20.gt(toBN("0")))

			await vesselManager.liquidate(ZERO_ADDRESS, B)
			await vesselManager.liquidate(erc20.address, B)
			const blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))

			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, B))
			assert.isFalse(await sortedVessels.contains(erc20.address, B))

			const totalGRVTIssued_2 = await communityIssuanceTester.totalGRVTIssued(
				stabilityPool.address
			)
			const totalGRVTIssued_2ERC20 = await communityIssuanceTester.totalGRVTIssued(
				stabilityPoolERC20.address
			)

			// check blockTimestamp diff < 60s
			const timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)
			assert.isTrue(timestampDiff.lt(toBN(60)))

			// Check that the liquidation did not alter total GRVT issued
			assert.isTrue(totalGRVTIssued_2.eq(totalGRVTIssued_1))
			assert.isTrue(totalGRVTIssued_2ERC20.eq(totalGRVTIssued_1ERC20))

			// Check that depositor B has no GRVT gain
			assert.equal(await stabilityPool.getDepositorGRVTGain(B), "0")
			assert.equal(await stabilityPoolERC20.getDepositorGRVTGain(B), "0")

			// Check depositor B has a pending ETH gain
			assert.isTrue((await stabilityPool.getDepositorAssetGain(B)).gt(toBN("0")))
			assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(B)).gt(toBN("0")))
		})

		it("withdrawFromSP(): reward term G does not update when no GRVT is issued", async () => {
			await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), A, A, {
				from: A,
				value: dec(1000, "ether"),
			})
			await borrowerOperations.openVessel(
				erc20.address,
				dec(1000, "ether"),
				th._100pct,
				dec(10000, 18),
				A,
				A,
				{ from: A }
			)
			await stabilityPool.provideToSP(dec(10000, 18), { from: A })
			await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })

			assert.equal((await stabilityPool.deposits(A)).toString(), dec(10000, 18))
			assert.equal((await stabilityPoolERC20.deposits(A)).toString(), dec(10000, 18))

			// defaulter opens vessel
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1, value: dec(100, "ether") }
			)
			await borrowerOperations.openVessel(
				erc20.address,
				dec(100, "ether"),
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_1,
				defaulter_1,
				{ from: defaulter_1 }
			)

			// ETH drops
			await priceFeed.setPrice(dec(100, 18))

			await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

			// Liquidate d1. Triggers issuance.
			await vesselManager.liquidate(ZERO_ADDRESS, defaulter_1)
			await vesselManager.liquidate(erc20.address, defaulter_1)
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_1))
			assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

			// Get G and communityIssuance before
			const G_Before = await stabilityPool.epochToScaleToG(0, 0)
			const GRVTIssuedBefore = await communityIssuanceTester.totalGRVTIssued(
				stabilityPool.address
			)

			const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)
			const GRVTIssuedBeforeERC20 = await communityIssuanceTester.totalGRVTIssued(
				stabilityPoolERC20.address
			)

			//  A withdraws some deposit. Triggers issuance.
			const tx = await stabilityPool.withdrawFromSP(1000, { from: A, gasPrice: 0 })
			assert.isTrue(tx.receipt.status)

			const txERC20 = await stabilityPoolERC20.withdrawFromSP(1000, { from: A, gasPrice: 0 })
			assert.isTrue(txERC20.receipt.status)

			// Check G and GRVTIssued do not increase, since <1 minute has passed between issuance triggers
			const G_After = await stabilityPool.epochToScaleToG(0, 0)
			const GRVTIssuedAfter = await communityIssuanceTester.totalGRVTIssued(
				stabilityPool.address
			)

			const G_AfterERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)
			const GRVTIssuedAfterERC20 = await communityIssuanceTester.totalGRVTIssued(
				stabilityPoolERC20.address
			)

			assert.isTrue(G_After.eq(G_Before))
			assert.isTrue(GRVTIssuedAfter.eq(GRVTIssuedBefore))

			assert.isTrue(G_AfterERC20.eq(G_BeforeERC20))
			assert.isTrue(GRVTIssuedAfterERC20.eq(GRVTIssuedBeforeERC20))
		})

		// // Simple case: 3 depositors, equal stake. No liquidations. No front-end.
		// it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct GRVT gain. No liquidations. No front end.", async () => {
		//   const initialIssuance = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.equal(initialIssuance, 0)

		//   const initialIssuanceERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.equal(initialIssuanceERC20, 0)

		//   // Whale opens Vessel with 10k ETH
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), whale, whale, { from: whale, value: dec(10000, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(1, 22), A, A, { from: A, value: dec(100, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(1, 22), B, B, { from: B, value: dec(100, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(1, 22), C, C, { from: C, value: dec(100, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(1, 22), D, D, { from: D, value: dec(100, 'ether') })

		//   await borrowerOperations.openVessel(erc20.address, dec(10000, 'ether'), th._100pct, dec(10000, 18), whale, whale, { from: whale })
		//   await borrowerOperations.openVessel(erc20.address, dec(100, 'ether'), th._100pct, dec(1, 22), B, B, { from: B })
		//   await borrowerOperations.openVessel(erc20.address, dec(100, 'ether'), th._100pct, dec(1, 22), A, A, { from: A })
		//   await borrowerOperations.openVessel(erc20.address, dec(100, 'ether'), th._100pct, dec(1, 22), C, C, { from: C })
		//   await borrowerOperations.openVessel(erc20.address, dec(100, 'ether'), th._100pct, dec(1, 22), D, D, { from: D })

		//   // Check all GRVT balances are initially 0
		//   assert.equal(await grvtToken.balanceOf(A), 0)
		//   assert.equal(await grvtToken.balanceOf(B), 0)
		//   assert.equal(await grvtToken.balanceOf(C), 0)

		//   // A, B, C deposit
		//   await stabilityPool.provideToSP(dec(1, 22), { from: A })
		//   await stabilityPool.provideToSP(dec(1, 22), { from: B })
		//   await stabilityPool.provideToSP(dec(1, 22), { from: C })

		//   await stabilityPoolERC20.provideToSP(dec(1, 22), { from: A })
		//   await stabilityPoolERC20.provideToSP(dec(1, 22), { from: B })
		//   await stabilityPoolERC20.provideToSP(dec(1, 22), { from: C })

		//   // One year passes
		//   await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_YEAR), web3.currentProvider)

		//   // D deposits, triggering GRVT gains for A,B,C. Withdraws immediately after
		//   await stabilityPool.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

		//   await stabilityPoolERC20.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: D })

		//   // Expected gains for each depositor after 1 year (50% total issued).  Each deposit gets 1/3 of issuance.
		//   const expectedGRVTGain_1yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address)).div(toBN('2')).div(toBN('3'))
		//   const expectedGRVTGain_1yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address)).div(toBN('2')).div(toBN('3'))

		//   // Check GRVT gain
		//   const A_GRVTGain_1yr = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_1yr = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_1yr = await stabilityPool.getDepositorGRVTGain(C)

		//   const A_GRVTGain_1yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(A)
		//   const B_GRVTGain_1yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(B)
		//   const C_GRVTGain_1yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(C)

		//   // Check gains are correct, error tolerance = 1e-6 of a token

		//   assert.isAtMost(getDifference(A_GRVTGain_1yr, expectedGRVTGain_1yr), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_1yr, expectedGRVTGain_1yr), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_1yr, expectedGRVTGain_1yr), 1e12)

		//   assert.isAtMost(getDifference(A_GRVTGain_1yrERC20, expectedGRVTGain_1yrERC20), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_1yrERC20, expectedGRVTGain_1yrERC20), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_1yrERC20, expectedGRVTGain_1yrERC20), 1e12)

		//   // Another year passes
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		//   // D deposits, triggering GRVT gains for A,B,C. Withdraws immediately after
		//   await stabilityPool.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

		//   await stabilityPoolERC20.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: D })

		//   // Expected gains for each depositor after 2 years (75% total issued).  Each deposit gets 1/3 of issuance.
		//   const expectedGRVTGain_2yr =
		//     (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address)).mul(toBN('3')).div(toBN('4')).div(toBN('3'))
		//   const expectedGRVTGain_2yrERC20 =
		//     (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address)).mul(toBN('3')).div(toBN('4')).div(toBN('3'))

		//   // Check GRVT gain
		//   const A_GRVTGain_2yr = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_2yr = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_2yr = await stabilityPool.getDepositorGRVTGain(C)

		//   const A_GRVTGain_2yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(A)
		//   const B_GRVTGain_2yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(B)
		//   const C_GRVTGain_2yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(C)

		//   // Check gains are correct, error tolerance = 1e-6 of a token
		//   assert.isAtMost(getDifference(A_GRVTGain_2yr, expectedGRVTGain_2yr), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_2yr, expectedGRVTGain_2yr), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_2yr, expectedGRVTGain_2yr), 1e12)

		//   assert.isAtMost(getDifference(A_GRVTGain_2yrERC20, expectedGRVTGain_2yrERC20), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_2yrERC20, expectedGRVTGain_2yrERC20), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_2yrERC20, expectedGRVTGain_2yrERC20), 1e12)

		//   // Each depositor fully withdraws
		//   await stabilityPool.withdrawFromSP(dec(100, 18), { from: A })
		//   await stabilityPool.withdrawFromSP(dec(100, 18), { from: B })
		//   await stabilityPool.withdrawFromSP(dec(100, 18), { from: C })

		//   await stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: A })
		//   await stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: B })
		//   await stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: C })

		//   // Check GRVT balances increase by correct amount
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(A)), expectedGRVTGain_2yr.add(expectedGRVTGain_2yrERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(B)), expectedGRVTGain_2yr.add(expectedGRVTGain_2yrERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(C)), expectedGRVTGain_2yr.add(expectedGRVTGain_2yrERC20)), 1e12)
		// })

		// // 3 depositors, varied stake. No liquidations. No front-end.
		// it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct GRVT gain. No liquidations. No front end.", async () => {
		//   const initialIssuance = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.equal(initialIssuance, 0)

		//   const initialIssuanceERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.equal(initialIssuanceERC20, 0)

		//   // Whale opens Vessel with 10k ETH
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(10000, 18)), whale, whale, { from: whale, value: dec(10000, 'ether') })

		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), A, A, { from: A, value: dec(200, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(20000, 18), B, B, { from: B, value: dec(300, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(30000, 18), C, C, { from: C, value: dec(400, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), D, D, { from: D, value: dec(100, 'ether') })

		//   await borrowerOperations.openVessel(erc20.address, dec(10000, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(10000, 18)), whale, whale, { from: whale })

		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(10000, 18), A, A, { from: A })
		//   await borrowerOperations.openVessel(erc20.address, dec(300, 'ether'), th._100pct, dec(20000, 18), B, B, { from: B })
		//   await borrowerOperations.openVessel(erc20.address, dec(400, 'ether'), th._100pct, dec(30000, 18), C, C, { from: C })
		//   await borrowerOperations.openVessel(erc20.address, dec(100, 'ether'), th._100pct, dec(10000, 18), D, D, { from: D })

		//   // Check all GRVT balances are initially 0
		//   assert.equal(await grvtToken.balanceOf(A), 0)
		//   assert.equal(await grvtToken.balanceOf(B), 0)
		//   assert.equal(await grvtToken.balanceOf(C), 0)

		//   // A, B, C deposit
		//   await stabilityPool.provideToSP(dec(10000, 18), { from: A })
		//   await stabilityPool.provideToSP(dec(20000, 18), { from: B })
		//   await stabilityPool.provideToSP(dec(30000, 18), { from: C })

		//   await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
		//   await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: B })
		//   await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: C })

		//   // One year passes
		//   await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_YEAR), web3.currentProvider)

		//   // D deposits, triggering GRVT gains for A,B,C. Withdraws immediately after
		//   await stabilityPool.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

		//   await stabilityPoolERC20.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: D })

		//   // Expected gains for each depositor after 1 year (50% total issued)
		//   const A_expectedGRVTGain_1yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('2')) // 50% of total issued after 1 year
		//     .div(toBN('6'))  // A gets 1/6 of the issuance

		//   const B_expectedGRVTGain_1yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('2')) // 50% of total issued after 1 year
		//     .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

		//   const C_expectedGRVTGain_1yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('2')) // 50% of total issued after 1 year
		//     .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

		//   const A_expectedGRVTGain_1yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('2')) // 50% of total issued after 1 year
		//     .div(toBN('6'))  // A gets 1/6 of the issuance

		//   const B_expectedGRVTGain_1yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('2')) // 50% of total issued after 1 year
		//     .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

		//   const C_expectedGRVTGain_1yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('2')) // 50% of total issued after 1 year
		//     .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

		//   // Check GRVT gain
		//   const A_GRVTGain_1yr = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_1yr = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_1yr = await stabilityPool.getDepositorGRVTGain(C)

		//   const A_GRVTGain_1yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(A)
		//   const B_GRVTGain_1yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(B)
		//   const C_GRVTGain_1yrERC20 = await stabilityPoolERC20.getDepositorGRVTGain(C)

		//   // Check gains are correct, error tolerance = 1e-6 of a toke
		//   assert.isAtMost(getDifference(A_GRVTGain_1yr, A_expectedGRVTGain_1yr), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_1yr, B_expectedGRVTGain_1yr), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_1yr, C_expectedGRVTGain_1yr), 1e12)

		//   assert.isAtMost(getDifference(A_GRVTGain_1yrERC20, A_expectedGRVTGain_1yrERC20), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_1yrERC20, B_expectedGRVTGain_1yrERC20), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_1yrERC20, C_expectedGRVTGain_1yrERC20), 1e12)

		//   // Another year passes
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		//   // D deposits, triggering GRVT gains for A,B,C. Withdraws immediately after
		//   await stabilityPool.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

		//   await stabilityPoolERC20.provideToSP(dec(1, 18), { from: D })
		//   await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: D })

		//   // Expected gains for each depositor after 2 years (75% total issued).
		//   const A_expectedGRVTGain_2yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .mul(toBN('3')).div(toBN('4')) // 75% of total issued after 1 year
		//     .div(toBN('6'))  // A gets 1/6 of the issuance

		//   const B_expectedGRVTGain_2yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .mul(toBN('3')).div(toBN('4')) // 75% of total issued after 1 year
		//     .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

		//   const C_expectedGRVTGain_2yr = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .mul(toBN('3')).div(toBN('4')) // 75% of total issued after 1 year
		//     .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

		//   // Expected gains for each depositor after 2 years (75% total issued).
		//   const A_expectedGRVTGain_2yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .mul(toBN('3')).div(toBN('4')) // 75% of total issued after 1 year
		//     .div(toBN('6'))  // A gets 1/6 of the issuance

		//   const B_expectedGRVTGain_2yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .mul(toBN('3')).div(toBN('4')) // 75% of total issued after 1 year
		//     .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

		//   const C_expectedGRVTGain_2yrERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .mul(toBN('3')).div(toBN('4')) // 75% of total issued after 1 year
		//     .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

		//   // Check GRVT gain
		//   const A_GRVTGain_2yr = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_2yr = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_2yr = await stabilityPool.getDepositorGRVTGain(C)

		//   const A_GRVTGain_2yrERC20 = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_2yrERC20 = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_2yrERC20 = await stabilityPool.getDepositorGRVTGain(C)

		//   // Check gains are correct, error tolerance = 1e-6 of a token
		//   assert.isAtMost(getDifference(A_GRVTGain_2yr, A_expectedGRVTGain_2yr), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_2yr, B_expectedGRVTGain_2yr), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_2yr, C_expectedGRVTGain_2yr), 1e12)

		//   assert.isAtMost(getDifference(A_GRVTGain_2yrERC20, A_expectedGRVTGain_2yrERC20), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_2yrERC20, B_expectedGRVTGain_2yrERC20), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_2yrERC20, C_expectedGRVTGain_2yrERC20), 1e12)

		//   // Each depositor fully withdraws
		//   await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
		//   await stabilityPool.withdrawFromSP(dec(10000, 18), { from: B })
		//   await stabilityPool.withdrawFromSP(dec(10000, 18), { from: C })

		//   await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: A })
		//   await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: B })
		//   await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: C })

		//   // Check GRVT balances increase by correct amount
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(A)), A_expectedGRVTGain_2yr.add(A_expectedGRVTGain_2yrERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(B)), B_expectedGRVTGain_2yr.add(B_expectedGRVTGain_2yrERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(C)), C_expectedGRVTGain_2yr.add(C_expectedGRVTGain_2yrERC20)), 1e12)
		// })

		// // A, B, C deposit. Varied stake. 1 Liquidation. D joins.
		// it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct GRVT gain. No liquidations. No front end.", async () => {
		//   const initialIssuance = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.equal(initialIssuance, 0)

		//   const initialIssuanceERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.equal(initialIssuanceERC20, 0)

		//   // Whale opens Vessel with 10k ETH
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), whale, whale, { from: whale, value: dec(10000, 'ether') })

		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), A, A, { from: A, value: dec(200, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(20000, 18), B, B, { from: B, value: dec(300, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(30000, 18), C, C, { from: C, value: dec(400, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(40000, 18), D, D, { from: D, value: dec(500, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(40000, 18), E, E, { from: E, value: dec(600, 'ether') })

		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(30000, 18)), defaulter_1, defaulter_1, { from: defaulter_1, value: dec(300, 'ether') })

		//   await borrowerOperations.openVessel(erc20.address, dec(10000, 'ether'), th._100pct, dec(10000, 18), whale, whale, { from: whale })

		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(10000, 18), A, A, { from: A })
		//   await borrowerOperations.openVessel(erc20.address, dec(300, 'ether'), th._100pct, dec(20000, 18), B, B, { from: B })
		//   await borrowerOperations.openVessel(erc20.address, dec(400, 'ether'), th._100pct, dec(30000, 18), C, C, { from: C })
		//   await borrowerOperations.openVessel(erc20.address, dec(500, 'ether'), th._100pct, dec(40000, 18), D, D, { from: D })
		//   await borrowerOperations.openVessel(erc20.address, dec(600, 'ether'), th._100pct, dec(40000, 18), E, E, { from: E })

		//   await borrowerOperations.openVessel(erc20.address, dec(300, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(30000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })

		//   // Check all GRVT balances are initially 0
		//   assert.equal(await grvtToken.balanceOf(A), 0)
		//   assert.equal(await grvtToken.balanceOf(B), 0)
		//   assert.equal(await grvtToken.balanceOf(C), 0)
		//   assert.equal(await grvtToken.balanceOf(D), 0)

		//   // A, B, C deposit
		//   await stabilityPool.provideToSP(dec(10000, 18), { from: A })
		//   await stabilityPool.provideToSP(dec(20000, 18), { from: B })
		//   await stabilityPool.provideToSP(dec(30000, 18), { from: C })

		//   await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
		//   await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: B })
		//   await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: C })

		//   // Year 1 passes
		//   await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_YEAR), web3.currentProvider)

		//   assert.equal(await stabilityPool.getTotalDebtTokenDeposits(), dec(60000, 18))
		//   assert.equal(await stabilityPoolERC20.getTotalDebtTokenDeposits(), dec(60000, 18))

		//   // Price Drops, defaulter1 liquidated. Stability Pool size drops by 50%
		//   await priceFeed.setPrice(dec(100, 18))
		//   assert.isFalse(await th.checkRecoveryMode(contracts))
		//   assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

		//   await vesselManager.liquidate(ZERO_ADDRESS, defaulter_1)
		//   await vesselManager.liquidate(erc20.address, defaulter_1)
		//   assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_1))
		//   assert.isFalse(await sortedVessels.contains(erc20.address, defaulter_1))

		//   // Confirm SP dropped from 60k to 30k
		//   assert.isAtMost(getDifference(await stabilityPool.getTotalDebtTokenDeposits(), dec(30000, 18)), 1000)
		//   assert.isAtMost(getDifference(await stabilityPoolERC20.getTotalDebtTokenDeposits(), dec(30000, 18)), 1000)

		//   // Expected gains for each depositor after 1 year (50% total issued)
		//   const A_expectedGRVTGain_Y1 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('2')) // 50% of total issued in Y1
		//     .div(toBN('6'))  // A got 1/6 of the issuance

		//   const B_expectedGRVTGain_Y1 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('2')) // 50% of total issued in Y1
		//     .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

		//   const C_expectedGRVTGain_Y1 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('2')) // 50% of total issued in Y1
		//     .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

		//   const A_expectedGRVTGain_Y1ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('2')) // 50% of total issued in Y1
		//     .div(toBN('6'))  // A got 1/6 of the issuance

		//   const B_expectedGRVTGain_Y1ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('2')) // 50% of total issued in Y1
		//     .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

		//   const C_expectedGRVTGain_Y1ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('2')) // 50% of total issued in Y1
		//     .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

		//   // Check GRVT gain
		//   const A_GRVTGain_Y1 = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_Y1 = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_Y1 = await stabilityPool.getDepositorGRVTGain(C)

		//   const A_GRVTGain_Y1ERC20 = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_Y1ERC20 = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_Y1ERC20 = await stabilityPool.getDepositorGRVTGain(C)

		//   // Check gains are correct, error tolerance = 1e-6 of a toke
		//   assert.isAtMost(getDifference(A_GRVTGain_Y1, A_expectedGRVTGain_Y1), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_Y1, B_expectedGRVTGain_Y1), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_Y1, C_expectedGRVTGain_Y1), 1e12)

		//   assert.isAtMost(getDifference(A_GRVTGain_Y1ERC20, A_expectedGRVTGain_Y1ERC20), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_Y1ERC20, B_expectedGRVTGain_Y1ERC20), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_Y1ERC20, C_expectedGRVTGain_Y1ERC20), 1e12)

		//   // D deposits 40k
		//   await stabilityPool.provideToSP(dec(40000, 18), { from: D })
		//   await stabilityPoolERC20.provideToSP(dec(40000, 18), { from: D })

		//   // Year 2 passes
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		//   // E deposits and withdraws, creating GRVT issuance
		//   await stabilityPool.provideToSP(dec(1, 18), { from: E })
		//   await stabilityPool.withdrawFromSP(dec(1, 18), { from: E })

		//   await stabilityPoolERC20.provideToSP(dec(1, 18), { from: E })
		//   await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: E })

		//   // Expected gains for each depositor during Y2:
		//   const A_expectedGRVTGain_Y2 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .div(toBN('14'))  // A got 50/700 = 1/14 of the issuance

		//   const B_expectedGRVTGain_Y2 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .div(toBN('7'))  // B got 100/700 = 1/7 of the issuance

		//   const C_expectedGRVTGain_Y2 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .mul(toBN('3')).div(toBN('14'))  // C gets 150/700 = 3/14 of the issuance

		//   const D_expectedGRVTGain_Y2 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPool.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .mul(toBN('4')).div(toBN('7'))  // D gets 400/700 = 4/7 of the issuance

		//   // Expected gains for each depositor during Y2:
		//   const A_expectedGRVTGain_Y2ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .div(toBN('14'))  // A got 50/700 = 1/14 of the issuance

		//   const B_expectedGRVTGain_Y2ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .div(toBN('7'))  // B got 100/700 = 1/7 of the issuance

		//   const C_expectedGRVTGain_Y2ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .mul(toBN('3')).div(toBN('14'))  // C gets 150/700 = 3/14 of the issuance

		//   const D_expectedGRVTGain_Y2ERC20 = (await communityIssuanceTester.GRVTSupplyCaps(stabilityPoolERC20.address))
		//     .div(toBN('4')) // 25% of total issued in Y2
		//     .mul(toBN('4')).div(toBN('7'))  // D gets 400/700 = 4/7 of the issuance

		//   // Check GRVT gain
		//   const A_GRVTGain_AfterY2 = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_AfterY2 = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_AfterY2 = await stabilityPool.getDepositorGRVTGain(C)
		//   const D_GRVTGain_AfterY2 = await stabilityPool.getDepositorGRVTGain(D)

		//   const A_GRVTGain_AfterY2ERC20 = await stabilityPool.getDepositorGRVTGain(A)
		//   const B_GRVTGain_AfterY2ERC20 = await stabilityPool.getDepositorGRVTGain(B)
		//   const C_GRVTGain_AfterY2ERC20 = await stabilityPool.getDepositorGRVTGain(C)
		//   const D_GRVTGain_AfterY2ERC20 = await stabilityPool.getDepositorGRVTGain(D)

		//   const A_expectedTotalGain = A_expectedGRVTGain_Y1.add(A_expectedGRVTGain_Y2)
		//   const B_expectedTotalGain = B_expectedGRVTGain_Y1.add(B_expectedGRVTGain_Y2)
		//   const C_expectedTotalGain = C_expectedGRVTGain_Y1.add(C_expectedGRVTGain_Y2)
		//   const D_expectedTotalGain = D_expectedGRVTGain_Y2

		//   const A_expectedTotalGainERC20 = A_expectedGRVTGain_Y1ERC20.add(A_expectedGRVTGain_Y2ERC20)
		//   const B_expectedTotalGainERC20 = B_expectedGRVTGain_Y1ERC20.add(B_expectedGRVTGain_Y2ERC20)
		//   const C_expectedTotalGainERC20 = C_expectedGRVTGain_Y1ERC20.add(C_expectedGRVTGain_Y2ERC20)
		//   const D_expectedTotalGainERC20 = D_expectedGRVTGain_Y2ERC20

		//   // Check gains are correct, error tolerance = 1e-6 of a token
		//   assert.isAtMost(getDifference(A_GRVTGain_AfterY2, A_expectedTotalGain), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_AfterY2, B_expectedTotalGain), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_AfterY2, C_expectedTotalGain), 1e12)
		//   assert.isAtMost(getDifference(D_GRVTGain_AfterY2, D_expectedTotalGain), 1e12)

		//   assert.isAtMost(getDifference(A_GRVTGain_AfterY2ERC20, A_expectedTotalGainERC20), 1e12)
		//   assert.isAtMost(getDifference(B_GRVTGain_AfterY2ERC20, B_expectedTotalGainERC20), 1e12)
		//   assert.isAtMost(getDifference(C_GRVTGain_AfterY2ERC20, C_expectedTotalGainERC20), 1e12)
		//   assert.isAtMost(getDifference(D_GRVTGain_AfterY2ERC20, D_expectedTotalGainERC20), 1e12)

		//   // Each depositor fully withdraws
		//   await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
		//   await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
		//   await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
		//   await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

		//   await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: A })
		//   await stabilityPoolERC20.withdrawFromSP(dec(20000, 18), { from: B })
		//   await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), { from: C })
		//   await stabilityPoolERC20.withdrawFromSP(dec(40000, 18), { from: D })

		//   // Check GRVT balances increase by correct amount
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(A)), A_expectedTotalGain.add(A_expectedTotalGainERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(B)), B_expectedTotalGain.add(B_expectedTotalGainERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(C)), C_expectedTotalGain.add(C_expectedTotalGainERC20)), 1e12)
		//   assert.isAtMost(getDifference((await grvtToken.balanceOf(D)), D_expectedTotalGain.add(D_expectedTotalGainERC20)), 1e12)
		// })

		// //--- Serial pool-emptying liquidations ---

		// /* A, B deposit 100C
		// L1 cancels 200C
		// B, C deposits 100C
		// L2 cancels 200C
		// E, F deposit 100C
		// L3 cancels 200C
		// G,H deposits 100C
		// L4 cancels 200C

		// Expect all depositors withdraw  1/2 of 1 month's GRVT issuance */
		// it('withdrawFromSP(): Depositor withdraws correct GRVT gain after serial pool-emptying liquidations. No front-ends.', async () => {
		//   const initialIssuance = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.equal(initialIssuance, 0)

		//   const initialIssuanceERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.equal(initialIssuanceERC20, 0)

		//   // Whale opens Vessel with 10k ETH
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(10000, 18)), whale, whale, { from: whale, value: dec(10000, 'ether') })
		//   await borrowerOperations.openVessel(erc20.address, dec(10000, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(10000, 18)), whale, whale, { from: whale })

		//   const allDepositors = [A, B, C, D, E, F, G, H]
		//   // 4 Defaulters open vessel with 200VUSD debt, and 200% ICR
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_1, defaulter_1, { from: defaulter_1, value: dec(200, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_2, defaulter_2, { from: defaulter_2, value: dec(200, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_3, defaulter_3, { from: defaulter_3, value: dec(200, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_4, defaulter_4, { from: defaulter_4, value: dec(200, 'ether') })

		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })
		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_2, defaulter_2, { from: defaulter_2 })
		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_3, defaulter_3, { from: defaulter_3 })
		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, await getOpenVesselVUSDAmount(dec(20000, 18)), defaulter_4, defaulter_4, { from: defaulter_4 })

		//   // price drops by 50%: defaulter ICR falls to 100%
		//   await priceFeed.setPrice(dec(100, 18));

		//   // Check all would-be depositors have 0 GRVT balance
		//   for (depositor of allDepositors) {
		//     assert.equal(await grvtToken.balanceOf(depositor), '0')
		//   }

		//   // A, B each deposit 10k VUSD
		//   const depositors_1 = [A, B]
		//   for (account of depositors_1) {
		//     await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), account, account, { from: account, value: dec(200, 'ether') })
		//     await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(10000, 18), account, account, { from: account })
		//     await stabilityPool.provideToSP(dec(10000, 18), { from: account })
		//     await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
		//   }

		//   // 1 month passes
		//   await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_MONTH), web3.currentProvider)

		//   // Defaulter 1 liquidated. 20k VUSD fully offset with pool.
		//   await vesselManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner });
		//   await vesselManager.liquidate(erc20.address, defaulter_1, { from: owner });

		//   // C, D each deposit 10k VUSD
		//   const depositors_2 = [C, D]
		//   for (account of depositors_2) {
		//     await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), account, account, { from: account, value: dec(200, 'ether') })
		//     await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(10000, 18), account, account, { from: account })

		//     await stabilityPool.provideToSP(dec(10000, 18), { from: account })
		//     await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
		//   }

		//   // 1 month passes
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

		//   // Defaulter 2 liquidated. 10k VUSD offset
		//   await vesselManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner });
		//   await vesselManager.liquidate(erc20.address, defaulter_2, { from: owner });

		//   // Erin, Flyn each deposit 100 VUSD
		//   const depositors_3 = [E, F]
		//   for (account of depositors_3) {
		//     await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), account, account, { from: account, value: dec(200, 'ether') })
		//     await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(10000, 18), account, account, { from: account })

		//     await stabilityPool.provideToSP(dec(10000, 18), { from: account })
		//     await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
		//   }

		//   // 1 month passes
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

		//   // Defaulter 3 liquidated. 100 VUSD offset
		//   await vesselManager.liquidate(ZERO_ADDRESS, defaulter_3, { from: owner });
		//   await vesselManager.liquidate(erc20.address, defaulter_3, { from: owner });

		//   // Graham, Harriet each deposit 10k VUSD
		//   const depositors_4 = [G, H]
		//   for (account of depositors_4) {
		//     await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), account, account, { from: account, value: dec(200, 'ether') })
		//     await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(10000, 18), account, account, { from: account })

		//     await stabilityPool.provideToSP(dec(10000, 18), { from: account })
		//     await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
		//   }

		//   // 1 month passes
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

		//   // Defaulter 4 liquidated. 100 VUSD offset
		//   await vesselManager.liquidate(ZERO_ADDRESS, defaulter_4, { from: owner });
		//   await vesselManager.liquidate(erc20.address, defaulter_4, { from: owner });

		//   // All depositors withdraw from SP
		//   for (depositor of allDepositors) {
		//     await stabilityPool.withdrawFromSP(dec(10000, 18), { from: depositor })
		//     await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: depositor })
		//   }

		//   /* Each depositor constitutes 50% of the pool from the time they deposit, up until the liquidation.
		//   Therefore, divide monthly issuance by 2 to get the expected per-depositor GRVT gain.*/
		//   //x2 since we are doing two collateral in one test
		//   const expectedGRVTGain_M1 = issuance_M1.div(th.toBN('2')).mul(toBN(2))
		//   const expectedGRVTGain_M2 = issuance_M2.div(th.toBN('2')).mul(toBN(2))
		//   const expectedGRVTGain_M3 = issuance_M3.div(th.toBN('2')).mul(toBN(2))
		//   const expectedGRVTGain_M4 = issuance_M4.div(th.toBN('2')).mul(toBN(2))

		//   // Check A, B only earn issuance from month 1. Error tolerance = 1e-3 tokens
		//   for (depositor of [A, B]) {
		//     const GRVTBalance = await grvtToken.balanceOf(depositor)
		//     assert.isAtMost(getDifference(GRVTBalance, expectedGRVTGain_M1), 1e15)
		//   }

		//   // Check C, D only earn issuance from month 2.  Error tolerance = 1e-3 tokens
		//   for (depositor of [C, D]) {
		//     const GRVTBalance = await grvtToken.balanceOf(depositor)
		//     assert.isAtMost(getDifference(GRVTBalance, expectedGRVTGain_M2), 1e15)
		//   }

		//   // Check E, F only earn issuance from month 3.  Error tolerance = 1e-3 tokens
		//   for (depositor of [E, F]) {
		//     const GRVTBalance = await grvtToken.balanceOf(depositor)
		//     assert.isAtMost(getDifference(GRVTBalance, expectedGRVTGain_M3), 1e15)
		//   }

		//   // Check G, H only earn issuance from month 4.  Error tolerance = 1e-3 tokens
		//   for (depositor of [G, H]) {
		//     const GRVTBalance = await grvtToken.balanceOf(depositor)
		//     assert.isAtMost(getDifference(GRVTBalance, expectedGRVTGain_M4), 1e15)
		//   }

		//   const finalEpoch = (await stabilityPool.currentEpoch()).toString()
		//   assert.equal(finalEpoch, 4)

		//   const finalEpochERC20 = (await stabilityPoolERC20.currentEpoch()).toString()
		//   assert.equal(finalEpochERC20, 4)
		// })

		// it('GRVT issuance for a given period is not obtainable if the SP was empty during the period', async () => {
		//   const CIBalanceBefore = await grvtToken.balanceOf(communityIssuanceTester.address)

		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(16000, 18), A, A, { from: A, value: dec(200, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(10000, 18), B, B, { from: B, value: dec(100, 'ether') })
		//   await borrowerOperations.openVessel(ZERO_ADDRESS, 0, th._100pct, dec(16000, 18), C, C, { from: C, value: dec(200, 'ether') })

		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(16000, 18), A, A, { from: A })
		//   await borrowerOperations.openVessel(erc20.address, dec(100, 'ether'), th._100pct, dec(10000, 18), B, B, { from: B })
		//   await borrowerOperations.openVessel(erc20.address, dec(200, 'ether'), th._100pct, dec(16000, 18), C, C, { from: C })

		//   const totalGRVTissuance_0 = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   const G_0 = await stabilityPool.epochToScaleToG(0, 0)  // epochs and scales will not change in this test: no liquidations
		//   assert.equal(totalGRVTissuance_0, '0')
		//   assert.equal(G_0, '0')

		//   const totalGRVTissuance_0ERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   const G_0ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)  // epochs and scales will not change in this test: no liquidations
		//   assert.equal(totalGRVTissuance_0ERC20, '0')
		//   assert.equal(G_0ERC20, '0')

		//   // 1 month passes (M1)
		//   await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_MONTH), web3.currentProvider)

		//   // GRVT issuance event triggered: A deposits
		//   await stabilityPool.provideToSP(dec(10000, 18), { from: A })
		//   await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })

		//   // Check G is not updated, since SP was empty prior to A's deposit
		//   const G_1 = await stabilityPool.epochToScaleToG(0, 0)
		//   assert.isTrue(G_1.eq(G_0))

		//   const G_1ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)
		//   assert.isTrue(G_1ERC20.eq(G_0ERC20))

		//   // Check total GRVT issued is updated
		//   const totalGRVTissuance_1 = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.isTrue(totalGRVTissuance_1.gt(totalGRVTissuance_0))

		//   const totalGRVTissuance_1ERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.isTrue(totalGRVTissuance_1ERC20.gt(totalGRVTissuance_0ERC20))

		//   // 1 month passes (M2)
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

		//   //GRVT issuance event triggered: A withdraws.
		//   await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
		//   await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: A })

		//   // Check G is updated, since SP was not empty prior to A's withdrawal
		//   const G_2 = await stabilityPool.epochToScaleToG(0, 0)
		//   assert.isTrue(G_2.gt(G_1))

		//   const G_2ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)
		//   assert.isTrue(G_2ERC20.gt(G_1ERC20))

		//   // Check total GRVT issued is updated
		//   const totalGRVTissuance_2 = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.isTrue(totalGRVTissuance_2.gt(totalGRVTissuance_1))

		//   const totalGRVTissuance_2ERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.isTrue(totalGRVTissuance_2ERC20.gt(totalGRVTissuance_1ERC20))

		//   // 1 month passes (M3)
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

		//   // GRVT issuance event triggered: C deposits
		//   await stabilityPool.provideToSP(dec(10000, 18), { from: C })
		//   await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: C })

		//   // Check G is not updated, since SP was empty prior to C's deposit
		//   const G_3 = await stabilityPool.epochToScaleToG(0, 0)
		//   assert.isTrue(G_3.eq(G_2))

		//   const G_3ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)
		//   assert.isTrue(G_3ERC20.eq(G_2ERC20))

		//   // Check total GRVT issued is updated
		//   const totalGRVTissuance_3 = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.isTrue(totalGRVTissuance_3.gt(totalGRVTissuance_2))

		//   const totalGRVTissuance_3ERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.isTrue(totalGRVTissuance_3ERC20.gt(totalGRVTissuance_2ERC20))

		//   // 1 month passes (M4)
		//   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

		//   // C withdraws
		//   await stabilityPool.withdrawFromSP(dec(10000, 18), { from: C })
		//   await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: C })

		//   // Check G is increased, since SP was not empty prior to C's withdrawal
		//   const G_4 = await stabilityPool.epochToScaleToG(0, 0)
		//   assert.isTrue(G_4.gt(G_3))

		//   const G_4ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)
		//   assert.isTrue(G_4ERC20.gt(G_3ERC20))

		//   // Check total GRVT issued is increased
		//   const totalGRVTissuance_4 = await communityIssuanceTester.totalGRVTIssued(stabilityPool.address)
		//   assert.isTrue(totalGRVTissuance_4.gt(totalGRVTissuance_3))

		//   const totalGRVTissuance_4ERC20 = await communityIssuanceTester.totalGRVTIssued(stabilityPoolERC20.address)
		//   assert.isTrue(totalGRVTissuance_4ERC20.gt(totalGRVTissuance_3ERC20))

		//   // Get GRVT Gains
		//   const A_GRVTGain = await grvtToken.balanceOf(A)
		//   const C_GRVTGain = await grvtToken.balanceOf(C)

		//   // Check A earns gains from M2 only
		//   assert.isAtMost(getDifference(A_GRVTGain, issuance_M2.mul(toBN(2))), 1e15)

		//   // Check C earns gains from M4 only
		//   assert.isAtMost(getDifference(C_GRVTGain, issuance_M4.mul(toBN(2))), 1e15)

		//   // Check totalGRVTIssued = M1 + M2 + M3 + M4.  1e-3 error tolerance.
		//   const expectedIssuance4Months = issuance_M1.add(issuance_M2).add(issuance_M3).add(issuance_M4)
		//   assert.isAtMost(getDifference(expectedIssuance4Months, totalGRVTissuance_4), 1e15)

		//   // Check CI has only transferred out tokens for M2 + M4.  1e-3 error tolerance.
		//   const expectedGRVTSentOutFromCI = issuance_M2.add(issuance_M4)
		//   const CIBalanceAfter = await grvtToken.balanceOf(communityIssuanceTester.address)
		//   const CIBalanceDifference = CIBalanceBefore.sub(CIBalanceAfter)
		//   assert.isAtMost(getDifference(CIBalanceDifference, expectedGRVTSentOutFromCI.mul(toBN(2))), 1e15)
		// })

		// --- Scale factor changes ---

		/* Serial scale changes

    A make deposit 10k VUSD
    1 month passes. L1 decreases P: P = 1e-5 P. L1:   9999.9 VUSD, 100 ETH
    B makes deposit 9999.9
    1 month passes. L2 decreases P: P =  1e-5 P. L2:  9999.9 VUSD, 100 ETH
    C makes deposit  9999.9
    1 month passes. L3 decreases P: P = 1e-5 P. L3:  9999.9 VUSD, 100 ETH
    D makes deposit  9999.9
    1 month passes. L4 decreases P: P = 1e-5 P. L4:  9999.9 VUSD, 100 ETH
    E makes deposit  9999.9
    1 month passes. L5 decreases P: P = 1e-5 P. L5:  9999.9 VUSD, 100 ETH
    =========
    F makes deposit 100
    1 month passes. L6 empties the Pool. L6:  10000 VUSD, 100 ETH

    expect A, B, C, D each withdraw ~1 month's worth of GRVT */
		it("withdrawFromSP(): Several deposits of 100 VUSD span one scale factor change. Depositors withdraw correct GRVT gains", async () => {
			// Whale opens Vessel with 100 ETH
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				whale,
				whale,
				{ from: whale, value: dec(100, "ether") }
			)

			const fiveDefaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5]

			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: A, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: B, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: C, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: D, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: E, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: F, value: dec(10000, "ether") }
			)

			for (const defaulter of fiveDefaulters) {
				// Defaulters 1-5 each withdraw to 9999.9 debt (including gas comp)
				await borrowerOperations.openVessel(
					ZERO_ADDRESS,
					0,
					th._100pct,
					await getOpenVesselVUSDAmount("9999900000000000000000"),
					defaulter,
					defaulter,
					{ from: defaulter, value: dec(100, "ether") }
				)
			}

			// Defaulter 6 withdraws to 10k debt (inc. gas comp)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_6,
				defaulter_6,
				{ from: defaulter_6, value: dec(100, "ether") }
			)

			// Confirm all depositors have 0 GRVT
			for (const depositor of [A, B, C, D, E, F]) {
				assert.equal(await grvtToken.balanceOf(depositor), "0")
			}
			// price drops by 50%
			await priceFeed.setPrice(dec(100, 18))

			// Check scale is 0
			// assert.equal(await stabilityPool.currentScale(), '0')

			// A provides to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: A })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 1 liquidated.  Value of P updated to  to 1e-5
			const txL1 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_1))
			assert.isTrue(txL1.receipt.status)

			// Check scale is 0
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPool.P(), dec(1, 13)) //P decreases: P = 1e(18-5) = 1e13

			// B provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: B })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 2 liquidated
			const txL2 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_2))
			assert.isTrue(txL2.receipt.status)

			// Check scale is 1
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 17)) //Scale changes and P changes: P = 1e(13-5+9) = 1e17

			// C provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: C })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 3 liquidated
			const txL3 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_3, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_3))
			assert.isTrue(txL3.receipt.status)

			// Check scale is 1
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 12)) //P decreases: P 1e(17-5) = 1e12

			// D provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: D })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 4 liquidated
			const txL4 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_4, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_4))
			assert.isTrue(txL4.receipt.status)

			// Check scale is 2
			assert.equal(await stabilityPool.currentScale(), "2")
			assert.equal(await stabilityPool.P(), dec(1, 16)) //Scale changes and P changes:: P = 1e(12-5+9) = 1e16

			// E provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: E })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 5 liquidated
			const txL5 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_5, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_5))
			assert.isTrue(txL5.receipt.status)

			// Check scale is 2
			assert.equal(await stabilityPool.currentScale(), "2")
			assert.equal(await stabilityPool.P(), dec(1, 11)) // P decreases: P = 1e(16-5) = 1e11

			// F provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: F })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			assert.equal(await stabilityPool.currentEpoch(), "0")

			// Defaulter 6 liquidated
			const txL6 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_6, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_6))
			assert.isTrue(txL6.receipt.status)

			// Check scale is 0, epoch is 1
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPool.currentEpoch(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 18)) // P resets to 1e18 after pool-emptying

			// price doubles
			await priceFeed.setPrice(dec(200, 18))

			/* All depositors withdraw fully from SP.  Withdraw in reverse order, so that the largest remaining
      deposit (F) withdraws first, and does not get extra GRVT gains from the periods between withdrawals */
			for (depositor of [F, E, D, C, B, A]) {
				await stabilityPool.withdrawFromSP(dec(10000, 18), { from: depositor })
			}

			const GRVTGain_A = await grvtToken.balanceOf(A)
			const GRVTGain_B = await grvtToken.balanceOf(B)
			const GRVTGain_C = await grvtToken.balanceOf(C)
			const GRVTGain_D = await grvtToken.balanceOf(D)
			const GRVTGain_E = await grvtToken.balanceOf(E)
			const GRVTGain_F = await grvtToken.balanceOf(F)

			//The timespam in a blockchain is a little bit different, which is why we are allowing 20 tokens of difference for the tests
			//This won't be an issue on the mainnet
			const expectedGain = issuance_M1 // using M1 assurance since technically this is splitted between 6 personnes, so 6M / 6 = 1M

			assert.isAtMost(getDifference(expectedGain, GRVTGain_A), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_B), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_C), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_D), 20e18)

			assert.isAtMost(getDifference(expectedGain, GRVTGain_E), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_F), 20e18)
		})

		//COPY PASTE FROM THE LAST TO TEST ONE THING, IM IN A RUSH< PLEASE DONT JUDGE
		it("withdrawFromSP(): Several deposits of 100 VUSD span one scale factor change. Depositors withdraw correct GRVT gains and set distributrion at zero", async () => {
			// Whale opens Vessel with 100 ETH
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				whale,
				whale,
				{ from: whale, value: dec(100, "ether") }
			)

			const fiveDefaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5]

			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: A, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: B, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: C, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: D, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: E, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: F, value: dec(10000, "ether") }
			)

			for (const defaulter of fiveDefaulters) {
				// Defaulters 1-5 each withdraw to 9999.9 debt (including gas comp)
				await borrowerOperations.openVessel(
					ZERO_ADDRESS,
					0,
					th._100pct,
					await getOpenVesselVUSDAmount("9999900000000000000000"),
					defaulter,
					defaulter,
					{ from: defaulter, value: dec(100, "ether") }
				)
			}

			// Defaulter 6 withdraws to 10k debt (inc. gas comp)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_6,
				defaulter_6,
				{ from: defaulter_6, value: dec(100, "ether") }
			)

			// Confirm all depositors have 0 GRVT
			for (const depositor of [A, B, C, D, E, F]) {
				assert.equal(await grvtToken.balanceOf(depositor), "0")
			}
			// price drops by 50%
			await priceFeed.setPrice(dec(100, 18))

			// Check scale is 0
			// assert.equal(await stabilityPool.currentScale(), '0')

			// A provides to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: A })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 1 liquidated.  Value of P updated to  to 1e-5
			const txL1 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_1))
			assert.isTrue(txL1.receipt.status)

			// Check scale is 0
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPool.P(), dec(1, 13)) //P decreases: P = 1e(18-5) = 1e13

			// B provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: B })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 2 liquidated
			const txL2 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_2))
			assert.isTrue(txL2.receipt.status)

			// Check scale is 1
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 17)) //Scale changes and P changes: P = 1e(13-5+9) = 1e17

			// C provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: C })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 3 liquidated
			const txL3 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_3, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_3))
			assert.isTrue(txL3.receipt.status)

			// Check scale is 1
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 12)) //P decreases: P 1e(17-5) = 1e12

			// D provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: D })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 4 liquidated
			const txL4 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_4, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_4))
			assert.isTrue(txL4.receipt.status)

			// Check scale is 2
			assert.equal(await stabilityPool.currentScale(), "2")
			assert.equal(await stabilityPool.P(), dec(1, 16)) //Scale changes and P changes:: P = 1e(12-5+9) = 1e16

			// E provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: E })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 5 liquidated
			const txL5 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_5, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_5))
			assert.isTrue(txL5.receipt.status)

			// Check scale is 2
			assert.equal(await stabilityPool.currentScale(), "2")
			assert.equal(await stabilityPool.P(), dec(1, 11)) // P decreases: P = 1e(16-5) = 1e11

			// F provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: F })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			assert.equal(await stabilityPool.currentEpoch(), "0")

			// Defaulter 6 liquidated
			const txL6 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_6, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_6))
			assert.isTrue(txL6.receipt.status)

			// Check scale is 0, epoch is 1
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPool.currentEpoch(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 18)) // P resets to 1e18 after pool-emptying

			// price doubles
			await priceFeed.setPrice(dec(200, 18))

			/* All depositors withdraw fully from SP.  Withdraw in reverse order, so that the largest remaining
      deposit (F) withdraws first, and does not get extra GRVT gains from the periods between withdrawals */
			for (depositor of [F, E, D]) {
				await stabilityPool.withdrawFromSP(dec(10000, 18), { from: depositor })
			}

			//SET Distribution to zero,
			await communityIssuanceTester.setWeeklyGrvtDistribution(stabilityPool.address, 0)

			for (depositor of [C, B, A]) {
				await stabilityPool.withdrawFromSP(dec(10000, 18), { from: depositor })
			}

			const GRVTGain_A = await grvtToken.balanceOf(A)
			const GRVTGain_B = await grvtToken.balanceOf(B)
			const GRVTGain_C = await grvtToken.balanceOf(C)
			const GRVTGain_D = await grvtToken.balanceOf(D)
			const GRVTGain_E = await grvtToken.balanceOf(E)
			const GRVTGain_F = await grvtToken.balanceOf(F)

			//The timespam in a blockchain is a little bit different, which is why we are allowing 20 tokens of difference for the tests
			//This won't be an issue on the mainnet
			const expectedGain = issuance_M1 // using M1 assurance since technically this is splitted between 6 personnes, so 6M / 6 = 1M

			assert.isAtMost(getDifference(expectedGain, GRVTGain_A), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_B), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_C), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_D), 20e18)

			assert.isAtMost(getDifference(expectedGain, GRVTGain_E), 20e18)
			assert.isAtMost(getDifference(expectedGain, GRVTGain_F), 20e18)
		})

		it("withdrawFromSP(): Play with settings", async () => {
			// Whale opens Vessel with 100 ETH
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				whale,
				whale,
				{ from: whale, value: dec(100, "ether") }
			)

			const fiveDefaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5]

			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: A, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: B, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: C, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: D, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: E, value: dec(10000, "ether") }
			)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				dec(10000, 18),
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: F, value: dec(10000, "ether") }
			)

			for (const defaulter of fiveDefaulters) {
				// Defaulters 1-5 each withdraw to 9999.9 debt (including gas comp)
				await borrowerOperations.openVessel(
					ZERO_ADDRESS,
					0,
					th._100pct,
					await getOpenVesselVUSDAmount("9999900000000000000000"),
					defaulter,
					defaulter,
					{ from: defaulter, value: dec(100, "ether") }
				)
			}

			// Defaulter 6 withdraws to 10k debt (inc. gas comp)
			await borrowerOperations.openVessel(
				ZERO_ADDRESS,
				0,
				th._100pct,
				await getOpenVesselVUSDAmount(dec(10000, 18)),
				defaulter_6,
				defaulter_6,
				{ from: defaulter_6, value: dec(100, "ether") }
			)

			// Confirm all depositors have 0 GRVT
			for (const depositor of [A, B, C, D, E, F]) {
				assert.equal(await grvtToken.balanceOf(depositor), "0")
			}
			// price drops by 50%
			await priceFeed.setPrice(dec(100, 18))

			// Check scale is 0
			// assert.equal(await stabilityPool.currentScale(), '0')

			// A provides to SP
			await stabilityPool.provideToSP(dec(10000, 18), { from: A })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 1 liquidated.  Value of P updated to  to 1e-5
			const txL1 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_1))
			assert.isTrue(txL1.receipt.status)

			// Check scale is 0
			assert.equal(await stabilityPool.currentScale(), "0")
			assert.equal(await stabilityPool.P(), dec(1, 13)) //P decreases: P = 1e(18-5) = 1e13

			// B provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: B })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 2 liquidated
			const txL2 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_2))
			assert.isTrue(txL2.receipt.status)

			// Check scale is 1
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 17)) //Scale changes and P changes: P = 1e(13-5+9) = 1e17

			// C provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: C })
			await communityIssuanceTester.setWeeklyGrvtDistribution(stabilityPool.address, 0)

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

			// Defaulter 3 liquidated
			const txL3 = await vesselManager.liquidate(ZERO_ADDRESS, defaulter_3, { from: owner })
			assert.isFalse(await sortedVessels.contains(ZERO_ADDRESS, defaulter_3))
			assert.isTrue(txL3.receipt.status)

			// Check scale is 1
			assert.equal(await stabilityPool.currentScale(), "1")
			assert.equal(await stabilityPool.P(), dec(1, 12)) //P decreases: P 1e(17-5) = 1e12

			// D provides to SP
			await stabilityPool.provideToSP(dec(99999, 17), { from: D })

			// 1 month passes
			await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)
		})
	})
})

contract("Reset chain state", async accounts => {})

