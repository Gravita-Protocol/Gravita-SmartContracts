const { web3 } = require("@openzeppelin/test-helpers/src/setup")
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const timeValues = testHelpers.TimeValues
const th = testHelpers.TestHelper
const { dec, toBN, assertRevert, ZERO_ADDRESS } = th

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

contract("LockedGRVTTest", async accounts => {
	const [owner, user, A, B, C, D, E, treasury] = accounts

	const SIX_MONTHS = toBN("15724800")
	const TWO_YEARS = toBN("63072000")

	let TOTAL_GRVT

	async function applyVestingFormula(vestingRule, ignoreClaimed) {
		const currentTime = toBN(await th.getLatestBlockTimestamp(web3))

		if (currentTime < vestingRule.startVestingDate.toString()) return toBN(0)

		if (currentTime >= vestingRule.endVestingDate.toString()) return vestingRule.totalSupply.sub(vestingRule.claimed)

		return vestingRule.totalSupply
			.div(TWO_YEARS)
			.mul(currentTime.sub(vestingRule.createdDate))
			.sub(ignoreClaimed ? vestingRule.claimed : toBN(0))
	}

	describe("Locked GRVT", async () => {
		before(async () => {
			await deploy(treasury)

			await grvtToken.approve(lockedGRVT.address, ethers.constants.MaxUint256, { from: treasury })

			await lockedGRVT.transferOwnership(treasury)
			TOTAL_GRVT = await grvtToken.balanceOf(treasury)

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

		it("Validate Time Constants", async () => {
			assert.equal((await lockedGRVT.SIX_MONTHS()).toString(), SIX_MONTHS)
			assert.equal((await lockedGRVT.TWO_YEARS()).toString(), TWO_YEARS)
		})

		it("addEntityVesting: called by user, valid inputs, revert transaction", async () => {
			await assertRevert(lockedGRVT.addEntityVesting(A, dec(100, 18), { from: user }))
		})

		it("addEntityVesting: called by owner, Invalid Address then Invalid Supply (too much), revert transaction", async () => {
			await assertRevert(lockedGRVT.addEntityVesting(ZERO_ADDRESS, dec(100, 18), { from: treasury }))
			await assertRevert(lockedGRVT.addEntityVesting(A, TOTAL_GRVT.add(toBN(1)), { from: treasury }))
		})

		it("addEntityVesting: called by owner, valid input, duplicated Entity, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })
			await assertRevert(lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury }))
		})

		it("addEntityVesting: called by owner, valid input, add entities", async () => {
			;[A, B, C].forEach(async element => {
				await lockedGRVT.addEntityVesting(element, dec(100, 18), { from: treasury })

				const entityVestingData = await lockedGRVT.entitiesVesting(element)

				assert.equal(entityVestingData.totalSupply.toString(), dec(100, 18))
				assert.isTrue(entityVestingData.createdDate.gt(0))
				assert.equal(entityVestingData.startVestingDate.toString(), entityVestingData.createdDate.add(SIX_MONTHS))
				assert.equal(entityVestingData.endVestingDate.toString(), entityVestingData.createdDate.add(TWO_YEARS))
				assert.equal(entityVestingData.claimed.toString(), 0)

				await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)
			})
		})

		it("lowerEntityVesting: called by user, valid inputs, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })
			await assertRevert(lockedGRVT.lowerEntityVesting(A, dec(70, 18), { from: user }))
		})

		it("lowerEntityVesting: called by owner, invalid entity, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })
			await assertRevert(lockedGRVT.lowerEntityVesting(B, dec(70, 18), { from: treasury }))
		})

		it("lowerEntityVesting: called by owner, new total supply goes <= total claimed, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })

			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)
			const claimable = await lockedGRVT.getClaimableGRVT(A)

			await assertRevert(lockedGRVT.lowerEntityVesting(A, claimable, { from: treasury }))
			await assertRevert(lockedGRVT.lowerEntityVesting(A, dec(2, 18), { from: treasury }))
		})

		it("lowerEntityVesting: called by owner, valid input, entity receives tokens and total is changed", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })

			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)
			const claimable = await lockedGRVT.getClaimableGRVT(A)
			const newTotal = claimable.add(toBN(dec(1, 18)))
			const entityVestingDataBefore = await lockedGRVT.entitiesVesting(A)

			await lockedGRVT.lowerEntityVesting(A, newTotal, { from: treasury })
			await assert.equal(
				(await grvtToken.balanceOf(A)).toString(),
				await applyVestingFormula(entityVestingDataBefore, true)
			)
			const entityVestingDataAfter = await lockedGRVT.entitiesVesting(A)

			await assert.equal(entityVestingDataAfter.totalSupply.toString(), newTotal)
			await assert.equal(entityVestingDataAfter.createdDate.toString(), entityVestingDataBefore.createdDate.toString())
			await assert.equal(
				entityVestingDataAfter.startVestingDate.toString(),
				entityVestingDataBefore.startVestingDate.toString()
			)
			await assert.equal(
				entityVestingDataAfter.endVestingDate.toString(),
				entityVestingDataBefore.endVestingDate.toString()
			)
			await assert.isTrue(entityVestingDataAfter.claimed.gt(entityVestingDataBefore.claimed))
		})

		it("removeEntityVesting: called by user, valid inputs, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })
			await assertRevert(lockedGRVT.removeEntityVesting(A, { from: user }))
		})

		it("removeEntityVesting: called by owner, Not valid Entity, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(100, 18), { from: treasury })
			await assertRevert(lockedGRVT.removeEntityVesting(B, { from: treasury }))
		})

		it("removeEntityVesting: called by owner, valid input, remove entity and pay due", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })
			await lockedGRVT.removeEntityVesting(A, { from: treasury })

			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			assert.equal(entityVestingData.totalSupply.toString(), 0)
			assert.equal(entityVestingData.createdDate.toString(), 0)
			assert.equal(entityVestingData.startVestingDate.toString(), 0)
			assert.equal(entityVestingData.endVestingDate.toString(), 0)
			assert.equal(entityVestingData.claimed.toString(), 0)

			await lockedGRVT.getClaimableGRVT(B)
			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)

			const claimable = await lockedGRVT.getClaimableGRVT(B)
			assert.isTrue(claimable.gt(toBN(0)))
			assert.equal((await grvtToken.balanceOf(B)).toString(), 0)

			await lockedGRVT.removeEntityVesting(B, { from: treasury })

			const entityVestingData_B = await lockedGRVT.entitiesVesting(B)
			assert.equal(entityVestingData_B.totalSupply.toString(), 0)
			assert.equal(entityVestingData_B.createdDate.toString(), 0)
			assert.equal(entityVestingData_B.startVestingDate.toString(), 0)
			assert.equal(entityVestingData_B.claimed.toString(), 0)

			assert.closeTo(th.getDifferenceEther(await grvtToken.balanceOf(B), claimable), 0, 1)
		})

		it("transferUnassignedGRVT: called by user, valid environment, revert transaction", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.removeEntityVesting(A, { from: treasury })

			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), dec(1, 24))
			await assertRevert(lockedGRVT.transferUnassignedGRVT({ from: user }))
		})

		it("transferUnassignedGRVT: called by owner, Add with 1M then Delete, recover 1M", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.removeEntityVesting(A, { from: treasury })

			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), dec(1, 24))

			const currentBalance = await grvtToken.balanceOf(treasury)
			await lockedGRVT.transferUnassignedGRVT({ from: treasury })
			assert.equal((await grvtToken.balanceOf(treasury)).toString(), currentBalance.add(toBN(dec(1, 24))))
		})

		it("transferUnassignedGRVT: called by owner, Add with 1M + 6 MONTHS + Delete, recover unassigned tokens", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)

			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			assert.equal((await lockedGRVT.getClaimableGRVT(A)).toString(), await applyVestingFormula(entityVestingData))
			await lockedGRVT.removeEntityVesting(A, { from: treasury })

			const toClaimCurrentBlock = await applyVestingFormula(entityVestingData)
			const unAssignedTotal = toBN(dec(1, 24)).sub(toClaimCurrentBlock)

			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), unAssignedTotal.toString())

			const currentBalance = await grvtToken.balanceOf(treasury)
			await lockedGRVT.transferUnassignedGRVT({ from: treasury })
			assert.equal((await grvtToken.balanceOf(treasury)).toString(), currentBalance.add(unAssignedTotal))
		})

		it("Vesting Formula 1M over (6 Months - 1 min), returns 0 claimable, unassign GRVT is 0", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(SIX_MONTHS.sub(toBN(60)), web3.currentProvider)
			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			assert.equal((await lockedGRVT.getClaimableGRVT(A)).toString(), await applyVestingFormula(entityVestingData))
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)

			assert.equal((await lockedGRVT.entitiesVesting(A)).claimed, 0)
			assert.equal((await lockedGRVT.entitiesVesting(B)).claimed, 0)
		})

		it("Vesting Formula 1M over 6 Months, returns ~250,000 claimable, unassign GRVT is 0", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)
			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			const claimable = (await lockedGRVT.getClaimableGRVT(A)).toString()
			assert.equal(claimable, await applyVestingFormula(entityVestingData))
			assert.closeTo(th.getDifferenceEther(claimable, dec(250000, 18)), 0, 1000)

			assert.equal((await grvtToken.balanceOf(A)).toString(), 0)
			await lockedGRVT.claimGRVTToken({ from: A })
			const currentBlockClaimData = await applyVestingFormula(entityVestingData)

			assert.equal((await grvtToken.balanceOf(A)).toString(), currentBlockClaimData)
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)

			assert.equal((await lockedGRVT.entitiesVesting(A)).claimed.toString(), currentBlockClaimData)
			assert.equal((await lockedGRVT.entitiesVesting(B)).claimed.toString(), 0)
		})

		it("Vesting Formula 1M over 1 Year, returns 500,000 claimable, unassign GRVT is 0", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(TWO_YEARS.div(toBN(2)), web3.currentProvider)
			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			const claimable = (await lockedGRVT.getClaimableGRVT(A)).toString()
			assert.equal(claimable, await applyVestingFormula(entityVestingData))
			assert.closeTo(th.getDifferenceEther(claimable, dec("500000", 18)), 0, 1)

			assert.equal((await grvtToken.balanceOf(A)).toString(), 0)

			await lockedGRVT.claimGRVTToken({ from: A })
			const currentBlockClaimData = await applyVestingFormula(entityVestingData)

			assert.equal((await grvtToken.balanceOf(A)).toString(), currentBlockClaimData)
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)

			assert.equal((await lockedGRVT.entitiesVesting(A)).claimed.toString(), currentBlockClaimData)
			assert.equal((await lockedGRVT.entitiesVesting(B)).claimed.toString(), 0)
		})

		it("Vesting Formula 1M over 1.5 Year, returns 750,000 claimable, unassign GRVT is 0", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(TWO_YEARS.div(toBN(2)).add(SIX_MONTHS), web3.currentProvider)
			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			const claimable = (await lockedGRVT.getClaimableGRVT(A)).toString()
			assert.equal(claimable, await applyVestingFormula(entityVestingData))
			assert.closeTo(th.getDifferenceEther(claimable, dec("750000", 18)), 0, 1000)

			assert.equal((await grvtToken.balanceOf(A)).toString(), 0)
			await lockedGRVT.claimGRVTToken({ from: A })
			const currentBlockClaimData = await applyVestingFormula(entityVestingData)

			assert.equal((await grvtToken.balanceOf(A)).toString(), currentBlockClaimData)
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)
			assert.equal((await lockedGRVT.entitiesVesting(A)).claimed.toString(), currentBlockClaimData)
			assert.equal((await lockedGRVT.entitiesVesting(B)).claimed.toString(), 0)
		})

		it("Vesting Formula 1M over 2 Year, returns 1M claimable, unassign GRVT is 0", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(TWO_YEARS, web3.currentProvider)
			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			const claimable = (await lockedGRVT.getClaimableGRVT(A)).toString()
			assert.equal(claimable, (await applyVestingFormula(entityVestingData)).toString())
			assert.closeTo(th.getDifferenceEther(claimable, dec(1, 24)), 0, 1000)

			assert.equal((await grvtToken.balanceOf(A)).toString(), 0)
			await lockedGRVT.claimGRVTToken({ from: A })

			assert.equal((await grvtToken.balanceOf(A)).toString(), dec(1, 24))
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)
			assert.equal((await lockedGRVT.entitiesVesting(A)).claimed.toString(), dec(1, 24))
			assert.equal((await lockedGRVT.entitiesVesting(B)).claimed.toString(), 0)

			assert.equal((await grvtToken.balanceOf(lockedGRVT.address)).toString(), dec(1, 24))
		})

		it("Vesting Formula 1M over 4 Year, returns 1M claimable, unassign GRVT is 0", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })

			await th.fastForwardTime(TWO_YEARS.mul(toBN(2)), web3.currentProvider)
			const entityVestingData = await lockedGRVT.entitiesVesting(A)

			const claimable = (await lockedGRVT.getClaimableGRVT(A)).toString()
			assert.equal(claimable, (await applyVestingFormula(entityVestingData)).toString())
			assert.closeTo(th.getDifferenceEther(claimable, dec(1, 24)), 0, 1000)

			assert.equal((await grvtToken.balanceOf(A)).toString(), 0)
			await lockedGRVT.claimGRVTToken({ from: A })

			assert.equal((await grvtToken.balanceOf(A)).toString(), dec(1, 24))
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)
			assert.equal((await lockedGRVT.entitiesVesting(A)).claimed.toString(), dec(1, 24))
			assert.equal((await lockedGRVT.entitiesVesting(B)).claimed.toString(), 0)

			assert.equal((await grvtToken.balanceOf(lockedGRVT.address)).toString(), dec(1, 24))
		})

		it("Vesting Formula 1M over 2 Years multiple claiming with deleted Entity in the way", async () => {
			await lockedGRVT.addEntityVesting(A, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(B, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(C, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(D, dec(1, 24), { from: treasury })
			await lockedGRVT.addEntityVesting(E, dec(1, 24), { from: treasury })

			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)
			await lockedGRVT.claimGRVTToken({ from: A })
			await lockedGRVT.claimGRVTToken({ from: D })

			await lockedGRVT.removeEntityVesting(C, { from: treasury })
			await lockedGRVT.transferUnassignedGRVT({ from: treasury })

			await th.fastForwardTime(SIX_MONTHS, web3.currentProvider)
			await lockedGRVT.claimGRVTToken({ from: A })
			await lockedGRVT.claimGRVTToken({ from: B })

			await lockedGRVT.removeEntityVesting(D, { from: treasury })
			await lockedGRVT.transferUnassignedGRVT({ from: treasury })

			await lockedGRVT.removeEntityVesting(E, { from: treasury })
			await lockedGRVT.transferUnassignedGRVT({ from: treasury })

			let entityVestingData = await lockedGRVT.entitiesVesting(A)
			let entityVestingData_B = await lockedGRVT.entitiesVesting(B)

			assert.equal((await grvtToken.balanceOf(A)).toString(), (await grvtToken.balanceOf(B)).toString())
			assert.equal(entityVestingData.claimed.toString(), entityVestingData_B.claimed.toString())

			await th.fastForwardTime(TWO_YEARS.sub(SIX_MONTHS.mul(toBN(2))), web3.currentProvider)

			await lockedGRVT.claimGRVTToken({ from: A })
			await lockedGRVT.claimGRVTToken({ from: B })

			assert.equal((await grvtToken.balanceOf(A)).toString(), dec(1, 24))
			assert.equal((await grvtToken.balanceOf(B)).toString(), dec(1, 24))

			assert.equal((await grvtToken.balanceOf(lockedGRVT.address)).toString(), 0)
			assert.equal((await lockedGRVT.getUnassignGRVTTokensAmount()).toString(), 0)
		})
	})
})

contract("Reset chain state", async accounts => {})