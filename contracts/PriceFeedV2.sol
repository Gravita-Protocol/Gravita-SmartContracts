// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./Dependencies/BaseMath.sol";
import "./Dependencies/GravitaMath.sol";
import "./Addresses.sol";
import "./Interfaces/IPriceFeedV2.sol";

contract PriceFeedV2 is IPriceFeedV2, OwnableUpgradeable, UUPSUpgradeable, BaseMath, Addresses {
	// Constants ------------------------------------------------------------------------------------------------------

	string public constant NAME = "PriceFeedV2";

	// Used to convert a price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;

	// State ----------------------------------------------------------------------------------------------------------

	mapping(address => OracleRecord) public oracles;
	mapping(address => OracleRecord) public fallbacks;

	// Initializer ----------------------------------------------------------------------------------------------------

	function initialize() public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
	}

	// Admin routines -------------------------------------------------------------------------------------------------

    function _checkTimelockRequired(_token, _isFallback) {
		OracleRecord memory record = _isFallback ? fallbacks[_token] : oracles[_token];
		if (record.oracleAddress == address(0)) {
			_checkOwner(); // Owner can set an oracle for the first time
		} else {
			_checkTimelock(); // Subsequent updates need to go through the timelock contract
		}
    }

	function setOracle(
		address _token,
		address _oracle,
		ProviderType _type,
		uint256 _timeout,
		bool _isEthIndexed,
		bool _isFallback
	) external override {
        _checkTimelockRequired(_token, _isFallback);
		uint256 decimals = _fetchDecimals(_oracle, _type);
		OracleRecord newRecord = OracleRecord({
			oracleAddress: _orace,
			providerType: _type,
			timeout: _timeout,
			decimals: decimals,
			isEthIndexed: _isEthIndexed
		});
		OracleResponse response = _fetchOracleResponse(newRecord);
        if (!_validateResponse(response)) {
            // revert
        }
        if (_isFallback) {
            fallbacks[_token] = newRecord;
        } else {
            oracles[_token] = newRecord;
        }
		emit NewOracleRegistered(_token, _oracle, _isEthIndexed, _isFallback);
	}

    function _fetchDecimals(address _oracle, ProviderType _type) returns (uint256) {
        if (_type == ProviderType.Chainlink) {
            return AggregatorV3Interface(_oracle).decimals();
        }
        if (_type == ProviderType.Redstone) {
            return 8;
        }
    }

	// Public functions -----------------------------------------------------------------------------------------------

	/**
	 * Callers:
	 *   - BorrowerOperations.openVessel()
	 *   - BorrowerOperations.adjustVessel()
	 *   - BorrowerOperations.closeVessel()
	 *   - VesselManagerOperations.liquidateVessels()
	 *   - VesselManagerOperations.batchLiquidateVessels()
	 *   - VesselManagerOperations.redeemCollateral()
	 */
	function fetchPrice(address _token) public override returns (uint256) {
		uint256 price = _fetchOraclePrice(oracles[_token]);
		if (price != 0) {
			return price;
		}
		price = _fetchOraclePrice(fallbacks[_token]);
		if (price != 0) {
			return price;
		}
		revert PriceFeed__InvalidFeedResponseError(_token);
	}

	function _fetchOraclePrice(OracleRecord memory record) {
		if (oracle.address == address(0)) {
			return 0;
		}
	}

	// Internal functions -----------------------------------------------------------------------------------------------

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

	function _isValidResponse(FeedResponse memory _response) internal view returns (bool) {
		return
			(_response.success) &&
			(_response.roundId != 0) &&
			(_response.timestamp != 0) &&
			(_response.timestamp <= block.timestamp) &&
			(_response.answer != 0);
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
			price = _price / (10 ** (_answerDigits - TARGET_DIGITS));
		} else if (_answerDigits < TARGET_DIGITS) {
			// Scale the returned price value up to Gravita's target precision
			price = _price * (10 ** (TARGET_DIGITS - _answerDigits));
		}
	}

	function _fetchCurrentFeedResponse(
		AggregatorV3Interface _priceAggregator
	) internal view returns (FeedResponse memory response) {
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
			uint256 /* startedAt */,
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

	function _checkTimelock() internal view {
		if (msg.sender != timelockAddress) {
			revert PriceFeed__TimelockOnlyError();
		}
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}

