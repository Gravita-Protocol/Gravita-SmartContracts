// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../PriceFeed.sol";

contract PriceFeedL2 is PriceFeed {

	// Custom Errors ----------------------------------------------------------------------------------------------------

   	error PriceFeed__SequencerDown();
	error PriceFeed__SequencerGracePeriodNotOver();

	// Events -----------------------------------------------------------------------------------------------------------

	event SequencerUptimeFeedUpdated(address _sequencerUptimeFeed);

	// Constants --------------------------------------------------------------------------------------------------------

    /// @dev after sequencer comes back up, wait for up to X seconds for openVessel, adjustVessel & closeVessel
	uint256 public constant SEQUENCER_BORROWING_DELAY_SECONDS = 3_600;

    /// @dev after sequencer comes back up, wait for up to X seconds for redemptions & liquidations
	uint256 public constant SEQUENCER_LIQUIDATION_DELAY_SECONDS = 7_200;

	// State ------------------------------------------------------------------------------------------------------------

	address public sequencerUptimeFeedAddress;

	// Admin routines ---------------------------------------------------------------------------------------------------

	/**
	 * @dev Requires msg.sender to be the contract owner when the sequencer is first set. Subsequent updates need to come
	 *     through the timelock contract.
	 */
	function setSequencerUptimeFeedAddress(address _sequencerUptimeFeedAddress) external {
		if (sequencerUptimeFeedAddress == address(0)) {
			_checkOwner();
		} else if (msg.sender != timelockAddress) {
			revert PriceFeed__TimelockOnlyError();
		}
		sequencerUptimeFeedAddress = _sequencerUptimeFeedAddress;
		emit SequencerUptimeFeedUpdated(_sequencerUptimeFeedAddress);
	}

	// Public functions -------------------------------------------------------------------------------------------------

	/**
	 * @dev Callers:
	 *     - BorrowerOperations.openVessel()
	 *     - BorrowerOperations.adjustVessel()
	 *     - BorrowerOperations.closeVessel()
	 *     - VesselManagerOperations.liquidateVessels()
	 *     - VesselManagerOperations.batchLiquidateVessels()
	 *     - VesselManagerOperations.redeemCollateral()
	 */
	function fetchPrice(address _token) public view override returns (uint256) {
		_checkSequencerUptimeFeed();
        return super.fetchPrice(_token);
	}

	// Internal functions -----------------------------------------------------------------------------------------------

	function _checkSequencerUptimeFeed() internal view {
		if (sequencerUptimeFeedAddress != address(0)) {
			// prettier-ignore
			(
				/* uint80 roundId */,
				int256 answer,
				/* uint256 startedAt */,
				uint256 updatedAt,
				/* uint80 answeredInRound */
			) =	ChainlinkAggregatorV3Interface(sequencerUptimeFeedAddress).latestRoundData();

			// answer == 0 -> sequencer is up
			// answer == 1 -> sequencer is down
			bool isSequencerUp = answer == 0;
			if (!isSequencerUp) {
				revert PriceFeed__SequencerDown();
			}

            uint256 delay;
            if (msg.sender == vesselManagerOperations) {
                // VesselManagerOperations triggers liquidations and redemptions
                delay = SEQUENCER_LIQUIDATION_DELAY_SECONDS;
            } else {
                delay = SEQUENCER_BORROWING_DELAY_SECONDS;
            }
			uint256 timeSinceSequencerUp = block.timestamp - updatedAt;
			if (timeSinceSequencerUp <= delay) {
				revert PriceFeed__SequencerGracePeriodNotOver();
			}
		}
	}
}

