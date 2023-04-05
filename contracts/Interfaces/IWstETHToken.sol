// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

/**
 * Based on https://github.com/lidofinance/lido-dao/blob/master/contracts/0.6.12/WstETH.sol
 */
interface IWstETHToken {
	function stEthPerToken() external view returns (uint256);
}
