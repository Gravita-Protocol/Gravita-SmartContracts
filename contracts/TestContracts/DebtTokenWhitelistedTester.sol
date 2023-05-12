// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../DebtToken.sol";

contract DebtTokenWhitelistedTester {
	IDebtToken public token;

	constructor(address _address) {
		token = IDebtToken(_address);
	}

	function mint(uint256 _amount) public {
		token.mintFromWhitelistedContract(_amount);
	}

	function burn(uint256 _amount) public {
		token.burnFromWhitelistedContract(_amount);
	}
}
