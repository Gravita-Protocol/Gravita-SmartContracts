// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../StabilityPool.sol";

contract StabilityPoolTester is StabilityPool {
	uint assetBalance = 0;

	function unprotectedPayable() external payable {
		assetBalance = assetBalance + msg.value;
	}

	function setCurrentScale(uint128 _currentScale) external {
		currentScale = _currentScale;
	}

	function setTotalDeposits(uint256 _totalDebtTokenDeposits) external {
		totalDebtTokenDeposits = _totalDebtTokenDeposits;
	}
}
