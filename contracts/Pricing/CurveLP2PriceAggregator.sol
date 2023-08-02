// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../Integrations/Curve/ICurvePool.sol";

/**
 * @title CurveLP price feed aggregator for pools that use 2 underlying assets.
 * @dev Based on https://github.com/Gearbox-protocol/integrations-v2/blob/main/contracts/oracles/curve/CurveLP2PriceFeed.sol
 */
contract CurveLP2PriceAggregator is AggregatorV3Interface, Ownable {
	// Custom Errors --------------------------------------------------------------------------------------------------

	error AddressZeroException();
	error PriceZeroException();
	error PriceStaleException();
	error NotImplementedException();
	/// @dev Thrown on returning a value that violates the current bounds
	error ValueOutOfRangeException();
	/// @dev Thrown on failing sanity checks when setting new bounds
	error IncorrectLimitsException();

	// Events ---------------------------------------------------------------------------------------------------------

	/// @dev Emits on updating the virtual price bounds
	event NewLimiterParams(uint256 lowerBound, uint256 upperBound);

	// Constants/Immutables -------------------------------------------------------------------------------------------

	uint16 constant PERCENTAGE_FACTOR = 1e4; //percentage plus two decimals
	uint8 public constant decimalsVal = 8;

	/// @dev The Curve pool associated with the evaluated LP token
	ICurvePool public immutable curvePool;

	/// @dev Format of pool's virtual_price
	int256 public immutable decimalsDivider;

	/// @dev Window size in PERCENTAGE format. Upper bound = lowerBound * (1 + delta)
	uint256 public immutable delta;

	/// @dev Price feed of coin 0 in the pool
	AggregatorV3Interface public immutable priceFeed1;

	/// @dev Price feed of coin 1 in the pool
	AggregatorV3Interface public immutable priceFeed2;

	// State ----------------------------------------------------------------------------------------------------------

	/// @dev The lower bound for the contract's token-to-underlying exchange rate.
	/// @notice Used to protect against LP token / share price manipulation.
	uint256 public lowerBound;

	// Constructor ----------------------------------------------------------------------------------------------------

	/// @param _delta Pre-defined window in PERCENTAGE FORMAT which is allowed for SC value
	constructor(uint256 _delta, address _curvePool, address _priceFeed1, address _priceFeed2) {
		if (_curvePool == address(0) || _priceFeed1 == address(0) || _priceFeed2 == address(0)) {
			revert AddressZeroException();
		}

		delta = _delta;
		curvePool = ICurvePool(_curvePool);
		decimalsDivider = 10 ** 18;

		uint256 virtualPrice = ICurvePool(_curvePool).get_virtual_price();
		_setVirtualPriceBoundaries(virtualPrice);

		priceFeed1 = AggregatorV3Interface(_priceFeed1);
		priceFeed2 = AggregatorV3Interface(_priceFeed2);
	}

	// AggregatorV3Interface functions --------------------------------------------------------------------------------

	function decimals() external pure override returns (uint8) {
		return decimalsVal;
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
		(roundId, answer, startedAt, updatedAt, answeredInRound) = priceFeed1.latestRoundData();

		// Sanity check for the Chainlink pricefeed
		_checkAnswer(roundId, answer, updatedAt, answeredInRound);

		(uint80 roundId2, int256 answer2, uint256 startedAt2, uint256 updatedAt2, uint80 answeredInRound2) = priceFeed2
			.latestRoundData();

		// Sanity check for the Chainlink pricefeed
		_checkAnswer(roundId2, answer2, updatedAt2, answeredInRound2);

		if (answer2 < answer) {
			roundId = roundId2;
			answer = answer2;
			startedAt = startedAt2;
			updatedAt = updatedAt2;
			answeredInRound = answeredInRound2;
		}

		uint256 virtualPrice = _getVirtualPrice();
		answer = (answer * int256(virtualPrice)) / decimalsDivider;
	}

	// Public functions -----------------------------------------------------------------------------------------------

	/// @dev Returns the upper bound, calculated based on the lower bound
	function upperBound() external view returns (uint256) {
		return _calcUpperBound(lowerBound);
	}

	// Admin functions ------------------------------------------------------------------------------------------------

	/// @dev Updates the bounds for the exchange rate value
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
			revert ValueOutOfRangeException();
		}
		uint256 _upperBound = _calcUpperBound(_lowerBound);
		return (virtualPrice > _upperBound) ? _upperBound : virtualPrice;
	}

	function _setVirtualPriceBoundaries(uint256 _lowerBound) internal {
		if (_lowerBound == 0 || !_checkCurrentValueInBounds(_lowerBound, _calcUpperBound(_lowerBound))) {
			revert IncorrectLimitsException();
		}
		lowerBound = _lowerBound;
		emit NewLimiterParams(lowerBound, _calcUpperBound(_lowerBound));
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

