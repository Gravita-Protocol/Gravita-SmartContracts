// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * Based on https://github.com/lidofinance/lido-dao/blob/master/contracts/0.6.12/WstETH.sol
 */
interface IWstETH {
	function stEthPerToken() external view returns (uint256);
}

/*
 * @notice Returns the ETH price for 1 wstETH; the ETH:USD price then needs to be calculated by the caller.
 *
 * @dev Queries the aggregator for the stETH-ETH pair; queries the wstETH token for its stETH value/rate; then
 *      multiplies the results. There is a known (minor) issue with the getRoundData() function, where the historical 
 *      value for a previous round (price) can be queried from the feed, but the current st/wstEth rate is used
 *      (instead of the historical pair); we do not see that as a problem as this contract's return values are
 *      supposed to be used in short-time context checks (and not for long-term single-source-of-truth queries)
 */
contract WstEth2EthPriceAggregator is AggregatorV3Interface {
	uint8 private constant decimalsVal = 18;
	int256 internal constant PRECISION = 1 ether;

	IWstETH public immutable wstETH;
	AggregatorV3Interface public immutable stETH2ETHAggregator;

	constructor(address _wstETHAddress, address _stETH2ETHAggregatorAddress) {
		wstETH = IWstETH(_wstETHAddress);
		stETH2ETHAggregator = AggregatorV3Interface(_stETH2ETHAggregatorAddress);
	}

	// AggregatorV3Interface functions ----------------------------------------------------------------------------------

	function decimals() external pure override returns (uint8) {
		return decimalsVal;
	}

	function description() external pure override returns (string memory) {
		return "WstEth2EthPriceAggregator";
	}

	function getRoundData(uint80 _roundId)
		external
		view
		override
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		(roundId, answer, startedAt, updatedAt, answeredInRound) = stETH2ETHAggregator.getRoundData(_roundId);
    answer = _stETH2wstETH(answer);
	}

	function latestRoundData()
		external
		view
		override
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		(roundId, answer, startedAt, updatedAt, answeredInRound) = stETH2ETHAggregator.latestRoundData();
    answer = _stETH2wstETH(answer);
	}

	function version() external pure override returns (uint256) {
		return 1;
	}

	// Internal/Helper functions ----------------------------------------------------------------------------------------

	function _stETH2wstETH(int256 stETHValue) internal view returns (int256) {
		require(stETHValue > 0, "stETH value cannot be zero");
		int256 multiplier = int256(wstETH.stEthPerToken());
		require(multiplier > 0, "wstETH.stEthPerToken() cannot be zero");
    // wstETH.stEthPerToken() response has 18-digit precision, hence we need the denominator below
		return (stETHValue * multiplier) / PRECISION;
	}
}
