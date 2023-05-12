// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./Dependencies/SafetyTransfer.sol";
import "./Interfaces/ICollSurplusPool.sol";

contract CollSurplusPool is OwnableUpgradeable, ICollSurplusPool {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "CollSurplusPool";

	address public activePoolAddress;
	address public borrowerOperationsAddress;
	address public vesselManagerAddress;
	address public vesselManagerOperationsAddress;

	// deposited ether tracker
	mapping(address => uint256) internal balances;
	// Collateral surplus claimable by vessel owners
	mapping(address => mapping(address => uint256)) internal userBalances;

	bool public isSetupInitialized;

	// --- Initializer ---

	function initialize() public initializer {
		__Ownable_init();
	}

	// --- Contract setters ---

	function setAddresses(
		address _activePoolAddress,
		address _borrowerOperationsAddress,
		address _vesselManagerAddress,
		address _vesselManagerOperationsAddress
	) external onlyOwner {
		require(!isSetupInitialized, "Setup is already initialized");
		activePoolAddress = _activePoolAddress;
		borrowerOperationsAddress = _borrowerOperationsAddress;
		vesselManagerAddress = _vesselManagerAddress;
		vesselManagerOperationsAddress = _vesselManagerOperationsAddress;
		isSetupInitialized = true;
	}

	/* Returns the Asset state variable at ActivePool address.
       Not necessarily equal to the raw ether balance - ether can be forcibly sent to contracts. */
	function getAssetBalance(address _asset) external view override returns (uint256) {
		return balances[_asset];
	}

	function getCollateral(address _asset, address _account) external view override returns (uint256) {
		return userBalances[_account][_asset];
	}

	// --- Pool functionality ---

	function accountSurplus(address _asset, address _account, uint256 _amount) external override {
		_requireCallerIsVesselManager();

		mapping(address => uint256) storage userBalance = userBalances[_account];
		uint256 newAmount = userBalance[_asset] + _amount;
		userBalance[_asset] = newAmount;

		emit CollBalanceUpdated(_account, newAmount);
	}

	function claimColl(address _asset, address _account) external override {
		_requireCallerIsBorrowerOperations();
		mapping(address => uint256) storage userBalance = userBalances[_account];
		uint256 claimableCollEther = userBalance[_asset];

		uint256 safetyTransferclaimableColl = SafetyTransfer.decimalsCorrection(_asset, claimableCollEther);

		require(safetyTransferclaimableColl > 0, "CollSurplusPool: No collateral available to claim");

		userBalance[_asset] = 0;
		emit CollBalanceUpdated(_account, 0);

		balances[_asset] = balances[_asset] - claimableCollEther;
		emit AssetSent(_account, safetyTransferclaimableColl);

		IERC20Upgradeable(_asset).safeTransfer(_account, safetyTransferclaimableColl);
	}

	function receivedERC20(address _asset, uint256 _amount) external override {
		_requireCallerIsActivePool();
		balances[_asset] = balances[_asset] + _amount;
	}

	// --- 'require' functions ---

	function _requireCallerIsBorrowerOperations() internal view {
		require(msg.sender == borrowerOperationsAddress, "CollSurplusPool: Caller is not Borrower Operations");
	}

	function _requireCallerIsVesselManager() internal view {
		require(
			msg.sender == vesselManagerAddress || msg.sender == vesselManagerOperationsAddress,
			"CollSurplusPool: Caller is not VesselManager"
		);
	}

	function _requireCallerIsActivePool() internal view {
		require(msg.sender == activePoolAddress, "CollSurplusPool: Caller is not Active Pool");
	}
}
