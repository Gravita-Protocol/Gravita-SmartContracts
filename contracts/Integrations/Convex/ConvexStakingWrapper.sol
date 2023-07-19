// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Interfaces/IBooster.sol";
import "./Interfaces/IConvexDeposits.sol";
import "./Interfaces/IRewardStaking.sol";
import "./Interfaces/ITokenWrapper.sol";
import "../../Addresses.sol";

/**
 * @dev Wrapper based upon https://github.com/convex-eth/platform/blob/main/contracts/contracts/wrappers/ConvexStakingWrapper.sol
 */
contract ConvexStakingWrapper is
	OwnableUpgradeable,
	UUPSUpgradeable,
	ReentrancyGuardUpgradeable,
	PausableUpgradeable,
	ERC20Upgradeable,
	Addresses
{
	using SafeERC20 for IERC20;

	// Structs ----------------------------------------------------------------------------------------------------------

	struct RewardEarned {
		address token;
		uint256 amount;
	}

	struct RewardType {
		address token;
		address pool;
		uint256 integral;
		uint256 remaining;
		mapping(address => uint256) integralFor;
		mapping(address => uint256) claimableAmount;
	}

	// Events -----------------------------------------------------------------------------------------------------------

	event Deposited(address indexed _user, address indexed _account, uint256 _amount, bool _wrapped);
	event Withdrawn(address indexed _user, uint256 _amount, bool _unwrapped);
	event RewardInvalidated(address _rewardToken);
	event RewardRedirected(address indexed _account, address _forward);
	event RewardAdded(address _token);
	event UserCheckpoint(address _userA, address _userB);
	event ProtocolFeeChanged(uint256 oldProtocolFee, uint256 newProtocolFee);

	// Constants/Immutables ---------------------------------------------------------------------------------------------

	address public constant convexBooster = address(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
	address public constant crv = address(0xD533a949740bb3306d119CC777fa900bA034cd52);
	address public constant cvx = address(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
	address public curveToken;
	address public convexToken;
	address public convexPool;
	uint256 public convexPoolId;
	uint256 private constant CRV_INDEX = 0;
	uint256 private constant CVX_INDEX = 1;

	// State ------------------------------------------------------------------------------------------------------------

	RewardType[] public rewards;
	mapping(address => uint256) public registeredRewards; // rewardToken -> index in rewards[] + 1
	mapping(address => address) public rewardRedirect; // account -> redirectTo
	uint256 public protocolFee = 0.15 ether;

	// Constructor/Initializer ------------------------------------------------------------------------------------------

	function initialize(uint256 _poolId) external initializer {
		__ERC20_init("GravitaCurveToken", "grCRV");
		__Ownable_init();
		__UUPSUpgradeable_init();

		(address _lptoken, address _token, , address _rewards, , ) = IBooster(convexBooster).poolInfo(_poolId);
		curveToken = _lptoken;
		convexToken = _token;
		convexPool = _rewards;
		convexPoolId = _poolId;

		addRewards();
		setApprovals();
	}

	// Admin (Owner) functions ------------------------------------------------------------------------------------------

	function addRewards() public onlyOwner {
		address _convexPool = convexPool;

		if (rewards.length == 0) {
			RewardType storage newCrvReward = rewards.push();
			newCrvReward.token = crv;
			newCrvReward.pool = _convexPool;
			RewardType storage newCvxReward = rewards.push();
			newCvxReward.token = cvx;
			registeredRewards[crv] = CRV_INDEX + 1;
			registeredRewards[cvx] = CVX_INDEX + 1;
			/// @dev commented the transfer below until understanding its value
			// send to self to warmup state
			// IERC20(crv).transfer(address(this), 0);
			// send to self to warmup state
			// IERC20(cvx).transfer(address(this), 0);
			emit RewardAdded(crv);
			emit RewardAdded(cvx);
		}

		uint256 _extraCount = IRewardStaking(_convexPool).extraRewardsLength();
		for (uint256 _i; _i < _extraCount; _i++) {
			address _extraPool = IRewardStaking(_convexPool).extraRewards(_i);
			address _extraToken = IRewardStaking(_extraPool).rewardToken();
			// from pool 151, extra reward tokens are wrapped
			if (convexPoolId >= 151) {
				_extraToken = ITokenWrapper(_extraToken).token();
			}
			if (_extraToken == cvx) {
				// update cvx reward pool address
				rewards[CVX_INDEX].pool = _extraPool;
			} else if (registeredRewards[_extraToken] == 0) {
				// add new token to list
				RewardType storage newReward = rewards.push();
				newReward.token = _extraToken;
				newReward.pool = _extraPool;
				registeredRewards[_extraToken] = rewards.length;
				emit RewardAdded(_extraToken);
			}
		}
	}

	function addTokenReward(address _token) public virtual onlyOwner {
		// check if not registered yet
		if (registeredRewards[_token] == 0) {
			RewardType storage newReward = rewards.push();
			newReward.token = _token;
			registeredRewards[_token] = rewards.length; //mark registered at index+1
			/// @dev commented the transfer below until understanding its value
			// send to self to warmup state
			// IERC20(_token).transfer(address(this), 0);
			emit RewardAdded(_token);
		} else {
			// get previous used index of given token
			// this ensures that reviving can only be done on the previous used slot
			uint256 _index = registeredRewards[_token];
			if (_index != 0) {
				// index is registeredRewards minus one
				RewardType storage reward = rewards[_index - 1];
				// check if it was invalidated
				if (reward.token == address(0)) {
					// revive
					reward.token = _token;
					emit RewardAdded(_token);
				}
			}
		}
	}

	/**
	 * @dev Allows for reward invalidation, in case the token has issues during calcRewardIntegral.
	 */
	function invalidateReward(address _token) public onlyOwner {
		uint256 _index = registeredRewards[_token];
		if (_index != 0) {
			// index is registered rewards minus one
			RewardType storage reward = rewards[_index - 1];
			require(reward.token == _token, "!mismatch");
			// set reward token address to 0, integral calc will now skip
			reward.token = address(0);
			emit RewardInvalidated(_token);
		}
	}

	function setApprovals() public onlyOwner {
		IERC20(curveToken).safeApprove(convexBooster, 0);
		IERC20(curveToken).safeApprove(convexBooster, type(uint256).max);
		IERC20(convexToken).safeApprove(convexPool, 0);
		IERC20(convexToken).safeApprove(convexPool, type(uint256).max);
	}

	function pause() external onlyOwner {
		_pause();
	}

	function unpause() external onlyOwner {
		_unpause();
	}

	// Public functions -------------------------------------------------------------------------------------------------

	function depositCurveTokens(uint256 _amount, address _to) external whenNotPaused {
		if (_amount != 0) {
			// no need to call _checkpoint() since _mint() will
			_mint(_to, _amount);
			IERC20(curveToken).safeTransferFrom(msg.sender, address(this), _amount);
			/// @dev the `true` argument below means the Booster contract will immediately stake into the rewards contract
			IConvexDeposits(convexBooster).deposit(convexPoolId, _amount, true);
			emit Deposited(msg.sender, _to, _amount, true);
		}
	}

	function stakeConvexTokens(uint256 _amount, address _to) external whenNotPaused {
		if (_amount != 0) {
			// no need to call _checkpoint() since _mint() will
			_mint(_to, _amount);
			IERC20(convexToken).safeTransferFrom(msg.sender, address(this), _amount);
			IRewardStaking(convexPool).stake(_amount);
			emit Deposited(msg.sender, _to, _amount, false);
		}
	}

	/**
	 * @notice Function that returns all claimable rewards for a specific user.
	 * @dev One should call the mutable userCheckpoint() function beforehand for updating the state before this view.
	 */
	function getEarnedRewards(address _account) external view returns (RewardEarned[] memory _claimable) {
		uint256 _rewardCount = rewards.length;
		_claimable = new RewardEarned[](_rewardCount);
		for (uint256 _i; _i < _rewardCount; _i++) {
			RewardType storage reward = rewards[_i];
			if (reward.token != address(0)) {
				_claimable[_i].amount = reward.claimableAmount[_account];
				_claimable[_i].token = reward.token;
			}
		}
	}

	/**
	 * from https://github.com/convex-eth/platform/blob/main/contracts/contracts/Booster.sol
	 * "Claim crv and extra rewards and disperse to reward contracts"
	 */
	function earmarkRewards() external returns (bool) {
		return IBooster(convexBooster).earmarkRewards(convexPoolId);
	}

	function userCheckpoint(address _account) external {
		_checkpoint([_account, address(0)], false);
	}

	function claimEarnedRewards(address _account) external {
		address _redirect = rewardRedirect[_account];
		address _destination = _redirect != address(0) ? _redirect : _account;
		_checkpoint([_account, _destination], true);
	}

	function claimAndForwardEarnedRewards(address _account, address _forwardTo) external {
		require(msg.sender == _account, "!self");
		_checkpoint([_account, _forwardTo], true);
	}

	function claimTreasuryEarnedRewards(uint256 _index) external {
		// TODO evaluate if there's need to restrict this call
		// require(treasuryAddress == msg.sender, "Treasury Only");
		RewardType storage reward = rewards[_index];
		if (reward.token != address(0)) {
			uint256 _amount = reward.claimableAmount[treasuryAddress];
			if (_amount != 0) {
				reward.claimableAmount[treasuryAddress] = 0;
				IERC20(reward.token).safeTransfer(treasuryAddress, _amount);
			}
		}
	}

	function rewardsLength() external view returns (uint256) {
		return rewards.length;
	}

	/**
	 * @notice Set any claimed rewards to automatically go to a different address.
	 * @dev Set to zero to disable redirect.
	 */
	function setRewardRedirect(address _to) external nonReentrant {
		rewardRedirect[msg.sender] = _to;
		emit RewardRedirected(msg.sender, _to);
	}

	function totalBalanceOf(address _account) external view returns (uint256) {
		return _getDepositedBalance(_account);
	}

	// withdraw to convex deposit token
	function withdraw(uint256 _amount) external {
		if (_amount != 0) {
			// no need to call _checkpoint() since _burn() will
			_burn(msg.sender, _amount);
			IRewardStaking(convexPool).withdraw(_amount, false);
			IERC20(convexToken).safeTransfer(msg.sender, _amount);
			emit Withdrawn(msg.sender, _amount, false);
		}
	}

	// withdraw to underlying curve lp token
	function withdrawAndUnwrap(uint256 _amount) external {
		if (_amount != 0) {
			// no need to call _checkpoint() since _burn() will
			_burn(msg.sender, _amount);
			IRewardStaking(convexPool).withdrawAndUnwrap(_amount, false);
			IERC20(curveToken).safeTransfer(msg.sender, _amount);
			emit Withdrawn(msg.sender, _amount, true);
		}
	}

	// Internal/Helper functions ----------------------------------------------------------------------------------------

	/**
	 * @dev Override function from ERC20: "Hook that is called before any transfer of tokens. This includes
	 *     minting and burning."
	 */
	function _beforeTokenTransfer(address _from, address _to, uint256 /* _amount */) internal override {
		_checkpoint([_from, _to], false);
	}

	/// @param _accounts[0] from address
	/// @param _accounts[1] to address
	/// @param _claim flag to perform rewards claiming
	function _checkpoint(address[2] memory _accounts, bool _claim) internal nonReentrant {
		uint256 _supply = _getTotalSupply();
		uint256[2] memory _depositedBalances;
		_depositedBalances[0] = _getDepositedBalance(_accounts[0]);
		if (!_claim) {
			// on a claim call, only do the first slot
			_depositedBalances[1] = _getDepositedBalance(_accounts[1]);
		}

		// don't claim rewards directly if paused -- can still technically claim via unguarded calls
		// but skipping here protects against outside calls reverting
		if (!paused()) {
			IRewardStaking(convexPool).getReward(address(this), true);
		}

		uint256 _rewardCount = rewards.length;
		for (uint256 _i; _i < _rewardCount; _i++) {
			_calcRewardsIntegrals(_i, _accounts, _depositedBalances, _supply, _claim);
		}
		emit UserCheckpoint(_accounts[0], _accounts[1]);
	}

	function _getDepositedBalance(address _account) internal view virtual returns (uint256) {
		if (_account == address(0) || _account == vesselManager) {
			return 0;
		}
		uint256 _collateral;
		if (vesselManager != address(0)) {
			// _collateral = IVesselManager(vesselManager).getVesselColl(address(this), _account);
			// VesselManager.getPendingAssetReward(address _asset, address _borrower)
			// CollSurplus.getCollateral(address _asset, address _account)
			// StabilityPool.getDepositorGains(address _depositor, address[] calldata _assets) external view returns (address[] memory, uint256[] memory)
		}
		return balanceOf(_account) + _collateral;
	}

	function _getTotalSupply() internal view virtual returns (uint256) {
		// override and add any supply needed (interest based growth)
		return totalSupply();
	}

	function _calcRewardsIntegrals(
		uint256 _index,
		address[2] memory _accounts,
		uint256[2] memory _balances,
		uint256 _supply,
		bool _isClaim
	) internal {
		RewardType storage reward = rewards[_index];
		if (reward.token == address(0)) {
			// token address could have been reset by invalidateReward()
			return;
		}

		// get difference in contract balance and remaining rewards
		// getReward is unguarded so we use reward.remaining to keep track of how much was actually claimed
		uint256 _contractBalance = IERC20(reward.token).balanceOf(address(this));

		// check whether balance increased, and update integral if needed
		if (_supply > 0 && _contractBalance > reward.remaining) {
			uint256 _diff = ((_contractBalance - reward.remaining) * 1e20) / _supply;
			reward.integral += _diff;
		}

		// update user integrals
		for (uint256 _i = 0; _i < _accounts.length; _i++) {
			address _account = _accounts[_i];
			if (_account == address(0)) continue; // do not give rewards to address 0
			if (_account == vesselManager) continue;

			uint _accountIntegral = reward.integralFor[_account];
			if (_isClaim || _accountIntegral < reward.integral) {
				// reward.claimableAmount[_accounts[_i]] contains the current claimable amount, to that we add
				// add(_balances[_i].mul(reward.integral.sub(_accountIntegral)) => token_balance * (general_reward/token - user_claimed_reward/token)

				uint256 _newClaimableAmount = (_balances[_i] * (reward.integral - _accountIntegral)) / 1e20;
				uint256 _rewardAmount = reward.claimableAmount[_account] + _newClaimableAmount;

				if (_rewardAmount != 0) {
					uint256 _userRewardAmount = (_rewardAmount * (1 ether - protocolFee)) / 1 ether;
					uint256 _treasuryRewardAmount = _rewardAmount - _userRewardAmount;

					if (_isClaim) {
						reward.claimableAmount[_account] = 0;
						IERC20(reward.token).safeTransfer(_accounts[_i + 1], _userRewardAmount); // on a claim, the second address is the forwarding address
						_contractBalance -= _rewardAmount;
					} else {
						reward.claimableAmount[_account] = _userRewardAmount;
					}
					reward.claimableAmount[treasuryAddress] += _treasuryRewardAmount;
				}
				reward.integralFor[_account] = reward.integral;
			}
			if (_isClaim) {
				break; // only update/claim for first address (second address is the forwarding address)
			}
		}

		// update remaining reward here since balance could have changed (on a claim)
		if (_contractBalance != reward.remaining) {
			reward.remaining = _contractBalance;
		}
	}

	// Timelock functions -----------------------------------------------------------------------------------------------

	function setProtocolFee(uint256 _newfee) external onlyTimelock {
		uint256 _oldFee = protocolFee;
		protocolFee = _newfee;
		emit ProtocolFeeChanged(_oldFee, _newfee);
	}

	// Modifiers --------------------------------------------------------------------------------------------------------

	modifier onlyTimelock() {
		require(timelockAddress == msg.sender, "Only Timelock");
		_;
	}

	// Upgrades ---------------------------------------------------------------------------------------------------------

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
