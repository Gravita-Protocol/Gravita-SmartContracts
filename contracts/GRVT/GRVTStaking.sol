// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../Dependencies/BaseMath.sol";
import "../Dependencies/GravitaMath.sol";
import "../Dependencies/SafetyTransfer.sol";

import "../Interfaces/IDeposit.sol";
import "../Interfaces/IGRVTStaking.sol";

contract GRVTStaking is IGRVTStaking, PausableUpgradeable, OwnableUpgradeable, BaseMath, ReentrancyGuardUpgradeable {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	// --- Data ---
	string public constant NAME = "GRVTStaking";
	address constant ETH_REF_ADDRESS = address(0);

	mapping(address => uint256) public stakes;
	uint256 public totalGRVTStaked;

	mapping(address => uint256) public F_ASSETS; // Running sum of asset fees per-GRVT-staked
	uint256 public F_DEBT_TOKENS; // Running sum of debt token fees per-GRVT-staked

	// User snapshots of F_ASSETS and F_DEBT_TOKENS, taken at the point at which their latest deposit was made
	mapping(address => Snapshot) public snapshots;

	struct Snapshot {
		mapping(address => uint256) F_ASSETS_Snapshot;
		uint256 F_DEBT_TOKENS_Snapshot;
	}

	address[] ASSET_TYPE;
	mapping(address => bool) isAssetTracked;
	mapping(address => uint256) public sentToTreasuryTracker;

	IERC20Upgradeable public override grvtToken;
	address public constant debtToken = address(0);

	address public activePoolAddress;
	address public feeCollectorAddress;
	address public vesselManagerAddress;
	address public constant treasury = address(0);

	bool public isSetupInitialized;

	// --- Initializer ---

	function initialize() public initializer {
		__Ownable_init();
		__ReentrancyGuard_init();
		__Pausable_init();
		_pause();
	}

	// --- Functions ---
	function setAddresses(
		address _grvtTokenAddress,
		address _feeCollectorAddress,
		address _vesselManagerAddress
	) external onlyOwner {
		require(!isSetupInitialized, "Setup is already initialized");

		grvtToken = IERC20Upgradeable(_grvtTokenAddress);
		feeCollectorAddress = _feeCollectorAddress;
		vesselManagerAddress = _vesselManagerAddress;

		isAssetTracked[ETH_REF_ADDRESS] = true;
		ASSET_TYPE.push(ETH_REF_ADDRESS);
		isSetupInitialized = true;
	}

	// If caller has a pre-existing stake, send any accumulated asset and debtToken gains to them.
	function stake(uint256 _GRVTamount) external override nonReentrant whenNotPaused {
		require(_GRVTamount > 0);

		uint256 currentStake = stakes[msg.sender];

		uint256 assetLength = ASSET_TYPE.length;
		uint256 assetGain;
		address asset;

		for (uint256 i = 0; i < assetLength; i++) {
			asset = ASSET_TYPE[i];

			if (currentStake != 0) {
				assetGain = _getPendingAssetGain(asset, msg.sender);

				if (i == 0) {
					uint256 debtTokenGain = _getPendingDebtTokenGain(msg.sender);
					IERC20Upgradeable(address(debtToken)).safeTransfer(msg.sender, debtTokenGain);
					emit StakingGainsDebtTokensWithdrawn(msg.sender, debtTokenGain);
				}

				_sendAssetGainToUser(asset, assetGain);
				emit StakingGainsAssetWithdrawn(msg.sender, asset, assetGain);
			}

			_updateUserSnapshots(asset, msg.sender);
		}

		uint256 newStake = currentStake + _GRVTamount;

		// Increase user’s stake and total GRVT staked
		stakes[msg.sender] = newStake;
		totalGRVTStaked = totalGRVTStaked + _GRVTamount;
		emit TotalGRVTStakedUpdated(totalGRVTStaked);

		// Transfer GRVT from caller to this contract
		grvtToken.transferFrom(msg.sender, address(this), _GRVTamount);

		emit StakeChanged(msg.sender, newStake);
	}

	// Unstake the GRVT and send the it back to the caller, along with their accumulated gains.
	// If requested amount > stake, send their entire stake.
	function unstake(uint256 _GRVTamount) external override nonReentrant {
		uint256 currentStake = stakes[msg.sender];
		_requireUserHasStake(currentStake);

		uint256 assetLength = ASSET_TYPE.length;
		uint256 assetGain;
		address asset;

		for (uint256 i = 0; i < assetLength; i++) {
			asset = ASSET_TYPE[i];

			// Grab any accumulated asset and debtToken gains from the current stake
			assetGain = _getPendingAssetGain(asset, msg.sender);

			if (i == 0) {
				uint256 debtTokenGain = _getPendingDebtTokenGain(msg.sender);
				IERC20Upgradeable(address(debtToken)).safeTransfer(msg.sender, debtTokenGain);
				emit StakingGainsDebtTokensWithdrawn(msg.sender, debtTokenGain);
			}

			_updateUserSnapshots(asset, msg.sender);
			emit StakingGainsAssetWithdrawn(msg.sender, asset, assetGain);
			_sendAssetGainToUser(asset, assetGain);
		}

		if (_GRVTamount > 0) {
			uint256 GRVTToWithdraw = GravitaMath._min(_GRVTamount, currentStake);
			uint256 newStake = currentStake - GRVTToWithdraw;

			// Decrease user's stake and total GRVT staked
			stakes[msg.sender] = newStake;
			totalGRVTStaked = totalGRVTStaked - GRVTToWithdraw;
			emit TotalGRVTStakedUpdated(totalGRVTStaked);

			// Transfer unstaked GRVT to user
			IERC20Upgradeable(address(grvtToken)).safeTransfer(msg.sender, GRVTToWithdraw);
			emit StakeChanged(msg.sender, newStake);
		}
	}

	function pause() public onlyOwner {
		_pause();
	}

	function unpause() public onlyOwner {
		_unpause();
	}

	// --- Reward-per-unit-staked increase functions. Called by Gravita core contracts ---

	function increaseFee_Asset(address _asset, uint256 _assetFee) external override callerIsVesselManager {
		if (paused()) {
			sendToTreasury(_asset, _assetFee);
			return;
		}

		if (!isAssetTracked[_asset]) {
			isAssetTracked[_asset] = true;
			ASSET_TYPE.push(_asset);
		}

		uint256 assetFeePerGRVTStaked;

		if (totalGRVTStaked > 0) {
			assetFeePerGRVTStaked = (_assetFee * DECIMAL_PRECISION) / totalGRVTStaked;
		}

		F_ASSETS[_asset] = F_ASSETS[_asset] + assetFeePerGRVTStaked;
		emit Fee_AssetUpdated(_asset, F_ASSETS[_asset]);
	}

	function increaseFee_DebtToken(uint256 _debtTokenFee) external override callerIsFeeCollector {
		if (paused()) {
			sendToTreasury(address(debtToken), _debtTokenFee);
			return;
		}

		uint256 feePerGRVTStaked;
		if (totalGRVTStaked > 0) {
			feePerGRVTStaked = (_debtTokenFee * DECIMAL_PRECISION) / totalGRVTStaked;
		}

		F_DEBT_TOKENS = F_DEBT_TOKENS + feePerGRVTStaked;
		emit Fee_DebtTokenUpdated(F_DEBT_TOKENS);
	}

	function sendToTreasury(address _asset, uint256 _amount) internal {
		_sendAsset(treasury, _asset, _amount);
		sentToTreasuryTracker[_asset] += _amount;
		emit SentToTreasury(_asset, _amount);
	}

	// --- Pending reward functions ---

	function getPendingAssetGain(address _asset, address _user) external view override returns (uint256) {
		return _getPendingAssetGain(_asset, _user);
	}

	function _getPendingAssetGain(address _asset, address _user) internal view returns (uint256) {
		uint256 F_ASSET_Snapshot = snapshots[_user].F_ASSETS_Snapshot[_asset];
		uint256 AssetGain = (stakes[_user] * (F_ASSETS[_asset] - F_ASSET_Snapshot)) / DECIMAL_PRECISION;
		return AssetGain;
	}

	function getPendingDebtTokenGain(address _user) external view override returns (uint256) {
		return _getPendingDebtTokenGain(_user);
	}

	function _getPendingDebtTokenGain(address _user) internal view returns (uint256) {
		uint256 debtTokenSnapshot = snapshots[_user].F_DEBT_TOKENS_Snapshot;
		return (stakes[_user] * (F_DEBT_TOKENS - debtTokenSnapshot)) / DECIMAL_PRECISION;
	}

	// --- Internal helper functions ---

	function _updateUserSnapshots(address _asset, address _user) internal {
		snapshots[_user].F_ASSETS_Snapshot[_asset] = F_ASSETS[_asset];
		snapshots[_user].F_DEBT_TOKENS_Snapshot = F_DEBT_TOKENS;
		emit StakerSnapshotsUpdated(_user, F_ASSETS[_asset], F_DEBT_TOKENS);
	}

	function _sendAssetGainToUser(address _asset, uint256 _assetGain) internal {
		_assetGain = SafetyTransfer.decimalsCorrection(_asset, _assetGain);
		_sendAsset(msg.sender, _asset, _assetGain);
		emit AssetSent(_asset, msg.sender, _assetGain);
	}

	function _sendAsset(address _sendTo, address _asset, uint256 _amount) internal {
		IERC20Upgradeable(_asset).safeTransfer(_sendTo, _amount);
	}

	// --- 'require' functions ---

	modifier callerIsVesselManager() {
		require(msg.sender == vesselManagerAddress, "GRVTStaking: caller is not VesselManager");
		_;
	}

	modifier callerIsFeeCollector() {
		require(msg.sender == feeCollectorAddress, "GRVTStaking: caller is not FeeCollector");
		_;
	}

	function _requireUserHasStake(uint256 currentStake) internal pure {
		require(currentStake > 0, "GRVTStaking: User must have a non-zero stake");
	}
}
