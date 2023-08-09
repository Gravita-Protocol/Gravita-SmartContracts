// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./Interfaces/IBooster.sol";
import "./Interfaces/IConvexDeposits.sol";
import "./Interfaces/IRewardStaking.sol";
import "./Interfaces/ITokenWrapper.sol";

import "../AbstractStakingWrapper.sol";

contract CurveConvexStakingWrapper is AbstractStakingWrapper {
	using SafeERC20 for IERC20;

	// Constants/Immutables ---------------------------------------------------------------------------------------------

	/// @dev from pool 151, extra reward tokens are wrapped
	/// See https://github.com/convex-eth/platform/blob/main/contracts/contracts/wrappers/ConvexStakingWrapper.sol#L187-L190
	uint256 private constant EXTRA_REWARD_WRAPPED_TOKEN_STARTING_POOL_ID = 151;

	uint256 private constant CRV_INDEX = 0;
	uint256 private constant CVX_INDEX = 1;

	address public convexBooster;
	address public crv;
	address public cvx;
	address public convexPool;
	uint256 public convexPoolId;

	// Constructor/Initializer ------------------------------------------------------------------------------------------

	function initialize(address _convexBooster, address _crv, address _cvx, uint256 _poolId) public initializer {
		(address _lpToken, , , address _rewardsContract, , ) = IBooster(_convexBooster).poolInfo(_poolId);

		convexBooster = _convexBooster;
		crv = _crv;
		cvx = _cvx;
		convexPool = _rewardsContract;
		convexPoolId = _poolId;

		AbstractStakingWrapper.abstractInitialize(_lpToken);

		// IERC20(_lpToken).safeApprove(_convexBooster, 0);
		IERC20(_lpToken).safeApprove(_convexBooster, type(uint256).max);
	}

	// Public functions -------------------------------------------------------------------------------------------------

	/**
	 * from https://github.com/convex-eth/platform/blob/main/contracts/contracts/Booster.sol
	 * "Claim crv and extra rewards and disperse to reward contracts"
	 */
	function earmarkBoosterRewards() external returns (bool) {
		return IBooster(convexBooster).earmarkRewards(convexPoolId);
	}

	// Internal/Helper functions ----------------------------------------------------------------------------------------

	function _rewardContractStake(uint256 _amount) internal override {
		/// @dev the `true` argument below means the Booster contract will immediately stake into the rewards contract
		IConvexDeposits(convexBooster).deposit(convexPoolId, _amount, true);
	}

	function _rewardContractUnstake(uint256 _amount) internal override {
		/// @dev withdraw to underlying curve LP token
		IRewardStaking(convexPool).withdrawAndUnwrap(_amount, false);
	}

	function _rewardContractGetReward() internal override {
		IRewardStaking(convexPool).getReward(address(this), true);
	}

	function _addRewards() internal override {
		address _convexPool = convexPool;
		if (rewards.length == 0) {
			RewardType storage newCrvReward = rewards.push();
			newCrvReward.token = crv;
			// newCrvReward.pool = _convexPool;
			RewardType storage newCvxReward = rewards.push();
			newCvxReward.token = cvx;
			registeredRewards[crv] = CRV_INDEX + 1;
			registeredRewards[cvx] = CVX_INDEX + 1;
			emit RewardAdded(crv);
			emit RewardAdded(cvx);
		}
		uint256 _extraCount = IRewardStaking(_convexPool).extraRewardsLength();
		for (uint256 _i; _i < _extraCount; ) {
			address _extraPool = IRewardStaking(_convexPool).extraRewards(_i);
			address _extraToken = _getExtraRewardToken(_extraPool);
			if (_extraToken == cvx) {
				// update cvx reward pool address
				// rewards[CVX_INDEX].pool = _extraPool;
			} else if (registeredRewards[_extraToken] == 0) {
				// add new token to list
				RewardType storage newReward = rewards.push();
				newReward.token = _extraToken;
				// newReward.pool = _extraPool;
				registeredRewards[_extraToken] = rewards.length;
				emit RewardAdded(_extraToken);
			}
			unchecked {
				++_i;
			}
		}
	}

	/**
	 * @dev from pool 151, extra reward tokens are wrapped
	 * See https://github.com/convex-eth/platform/blob/main/contracts/contracts/wrappers/ConvexStakingWrapper.sol#L187-L190
	 */
	function _getExtraRewardToken(address _extraPool) internal view virtual returns (address _extraToken) {
		_extraToken = IRewardStaking(_extraPool).rewardToken();
		if (convexPoolId >= EXTRA_REWARD_WRAPPED_TOKEN_STARTING_POOL_ID) {
			_extraToken = ITokenWrapper(_extraToken).token();
		}
	}
}
