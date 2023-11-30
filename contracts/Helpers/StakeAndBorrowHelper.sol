// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../Interfaces/IBorrowerOperations.sol";

contract StakeAndBorrowHelper is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
	using SafeERC20 for IERC20;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Custom errors
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	error UnregisteredAssetError();

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// State
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	address public borrowerOperations;
	mapping(address asset => address stakingVault) public stakingVaults;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Initializer & setup functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	/**
	 * @dev Initialization using `deployProxy` happens at the same time the proxy is created, therefore, there's no
	 *      risk of front-running.
	 */
	function initialize(address _borrowerOperations) public initializer {
		require(_borrowerOperations != address(0), "Invalid address");
		__Ownable_init();
		borrowerOperations = _borrowerOperations;
	}

	/**
	 * @dev `_vault` can be a new address, an overriding address, or zero in case we want to unregister an asset
	 */
	function registerStakingVault(address _asset, address _vault) external onlyOwner {
		require(_asset != address(0), "Invalid asset address");
		stakingVaults[_asset] = _vault;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// BorrowerOperations wrapped functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function openVessel(
		address _asset,
		uint256 _assetAmount,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint
	) external nonReentrant {
		address _vault = stakingVaults[_asset];
		if (_vault == address(0)) {
			revert UnregisteredAssetError();
		}
		IERC20(_asset).transferFrom(msg.sender, address(this), _assetAmount);
		uint256 _shares = IERC4626(_vault).deposit(_assetAmount, msg.sender);
		IBorrowerOperations(borrowerOperations).openVesselFor(
			msg.sender,
			_vault,
			_shares,
			_debtTokenAmount,
			_upperHint,
			_lowerHint
		);
	}

	function adjustVessel(
		address _asset,
		uint256 _assetSent,
		uint256 _collWithdrawal,
		uint256 _debtTokenChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint
	) external nonReentrant {
		address _vault = stakingVaults[_asset];
		if (_vault == address(0)) {
			revert UnregisteredAssetError();
		}
		uint256 _sharesSent = 0;
		if (_assetSent != 0) {
			IERC20(_asset).transferFrom(msg.sender, address(this), _assetSent);
			_sharesSent = IERC4626(_vault).deposit(_assetSent, msg.sender);
		}
		IBorrowerOperations(borrowerOperations).adjustVesselFor(
			msg.sender,
			_vault,
			_sharesSent,
			_collWithdrawal,
			_debtTokenChange,
			_isDebtIncrease,
			_upperHint,
			_lowerHint
		);
	}

	function closeVessel(address _asset) external nonReentrant {
		address _vault = stakingVaults[_asset];
		if (_vault == address(0)) {
			revert UnregisteredAssetError();
		}
		IBorrowerOperations(borrowerOperations).closeVesselFor(msg.sender, _vault);
	}

	function claimCollateral(address _asset) external nonReentrant {
		address _vault = stakingVaults[_asset];
		if (_vault == address(0)) {
			revert UnregisteredAssetError();
		}
		uint256 _prevBalance = IERC4626(_vault).balanceOf(msg.sender);
		IBorrowerOperations(borrowerOperations).claimCollateralFor(msg.sender, _vault);
		uint256 _claimedShares = IERC4626(_vault).balanceOf(msg.sender) - _prevBalance;
		IERC4626(_vault).redeem(_claimedShares, msg.sender, msg.sender);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Upgrade functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function authorizeUpgrade(address _newImplementation) public {
		_authorizeUpgrade(_newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}

