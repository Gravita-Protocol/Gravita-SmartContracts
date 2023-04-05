// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../Dependencies/ERC20Permit.sol";
import "../Interfaces/IStabilityPool.sol";

abstract contract IDebtToken is ERC20Permit {
	// --- Events ---

	event TokenBalanceUpdated(address _user, uint256 _amount);
	event EmergencyStopMintingCollateral(address _asset, bool state);

	function emergencyStopMinting(address _asset, bool status) external virtual;

	function mint(address _asset, address _account, uint256 _amount) external virtual;

	function mintFromWhitelistedContract(uint256 _amount) external virtual;

	function burnFromWhitelistedContract(uint256 _amount) external virtual;

	function burn(address _account, uint256 _amount) external virtual;

	function sendToPool(address _sender, address poolAddress, uint256 _amount) external virtual;

	function returnFromPool(address poolAddress, address user, uint256 _amount) external virtual;

	function addWhitelist(address _address) external virtual;

	function removeWhitelist(address _address) external virtual;
}
