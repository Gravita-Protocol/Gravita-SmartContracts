const testHelpers = require("../../utils/testHelpers.js")
const th = testHelpers.TestHelper

const GravitaSafeMath128Tester = artifacts.require("GravitaSafeMath128Tester")

contract('GravitaSafeMath128Tester', async accounts => {
  let mathTester

  beforeEach(async () => {
    mathTester = await GravitaSafeMath128Tester.new()
  })

  it('add(): reverts if overflows', async () => {
    const MAX_UINT_128 = th.toBN(2).pow(th.toBN(128)).sub(th.toBN(1))
    await th.assertRevert(mathTester.add(MAX_UINT_128, 1), 'GravitaSafeMath128Tester: addition overflow')
  })

  it('sub(): reverts if underflows', async () => {
    await th.assertRevert(mathTester.sub(1, 2), 'GravitaSafeMath128Tester: subtraction overflow')
  })
})

contract("Reset chain state", async accounts => {})
