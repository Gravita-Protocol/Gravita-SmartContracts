// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../Pricing/API3ProxyInterface.sol";

contract MockApi3Proxy is API3ProxyInterface {
	int224 public value = 1012695777067725000;

	function setValue(int224 _newValue) external {
		value = _newValue;
	}

	function read() external view override returns (int224, uint32) {
		return (value, uint32(block.timestamp));
	}
}
