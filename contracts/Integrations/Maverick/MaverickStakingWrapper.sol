// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../AbstractStakingWrapper.sol";

import "./Interfaces/IReward.sol";

// RewardOpenSlim -> https://vscode.blockscan.com/ethereum/0x14edfe68031bbf229a765919eb52ae6f6f3347d4
// PoolPositionDynamicSlim -> https://vscode.blockscan.com/ethereum/0xa2b4e72a9d2d3252da335cb50e393f44a9f104ee
contract MaverickStakingWrapper is AbstractStakingWrapper {
	using SafeERC20 for IERC20;

	// Constants/Immutables ---------------------------------------------------------------------------------------------

	address public rewardContractAddress;
	uint8[] public maverickRewardTokenIndices;

	// Constructor/Initializer ------------------------------------------------------------------------------------------

	/**
	 * @param _lpToken address of a `IPoolPositionSlim` contract
	 * @param _rewardContractAddress address of a `IReward` contract
	 */
	function initialize(address _lpToken, address _rewardContractAddress) public initializer {
		rewardContractAddress = _rewardContractAddress;
		AbstractStakingWrapper.abstractInitialize(_lpToken);
		IERC20(_lpToken).safeApprove(_rewardContractAddress, type(uint256).max);
	}

	// Internal/Helper functions ----------------------------------------------------------------------------------------

	function _rewardContractStake(uint256 _amount) internal override {
		IReward(rewardContractAddress).stake(_amount, address(this));
	}

	function _rewardContractUnstake(uint256 _amount) internal override {
		IReward(rewardContractAddress).unstake(_amount, address(this));
	}

	function _rewardContractGetReward() internal override {
		IReward(rewardContractAddress).getReward(address(this), maverickRewardTokenIndices);
	}

	function _addRewards() internal override {
		IReward.RewardInfo[] memory _rewardInfo = IReward(rewardContractAddress).rewardInfo();
		uint256 _rewardLength = _rewardInfo.length;
		for (uint256 _i; _i < _rewardLength; ) {
			address _rewardToken = address(_rewardInfo[_i].rewardToken);
			if (_rewardToken != address(0)) {
				uint8 _rewardTokenIndex = IReward(rewardContractAddress).tokenIndex(_rewardToken);
				maverickRewardTokenIndices.push(_rewardTokenIndex);
				RewardType storage newReward = rewards.push();
				newReward.token = _rewardToken;
				registeredRewards[_rewardToken] = rewards.length;
				emit RewardAdded(_rewardToken);
			}
			unchecked {
				++_i;
			}
		}
	}
}
