const {
	time,
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
} = require("@nomicfoundation/hardhat-network-helpers")
const AdminContract = artifacts.require("AdminContract")
const ERC20Mock = artifacts.require("ERC20Mock")
const MockChainlink = artifacts.require("MockAggregator")
const PriceFeed = artifacts.require("PriceFeedTester")
const PriceFeedTestnet = artifacts.require("PriceFeedTestnet")
const Timelock = artifacts.require("Timelock")

const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { assert } = require("hardhat")
const testHelpers = require("../../utils/testHelpers.js")
const th = testHelpers.TestHelper

const { dec, assertRevert, toBN } = th

const MAX_PRICE_DEVIATION_BETWEEN_ROUNDS = dec(5, 17) // 0.5 ether
const DEFAULT_PRICE = dec(100, 18)
const DEFAULT_PRICE_e8 = dec(100, 8)
const CBETH_TOKEN_ADDRESS =
	/* goerli: */ "0xbe9895146f7af43049ca1c1ae358b0541ea49704" /* mainnet: "0xbe9895146f7af43049ca1c1ae358b0541ea49704" */
const RETH_TOKEN_ADDRESS =
	/* goerli: */ "0x62BC478FFC429161115A6E4090f819CE5C50A5d9" /* mainnet: "0xae78736Cd615f374D3085123A210448E74Fc6393" */
const STETH_TOKEN_ADDRESS =
	/* goerli: */ "0xc58af6BFaeA2F559085b75E4EccA913B015D93a4" /* mainnet: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" */
const WSTETH_TOKEN_ADDRESS =
	/* goerli: */ "0x6320cD32aA674d2898A68ec82e869385Fc5f7E2f" /* mainnet: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" */

contract("PriceFeed", async accounts => {
	const [owner, alice] = accounts
	let priceFeedTestnet
	let priceFeed
	let mockChainlink
	let adminContract
	let shortTimelock
	let erc20

	const setAddressesAndOracle = async () => {
		await priceFeed.setAddresses(
			adminContract.address,
			shortTimelock.address,
			{
				from: owner,
			}
		)
		await setOracle(ZERO_ADDRESS, mockChainlink.address)
		await priceFeed.fetchPrice(ZERO_ADDRESS)
	}

	const setOracle = async (erc20Address, aggregatorAddress, isIndexed = false) => {
		await impersonateAccount(shortTimelock.address)
		await priceFeed.setOracle(erc20Address, aggregatorAddress, MAX_PRICE_DEVIATION_BETWEEN_ROUNDS, isIndexed, {
			from: shortTimelock.address,
		})
		await stopImpersonatingAccount(shortTimelock.address)
	}

	const getPrice = async (erc20Address = ZERO_ADDRESS) => {
		const priceRecord = await priceFeed.priceRecords(erc20Address)
		return priceRecord.scaledPrice
	}

	beforeEach(async () => {
		priceFeedTestnet = await PriceFeedTestnet.new()
		PriceFeedTestnet.setAsDeployed(priceFeedTestnet)

		priceFeed = await PriceFeed.new()
		PriceFeed.setAsDeployed(priceFeed)

		mockChainlink = await MockChainlink.new()
		MockChainlink.setAsDeployed(mockChainlink)

		adminContract = await AdminContract.new()
		AdminContract.setAsDeployed(adminContract)

		erc20 = await ERC20Mock.new("MOCK", "MOCK", 18)
		ERC20Mock.setAsDeployed(erc20)

		shortTimelock = await Timelock.new(86400 * 3)
		Timelock.setAsDeployed(shortTimelock)
		setBalance(shortTimelock.address, 1e18)

		// Set Chainlink latest and prev roundId's to non-zero
		await mockChainlink.setLatestRoundId(3)
		await mockChainlink.setPrevRoundId(2)

		// Set current and prev prices
		await mockChainlink.setPrice(DEFAULT_PRICE_e8)
		await mockChainlink.setPrevPrice(DEFAULT_PRICE_e8)

		await mockChainlink.setDecimals(8)

		// Set mock price updateTimes to very recent
		const now = await th.getLatestBlockTimestamp(web3)
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
		it("setAddresses should fail after addresses have already been set", async () => {
			// Owner can successfully set any address
			const txOwner = await priceFeed.setAddresses(
				adminContract.address,
				shortTimelock.address,
				{ from: owner }
			)
			assert.isTrue(txOwner.receipt.status)

			await assertRevert(
				priceFeed.setAddresses(
					adminContract.address,
					shortTimelock.address,
					{
						from: owner,
					}
				)
			)

			await assertRevert(
				priceFeed.setAddresses(
					adminContract.address,
					shortTimelock.address,
					{
						from: alice,
					}
				),
				"OwnableUpgradeable: caller is not the owner"
			)
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

	it("fetchPrice of ETH-indexed Oracle", async () => {
		await setAddressesAndOracle()
		const ETH_TO_USD = dec(1600, 18)
		mockChainlink.setPrice(ETH_TO_USD)
		mockChainlink.setPrevPrice(ETH_TO_USD)
		mockChainlink.setDecimals(18)
		const ERC20_TO_ETH = dec(11, 17) // MOCK:ETH = 1,1
		const erc20MockChainlink = await MockChainlink.new()
		await erc20MockChainlink.setPrice(ERC20_TO_ETH)
		await erc20MockChainlink.setPrevPrice(ERC20_TO_ETH)
		await erc20MockChainlink.setLatestRoundId(3)
		await erc20MockChainlink.setPrevRoundId(2)
		await erc20MockChainlink.setDecimals(18)
		await erc20MockChainlink.setUpdateTime(await th.getLatestBlockTimestamp(web3))
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

	// Removed as we don't use the native feed anymore
	it.skip("chainlinkWorking: rETH and wstETH prices", async () => {
		const ethers = require("ethers")
		const ETH_USD_PRICE_18_DIGITS = "1341616900000000000000"
		await setAddressesAndOracle()

		await mockChainlink.setDecimals(18)
		await mockChainlink.setPrice(ETH_USD_PRICE_18_DIGITS)
		await mockChainlink.setPrevPrice(ETH_USD_PRICE_18_DIGITS)
		await mockChainlink.setLatestRoundId("92233720368547797825")

		await setOracle(ZERO_ADDRESS, mockChainlink.address)
		await priceFeed.fetchPrice(ZERO_ADDRESS)
		const ethPrice = await getPrice()
		assert.equal(ethPrice.toString(), ETH_USD_PRICE_18_DIGITS)


		const RETH_ETH_RATIO_18_DIGITS = "1054021266924449498"
		await priceFeed.fetchPrice(RETH_TOKEN_ADDRESS)
		const rethPrice = await getPrice(RETH_TOKEN_ADDRESS)
		const expectedRethPrice = ethers.BigNumber.from(RETH_ETH_RATIO_18_DIGITS)
			.mul(ETH_USD_PRICE_18_DIGITS)
			.div("1000000000000000000")
		assert.equal(rethPrice.toString(), expectedRethPrice.toString())

		const WSTETH_STETH_RATIO_18_DIGITS = "1104446462143629660"
		await priceFeed.fetchPrice(WSTETH_TOKEN_ADDRESS)
		const wstEthPrice = await getPrice(WSTETH_TOKEN_ADDRESS)
		const expectedWstethPrice = ethers.BigNumber.from(WSTETH_STETH_RATIO_18_DIGITS)
			.mul(ETH_USD_PRICE_18_DIGITS)
			.div("1000000000000000000")
		assert.equal(wstEthPrice.toString(), expectedWstethPrice.toString())
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
		await th.fastForwardTime(10740, web3.currentProvider) // fast forward 2hrs 59 minutes
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
		await th.fastForwardTime(10740, web3.currentProvider) // fast forward 2hrs 59 minutes
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
