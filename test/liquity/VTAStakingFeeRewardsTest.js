const Decimal = require("decimal.js")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const { BNConverter } = require("../../utils/BNConverter.js")
const testHelpers = require("../../utils/testHelpers.js")

const GRVTStakingTester = artifacts.require("GRVTStakingTester")
const VesselManagerTester = artifacts.require("VesselManagerTester")
const NonPayable = artifacts.require("./NonPayable.sol")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const assertRevert = th.assertRevert

const toBN = th.toBN
const ZERO = th.toBN("0")

/* NOTE: These tests do not test for specific ETH and VUSD gain values. They only test that the
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake.
 *
 * Specific ETH/VUSD gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the VesselManager, which are still TBD based on economic
 * modelling.
 *
 */

contract("GRVTStaking revenue share tests", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS

	const multisig = accounts[999]

	const [owner, A, B, C, D, E, F, G, whale] = accounts

	let priceFeed
	let vusdToken
	let sortedVessels
	let vesselManager
	let activePool
	let stabilityPool
	let defaultPool
	let borrowerOperations
	let grvtStaking
	let grvtToken
	let erc20

	let contracts

	const openVessel = async params => th.openVessel(contracts, params)

	beforeEach(async () => {
		contracts = await deploymentHelper.deployLiquityCore()
		contracts.vesselManager = await VesselManagerTester.new()
		contracts = await deploymentHelper.deployVUSDToken(contracts)
		const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

		await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
		await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)

		nonPayable = await NonPayable.new()
		priceFeed = contracts.priceFeedTestnet
		vusdToken = contracts.vusdToken
		sortedVessels = contracts.sortedVessels
		vesselManager = contracts.vesselManager
		activePool = contracts.activePool
		stabilityPool = contracts.stabilityPool
		defaultPool = contracts.defaultPool
		borrowerOperations = contracts.borrowerOperations
		hintHelpers = contracts.hintHelpers
		erc20 = contracts.erc20

		grvtToken = GRVTContracts.grvtToken
		grvtStaking = GRVTContracts.grvtStaking
		await grvtToken.unprotectedMint(multisig, dec(5, 24))

		let index = 0
		for (const acc of accounts) {
			await grvtToken.approve(grvtStaking.address, await web3.eth.getBalance(acc), {
				from: acc,
			})
			await erc20.mint(acc, await web3.eth.getBalance(acc))
			index++

			if (index >= 20) break
		}
	})

	it("stake(): reverts if amount is zero", async () => {
		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await assertRevert(
			grvtStaking.stake(0, { from: A }),
			"GRVTStaking: Amount must be non-zero"
		)
	})

	it("ETH fee per GRVT staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})

		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtStaking.stake(dec(100, 18), { from: A })

		// Check ETH fee per unit staked is zero
		const F_ETH_Before = await grvtStaking.F_ASSETS(ZERO_ADDRESS)
		const F_ETH_Before_Asset = await grvtStaking.F_ASSETS(erc20.address)
		assert.equal(F_ETH_Before, "0")
		assert.equal(F_ETH_Before_Asset, "0")

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		const redemptionTx_Asset = await th.redeemCollateralAndGetTxObject(
			B,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// check ETH fee emitted in event is non-zero
		const emittedETHFee = toBN(th.getEmittedRedemptionValues(redemptionTx)[3])
		const emittedETHFee_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_Asset)[3])
		assert.isTrue(emittedETHFee.gt(toBN("0")))
		assert.isTrue(emittedETHFee_Asset.gt(toBN("0")))

		// Check ETH fee per unit staked has increased by correct amount
		const F_ETH_After = await grvtStaking.F_ASSETS(ZERO_ADDRESS)
		const F_ETH_After_Asset = await grvtStaking.F_ASSETS(erc20.address)

		// Expect fee per unit staked = fee/100, since there is 100 VUSD totalStaked
		const expected_F_ETH_After = emittedETHFee.div(toBN("100"))
		const expected_F_ETH_After_Asset = emittedETHFee_Asset.div(toBN("100"))

		assert.isTrue(expected_F_ETH_After.eq(F_ETH_After))
		assert.isTrue(expected_F_ETH_After_Asset.eq(F_ETH_After_Asset))
	})

	it("ETH fee per GRVT staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// Check ETH fee per unit staked is zero
		assert.equal(await grvtStaking.F_ASSETS(ZERO_ADDRESS), "0")
		assert.equal(await grvtStaking.F_ASSETS(erc20.address), "0")

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		const redemptionTx_Asset = await th.redeemCollateralAndGetTxObject(
			B,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// check ETH fee emitted in event is non-zero
		const emittedETHFee = toBN(th.getEmittedRedemptionValues(redemptionTx)[3])
		const emittedETHFee_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_Asset)[3])
		assert.isTrue(emittedETHFee.gt(toBN("0")))
		assert.isTrue(emittedETHFee_Asset.gt(toBN("0")))

		// Check ETH fee per unit staked has not increased
		assert.equal(await grvtStaking.F_ASSETS(ZERO_ADDRESS), "0")
		assert.equal(await grvtStaking.F_ASSETS(erc20.address), "0")
	})

	it("VUSD fee per GRVT staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// A makes stake
		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtStaking.stake(dec(100, 18), { from: A })

		// Check VUSD fee per unit staked is zero
		assert.equal(await grvtStaking.F_ASSETS(ZERO_ADDRESS), "0")
		assert.equal(await grvtStaking.F_ASSETS(erc20.address), "0")

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), erc20.address)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// Check base rate is now non-zero
		assert.isTrue((await vesselManager.baseRate(ZERO_ADDRESS)).gt(toBN("0")))
		assert.isTrue((await vesselManager.baseRate(erc20.address)).gt(toBN("0")))

		// D draws debt
		const tx = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(27, 18),
			D,
			D,
			{ from: D }
		)
		const tx_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(27, 18),
			D,
			D,
			{ from: D }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(tx))
		const emittedVUSDFee_Asset = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(tx_Asset))
		assert.isTrue(emittedVUSDFee.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_Asset.gt(toBN("0")))

		// Check VUSD fee per unit staked has increased by correct amount
		const F_VUSD_After = await grvtStaking.F_VUSD()

		// Expect fee per unit staked = fee/100, since there is 100 VUSD totalStaked
		const expected_F_VUSD_After = emittedVUSDFee.div(toBN("100"))
		const expected_F_VUSD_After_Asset = emittedVUSDFee_Asset.div(toBN("100"))

		assert.isTrue(expected_F_VUSD_After.add(expected_F_VUSD_After_Asset).eq(F_VUSD_After))
	})

	it("VUSD fee per GRVT staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// Check VUSD fee per unit staked is zero
		assert.equal(await grvtStaking.F_ASSETS(ZERO_ADDRESS), "0")
		assert.equal(await grvtStaking.F_ASSETS(erc20.address), "0")

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), erc20.address)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// Check base rate is now non-zero
		assert.isTrue((await vesselManager.baseRate(ZERO_ADDRESS)).gt(toBN("0")))
		assert.isTrue((await vesselManager.baseRate(erc20.address)).gt(toBN("0")))

		// D draws debt
		const tx = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(27, 18),
			D,
			D,
			{ from: D }
		)
		const tx_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(27, 18),
			D,
			D,
			{ from: D }
		)

		// Check VUSD fee value in event is non-zero
		assert.isTrue(toBN(th.getVUSDFeeFromVUSDBorrowingEvent(tx)).gt(toBN("0")))
		assert.isTrue(toBN(th.getVUSDFeeFromVUSDBorrowingEvent(tx_Asset)).gt(toBN("0")))

		// Check VUSD fee per unit staked did not increase, is still zero
		const F_VUSD_After = await grvtStaking.F_VUSD()
		assert.equal(F_VUSD_After, "0")
	})

	it("GRVT Staking: A single staker earns all ETH and GRVT fees that occur", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// A makes stake
		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtStaking.stake(dec(100, 18), { from: A })

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
			B,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// check ETH fee 1 emitted in event is non-zero
		const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
		const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
		assert.isTrue(emittedETHFee_1.gt(toBN("0")))
		assert.isTrue(emittedETHFee_1_Asset.gt(toBN("0")))

		const C_BalBeforeREdemption = await vusdToken.balanceOf(C)
		// C redeems
		const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
		const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
			C,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const C_BalAfterRedemption = await vusdToken.balanceOf(C)
		assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

		// check ETH fee 2 emitted in event is non-zero
		const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
		const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
		assert.isTrue(emittedETHFee_2.gt(toBN("0")))
		assert.isTrue(emittedETHFee_2_Asset.gt(toBN("0")))

		// D draws debt
		const borrowingTx_1 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(104, 18),
			D,
			D,
			{ from: D }
		)
		const borrowingTx_1_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(104, 18),
			D,
			D,
			{ from: D }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee_1 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1))
		const emittedVUSDFee_1_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1_Asset)
		)
		assert.isTrue(emittedVUSDFee_1.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_1_Asset.gt(toBN("0")))

		// B draws debt
		const borrowingTx_2 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(17, 18),
			B,
			B,
			{ from: B }
		)
		const borrowingTx_2_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(17, 18),
			B,
			B,
			{ from: B }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee_2 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2))
		const emittedVUSDFee_2_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2_Asset)
		)
		assert.isTrue(emittedVUSDFee_2.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_2_Asset.gt(toBN("0")))

		const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
		const expectedTotalETHGain_Asset = emittedETHFee_1_Asset.add(emittedETHFee_2_Asset)

		const expectedTotalVUSDGain = emittedVUSDFee_1
			.add(emittedVUSDFee_1_Asset)
			.add(emittedVUSDFee_2)
			.add(emittedVUSDFee_2_Asset)

		const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
		const A_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(A))
		const A_VUSDBalance_Before = toBN(await vusdToken.balanceOf(A))

		// A un-stakes
		await grvtStaking.unstake(dec(100, 18), { from: A, gasPrice: 0 })

		const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
		const A_ETHBalance_After_Asset = toBN(await erc20.balanceOf(A))
		const A_VUSDBalance_After = toBN(await vusdToken.balanceOf(A))

		const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
		const A_VUSDGain = A_VUSDBalance_After.sub(A_VUSDBalance_Before)

		const A_ETHGain_Asset = A_ETHBalance_After_Asset.sub(A_ETHBalance_Before_Asset)

		assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
		assert.isAtMost(
			th.getDifference(expectedTotalETHGain_Asset.div(toBN(10 ** 10)), A_ETHGain_Asset),
			1000
		)
		assert.isAtMost(th.getDifference(expectedTotalVUSDGain, A_VUSDGain), 1000)
	})

	it("stake(): Top-up sends out all accumulated ETH and VUSD gains to the staker", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// A makes stake
		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtStaking.stake(dec(50, 18), { from: A })

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
			B,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// check ETH fee 1 emitted in event is non-zero
		const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
		const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
		assert.isTrue(emittedETHFee_1.gt(toBN("0")))
		assert.isTrue(emittedETHFee_1_Asset.gt(toBN("0")))

		const C_BalBeforeREdemption = await vusdToken.balanceOf(C)
		// C redeems
		const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
		const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
			C,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const C_BalAfterRedemption = await vusdToken.balanceOf(C)
		assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

		// check ETH fee 2 emitted in event is non-zero
		const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
		const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
		assert.isTrue(emittedETHFee_2.gt(toBN("0")))
		assert.isTrue(emittedETHFee_2_Asset.gt(toBN("0")))

		// D draws debt
		const borrowingTx_1 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(104, 18),
			D,
			D,
			{ from: D }
		)
		const borrowingTx_1_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(104, 18),
			D,
			D,
			{ from: D }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee_1 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1))
		const emittedVUSDFee_1_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1_Asset)
		)
		assert.isTrue(emittedVUSDFee_1.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_1_Asset.gt(toBN("0")))

		// B draws debt
		const borrowingTx_2 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(17, 18),
			B,
			B,
			{ from: B }
		)
		const borrowingTx_2_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(17, 18),
			B,
			B,
			{ from: B }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee_2 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2))
		const emittedVUSDFee_2_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2_Asset)
		)
		assert.isTrue(emittedVUSDFee_2.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_2_Asset.gt(toBN("0")))

		const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
		const expectedTotalETHGain_Asset = emittedETHFee_1_Asset.add(emittedETHFee_2_Asset)

		const expectedTotalVUSDGain = emittedVUSDFee_1
			.add(emittedVUSDFee_1_Asset)
			.add(emittedVUSDFee_2.add(emittedVUSDFee_2_Asset))

		const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
		const A_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(A))
		const A_VUSDBalance_Before = toBN(await vusdToken.balanceOf(A))

		// A tops up
		await grvtStaking.stake(dec(50, 18), { from: A, gasPrice: 0 })

		const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
		const A_ETHBalance_After_Asset = toBN(await erc20.balanceOf(A))
		const A_VUSDBalance_After = toBN(await vusdToken.balanceOf(A))

		const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
		const A_ETHGain_Asset = A_ETHBalance_After_Asset.sub(A_ETHBalance_Before_Asset)
		const A_VUSDGain = A_VUSDBalance_After.sub(A_VUSDBalance_Before)

		assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
		assert.isAtMost(
			th.getDifference(expectedTotalETHGain_Asset.div(toBN(10 ** 10)), A_ETHGain_Asset),
			1000
		)
		assert.isAtMost(th.getDifference(expectedTotalVUSDGain, A_VUSDGain), 1000)
	})

	it("getPendingETHGain(): Returns the staker's correct pending ETH gain", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// A makes stake
		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtStaking.stake(dec(50, 18), { from: A })

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
			B,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// check ETH fee 1 emitted in event is non-zero
		const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
		const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
		assert.isTrue(emittedETHFee_1.gt(toBN("0")))
		assert.isTrue(emittedETHFee_1_Asset.gt(toBN("0")))

		const C_BalBeforeREdemption = await vusdToken.balanceOf(C)
		// C redeems
		const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
		const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
			C,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const C_BalAfterRedemption = await vusdToken.balanceOf(C)
		assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

		// check ETH fee 2 emitted in event is non-zero
		const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
		const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
		assert.isTrue(emittedETHFee_2.gt(toBN("0")))
		assert.isTrue(emittedETHFee_2_Asset.gt(toBN("0")))

		const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
		const expectedTotalETHGain_Asset = emittedETHFee_1_Asset.add(emittedETHFee_2_Asset)

		const A_ETHGain = await grvtStaking.getPendingAssetGain(ZERO_ADDRESS, A)
		const A_ETHGain_Asset = await grvtStaking.getPendingAssetGain(erc20.address, A)

		assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
		assert.isAtMost(th.getDifference(expectedTotalETHGain_Asset, A_ETHGain_Asset), 1000)
	})

	it("getPendingVUSDGain(): Returns the staker's correct pending VUSD gain", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })

		// A makes stake
		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtStaking.stake(dec(50, 18), { from: A })

		const B_BalBeforeREdemption = await vusdToken.balanceOf(B)
		// B redeems
		const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
		const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
			B,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const B_BalAfterRedemption = await vusdToken.balanceOf(B)
		assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

		// check ETH fee 1 emitted in event is non-zero
		const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
		const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
		assert.isTrue(emittedETHFee_1.gt(toBN("0")))
		assert.isTrue(emittedETHFee_1_Asset.gt(toBN("0")))

		const C_BalBeforeREdemption = await vusdToken.balanceOf(C)
		// C redeems
		const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
		const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
			C,
			contracts,
			dec(100, 18),
			erc20.address
		)

		const C_BalAfterRedemption = await vusdToken.balanceOf(C)
		assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

		// check ETH fee 2 emitted in event is non-zero
		const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
		const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
		assert.isTrue(emittedETHFee_2.gt(toBN("0")))
		assert.isTrue(emittedETHFee_2_Asset.gt(toBN("0")))

		// D draws debt
		const borrowingTx_1 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(104, 18),
			D,
			D,
			{ from: D }
		)
		const borrowingTx_1_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(104, 18),
			D,
			D,
			{ from: D }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee_1 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1))
		const emittedVUSDFee_1_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1_Asset)
		)
		assert.isTrue(emittedVUSDFee_1.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_1_Asset.gt(toBN("0")))

		// B draws debt
		const borrowingTx_2 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(17, 18),
			B,
			B,
			{ from: B }
		)
		const borrowingTx_2_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(17, 18),
			B,
			B,
			{ from: B }
		)

		// Check VUSD fee value in event is non-zero
		const emittedVUSDFee_2 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2))
		const emittedVUSDFee_2_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2_Asset)
		)
		assert.isTrue(emittedVUSDFee_2.gt(toBN("0")))
		assert.isTrue(emittedVUSDFee_2_Asset.gt(toBN("0")))

		const expectedTotalVUSDGain = emittedVUSDFee_1.add(emittedVUSDFee_2)
		const expectedTotalVUSDGain_Asset = emittedVUSDFee_1_Asset.add(emittedVUSDFee_2_Asset)
		const A_VUSDGain = await grvtStaking.getPendingVUSDGain(A)

		assert.isAtMost(
			th.getDifference(expectedTotalVUSDGain.add(expectedTotalVUSDGain_Asset), A_VUSDGain),
			1000
		)
	})

	// - multi depositors, several rewards
	it("GRVT Staking: Multiple stakers earn the correct share of all ETH and GRVT fees, based on their stake size", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: E },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: F },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: G },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(10000, 18)),
			ICR: toBN(dec(10, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: E },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: F },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: G },
		})

		// FF time one year so owner can transfer GRVT
		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A, B, C
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })
		await grvtToken.transfer(B, dec(200, 18), { from: multisig })
		await grvtToken.transfer(C, dec(300, 18), { from: multisig })

		// A, B, C make stake
		await grvtToken.approve(grvtStaking.address, dec(100, 18), { from: A })
		await grvtToken.approve(grvtStaking.address, dec(200, 18), { from: B })
		await grvtToken.approve(grvtStaking.address, dec(300, 18), { from: C })
		await grvtStaking.stake(dec(100, 18), { from: A })
		await grvtStaking.stake(dec(200, 18), { from: B })
		await grvtStaking.stake(dec(300, 18), { from: C })

		// Confirm staking contract holds 600 GRVT
		// console.log(`GRVT staking GRVT bal: ${await GRVTToken.balanceOf(grvtStaking.address)}`)
		assert.equal(await grvtToken.balanceOf(grvtStaking.address), dec(600, 18))
		assert.equal(await grvtStaking.totalGRVTStaked(), dec(600, 18))

		// F redeems
		const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(F, contracts, dec(45, 18))
		const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
		assert.isTrue(emittedETHFee_1.gt(toBN("0")))

		const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
			F,
			contracts,
			dec(45, 18),
			erc20.address
		)
		const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
		assert.isTrue(emittedETHFee_1_Asset.gt(toBN("0")))

		// G redeems
		const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(G, contracts, dec(197, 18))
		const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
		assert.isTrue(emittedETHFee_2.gt(toBN("0")))

		const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
			G,
			contracts,
			dec(197, 18),
			erc20.address
		)
		const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
		assert.isTrue(emittedETHFee_2_Asset.gt(toBN("0")))

		// F draws debt
		const borrowingTx_1 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(104, 18),
			F,
			F,
			{ from: F }
		)
		const emittedVUSDFee_1 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1))
		assert.isTrue(emittedVUSDFee_1.gt(toBN("0")))

		const borrowingTx_1_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(104, 18),
			F,
			F,
			{ from: F }
		)
		const emittedVUSDFee_1_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_1_Asset)
		)
		assert.isTrue(emittedVUSDFee_1_Asset.gt(toBN("0")))

		// G draws debt
		const borrowingTx_2 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(17, 18),
			G,
			G,
			{ from: G }
		)
		const emittedVUSDFee_2 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2))
		assert.isTrue(emittedVUSDFee_2.gt(toBN("0")))

		const borrowingTx_2_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(17, 18),
			G,
			G,
			{ from: G }
		)
		const emittedVUSDFee_2_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_2_Asset)
		)
		assert.isTrue(emittedVUSDFee_2_Asset.gt(toBN("0")))

		// D obtains GRVT from owner and makes a stake
		await grvtToken.transfer(D, dec(50, 18), { from: multisig })
		await grvtToken.approve(grvtStaking.address, dec(50, 18), { from: D })
		await grvtStaking.stake(dec(50, 18), { from: D })

		// Confirm staking contract holds 650 GRVT
		assert.equal(await grvtToken.balanceOf(grvtStaking.address), dec(650, 18))
		assert.equal(await grvtStaking.totalGRVTStaked(), dec(650, 18))

		// G redeems
		const redemptionTx_3 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(197, 18))
		const emittedETHFee_3 = toBN(th.getEmittedRedemptionValues(redemptionTx_3)[3])
		assert.isTrue(emittedETHFee_3.gt(toBN("0")))

		const redemptionTx_3_Asset = await th.redeemCollateralAndGetTxObject(
			C,
			contracts,
			dec(197, 18),
			erc20.address
		)
		const emittedETHFee_3_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_3_Asset)[3])
		assert.isTrue(emittedETHFee_3_Asset.gt(toBN("0")))

		// G draws debt
		const borrowingTx_3 = await borrowerOperations.withdrawDebtTokens(
			ZERO_ADDRESS,
			th._100pct,
			dec(17, 18),
			G,
			G,
			{ from: G }
		)
		const emittedVUSDFee_3 = toBN(th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_3))
		assert.isTrue(emittedVUSDFee_3.gt(toBN("0")))

		const borrowingTx_3_Asset = await borrowerOperations.withdrawDebtTokens(
			erc20.address,
			th._100pct,
			dec(17, 18),
			G,
			G,
			{ from: G }
		)
		const emittedVUSDFee_3_Asset = toBN(
			th.getVUSDFeeFromVUSDBorrowingEvent(borrowingTx_3_Asset)
		)
		assert.isTrue(emittedVUSDFee_3_Asset.gt(toBN("0")))

		/*  
    Expected rewards:

    A_ETH: (100* ETHFee_1)/600 + (100* ETHFee_2)/600 + (100*ETH_Fee_3)/650
    B_ETH: (200* ETHFee_1)/600 + (200* ETHFee_2)/600 + (200*ETH_Fee_3)/650
    C_ETH: (300* ETHFee_1)/600 + (300* ETHFee_2)/600 + (300*ETH_Fee_3)/650
    D_ETH:                                             (100*ETH_Fee_3)/650

    A_VUSD: (100*VUSDFee_1 )/600 + (100* VUSDFee_2)/600 + (100*VUSDFee_3)/650
    B_VUSD: (200* VUSDFee_1)/600 + (200* VUSDFee_2)/600 + (200*VUSDFee_3)/650
    C_VUSD: (300* VUSDFee_1)/600 + (300* VUSDFee_2)/600 + (300*VUSDFee_3)/650
    D_VUSD:                                               (100*VUSDFee_3)/650
    */

		// Expected ETH gains
		const expectedETHGain_A = toBN("100")
			.mul(emittedETHFee_1)
			.div(toBN("600"))
			.add(toBN("100").mul(emittedETHFee_2).div(toBN("600")))
			.add(toBN("100").mul(emittedETHFee_3).div(toBN("650")))

		const expectedETHGain_B = toBN("200")
			.mul(emittedETHFee_1)
			.div(toBN("600"))
			.add(toBN("200").mul(emittedETHFee_2).div(toBN("600")))
			.add(toBN("200").mul(emittedETHFee_3).div(toBN("650")))

		const expectedETHGain_C = toBN("300")
			.mul(emittedETHFee_1)
			.div(toBN("600"))
			.add(toBN("300").mul(emittedETHFee_2).div(toBN("600")))
			.add(toBN("300").mul(emittedETHFee_3).div(toBN("650")))

		const expectedETHGain_D = toBN("50").mul(emittedETHFee_3).div(toBN("650"))

		const expectedETHGain_A_Asset = toBN("100")
			.mul(emittedETHFee_1_Asset)
			.div(toBN("600"))
			.add(toBN("100").mul(emittedETHFee_2_Asset).div(toBN("600")))
			.add(toBN("100").mul(emittedETHFee_3_Asset).div(toBN("650")))

		const expectedETHGain_B_Asset = toBN("200")
			.mul(emittedETHFee_1_Asset)
			.div(toBN("600"))
			.add(toBN("200").mul(emittedETHFee_2_Asset).div(toBN("600")))
			.add(toBN("200").mul(emittedETHFee_3_Asset).div(toBN("650")))

		const expectedETHGain_C_Asset = toBN("300")
			.mul(emittedETHFee_1_Asset)
			.div(toBN("600"))
			.add(toBN("300").mul(emittedETHFee_2_Asset).div(toBN("600")))
			.add(toBN("300").mul(emittedETHFee_3_Asset).div(toBN("650")))

		const expectedETHGain_D_Asset = toBN("50").mul(emittedETHFee_3_Asset).div(toBN("650"))

		// Expected VUSD gains:
		const expectedVUSDGain_A = toBN("100")
			.mul(emittedVUSDFee_1)
			.div(toBN("600"))
			.add(toBN("100").mul(emittedVUSDFee_2).div(toBN("600")))
			.add(toBN("100").mul(emittedVUSDFee_3).div(toBN("650")))

		const expectedVUSDGain_B = toBN("200")
			.mul(emittedVUSDFee_1)
			.div(toBN("600"))
			.add(toBN("200").mul(emittedVUSDFee_2).div(toBN("600")))
			.add(toBN("200").mul(emittedVUSDFee_3).div(toBN("650")))

		const expectedVUSDGain_C = toBN("300")
			.mul(emittedVUSDFee_1)
			.div(toBN("600"))
			.add(toBN("300").mul(emittedVUSDFee_2).div(toBN("600")))
			.add(toBN("300").mul(emittedVUSDFee_3).div(toBN("650")))

		const expectedVUSDGain_D = toBN("50").mul(emittedVUSDFee_3).div(toBN("650"))

		const expectedVUSDGain_A_Asset = toBN("100")
			.mul(emittedVUSDFee_1_Asset)
			.div(toBN("600"))
			.add(toBN("100").mul(emittedVUSDFee_2_Asset).div(toBN("600")))
			.add(toBN("100").mul(emittedVUSDFee_3_Asset).div(toBN("650")))

		const expectedVUSDGain_B_Asset = toBN("200")
			.mul(emittedVUSDFee_1_Asset)
			.div(toBN("600"))
			.add(toBN("200").mul(emittedVUSDFee_2_Asset).div(toBN("600")))
			.add(toBN("200").mul(emittedVUSDFee_3_Asset).div(toBN("650")))

		const expectedVUSDGain_C_Asset = toBN("300")
			.mul(emittedVUSDFee_1_Asset)
			.div(toBN("600"))
			.add(toBN("300").mul(emittedVUSDFee_2_Asset).div(toBN("600")))
			.add(toBN("300").mul(emittedVUSDFee_3_Asset).div(toBN("650")))

		const expectedVUSDGain_D_Asset = toBN("50").mul(emittedVUSDFee_3_Asset).div(toBN("650"))

		const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
		const A_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(A))
		const A_VUSDBalance_Before = toBN(await vusdToken.balanceOf(A))
		const B_ETHBalance_Before = toBN(await web3.eth.getBalance(B))
		const B_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(B))
		const B_VUSDBalance_Before = toBN(await vusdToken.balanceOf(B))
		const C_ETHBalance_Before = toBN(await web3.eth.getBalance(C))
		const C_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(C))
		const C_VUSDBalance_Before = toBN(await vusdToken.balanceOf(C))
		const D_ETHBalance_Before = toBN(await web3.eth.getBalance(D))
		const D_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(D))
		const D_VUSDBalance_Before = toBN(await vusdToken.balanceOf(D))

		// A-D un-stake
		await grvtStaking.unstake(dec(100, 18), { from: A, gasPrice: 0 })
		await grvtStaking.unstake(dec(200, 18), { from: B, gasPrice: 0 })
		await grvtStaking.unstake(dec(400, 18), { from: C, gasPrice: 0 })
		await grvtStaking.unstake(dec(50, 18), { from: D, gasPrice: 0 })

		// Confirm all depositors could withdraw

		//Confirm pool Size is now 0
		assert.equal(await grvtToken.balanceOf(grvtStaking.address), "0")
		assert.equal(await grvtStaking.totalGRVTStaked(), "0")

		// Get A-D ETH and VUSD balances
		const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
		const A_ETHBalance_After_Asset = toBN(await erc20.balanceOf(A))
		const A_VUSDBalance_After = toBN(await vusdToken.balanceOf(A))
		const B_ETHBalance_After = toBN(await web3.eth.getBalance(B))
		const B_ETHBalance_After_Asset = toBN(await erc20.balanceOf(B))
		const B_VUSDBalance_After = toBN(await vusdToken.balanceOf(B))
		const C_ETHBalance_After = toBN(await web3.eth.getBalance(C))
		const C_ETHBalance_After_Asset = toBN(await erc20.balanceOf(C))
		const C_VUSDBalance_After = toBN(await vusdToken.balanceOf(C))
		const D_ETHBalance_After = toBN(await web3.eth.getBalance(D))
		const D_ETHBalance_After_Asset = toBN(await erc20.balanceOf(D))
		const D_VUSDBalance_After = toBN(await vusdToken.balanceOf(D))

		// Get ETH and VUSD gains
		const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
		const A_ETHGain_Asset = A_ETHBalance_After_Asset.sub(A_ETHBalance_Before_Asset)
		const A_VUSDGain = A_VUSDBalance_After.sub(A_VUSDBalance_Before)
		const B_ETHGain = B_ETHBalance_After.sub(B_ETHBalance_Before)
		const B_ETHGain_Asset = B_ETHBalance_After_Asset.sub(B_ETHBalance_Before_Asset)
		const B_VUSDGain = B_VUSDBalance_After.sub(B_VUSDBalance_Before)
		const C_ETHGain = C_ETHBalance_After.sub(C_ETHBalance_Before)
		const C_ETHGain_Asset = C_ETHBalance_After_Asset.sub(C_ETHBalance_Before_Asset)
		const C_VUSDGain = C_VUSDBalance_After.sub(C_VUSDBalance_Before)
		const D_ETHGain = D_ETHBalance_After.sub(D_ETHBalance_Before)
		const D_ETHGain_Asset = D_ETHBalance_After_Asset.sub(D_ETHBalance_Before_Asset)
		const D_VUSDGain = D_VUSDBalance_After.sub(D_VUSDBalance_Before)

		// Check gains match expected amounts
		assert.isAtMost(th.getDifference(expectedETHGain_A, A_ETHGain), 1000)
		assert.isAtMost(
			th.getDifference(expectedETHGain_A_Asset.div(toBN(10 ** 10)), A_ETHGain_Asset),
			1000
		)
		assert.isAtMost(th.getDifference(expectedETHGain_B, B_ETHGain), 1000)
		assert.isAtMost(
			th.getDifference(expectedETHGain_B_Asset.div(toBN(10 ** 10)), B_ETHGain_Asset),
			1000
		)
		assert.isAtMost(th.getDifference(expectedETHGain_C, C_ETHGain), 1000)
		assert.isAtMost(
			th.getDifference(expectedETHGain_C_Asset.div(toBN(10 ** 10)), C_ETHGain_Asset),
			1000
		)
		assert.isAtMost(th.getDifference(expectedETHGain_D, D_ETHGain), 1000)
		assert.isAtMost(
			th.getDifference(expectedETHGain_D_Asset.div(toBN(10 ** 10)), D_ETHGain_Asset),
			1000
		)

		assert.isAtMost(
			th.getDifference(expectedVUSDGain_A.add(expectedVUSDGain_A_Asset), A_VUSDGain),
			1000
		)
		assert.isAtMost(
			th.getDifference(expectedVUSDGain_B.add(expectedVUSDGain_B_Asset), B_VUSDGain),
			1000
		)
		assert.isAtMost(
			th.getDifference(expectedVUSDGain_C.add(expectedVUSDGain_C_Asset), C_VUSDGain),
			1000
		)
		assert.isAtMost(
			th.getDifference(expectedVUSDGain_D.add(expectedVUSDGain_D_Asset), D_VUSDGain),
			1000
		)
	})

	it("unstake(): reverts if caller has ETH gains and can't receive ETH", async () => {
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: whale },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(20000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: A },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(30000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: B },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(40000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: C },
		})
		await openVessel({
			asset: erc20.address,
			extraVUSDAmount: toBN(dec(50000, 18)),
			ICR: toBN(dec(2, 18)),
			extraParams: { from: D },
		})

		await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

		// multisig transfers GRVT to staker A and the non-payable proxy
		await grvtToken.transfer(A, dec(100, 18), { from: multisig })
		await grvtToken.transfer(nonPayable.address, dec(100, 18), { from: multisig })

		//  A makes stake
		const A_stakeTx = await grvtStaking.stake(dec(100, 18), { from: A })
		assert.isTrue(A_stakeTx.receipt.status)

		//  A tells proxy to make a stake
		const proxyApproveTxData = await th.getTransactionData("approve(address,uint256)", [
			grvtStaking.address,
			"0x56bc75e2d63100000",
		]) // proxy stakes 100 GRVT
		await nonPayable.forward(grvtToken.address, proxyApproveTxData, { from: A })

		const proxystakeTxData = await th.getTransactionData("stake(uint256)", [
			"0x56bc75e2d63100000",
		]) // proxy stakes 100 GRVT
		await nonPayable.forward(grvtStaking.address, proxystakeTxData, { from: A })

		// B makes a redemption, creating ETH gain for proxy
		await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18))
		await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18), erc20.address)

		assert.isTrue(
			(await grvtStaking.getPendingAssetGain(ZERO_ADDRESS, nonPayable.address)).gt(toBN("0"))
		)
		assert.isTrue(
			(await grvtStaking.getPendingAssetGain(erc20.address, nonPayable.address)).gt(toBN("0"))
		)

		// Expect this tx to revert: stake() tries to send nonPayable proxy's accumulated ETH gain (albeit 0),
		//  A tells proxy to unstake
		const proxyUnStakeTxData = await th.getTransactionData("unstake(uint256)", [
			"0x56bc75e2d63100000",
		]) // proxy stakes 100 GRVT
		const proxyUnstakeTxPromise = nonPayable.forward(grvtStaking.address, proxyUnStakeTxData, {
			from: A,
		})

		// but nonPayable proxy can not accept ETH - therefore stake() reverts.
		await assertRevert(proxyUnstakeTxPromise)
	})

	it("receive(): reverts when it receives ETH from an address that is not the Active Pool", async () => {
		const ethSendTxPromise1 = web3.eth.sendTransaction({
			to: grvtStaking.address,
			from: A,
			value: dec(1, "ether"),
		})
		const ethSendTxPromise2 = web3.eth.sendTransaction({
			to: grvtStaking.address,
			from: owner,
			value: dec(1, "ether"),
		})

		await assertRevert(ethSendTxPromise1)
		await assertRevert(ethSendTxPromise2)
	})

	it("unstake(): reverts if user has no stake", async () => {
		const unstakeTxPromise1 = grvtStaking.unstake(1, { from: A })
		const unstakeTxPromise2 = grvtStaking.unstake(1, { from: owner })

		await assertRevert(unstakeTxPromise1)
		await assertRevert(unstakeTxPromise2)
	})

	it("Test requireCallerIsVesselManager", async () => {
		const grvtStakingTester = await GRVTStakingTester.new()
		await assertRevert(
			grvtStakingTester.requireCallerIsVesselManager(),
			"GRVTStaking: caller is not VesselM"
		)
	})
})

