// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../Interfaces/IERC20Decimals.sol";

library SafetyTransfer {
	using SafeMathUpgradeable for uint256;

	error EthUnsupportedError();
	error InvalidAmountError();

	//_amount is in ether (1e18) and we want to convert it to the token decimal
	function decimalsCorrection(address _token, uint256 _amount) internal view returns (uint256) {
		if (_token == address(0)) {
			revert EthUnsupportedError();
		}
		if (_amount == 0) {
			return 0;
		}
		uint8 decimals = IERC20Decimals(_token).decimals();
		uint256 divisor = 10**(18 - decimals);
		if (_amount % divisor != 0) {
			revert InvalidAmountError();
		}
		if (decimals < 18) {
			return _amount / divisor;
		}
		return _amount;
	}
}
