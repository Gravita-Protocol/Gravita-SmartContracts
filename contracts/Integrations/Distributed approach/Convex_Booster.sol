// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/// @title Convex Booster adapter interface
/// @notice Implements logic allowing to tokenize the interactions with Convex Booster
/// This allows to use Convex positions as collateral
import {IBooster} from "./Interfaces/IBooster.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ConvexV1BoosterAdapter{

    /// @notice Maps pool ID to token representing staked position
    address public constant convexBooster = address(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    mapping(uint256 => address) public pidToStakedPositionToken;
    
    function deposit(uint256 _amount, uint256 _convexPoolID, address _to) external {
        //dont need to call checkpoint since _mint() will

        if (_amount > 0) {
            stakeToken = pidToStakedPositionToken(convexPoolId)
            IERC20(stakeToken).mint(_to, _amount);
            IERC20(curveToken).safeTransferFrom(msg.sender, address(this), _amount);
            IConvexDeposits(convexBooster).deposit(convexPoolId, _amount, true);
        }

        emit Deposited(msg.sender, _to, _amount, true);
    }

}