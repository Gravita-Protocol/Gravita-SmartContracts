// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/*
 * @notice Returns the ETH price for 1 sfrxETH by multiplying the results from the sfrxETH:frxETH and frxETH:ETH feeds.
 *         Needs to be multiplied by the ETH:USD feed for the final price.
 */
contract SfrxEth2EthPriceAggregator is AggregatorV3Interface {
	error NotImplementedException();

	int256 internal constant PRECISION = 1 ether;
	AggregatorV3Interface public constant sfrxEth2FrxEthAggregator =
		AggregatorV3Interface(0x98E5a52fB741347199C08a7a3fcF017364284431);
	AggregatorV3Interface public constant frxEth2EthAggregator =
		AggregatorV3Interface(0x5C3e80763862CB777Aa07BDDBcCE0123104e1c34);

	// AggregatorV3Interface functions ----------------------------------------------------------------------------------

	function decimals() external pure override returns (uint8) {
		// both (unupgradeable) source aggregators use 18 decimals
		return 18;
	}

	function description() external pure override returns (string memory) {
		return "SfrxEth2EthPriceAggregator";
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
		// nondeterministic as there are two sources with different round ids
		revert NotImplementedException();
	}

	function latestRoundData()
		external
		view
		override
		returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
	{
		(
			uint80 roundId1,
			int256 answer1,
			uint256 startedAt1,
			uint256 updatedAt1,
			uint80 answeredInRound1
		) = sfrxEth2FrxEthAggregator.latestRoundData();
		require(answer1 > 0, "sfrxETH:frxETH value cannot be zero");

		(
			uint80 roundId2,
			int256 answer2,
			uint256 startedAt2,
			uint256 updatedAt2,
			uint80 answeredInRound2
		) = frxEth2EthAggregator.latestRoundData();
		require(answer2 > 0, "frxETH:ETH value cannot be zero");

		answer = (answer1 * answer2) / PRECISION;

		// for the round/time-related values, return the "oldest"
		roundId = roundId1 < roundId2 ? roundId1 : roundId2;
		startedAt = startedAt1 < startedAt2 ? startedAt1 : startedAt2;
		updatedAt = updatedAt1 < updatedAt2 ? updatedAt1 : updatedAt2;
		answeredInRound = answeredInRound1 < answeredInRound2 ? answeredInRound1 : answeredInRound2;
	}

	function version() external pure override returns (uint256) {
		return 1;
	}
}
