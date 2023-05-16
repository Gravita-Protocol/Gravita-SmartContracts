// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../Interfaces/IStabilityPool.sol";

contract StabilityPoolScript {
	string public constant NAME = "StabilityPoolScript";

	IStabilityPool immutable stabilityPool;

	constructor(IStabilityPool _stabilityPool) {
		stabilityPool = _stabilityPool;
	}

	function provideToSP(uint256 _amount) external {
		IStabilityPool(stabilityPool).provideToSP(_amount);
	}

	function withdrawFromSP(uint256 _amount) external {
		IStabilityPool(stabilityPool).withdrawFromSP(_amount);
	}
}
