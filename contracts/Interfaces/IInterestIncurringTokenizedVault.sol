// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @dev Modifications to this interface will lead to corresponding changes in its interfaceId. 
 *      This interfaceId is utilized in introspection by both the ActivePool and the StabilityPool to identify 
 *      the necessity of unwrapping tokens. Therefore, it is crucial to remember to upgrade both of these 
 *      contracts if any alterations are made here.
 */
interface IInterestIncurringTokenizedVault is IERC4626 {
	
	function collectInterest() external;

	function getCollectableInterest() external view returns (uint256);

	function getInterestRateInBPS() external view returns (uint256);

	function setInterestRate(uint256 _interestRateInBPS) external;
}
