// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IRegistry {
	function get_registry() external view returns (address);

	function get_address(uint256 _id) external view returns (address);

	function gauge_controller() external view returns (address);

	function get_lp_token(address) external view returns (address);

	function get_gauges(address) external view returns (address[10] memory, uint128[10] memory);
}
