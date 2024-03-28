// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title SwETH Interface (Simplified)
 * @author https://github.com/max-taylor
 */
interface IswETH {
	/**
	 * @dev Returns the current SwETH to ETH rate, returns 1:1 if no reprice has occurred otherwise it returns the swETHToETHRateFixed rate.
	 * @return The current SwETH to ETH rate.
	 */
	function swETHToETHRate() external view returns (uint256);
}

/**
 * @notice Returns the ETH price for 1 swETH by querying swETH.swETHToETHRate()
 *         Needs to be multiplied by the ETH:USD feed for the final price.
 */
contract SwEth2EthPriceAggregator is AggregatorV3Interface {
	error NotImplementedException();

	int256 internal constant PRECISION = 1 ether;
	IswETH internal constant SWETH = IswETH(0xf951E335afb289353dc249e82926178EaC7DEd78);

	// AggregatorV3Interface functions ----------------------------------------------------------------------------------

	function decimals() external pure override returns (uint8) {
		return 18;
	}

	function description() external pure override returns (string memory) {
		return "SwEth2EthPriceAggregator";
	}

	function getRoundData(
		uint80 // roundId
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
		// price history is not kept in this contract
		revert NotImplementedException();
	}

	function latestRoundData()
		external
		view
		override
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
	{
    roundId = 1;
    answeredInRound = 1;
    startedAt = block.timestamp;
    updatedAt = block.timestamp;
    answer = int256(SWETH.swETHToETHRate());
	}

	function version() external pure override returns (uint256) {
		return 1;
	}
}
