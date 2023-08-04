// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../Curve-Convex/CurveConvexStakingWrapper.sol";

contract BalancerAuraStakingWrapper is CurveConvexStakingWrapper {

	// See https://forum.aura.finance/t/aip-29-finish-migration-of-aura-pools-to-optimize-integrations-enact-aip-26
	function _getExtraRewardWrappedTokenStartingPoolId() internal pure override returns (uint256) {
		return 48;
	}

	/// @dev Helper to get the selector for querying the underlying token of a stash token
	// function __stashTokenUnderlyingSelector() internal pure override returns (bytes4 selector_) {
	// 	return IAuraStashToken.baseToken.selector;
	// }
}
