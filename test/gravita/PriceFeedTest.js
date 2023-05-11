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
const PriceFeed = artifacts.require("PriceFeedTester")
const PriceFeedTestnet = artifacts.require("PriceFeedTestnet")
const Timelock = artifacts.require("Timelock")
const WstEth2EthPriceAggregator = artifacts.require("WstEth2EthPriceAggregator")

const { TestHelper } = require("../../utils/testHelpers.js")
const { dec, assertRevert, toBN, getLatestBlockTimestamp, fastForwardTime } = TestHelper

const MAX_PRICE_DEVIATION_BETWEEN_ROUNDS = dec(5, 17) // 0.5 ether
const DEFAULT_PRICE = dec(100, 18)
const DEFAULT_PRICE_e8 = dec(100, 8)

contract("PriceFeed", async accounts => {
	const [owner, alice] = accounts
	let priceFeedTestnet
	let priceFeed
	let mockChainlink
	let adminContract
	let shortTimelock
	let erc20

	const setAddressesAndOracle = async () => {
		await priceFeed.setAddresses(adminContract.address, shortTimelock.address, { from: owner })
		await setOracle(ZERO_ADDRESS, mockChainlink.address)
		await priceFeed.fetchPrice(ZERO_ADDRESS)
	}

	const setOracle = async (erc20Address, aggregatorAddress, isIndexed = false) => {
		const record = await priceFeed.oracleRecords(erc20Address)
		if (!record.exists) {
			await priceFeed.setOracle(erc20Address, aggregatorAddress, MAX_PRICE_DEVIATION_BETWEEN_ROUNDS, isIndexed, {
				from: owner,
			})
		} else {
			await impersonateAccount(shortTimelock.address)
			await priceFeed.setOracle(erc20Address, aggregatorAddress, MAX_PRICE_DEVIATION_BETWEEN_ROUNDS, isIndexed, {
				from: shortTimelock.address,
			})
			await stopImpersonatingAccount(shortTimelock.address)
		}
	}

	const getPrice = async (erc20Address = ZERO_ADDRESS) => {
		const priceRecord = await priceFeed.priceRecords(erc20Address)
		return priceRecord.scaledPrice
	}

	beforeEach(async () => {
		priceFeedTestnet = await PriceFeedTestnet.new()
		priceFeed = await PriceFeed.new()
		mockChainlink = await MockChainlink.new()
		adminContract = await AdminContract.new()
		erc20 = await ERC20Mock.new("MOCK", "MOCK", 18)
		shortTimelock = await Timelock.new(86400 * 3)

		await priceFeed.initialize()
		await adminContract.initialize()

		setBalance(shortTimelock.address, 1e18)

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

	describe("PriceFeedTestnet: internal testing contract", async accounts => {
		it("should be able to fetchPrice after setPrice, output of former matching input of latter", async () => {
			await priceFeedTestnet.setPrice(ZERO_ADDRESS, dec(1000, 18))
			const price = await priceFeedTestnet.getPrice(ZERO_ADDRESS)
			assert.equal(price, dec(1000, 18))
		})
	})

	describe("Mainnet PriceFeed setup", async accounts => {
		it("setAddresses should fail if not coming from owner", async () => {
			await assertRevert(
				priceFeed.setAddresses(adminContract.address, shortTimelock.address, {
					from: alice,
				}),
				"OwnableUpgradeable: caller is not the owner"
			)
		})
	})

	describe("Custom Aggregators", async () => {
		it("fetchPrice of ETH-indexed Oracle", async () => {
			await setAddressesAndOracle()
			const ETH_TO_USD = dec(1600, 18)
			mockChainlink.setPrevPrice(ETH_TO_USD)
			mockChainlink.setPrice(ETH_TO_USD)
			mockChainlink.setDecimals(18)
			const ERC20_TO_ETH = dec(11, 17) // MOCK:ETH = 1,1
			const erc20MockChainlink = await MockChainlink.new()
			await erc20MockChainlink.setPrice(ERC20_TO_ETH)
			await erc20MockChainlink.setPrevPrice(ERC20_TO_ETH)
			await erc20MockChainlink.setLatestRoundId(3)
			await erc20MockChainlink.setPrevRoundId(2)
			await erc20MockChainlink.setDecimals(18)
			await erc20MockChainlink.setUpdateTime(await getLatestBlockTimestamp(web3))
			await setOracle(erc20.address, erc20MockChainlink.address, true)
			await priceFeed.fetchPrice(ZERO_ADDRESS)
			await priceFeed.fetchPrice(erc20.address)
			const erc20Price = await getPrice(erc20.address)
			const expectedPrice = toBN(ERC20_TO_ETH).mul(toBN(ETH_TO_USD)).div(toBN(1e18))
			assert.equal(erc20Price.toString(), expectedPrice.toString())
		})

		it("fetchPrice of unknown token, reverts", async () => {
			const randomAddr = "0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5"
			await assertRevert(priceFeed.fetchPrice(randomAddr), "Oracle is not registered!")
		})

		it("fetchPrice of stale aggregator, reverts", async () => {
			await setAddressesAndOracle()
			await mockChainlink.setPriceIsAlwaysUpToDate(false)
			await priceFeed.fetchPrice(ZERO_ADDRESS)
			const stalePriceTimeout = Number(await priceFeed.RESPONSE_TIMEOUT())
			await time.increase(stalePriceTimeout + 1)
			await assertRevert(priceFeed.fetchPrice(ZERO_ADDRESS))
		})

		it("fixed price aggregator", async () => {
			await setAddressesAndOracle()
			const one_to_one_oracle = await FixedPriceAggregator.new(1e8)
			await priceFeed.setOracle(
				erc20.address,
				one_to_one_oracle.address,
				MAX_PRICE_DEVIATION_BETWEEN_ROUNDS,
				(isEthIndexed = false)
			)
			await priceFeed.fetchPrice(erc20.address)
			const price = (await priceFeed.priceRecords(erc20.address)).scaledPrice
			assert.equal(price.toString(), (1e18).toString())
		})

		it("wstETH price via custom aggregator", async () => {
			const ETH_TO_USD = "197870000000"
			const STETH_TO_ETH = "997265198653368300"
			const WSTETH_TO_STETH = "1122752566282725055"

			await setAddressesAndOracle()

			const eth_to_usd_mockChainlink = mockChainlink
			await eth_to_usd_mockChainlink.setDecimals(8)
			await eth_to_usd_mockChainlink.setPrice(ETH_TO_USD)
			await eth_to_usd_mockChainlink.setPrevPrice(ETH_TO_USD)
			await eth_to_usd_mockChainlink.setLatestRoundId(3)
			await eth_to_usd_mockChainlink.setPrevRoundId(2)
			await eth_to_usd_mockChainlink.setUpdateTime(await getLatestBlockTimestamp(web3))

			const stEth_to_eth_mockChainlink = await MockChainlink.new()
			await stEth_to_eth_mockChainlink.setDecimals(18)
			await stEth_to_eth_mockChainlink.setPrice(STETH_TO_ETH)
			await stEth_to_eth_mockChainlink.setPrevPrice(STETH_TO_ETH)
			await stEth_to_eth_mockChainlink.setLatestRoundId(3)
			await stEth_to_eth_mockChainlink.setPrevRoundId(2)
			await stEth_to_eth_mockChainlink.setUpdateTime(await getLatestBlockTimestamp(web3))

			const mock_wstETH = await MockWstETH.new()
			mock_wstETH.setStETHPerToken(WSTETH_TO_STETH)

			const wstEth_to_eth_oracle = await WstEth2EthPriceAggregator.new(
				mock_wstETH.address,
				stEth_to_eth_mockChainlink.address
			)
			assert.equal(await wstEth_to_eth_oracle.decimals(), "18")

			const wstEth_to_eth_priceBN = (await wstEth_to_eth_oracle.latestRoundData()).answer
			const wstEth_to_eth_price = ethers.utils.formatUnits(wstEth_to_eth_priceBN.toString(), 18)

			const expected_wstEth_to_eth_priceBN = toBN(WSTETH_TO_STETH)
				.mul(toBN(STETH_TO_ETH))
				.div(toBN(dec(1, "ether")))
			const expected_wstEth_to_eth_price = ethers.utils.formatUnits(expected_wstEth_to_eth_priceBN.toString(), 18)

			assert.equal(wstEth_to_eth_price, expected_wstEth_to_eth_price)

			await priceFeed.setOracle(
				mock_wstETH.address,
				wstEth_to_eth_oracle.address,
				MAX_PRICE_DEVIATION_BETWEEN_ROUNDS,
				(isEthIndexed = true)
			)
			const feedDigits = Number(await priceFeed.TARGET_DIGITS())
			assert.equal(feedDigits, 18)

			await priceFeed.fetchPrice(mock_wstETH.address)

			const wstEth_to_usd_priceBN = (await priceFeed.priceRecords(mock_wstETH.address)).scaledPrice
			const expected_wstEth_to_usd_priceBN = expected_wstEth_to_eth_priceBN.mul(toBN(ETH_TO_USD)).div(toBN(dec(1, 8)))

			const wstEth_to_usd_price = ethers.utils.formatUnits(wstEth_to_usd_priceBN.toString(), feedDigits)
			const expected_wstEth_to_usd_price = ethers.utils.formatUnits(expected_wstEth_to_usd_priceBN.toString(), 18)

			assert.equal(wstEth_to_usd_price, expected_wstEth_to_usd_price)
		})
	})

	it("Validate default status on setAddressesAndOracle", async () => {
		await setAddressesAndOracle()
		const feedWorking = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorking, true)
	})

	it("setOracle as User, reverts", async () => {
		await setAddressesAndOracle()
		await assertRevert(
			priceFeed.setOracle(ZERO_ADDRESS, mockChainlink.address, MAX_PRICE_DEVIATION_BETWEEN_ROUNDS, false, {
				from: alice,
			}),
			"OwnableUpgradeable: caller is not the owner"
		)
	})

	it("setOracle as Timelock: Oracle broken, reverts", async () => {
		await setAddressesAndOracle()
		await mockChainlink.setLatestRoundId(0)
		await assertRevert(setOracle(ZERO_ADDRESS, mockChainlink.address))
	})

	it("setOracle as Timelock: All chainlink responses are good, adds new oracle", async () => {
		await setAddressesAndOracle()
		const price = await getPrice()
		assert.equal(price.toString(), DEFAULT_PRICE.toString())
	})

	it("setOracle new Oracle, replaces old one", async () => {
		await setAddressesAndOracle()
		const price = await getPrice()
		assert.equal(price.toString(), DEFAULT_PRICE.toString())

		const newMockChainlink = await MockChainlink.new()
		MockChainlink.setAsDeployed(newMockChainlink)
		await newMockChainlink.setPrice(dec(2345, 8))
		await newMockChainlink.setPrevPrice(dec(2345, 8))
		await newMockChainlink.setLatestRoundId(3)
		await newMockChainlink.setPrevRoundId(2)
		await newMockChainlink.setDecimals(8)
		await newMockChainlink.setUpdateTime(await time.latest())

		await setOracle(ZERO_ADDRESS, newMockChainlink.address)

		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const newPrice = await getPrice()
		assert.equal(newPrice.toString(), dec(2345, 18).toString())
	})

	it("chainlinkWorking: Oracle works, return price and remain feedWorking", async () => {
		await setAddressesAndOracle()
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking

		await mockChainlink.setPrice(dec(1234, 8))
		await mockChainlink.setPrevPrice(dec(1234, 8))

		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking

		assert.equal(feedWorkingAfter, feedWorkingBefore)
		assert.equal(price, dec(1234, 18).toString())
	})

	it("chainlinkWorking: Oracle breaks, return last price record, and change feedWorking to false", async () => {
		await setAddressesAndOracle()
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking

		await mockChainlink.setPrice(dec(1234, 8))
		await mockChainlink.setPrevPrice(dec(1234, 8))
		await mockChainlink.setLatestRoundId(0)

		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()

		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking

		assert.notEqual(feedWorkingAfter, feedWorkingBefore)
		assert.equal(feedWorkingAfter, false)
		assert.notEqual(price, dec(1234, 18).toString())
		assert.equal(price, DEFAULT_PRICE.toString())
	})

	it("chainlinkWorking: fetchPrice should return the correct price, taking into account the number of decimal digits on the aggregator", async () => {
		await setAddressesAndOracle()
		// Oracle price price is 10.00000000
		await mockChainlink.setDecimals(8)
		await mockChainlink.setPrice(dec(1, 9))
		await mockChainlink.setPrevPrice(dec(1, 9))
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		let price = await getPrice()
		// Check PriceFeed gives 10, with 18 digit precision
		assert.equal(price, dec(10, 18))
		// Oracle price is 1e9
		await mockChainlink.setDecimals(0)
		await mockChainlink.setPrice(dec(1, 9))
		await mockChainlink.setPrevPrice(dec(1, 9))
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		price = await getPrice()
		// Check PriceFeed gives 1e9, with 18 digit precision
		assert.isTrue(price.eq(toBN(dec(1, 27))))
		// Oracle price is 0.0001
		await mockChainlink.setDecimals(18)
		await mockChainlink.setPrice(dec(1, 14))
		await mockChainlink.setPrevPrice(dec(1, 14))
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		price = await getPrice()
		// Check PriceFeed gives 0.0001 with 18 digit precision
		assert.isTrue(price.eq(toBN(dec(1, 14))))
		// Oracle price is 1234.56789
		await mockChainlink.setDecimals(5)
		await mockChainlink.setPrice(dec(123456789))
		await mockChainlink.setPrevPrice(dec(123456789))
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		price = await getPrice()
		// Check PriceFeed gives 0.0001 with 18 digit precision
		assert.equal(price, "1234567890000000000000")
	})

	// --- Chainlink timeout ---

	it("chainlinkWorking: Chainlink is out of date by <3hrs: remain chainlinkWorking", async () => {
		await setAddressesAndOracle()
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingBefore, true)
		await mockChainlink.setPrice(dec(1234, 8))
		await mockChainlink.setPrevPrice(dec(1234, 8))
		await fastForwardTime(10740, web3.currentProvider) // fast forward 2hrs 59 minutes
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, true)
	})

	it("chainlinkWorking: Chainlink is out of date by <3hrs: return Chainklink price", async () => {
		await setAddressesAndOracle()
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingBefore, true)
		await mockChainlink.setPrice(dec(1234, 8))
		await mockChainlink.setPrevPrice(dec(1234, 8))
		await fastForwardTime(10740, web3.currentProvider) // fast forward 2hrs 59 minutes
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		assert.equal(price, dec(1234, 18))
	})

	// --- Chainlink price deviation ---

	it("chainlinkWorking: Chainlink price drop of <50%, remain feedWorking and return oracle price", async () => {
		await setAddressesAndOracle()
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingBefore, true)
		await mockChainlink.setPrice(dec(100000001)) // price drops to 1.00000001: a drop of < 50% from previous
		await mockChainlink.setPrevPrice(dec(2, 8)) // price = 2
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, true)
		assert.equal(price, dec(100000001, 10))
	})

	it("chainlinkWorking: Chainlink price drop of 50%, remain feedWorking and return oracle price", async () => {
		await setAddressesAndOracle()
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingBefore, true)
		await mockChainlink.setPrice(dec(1, 8)) // price drops to 1
		await mockChainlink.setPrevPrice(dec(2, 8)) // price = 2
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, true)
		assert.equal(price, dec(1, 18))
	})

	it("chainlinkWorking: Chainlink price drop of >50%, feedWorking turns false, return previous price", async () => {
		await setAddressesAndOracle()
		await mockChainlink.setDecimals(18)
		await mockChainlink.setPrice(dec(3, 18))
		await mockChainlink.setPrevPrice(dec(3, 18)) // price = 3
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		// price drops to 1: a drop of > 50% from previous
		await mockChainlink.setPrice(dec(1, 18))
		await mockChainlink.setPrevPrice(dec(3, 18))
		const tx = await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, false)
		assert.equal(price.toString(), dec(3, 18))
	})

	it("chainlinkWorking: Chainlink price increase of 100%, remain feedWorking and return oracle price", async () => {
		await setAddressesAndOracle()
		await mockChainlink.setPrice(dec(4, 8)) // price increases to 4: an increase of 100% from previous
		await mockChainlink.setPrevPrice(dec(2, 8)) // price = 2
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, true)
		assert.equal(price, dec(4, 18))
	})

	it("chainlinkWorking: Chainlink price increase of <100%, remain feedWorking and return oracle price", async () => {
		await setAddressesAndOracle()
		await mockChainlink.setPrice(399999999) // price increases to 3.99999999: an increase of < 100% from previous
		await mockChainlink.setPrevPrice(dec(2, 8)) // price = 2
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, true)
		assert.equal(price, dec(399999999, 10))
	})

	it("chainlinkUntrusted: Oracle is broken, use last stored price record, and feedWorking remain false", async () => {
		await setAddressesAndOracle()
		await mockChainlink.setLatestRoundId(0)
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const feedWorkingBefore = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingBefore, false)
		await mockChainlink.setPrice(dec(1234, 8))
		await mockChainlink.setPrevPrice(dec(1234, 8))
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingBefore, feedWorkingAfter)
		assert.equal(price, DEFAULT_PRICE.toString())
	})

	it("chainlinkUntrusted: Oracle was broken but provides good response, use oracle price and update feedWorking", async () => {
		await setAddressesAndOracle()
		await mockChainlink.setLatestRoundId(0)
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		await mockChainlink.setPrice(dec(1234, 8))
		await mockChainlink.setPrevPrice(dec(1234, 8))
		await mockChainlink.setLatestRoundId(4)
		await mockChainlink.setPrevRoundId(3)
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const price = await getPrice()
		const feedWorkingAfter = (await priceFeed.oracleRecords(ZERO_ADDRESS)).isFeedWorking
		assert.equal(feedWorkingAfter, true)
		assert.equal(price, dec(1234, 18).toString())
	})
})

contract("Reset chain state", async accounts => {})
