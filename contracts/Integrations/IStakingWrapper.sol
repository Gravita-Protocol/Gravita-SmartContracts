// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IStakingWrapper {
  
	// Events -----------------------------------------------------------------------------------------------------------

	event RewardAccruingRightsTransferred(address _from, address _to, uint256 _amount);

	// Structs ----------------------------------------------------------------------------------------------------------

	struct RewardType {
		address token;
		uint256 integral;
		uint256 remaining;
		mapping(address => uint256) integralFor; // account -> integralValue
		mapping(address => uint256) claimableAmount;
	}

	struct RewardEarned {
		address token;
		uint256 amount;
	}

	// Events -----------------------------------------------------------------------------------------------------------

	event Deposited(address indexed _account, uint256 _amount);
	event ProtocolFeeChanged(uint256 oldProtocolFee, uint256 newProtocolFee);
	event RewardAdded(address _token);
	event RewardInvalidated(address _rewardToken);
	event RewardRedirected(address indexed _account, address _forward);
	event UserCheckpoint(address _userA, address _userB);
	event Withdrawn(address indexed _user, uint256 _amount);

	// Functions --------------------------------------------------------------------------------------------------------

	/// @notice deposit `_amount` unwrapped (LP) tokens and mint the same `_amount` of wrapped tokens to `msg.sender`
	function deposit(uint256 _amount) external;

	/**
	 * @notice return all claimable rewards for a specific account
	 * @dev one should call the mutable `userCheckpoint()` function beforehand for refreshing the state for
	 *      the most up-to-date results
	 */
	function getEarnedRewards(address _account) external returns (RewardEarned[] memory _claimable);

	/**
	 * @notice Balance of this wrapper token for `_account` that is stored within Gravita's pools.
	 *         Collateral on the Gravita Protocol is stored in different pools based on its lifecycle status.
	 *         Borrowers will accrue rewards while their collateral is in:
	 *           - ActivePool (queried via VesselManager), meaning their vessel is active
	 *           - CollSurplusPool, meaning their vessel was liquidated/redeemed against and there was a surplus
	 *         Gravita will accrue rewards while collateral is in:
	 *           - DefaultPool, meaning collateral got redistributed during a liquidation
	 *           - StabilityPool, meaning collateral got offset against deposits & turned into gains waiting for claiming
	 *
	 * @dev See https://docs.google.com/document/d/1j6mcK4iB3aWfPSH3l8UdYL_G3sqY3k0k1G4jt81OsRE/edit?usp=sharing
	 */
	function balanceOnGravitaPools(address _account) external returns (uint256 _collateral);

	/// @notice claim/transfer all rewards owned by/to `msg.sender` (or transfer to a registered redirect address)
	function claimEarnedRewards() external;

	/// @notice claim/transfer all rewards owned by/to `_account` (or transfer to a registered redirect address)
	function claimEarnedRewardsFor(address _account) external;

	/// @notice same as `claimEarnedRewards()`, but tokens earned by `msg.sender` are transferred to a forwarding address
	function claimAndForwardEarnedRewards(address _forwardTo) external;

	/// @notice claim/transfer reward shares earned by the protocol to the treasury address
	function claimTreasuryEarnedRewards(uint256 _index) external;

	/// @notice return the number of reward tokens registered for the underlying wrapped (LP) token
	function rewardsLength() external returns (uint256);

	/// @notice set any claimed rewards to automatically go to a different address
	/// @dev set to zero to disable redirect
	function setRewardRedirect(address _to) external;

	/// @notice fetch `_account`'s balance of the wrapped tokens, considering the contract itself and Gravita's pools
	function totalBalanceOf(address _account) external returns (uint256);

	/// @notice trigger a checkpoint for the `msg.sender` account
	function userCheckpoint() external;

	/// @notice trigger a checkpoint for `_account`
	function userCheckpoint(address _account) external;

	/// @notice withdraw to underlying LP token
	function withdraw(uint256 _amount) external;
}
