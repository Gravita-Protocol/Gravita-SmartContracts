// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../Integrations/Curve-Convex/Interfaces/ICurvePool.sol";

/**
 * @title CurveLP price feed aggregator for pools that use 2 underlying assets.
 * @dev Based on https://github.com/Gearbox-protocol/integrations-v2/blob/main/contracts/oracles/curve/CurveLP2PriceFeed.sol
 */
contract CurveLP2PriceAggregator is AggregatorV3Interface, Ownable {
	// Custom Errors --------------------------------------------------------------------------------------------------

	error AddressZeroException();
	error NotImplementedException();
	error PriceStaleException();
	error PriceZeroException();
	error ValueOutOfRangeException();
	error VirtualPriceBoundariesException();

	// Events ---------------------------------------------------------------------------------------------------------

	event VirtualPriceBoundariesUpdated(uint256 lowerBound, uint256 upperBound);

	// Constants/Immutables -------------------------------------------------------------------------------------------

	/// @dev percentage plus two decimals (100_00)
	uint16 constant PERCENTAGE_FACTOR = 1e4;

	/// @dev scale digits for the `answer` response
	uint8 public constant DECIMALS_VAL = 8;

	/// @dev Format of pool's virtual_price
	int256 public constant DECIMALS_DIVIDER = 1 ether;

	/// @dev The Curve pool associated with the evaluated LP token
	ICurvePool public immutable curvePool;

	/// @dev Window size in PERCENTAGE format (usually `2_00` which is 2%) for calculating virtual_price boundaries
	uint256 public immutable delta;

	/// @dev Price feed of token A in the pool
	AggregatorV3Interface public immutable priceFeedA;

	/// @dev Price feed of token B in the pool
	AggregatorV3Interface public immutable priceFeedB;

	// State ----------------------------------------------------------------------------------------------------------

	/// @dev The lower bound for the contract's token-to-underlying exchange rate.
	/// @notice Used to protect against LP token / share price manipulation.
	uint256 public lowerBound;

	// Constructor ----------------------------------------------------------------------------------------------------

	/**
	 * @param _delta Window in PERCENTAGE format which is allowed for virtual_price boundaries
	 * @param _curvePool Address for the Curve Pool this aggregator provides pricing for
	 * @param _priceFeedA Price feed of token A in the pool
	 * @param _priceFeedB Price feed of token B in the pool
	 */
	constructor(uint256 _delta, address _curvePool, address _priceFeedA, address _priceFeedB) {
		if (_curvePool == address(0) || _priceFeedA == address(0) || _priceFeedB == address(0)) {
			revert AddressZeroException();
		}

		delta = _delta;
		curvePool = ICurvePool(_curvePool);

		uint256 virtualPrice = ICurvePool(_curvePool).get_virtual_price();
		_setVirtualPriceBoundaries(virtualPrice);

		priceFeedA = AggregatorV3Interface(_priceFeedA);
		priceFeedB = AggregatorV3Interface(_priceFeedB);
	}

	// AggregatorV3Interface functions --------------------------------------------------------------------------------

	/**
	 * @notice Computes the LP token price as (min_t(price(coin_t)) * virtual_price())
	 *     See more at https://dev.gearbox.fi/oracle/curve-pricefeed
	 */
	function latestRoundData()
		external
		view
		virtual
		override
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
	{
		(roundId, answer, startedAt, updatedAt, answeredInRound) = priceFeedA.latestRoundData();

		// Sanity check for the Chainlink pricefeed 1
		_checkAnswer(roundId, answer, updatedAt, answeredInRound);

		(uint80 roundId2, int256 answer2, uint256 startedAt2, uint256 updatedAt2, uint80 answeredInRound2) = priceFeedB
			.latestRoundData();

		// Sanity check for the Chainlink pricefeed 2
		_checkAnswer(roundId2, answer2, updatedAt2, answeredInRound2);

		if (answer2 < answer) {
			answer = answer2;
			answeredInRound = answeredInRound2;
			roundId = roundId2;
			startedAt = startedAt2;
			updatedAt = updatedAt2;
		}

		uint256 virtualPrice = _getVirtualPrice();
		answer = (answer * int256(virtualPrice)) / DECIMALS_DIVIDER;
	}

	function decimals() external pure override returns (uint8) {
		return DECIMALS_VAL;
	}

	function description() external pure override returns (string memory) {
		return "CurveLP2PriceAggregator";
	}

	function version() external pure override returns (uint256) {
		return 1;
	}

	/// @dev Implemented for compatibility, but reverts since this price feed does not store historical data.
	function getRoundData(
		uint80
	)
		external
		pure
		virtual
		override
		returns (
			uint80, // roundId,
			int256, // answer,
			uint256, // startedAt,
			uint256, // updatedAt,
			uint80 // answeredInRound
		)
	{
		revert NotImplementedException();
	}

	// Public functions -----------------------------------------------------------------------------------------------

	/// @dev Returns the upper bound, calculated based on the lower bound
	function upperBound() external view returns (uint256) {
		return _calcUpperBound(lowerBound);
	}

	// Admin functions ------------------------------------------------------------------------------------------------

	/// @dev Updates the bounds for the exchange rate (virtual_price) value
	/// @param _lowerBound The new lower bound (the upper bound is computed dynamically from the lower bound)
	function setVirtualPriceBoundaries(uint256 _lowerBound) external onlyOwner {
		_setVirtualPriceBoundaries(_lowerBound);
	}

	// Internal functions ---------------------------------------------------------------------------------------------

	/**
	 * @notice Retrieves the LP Token virtual price from the Curve Pool; returns min(virtualPrice, upperBound);
	 *     Reverts if the retrieved virtualPrice is below the lower bound.
	 * @return min(virtualPrice, upperBound)
	 */
	function _getVirtualPrice() internal view returns (uint256) {
		uint256 virtualPrice = curvePool.get_virtual_price();
		uint256 _lowerBound = lowerBound;
		if (virtualPrice < _lowerBound) {
			revert VirtualPriceBoundariesException();
		}
		uint256 _upperBound = _calcUpperBound(_lowerBound);
		return (virtualPrice > _upperBound) ? _upperBound : virtualPrice;
	}

	function _setVirtualPriceBoundaries(uint256 _lowerBound) internal {
		if (_lowerBound == 0 || !_checkCurrentValueInBounds(_lowerBound, _calcUpperBound(_lowerBound))) {
			revert VirtualPriceBoundariesException();
		}
		lowerBound = _lowerBound;
		emit VirtualPriceBoundariesUpdated(lowerBound, _calcUpperBound(_lowerBound));
	}

	function _calcUpperBound(uint256 _lowerBound) internal view returns (uint256) {
		return (_lowerBound * (PERCENTAGE_FACTOR + delta)) / PERCENTAGE_FACTOR;
	}

	function _checkCurrentValueInBounds(uint256 _lowerBound, uint256 _upperBound) internal view returns (bool) {
		uint256 _virtualPrice = curvePool.get_virtual_price();
		if (_virtualPrice < _lowerBound || _virtualPrice > _upperBound) {
			return false;
		}
		return true;
	}

	function _checkAnswer(uint80 _roundId, int256 _price, uint256 _updatedAt, uint80 _answeredInRound) internal pure {
		if (_price == 0) {
			revert PriceZeroException();
		}
		if (_answeredInRound < _roundId || _updatedAt == 0) {
			revert PriceStaleException();
		}
	}
}
