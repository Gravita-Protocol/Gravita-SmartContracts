// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
// import "@openzeppelin/contracts/access/Ownable.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// import "./Dependencies/ERC20Permit.sol";
// import "./Interfaces/IDebtToken.sol";

contract ConvexStakeToken is ERC20 {
    error ConvexStakeToken_ConvexBoosterAdapterOnly(address sender, address expected);

	address public immutable pool;
    address public immutable lptoken;
    // Gravita's Convex Booster adapter interface
    address public immutable ConvexBoosterAdapter

	/// @dev Constructor
	/// @param _pool The Convex pool where the balance is tracked
	/// @param _lptoken The Convex LP token that is staked in the pool

	// constructor(address _pool, address _lptoken) {
	// 	// name = string(abi.encodePacked("Convex Staked Position ", IERC20Metadata(_lptoken).name()));
	// 	// symbol = string(abi.encodePacked("stk", IERC20Metadata(_lptoken).symbol()));
	constructor(address _pool, address _lptoken, address _ConvexBoosterAdapter) ERC20("Convex Staked Position Curve.fi Rocketpool rETH/ETH", "stk rETH-f") {
        pool = _pool;
        lptoken = _lptoken;
        ConvexBoosterAdapter = _ConvexBoosterAdapter
    }

    function mint(address _account, uint256 _amount) external override onlyConvexBoosterAdapter() {
		_mint(_account, _amount);
	}

	function burn(address _account, uint256 _amount) external override onlyConvexBoosterAdapter(){
		_burn(_account, _amount);
	}


    modifier onlyConvexBoosterAdapter() {
		if (msg.sender != ConvexBoosterAdapter) {
			revert ConvexStakeToken_ConvexBoosterAdapterOnly(msg.sender, ConvexBoosterAdapter);
		}
		_;
	}

}

