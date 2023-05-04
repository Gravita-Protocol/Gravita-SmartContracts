// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "@openzeppelin/contracts/access/Ownable.sol";

import "./Dependencies/ERC20Permit.sol";
import "./Interfaces/IDebtToken.sol";

contract DebtToken is IDebtToken, ERC20Permit, Ownable {

	string public constant NAME = "GRAI";
	address public immutable vesselManagerAddress;
	IStabilityPool public immutable stabilityPool;
	address public immutable borrowerOperationsAddress;

	mapping(address => bool) public emergencyStopMintingCollateral;

	// stores SC addresses that are allowed to mint/burn the token (AMO strategies, L2 suppliers)
	mapping(address => bool) public whitelistedContracts;

	address public immutable timelockAddress;

	bool public isInitialized;

	error DebtToken__TimelockOnly();
	error DebtToken__OwnerOnly();

	modifier onlyTimelock() {
		if (isInitialized) {
			if (msg.sender != timelockAddress) {
				revert DebtToken__TimelockOnly();
			}
		} else {
			if (msg.sender != owner()) {
				revert DebtToken__OwnerOnly();
			}
		}
		_;
	}

	constructor(
		address _vesselManagerAddress,
		address _stabilityPoolAddress,
		address _borrowerOperationsAddress,
		address _timelockAddress
	) payable ERC20("GRAI", "GRAI") {
		vesselManagerAddress = _vesselManagerAddress;
		timelockAddress = _timelockAddress;
		stabilityPool = IStabilityPool(_stabilityPoolAddress);
		borrowerOperationsAddress = _borrowerOperationsAddress;
	}

	function setInitialized() external payable onlyOwner {
		isInitialized = true;
	}

	// --- Functions for intra-Gravita calls ---

	//
	function emergencyStopMinting(address _asset, bool status) external payable override onlyOwner {
		emergencyStopMintingCollateral[_asset] = status;
		emit EmergencyStopMintingCollateral(_asset, status);
	}

	function mintFromWhitelistedContract(uint256 _amount) external override {
		_requireCallerIsWhitelistedContract();
		_mint(msg.sender, _amount);
	}

	function burnFromWhitelistedContract(uint256 _amount) external override {
		_requireCallerIsWhitelistedContract();
		_burn(msg.sender, _amount);
	}

	function mint(
		address _asset,
		address _account,
		uint256 _amount
	) external override {
		_requireCallerIsBorrowerOperations();
		require(!emergencyStopMintingCollateral[_asset], "Mint is blocked on this collateral");

		_mint(_account, _amount);
	}

	function burn(address _account, uint256 _amount) external override {
		_requireCallerIsBOorVesselMorSP();
		_burn(_account, _amount);
	}

	function addWhitelist(address _address) external override onlyTimelock {
		whitelistedContracts[_address] = true;

		emit WhitelistChanged(_address, true);
	}

	function removeWhitelist(address _address) external payable override onlyOwner {
		whitelistedContracts[_address] = false;

		emit WhitelistChanged(_address, false);
	}

	function sendToPool(
		address _sender,
		address _poolAddress,
		uint256 _amount
	) external override {
		_requireCallerIsStabilityPool();
		_transfer(_sender, _poolAddress, _amount);
	}

	function returnFromPool(
		address _poolAddress,
		address _receiver,
		uint256 _amount
	) external override {
		_requireCallerIsVesselMorSP();
		_transfer(_poolAddress, _receiver, _amount);
	}

	// --- External functions ---

	function transfer(address recipient, uint256 amount) public override(IERC20, ERC20) returns (bool) {
		_requireValidRecipient(recipient);
		return super.transfer(recipient, amount);
	}

	function transferFrom(
		address sender,
		address recipient,
		uint256 amount
	) public override(IERC20, ERC20) returns (bool) {
		_requireValidRecipient(recipient);
		return super.transferFrom(sender, recipient, amount);
	}

	// --- 'require' functions ---

	function _requireValidRecipient(address _recipient) internal view {
		require(
			_recipient != address(0) && _recipient != address(this),
			"DebtToken: Cannot transfer tokens directly to the token contract or the zero address"
		);
		require(
			address(stabilityPool) != _recipient &&
				_recipient != vesselManagerAddress &&
				_recipient != borrowerOperationsAddress,
			"DebtToken: Cannot transfer tokens directly to the StabilityPool, VesselManager or BorrowerOps"
		);
	}

	function _requireCallerIsWhitelistedContract() internal view {
		require(whitelistedContracts[msg.sender], "DebtToken: Caller is not a whitelisted SC");
	}

	function _requireCallerIsBorrowerOperations() internal view {
		require(msg.sender == borrowerOperationsAddress, "DebtToken: Caller is not BorrowerOperations");
	}

	function _requireCallerIsBOorVesselMorSP() internal view {
		require(
			msg.sender == borrowerOperationsAddress ||
				msg.sender == vesselManagerAddress ||
				address(stabilityPool) == msg.sender,
			"DebtToken: Caller is neither BorrowerOperations nor VesselManager nor StabilityPool"
		);
	}

	function _requireCallerIsStabilityPool() internal view {
		require(address(stabilityPool) == msg.sender, "DebtToken: Caller is not the StabilityPool");
	}

	function _requireCallerIsVesselMorSP() internal view {
		require(
			msg.sender == vesselManagerAddress || address(stabilityPool) == msg.sender,
			"DebtToken: Caller is neither VesselManager nor StabilityPool"
		);
	}
}
