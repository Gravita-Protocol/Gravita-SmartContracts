const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const { dec, toBN } = th
const mv = testHelpers.MoneyValues

var contracts
var snapshotId
var initialSnapshotId

const openVessel = async params => th.openVessel(contracts.core, params)
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
}

contract("Gas compensation tests", async accounts => {
	const [liquidator, alice, bob, carol, dennis, erin, flyn, harriet, whale, treasury] = accounts

	const logICRs = ICRList => {
		for (let i = 0; i < ICRList.length; i++) {
			console.log(`account: ${i + 1} ICR: ${ICRList[i].toString()}`)
		}
	}

	before(async () => {
		await deploy(treasury, accounts.slice(0, 25))
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

	// --- Raw gas compensation calculations ---

	it("getCollGasCompensation(): returns the 0.5% of collaterall if it is < $10 in value", async () => {
		/* 
    ETH:USD price = 1
    coll = 1 ETH: $1 in value
    -> Expect 0.5% of collaterall as gas compensation */
		await priceFeed.setPrice(erc20.address, dec(1, 18))
		// const price_1 = await priceFeed.getPrice(erc20.address)

		assert.equal((await vesselManager.getCollGasCompensation(erc20.address, dec(1, "ether"))).toString(), dec(5, 15))

		/* 
    ETH:USD price = 28.4
    coll = 0.1 ETH: $2.84 in value
    -> Expect 0.5% of collaterall as gas compensation */
		await priceFeed.setPrice(erc20.address, "28400000000000000000")
		// const price_2 = await priceFeed.getPrice(erc20.address)
		assert.equal((await vesselManager.getCollGasCompensation(erc20.address, dec(100, "finney"))).toString(), dec(5, 14))

		/* 
    ETH:USD price = 1000000000 (1 billion)
    coll = 0.000000005 ETH (5e9 wei): $5 in value 
    -> Expect 0.5% of collaterall as gas compensation */
		await priceFeed.setPrice(erc20.address, dec(1, 27))
		// const price_3 = await priceFeed.getPrice(erc20.address)
		assert.equal((await vesselManager.getCollGasCompensation(erc20.address, "5000000000")).toString(), "25000000")
	})

	it("getCollGasCompensation(): returns 0.5% of collaterall when 0.5% of collateral < $10 in value", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		assert.equal(price, dec(200, 18))

		/* 
    ETH:USD price = 200
    coll = 9.999 ETH  
    0.5% of coll = 0.04995 ETH. USD value: $9.99
    -> Expect 0.5% of collaterall as gas compensation */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, "9999000000000000000")).toString(),
			"49995000000000000"
		)

		/* ETH:USD price = 200
     coll = 0.055 ETH  
     0.5% of coll = 0.000275 ETH. USD value: $0.055
     -> Expect 0.5% of collaterall as gas compensation */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, "55000000000000000")).toString(),
			dec(275, 12)
		)

		/* ETH:USD price = 200
    coll = 6.09232408808723580 ETH  
    0.5% of coll = 0.004995 ETH. USD value: $6.09
    -> Expect 0.5% of collaterall as gas compensation */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, "6092324088087235800")).toString(),
			"30461620440436179"
		)
	})

	it("getCollGasCompensation(): returns 0.5% of collaterall when 0.5% of collateral = $10 in value", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		assert.equal(price, dec(200, 18))

		/* 
    ETH:USD price = 200
    coll = 10 ETH  
    0.5% of coll = 0.5 ETH. USD value: $10
    -> Expect 0.5% of collaterall as gas compensation */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, dec(10, "ether"))).toString(),
			"50000000000000000"
		)
	})

	it("getCollGasCompensation(): returns 0.5% of collaterall when 0.5% of collateral = $10 in value", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		assert.equal(price, dec(200, 18))

		/* 
    ETH:USD price = 200 $/E
    coll = 100 ETH  
    0.5% of coll = 0.5 ETH. USD value: $100
    -> Expect $100 gas compensation, i.e. 0.5 ETH */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, dec(100, "ether"))).toString(),
			dec(500, "finney")
		)

		/* 
    ETH:USD price = 200 $/E
    coll = 10.001 ETH  
    0.5% of coll = 0.050005 ETH. USD value: $10.001
    -> Expect $100 gas compensation, i.e.  0.050005  ETH */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, "10001000000000000000")).toString(),
			"50005000000000000"
		)

		/* 
    ETH:USD price = 200 $/E
    coll = 37.5 ETH  
    0.5% of coll = 0.1875 ETH. USD value: $37.5
    -> Expect $37.5 gas compensation i.e.  0.1875  ETH */
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, "37500000000000000000")).toString(),
			"187500000000000000"
		)

		/* 
    ETH:USD price = 45323.54542 $/E
    coll = 94758.230582309850 ETH  
    0.5% of coll = 473.7911529 ETH. USD value: $21473894.84
    -> Expect $21473894.8385808 gas compensation, i.e.  473.7911529115490  ETH */
		await priceFeed.setPrice(erc20.address, "45323545420000000000000")
		assert.isAtMost(
			th.getDifference(
				await vesselManager.getCollGasCompensation(erc20.address, "94758230582309850000000"),
				"473791152911549000000"
			),
			1000000
		)

		/* 
    ETH:USD price = 1000000 $/E (1 million)
    coll = 300000000 ETH   (300 million)
    0.5% of coll = 1500000 ETH. USD value: $150000000000
    -> Expect $150000000000 gas compensation, i.e. 1500000 ETH */
		await priceFeed.setPrice(erc20.address, dec(1, 24))
		assert.equal(
			(await vesselManager.getCollGasCompensation(erc20.address, "300000000000000000000000000")).toString(),
			"1500000000000000000000000"
		)
	})

	// --- Composite debt calculations ---

	// gets debt + 50 when 0.5% of coll < $10
	it("_getCompositeDebt(): returns (debt + 50) when collateral < $10 in value", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		assert.equal(price, dec(200, 18))

		/* 
    ETH:USD price = 200
    coll = 9.999 ETH 
    debt = 10 VUSD
    0.5% of coll = 0.04995 ETH. USD value: $9.99
    -> Expect composite debt = 10 + 200  = 2100 VUSD*/
		assert.equal(await vesselManager.getCompositeDebt(erc20.address, dec(10, 18)), dec(210, 18))

		/* ETH:USD price = 200
     coll = 0.055 ETH  
     debt = 0 VUSD
     0.5% of coll = 0.000275 ETH. USD value: $0.055
     -> Expect composite debt = 0 + 200 = 200 VUSD*/
		assert.equal(await vesselManager.getCompositeDebt(erc20.address, 0), dec(200, 18))

		// /* ETH:USD price = 200
		// coll = 6.09232408808723580 ETH
		// debt = 200 VUSD
		// 0.5% of coll = 0.004995 ETH. USD value: $6.09
		// -> Expect  composite debt =  200 + 200 = 400  VUSD */
		assert.equal(await vesselManager.getCompositeDebt(erc20.address, dec(200, 18)), "400000000000000000000")
	})

	// returns $10 worth of ETH when 0.5% of coll == $10
	it("getCompositeDebt(): returns (debt + 50) collateral = $10 in value", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		assert.equal(price, dec(200, 18))

		/* 
    ETH:USD price = 200
    coll = 10 ETH  
    debt = 123.45 VUSD
    0.5% of coll = 0.5 ETH. USD value: $10
    -> Expect composite debt = (123.45 + 200) = 323.45 VUSD  */
		assert.equal(await vesselManager.getCompositeDebt(erc20.address, "123450000000000000000"), "323450000000000000000")
	})

	/// ***

	// gets debt + 50 when 0.5% of coll > 10
	it("getCompositeDebt(): returns (debt + 50) when 0.5% of collateral > $10 in value", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		assert.equal(price, dec(200, 18))

		/* 
    ETH:USD price = 200 $/E
    coll = 100 ETH  
    debt = 2000 VUSD
    -> Expect composite debt = (2000 + 200) = 2200 VUSD  */
		assert.equal(
			(await vesselManager.getCompositeDebt(erc20.address, dec(2000, 18))).toString(),
			"2200000000000000000000"
		)

		/* 
    ETH:USD price = 200 $/E
    coll = 10.001 ETH  
    debt = 200 VUSD
    -> Expect composite debt = (200 + 200) = 400 VUSD  */
		assert.equal(
			(await vesselManager.getCompositeDebt(erc20.address, dec(200, 18))).toString(),
			"400000000000000000000"
		)

		/* 
    ETH:USD price = 200 $/E
    coll = 37.5 ETH  
    debt = 500 VUSD
    -> Expect composite debt = (500 + 200) = 700 VUSD  */
		assert.equal(
			(await vesselManager.getCompositeDebt(erc20.address, dec(500, 18))).toString(),
			"700000000000000000000"
		)

		/* 
    ETH:USD price = 45323.54542 $/E
    coll = 94758.230582309850 ETH  
    debt = 1 billion VUSD
    -> Expect composite debt = (1000000000 + 200) = 1000000200 VUSD  */
		await priceFeed.setPrice(erc20.address, "45323545420000000000000")
		assert.isAtMost(
			th.getDifference(
				(await vesselManager.getCompositeDebt(erc20.address, dec(1, 27))).toString(),
				"1000000200000000000000000000"
			),
			100000000000
		)

		/* 
    ETH:USD price = 1000000 $/E (1 million)
    coll = 300000000 ETH   (300 million)
    debt = 54321.123456789 VUSD
   -> Expect composite debt = (54321.123456789 + 200) = 54521.123456789 VUSD */
		await priceFeed.setPrice(erc20.address, dec(1, 24))
		assert.equal(
			(await vesselManager.getCompositeDebt(erc20.address, "54321123456789000000000")).toString(),
			"54521123456789000000000"
		)
	})

	// --- Test ICRs with virtual debt ---
	it("getCurrentICR(): Incorporates virtual debt, and returns the correct ICR for new vessels", async () => {
		const price = await priceFeed.getPrice(erc20.address)
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 18)),
			extraParams: { from: whale },
		})

		// A opens with 1 ETH, 110 VUSD
		await openVessel({
			asset: erc20.address,
			ICR: toBN("1818181818181818181"),
			extraParams: { from: alice },
		})
		const alice_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, alice, price)).toString()
		// Expect aliceICR = (1 * 200) / (110) = 181.81%
		assert.isAtMost(th.getDifference(alice_ICRERC20, "1818181818181818181"), 1000)

		// B opens with 0.5 ETH, 50 VUSD
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraParams: { from: bob },
		})
		const bob_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, bob, price)).toString()
		// Expect Bob's ICR = (0.5 * 200) / 50 = 200%
		assert.isAtMost(th.getDifference(bob_ICRERC20, dec(2, 18)), 1000)

		// F opens with 1 ETH, 100 VUSD

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: flyn },
		})
		const flyn_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, flyn, price)).toString()
		// Expect Flyn's ICR = (1 * 200) / 100 = 200%
		assert.isAtMost(th.getDifference(flyn_ICRERC20, dec(2, 18)), 1000)

		// C opens with 2.5 ETH, 160 VUSD
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(3125, 15)),
			extraParams: { from: carol },
		})
		const carol_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, carol, price)).toString()
		// Expect Carol's ICR = (2.5 * 200) / (160) = 312.50%
		assert.isAtMost(th.getDifference(carol_ICRERC20, "3125000000000000000"), 1000)

		// D opens with 1 ETH, 0 VUSD
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(4, 18)),
			extraParams: { from: dennis },
		})
		const dennis_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, dennis, price)).toString()
		// Expect Dennis's ICR = (1 * 200) / (50) = 400.00%
		assert.isAtMost(th.getDifference(dennis_ICRERC20, dec(4, 18)), 1000)

		// E opens with 4405.45 ETH, 32598.35 VUSD
		await openVessel({
			asset: erc20.address,
			ICR: toBN("27028668628933700000"),
			extraParams: { from: erin },
		})
		const erin_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, erin, price)).toString()
		// Expect Erin's ICR = (4405.45 * 200) / (32598.35) = 2702.87%
		assert.isAtMost(th.getDifference(erin_ICRERC20, "27028668628933700000"), 100000)

		// H opens with 1 ETH, 180 VUSD
		await openVessel({
			asset: erc20.address,
			ICR: toBN("1111111111111111111"),
			extraParams: { from: harriet },
		})
		const harriet_ICRERC20 = (await vesselManager.getCurrentICR(erc20.address, harriet, price)).toString()
		// Expect Harriet's ICR = (1 * 200) / (180) = 111.11%
		assert.isAtMost(th.getDifference(harriet_ICRERC20, "1111111111111111111"), 1000)
	})

	// Test compensation amounts and liquidation amounts

	it("gas compensation from pool-offset liquidations. All collateral paid as compensation", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		const { totalDebt: A_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(200, 18),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(300, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: A_totalDebtERC20,
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: B_totalDebtERC20.add(C_totalDebtERC20),
			extraParams: { from: erin },
		})

		// console.log(((await community.GRVTSupplyCap()).toString()))

		// D, E each provide VUSD to SP

		await stabilityPool.provideToSP(A_totalDebtERC20, { from: dennis })
		await stabilityPool.provideToSP(B_totalDebtERC20.add(C_totalDebtERC20), {
			from: erin,
		})

		const VUSDinSP_0ERC20 = await stabilityPool.getTotalDebtTokenDeposits()

		// --- Price drops to 9.99 ---
		await priceFeed.setPrice(erc20.address, "9990000000000000000")

		/* 
    ETH:USD price = 9.99
    -> Expect 0.5% of collaterall to be sent to liquidator, as gas compensation */

		// Check collateral value in USD is < $10
		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Liquidate A (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_AERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, alice, { from: liquidator })
		const liquidatorBalance_after_AERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by 0.5% of A's coll (1 ETH)

		const compensationReceived_AERC20 = liquidatorBalance_after_AERC20.sub(liquidatorBalance_before_AERC20).toString()
		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))
		assert.equal(compensationReceived_AERC20, _0pt5percent_aliceCollERC20)

		// Check SP VUSD has decreased due to the liquidation
		const VUSDinSP_AERC20 = await stabilityPool.getTotalDebtTokenDeposits()
		assert.isTrue(VUSDinSP_AERC20.lte(VUSDinSP_0ERC20))

		// Check ETH in SP has received the liquidation
		assert.equal(
			(await stabilityPool.getCollateral(erc20.address)).toString(),
			aliceCollERC20.sub(_0pt5percent_aliceCollERC20)
		) // 1 ETH - 0.5%

		// --- Price drops to 3 ---
		await priceFeed.setPrice(erc20.address, dec(3, 18))

		/* 
    ETH:USD price = 3
    -> Expect 0.5% of collaterall to be sent to liquidator, as gas compensation */

		// Check collateral value in USD is < $10
		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_BERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: liquidator })
		const liquidatorBalance_after_BERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by B's 0.5% of coll, 2 ETH

		const compensationReceived_BERC20 = liquidatorBalance_after_BERC20.sub(liquidatorBalance_before_BERC20).toString()
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		assert.equal(compensationReceived_BERC20, _0pt5percent_bobCollERC20) // 0.5% of 2 ETH

		// Check SP VUSD has decreased due to the liquidation of B
		const VUSDinSP_BERC20 = await stabilityPool.getTotalDebtTokenDeposits()

		assert.isTrue(VUSDinSP_BERC20.lt(VUSDinSP_AERC20))

		// Check ETH in SP has received the liquidation
		assert.equal(
			(await stabilityPool.getCollateral(erc20.address)).toString(),
			aliceCollERC20.sub(_0pt5percent_aliceCollERC20).add(bobCollERC20).sub(_0pt5percent_bobCollERC20)
		) // (1 + 2 ETH) * 0.995

		// --- Price drops to 3 ---
		await priceFeed.setPrice(erc20.address, "3141592653589793238")

		/* 
    ETH:USD price = 3.141592653589793238
    Carol coll = 3 ETH. Value = (3 * 3.141592653589793238) = $6
    -> Expect 0.5% of collaterall to be sent to liquidator, as gas compensation */

		// Check collateral value in USD is < $10
		const carolCollERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_CERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, carol, { from: liquidator })
		const liquidatorBalance_after_CERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by C's 0.5% of coll, 3 ETH

		const compensationReceived_CERC20 = liquidatorBalance_after_CERC20.sub(liquidatorBalance_before_CERC20).toString()
		const _0pt5percent_carolCollERC20 = carolCollERC20.div(web3.utils.toBN("200"))
		assert.equal(compensationReceived_CERC20, _0pt5percent_carolCollERC20)

		// Check SP VUSD has decreased due to the liquidation of C
		assert.isTrue((await stabilityPool.getTotalDebtTokenDeposits()).lt(VUSDinSP_BERC20))

		// Check ETH in SP has not changed due to the lquidation of C
		const ETHinSP_CERC20 = await stabilityPool.getCollateral(erc20.address)
		assert.equal(
			ETHinSP_CERC20.toString(),
			aliceCollERC20
				.sub(_0pt5percent_aliceCollERC20)
				.add(bobCollERC20)
				.sub(_0pt5percent_bobCollERC20)
				.add(carolCollERC20)
				.sub(_0pt5percent_carolCollERC20)
		) // (1+2+3 ETH) * 0.995
	})

	it("gas compensation from pool-offset liquidations: 0.5% collateral < $10 in value. Compensates $10 worth of collateral, liquidates the remainder", async () => {
		await priceFeed.setPrice(erc20.address, dec(400, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(200, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(120, 16)),
			extraVUSDAmount: dec(5000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(60, 18)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(80, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(80, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})

		// D, E each provide 10000 VUSD to SP

		await stabilityPool.provideToSP(dec(1, 23), { from: dennis })
		await stabilityPool.provideToSP(dec(1, 23), { from: erin })

		const VUSDinSP_0ERC20 = await stabilityPool.getTotalDebtTokenDeposits()
		const ETHinSP_0ERC20 = await stabilityPool.getCollateral(erc20.address)

		// --- Price drops to 199.999 ---
		await priceFeed.setPrice(erc20.address, "199999000000000000000")
		const price_1 = await priceFeed.getPrice(erc20.address)

		/* 
    ETH:USD price = 199.999
    Alice coll = 1 ETH. Value: $199.999
    0.5% of coll  = 0.05 ETH. Value: (0.05 * 199.999) = $9.99995
    Minimum comp = $10 = 0.05000025000125001 ETH.
    -> Expect 0.05000025000125001 ETH sent to liquidator, 
    and (1 - 0.05000025000125001) = 0.94999974999875 ETH remainder liquidated */

		// Check collateral value in USD is > $10
		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price_1)).lt(mv._MCR))

		// Liquidate A (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_AERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, alice, { from: liquidator })
		const liquidatorBalance_after_AERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by 0.5% of coll

		const compensationReceived_AERC20 = liquidatorBalance_after_AERC20.sub(liquidatorBalance_before_AERC20).toString()
		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))
		assert.equal(compensationReceived_AERC20, _0pt5percent_aliceCollERC20)

		// Check SP VUSD has decreased due to the liquidation of A
		const VUSDinSP_AERC20 = await stabilityPool.getTotalDebtTokenDeposits()
		assert.isTrue(VUSDinSP_AERC20.lte(VUSDinSP_0ERC20))

		// Check ETH in SP has increased by the remainder of B's coll

		const collRemainder_AERC20 = aliceCollERC20.sub(_0pt5percent_aliceCollERC20)
		const ETHinSP_AERC20 = await stabilityPool.getCollateral(erc20.address)

		const SPETHIncrease_AERC20 = ETHinSP_AERC20.sub(ETHinSP_0ERC20)

		assert.isAtMost(th.getDifference(SPETHIncrease_AERC20, collRemainder_AERC20), 1000)

		// --- Price drops to 15 ---
		await priceFeed.setPrice(erc20.address, dec(15, 18))
		const price_2 = await priceFeed.getPrice(erc20.address)

		/* 
    ETH:USD price = 15
    Bob coll = 15 ETH. Value: $165
    0.5% of coll  = 0.75 ETH. Value: (0.75 * 11) = $8.25
    Minimum comp = $10 =  0.66666...ETH.
    -> Expect 0.666666666666666666 ETH sent to liquidator, 
    and (15 - 0.666666666666666666) ETH remainder liquidated */

		// Check collateral value in USD is > $10

		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		const bobICRERC20 = await vesselManager.getCurrentICR(erc20.address, bob, price_2)
		assert.isTrue(bobICRERC20.lte(mv._MCR))

		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_BERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: liquidator })
		const liquidatorBalance_after_BERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by $10 worth of coll

		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		const compensationReceived_BERC20 = liquidatorBalance_after_BERC20.sub(liquidatorBalance_before_BERC20).toString()
		assert.equal(compensationReceived_BERC20, _0pt5percent_bobCollERC20)

		// Check SP VUSD has decreased due to the liquidation of B
		assert.isTrue((await stabilityPool.getTotalDebtTokenDeposits()).lt(VUSDinSP_AERC20))

		// Check ETH in SP has increased by the remainder of B's coll

		const collRemainder_BERC20 = bobCollERC20.sub(_0pt5percent_bobCollERC20)
		const ETHinSP_BERC20 = await stabilityPool.getCollateral(erc20.address)

		const SPETHIncrease_BERC20 = ETHinSP_BERC20.sub(ETHinSP_AERC20)

		assert.isAtMost(th.getDifference(SPETHIncrease_BERC20, collRemainder_BERC20), 1000)
	})

	it("gas compensation from pool-offset liquidations: 0.5% collateral > $10 in value. Compensates 0.5% of  collateral, liquidates the remainder", async () => {
		// open vessels
		await priceFeed.setPrice(erc20.address, dec(400, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(1875, 15)),
			extraVUSDAmount: dec(8000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(4, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(4, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})

		// D, E each provide 10000 VUSD to SP

		await stabilityPool.provideToSP(dec(1, 23), { from: dennis })
		await stabilityPool.provideToSP(dec(1, 23), { from: erin })

		const VUSDinSP_0ERC20 = await stabilityPool.getTotalDebtTokenDeposits()
		const ETHinSP_0ERC20 = await stabilityPool.getCollateral(erc20.address)

		await priceFeed.setPrice(erc20.address, dec(200, 18))
		const price_1 = await priceFeed.getPrice(erc20.address)

		/* 
    ETH:USD price = 200
    Alice coll = 10.001 ETH. Value: $2000.2
    0.5% of coll  = 0.050005 ETH. Value: (0.050005 * 200) = $10.01
    Minimum comp = $10 = 0.05 ETH.
    -> Expect  0.050005 ETH sent to liquidator, 
    and (10.001 - 0.050005) ETH remainder liquidated */

		// Check value of 0.5% of collateral in USD is > $10

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price_1)).lt(mv._MCR))

		// Liquidate A (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_AERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, alice, { from: liquidator })
		const liquidatorBalance_after_AERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by 0.5% of coll

		const compensationReceived_AERC20 = liquidatorBalance_after_AERC20.sub(liquidatorBalance_before_AERC20).toString()
		assert.equal(compensationReceived_AERC20, _0pt5percent_aliceCollERC20)

		// Check SP VUSD has decreased due to the liquidation of A
		const VUSDinSP_AERC20 = await stabilityPool.getTotalDebtTokenDeposits()
		assert.isTrue(VUSDinSP_AERC20.lte(VUSDinSP_0ERC20))

		// Check ETH in SP has increased by the remainder of A's coll

		const collRemainder_AERC20 = aliceCollERC20.sub(_0pt5percent_aliceCollERC20)
		const ETHinSP_AERC20 = await stabilityPool.getCollateral(erc20.address)

		const SPETHIncrease_AERC20 = ETHinSP_AERC20.sub(ETHinSP_0ERC20)

		assert.isAtMost(th.getDifference(SPETHIncrease_AERC20, collRemainder_AERC20), 1000)

		/* 
   ETH:USD price = 200
   Bob coll = 37.5 ETH. Value: $7500
   0.5% of coll  = 0.1875 ETH. Value: (0.1875 * 200) = $37.5
   Minimum comp = $10 = 0.05 ETH.
   -> Expect 0.1875 ETH sent to liquidator, 
   and (37.5 - 0.1875 ETH) ETH remainder liquidated */

		// Check value of 0.5% of collateral in USD is > $10

		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price_1)).lt(mv._MCR))

		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidatorBalance_before_BERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidate(erc20.address, bob, { from: liquidator })
		const liquidatorBalance_after_BERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check liquidator's balance increases by 0.5% of coll

		const compensationReceived_BERC20 = liquidatorBalance_after_BERC20.sub(liquidatorBalance_before_BERC20).toString()
		assert.equal(compensationReceived_BERC20, _0pt5percent_bobCollERC20)

		// Check SP VUSD has decreased due to the liquidation of B
		assert.isTrue((await stabilityPool.getTotalDebtTokenDeposits()).lt(VUSDinSP_AERC20))

		// Check ETH in SP has increased by the remainder of B's coll

		const collRemainder_BERC20 = bobCollERC20.sub(_0pt5percent_bobCollERC20)
		const ETHinSP_BERC20 = await stabilityPool.getCollateral(erc20.address)

		const SPETHIncrease_BERC20 = ETHinSP_BERC20.sub(ETHinSP_AERC20)

		assert.isAtMost(th.getDifference(SPETHIncrease_BERC20, collRemainder_BERC20), 1000)
	})

	// --- Event emission in single liquidation ---

	it("gas compensation from pool-offset liquidations. Liquidation event emits the correct gas compensation and total liquidated coll and debt", async () => {
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		const { totalDebt: A_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(100, 18),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(200, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(300, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: A_totalDebtERC20,
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: B_totalDebtERC20,
			extraParams: { from: erin },
		})

		// D, E each provide VUSD to SP

		await stabilityPool.provideToSP(A_totalDebtERC20, { from: dennis })
		await stabilityPool.provideToSP(B_totalDebtERC20, { from: erin })

		// --- Price drops to 9.99 ---
		await priceFeed.setPrice(erc20.address, "9990000000000000000")

		/* 
    ETH:USD price = 9.99
    -> Expect 0.5% of collaterall to be sent to liquidator, as gas compensation */

		// Check collateral value in USD is < $10

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const aliceDebtERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Liquidate A (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidationTxAERC20 = await vesselManagerOperations.liquidate(erc20.address, alice, {
			from: liquidator,
		})
		const expectedGasComp_AERC20 = aliceCollERC20.mul(th.toBN(5)).div(th.toBN(1000))
		const expectedLiquidatedColl_AERC20 = aliceCollERC20.sub(expectedGasComp_AERC20)
		const expectedLiquidatedDebt_AERC20 = aliceDebtERC20

		const [loggedDebt_AERC20, loggedColl_AERC20, loggedGasComp_AERC20] =
			th.getEmittedLiquidationValues(liquidationTxAERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebt_AERC20, loggedDebt_AERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedColl_AERC20, loggedColl_AERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasComp_AERC20, loggedGasComp_AERC20), 1000)

		// --- Price drops to 3 ---
		await priceFeed.setPrice(erc20.address, dec(3, 18))

		/* 
    ETH:USD price = 3
    -> Expect 0.5% of collaterall to be sent to liquidator, as gas compensation */

		// Check collateral value in USD is < $10

		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobDebtERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))
		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidationTxBERC20 = await vesselManagerOperations.liquidate(erc20.address, bob, {
			from: liquidator,
		})
		const expectedGasComp_BERC20 = bobCollERC20.mul(th.toBN(5)).div(th.toBN(1000))
		const expectedLiquidatedColl_BERC20 = bobCollERC20.sub(expectedGasComp_BERC20)
		const expectedLiquidatedDebt_BERC20 = bobDebtERC20

		const [loggedDebt_BERC20, loggedColl_BERC20, loggedGasComp_BERC20] =
			th.getEmittedLiquidationValues(liquidationTxBERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebt_BERC20, loggedDebt_BERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedColl_BERC20, loggedColl_BERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasComp_BERC20, loggedGasComp_BERC20), 1000)
	})

	it("gas compensation from pool-offset liquidations. Liquidation event emits the correct gas compensation and total liquidated coll and debt", async () => {
		await priceFeed.setPrice(erc20.address, dec(400, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(200, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(120, 16)),
			extraVUSDAmount: dec(5000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(60, 18)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(80, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(80, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})

		// D, E each provide 10000 VUSD to SP

		await stabilityPool.provideToSP(dec(1, 23), { from: dennis })
		await stabilityPool.provideToSP(dec(1, 23), { from: erin })

		// --- Price drops to 199.999 ---
		await priceFeed.setPrice(erc20.address, "199999000000000000000")
		const price_1 = await priceFeed.getPrice(erc20.address)

		/* 
    ETH:USD price = 199.999
    Alice coll = 1 ETH. Value: $199.999
    0.5% of coll  = 0.05 ETH. Value: (0.05 * 199.999) = $9.99995
    Minimum comp = $10 = 0.05000025000125001 ETH.
    -> Expect 0.05000025000125001 ETH sent to liquidator, 
    and (1 - 0.05000025000125001) = 0.94999974999875 ETH remainder liquidated */

		// Check collateral value in USD is > $10

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const aliceDebtERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX]
		const aliceCollValueInUSDERC20 = await borrowerOperations.getUSDValue(aliceCollERC20, price_1)
		assert.isTrue(aliceCollValueInUSDERC20.gt(th.toBN(dec(10, 18))))

		// Check value of 0.5% of collateral in USD is < $10
		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price_1)).lt(mv._MCR))

		// Liquidate A (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidationTxAERC20 = await vesselManagerOperations.liquidate(erc20.address, alice, {
			from: liquidator,
		})
		const expectedGasComp_AERC20 = _0pt5percent_aliceCollERC20
		const expectedLiquidatedColl_AERC20 = aliceCollERC20.sub(expectedGasComp_AERC20)
		const expectedLiquidatedDebt_AERC20 = aliceDebtERC20

		const [loggedDebt_AERC20, loggedColl_AERC20, loggedGasComp_AERC20] =
			th.getEmittedLiquidationValues(liquidationTxAERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebt_AERC20, loggedDebt_AERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedColl_AERC20, loggedColl_AERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasComp_AERC20, loggedGasComp_AERC20), 1000)

		// --- Price drops to 15 ---
		await priceFeed.setPrice(erc20.address, dec(15, 18))
		const price_2 = await priceFeed.getPrice(erc20.address)

		/* 
    ETH:USD price = 15
    Bob coll = 15 ETH. Value: $165
    0.5% of coll  = 0.75 ETH. Value: (0.75 * 11) = $8.25
    Minimum comp = $10 =  0.66666...ETH.
    -> Expect 0.666666666666666666 ETH sent to liquidator, 
    and (15 - 0.666666666666666666) ETH remainder liquidated */

		// Check collateral value in USD is > $10

		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobDebtERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price_2)).lte(mv._MCR))

		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives

		const liquidationTxBERC20 = await vesselManagerOperations.liquidate(erc20.address, bob, {
			from: liquidator,
		})
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		const expectedGasComp_BERC20 = _0pt5percent_bobCollERC20
		const expectedLiquidatedColl_BERC20 = bobCollERC20.sub(expectedGasComp_BERC20)
		const expectedLiquidatedDebt_BERC20 = bobDebtERC20

		const [loggedDebt_BERC20, loggedColl_BERC20, loggedGasComp_BERC20] =
			th.getEmittedLiquidationValues(liquidationTxBERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebt_BERC20, loggedDebt_BERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedColl_BERC20, loggedColl_BERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasComp_BERC20, loggedGasComp_BERC20), 1000)
	})

	it("gas compensation from pool-offset liquidations: 0.5% collateral > $10 in value. Liquidation event emits the correct gas compensation and total liquidated coll and debt", async () => {
		// open vessels
		await priceFeed.setPrice(erc20.address, dec(400, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(1875, 15)),
			extraVUSDAmount: dec(8000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2, 18)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(4, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(4, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})

		// D, E each provide 10000 VUSD to SP

		await stabilityPool.provideToSP(dec(1, 23), { from: dennis })
		await stabilityPool.provideToSP(dec(1, 23), { from: erin })

		await priceFeed.setPrice(erc20.address, dec(200, 18))
		const price_1 = await priceFeed.getPrice(erc20.address)

		// Check value of 0.5% of collateral in USD is > $10

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const aliceDebtERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_DEBT_INDEX]
		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price_1)).lt(mv._MCR))

		// Liquidate A (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidationTxAERC20 = await vesselManagerOperations.liquidate(erc20.address, alice, {
			from: liquidator,
		})
		const expectedGasComp_AERC20 = _0pt5percent_aliceCollERC20
		const expectedLiquidatedColl_AERC20 = aliceCollERC20.sub(_0pt5percent_aliceCollERC20)
		const expectedLiquidatedDebt_AERC20 = aliceDebtERC20

		const [loggedDebt_AERC20, loggedColl_AERC20, loggedGasComp_AERC20] =
			th.getEmittedLiquidationValues(liquidationTxAERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebt_AERC20, loggedDebt_AERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedColl_AERC20, loggedColl_AERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasComp_AERC20, loggedGasComp_AERC20), 1000)

		/* 
   ETH:USD price = 200
   Bob coll = 37.5 ETH. Value: $7500
   0.5% of coll  = 0.1875 ETH. Value: (0.1875 * 200) = $37.5
   Minimum comp = $10 = 0.05 ETH.
   -> Expect 0.1875 ETH sent to liquidator, 
   and (37.5 - 0.1875 ETH) ETH remainder liquidated */

		// Check value of 0.5% of collateral in USD is > $10

		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobDebtERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_DEBT_INDEX]
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))

		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price_1)).lt(mv._MCR))

		// Liquidate B (use 0 gas price to easily check the amount the compensation amount the liquidator receives)

		const liquidationTxBERC20 = await vesselManagerOperations.liquidate(erc20.address, bob, {
			from: liquidator,
		})
		const expectedGasComp_BERC20 = _0pt5percent_bobCollERC20
		const expectedLiquidatedColl_BERC20 = bobCollERC20.sub(_0pt5percent_bobCollERC20)
		const expectedLiquidatedDebt_BERC20 = bobDebtERC20

		const [loggedDebt_BERC20, loggedColl_BERC20, loggedGasComp_BERC20] =
			th.getEmittedLiquidationValues(liquidationTxBERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebt_BERC20, loggedDebt_BERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedColl_BERC20, loggedColl_BERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasComp_BERC20, loggedGasComp_BERC20), 1000)
	})

	// liquidateVessels - full offset
	it("liquidateVessels(): full offset.  Compensates the correct amount, and liquidates the remainder", async () => {
		await priceFeed.setPrice(erc20.address, dec(1000, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(118, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(526, 16)),
			extraVUSDAmount: dec(8000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(488, 16)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(545, 16)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(10, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(10, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: flyn },
		})

		// D, E each provide 10000 VUSD to SP

		await stabilityPool.provideToSP(dec(1, 23), { from: erin })
		await stabilityPool.provideToSP(dec(1, 23), { from: flyn })

		const VUSDinSP_0ERC20 = await stabilityPool.getTotalDebtTokenDeposits()

		// price drops to 200
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Check not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D have ICR < MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).lt(mv._MCR))

		// Check E, F have ICR > MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).gt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, flyn, price)).gt(mv._MCR))

		// --- Check value of of A's collateral is < $10, and value of B,C,D collateral are > $10  ---

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const carolCollERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const dennisCollERC20 = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]

		// --- Check value of 0.5% of A, B, and C's collateral is <$10, and value of 0.5% of D's collateral is > $10 ---

		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_carolCollERC20 = carolCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_dennisCollERC20 = dennisCollERC20.div(web3.utils.toBN("200"))

		const collGasCompensationERC20 = await vesselManager.getCollGasCompensation(erc20.address, price)
		assert.equal(collGasCompensationERC20, dec(1, 18))

		/* Expect total gas compensation = 
    0.5% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedGasCompERC20 = _0pt5percent_aliceCollERC20
			.add(_0pt5percent_bobCollERC20)
			.add(_0pt5percent_carolCollERC20)
			.add(_0pt5percent_dennisCollERC20)

		/* Expect liquidated coll = 
    0.95% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedLiquidatedCollERC20 = aliceCollERC20
			.sub(_0pt5percent_aliceCollERC20)
			.add(bobCollERC20.sub(_0pt5percent_bobCollERC20))
			.add(carolCollERC20.sub(_0pt5percent_carolCollERC20))
			.add(dennisCollERC20.sub(_0pt5percent_dennisCollERC20))

		// Liquidate vessels A-D

		const liquidatorBalance_beforeERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidateVessels(erc20.address, 4, { from: liquidator })
		const liquidatorBalance_afterERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check VUSD in SP has decreased
		assert.isTrue((await stabilityPool.getTotalDebtTokenDeposits()).lt(VUSDinSP_0ERC20))

		// Check liquidator's balance has increased by the expected compensation amount

		const compensationReceivedERC20 = liquidatorBalance_afterERC20.sub(liquidatorBalance_beforeERC20).toString()
		assert.equal(expectedGasCompERC20, compensationReceivedERC20)

		// Check ETH in stability pool now equals the expected liquidated collateral

		const ETHinSPERC20 = (await stabilityPool.getCollateral(erc20.address)).toString()
		assert.equal(expectedLiquidatedCollERC20, ETHinSPERC20)
	})

	// liquidateVessels - full redistribution
	it("liquidateVessels(): full redistribution. Compensates the correct amount, and liquidates the remainder", async () => {
		await priceFeed.setPrice(erc20.address, dec(1000, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(200, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(118, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: alice },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(526, 16)),
			extraVUSDAmount: dec(8000, 18),
			extraParams: { from: bob },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(488, 16)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(545, 16)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})

		const VUSDinDefaultPool_0ERC20 = await defaultPool.getDebtTokenBalance(erc20.address)

		// price drops to 200
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Check not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D have ICR < MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).lt(mv._MCR))

		// --- Check value of of A's collateral is < $10, and value of B,C,D collateral are > $10  ---

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const carolCollERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const dennisCollERC20 = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]

		// --- Check value of 0.5% of A, B, and C's collateral is <$10, and value of 0.5% of D's collateral is > $10 ---

		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_carolCollERC20 = carolCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_dennisCollERC20 = dennisCollERC20.div(web3.utils.toBN("200"))

		assert.equal(await vesselManager.getCollGasCompensation(erc20.address, price), dec(1, 18))

		/* Expect total gas compensation = 
       0.5% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedGasCompERC20 = _0pt5percent_aliceCollERC20
			.add(_0pt5percent_bobCollERC20)
			.add(_0pt5percent_carolCollERC20)
			.add(_0pt5percent_dennisCollERC20)

		/* Expect liquidated coll = 
    0.95% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedLiquidatedCollERC20 = aliceCollERC20
			.sub(_0pt5percent_aliceCollERC20)
			.add(bobCollERC20.sub(_0pt5percent_bobCollERC20))
			.add(carolCollERC20.sub(_0pt5percent_carolCollERC20))
			.add(dennisCollERC20.sub(_0pt5percent_dennisCollERC20))

		// Liquidate vessels A-D

		const liquidatorBalance_beforeERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))
		await vesselManagerOperations.liquidateVessels(erc20.address, 4, { from: liquidator })
		const liquidatorBalance_afterERC20 = web3.utils.toBN(await erc20.balanceOf(liquidator))

		// Check VUSD in DefaultPool has decreased
		assert.isTrue((await defaultPool.getDebtTokenBalance(erc20.address)).gt(VUSDinDefaultPool_0ERC20))

		// Check liquidator's balance has increased by the expected compensation amount
		const compensationReceivedERC20 = liquidatorBalance_afterERC20.sub(liquidatorBalance_beforeERC20).toString()

		assert.isAtMost(th.getDifference(expectedGasCompERC20, compensationReceivedERC20), 1000)

		// Check ETH in defaultPool now equals the expected liquidated collateral

		const ETHinDefaultPoolERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
		assert.isAtMost(th.getDifference(expectedLiquidatedCollERC20, toBN(ETHinDefaultPoolERC20)), 1000)
	})

	//  --- event emission in liquidation sequence ---
	it("liquidateVessels(): full offset. Liquidation event emits the correct gas compensation and total liquidated coll and debt", async () => {
		await priceFeed.setPrice(erc20.address, dec(1000, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		const { totalDebt: A_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(118, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(526, 16)),
			extraVUSDAmount: dec(8000, 18),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(488, 16)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(545, 16)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(10, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(10, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: flyn },
		})

		// D, E each provide 10000 VUSD to SP

		await stabilityPool.provideToSP(dec(1, 23), { from: erin })
		await stabilityPool.provideToSP(dec(1, 23), { from: flyn })

		// price drops to 200
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Check not in Recovery Mode

		// Check A, B, C, D have ICR < MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).lt(mv._MCR))

		// Check E, F have ICR > MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, erin, price)).gt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, flyn, price)).gt(mv._MCR))

		// --- Check value of of A's collateral is < $10, and value of B,C,D collateral are > $10  ---

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const carolCollERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const dennisCollERC20 = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]

		// --- Check value of 0.5% of A, B, and C's collateral is <$10, and value of 0.5% of D's collateral is > $10 ---

		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_carolCollERC20 = carolCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_dennisCollERC20 = dennisCollERC20.div(web3.utils.toBN("200"))

		assert.equal(await vesselManager.getCollGasCompensation(erc20.address, price), dec(1, 18))

		/* Expect total gas compensation = 
    0.5% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedGasCompERC20 = _0pt5percent_aliceCollERC20
			.add(_0pt5percent_bobCollERC20)
			.add(_0pt5percent_carolCollERC20)
			.add(_0pt5percent_dennisCollERC20)

		/* Expect liquidated coll = 
       0.95% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedLiquidatedCollERC20 = aliceCollERC20
			.sub(_0pt5percent_aliceCollERC20)
			.add(bobCollERC20.sub(_0pt5percent_bobCollERC20))
			.add(carolCollERC20.sub(_0pt5percent_carolCollERC20))
			.add(dennisCollERC20.sub(_0pt5percent_dennisCollERC20))

		// Expect liquidatedDebt = 51 + 190 + 1025 + 13510 = 14646 VUSD
		const expectedLiquidatedDebtERC20 = A_totalDebtERC20.add(B_totalDebtERC20)
			.add(C_totalDebtERC20)
			.add(D_totalDebtERC20)

		// Liquidate vessels A-D

		const liquidationTxDataERC20 = await vesselManagerOperations.liquidateVessels(erc20.address, 4, {
			from: liquidator,
		})

		// Get data from the liquidation event logs
		const [loggedDebtERC20, loggedCollERC20, loggedGasCompERC20] =
			th.getEmittedLiquidationValues(liquidationTxDataERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebtERC20, loggedDebtERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedCollERC20, loggedCollERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasCompERC20, loggedGasCompERC20), 1000)
	})

	it("liquidateVessels(): full redistribution. Liquidation event emits the correct gas compensation and total liquidated coll and debt", async () => {
		await priceFeed.setPrice(erc20.address, dec(1000, 18))

		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(2000, 18)),
			extraParams: { from: whale },
		})
		const { totalDebt: A_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(118, 16)),
			extraVUSDAmount: dec(2000, 18),
			extraParams: { from: alice },
		})
		const { totalDebt: B_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(526, 16)),
			extraVUSDAmount: dec(8000, 18),
			extraParams: { from: bob },
		})
		const { totalDebt: C_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(488, 16)),
			extraVUSDAmount: dec(600, 18),
			extraParams: { from: carol },
		})
		const { totalDebt: D_totalDebtERC20 } = await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(545, 16)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: dennis },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(10, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: erin },
		})
		await openVessel({
			asset: erc20.address,
			ICR: toBN(dec(10, 18)),
			extraVUSDAmount: dec(1, 23),
			extraParams: { from: flyn },
		})

		// price drops to 200
		await priceFeed.setPrice(erc20.address, dec(200, 18))
		const price = await priceFeed.getPrice(erc20.address)

		// Check not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, erc20.address))

		// Check A, B, C, D have ICR < MCR

		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, alice, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, bob, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, carol, price)).lt(mv._MCR))
		assert.isTrue((await vesselManager.getCurrentICR(erc20.address, dennis, price)).lt(mv._MCR))

		const aliceCollERC20 = (await vesselManager.Vessels(alice, erc20.address))[th.VESSEL_COLL_INDEX]
		const bobCollERC20 = (await vesselManager.Vessels(bob, erc20.address))[th.VESSEL_COLL_INDEX]
		const carolCollERC20 = (await vesselManager.Vessels(carol, erc20.address))[th.VESSEL_COLL_INDEX]
		const dennisCollERC20 = (await vesselManager.Vessels(dennis, erc20.address))[th.VESSEL_COLL_INDEX]

		// --- Check value of 0.5% of A, B, and C's collateral is <$10, and value of 0.5% of D's collateral is > $10 ---

		const _0pt5percent_aliceCollERC20 = aliceCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_bobCollERC20 = bobCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_carolCollERC20 = carolCollERC20.div(web3.utils.toBN("200"))
		const _0pt5percent_dennisCollERC20 = dennisCollERC20.div(web3.utils.toBN("200"))

		/* Expect total gas compensation = 
    0.5% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedGasCompERC20 = _0pt5percent_aliceCollERC20
			.add(_0pt5percent_bobCollERC20)
			.add(_0pt5percent_carolCollERC20)
			.add(_0pt5percent_dennisCollERC20)
			.toString()

		/* Expect liquidated coll = 
    0.95% of [A_coll + B_coll + C_coll + D_coll]
    */

		const expectedLiquidatedCollERC20 = aliceCollERC20
			.sub(_0pt5percent_aliceCollERC20)
			.add(bobCollERC20.sub(_0pt5percent_bobCollERC20))
			.add(carolCollERC20.sub(_0pt5percent_carolCollERC20))
			.add(dennisCollERC20.sub(_0pt5percent_dennisCollERC20))

		// Expect liquidatedDebt = 51 + 190 + 1025 + 13510 = 14646 VUSD
		const expectedLiquidatedDebtERC20 = A_totalDebtERC20.add(B_totalDebtERC20)
			.add(C_totalDebtERC20)
			.add(D_totalDebtERC20)

		// Liquidate vessels A-D

		const liquidationTxDataERC20 = await vesselManagerOperations.liquidateVessels(erc20.address, 4, {
			from: liquidator,
		})

		// Get data from the liquidation event logs
		const [loggedDebtERC20, loggedCollERC20, loggedGasCompERC20] =
			th.getEmittedLiquidationValues(liquidationTxDataERC20)

		assert.isAtMost(th.getDifference(expectedLiquidatedDebtERC20, loggedDebtERC20), 1000)
		assert.isAtMost(th.getDifference(expectedLiquidatedCollERC20, loggedCollERC20), 1000)
		assert.isAtMost(th.getDifference(expectedGasCompERC20, loggedGasCompERC20), 1000)
	})

	// --- Vessel ordering by ICR tests ---

	it("Vessel ordering: same collateral, decreasing debt. Price successively increases. Vessels should maintain ordering by ICR", async () => {
		const _10_accounts = accounts.slice(1, 11)

		let debt = 50
		// create 10 vessels, constant coll, descending debt 100 to 90 VUSD
		for (const account of _10_accounts) {
			const debtString = debt.toString().concat("000000000000000000")

			await openVessel({
				asset: erc20.address,
				assetSent: dec(30, "ether"),
				extraVUSDAmount: debtString,
				extraParams: { from: account },
			})

			debt -= 1
		}

		// Vary price 200-210
		let price = 200
		while (price < 210) {
			const priceString = price.toString().concat("000000000000000000")
			await priceFeed.setPrice(erc20.address, priceString)

			const ICRListERC20 = []
			const coll_firstVesselERC20 = (await vesselManager.Vessels(_10_accounts[0], erc20.address))[th.VESSEL_COLL_INDEX]
			const gasComp_firstVesselERC20 = (
				await vesselManager.getCollGasCompensation(erc20.address, coll_firstVesselERC20)
			).toString()

			for (account of _10_accounts) {
				// Check gas compensation is the same for all vessels

				const collERC20 = (await vesselManager.Vessels(account, erc20.address))[th.VESSEL_COLL_INDEX]
				const gasCompensationERC20 = (await vesselManager.getCollGasCompensation(erc20.address, collERC20)).toString()

				assert.equal(gasCompensationERC20, gasComp_firstVesselERC20)

				const ICRERC20 = await vesselManager.getCurrentICR(erc20.address, account, price)
				ICRListERC20.push(ICRERC20)

				// Check vessel ordering by ICR is maintained

				if (ICRListERC20.length > 1) {
					const prevICRERC20 = ICRListERC20[ICRListERC20.length - 2]

					try {
						assert.isTrue(ICRERC20.gte(prevICRERC20))
					} catch (error) {
						console.log(`ETH price at which vessel ordering breaks: ${price}`)
						// logICRs(ICRListERC20)
					}
				}

				price += 1
			}
		}
	})

	it("Vessel ordering: increasing collateral, constant debt. Price successively increases. Vessels should maintain ordering by ICR", async () => {
		const _20_accounts = accounts.slice(1, 21)

		let coll = 50
		// create 20 vessels, increasing collateral, constant debt = 100VUSD
		for (const account of _20_accounts) {
			const collString = coll.toString().concat("000000000000000000")

			await openVessel({
				asset: erc20.address,
				assetSent: collString,
				extraVUSDAmount: dec(100, 18),
				extraParams: { from: account },
			})

			coll += 5
		}

		// Vary price
		let price = 1
		while (price < 300) {
			const priceString = price.toString().concat("000000000000000000")
			await priceFeed.setPrice(erc20.address, priceString)

			const ICRListERC20 = []

			for (account of _20_accounts) {
				const ICRERC20 = await vesselManager.getCurrentICR(erc20.address, account, price)
				ICRListERC20.push(ICRERC20)

				// Check vessel ordering by ICR is maintained
				if (ICRListERC20.lengthERC20 > 1) {
					const prevICRERC20 = ICRListERC20[ICRListERC20.length - 2]

					try {
						assert.isTrue(ICRERC20.gte(prevICRERC20))
					} catch (error) {
						console.log(`ETH price at which vessel ordering breaks: ${price}`)
						// logICRs(ICRListERC20)
					}
				}

				price += 10
			}
		}
	})

	it("Vessel ordering: Constant raw collateral ratio (excluding virtual debt). Price successively increases. Vessels should maintain ordering by ICR", async () => {
		let collVals = [1, 5, 10, 25, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000].map(
			v => v * 20
		)
		const accountsList = accounts.slice(1, collVals.length + 1)

		let accountIdx = 0
		for (const coll of collVals) {
			const account = accountsList[accountIdx]
			const collString = coll.toString().concat("000000000000000000")

			await openVessel({
				asset: erc20.address,
				assetSent: collString,
				extraVUSDAmount: dec(100, 18),
				extraParams: { from: account },
			})

			accountIdx += 1
		}

		// Vary price
		let price = 1
		while (price < 300) {
			const priceString = price.toString().concat("000000000000000000")
			await priceFeed.setPrice(erc20.address, priceString)

			const ICRListERC20 = []

			for (account of accountsList) {
				const ICRERC20 = await vesselManager.getCurrentICR(erc20.address, account, price)
				ICRListERC20.push(ICRERC20)

				// Check vessel ordering by ICR is maintained

				if (ICRListERC20.length > 1) {
					const prevICRERC20 = ICRListERC20[ICRListERC20.length - 2]

					try {
						assert.isTrue(ICRERC20.gte(prevICRERC20))
					} catch (error) {
						console.log(error)
						console.log(`ETH price at which vessel ordering breaks: ${price}`)
						// logICRs(ICRListERC20)
					}
				}

				price += 10
			}
		}
	})
})

contract("Reset chain state", async accounts => {})
