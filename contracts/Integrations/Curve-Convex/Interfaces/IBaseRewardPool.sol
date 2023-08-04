// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IBaseRewardPool {
	function getReward(address _account, bool _claimExtras) external;
}
