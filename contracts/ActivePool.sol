// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./Dependencies/SafetyTransfer.sol";

import "./Interfaces/IActivePool.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IDeposit.sol";
import "./Interfaces/IStabilityPool.sol";

/*
 * The Active Pool holds the collaterals and debt amounts for all active vessels.
 *
 * When a vessel is liquidated, it's collateral and debt tokens are transferred from the Active Pool, to either the
 * Stability Pool, the Default Pool, or both, depending on the liquidation conditions.
 *
 */
contract ActivePool is OwnableUpgradeable, ReentrancyGuardUpgradeable, IActivePool {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "ActivePool";

	address public borrowerOperationsAddress;
	address public stabilityPoolAddress;
	address public vesselManagerAddress;
	address public vesselManagerOperationsAddress;

	ICollSurplusPool public collSurplusPool;
	IDefaultPool public defaultPool;

	mapping(address => uint256) internal assetsBalances;
	mapping(address => uint256) internal debtTokenBalances;

	// --- Modifiers ---

	modifier callerIsBorrowerOpsOrDefaultPool() {
		require(
			msg.sender == borrowerOperationsAddress || msg.sender == address(defaultPool),
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	modifier callerIsBorrowerOpsOrVesselMgr() {
		require(
			msg.sender == borrowerOperationsAddress || msg.sender == vesselManagerAddress,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	modifier callerIsBorrowerOpsOrStabilityPoolOrVesselMgr() {
		require(
			msg.sender == borrowerOperationsAddress ||
				msg.sender == stabilityPoolAddress ||
				msg.sender == vesselManagerAddress,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	modifier callerIsBorrowerOpsOrStabilityPoolOrVesselMgrOrVesselMgrOps() {
		require(
			msg.sender == borrowerOperationsAddress ||
				msg.sender == stabilityPoolAddress ||
				msg.sender == vesselManagerAddress ||
				msg.sender == vesselManagerOperationsAddress,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	// --- Initializer ---

	function initialize() public initializer {
		__Ownable_init();
		__ReentrancyGuard_init();
	}

	// --- Contract setters ---

	function setAddresses(
		address _borrowerOperationsAddress,
		address _collSurplusPoolAddress,
		address _defaultPoolAddress,
		address _stabilityPoolAddress,
		address _vesselManagerAddress,
		address _vesselManagerOperationsAddress
	) external onlyOwner {
		borrowerOperationsAddress = _borrowerOperationsAddress;
		collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
		defaultPool = IDefaultPool(_defaultPoolAddress);
		stabilityPoolAddress = _stabilityPoolAddress;
		vesselManagerAddress = _vesselManagerAddress;
		vesselManagerOperationsAddress = _vesselManagerOperationsAddress;
	}

	// --- Getters for public variables. Required by IPool interface ---

	function getAssetBalance(address _asset) external view override returns (uint256) {
		return assetsBalances[_asset];
	}

	function getDebtTokenBalance(address _asset) external view override returns (uint256) {
		return debtTokenBalances[_asset];
	}

	function increaseDebt(address _collateral, uint256 _amount) external override callerIsBorrowerOpsOrVesselMgr {
		uint256 newDebt = debtTokenBalances[_collateral] + _amount;
		debtTokenBalances[_collateral] = newDebt;
		emit ActivePoolDebtUpdated(_collateral, newDebt);
	}

	function decreaseDebt(
		address _asset,
		uint256 _amount
	) external override callerIsBorrowerOpsOrStabilityPoolOrVesselMgr {
		uint256 newDebt = debtTokenBalances[_asset] - _amount;
		debtTokenBalances[_asset] = newDebt;
		emit ActivePoolDebtUpdated(_asset, newDebt);
	}

	// --- Pool functionality ---

	function sendAsset(
		address _asset,
		address _account,
		uint256 _amount
	) external override nonReentrant callerIsBorrowerOpsOrStabilityPoolOrVesselMgrOrVesselMgrOps {
		uint256 safetyTransferAmount = SafetyTransfer.decimalsCorrection(_asset, _amount);
		if (safetyTransferAmount == 0) return;

		uint256 newBalance = assetsBalances[_asset] - _amount;
		assetsBalances[_asset] = newBalance;

		IERC20Upgradeable(_asset).safeTransfer(_account, safetyTransferAmount);

		if (isERC20DepositContract(_account)) {
			IDeposit(_account).receivedERC20(_asset, _amount);
		}

		emit ActivePoolAssetBalanceUpdated(_asset, newBalance);
		emit AssetSent(_account, _asset, safetyTransferAmount);
	}

	function isERC20DepositContract(address _account) private view returns (bool) {
		return (_account == address(defaultPool) ||
			_account == address(collSurplusPool) ||
			_account == stabilityPoolAddress);
	}

	function receivedERC20(address _asset, uint256 _amount) external override callerIsBorrowerOpsOrDefaultPool {
		uint256 newBalance = assetsBalances[_asset] + _amount;
		assetsBalances[_asset] = newBalance;
		emit ActivePoolAssetBalanceUpdated(_asset, newBalance);
	}
}
