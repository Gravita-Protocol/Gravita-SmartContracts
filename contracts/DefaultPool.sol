// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./Dependencies/SafetyTransfer.sol";
import "./Interfaces/IDefaultPool.sol";

/*
 * The Default Pool holds the collateral and debt token amounts from liquidations that have been redistributed
 * to active vessels but not yet "applied", i.e. not yet recorded on a recipient active vessel's struct.
 *
 * When a vessel makes an operation that applies to its pending collateral and debt, they are moved
 * from the Default Pool to the Active Pool.
 */
contract DefaultPool is OwnableUpgradeable, IDefaultPool {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "DefaultPool";

	address public vesselManagerAddress;
	address public activePoolAddress;

	bool public isInitialized;

	mapping(address => uint256) internal assetsBalances;
	mapping(address => uint256) internal debtTokenBalances;

	// --- Dependency setters ---

	function setAddresses(address _vesselManagerAddress, address _activePoolAddress) external initializer {
		require(!isInitialized, "Already initialized");
		isInitialized = true;

		__Ownable_init();

		vesselManagerAddress = _vesselManagerAddress;
		activePoolAddress = _activePoolAddress;

		renounceOwnership();
	}

	// --- Getters for public variables. Required by IPool interface ---

	function getAssetBalance(address _asset) external view override returns (uint256) {
		return assetsBalances[_asset];
	}

	function getDebtTokenBalance(address _asset) external view override returns (uint256) {
		return debtTokenBalances[_asset];
	}

	// --- Pool functionality ---

	function sendAssetToActivePool(address _asset, uint256 _amount) external override callerIsVesselManager {
		address activePool = activePoolAddress; // cache to save an SLOAD

		uint256 safetyTransferAmount = SafetyTransfer.decimalsCorrection(_asset, _amount);
		if (safetyTransferAmount == 0) {
			return;
		}

		uint256 newBalance = assetsBalances[_asset] - _amount;
		assetsBalances[_asset] = newBalance;

		IERC20Upgradeable(_asset).safeTransfer(activePool, safetyTransferAmount);
		IDeposit(activePool).receivedERC20(_asset, _amount);

		emit DefaultPoolAssetBalanceUpdated(_asset, newBalance);
		emit AssetSent(activePool, _asset, safetyTransferAmount);
	}

	function increaseDebt(address _asset, uint256 _amount) external override callerIsVesselManager {
		uint256 newDebt = debtTokenBalances[_asset] + _amount;
		debtTokenBalances[_asset] = newDebt;
		emit DefaultPoolDebtUpdated(_asset, newDebt);
	}

	function decreaseDebt(address _asset, uint256 _amount) external override callerIsVesselManager {
		uint256 newDebt = debtTokenBalances[_asset] - _amount;
		debtTokenBalances[_asset] = newDebt;
		emit DefaultPoolDebtUpdated(_asset, newDebt);
	}

	// --- 'require' functions ---

	modifier callerIsActivePool() {
		require(msg.sender == activePoolAddress, "DefaultPool: Caller is not the ActivePool");
		_;
	}

	modifier callerIsVesselManager() {
		require(msg.sender == vesselManagerAddress, "DefaultPool: Caller is not the VesselManager");
		_;
	}

	function receivedERC20(address _asset, uint256 _amount) external override callerIsActivePool {
		uint256 newBalance = assetsBalances[_asset] + _amount;
		assetsBalances[_asset] = newBalance;
		emit DefaultPoolAssetBalanceUpdated(_asset, newBalance);
	}
}
