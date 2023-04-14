// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "../Dependencies/SafetyTransfer.sol";

contract SafetyTransferTester {

	function decimalsCorrection(address _token, uint256 _amount) external view returns (uint256) {
    return SafetyTransfer.decimalsCorrection(_token, _amount);
  }
}