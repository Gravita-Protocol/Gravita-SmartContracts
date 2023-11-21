import { artifacts, assert, contract, ethers, network } from "hardhat"
import { time } from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256 } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper

const InterestIncurringTokenizedVault = artifacts.require("InterestIncurringTokenizedVault")

const f = (v: any) => ethers.utils.commify(ethers.utils.formatEther(v.toString()))
const bn = (v: any) => ethers.utils.parseEther(v.toString())

const debug = false

let contracts: any,
	adminContract: any,
	borrowerOperations: any,
	debtToken: any,
	erc20: any,
	feeCollector: any,
	priceFeed: any,
	sortedVessels: any,
	stabilityPool: any,
	vesselManager: any,
	vesselManagerOperations: any

const deploy = async (treasury: string, mintingAccounts: string[]) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	debtToken = contracts.core.debtToken
	erc20 = contracts.core.erc20
	feeCollector = contracts.core.feeCollector
	priceFeed = contracts.core.priceFeedTestnet
	sortedVessels = contracts.core.sortedVessels
	stabilityPool = contracts.core.stabilityPool
	vesselManager = contracts.core.vesselManager
	vesselManagerOperations = contracts.core.vesselManagerOperations
}

contract("InterestIncurringTokenizedVault", async accounts => {
	let snapshotId: number, initialSnapshotId: number
	const [treasury, alice, bob, carol, whale] = accounts
	let vault: any
	let interestRate, autoTransfer

	before(async () => {
		await deploy(treasury, [])

		interestRate = 200 // 2%
		autoTransfer = 30 * 86_400 // 30 days timeout

		vault = await InterestIncurringTokenizedVault.new(
			erc20.address,
			"InterestToken",
			"INTTKN",
			feeCollector.address,
			interestRate,
			autoTransfer
		)
		await vault.initialize()
		await adminContract.addNewCollateral(vault.address, bn(200), 18)
		await adminContract.setIsActive(vault.address, true)

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

	it("deposit and withdraw happy path", async () => {
		const assetAmountAlice = bn(100_000)
		const assetAmountBob = bn(200_000)
		const assetAmountCarol = bn(300_000)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.mint(bob, assetAmountBob)
		await erc20.mint(carol, assetAmountCarol)
		debug && console.log(`[alice] assets: ${f(await erc20.balanceOf(alice))}`)
		debug && console.log(`[bob] assets: ${f(await erc20.balanceOf(bob))}`)
		debug && console.log(`[carol] assets: ${f(await erc20.balanceOf(carol))}`)
		debug && console.log(`Approving...`)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await erc20.approve(vault.address, MaxUint256, { from: bob })
		await erc20.approve(vault.address, MaxUint256, { from: carol })
		debug && console.log(`Depositing...`)
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		await vault.deposit(assetAmountBob, bob, { from: bob })
		await vault.deposit(assetAmountCarol, carol, { from: carol })
		debug && console.log(`[alice] assets: ${f(await erc20.balanceOf(alice))}`)
		debug && console.log(`[alice] shares: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`[bob] assets: ${f(await erc20.balanceOf(bob))}`)
		debug && console.log(`[bob] shares: ${f(await vault.balanceOf(bob))}`)
		debug && console.log(`[carol] assets: ${f(await erc20.balanceOf(carol))}`)
		debug && console.log(`[carol] shares: ${f(await vault.balanceOf(carol))}`)
		debug && console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		debug && console.log(`Collecting...`)
		await vault.collectInterest()
		const assetAmountTreasury = await erc20.balanceOf(treasury)
		const expectedAssetAmountTreasury = bn(600_000 * 0.02) // 2% of total deposited
		debug && console.log(`[treasury] assets: ${f(assetAmountTreasury)}`)
		debug && console.log(`[treasury] shares: ${f(await vault.balanceOf(treasury))}`)
		assertIsApproximatelyEqual(assetAmountTreasury, expectedAssetAmountTreasury)
		debug && console.log(`Withdrawing...`)
		await vault.redeem(await vault.balanceOf(alice), alice, alice, { from: alice })
		await vault.redeem(await vault.balanceOf(bob), bob, bob, { from: bob })
		await vault.redeem(await vault.balanceOf(carol), carol, carol, { from: carol })
		assert.equal("0", await vault.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(bob))
		assert.equal("0", await vault.balanceOf(carol))
		const finalAssetAmountAlice = await erc20.balanceOf(alice)
		const expectedFinalAssetAmountAlice = bnMulDec(assetAmountAlice, 0.98)
		const finalAssetAmountBob = await erc20.balanceOf(bob)
		const expectedFinalAssetAmountBob = bnMulDec(assetAmountBob, 0.98)
		const finalAssetAmountCarol = await erc20.balanceOf(carol)
		const expectedFinalAssetAmountCarol = bnMulDec(assetAmountCarol, 0.98)
		debug && console.log(`[alice] assets: ${f(finalAssetAmountAlice)}`)
		debug && console.log(`[bob] assets: ${f(finalAssetAmountBob)}`)
		debug && console.log(`[carol] assets: ${f(finalAssetAmountCarol)}`)
		assertIsApproximatelyEqual(finalAssetAmountAlice, expectedFinalAssetAmountAlice)
		assertIsApproximatelyEqual(finalAssetAmountBob, expectedFinalAssetAmountBob)
		assertIsApproximatelyEqual(finalAssetAmountCarol, expectedFinalAssetAmountCarol)
	})

	it("5% interest rate, new shares should reflect discounts", async () => {
		debug && console.log(`Setting interest rate to 5%`)
		await vault.setInterestRate(500)
		debug && console.log(`[alice] deposits...`)
		const assetAmountAlice = bn(100_000)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		debug && console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		debug && console.log(`[bob] deposits...`)
		const assetAmountBob = bn(100_000)
		await erc20.mint(bob, assetAmountBob)
		await erc20.approve(vault.address, MaxUint256, { from: bob })
		await vault.deposit(assetAmountBob, bob, { from: bob })
		const assetsInVault = await vault.totalAssets()
		const shareAmountBob = await vault.balanceOf(bob)
		const expectedAssetsInVault = 100_000 + 100_000 * 0.95
		debug && console.log(`[vault] assets: ${f(assetsInVault)}`)
		assertIsApproximatelyEqual(assetsInVault, bn(expectedAssetsInVault))
		const assetProportionBob = 100_000 / expectedAssetsInVault
		const expectedShareAmountBob = bnMulDec(await vault.totalSupply(), assetProportionBob)
		debug && console.log(`[alice] shares: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`[bob] shares: ${f(shareAmountBob)} (actual)`)
		debug && console.log(`[bob] shares: ${f(expectedShareAmountBob.toString())} (expected)`)
		assertIsApproximatelyEqual(shareAmountBob, expectedShareAmountBob)
	})

	it("liquidating a vessel should unwrap underlying token to borrower and liquidator", async () => {
		assert.equal(await debtToken.balanceOf(treasury), "0")
		assert.equal(await erc20.balanceOf(treasury), "0")
		assert.equal(await vault.balanceOf(treasury), "0")

		// price starts at $2,000
		await priceFeed.setPrice(vault.address, bn(2_000))

		// whale opens a vessel & deposits in the SP
		const assetAmountWhale = bn(10_000)
		await erc20.mint(whale, assetAmountWhale)
		await erc20.approve(vault.address, MaxUint256, { from: whale })
		await vault.deposit(assetAmountWhale, whale, { from: whale })
		const vaultAmountwhale = await vault.balanceOf(whale)
		await vault.approve(borrowerOperations.address, MaxUint256, { from: whale })
		const loanAmountWhale = bn(200_000)
		await borrowerOperations.openVessel(vault.address, vaultAmountwhale, loanAmountWhale, AddressZero, AddressZero, {
			from: whale,
		})
		await stabilityPool.provideToSP(loanAmountWhale, [], { from: whale })

		// alice opens a vessel
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		const vaultAmountAlice = await vault.balanceOf(alice)
		const collValueAlice = bnMulDiv(vaultAmountAlice, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountAlice = bnMulDec(collValueAlice, 0.8) // 80% LTV
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		debug && console.log(`[vault] share price: $${f(await priceFeed.getPrice(vault.address))} USD`)
		debug && console.log(`[alice] shares: ${f(vaultAmountAlice)}`)
		debug && console.log(`[alice] collValue: $${f(collValueAlice)} USD`)
		debug && console.log(`[alice] loanAmount: $${f(loanAmountAlice)} GRAI`)
		await borrowerOperations.openVessel(vault.address, vaultAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

		// one year goes by
		await time.increase(365 * 86_400)

		// price drops to $1,500, reducing Alice's ICR below MCR
		await priceFeed.setPrice(vault.address, bn(1_500))

		// confirm system is not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, vault.address))

		// liquidate vessel
		const liquidator = carol
		await vesselManagerOperations.liquidate(vault.address, alice, { from: liquidator })

		// check the vessel is successfully closed, and removed from sortedList
		const status_Asset = (await vesselManager.Vessels(alice, vault.address))[th.VESSEL_STATUS_INDEX]
		const status_ClosedByLiquidation = "3"
		assert.equal(status_Asset.toString(), status_ClosedByLiquidation)
		assert.isFalse(await sortedVessels.contains(vault.address, alice))

		// liquidator earned some underlying (unwrapped) vault asset as gas compensation (~0,5%))
		const liquidatorErc20Balance = await erc20.balanceOf(liquidator)
		const expectedLiquidatorErc2Balance = bnMulDec(bnMulDec(assetAmountAlice, 0.98), 0.005)
		debug && console.log(`[liquidator] assets: ${f(liquidatorErc20Balance)} (actual)`)
		debug && console.log(`[liquidator] assets: ${f(expectedLiquidatorErc2Balance)} (expected)`)
		assertIsApproximatelyEqual(liquidatorErc20Balance, expectedLiquidatorErc2Balance)

		// whale earned vault gains from his deposit in the SP (expected to be alice's coll minus 0,5% liquidator's fee)
		const whaleVaultGains = (await stabilityPool.getDepositorGains(whale, [vault.address]))[1][0]
		const expectecWhaleVaultGains = bnMulDec(assetAmountAlice, 0.995)
		debug && console.log(`[whale] StabilityPool share gains: ${f(whaleVaultGains)} (actual)`)
		debug && console.log(`[whale] StabilityPool share gains: ${f(expectecWhaleVaultGains)} (expected)`)
		assertIsApproximatelyEqual(whaleVaultGains, expectecWhaleVaultGains)

		// no unwrapped erc20's should have been sent to the SP
		const spErc20Balance = await erc20.balanceOf(stabilityPool.address)
		debug && console.log(`StabilityPool asset balance: ${f(spErc20Balance)}`)
		assert.equal("0", spErc20Balance.toString())
	})

	it("entering the vault in different timelines should maintain share/asset proportions", async () => {
		// allow for an elastic error margin of 2% - which isn't an error, but a compound interest effect
		const errorMarginPercent = 2
		debug && console.log(`Setting interest rate to 4%`)
		const interestRate = 0.04
		await vault.setInterestRate(interestRate * 100_00)

		debug && console.log(`[alice] deposits...`)
		const assetAmountAlice = bn(100_000)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })

		debug && console.log(`... half a year goes by ...`)
		await time.increase(182.5 * 86_400)

		debug && console.log(`[alice] shares: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`[alice] assets: ${f(await vault.previewRedeem(await vault.balanceOf(alice)))}`)
		debug && console.log(`[vault] shares: ${f(await vault.totalSupply())}`)
		debug && console.log(`[vault] assets: ${f(await vault.totalAssets())}`)
		debug && console.log(`[treasury] assets: ${f(await erc20.balanceOf(treasury))}`)
		debug && console.log(`[treasury] collectable interest: ${f(await vault.getCollectableInterest())}`)

		debug && console.log(`[bob] deposits...`)
		const assetAmountBob = bn(100_000)
		await erc20.mint(bob, assetAmountBob)
		await erc20.approve(vault.address, MaxUint256, { from: bob })
		await vault.deposit(assetAmountBob, bob, { from: bob })

		debug && console.log(`... half a year goes by ...`)
		await time.increase(182.5 * 86_400)

		debug && console.log(`[carol] deposits...`)
		const assetAmountCarol = bn(100_000)
		await erc20.mint(carol, assetAmountCarol)
		await erc20.approve(vault.address, MaxUint256, { from: carol })
		await vault.deposit(assetAmountCarol, carol, { from: carol })

		debug && console.log(`[alice] shares: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`[alice] assets: ${f(await vault.previewRedeem(await vault.balanceOf(alice)))}`)
		debug && console.log(`[bob] shares: ${f(await vault.balanceOf(bob))}`)
		debug && console.log(`[bob] assets: ${f(await vault.previewRedeem(await vault.balanceOf(bob)))}`)
		debug && console.log(`[carol] shares: ${f(await vault.balanceOf(carol))}`)
		debug && console.log(`[carol] assets: ${f(await vault.previewRedeem(await vault.balanceOf(carol)))}`)
		debug && console.log(`[vault] shares: ${f(await vault.totalSupply())}`)
		debug && console.log(`[vault] assets: ${f(await vault.totalAssets())}`)
		debug && console.log(`[treasury] assets: ${f(await erc20.balanceOf(treasury))}`)
		debug && console.log(`[treasury] collectable interest: ${f(await vault.getCollectableInterest())}`)

		debug && console.log(`... half a year goes by ...`)
		await time.increase(182.5 * 86_400)

		debug && console.log(`[alice] withdraws...`)
		await vault.redeem(await vault.balanceOf(alice), alice, alice, { from: alice })
		const finalAssetAmountAlice = await erc20.balanceOf(alice)
		const interestRateAlice = interestRate * 1.5 // alice pays for one and a half year
		const expectedFinalAssetAmountAlice = bnMulDec(assetAmountAlice, 1 - interestRateAlice)
		debug && console.log(`[alice] assets: ${f(finalAssetAmountAlice)} (actual)`)
		debug && console.log(`[alice] assets: ${f(expectedFinalAssetAmountAlice)} (expected)`)
		assertIsApproximatelyEqual(finalAssetAmountAlice, expectedFinalAssetAmountAlice, errorMarginPercent)

		debug && console.log(`[bob] withdraws...`)
		await vault.redeem(await vault.balanceOf(bob), bob, bob, { from: bob })
		const finalAssetAmountBob = await erc20.balanceOf(bob)
		const interestRateBob = interestRate // bob pays for one year
		const expectedFinalAssetAmountBob = bnMulDec(assetAmountBob, 1 - interestRateBob)
		debug && console.log(`[bob] assets: ${f(finalAssetAmountBob)} (actual)`)
		debug && console.log(`[bob] assets: ${f(expectedFinalAssetAmountBob)} (expected)`)
		assertIsApproximatelyEqual(finalAssetAmountBob, expectedFinalAssetAmountBob, errorMarginPercent)

		debug && console.log(`... two years go by ...`)
		await time.increase(730 * 86_400)

		debug && console.log(`[carol] withdraws...`)
		await vault.redeem(await vault.balanceOf(carol), carol, carol, { from: carol })
		const finalAssetAmountCarol = await erc20.balanceOf(carol)
		const interestRateCarol = interestRate * 2.5 // carol pays for two and a half years
		const expectedFinalAssetAmountCarol = bnMulDec(assetAmountCarol, 1 - interestRateCarol)
		debug && console.log(`[carol] assets: ${f(finalAssetAmountCarol)} (actual)`)
		debug && console.log(`[carol] assets: ${f(expectedFinalAssetAmountCarol)} (expected)`)
		assertIsApproximatelyEqual(finalAssetAmountCarol, expectedFinalAssetAmountCarol, errorMarginPercent)

		const finalAssetAmountTreasury = await erc20.balanceOf(treasury)
		const expectedFinalAssetAmountTreasury = bnMulDec(assetAmountAlice, interestRateAlice)
			.add(bnMulDec(assetAmountBob, interestRateBob))
			.add(bnMulDec(assetAmountCarol, interestRateCarol))

		debug && console.log(`[treasury] assets: ${f(finalAssetAmountTreasury)} (actual)`)
		debug && console.log(`[treasury] assets: ${f(expectedFinalAssetAmountTreasury)} (expected)`)
		debug && console.log(`[treasury] collectable interest: ${f(await vault.getCollectableInterest())}`)

		assertIsApproximatelyEqual(finalAssetAmountTreasury, expectedFinalAssetAmountTreasury, errorMarginPercent)
	})

	it("adjusting and closing vessel should return unwrapped collateral to borrower", async () => {
		await priceFeed.setPrice(vault.address, bn(2_000))
		debug && console.log(`Setting interest rate to 4%`)
		await vault.setInterestRate(400)
		// whale opens a vessel
		const assetAmountWhale = bn(10_000)
		await erc20.mint(whale, assetAmountWhale)
		await erc20.approve(vault.address, MaxUint256, { from: whale })
		await vault.deposit(assetAmountWhale, whale, { from: whale })
		const vaultAmountwhale = await vault.balanceOf(whale)
		await vault.approve(borrowerOperations.address, MaxUint256, { from: whale })
		const loanAmountWhale = bn(200_000)
		await borrowerOperations.openVessel(vault.address, vaultAmountwhale, loanAmountWhale, AddressZero, AddressZero, {
			from: whale,
		})

		// alice opens a vessel
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		const vaultAmountAlice = await vault.balanceOf(alice)
		const collValueAlice = bnMulDiv(vaultAmountAlice, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountAlice = bnMulDec(collValueAlice, 0.8) // 80% LTV
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		debug && console.log(`[alice] opens vessel, borrowing $${f(loanAmountAlice)} GRAI...`)
		await borrowerOperations.openVessel(vault.address, vaultAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

		// half a year goes by
		await time.increase(182.5 * 86_400)

		// alice adjusts her vessel, withdrawing 50% of her collateral
		const collWithdrawAmount = bnMulDec(vaultAmountAlice, 0.5)
		const debtTokenChange = bnMulDec(loanAmountAlice, 0.5)
		assert.equal("0", await erc20.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(alice))
		debug && console.log(`[alice] adjusts vessel (50% payback + 50% coll withdraw)...`)
		await borrowerOperations.adjustVessel(
			vault.address,
			0,
			collWithdrawAmount,
			debtTokenChange,
			false,
			AddressZero,
			AddressZero,
			{
				from: alice,
			}
		)
		const assetBalanceAlice1 = await erc20.balanceOf(alice)
		const expectedAssetBalanceAlice1 = bnMulDec(assetAmountAlice, 0.5 * 0.98) // discount for 2% interest
		debug && console.log(`[alice] assets: ${f(assetBalanceAlice1)} (actual)`)
		debug && console.log(`[alice] assets: ${f(expectedAssetBalanceAlice1)} (expected)`)
		assert.equal("0", await vault.balanceOf(alice))
		assertIsApproximatelyEqual(assetBalanceAlice1, expectedAssetBalanceAlice1)

		// another half of a year goes by
		await time.increase(182.5 * 86_400)

		// alice closes her vessel
		const borrowingFeeAlice = bnMulDec(loanAmountAlice, 0.005)
		await debtToken.transfer(alice, borrowingFeeAlice, { from: whale }) // whale kindly transfers change for borrowing fee
		debug && console.log(`[alice] closes vessel...`)
		await borrowerOperations.closeVessel(vault.address, { from: alice })
		assert.equal("0", await vault.balanceOf(alice))
		const assetBalanceAlice2 = await erc20.balanceOf(alice)
		const expectedAssetBalanceAlice2 = bnMulDec(assetAmountAlice, 0.5 * 0.98).add(
			bnMulDec(assetAmountAlice, 0.5 * 0.96)
		) // half @ 2% + half @ 4%
		debug && console.log(`[alice] assets: ${f(assetBalanceAlice2)} (actual)`)
		debug && console.log(`[alice] assets: ${f(expectedAssetBalanceAlice2)} (expected)`)
		assert.equal("0", await vault.balanceOf(alice))
		assertIsApproximatelyEqual(assetBalanceAlice2, expectedAssetBalanceAlice2, 0.1)
	})

	it("compound interest on frequent checkpoints", async () => {
		const assetAmountAlice = bn(100_000)
		await erc20.mint(alice, assetAmountAlice)
		debug && console.log(`[alice] approves...`)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		debug && console.log(`[alice] deposits...`)
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		// collect interest on Alice's deposit each 6 hours for one year
		debug && console.log(`[treasury] collect interest every 6h for a year (compound effect)...`)
		for (let i = 1; i <= 1_460; i ++) {
			await time.increase(6 * 60 * 60)
			await vault.collectInterest()
		}
		// alice withdraws
		debug && console.log(`[alice] withdraws...`)
		await vault.redeem(await vault.balanceOf(alice), alice, alice, { from: alice })
		const compoundAssetAmountTreasury = await erc20.balanceOf(treasury)
		// make sure vault is empty (no assets generating interest)
		assert.equal("0", await vault.totalAssets())
		// now bob gets in
		const assetAmountBob = bn(100_000)
		await erc20.mint(bob, assetAmountBob)
		debug && console.log(`[bob] approves...`)
		await erc20.approve(vault.address, MaxUint256, { from: bob })
		debug && console.log(`[bob] deposits...`)
		await vault.deposit(assetAmountBob, bob, { from: bob })
		// one year goes by, no checkpoints
		debug && console.log(`[treasury] wait one year without collecting anything...`)
		await time.increase(365 * 86_400)
		// bob withdraws
		debug && console.log(`[bob] withdraws...`)
		await vault.redeem(await vault.balanceOf(bob), bob, bob, { from: bob })
		const finalAssetAmountTreasury = await erc20.balanceOf(treasury)
		const notCompoundAssetAmountTreasury = finalAssetAmountTreasury.sub(compoundAssetAmountTreasury)
		// compare, allowing for a 1% "loss" due to the logarithmic curve of the compound interest effect
		debug && console.log(`[treasury] assets: ${f(compoundAssetAmountTreasury)} (compound)`)
		debug && console.log(`[treasury] assets: ${f(notCompoundAssetAmountTreasury)} (not compound)`)
		assertIsApproximatelyEqual(compoundAssetAmountTreasury, notCompoundAssetAmountTreasury, 1)
	})
})

/**
 * Compares x and y, accepting a default error margin of 0.001%
 */
function assertIsApproximatelyEqual(x: any, y: any, errorPercent = 0.001) {
	const margin = Number(x) * (errorPercent / 100)
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, margin)
}

/**
 * Multiplies a BigNumber(ish) by a decimal
 */
function bnMulDec(x: any, y: number) {
	const precision = 1e12
	const multiplicand = BigNumber.from(x.toString())
	const multiplier = BigNumber.from(Math.floor(y * precision).toString())
	const divisor = BigNumber.from(precision)
	return multiplicand.mul(multiplier).div(divisor)
}

function bnMulDiv(x: any, y: any, z: any) {
	const xBn = BigNumber.from(x.toString())
	const yBn = BigNumber.from(y.toString())
	const zBn = BigNumber.from(z.toString())
	return xBn.mul(yBn).div(zBn)
}
