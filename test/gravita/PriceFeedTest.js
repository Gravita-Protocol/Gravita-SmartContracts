const {
	time,
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { assert } = require("hardhat")

const AdminContract = artifacts.require("AdminContract")
const ERC20Mock = artifacts.require("ERC20Mock")
const FixedPriceAggregator = artifacts.require("FixedPriceAggregator")
const MockChainlink = artifacts.require("MockAggregator")
const MockWstETH = artifacts.require("MockWstETH")
const PriceFeed = artifacts.require("PriceFeed")
const PriceFeedTestnet = artifacts.require("PriceFeedTestnet")
const Timelock = artifacts.require("Timelock")
const WstEth2UsdPriceAggregator = artifacts.require("WstEth2UsdPriceAggregator")

const { TestHelper } = require("../utils/testHelpers.js")
const { dec, assertRevert, toBN, getLatestBlockTimestamp, fastForwardTime } = TestHelper

const DEFAULT_PRICE = dec(100, 18)
const DEFAULT_PRICE_e8 = dec(100, 8)

const DefaultOracleOptions = {
	providerType: 0, // enum IPriceFeed.ProviderType
	timeoutMinutes: 60,
	isEthIndexed: false,
	isFallback: false,
}

contract("PriceFeed", async accounts => {
	const [owner, alice] = accounts
	let priceFeed
	let mockChainlink
	let adminContract
	let timelock
	let erc20

	const setAddressesAndOracle = async () => {
		await priceFeed.setTimelock(timelock.address)
		await setOracle(ZERO_ADDRESS, mockChainlink.address)
	}

	const setOracle = async (erc20Address, aggregatorAddress, opt = DefaultOracleOptions) => {
		const record = await priceFeed.oracles(erc20Address)
		if (record.decimals == 0) {
			await priceFeed.setOracle(
				erc20Address,
				aggregatorAddress,
				opt.providerType,
				opt.timeoutMinutes,
				opt.isEthIndexed,
				opt.isFallback,
				{
					from: owner,
				}
			)
		} else {
			await impersonateAccount(timelock.address)
			await priceFeed.setOracle(
				erc20Address,
				aggregatorAddress,
				opt.providerType,
				opt.timeoutMinutes,
				opt.isEthIndexed,
				opt.isFallback,
				{
					from: timelock.address,
				}
			)
			await stopImpersonatingAccount(timelock.address)
		}
	}

	beforeEach(async () => {
		priceFeed = await PriceFeed.new()
		mockChainlink = await MockChainlink.new()
		adminContract = await AdminContract.new()
		erc20 = await ERC20Mock.new("MOCK", "MOCK", 18)

		await priceFeed.initialize()

		timelock = await Timelock.new(86400 * 2, owner)
		setBalance(timelock.address, 1e18)

		// Set Chainlink latest and prev roundId's to non-zero
		await mockChainlink.setLatestRoundId(3)
		await mockChainlink.setPrevRoundId(2)

		// Set current and prev prices
		await mockChainlink.setPrice(DEFAULT_PRICE_e8)
		await mockChainlink.setPrevPrice(DEFAULT_PRICE_e8)

		await mockChainlink.setDecimals(8)

		// Set mock price updateTimes to very recent
		const now = await getLatestBlockTimestamp(web3)
		await mockChainlink.setUpdateTime(now)
	})

	describe("PriceFeedTestnet: internal testing contract", async () => {
		it("should be able to fetchPrice after setPrice, output of former matching input of latter", async () => {
			const priceFeedTestnet = await PriceFeedTestnet.new()
			const targetPrice = dec(1_000, 18)
			await priceFeedTestnet.setPrice(ZERO_ADDRESS, targetPrice)
			const price = await priceFeedTestnet.getPrice(ZERO_ADDRESS)
			assert.equal(price, targetPrice)
		})
	})

	describe("setOracle() routines", async () => {
		it("setOracle as user, reverts", async () => {
			await setAddressesAndOracle()
			await assertRevert(
				priceFeed.setOracle(
					ZERO_ADDRESS,
					mockChainlink.address,
					DefaultOracleOptions.providerType,
					DefaultOracleOptions.timeoutMinutes,
					DefaultOracleOptions.isEthIndexed,
					DefaultOracleOptions.isFallback,
					{
						from: alice,
					}
				)
			)
		})

		it("setOracle as timelock: broken oracle, reverts", async () => {
			await setAddressesAndOracle()
			await mockChainlink.setLatestRoundId(0)
			await assertRevert(setOracle(ZERO_ADDRESS, mockChainlink.address))
		})

		it("setOracle as timelock: response is good, adds new oracle", async () => {
			await setAddressesAndOracle()
			const price = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(price.toString(), DEFAULT_PRICE.toString())
		})

		it("setOracle as timelock: oracle update, replaces previous one", async () => {
			await setAddressesAndOracle()
			const price = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(price.toString(), DEFAULT_PRICE.toString())

			const newMockChainlink = await MockChainlink.new()
			MockChainlink.setAsDeployed(newMockChainlink)
			await newMockChainlink.setPrice(dec(2_345, 8))
			await newMockChainlink.setPrevPrice(dec(2_345, 8))
			await newMockChainlink.setLatestRoundId(3)
			await newMockChainlink.setPrevRoundId(2)
			await newMockChainlink.setDecimals(8)
			await newMockChainlink.setUpdateTime(await time.latest())

			await setOracle(ZERO_ADDRESS, newMockChainlink.address)

			const newPrice = await priceFeed.fetchPrice(ZERO_ADDRESS)
			assert.equal(newPrice.toString(), dec(2_345, 18).toString())
		})
	})

	describe("Custom Aggregators", async () => {
		it("fetchPrice of ETH-indexed oracle", async () => {
			await setAddressesAndOracle()

			const ETH_TO_USD = dec(1_600, 18)
			const ethMockChainlink = await MockChainlink.new()
			await ethMockChainlink.setPrevPrice(ETH_TO_USD)
			await ethMockChainlink.setPrice(ETH_TO_USD)
			await ethMockChainlink.setDecimals(18)
			await ethMockChainlink.setLatestRoundId(3)
			await ethMockChainlink.setPrevRoundId(2)
			await ethMockChainlink.setUpdateTime(await getLatestBlockTimestamp(web3))

			const ERC20_TO_ETH = dec(11, 17) // ERC20:ETH = 1,1
			const erc20MockChainlink = await MockChainlink.new()
			await erc20MockChainlink.setPrice(ERC20_TO_ETH)
			await erc20MockChainlink.setPrevPrice(ERC20_TO_ETH)
			await erc20MockChainlink.setLatestRoundId(3)
			await erc20MockChainlink.setPrevRoundId(2)
			await erc20MockChainlink.setDecimals(18)
			await erc20MockChainlink.setUpdateTime(await getLatestBlockTimestamp(web3))

			await setOracle(ZERO_ADDRESS, ethMockChainlink.address)
			await setOracle(erc20.address, erc20MockChainlink.address, { ...DefaultOracleOptions, isEthIndexed: true })
			
			const erc20Price = await priceFeed.fetchPrice(erc20.address)
			const expectedPrice = toBN(ERC20_TO_ETH).mul(toBN(ETH_TO_USD)).div(toBN(1e18))
			assert.equal(erc20Price.toString(), expectedPrice.toString())
		})

		it("fetchPrice of ETH-indexed oracle, where aggregator's response digits are different", async () => {
			// TODO
			assert.equal(true, false)
		})

		it("fetchPrice of unknown token, reverts", async () => {
			const randomAddr = "0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5"
			await assertRevert(priceFeed.fetchPrice(randomAddr))
		})

		it("fixed price aggregator", async () => {
			await setAddressesAndOracle()
			const one_to_one_oracle = await FixedPriceAggregator.new(1e8)
			await priceFeed.setOracle(
				erc20.address,
				one_to_one_oracle.address,
				DefaultOracleOptions.providerType,
				DefaultOracleOptions.timeoutMinutes,
				DefaultOracleOptions.isEthIndexed,
				DefaultOracleOptions.isFallback
			)
			const price = await priceFeed.fetchPrice(erc20.address)
			assert.equal(price.toString(), (1e18).toString())
		})

		it("wstETH price via custom aggregator", async () => {
			const WSTETH_TO_STETH = "1124168697480543467"
			const STETH_TO_USD = "182673073369"

			await setAddressesAndOracle()

			const stEth_to_usd_mockChainlink = await MockChainlink.new()
			await stEth_to_usd_mockChainlink.setDecimals(8)
			await stEth_to_usd_mockChainlink.setPrice(STETH_TO_USD)
			await stEth_to_usd_mockChainlink.setPrevPrice(STETH_TO_USD)
			await stEth_to_usd_mockChainlink.setLatestRoundId(3)
			await stEth_to_usd_mockChainlink.setPrevRoundId(2)
			await stEth_to_usd_mockChainlink.setUpdateTime(await getLatestBlockTimestamp(web3))

			const mock_wstETH = await MockWstETH.new()
			mock_wstETH.setStETHPerToken(WSTETH_TO_STETH)

			const wstEth_to_usd_oracle = await WstEth2UsdPriceAggregator.new(
				mock_wstETH.address,
				stEth_to_usd_mockChainlink.address
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
				DefaultOracleOptions.timeoutMinutes,
				DefaultOracleOptions.isEthIndexed,
				DefaultOracleOptions.isFallback
			)
			const feedDigits = Number(await priceFeed.TARGET_DIGITS())
			assert.equal(feedDigits, 18)

			const wstEth_to_usd_priceBN2 = await priceFeed.fetchPrice(mock_wstETH.address)
			const wstEth_to_usd_price2 = ethers.utils.formatUnits(wstEth_to_usd_priceBN2.toString(), feedDigits)

			assert.equal(wstEth_to_usd_price2, expected_wstEth_to_usd_price)
		})
	})

	describe("fetchPrice() scaling up/down", async () => {
		it("Scaling aggregator's response up", async () => {
			await setAddressesAndOracle()

			// Oracle price price is 10, in 8 digits (10 * 10**8)
			await mockChainlink.setDecimals(8)
			await mockChainlink.setPrice(dec(10, 8))
			await mockChainlink.setPrevPrice(dec(10, 8))
			let price = await priceFeed.fetchPrice(ZERO_ADDRESS)
			// Check PriceFeed gives 10, with 18 digit precision
			assert.equal(price, dec(10, 18))

			// Oracle price is 1, in 12 digits
			let newErc20 = ethers.Wallet.createRandom().address
			await mockChainlink.setDecimals(12)
			await mockChainlink.setPrice(dec(1, 12))
			await mockChainlink.setPrevPrice(dec(1, 12))
			await setOracle(newErc20, mockChainlink.address)
			price = await priceFeed.fetchPrice(newErc20)
			// Check PriceFeed gives 1e12, but with 18 digit precision (scale up)
			assert.equal(price.toString(), dec(1, 18))

			// Oracle price is 1234.56789, in 5 digits
			newErc20 = ethers.Wallet.createRandom().address
			await mockChainlink.setDecimals(5)
			await mockChainlink.setPrice(dec(123_456_789))
			await mockChainlink.setPrevPrice(dec(123_456_789))
			await setOracle(newErc20, mockChainlink.address)
			price = await priceFeed.fetchPrice(newErc20)
			// Check PriceFeed gives 1234.56789 with 18 digit precision (scale up)
			assert.equal(price, "1234567890000000000000")
		})

		it("No scaling necessary (aggregator uses 18 digits)", async () => {
			// Oracle price is 0.0001, in 18 digits
			const newErc20 = ethers.Wallet.createRandom().address
			await mockChainlink.setDecimals(18)
			await mockChainlink.setPrice(dec(1, 14))
			await mockChainlink.setPrevPrice(dec(1, 14))
			await setOracle(newErc20, mockChainlink.address)
			const price = await priceFeed.fetchPrice(newErc20)
			// Check PriceFeed gives 0.0001 with 18 digit precision (no scale, 18 is default)
			assert.equal(price.toString(), dec(1, 14))
		})

		it("Scaling aggregator's response down", async () => {
			// Oracle price is 1, in 20 digits
			const newErc20 = ethers.Wallet.createRandom().address
			await mockChainlink.setDecimals(20)
			await mockChainlink.setPrice(dec(1, 20))
			await mockChainlink.setPrevPrice(dec(1, 20))
			await setOracle(newErc20, mockChainlink.address)
			const price = await priceFeed.fetchPrice(newErc20)
			// Check PriceFeed gives 1 with 18 digit precision (scale down)
			assert.equal(price.toString(), dec(1, 18))
		})
	})

	describe("fetchPrice() fallbacks", async () => {
		it("fetchPrice: oracle is stale, no fallback, reverts", async () => {
			await setAddressesAndOracle()
			await mockChainlink.setPrice(dec(1_234, 8))
			await mockChainlink.setPrevPrice(dec(1_234, 8))
			await time.increase(DefaultOracleOptions.timeoutMinutes * 60 + 1)
			assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS))
		})
		// TODO test all fallback scenarios
	})
})

contract("Reset chain state", async accounts => {})
