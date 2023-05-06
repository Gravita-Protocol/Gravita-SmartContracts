// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

/**
 * Based on https://github.com/lidofinance/lido-dao/blob/master/contracts/0.6.12/WstETH.sol
 */
interface IWstETH {
	function stEthPerToken() external view returns (uint256);
}

contract MockWstETH is IWstETH {
	uint256 private wstETH2stETH = 1122752566282725055;

	function setStETHPerToken(uint256 newValue) external {
		wstETH2stETH = newValue;
	}

	function stEthPerToken() external view override returns (uint256) {
		return wstETH2stETH;
	}
}
