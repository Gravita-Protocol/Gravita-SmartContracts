// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "./Dependencies/BaseMath.sol";
import "./Dependencies/GravitaMath.sol";

import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IRETHToken.sol";
import "./Interfaces/IWstETHToken.sol";

contract PriceFeed is IPriceFeed, OwnableUpgradeable, BaseMath {
	using SafeMathUpgradeable for uint256;

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

	address public adminContract;
	address public rethToken;
	address public stethToken;
	address public wstethToken;

	mapping(address => OracleRecord) public oracleRecords;
	mapping(address => PriceRecord) public priceRecords;

	/** Modifiers ---------------------------------------------------------------------------------------------------- */

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	/** Initializer -------------------------------------------------------------------------------------------------- */

	function setAddresses(
		address _adminContract,
		address _rethToken,
		address _stethToken,
		address _wstethToken
	) external initializer {
		__Ownable_init();
		adminContract = _adminContract;
		rethToken = _rethToken;
		stethToken = _stethToken;
		wstethToken = _wstethToken;
	}

	/** Admin routines ----------------------------------------------------------------------------------------------- */

	function setOracle(
		address _token,
		address _chainlinkOracle,
		uint256 _maxDeviationBetweenRounds,
		bool _isEthIndexed
	) external override isController {
		if (
			_maxDeviationBetweenRounds < MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_LOWER_LIMIT ||
			_maxDeviationBetweenRounds > MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_UPPER_LIMIT
		) {
			revert InvalidPriceDeviationParamError();
		}

		AggregatorV3Interface newFeed = AggregatorV3Interface(_chainlinkOracle);
		(FeedResponse memory currResponse, FeedResponse memory prevResponse) = _fetchFeedResponses(newFeed);

		if (!_isFeedWorking(currResponse, prevResponse)) {
			revert InvalidFeedResponseError(_token);
		}
		if (_isPriceStale(currResponse.timestamp)) {
			revert FeedFrozenError(_token);
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
			if (_token == rethToken) {
				return _fetchNativeRETHPrice();
			} else if (_token == wstethToken) {
				return _fetchNativeWstETHPrice();
			}
			revert UnknownFeedError(_token);
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
				revert FeedFrozenError(_token);
			}
			return priceRecord.scaledPrice;
		}
	}

	function _calcEthPrice(uint256 ethAmount) internal returns (uint256) {
		uint256 ethPrice = fetchPrice(address(0));
		return ethPrice.mul(ethAmount).div(1 ether);
	}

	/**
	 * Queries the rETH token contract for its current ETH value, then queries the ETH/USD oracle for the price.
	 * Requires that an oracle has been added for ETH/USD.
	 */
	function _fetchNativeRETHPrice() internal returns (uint256 price) {
		uint256 rethToEthValue = _getRETH_ETHValue();
		price = _calcEthPrice(rethToEthValue);
		_storePrice(rethToken, price, block.timestamp);
	}

	/**
	 * Queries the wstETH token contract for its current stETH value, then either queries the stETH/USD oracle (if there is one),
	 * or the ETH/USD oracle for the price.
	 * Requires that an oracle has been added for stETH/USD (preferably) or the ETH/USD price.
	 */
	function _fetchNativeWstETHPrice() internal returns (uint256 price) {
		uint256 wstEthToStEthValue = _getWstETH_StETHValue();
		OracleRecord storage stEth_UsdOracle = oracleRecords[stethToken];
		price = stEth_UsdOracle.exists ? fetchPrice(stethToken) : _calcEthPrice(wstEthToStEthValue);
		_storePrice(wstethToken, price, block.timestamp);
	}

	function _getRETH_ETHValue() internal view virtual returns (uint256) {
		return IRETHToken(rethToken).getEthValue(1 ether);
	}

	function _getWstETH_StETHValue() internal view virtual returns (uint256) {
		return IWstETHToken(wstethToken).stEthPerToken();
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
		return block.timestamp.sub(_priceTimestamp) > RESPONSE_TIMEOUT;
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
		 * - If price decreased, the percentage deviation is in relation to the the previous price.
		 * - If price increased, the percentage deviation is in relation to the current price.
		 */
		uint256 percentDeviation = maxPrice.sub(minPrice).mul(DECIMAL_PRECISION).div(maxPrice);

		return percentDeviation > _maxDeviationBetweenRounds;
	}

	function _scalePriceByDigits(uint256 _price, uint256 _answerDigits) internal pure returns (uint256 price) {
		if (_answerDigits >= TARGET_DIGITS) {
			// Scale the returned price value down to Gravita's target precision
			price = _price.div(10**(_answerDigits - TARGET_DIGITS));
		} else if (_answerDigits < TARGET_DIGITS) {
			// Scale the returned price value up to Gravita's target precision
			price = _price.mul(10**(TARGET_DIGITS - _answerDigits));
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
		response.decimals = _priceAggregator.decimals();
		try _priceAggregator.latestRoundData() returns (
			uint80 roundId,
			int256 answer,
			uint256, /* startedAt */
			uint256 timestamp,
			uint80 /* answeredInRound */
		) {
			response.roundId = roundId;
			response.answer = answer;
			response.timestamp = timestamp;
			response.success = true;
		} catch {}
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
}
