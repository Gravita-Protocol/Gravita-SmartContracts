const {
	time,
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { assert } = require("hardhat")

const ERC20Mock = artifacts.require("ERC20Mock")
const FixedPriceAggregator = artifacts.require("FixedPriceAggregator")
const MockAggregator = artifacts.require("MockAggregator")
const MockWstETH = artifacts.require("MockWstETH")
const PriceFeed = artifacts.require("PriceFeedL2")
const PriceFeedTestnet = artifacts.require("PriceFeedTestnet")
const Timelock = artifacts.require("Timelock")
const VesselManagerOperations = artifacts.require("VesselManagerOperations")
const WstEth2UsdPriceAggregator = artifacts.require("WstEth2UsdPriceAggregator")

const { TestHelper } = require("../utils/testHelpers.js")
const { dec, assertRevert, toBN } = TestHelper

const DEFAULT_DIGITS = 18
const DEFAULT_PRICE = dec(100, DEFAULT_DIGITS)

const DefaultOracleOptions = {
	providerType: 0, // IPriceFeed.sol::enum ProviderType.Chainlink
	timeoutSeconds: 3600,
	isEthIndexed: false,
	isFallback: false,
}

contract("PriceFeed", async accounts => {
	const [owner, alice] = accounts
	let priceFeed
	let erc20
	let mockOracle
	let timelock
	let vesselManagerOperations

	const setOracle = async (erc20Address, aggregatorAddress, opts = DefaultOracleOptions) => {
		const callSetter = async (_token, _oracle, _opts, _caller) => {
			await priceFeed.setOracle(
				_token,
				_oracle,
				_opts.providerType,
				_opts.timeoutSeconds,
				_opts.isEthIndexed,
				_opts.isFallback,
				{
					from: _caller,
				}
			)
		}
		const record = opts.isFallback ? await priceFeed.fallbacks(erc20Address) : await priceFeed.oracles(erc20Address)
		const recordExists = record.decimals != 0
		if (!recordExists) {
			await callSetter(erc20Address, aggregatorAddress, opts, owner)
		} else {
			// updating existing record requires msg.caller to be the timelock
			console.log(`calling as timelock`)
			await impersonateAccount(timelock.address)
			await callSetter(erc20Address, aggregatorAddress, opts, timelock.address)
			await stopImpersonatingAccount(timelock.address)
		}
	}

	const createMockOracle = async (_price, _decimals) => {
		const oracle = await MockAggregator.new()
		await oracle.setDecimals(_decimals)
		await oracle.setPrice(_price)
		await oracle.setLatestRoundId(3)
		await oracle.setPrevRoundId(2)
		await oracle.setUpdatedAt(await time.latest())
		return oracle
	}

	beforeEach(async () => {
		priceFeed = await PriceFeed.new()
		erc20 = await ERC20Mock.new("MOCK", "MOCK", DEFAULT_DIGITS)
		mockOracle = await createMockOracle(DEFAULT_PRICE, DEFAULT_DIGITS)
		vesselManagerOperations = await VesselManagerOperations.new()

		await priceFeed.initialize()

		timelock = await Timelock.new(86400 * 2, owner)
		setBalance(timelock.address, 1e18)

		// only addresses considered in the tests are timelock and vesselManagerOperations
		const addresses = new Array(15).fill(timelock.address, 0)
		addresses[14] = vesselManagerOperations.address
		await priceFeed.setAddresses(addresses)
		await setOracle(ZERO_ADDRESS, mockOracle.address)
	})

	describe("PriceFeedTestnet: internal testing contract", async () => {
		it("should be able to fetchPrice after setPrice, output of former matching input of latter", async () => {
			const priceFeedTestnet = await PriceFeedTestnet.new()
			const targetPrice = dec(1_000, DEFAULT_DIGITS)
			await priceFeedTestnet.setPrice(ZERO_ADDRESS, targetPrice)
			const price = await priceFeedTestnet.getPrice(ZERO_ADDRESS)
			assert.equal(price, targetPrice)
		})
	})

	describe("setOracle() routines", async () => {
		it("setOracle as user, reverts", async () => {
			await assertRevert(
				priceFeed.setOracle(
					ZERO_ADDRESS,
					mockOracle.address,
					DefaultOracleOptions.providerType,
					DefaultOracleOptions.timeoutSeconds,
					DefaultOracleOptions.isEthIndexed,
					DefaultOracleOptions.isFallback,
					{
						from: alice,
					}
				)
			)
		})

		it("setOracle as timelock: broken oracle, reverts", async () => {
			await mockOracle.setLatestRoundId(0)
			await assertRevert(setOracle(ZERO_ADDRESS, mockOracle.address))
		})

		it("setOracle as timelock: set fallback with no primary oracle, reverts", async () => {
			const newErc20Address = ethers.Wallet.createRandom().address
			await assertRevert(setOracle(newErc20Address, mockOracle.address, { ...DefaultOracleOptions, isFallback: true }))
		})

		it("setOracle as timelock: response is good, adds new oracle", async () => {
			const price = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(price.toString(), DEFAULT_PRICE.toString())
		})

		it("setOracle as timelock: oracle update, replaces previous one", async () => {
			const price = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(price.toString(), DEFAULT_PRICE.toString())

			const newMockOracle = await createMockOracle(dec(2_345, 8), 8)
			await setOracle(ZERO_ADDRESS, newMockOracle.address)

			const newPrice = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(newPrice.toString(), dec(2_345, DEFAULT_DIGITS).toString())
		})
	})

	describe("Custom Aggregators", async () => {
		it("fetchPrice of ETH-indexed oracle", async () => {
			const ETH_TO_USD = dec(1_600, DEFAULT_DIGITS)
			const ethMockOracle = await createMockOracle(ETH_TO_USD, DEFAULT_DIGITS)

			const ERC20_TO_ETH = dec(11, 17) // ERC20:ETH = 1,1
			const erc20MockOracle = await createMockOracle(ERC20_TO_ETH, DEFAULT_DIGITS)

			await setOracle(ZERO_ADDRESS, ethMockOracle.address)
			await setOracle(erc20.address, erc20MockOracle.address, { ...DefaultOracleOptions, isEthIndexed: true })

			const erc20Price = await priceFeed.fetchPrice(erc20.address)
			const expectedPrice = toBN(ERC20_TO_ETH).mul(toBN(ETH_TO_USD)).div(toBN(1e18))
			assert.equal(erc20Price.toString(), expectedPrice.toString())
		})

		it("fetchPrice of ETH-indexed oracle, where aggregator's response digits are different", async () => {
			const ETH_TO_USD = dec(1_600, 12) // ETH:USD = 1,600 @ 12 digits
			const ethMockOracle = await createMockOracle(ETH_TO_USD, 12)

			const ERC20_TO_ETH = dec(11, 7) // ERC20:ETH = 1,1 @ 8 digits
			const erc20MockOracle = await createMockOracle(ERC20_TO_ETH, 8)

			await setOracle(ZERO_ADDRESS, ethMockOracle.address)
			await setOracle(erc20.address, erc20MockOracle.address, { ...DefaultOracleOptions, isEthIndexed: true })

			const erc20Price = await priceFeed.fetchPrice(erc20.address) // ERC20:USD response @ 18 digits
			const expectedPrice = toBN(11)
				.mul(toBN(1_600))
				.mul(toBN(10 ** 17))
			assert.equal(erc20Price.toString(), expectedPrice.toString())
		})

		it("fetchPrice of unknown token, reverts", async () => {
			const randomAddr = "0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5"
			await assertRevert(priceFeed.fetchPrice(randomAddr))
		})

		it("fixed price aggregator", async () => {
			const one_to_one_oracle = await FixedPriceAggregator.new(1e8)
			await priceFeed.setOracle(
				erc20.address,
				one_to_one_oracle.address,
				DefaultOracleOptions.providerType,
				DefaultOracleOptions.timeoutSeconds,
				DefaultOracleOptions.isEthIndexed,
				DefaultOracleOptions.isFallback
			)
			const price = await priceFeed.fetchPrice(erc20.address)
			assert.equal(price.toString(), (1e18).toString())
		})

		it("wstETH price via custom aggregator", async () => {
			const WSTETH_TO_STETH = "1124168697480543467"
			const STETH_TO_USD = "182673073369"

			const stEth_to_usd_mockOracle = await createMockOracle(STETH_TO_USD, 8)

			const mock_wstETH = await MockWstETH.new()
			mock_wstETH.setStETHPerToken(WSTETH_TO_STETH)

			const wstEth_to_usd_oracle = await WstEth2UsdPriceAggregator.new(
				mock_wstETH.address,
				stEth_to_usd_mockOracle.address
			)
			const aggregatorDecimals = Number(await wstEth_to_usd_oracle.decimals())
			assert.equal(aggregatorDecimals, 8)

			const wstEth_to_usd_priceBN1 = (await wstEth_to_usd_oracle.latestRoundData()).answer
			const wstEth_to_usd_price1 = ethers.utils.formatUnits(wstEth_to_usd_priceBN1.toString(), aggregatorDecimals)

			const expected_wstEth_to_usd_priceBN1 = toBN(WSTETH_TO_STETH)
				.mul(toBN(STETH_TO_USD))
				.div(toBN(dec(1, "ether")))
			const expected_wstEth_to_usd_price = ethers.utils.formatUnits(
				expected_wstEth_to_usd_priceBN1.toString(),
				aggregatorDecimals
			)

			assert.equal(wstEth_to_usd_price1, expected_wstEth_to_usd_price)

			await priceFeed.setOracle(
				mock_wstETH.address,
				wstEth_to_usd_oracle.address,
				DefaultOracleOptions.providerType,
				DefaultOracleOptions.timeoutSeconds,
				DefaultOracleOptions.isEthIndexed,
				DefaultOracleOptions.isFallback
			)
			const feedDigits = Number(await priceFeed.TARGET_DIGITS())
			assert.equal(feedDigits, DEFAULT_DIGITS)

			const wstEth_to_usd_priceBN2 = await priceFeed.fetchPrice(mock_wstETH.address)
			const wstEth_to_usd_price2 = ethers.utils.formatUnits(wstEth_to_usd_priceBN2.toString(), feedDigits)

			assert.equal(wstEth_to_usd_price2, expected_wstEth_to_usd_price)
		})
	})

	describe("fetchPrice() scaling up/down", async () => {
		it("Scaling aggregator's response up", async () => {
			// Oracle price is 1, in 12 digits
			let newErc20Address = ethers.Wallet.createRandom().address
			await mockOracle.setDecimals(12)
			await mockOracle.setPrice(dec(1, 12))
			await setOracle(newErc20Address, mockOracle.address)
			price = await priceFeed.fetchPrice(newErc20Address)
			// Check PriceFeed gives 1e12, but with 18 digit precision (scale up)
			assert.equal(price.toString(), dec(1, DEFAULT_DIGITS))

			// Oracle price is 1234.56789, in 5 digits
			newErc20Address = ethers.Wallet.createRandom().address
			await mockOracle.setDecimals(5)
			await mockOracle.setPrice(dec(123_456_789))
			await setOracle(newErc20Address, mockOracle.address)
			price = await priceFeed.fetchPrice(newErc20Address)
			// Check PriceFeed gives 1234.56789 with 18 digit precision (scale up)
			assert.equal(price, "1234567890000000000000")
		})

		it("No scaling necessary (aggregator uses 18 digits)", async () => {
			// Oracle price is 0.0001, in 18 digits
			const newErc20Address = ethers.Wallet.createRandom().address
			await mockOracle.setDecimals(18)
			await mockOracle.setPrice(dec(1, 14))
			await setOracle(newErc20Address, mockOracle.address)
			const price = await priceFeed.fetchPrice(newErc20Address)
			// Check PriceFeed gives 0.0001 with 18 digit precision (no scale, 18 is default)
			assert.equal(price.toString(), dec(1, 14))
		})

		it("Scaling aggregator's response down", async () => {
			// Oracle price is 1, in 20 digits
			const newErc20Address = ethers.Wallet.createRandom().address
			await mockOracle.setDecimals(20)
			await mockOracle.setPrice(dec(1, 20))
			await setOracle(newErc20Address, mockOracle.address)
			const price = await priceFeed.fetchPrice(newErc20Address)
			// Check PriceFeed gives 1 with 18 digit precision (scale down)
			assert.equal(price.toString(), dec(1, 18))
		})
	})

	describe("fetchPrice() fallbacks", async () => {
		it("fetchPrice: oracle is stale, no fallback, reverts", async () => {
			await mockOracle.setPriceIsAlwaysUpToDate(false)
			const oracleRecord = await priceFeed.oracles(ZERO_ADDRESS)
			const timeoutSeconds = oracleRecord.timeoutSeconds
			const staleTimeout = Number(timeoutSeconds) + 1
			await time.increase(staleTimeout)
			await assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS))
		})

		it("fetchPrice: oracle is stale, fallback is good, returns fallback response", async () => {
			const fallbackPrice = DEFAULT_PRICE * 2
			const fallbackOracle = await createMockOracle(fallbackPrice.toString(), DEFAULT_DIGITS)
			await setOracle(ZERO_ADDRESS, fallbackOracle.address, { ...DefaultOracleOptions, isFallback: true })

			await mockOracle.setPriceIsAlwaysUpToDate(false)
			await time.increase(DefaultOracleOptions.timeoutSeconds + 30)

			fallbackOracle.setUpdatedAt(await time.latest())
			const feedPrice = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(fallbackPrice.toString(), feedPrice.toString())
		})

		it("fetchPrice: oracle is stale, fallback is stale, reverts", async () => {
			const fallbackOracle = await createMockOracle(DEFAULT_PRICE.toString(), DEFAULT_DIGITS)
			await setOracle(ZERO_ADDRESS, fallbackOracle.address, { ...DefaultOracleOptions, isFallback: true })

			await mockOracle.setPriceIsAlwaysUpToDate(false)
			await fallbackOracle.setPriceIsAlwaysUpToDate(false)
			await time.increase(DefaultOracleOptions.timeoutSeconds + 30)

			await assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS))
		})
	})

	describe("Sequencer Uptime Feed Tests", async () => {
		it("setSequencerUptimeFeed() access control", async () => {
			const uptimeFeed = await MockAggregator.new()
			const uptimeFeed2 = await MockAggregator.new()
			// setting the address from a random user should fail
			await assertRevert(priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address, { from: alice }))
			// setting the address from the timelock for the first time should fail
			await impersonateAccount(timelock.address)
			await assertRevert(priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address, { from: timelock.address }))
			await stopImpersonatingAccount(timelock.address)
			// setting the address from contract owner should succeed
			await priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address)
			assert.equal(uptimeFeed.address, await priceFeed.sequencerUptimeFeedAddress())
			// overwriting the address from contract owner should fail
			await assertRevert(priceFeed.setSequencerUptimeFeedAddress(uptimeFeed2.address))
			// overwriting the address from random user should fail
			await assertRevert(priceFeed.setSequencerUptimeFeedAddress(uptimeFeed2.address, { from: alice }))
			// overwriting the address from the timelock should succeed
			await impersonateAccount(timelock.address)
			await priceFeed.setSequencerUptimeFeedAddress(uptimeFeed2.address, { from: timelock.address })
			await stopImpersonatingAccount(timelock.address)
			assert.equal(uptimeFeed2.address, await priceFeed.sequencerUptimeFeedAddress())
		})

		it("SequencerUptimeFeed with 'up' answer should not affect fetchPrice()", async () => {
			const sequencerIsUp = 0
			const delay = Number(await priceFeed.SEQUENCER_BORROWING_DELAY_SECONDS())
			const sequencerUpdatedAt = Number(await time.latest()) - delay - 1
			const uptimeFeed = await MockAggregator.new()
			await uptimeFeed.setPriceIsAlwaysUpToDate(false)
			await uptimeFeed.setPrice(sequencerIsUp)
			await uptimeFeed.setUpdatedAt(sequencerUpdatedAt)
			await priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address)
			await priceFeed.fetchPrice(ZERO_ADDRESS)
		})

		it("SequencerUptimeFeed with 'up' answer but updatedAt < borrowingDelay should revert fetchPrice()", async () => {
			const sequencerIsUp = 0
			const borrowingDelay = Number(await priceFeed.SEQUENCER_BORROWING_DELAY_SECONDS())
			const sequencerUpdatedAt = Number(await time.latest()) - Math.floor(borrowingDelay / 2)
			const uptimeFeed = await MockAggregator.new()
			await uptimeFeed.setPriceIsAlwaysUpToDate(false)
			await uptimeFeed.setPrice(sequencerIsUp)
			await uptimeFeed.setUpdatedAt(sequencerUpdatedAt)
			await priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address)
			await assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS))
		})

		it("SequencerUptimeFeed with 'up' answer but borrowingDelay < updatedAt < liquidationDelay should revert fetchPrice() when liquidating", async () => {
			const sequencerIsUp = 0
			const borrowingDelay = Number(await priceFeed.SEQUENCER_BORROWING_DELAY_SECONDS())
			const liquidationDelay = Number(await priceFeed.SEQUENCER_LIQUIDATION_DELAY_SECONDS())
			assert.isTrue(liquidationDelay > borrowingDelay)

			// setup as borrowingDelay < updatedAt < liquidationDelay
			const sequencerUpdatedAt = Number(await time.latest()) - borrowingDelay
			const uptimeFeed = await MockAggregator.new()
			await uptimeFeed.setPriceIsAlwaysUpToDate(false)
			await uptimeFeed.setPrice(sequencerIsUp)
			await uptimeFeed.setUpdatedAt(sequencerUpdatedAt)
			await priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address)

			// fetching as VesselManagerOperations should revert
			await impersonateAccount(vesselManagerOperations.address)
			await assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS, { from: vesselManagerOperations.address }))
			await stopImpersonatingAccount(vesselManagerOperations.address)

			// but fetching as non-VesselManagerOperations should succeed
			await priceFeed.fetchPrice(ZERO_ADDRESS)

			// wait out delay difference
			await time.increase(liquidationDelay - borrowingDelay)

			// this time, fetching as VesselManagerOperations should succeed
			await impersonateAccount(vesselManagerOperations.address)
			await priceFeed.fetchPrice(ZERO_ADDRESS, { from: vesselManagerOperations.address })
			await stopImpersonatingAccount(vesselManagerOperations.address)
		})

		it("SequencerUptimeFeed with 'down' answer should revert fetchPrice()", async () => {
			const uptimeFeed = await MockAggregator.new()
			const sequencerIsDown = 1
			await uptimeFeed.setPrice(sequencerIsDown)
			await priceFeed.setSequencerUptimeFeedAddress(uptimeFeed.address)
			await assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS))
		})
	})
})

contract("Reset chain state", async accounts => {})

