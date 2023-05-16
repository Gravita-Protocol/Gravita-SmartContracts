// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../Timelock.sol";

contract TimelockTester is Timelock {

	modifier isValidDelay(uint256 _delay) override {
		_;
	}

	constructor(uint _delay, address _admin) Timelock(_delay, _admin) {
	}
}
