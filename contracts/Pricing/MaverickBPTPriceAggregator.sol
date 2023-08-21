// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../Integrations/Maverick/Interfaces/IPool.sol";
import "../Integrations/Maverick/Interfaces/IPoolInformation.sol";
import "../Integrations/Maverick/Interfaces/IPoolPositionSlim.sol";

/**
 * @title Maverick boosted pool token price feed aggregator.
 * @dev This contract is responsible for calculating the USD price of a boosted (liquidity) position (BP) token from 
 *      a Maverick pool. The process is executed as follows:
 *      The token used as collateral for pricing is governed by the PoolPositionDynamicSlim contract. Retrieving the 
 *      address of the IPool contract associated with the BP token is achieved by querying the pool() function within 
 *      this contract. Following that, by querying the tokenA() function from the IPool contract, we can determine the 
 *      address of the first token within the pool. This contract conducts two primary actions: Firstly, it queries a 
 *      (Chainlink) price feed to obtain the USD price of tokenA. Secondly, it queries the sqrtPrice() function of the 
 *      PoolInformation contract. These obtained results are then utilized in combination to calculate the BP token 
 *      price using the equation: bpTokenPrice = tokenAPrice * ((sqrtPrice / 1e18) ^ 2). *
 */
contract MaverickBPTPriceAggregator is AggregatorV3Interface, Ownable {
	using Math for uint256;

	// Custom Errors --------------------------------------------------------------------------------------------------

	error AddressZeroException();
	error NotImplementedException();
	error PriceStaleException();
	error PriceZeroException();
	error ValueOutOfRangeException();

	// Constants/Immutables -------------------------------------------------------------------------------------------

	uint256 public constant DECIMALS_DIVIDER = 1 ether;
	uint8 public constant DECIMALS_VAL = 8;

	IPool public immutable pool;
	IPoolInformation public immutable poolInformation;
	IPoolPositionSlim public immutable bpToken;

	/// @dev Price feed of token A in the pool
	AggregatorV3Interface public immutable priceFeedA;

	// Constructor ----------------------------------------------------------------------------------------------------

	constructor(address _bpToken, address _poolInformation, address _priceFeedA) {
		if (_bpToken == address(0) || _poolInformation == address(0) || _priceFeedA == address(0)) {
			revert AddressZeroException();
		}
		bpToken = IPoolPositionSlim(_bpToken);
		pool = bpToken.pool();
		poolInformation = IPoolInformation(_poolInformation);
		priceFeedA = AggregatorV3Interface(_priceFeedA);
	}

	// AggregatorV3Interface functions --------------------------------------------------------------------------------

	function latestRoundData()
		external
		view
		virtual
		override
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
	{
		(roundId, answer, startedAt, updatedAt, answeredInRound) = priceFeedA.latestRoundData();

		// Sanity check for the Chainlink pricefeed A
		_checkAnswer(roundId, answer, updatedAt, answeredInRound);

		uint256 _sqrtPrice = poolInformation.getSqrtPrice(pool);
		uint256 factor = _sqrtPrice.mulDiv(_sqrtPrice, DECIMALS_DIVIDER);
		answer = int256(uint256(answer).mulDiv(factor, DECIMALS_DIVIDER));
	}

	function decimals() external pure override returns (uint8) {
		return DECIMALS_VAL;
	}

	function description() external pure override returns (string memory) {
		return "MaverickBPTPriceAggregator";
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

	// Internal functions ---------------------------------------------------------------------------------------------

	function _checkAnswer(uint80 _roundId, int256 _price, uint256 _updatedAt, uint80 _answeredInRound) internal pure {
		if (_price == 0) {
			revert PriceZeroException();
		}
		if (_answeredInRound < _roundId || _updatedAt == 0) {
			revert PriceStaleException();
		}
	}
}
