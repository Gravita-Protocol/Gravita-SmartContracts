// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../Interfaces/IERC20Decimals.sol";

contract ERC20DecimalsMock is IERC20Decimals {
	
  uint8 private immutable _decimals;

	constructor(uint8 __decimals) {
		_decimals = __decimals;
	}

	function decimals() public view override returns (uint8) {
		return _decimals;
	}
}
