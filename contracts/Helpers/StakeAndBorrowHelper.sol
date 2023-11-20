// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../Interfaces/IBorrowerOperations.sol";
import "../Dependencies/External/OpenZeppelin5/IERC4626.sol";

contract StakeAndBorrowHelper is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
	using SafeERC20 for IERC20;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Custom errors
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  error UnregisteredAssetError();

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Constants & immutables
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	address public immutable borrowerOperations;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// State
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	mapping(address asset => address stakingVault) public stakingVaults;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Initializer & setup functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	constructor(address _borrowerOperations) {
		require(_borrowerOperations != address(0), "Invalid address");
		borrowerOperations = _borrowerOperations;
	}

	/**
	 * @dev Initialization using `deployProxy` happens at the same time the proxy is created, therefore, there's no
	 *      risk of front-running.
	 */
	function initialize() public initializer {
		__Ownable_init();
	}

  /**
   * @dev `_vault` can be a new address, an overriding address, or zero in case we want to unregister an asset
   */
	function registerStakingVault(address _asset, address _vault) external onlyOwner {
		require(_asset != address(0), "Invalid asset address");
		stakingVaults[_asset] = _vault;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// BorrowerOperations mimic functions
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

	/**
	 * @dev asset is already unwrapped in the CollSurplusPool, so we send the underlying token's address (instead of the vault's)
	 */
	function claimCollateral(address _asset) external nonReentrant {
		IBorrowerOperations(borrowerOperations).claimCollateralFor(msg.sender, _asset);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Upgrade functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function authorizeUpgrade(address _newImplementation) public {
		_authorizeUpgrade(_newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
