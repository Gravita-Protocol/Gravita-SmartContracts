// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IWETH {

  function approve(address spender, uint256 amount) external returns (bool);

	function balanceOf(address account) external view returns (uint256);

	function deposit() external payable;

	function withdraw(uint256 amount) external;
}
