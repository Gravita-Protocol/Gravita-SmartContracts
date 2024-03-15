// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "./Dependencies/BaseMath.sol";
import "./Dependencies/GravitaMath.sol";

import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IRETHToken.sol";
import "./Interfaces/IWstETHToken.sol";

contract PriceFeedL2 is IPriceFeed, OwnableUpgradeable, BaseMath {
	using SafeMathUpgradeable for uint256;

	/** Constants ---------------------------------------------------------------------------------------------------- */

	string public constant NAME = "PriceFeed";

	// Used to convert a chainlink price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;

	uint256 public constant TIMEOUT = 4 hours;
	uint256 public constant ORACLE_UPDATE_TIMELOCK = 4 hours;

	// Maximum deviation allowed between two consecutive Chainlink oracle prices. 18-digit precision.
	uint256 public constant MAX_PRICE_DEVIATION_FROM_PREVIOUS_ROUND = 5e17; // 50%

	/** State -------------------------------------------------------------------------------------------------------- */

	address public adminContract;
	address public rethToken;
	address public stethToken;
	address public wstethToken;

	mapping(address => OracleRecord) public queuedOracles;
	mapping(address => OracleRecord) public registeredOracles;

	mapping(address => uint256) public lastGoodPrice;

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

	function addOracle(address _token, address _chainlinkOracle, bool _isEthIndexed) external override isController {
		AggregatorV3Interface newOracle = AggregatorV3Interface(_chainlinkOracle);
		_validateFeedResponse(newOracle);
		if (registeredOracles[_token].exists) {
			uint256 timelockRelease = block.timestamp.add(ORACLE_UPDATE_TIMELOCK);
			queuedOracles[_token] = OracleRecord({
				chainLinkOracle: newOracle,
				timelockRelease: timelockRelease,
				exists: true,
				isFeedWorking: true,
				isEthIndexed: _isEthIndexed
			});
		} else {
			registeredOracles[_token] = OracleRecord({
				chainLinkOracle: newOracle,
				timelockRelease: block.timestamp,
				exists: true,
				isFeedWorking: true,
				isEthIndexed: _isEthIndexed
			});
			emit NewOracleRegistered(_token, _chainlinkOracle, _isEthIndexed);
		}
	}

	function deleteOracle(address _token) external override isController {
		delete registeredOracles[_token];
	}

	function deleteQueuedOracle(address _token) external override isController {
		delete queuedOracles[_token];
	}

	/** Public functions --------------------------------------------------------------------------------------------- */

	function fetchPrice(address _token) public override returns (uint256 lastTokenGoodPrice) {
		OracleRecord memory oracle = _getOracle(_token);
		if (!oracle.exists) {
			if (_token == rethToken) {
				return _fetchNativeRETHPrice();
			} else if (_token == wstethToken) {
				return _fetchNativeWstETHPrice();
			}
			revert UnknownOracleError(_token);
		}

		lastTokenGoodPrice = lastGoodPrice[_token];

		(FeedResponse memory currResponse, FeedResponse memory prevResponse) = _fetchFeedResponses(oracle.chainLinkOracle);

		bool isValidResponse = _isFeedWorking(currResponse, prevResponse) &&
			!_isFeedFrozen(currResponse) &&
			!_isPriceChangeAboveMaxDeviation(_token, currResponse, prevResponse);

		if (isValidResponse) {
			uint256 scaledPrice = _scalePriceByDigits(uint256(currResponse.answer), currResponse.decimals);
			if (oracle.isEthIndexed) {
				// Oracle returns ETH price, need to convert to USD
				lastTokenGoodPrice = _calcEthPrice(scaledPrice);
			} else {
				lastTokenGoodPrice = scaledPrice;
			}
			_storePrice(_token, lastTokenGoodPrice);
			if (!oracle.isFeedWorking) {
				_updateFeedStatus(_token, oracle, true);
			}
		} else {
			if (oracle.isFeedWorking) {
				_updateFeedStatus(_token, oracle, false);
			}
		}
	}

	/** Internal functions ------------------------------------------------------------------------------------------- */

	function _getOracle(address _token) internal returns (OracleRecord memory) {
		OracleRecord memory queuedOracle = queuedOracles[_token];
		if (queuedOracle.exists && queuedOracle.timelockRelease < block.timestamp) {
			registeredOracles[_token] = queuedOracle;
			emit NewOracleRegistered(_token, address(queuedOracle.chainLinkOracle), queuedOracle.isEthIndexed);
			delete queuedOracles[_token];
			return queuedOracle;
		}
		return registeredOracles[_token];
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
		_storePrice(rethToken, price);
	}

	/**
	 * Queries the wstETH token contract for its current stETH value, then either queries the stETH/USD oracle (if there is one),
	 * or the ETH/USD oracle for the price.
	 * Requires that an oracle has been added for stETH/USD (preferably) or the ETH/USD price.
	 */
	function _fetchNativeWstETHPrice() internal returns (uint256 price) {
		uint256 wstEthToStEthValue = _getWstETH_StETHValue();
		OracleRecord storage stEth_UsdOracle = registeredOracles[stethToken];
		price = stEth_UsdOracle.exists ? fetchPrice(stethToken) : _calcEthPrice(wstEthToStEthValue);
		_storePrice(wstethToken, price);
	}

	function _getRETH_ETHValue() internal view virtual returns (uint256) {
		return IRETHToken(rethToken).getEthValue(1 ether);
	}

	function _getWstETH_StETHValue() internal view virtual returns (uint256) {
		return IWstETHToken(wstethToken).stEthPerToken();
	}

	function _validateFeedResponse(AggregatorV3Interface oracle) internal view {
		(FeedResponse memory chainlinkResponse, FeedResponse memory prevFeedResponse) = _fetchFeedResponses(oracle);
		require(
			_isFeedWorking(chainlinkResponse, prevFeedResponse) && !_isFeedFrozen(chainlinkResponse),
			"PriceFeed: Chainlink must be working and current"
		);
	}

	function _fetchFeedResponses(
		AggregatorV3Interface oracle
	) internal view returns (FeedResponse memory currResponse, FeedResponse memory prevResponse) {
		currResponse = _fetchCurrentFeedResponse(oracle);
		prevResponse = _fetchPrevFeedResponse(oracle, currResponse.roundId, currResponse.decimals);
	}

	function _isFeedFrozen(FeedResponse memory _response) internal view returns (bool) {
		return block.timestamp.sub(_response.timestamp) > TIMEOUT;
	}

	function _isFeedWorking(
		FeedResponse memory _currentResponse,
		FeedResponse memory _prevResponse
	) internal view returns (bool) {
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
		address _token,
		FeedResponse memory _currResponse,
		FeedResponse memory _prevResponse
	) internal returns (bool isAboveDeviation) {
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

		// Return true if price has more than doubled, or more than halved.
		isAboveDeviation = percentDeviation > MAX_PRICE_DEVIATION_FROM_PREVIOUS_ROUND;
		if (isAboveDeviation) {
			emit PriceDeviationAlert(_token, currentScaledPrice, prevScaledPrice);
		}
	}

	function _scalePriceByDigits(uint256 _price, uint256 _answerDigits) internal pure returns (uint256 price) {
		if (_answerDigits >= TARGET_DIGITS) {
			// Scale the returned price value down to Gravita's target precision
			price = _price.div(10 ** (_answerDigits - TARGET_DIGITS));
		} else if (_answerDigits < TARGET_DIGITS) {
			// Scale the returned price value up to Gravita's target precision
			price = _price.mul(10 ** (TARGET_DIGITS - _answerDigits));
		}
	}

	function _updateFeedStatus(address _token, OracleRecord memory _oracle, bool _isWorking) internal {
		registeredOracles[_token].isFeedWorking = _isWorking;
		emit PriceFeedStatusUpdated(_token, address(_oracle.chainLinkOracle), _isWorking);
	}

	function _storePrice(address _token, uint256 _currentPrice) internal {
		lastGoodPrice[_token] = _currentPrice;
		emit LastGoodPriceUpdated(_token, _currentPrice);
	}

	function _fetchCurrentFeedResponse(
		AggregatorV3Interface _priceAggregator
	) internal view returns (FeedResponse memory response) {
		try _priceAggregator.decimals() returns (uint8 decimals) {
			response.decimals = decimals;
		} catch {}
		try _priceAggregator.latestRoundData() returns (
			uint80 roundId,
			int256 answer,
			uint256 /* startedAt */,
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
				uint256 /* startedAt */,
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
