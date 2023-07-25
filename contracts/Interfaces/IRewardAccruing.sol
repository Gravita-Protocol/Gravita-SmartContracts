// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/**
 * @notice Interface to be implemented by contracts that wrap reward-accruing ERC20s (such as ConvextStakingWrapper.sol).
 */
interface IRewardAccruing {

  function transferRewardAccruingRights(address _from, address _to, uint256 _amount) external;
}