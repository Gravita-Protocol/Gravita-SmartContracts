// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./Dependencies/BaseMath.sol";
import "./Dependencies/GravitaMath.sol";

import "./Interfaces/IPriceFeed.sol";

contract PriceFeed is IPriceFeed, OwnableUpgradeable, BaseMath {
	/** Constants ---------------------------------------------------------------------------------------------------- */

	string public constant NAME = "PriceFeed";

	// Used to convert a chainlink price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;

	// After this timeout, responses will be considered stale and revert
	uint256 public constant RESPONSE_TIMEOUT = 4 hours;

	// Lower/Upper limits for setting the max price deviation per round, per asset
	uint256 public constant MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_LOWER_LIMIT = 0.2 ether;
	uint256 public constant MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_UPPER_LIMIT = 0.5 ether;

	/** State -------------------------------------------------------------------------------------------------------- */

	address public adminContractAddress;
	address public timelockAddress;

	mapping(address => OracleRecord) public oracleRecords;
	mapping(address => PriceRecord) public priceRecords;

	/** Initializer -------------------------------------------------------------------------------------------------- */

	function setAddresses(address _adminContractAddress, address _timelockAddress) external initializer {
		__Ownable_init();
		timelockAddress = _timelockAddress;
		adminContractAddress = _adminContractAddress;
	}

	/** Admin routines ----------------------------------------------------------------------------------------------- */

	function setOracle(
		address _token,
		address _chainlinkOracle,
		uint256 _maxDeviationBetweenRounds,
		bool _isEthIndexed
	) external override {
		OracleRecord storage oracle = oracleRecords[_token];
		if (!oracle.exists) {
			_checkOwner(); // Owner can set an oracle for the first time
		} else {
			_checkTimelock(); // Subsequent updates need to go through the timelock contract
		}

		if (
			_maxDeviationBetweenRounds < MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_LOWER_LIMIT ||
			_maxDeviationBetweenRounds > MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_UPPER_LIMIT
		) {
			revert PriceFeed__InvalidPriceDeviationParamError();
		}

		AggregatorV3Interface newFeed = AggregatorV3Interface(_chainlinkOracle);
		(FeedResponse memory currResponse, FeedResponse memory prevResponse) = _fetchFeedResponses(newFeed);

		if (!_isFeedWorking(currResponse, prevResponse)) {
			revert PriceFeed__InvalidFeedResponseError(_token);
		}
		if (_isPriceStale(currResponse.timestamp)) {
			revert PriceFeed__FeedFrozenError(_token);
		}
		oracleRecords[_token] = OracleRecord({
			chainLinkOracle: newFeed,
			maxDeviationBetweenRounds: _maxDeviationBetweenRounds,
			exists: true,
			isFeedWorking: true,
			isEthIndexed: _isEthIndexed
		});

		_processFeedResponses(_token, oracleRecords[_token], currResponse, prevResponse);
		emit NewOracleRegistered(_token, _chainlinkOracle, _isEthIndexed);
	}

	/** Public functions --------------------------------------------------------------------------------------------- */

	/**
	 * Callers:
	 *   - BorrowerOperations.openVessel()
	 *   - BorrowerOperations.adjustVessel()
	 *   - BorrowerOperations.closeVessel()
	 *   - StabilityPool.withdrawFromSP()
	 *   - VesselManagerOperations.liquidateVessels()
	 *   - VesselManagerOperations.batchLiquidateVessels()
	 *   - VesselManagerOperations.redeemCollateral()
	 */
	function fetchPrice(address _token) public override returns (uint256) {
		OracleRecord storage oracle = oracleRecords[_token];

		if (!oracle.exists) {
			revert PriceFeed__UnknownFeedError(_token);
		}

		(FeedResponse memory currResponse, FeedResponse memory prevResponse) = _fetchFeedResponses(oracle.chainLinkOracle);
		return _processFeedResponses(_token, oracle, currResponse, prevResponse);
	}

	/** Internal functions ------------------------------------------------------------------------------------------- */

	function _processFeedResponses(
		address _token,
		OracleRecord storage oracle,
		FeedResponse memory _currResponse,
		FeedResponse memory _prevResponse
	) internal returns (uint256) {
		bool isValidResponse = _isFeedWorking(_currResponse, _prevResponse) &&
			!_isPriceStale(_currResponse.timestamp) &&
			!_isPriceChangeAboveMaxDeviation(oracle.maxDeviationBetweenRounds, _currResponse, _prevResponse);

		if (isValidResponse) {
			uint256 scaledPrice = _scalePriceByDigits(uint256(_currResponse.answer), _currResponse.decimals);
			if (oracle.isEthIndexed) {
				// Oracle returns ETH price, need to convert to USD
				scaledPrice = _calcEthPrice(scaledPrice);
			}
			if (!oracle.isFeedWorking) {
				_updateFeedStatus(_token, oracle, true);
			}
			_storePrice(_token, scaledPrice, _currResponse.timestamp);
			return scaledPrice;
		} else {
			if (oracle.isFeedWorking) {
				_updateFeedStatus(_token, oracle, false);
			}
			PriceRecord memory priceRecord = priceRecords[_token];
			if (_isPriceStale(priceRecord.timestamp)) {
				revert PriceFeed__FeedFrozenError(_token);
			}
			return priceRecord.scaledPrice;
		}
	}

	function _calcEthPrice(uint256 ethAmount) internal returns (uint256) {
		uint256 ethPrice = fetchPrice(address(0));
		return (ethPrice * ethAmount) / 1 ether;
	}

	function _fetchFeedResponses(AggregatorV3Interface oracle)
		internal
		view
		returns (FeedResponse memory currResponse, FeedResponse memory prevResponse)
	{
		currResponse = _fetchCurrentFeedResponse(oracle);
		prevResponse = _fetchPrevFeedResponse(oracle, currResponse.roundId, currResponse.decimals);
	}

	function _isPriceStale(uint256 _priceTimestamp) internal view returns (bool) {
		return block.timestamp - _priceTimestamp > RESPONSE_TIMEOUT;
	}

	function _isFeedWorking(FeedResponse memory _currentResponse, FeedResponse memory _prevResponse)
		internal
		view
		returns (bool)
	{
		return _isValidResponse(_currentResponse) && _isValidResponse(_prevResponse);
	}

	function _isValidResponse(FeedResponse memory _response) internal view returns (bool) {
		return
			(_response.success) &&
			(_response.roundId > 0) &&
			(_response.timestamp > 0) &&
			(_response.timestamp <= block.timestamp) &&
			(_response.answer > 0);
	}

	function _isPriceChangeAboveMaxDeviation(
		uint256 _maxDeviationBetweenRounds,
		FeedResponse memory _currResponse,
		FeedResponse memory _prevResponse
	) internal pure returns (bool) {
		uint256 currentScaledPrice = _scalePriceByDigits(uint256(_currResponse.answer), _currResponse.decimals);
		uint256 prevScaledPrice = _scalePriceByDigits(uint256(_prevResponse.answer), _prevResponse.decimals);

		uint256 minPrice = GravitaMath._min(currentScaledPrice, prevScaledPrice);
		uint256 maxPrice = GravitaMath._max(currentScaledPrice, prevScaledPrice);

		/*
		 * Use the larger price as the denominator:
		 * - If price decreased, the percentage deviation is in relation to the previous price.
		 * - If price increased, the percentage deviation is in relation to the current price.
		 */
		uint256 percentDeviation = ((maxPrice - minPrice) * DECIMAL_PRECISION) / maxPrice;

		return percentDeviation > _maxDeviationBetweenRounds;
	}

	function _scalePriceByDigits(uint256 _price, uint256 _answerDigits) internal pure returns (uint256 price) {
		if (_answerDigits >= TARGET_DIGITS) {
			// Scale the returned price value down to Gravita's target precision
			price = _price / (10**(_answerDigits - TARGET_DIGITS));
		} else if (_answerDigits < TARGET_DIGITS) {
			// Scale the returned price value up to Gravita's target precision
			price = _price * (10**(TARGET_DIGITS - _answerDigits));
		}
	}

	function _updateFeedStatus(
		address _token,
		OracleRecord memory _oracle,
		bool _isWorking
	) internal {
		oracleRecords[_token].isFeedWorking = _isWorking;
		emit PriceFeedStatusUpdated(_token, address(_oracle.chainLinkOracle), _isWorking);
	}

	function _storePrice(
		address _token,
		uint256 _price,
		uint256 _timestamp
	) internal {
		priceRecords[_token] = PriceRecord({ scaledPrice: _price, timestamp: _timestamp });
		emit PriceRecordUpdated(_token, _price);
	}

	function _fetchCurrentFeedResponse(AggregatorV3Interface _priceAggregator)
		internal
		view
		returns (FeedResponse memory response)
	{
		try _priceAggregator.decimals() returns (uint8 decimals) {
			// If call to Chainlink succeeds, record the current decimal precision
			response.decimals = decimals;
		} catch {
			// If call to Chainlink aggregator reverts, return a zero response with success = false
			return response;
		}
		try _priceAggregator.latestRoundData() returns (
			uint80 roundId,
			int256 answer,
			uint256, /* startedAt */
			uint256 timestamp,
			uint80 /* answeredInRound */
		) {
			// If call to Chainlink succeeds, return the response and success = true
			response.roundId = roundId;
			response.answer = answer;
			response.timestamp = timestamp;
			response.success = true;
		} catch {
			// If call to Chainlink aggregator reverts, return a zero response with success = false
			return response;
		}
	}

	function _fetchPrevFeedResponse(
		AggregatorV3Interface _priceAggregator,
		uint80 _currentRoundId,
		uint8 _currentDecimals
	) internal view returns (FeedResponse memory prevResponse) {
		if (_currentRoundId == 0) {
			return prevResponse;
		}
		unchecked {
			try _priceAggregator.getRoundData(_currentRoundId - 1) returns (
				uint80 roundId,
				int256 answer,
				uint256, /* startedAt */
				uint256 timestamp,
				uint80 /* answeredInRound */
			) {
				prevResponse.roundId = roundId;
				prevResponse.answer = answer;
				prevResponse.timestamp = timestamp;
				prevResponse.decimals = _currentDecimals;
				prevResponse.success = true;
			} catch {}
		}
	}

	function _checkTimelock() internal view {
		if (msg.sender != timelockAddress) {
			revert PriceFeed__TimelockOnly();
		}
	}
}
