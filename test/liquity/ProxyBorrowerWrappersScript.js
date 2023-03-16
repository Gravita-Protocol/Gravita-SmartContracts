// const deploymentHelper = require("../../utils/deploymentHelpers.js")
// const testHelpers = require("../../utils/testHelpers.js")

// const VesselManagerTester = artifacts.require("VesselManagerTester")
// const GRVTTokenTester = artifacts.require("GRVTTokenTester")

// const th = testHelpers.TestHelper

// const dec = th.dec
// const toBN = th.toBN
// const mv = testHelpers.MoneyValues
// const timeValues = testHelpers.TimeValues

// const ZERO_ADDRESS = th.ZERO_ADDRESS
// const assertRevert = th.assertRevert

// const {
//   buildUserProxies,
//   BorrowerOperationsProxy,
//   BorrowerWrappersProxy,
//   VesselManagerProxy,
//   StabilityPoolProxy,
//   SortedVesselsProxy,
//   TokenProxy,
//   GRVTStakingProxy
// } = require('../../utils/proxyHelpers.js')

// contract('BorrowerWrappers', async accounts => {

//   const [
//     owner, alice, bob, carol, dennis, whale,
//     A, B, C, D, E,
//     defaulter_1, defaulter_2,
//     // frontEnd_1, frontEnd_2, frontEnd_3
//   ] = accounts;

//   const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

//   let priceFeed
//   let vusdToken
//   let sortedVessels
//   let vesselManagerOriginal
//   let vesselManager
//   let activePool
//   let stabilityPool
//   let defaultPool
//   let collSurplusPool
//   let borrowerOperations
//   let borrowerWrappers
//   let grvtTokenOriginal
//   let grvtToken
//   let grvtStaking

//   let contracts

//   let VUSD_GAS_COMPENSATION

//   const getOpenVesselVUSDAmount = async (asset, totalDebt) => th.getOpenVesselVUSDAmount(contracts, totalDebt, asset)
//   const getActualDebtFromComposite = async (compositeDebt) => th.getActualDebtFromComposite(compositeDebt, contracts)
//   const getNetBorrowingAmount = async (asset, debtWithFee) => th.getNetBorrowingAmount(contracts, debtWithFee, asset)
//   const openVessel = async (params) => th.openVessel(contracts, params)

//   beforeEach(async () => {
//     contracts = await deploymentHelper.deployLiquityCore()
//     contracts.vesselManager = await VesselManagerTester.new()
//     contracts = await deploymentHelper.deployVUSDToken(contracts)
//     const GRVTContracts = await deploymentHelper.deployGRVTContractsHardhat(accounts[0])

//     await deploymentHelper.connectCoreContracts(contracts, GRVTContracts)
//     await deploymentHelper.connectGRVTContractsToCore(GRVTContracts, contracts)

//     vesselManagerOriginal = contracts.vesselManager
//     grvtTokenOriginal = GRVTContracts.grvtToken

//     const users = [alice, bob, carol, dennis, whale, A, B, C, D, E, defaulter_1, defaulter_2]
//     await deploymentHelper.deployProxyScripts(contracts, GRVTContracts, owner, users)

//     priceFeed = contracts.priceFeedTestnet
//     vusdToken = contracts.vusdToken
//     sortedVessels = contracts.sortedVessels
//     vesselManager = contracts.vesselManager
//     activePool = contracts.activePool
//     stabilityPool = contracts.stabilityPool
//     defaultPool = contracts.defaultPool
//     collSurplusPool = contracts.collSurplusPool
//     borrowerOperations = contracts.borrowerOperations
//     borrowerWrappers = contracts.borrowerWrappers
//     grvtStaking = GRVTContracts.grvtStaking
//     grvtToken = GRVTContracts.grvtToken

//     VUSD_GAS_COMPENSATION = await borrowerOperations.VUSD_GAS_COMPENSATION()
//   })

//   it('proxy owner can recover ETH', async () => {
//     const amount = toBN(dec(1, 18))
//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)

//     // send some ETH to proxy
//     await web3.eth.sendTransaction({ from: owner, to: proxyAddress, value: amount })
//     assert.equal(await web3.eth.getBalance(proxyAddress), amount.toString())

//     const balanceBefore = toBN(await web3.eth.getBalance(alice))

//     // recover ETH
//     await borrowerWrappers.transferETH(alice, amount, { from: alice, gasPrice: 0 })
//     const balanceAfter = toBN(await web3.eth.getBalance(alice))

//     assert.equal(balanceAfter.sub(balanceBefore), amount.toString())
//   })

//   it('non proxy owner cannot recover ETH', async () => {
//     const amount = toBN(dec(1, 18))
//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)

//     // send some ETH to proxy
//     await web3.eth.sendTransaction({ from: owner, to: proxyAddress, value: amount })
//     assert.equal(await web3.eth.getBalance(proxyAddress), amount.toString())

//     const balanceBefore = toBN(await web3.eth.getBalance(alice))

//     // try to recover ETH
//     const proxy = borrowerWrappers.getProxyFromUser(alice)
//     const signature = 'transferETH(address,uint256)'
//     const calldata = th.getTransactionData(signature, [alice, amount])
//     await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')

//     assert.equal(await web3.eth.getBalance(proxyAddress), amount.toString())

//     const balanceAfter = toBN(await web3.eth.getBalance(alice))
//     assert.equal(balanceAfter, balanceBefore.toString())
//   })

//   // --- claimCollateralAndOpenVessel ---

//   it('claimCollateralAndOpenVessel(): reverts if nothing to claim', async () => {
//     // Whale opens Vessel
//     await openVessel({ ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

//     // alice opens Vessel
//     const { VUSDAmount, collateral } = await openVessel({ ICR: toBN(dec(15, 17)), extraParams: { from: alice } })

//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // alice claims collateral and re-opens the vessel
//     await assertRevert(
//       borrowerWrappers.claimCollateralAndOpenVessel(th._100pct, VUSDAmount, alice, alice, { from: alice }),
//       'CollSurplusPool: No collateral available to claim'
//     )

//     // check everything remain the same
//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')
//     th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), '0')
//     th.assertIsApproximatelyEqual(await vusdToken.balanceOf(proxyAddress), VUSDAmount)
//     assert.equal(await vesselManager.getVesselStatus(proxyAddress), 1)
//     th.assertIsApproximatelyEqual(await vesselManager.getVesselColl(ZERO_ADDRESS, proxyAddress), collateral)
//   })

//   it('claimCollateralAndOpenVessel(): without sending any value', async () => {
//     // alice opens Vessel
//     const { VUSDAmount, netDebt: redeemAmount, collateral } = await openVessel({ extraVUSDAmount: 0, ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: redeemAmount, ICR: toBN(dec(5, 18)), extraParams: { from: whale } })

//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // whale redeems 150 VUSD
//     await th.redeemCollateral(whale, contracts, redeemAmount)
//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')

//     // surplus: 5 - 150/200
//     const price = await priceFeed.getPrice();
//     const expectedSurplus = collateral.sub(redeemAmount.mul(mv._1e18BN).div(price))
//     th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), expectedSurplus)
//     assert.equal(await vesselManager.getVesselStatus(proxyAddress), 4) // closed by redemption

//     // alice claims collateral and re-opens the vessel
//     await borrowerWrappers.claimCollateralAndOpenVessel(th._100pct, VUSDAmount, alice, alice, { from: alice })

//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')
//     th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), '0')
//     th.assertIsApproximatelyEqual(await vusdToken.balanceOf(proxyAddress), VUSDAmount.mul(toBN(2)))
//     assert.equal(await vesselManager.getVesselStatus(proxyAddress), 1)
//     th.assertIsApproximatelyEqual(await vesselManager.getVesselColl(ZERO_ADDRESS, proxyAddress), expectedSurplus)
//   })

//   it('claimCollateralAndOpenVessel(): sending value in the transaction', async () => {
//     // alice opens Vessel
//     const { VUSDAmount, netDebt: redeemAmount, collateral } = await openVessel({ extraParams: { from: alice } })
//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: redeemAmount, ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // whale redeems 150 VUSD
//     await th.redeemCollateral(whale, contracts, redeemAmount)
//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')

//     // surplus: 5 - 150/200
//     const price = await priceFeed.getPrice();
//     const expectedSurplus = collateral.sub(redeemAmount.mul(mv._1e18BN).div(price))
//     th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), expectedSurplus)
//     assert.equal(await vesselManager.getVesselStatus(proxyAddress), 4) // closed by redemption

//     // alice claims collateral and re-opens the vessel
//     await borrowerWrappers.claimCollateralAndOpenVessel(th._100pct, VUSDAmount, alice, alice, { from: alice, value: collateral })

//     assert.equal(await web3.eth.getBalance(proxyAddress), '0')
//     th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), '0')
//     th.assertIsApproximatelyEqual(await vusdToken.balanceOf(proxyAddress), VUSDAmount.mul(toBN(2)))
//     assert.equal(await vesselManager.getVesselStatus(proxyAddress), 1)
//     th.assertIsApproximatelyEqual(await vesselManager.getVesselColl(ZERO_ADDRESS, proxyAddress), expectedSurplus.add(collateral))
//   })

//   // --- claimSPRewardsAndRecycle ---

//   it('claimSPRewardsAndRecycle(): only owner can call it', async () => {
//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
//     // Whale deposits 1850 VUSD in StabilityPool
//     await stabilityPool.provideToSP(dec(1850, 18), ZERO_ADDRESS, { from: whale })

//     // alice opens vessel and provides 150 VUSD to StabilityPool
//     await openVessel({ extraVUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
//     await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

//     // Defaulter Vessel opened
//     await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

//     // price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
//     const price = toBN(dec(100, 18))
//     await priceFeed.setPrice(price);

//     // Defaulter vessel closed
//     const liquidationTX_1 = await vesselManager.liquidate(defaulter_1, { from: owner })
//     const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)

//     // Bob tries to claims SP rewards in behalf of Alice
//     const proxy = borrowerWrappers.getProxyFromUser(alice)
//     const signature = 'claimSPRewardsAndRecycle(uint256,address,address)'
//     const calldata = th.getTransactionData(signature, [th._100pct, alice, alice])
//     await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')
//   })

//   it('claimSPRewardsAndRecycle():', async () => {
//     // Whale opens Vessel
//     const whaleDeposit = toBN(dec(2350, 18))
//     await openVessel({ extraVUSDAmount: whaleDeposit, ICR: toBN(dec(4, 18)), extraParams: { from: whale } })
//     // Whale deposits 1850 VUSD in StabilityPool
//     await stabilityPool.provideToSP(whaleDeposit, ZERO_ADDRESS, { from: whale })

//     // alice opens vessel and provides 150 VUSD to StabilityPool
//     const aliceDeposit = toBN(dec(150, 18))
//     await openVessel({ extraVUSDAmount: aliceDeposit, ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
//     await stabilityPool.provideToSP(aliceDeposit, ZERO_ADDRESS, { from: alice })

//     // Defaulter Vessel opened
//     const { VUSDAmount, netDebt, collateral } = await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

//     // price drops: defaulters' Vessels fall below MCR, alice and whale Vessel remain active
//     const price = toBN(dec(100, 18))
//     await priceFeed.setPrice(price);

//     // Defaulter vessel closed
//     const liquidationTX_1 = await vesselManager.liquidate(defaulter_1, { from: owner })
//     const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)

//     // Alice VUSDLoss is ((150/2500) * liquidatedDebt)
//     const totalDeposits = whaleDeposit.add(aliceDeposit)
//     const expectedVUSDLoss_A = liquidatedDebt_1.mul(aliceDeposit).div(totalDeposits)

//     const expectedCompoundedVUSDDeposit_A = toBN(dec(150, 18)).sub(expectedVUSDLoss_A)
//     const compoundedVUSDDeposit_A = await stabilityPool.getCompoundedDebtTokenDeposits(alice)
//     // collateral * 150 / 2500 * 0.995
//     const expectedETHGain_A = collateral.mul(aliceDeposit).div(totalDeposits).mul(toBN(dec(995, 15))).div(mv._1e18BN)

//     assert.isAtMost(th.getDifference(expectedCompoundedVUSDDeposit_A, compoundedVUSDDeposit_A), 1000)

//     const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollBefore = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceBefore = await vusdToken.balanceOf(alice)
//     const vesselDebtBefore = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceBefore = await grvtToken.balanceOf(alice)
//     const ICRBefore = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositBefore = (await stabilityPool.deposits(alice))[0]
//     const stakeBefore = await grvtStaking.stakes(alice)

//     const proportionalVUSD = expectedETHGain_A.mul(price).div(ICRBefore)
//     const borrowingRate = await vesselManagerOriginal.getBorrowingRateWithDecay()
//     const netDebtChange = proportionalVUSD.mul(mv._1e18BN).div(mv._1e18BN.add(borrowingRate))

//     // to force GRVT issuance
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     const expectedGRVTGain_A = toBN('50373424199406504708132')

//     await priceFeed.setPrice(price.mul(toBN(2)));

//     // Alice claims SP rewards and puts them back in the system through the proxy
//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
//     await borrowerWrappers.claimSPRewardsAndRecycle(th._100pct, alice, alice, { from: alice })

//     const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollAfter = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceAfter = await vusdToken.balanceOf(alice)
//     const vesselDebtAfter = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceAfter = await grvtToken.balanceOf(alice)
//     const ICRAfter = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositAfter = (await stabilityPool.deposits(alice))[0]
//     const stakeAfter = await grvtStaking.stakes(alice)

//     // check proxy balances remain the same
//     assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
//     assert.equal(VUSDBalanceAfter.toString(), VUSDBalanceBefore.toString())
//     assert.equal(GRVTBalanceAfter.toString(), GRVTBalanceBefore.toString())
//     // check vessel has increased debt by the ICR proportional amount to ETH gain
//     th.assertIsApproximatelyEqual(vesselDebtAfter, vesselDebtBefore.add(proportionalVUSD))
//     // check vessel has increased collateral by the ETH gain
//     th.assertIsApproximatelyEqual(vesselCollAfter, vesselCollBefore.add(expectedETHGain_A))
//     // check that ICR remains constant
//     th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
//     // check that Stability Pool deposit
//     th.assertIsApproximatelyEqual(depositAfter, depositBefore.sub(expectedVUSDLoss_A).add(netDebtChange))
//     // check GRVT balance remains the same
//     th.assertIsApproximatelyEqual(GRVTBalanceAfter, GRVTBalanceBefore)

//     // GRVT staking
//     th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedGRVTGain_A))

//     // Expect Alice has withdrawn all ETH gain
//     const alice_pendingETHGain = await stabilityPool.getDepositorETHGain(alice)
//     assert.equal(alice_pendingETHGain, 0)
//   })

//   // --- claimStakingGainsAndRecycle ---

//   it('claimStakingGainsAndRecycle(): only owner can call it', async () => {
//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

//     // alice opens vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })

//     // mint some GRVT
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

//     // stake GRVT
//     await grvtStaking.stake(dec(1850, 18), { from: whale })
//     await grvtStaking.stake(dec(150, 18), { from: alice })

//     // Defaulter Vessel opened
//     const { VUSDAmount, netDebt, totalDebt, collateral } = await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // whale redeems 100 VUSD
//     const redeemedAmount = toBN(dec(100, 18))
//     await th.redeemCollateral(whale, contracts, redeemedAmount)

//     // Bob tries to claims staking gains in behalf of Alice
//     const proxy = borrowerWrappers.getProxyFromUser(alice)
//     const signature = 'claimStakingGainsAndRecycle(uint256,address,address)'
//     const calldata = th.getTransactionData(signature, [th._100pct, alice, alice])
//     await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')
//   })

//   it('claimStakingGainsAndRecycle(): reverts if user has no vessel', async () => {
//     const price = toBN(dec(200, 18))

//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
//     // Whale deposits 1850 VUSD in StabilityPool
//     await stabilityPool.provideToSP(dec(1850, 18), ZERO_ADDRESS, { from: whale })

//     // alice opens vessel and provides 150 VUSD to StabilityPool
//     //await openVessel({ extraVUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
//     //await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

//     // mint some GRVT
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

//     // stake GRVT
//     await grvtStaking.stake(dec(1850, 18), { from: whale })
//     await grvtStaking.stake(dec(150, 18), { from: alice })

//     // Defaulter Vessel opened
//     const { VUSDAmount, netDebt, totalDebt, collateral } = await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
//     const borrowingFee = netDebt.sub(VUSDAmount)

//     // Alice VUSD gain is ((150/2000) * borrowingFee)
//     const expectedVUSDGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // whale redeems 100 VUSD
//     const redeemedAmount = toBN(dec(100, 18))
//     await th.redeemCollateral(whale, contracts, redeemedAmount)

//     const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollBefore = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceBefore = await vusdToken.balanceOf(alice)
//     const vesselDebtBefore = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceBefore = await grvtToken.balanceOf(alice)
//     const ICRBefore = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositBefore = (await stabilityPool.deposits(alice))[0]
//     const stakeBefore = await grvtStaking.stakes(alice)

//     // Alice claims staking rewards and puts them back in the system through the proxy
//     await assertRevert(
//       borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, { from: alice }),
//       'BorrowerWrappersScript: caller must have an active vessel'
//     )

//     const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollAfter = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceAfter = await vusdToken.balanceOf(alice)
//     const vesselDebtAfter = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceAfter = await grvtToken.balanceOf(alice)
//     const ICRAfter = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositAfter = (await stabilityPool.deposits(alice))[0]
//     const stakeAfter = await grvtStaking.stakes(alice)

//     // check everything remains the same
//     assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
//     assert.equal(VUSDBalanceAfter.toString(), VUSDBalanceBefore.toString())
//     assert.equal(GRVTBalanceAfter.toString(), GRVTBalanceBefore.toString())
//     th.assertIsApproximatelyEqual(vesselDebtAfter, vesselDebtBefore, 10000)
//     th.assertIsApproximatelyEqual(vesselCollAfter, vesselCollBefore)
//     th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
//     th.assertIsApproximatelyEqual(depositAfter, depositBefore, 10000)
//     th.assertIsApproximatelyEqual(GRVTBalanceBefore, GRVTBalanceAfter)
//     // GRVT staking
//     th.assertIsApproximatelyEqual(stakeAfter, stakeBefore)

//     // Expect Alice has withdrawn all ETH gain
//     const alice_pendingETHGain = await stabilityPool.getDepositorETHGain(alice)
//     assert.equal(alice_pendingETHGain, 0)
//   })

//   it('claimStakingGainsAndRecycle(): with only ETH gain', async () => {
//     const price = toBN(dec(200, 18))

//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

//     // Defaulter Vessel opened
//     const { VUSDAmount, netDebt, collateral } = await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
//     const borrowingFee = netDebt.sub(VUSDAmount)

//     // alice opens vessel and provides 150 VUSD to StabilityPool
//     await openVessel({ extraVUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
//     await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

//     // mint some GRVT
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

//     // stake GRVT
//     await grvtStaking.stake(dec(1850, 18), { from: whale })
//     await grvtStaking.stake(dec(150, 18), { from: alice })

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // whale redeems 100 VUSD
//     const redeemedAmount = toBN(dec(100, 18))
//     await th.redeemCollateral(whale, contracts, redeemedAmount)

//     // Alice ETH gain is ((150/2000) * (redemption fee over redeemedAmount) / price)
//     const redemptionFee = await vesselManager.getRedemptionFeeWithDecay(redeemedAmount)
//     const expectedETHGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(mv._1e18BN).div(price)

//     const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollBefore = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceBefore = await vusdToken.balanceOf(alice)
//     const vesselDebtBefore = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceBefore = await grvtToken.balanceOf(alice)
//     const ICRBefore = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositBefore = (await stabilityPool.deposits(alice))[0]
//     const stakeBefore = await grvtStaking.stakes(alice)

//     const proportionalVUSD = expectedETHGain_A.mul(price).div(ICRBefore)
//     const borrowingRate = await vesselManagerOriginal.getBorrowingRateWithDecay()
//     const netDebtChange = proportionalVUSD.mul(toBN(dec(1, 18))).div(toBN(dec(1, 18)).add(borrowingRate))

//     const expectedGRVTGain_A = toBN('839557069990108416000000')

//     const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
//     // Alice claims staking rewards and puts them back in the system through the proxy
//     await borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, { from: alice })

//     // Alice new VUSD gain due to her own Vessel adjustment: ((150/2000) * (borrowing fee over netDebtChange))
//     const newBorrowingFee = await vesselManagerOriginal.getBorrowingFeeWithDecay(netDebtChange)
//     const expectedNewVUSDGain_A = newBorrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

//     const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollAfter = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceAfter = await vusdToken.balanceOf(alice)
//     const vesselDebtAfter = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceAfter = await grvtToken.balanceOf(alice)
//     const ICRAfter = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositAfter = (await stabilityPool.deposits(alice))[0]
//     const stakeAfter = await grvtStaking.stakes(alice)

//     // check proxy balances remain the same
//     assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
//     assert.equal(GRVTBalanceAfter.toString(), GRVTBalanceBefore.toString())
//     // check proxy VUSD balance has increased by own adjust vessel reward
//     th.assertIsApproximatelyEqual(VUSDBalanceAfter, VUSDBalanceBefore.add(expectedNewVUSDGain_A))
//     // check vessel has increased debt by the ICR proportional amount to ETH gain
//     th.assertIsApproximatelyEqual(vesselDebtAfter, vesselDebtBefore.add(proportionalVUSD), 10000)
//     // check vessel has increased collateral by the ETH gain
//     th.assertIsApproximatelyEqual(vesselCollAfter, vesselCollBefore.add(expectedETHGain_A))
//     // check that ICR remains constant
//     th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
//     // check that Stability Pool deposit
//     th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(netDebtChange), 10000)
//     // check GRVT balance remains the same
//     th.assertIsApproximatelyEqual(GRVTBalanceBefore, GRVTBalanceAfter)

//     // GRVT staking
//     th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedGRVTGain_A))

//     // Expect Alice has withdrawn all ETH gain
//     const alice_pendingETHGain = await stabilityPool.getDepositorETHGain(alice)
//     assert.equal(alice_pendingETHGain, 0)
//   })

//   it('claimStakingGainsAndRecycle(): with only VUSD gain', async () => {
//     const price = toBN(dec(200, 18))

//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

//     // alice opens vessel and provides 150 VUSD to StabilityPool
//     await openVessel({ extraVUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
//     await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

//     // mint some GRVT
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

//     // stake GRVT
//     await grvtStaking.stake(dec(1850, 18), { from: whale })
//     await grvtStaking.stake(dec(150, 18), { from: alice })

//     // Defaulter Vessel opened
//     const { VUSDAmount, netDebt, collateral } = await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
//     const borrowingFee = netDebt.sub(VUSDAmount)

//     // Alice VUSD gain is ((150/2000) * borrowingFee)
//     const expectedVUSDGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

//     const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollBefore = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceBefore = await vusdToken.balanceOf(alice)
//     const vesselDebtBefore = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceBefore = await grvtToken.balanceOf(alice)
//     const ICRBefore = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositBefore = (await stabilityPool.deposits(alice))[0]
//     const stakeBefore = await grvtStaking.stakes(alice)

//     const borrowingRate = await vesselManagerOriginal.getBorrowingRateWithDecay()

//     // Alice claims staking rewards and puts them back in the system through the proxy
//     await borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, { from: alice })

//     const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollAfter = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceAfter = await vusdToken.balanceOf(alice)
//     const vesselDebtAfter = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceAfter = await grvtToken.balanceOf(alice)
//     const ICRAfter = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositAfter = (await stabilityPool.deposits(alice))[0]
//     const stakeAfter = await grvtStaking.stakes(alice)

//     // check proxy balances remain the same
//     assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
//     assert.equal(GRVTBalanceAfter.toString(), GRVTBalanceBefore.toString())
//     // check proxy VUSD balance has increased by own adjust vessel reward
//     th.assertIsApproximatelyEqual(VUSDBalanceAfter, VUSDBalanceBefore)
//     // check vessel has increased debt by the ICR proportional amount to ETH gain
//     th.assertIsApproximatelyEqual(vesselDebtAfter, vesselDebtBefore, 10000)
//     // check vessel has increased collateral by the ETH gain
//     th.assertIsApproximatelyEqual(vesselCollAfter, vesselCollBefore)
//     // check that ICR remains constant
//     th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
//     // check that Stability Pool deposit
//     th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(expectedVUSDGain_A), 10000)
//     // check GRVT balance remains the same
//     th.assertIsApproximatelyEqual(GRVTBalanceBefore, GRVTBalanceAfter)

//     // Expect Alice has withdrawn all ETH gain
//     const alice_pendingETHGain = await stabilityPool.getDepositorETHGain(alice)
//     assert.equal(alice_pendingETHGain, 0)
//   })

//   it('claimStakingGainsAndRecycle(): with both ETH and VUSD gains', async () => {
//     const price = toBN(dec(200, 18))

//     // Whale opens Vessel
//     await openVessel({ extraVUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

//     // alice opens vessel and provides 150 VUSD to StabilityPool
//     await openVessel({ extraVUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
//     await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

//     // mint some GRVT
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
//     await grvtTokenOriginal.unprotectedMint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

//     // stake GRVT
//     await grvtStaking.stake(dec(1850, 18), { from: whale })
//     await grvtStaking.stake(dec(150, 18), { from: alice })

//     // Defaulter Vessel opened
//     const { VUSDAmount, netDebt, collateral } = await openVessel({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
//     const borrowingFee = netDebt.sub(VUSDAmount)

//     // Alice VUSD gain is ((150/2000) * borrowingFee)
//     const expectedVUSDGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

//     // skip bootstrapping phase
//     await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

//     // whale redeems 100 VUSD
//     const redeemedAmount = toBN(dec(100, 18))
//     await th.redeemCollateral(whale, contracts, redeemedAmount)

//     // Alice ETH gain is ((150/2000) * (redemption fee over redeemedAmount) / price)
//     const redemptionFee = await vesselManager.getRedemptionFeeWithDecay(redeemedAmount)
//     const expectedETHGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(mv._1e18BN).div(price)

//     const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollBefore = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceBefore = await vusdToken.balanceOf(alice)
//     const vesselDebtBefore = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceBefore = await grvtToken.balanceOf(alice)
//     const ICRBefore = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositBefore = (await stabilityPool.deposits(alice))[0]
//     const stakeBefore = await grvtStaking.stakes(alice)

//     const proportionalVUSD = expectedETHGain_A.mul(price).div(ICRBefore)
//     const borrowingRate = await vesselManagerOriginal.getBorrowingRateWithDecay()
//     const netDebtChange = proportionalVUSD.mul(toBN(dec(1, 18))).div(toBN(dec(1, 18)).add(borrowingRate))
//     const expectedTotalVUSD = expectedVUSDGain_A.add(netDebtChange)

//     const expectedGRVTGain_A = toBN('839557069990108416000000')

//     // Alice claims staking rewards and puts them back in the system through the proxy
//     await borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, { from: alice })

//     // Alice new VUSD gain due to her own Vessel adjustment: ((150/2000) * (borrowing fee over netDebtChange))
//     const newBorrowingFee = await vesselManagerOriginal.getBorrowingFeeWithDecay(netDebtChange)
//     const expectedNewVUSDGain_A = newBorrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

//     const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
//     const vesselCollAfter = await vesselManager.getVesselColl(ZERO_ADDRESS, alice)
//     const VUSDBalanceAfter = await vusdToken.balanceOf(alice)
//     const vesselDebtAfter = await vesselManager.getVesselDebt(ZERO_ADDRESS, alice)
//     const GRVTBalanceAfter = await grvtToken.balanceOf(alice)
//     const ICRAfter = await vesselManager.getCurrentICR(ZERO_ADDRESS, alice, price)
//     const depositAfter = (await stabilityPool.deposits(alice))[0]
//     const stakeAfter = await grvtStaking.stakes(alice)

//     // check proxy balances remain the same
//     assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
//     assert.equal(GRVTBalanceAfter.toString(), GRVTBalanceBefore.toString())
//     // check proxy VUSD balance has increased by own adjust vessel reward
//     th.assertIsApproximatelyEqual(VUSDBalanceAfter, VUSDBalanceBefore.add(expectedNewVUSDGain_A))
//     // check vessel has increased debt by the ICR proportional amount to ETH gain
//     th.assertIsApproximatelyEqual(vesselDebtAfter, vesselDebtBefore.add(proportionalVUSD), 10000)
//     // check vessel has increased collateral by the ETH gain
//     th.assertIsApproximatelyEqual(vesselCollAfter, vesselCollBefore.add(expectedETHGain_A))
//     // check that ICR remains constant
//     th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
//     // check that Stability Pool deposit
//     th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(expectedTotalVUSD), 10000)
//     // check GRVT balance remains the same
//     th.assertIsApproximatelyEqual(GRVTBalanceBefore, GRVTBalanceAfter)

//     // GRVT staking
//     th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedGRVTGain_A))

//     // Expect Alice has withdrawn all ETH gain
//     const alice_pendingETHGain = await stabilityPool.getDepositorETHGain(alice)
//     assert.equal(alice_pendingETHGain, 0)
//   })

// })

