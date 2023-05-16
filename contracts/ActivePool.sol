// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./Dependencies/SafetyTransfer.sol";
import "./Addresses.sol";
import "./Interfaces/IActivePool.sol";

/*
 * The Active Pool holds the collaterals and debt amounts for all active vessels.
 *
 * When a vessel is liquidated, it's collateral and debt tokens are transferred from the Active Pool, to either the
 * Stability Pool, the Default Pool, or both, depending on the liquidation conditions.
 *
 */
contract ActivePool is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable, IActivePool, Addresses {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "ActivePool";

	mapping(address => uint256) internal assetsBalances;
	mapping(address => uint256) internal debtTokenBalances;

	// --- Modifiers ---

	modifier callerIsBorrowerOpsOrDefaultPool() {
		require(
			msg.sender == borrowerOperations || msg.sender == defaultPool,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	modifier callerIsBorrowerOpsOrVesselMgr() {
		require(
			msg.sender == borrowerOperations || msg.sender == vesselManager,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	modifier callerIsBorrowerOpsOrStabilityPoolOrVesselMgr() {
		require(
			msg.sender == borrowerOperations || msg.sender == stabilityPool || msg.sender == vesselManager,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	modifier callerIsBorrowerOpsOrStabilityPoolOrVesselMgrOrVesselMgrOps() {
		require(
			msg.sender == borrowerOperations ||
				msg.sender == stabilityPool ||
				msg.sender == vesselManager ||
				msg.sender == vesselManagerOperations,
			"ActivePool: Caller is not an authorized Gravita contract"
		);
		_;
	}

	// --- Initializer ---

	function initialize() public initializer {
		__Ownable_init();
		__ReentrancyGuard_init();
		__UUPSUpgradeable_init();
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

	function isERC20DepositContract(address _account) private pure returns (bool) {
		return (_account == address(defaultPool) ||
			_account == address(collSurplusPool) ||
			_account == address(stabilityPool));
	}

	function receivedERC20(address _asset, uint256 _amount) external override callerIsBorrowerOpsOrDefaultPool {
		uint256 newBalance = assetsBalances[_asset] + _amount;
		assetsBalances[_asset] = newBalance;
		emit ActivePoolAssetBalanceUpdated(_asset, newBalance);
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
