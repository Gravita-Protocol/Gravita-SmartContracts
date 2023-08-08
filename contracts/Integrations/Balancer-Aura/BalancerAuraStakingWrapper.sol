// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../Curve-Convex/CurveConvexStakingWrapper.sol";
import "./Interfaces/IAuraExtraRewardWrappedToken.sol";

contract BalancerAuraStakingWrapper is CurveConvexStakingWrapper {
	/**
	 * @dev from pool 48, extra reward tokens are wrapped
	 * See https://forum.aura.finance/t/aip-29-finish-migration-of-aura-pools-to-optimize-integrations-enact-aip-26
	 */
	uint256 private constant EXTRA_REWARD_WRAPPED_TOKEN_STARTING_POOL_ID = 48;

	function _getExtraRewardToken(address _extraPool) internal view override returns (address _extraToken) {
		_extraToken = IRewardStaking(_extraPool).rewardToken();
		if (convexPoolId >= EXTRA_REWARD_WRAPPED_TOKEN_STARTING_POOL_ID) {
			_extraToken = IAuraExtraRewardWrappedToken(_extraToken).baseToken();
		}
	}
}
