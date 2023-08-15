// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../Interfaces/ICollSurplusPool.sol";
import "../Interfaces/IRewardAccruing.sol";
import "../Interfaces/IStabilityPool.sol";
import "../Interfaces/IVesselManager.sol";
import "../Addresses.sol";

import "@openzeppelin/contracts/utils/Strings.sol"; // TODO remove after done with debug/tests
import "hardhat/console.sol"; // TODO remove after done with debug/tests

/**
 * Based upon https://github.com/convex-eth/platform/blob/main/contracts/contracts/wrappers/ConvexStakingWrapper.sol
 */
abstract contract AbstractStakingWrapper is
	OwnableUpgradeable,
	UUPSUpgradeable,
	ReentrancyGuardUpgradeable,
	PausableUpgradeable,
	ERC20Upgradeable,
	IRewardAccruing,
	Addresses
{
	using SafeERC20 for IERC20;

	// Events -----------------------------------------------------------------------------------------------------------

	event RewardAccruingRightsTransferred(address _from, address _to, uint256 _amount);

	// Structs ----------------------------------------------------------------------------------------------------------

	struct RewardType {
		address token;
		// address pool;
		uint256 integral;
		uint256 remaining;
		mapping(address => uint256) integralFor; // account -> integralValue
		mapping(address => uint256) claimableAmount;
	}

	struct RewardEarned {
		address token;
		uint256 amount;
	}

	// Events -----------------------------------------------------------------------------------------------------------

	event Deposited(address indexed _account, uint256 _amount);
	event ProtocolFeeChanged(uint256 oldProtocolFee, uint256 newProtocolFee);
	event RewardAdded(address _token);
	event RewardInvalidated(address _rewardToken);
	event RewardRedirected(address indexed _account, address _forward);
	event UserCheckpoint(address _userA, address _userB);
	event Withdrawn(address indexed _user, uint256 _amount);

	// Constants/Immutables ---------------------------------------------------------------------------------------------

	string private wrapperName;
	string private wrapperSymbol;
	address public wrappedToken;

	// State ------------------------------------------------------------------------------------------------------------

	RewardType[] public rewards;
	mapping(address => uint256) public registeredRewards; // rewardToken -> index in rewards[] + 1
	mapping(address => address) public rewardRedirect; // account -> redirectTo
	uint256 public protocolFee; // share of rewards that are routed to protocol's treasury

	// Constructor/Initializer ------------------------------------------------------------------------------------------

	function abstractInitialize(address _wrappedToken) public onlyInitializing {
		protocolFee = 0.15 ether; // default protocol fee is 15%
		wrapperName = string(abi.encodePacked("Gravita ", ERC20(_wrappedToken).name()));
		wrapperSymbol = string(abi.encodePacked("gr", ERC20(_wrappedToken).symbol()));
		wrappedToken = _wrappedToken;

		__ERC20_init(wrapperName, wrapperSymbol);
		__Ownable_init();
		__UUPSUpgradeable_init();

		_addRewards();
	}

	// Admin (Owner) functions ------------------------------------------------------------------------------------------

	function addTokenReward(address _token) public onlyOwner {
		// check if not registered yet
		if (registeredRewards[_token] == 0) {
			RewardType storage newReward = rewards.push();
			newReward.token = _token;
			registeredRewards[_token] = rewards.length; //mark registered at index+1
			emit RewardAdded(_token);
		} else {
			// get previous index of given token, which ensures reviving can only be done on the previous used slot
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
	 * @dev Allows for reward invalidation, in case the token has issues during calcRewardsIntegrals.
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

	function pause() external onlyOwner {
		_pause();
	}

	function unpause() external onlyOwner {
		_unpause();
	}

	// Public functions -------------------------------------------------------------------------------------------------

	function name() public view override returns (string memory) {
		return wrapperName;
	}

	function symbol() public view override returns (string memory) {
		return wrapperSymbol;
	}

	function deposit(uint256 _amount) external whenNotPaused {
		if (_amount != 0) {
			// no need to call _checkpoint() since _mint() will
			_mint(msg.sender, _amount);
			IERC20(wrappedToken).safeTransferFrom(msg.sender, address(this), _amount);
			_rewardContractStake(_amount);
			emit Deposited(msg.sender, _amount);
		}
	}

	/**
	 * @notice Function that returns all claimable rewards for a specific user.
	 * @dev One should call the mutable userCheckpoint() function beforehand for updating the state for
	 *     the most up-to-date results.
	 */
	function getEarnedRewards(address _account) external view returns (RewardEarned[] memory _claimable) {
		uint256 _rewardCount = rewards.length;
		_claimable = new RewardEarned[](_rewardCount);
		for (uint256 _i; _i < _rewardCount; ) {
			RewardType storage reward = rewards[_i];
			if (reward.token != address(0)) {
				_claimable[_i].amount = reward.claimableAmount[_account];
				_claimable[_i].token = reward.token;
			}
			unchecked {
				++_i;
			}
		}
	}

	function userCheckpoint() external {
		_checkpoint([msg.sender, address(0)], false);
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
		RewardType storage reward = rewards[_index];
		if (reward.token != address(0)) {
			uint256 _amount = reward.claimableAmount[treasuryAddress];
			if (_amount != 0) {
				reward.remaining -= _amount;
				reward.claimableAmount[treasuryAddress] = 0;
				IERC20(reward.token).safeTransfer(treasuryAddress, _amount);
			}
		}
	}

	/**
	 * @notice Collateral on the Gravita Protocol is stored in different pools based on its lifecycle status.
	 *     Borrowers will accrue rewards while their collateral is in:
	 *         - ActivePool (queried via VesselManager), meaning their vessel is active
	 *         - CollSurplusPool, meaning their vessel was liquidated/redeemed against and there was a surplus
	 *     Gravita will accrue rewards while collateral is in:
	 *         - DefaultPool, meaning collateral got redistributed during a liquidation
	 *         - StabilityPool, meaning collateral got offset against deposits and turned into gains waiting for claiming
	 *
	 * @dev See https://docs.google.com/document/d/1j6mcK4iB3aWfPSH3l8UdYL_G3sqY3k0k1G4jt81OsRE/edit?usp=sharing
	 */
	function gravitaBalanceOf(address _account) public view returns (uint256 _collateral) {
		if (_account == treasuryAddress) {
			_collateral = IPool(defaultPool).getAssetBalance(address(this));
			_collateral += IStabilityPool(stabilityPool).getCollateral(address(this));
		} else {
			_collateral = IVesselManager(vesselManager).getVesselColl(address(this), _account);
			_collateral += ICollSurplusPool(collSurplusPool).getCollateral(address(this), _account);
		}
	}

	function totalBalanceOf(address _account) public view returns (uint256) {
		if (_account == address(0) || _isGravitaPool(_account)) {
			return 0;
		}
		return balanceOf(_account) + gravitaBalanceOf(_account);
	}

	function rewardsLength() external view returns (uint256) {
		return rewards.length;
	}

	/**
	 * @notice Set any claimed rewards to automatically go to a different address.
	 * @dev Set to zero to disable redirect.
	 */
	function setRewardRedirect(address _to) external {
		rewardRedirect[msg.sender] = _to;
		emit RewardRedirected(msg.sender, _to);
	}

	function transferRewardAccruingRights(
		address _from,
		address _to,
		uint256 _amount
	) external override onlyDefaultPoolOrStabilityPoolOrVesselManagerOperations {
		console.log("transferRewardAccruingRights(%s, %s, %s)", addrToName(_from), addrToName(_to), f(_amount));
		_checkpoint([_from, _to], false);
		emit RewardAccruingRightsTransferred(_from, _to, _amount);
	}

	// withdraw to underlying LP token
	function withdraw(uint256 _amount) external {
		if (_amount != 0) {
			// no need to call _checkpoint() since _burn() will
			_burn(msg.sender, _amount);
			_rewardContractUnstake(_amount);
			IERC20(wrappedToken).safeTransfer(msg.sender, _amount);
			emit Withdrawn(msg.sender, _amount);
		}
	}

	// Functions deferred to inheriting contracts -----------------------------------------------------------------------

	function _addRewards() internal virtual;

	function _rewardContractStake(uint256 _amount) internal virtual;

	function _rewardContractUnstake(uint256 _amount) internal virtual;

	function _rewardContractGetReward() internal virtual;

	// Internal/Helper functions ----------------------------------------------------------------------------------------

	function _isGravitaPool(address _address) internal view returns (bool) {
		return
			_address == activePool || _address == collSurplusPool || _address == defaultPool || _address == stabilityPool;
	}

	/**
	 * @dev Override function from ERC20: "Hook that is called before any transfer of tokens. This includes
	 *     minting and burning."
	 */
	function _beforeTokenTransfer(address _from, address _to, uint256 /* _amount */) internal override {
		_checkpoint([_from, _to], false);
	}

	/// @param _accounts[0] from address
	/// @param _accounts[1] to address
	/// @param _claim flag to perform rewards claiming (or not)
	function _checkpoint(address[2] memory _accounts, bool _claim) internal nonReentrant {
		console.log("checkpoint(%s, %s, %s)", addrToName(_accounts[0]), addrToName(_accounts[1]), _claim);
		if (_isGravitaPool(_accounts[0]) || _isGravitaPool(_accounts[1])) {
			// ignore checkpoints that involve Gravita pool contracts, as they hold collateral on behalf of others
			return;
		}
		uint256[2] memory _depositedBalances;
		_depositedBalances[0] = totalBalanceOf(_accounts[0]);
		console.log(" - totalBalanceOf_0: %s", f(_depositedBalances[0]));
		if (!_claim) {
			// on a claim call, only do the first slot
			_depositedBalances[1] = totalBalanceOf(_accounts[1]);
			console.log(" - totalBalanceOf_1: %s", f(_depositedBalances[1]));
		}
		// don't claim rewards directly if paused -- can still technically claim via unguarded calls
		// but skipping here protects against outside calls reverting
		if (!paused()) {
			_rewardContractGetReward();
		}
		uint256 _supply = totalSupply();
		uint256 _rewardCount = rewards.length;
		for (uint256 _i; _i < _rewardCount; ) {
			_calcRewardsIntegrals(_i, _accounts, _depositedBalances, _supply, _claim);
			unchecked {
				++_i;
			}
		}
		emit UserCheckpoint(_accounts[0], _accounts[1]);
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
			/// @dev token address could have been reset by invalidateReward()
			return;
		}

		// get difference in contract balance and remaining rewards
		// getReward is unguarded so we use reward.remaining to keep track of how much was actually claimed
		uint256 _contractBalance = IERC20(reward.token).balanceOf(address(this));

		// check whether balance increased, and update integral if needed
		if (_supply > 0 && _contractBalance > reward.remaining) {
			uint256 _diff = ((_contractBalance - reward.remaining) * 1e20) / _supply;
			console.log("Wrapper.diff: %s", f(_diff));
			reward.integral += _diff;
		}

		// update account (and treasury) integrals
		for (uint256 _i; _i < _accounts.length; ) {
			address _account = _accounts[_i];

			if (_account != address(0)) {
				uint _accountIntegral = reward.integralFor[_account];

				if (_isClaim || _accountIntegral < reward.integral) {
					uint256 _claimableAmountIncrease = (_balances[_i] * (reward.integral - _accountIntegral)) / 1e20;

					(uint256 _accountShare, uint256 _treasuryShare) = _splitReward(_claimableAmountIncrease);

					if (_treasuryShare != 0) {
						console.log(
							" - treasury earned share of %s %s from %s",
							f(_treasuryShare),
							addrToName(reward.token),
							addrToName(_account)
						);
						reward.claimableAmount[treasuryAddress] += _treasuryShare;
					}

					uint256 _accountRewardAmount = reward.claimableAmount[_account] + _accountShare;

					if (_accountRewardAmount != 0) {
						if (_isClaim) {
							reward.claimableAmount[_account] = 0;
							IERC20(reward.token).safeTransfer(_accounts[_i + 1], _accountRewardAmount); // on a claim, the second address is the forwarding address
							_contractBalance -= _accountRewardAmount;
							console.log(
								" - reward[%s].transferTo(%s): %s",
								addrToName(reward.token),
								addrToName(_account),
								f(_accountRewardAmount)
							);
						} else {
							console.log(
								" - reward[%s].claimableAmt[%s]: %s",
								addrToName(reward.token),
								addrToName(_account),
								f(_accountRewardAmount)
							);
							reward.claimableAmount[_account] = _accountRewardAmount;
						}
					} else {
						console.log(" - rewardAmount[%s] for account %s is zero", addrToName(reward.token), _i);
					}
					reward.integralFor[_account] = reward.integral;
				}
				if (_isClaim) {
					break; // only update/claim for first address (second address is the forwarding address)
				}
			}
			unchecked {
				++_i;
			}
		}

		// update remaining reward here since balance could have changed (on a claim)
		if (_contractBalance != reward.remaining) {
			reward.remaining = _contractBalance;
		}
	}

	function _splitReward(uint256 _amount) internal view returns (uint256 _accountShare, uint256 _treasuryShare) {
		if (_amount != 0) {
			_accountShare = (_amount * (1 ether - protocolFee)) / 1 ether;
			_treasuryShare = _amount - _accountShare;
		}
	}

	// Timelock functions -----------------------------------------------------------------------------------------------

	function setProtocolFee(uint256 _newfee) public onlyTimelock {
		uint256 _oldFee = protocolFee;
		protocolFee = _newfee;
		emit ProtocolFeeChanged(_oldFee, _newfee);
	}

	// Modifiers --------------------------------------------------------------------------------------------------------

	modifier onlyTimelock() {
		require(timelockAddress == msg.sender, "Only Timelock");
		_;
	}

	modifier onlyDefaultPoolOrStabilityPoolOrVesselManagerOperations() {
		require(
			msg.sender == defaultPool || msg.sender == stabilityPool || msg.sender == vesselManagerOperations,
			"ConvexStakingWrapper: Caller is not an authorized Gravita contract"
		);
		_;
	}

	// Upgrades ---------------------------------------------------------------------------------------------------------

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}

	// TEMP/DEBUG -------------------------------------------------------------------------------------------------------

	/**
	 * TEMPORARY formatting/debug/helper functions
	 * TODO remove for production deployment
	 */

	function addrToName(address anAddress) internal view returns (string memory) {
		if (anAddress == activePool) return "ActivePool";
		if (anAddress == collSurplusPool) return "CollSurplusPool";
		if (anAddress == defaultPool) return "DefaultPool";
		if (anAddress == stabilityPool) return "StabilityPool";
		return addrToStr(anAddress);
	}

	function addrToStr(address _addr) public pure returns (string memory) {
		bytes32 value = bytes32(uint256(uint160(_addr)));
		bytes memory alphabet = "0123456789abcdef";
		bytes memory str = new bytes(51);
		str[0] = "0";
		str[1] = "x";
		for (uint256 i = 0; i < 2; i++) {
			str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
			str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
		}
		return string(str);
	}

	function f(uint256 value) internal pure returns (string memory) {
		string memory sInput = Strings.toString(value);
		bytes memory bInput = bytes(sInput);
		uint256 len = bInput.length > 18 ? bInput.length + 1 : 20;
		string memory sResult = new string(len);
		bytes memory bResult = bytes(sResult);
		if (bInput.length <= 18) {
			bResult[0] = "0";
			bResult[1] = ".";
			for (uint256 i = 1; i <= 18 - bInput.length; i++) bResult[i + 1] = "0";
			for (uint256 i = bInput.length; i > 0; i--) bResult[--len] = bInput[i - 1];
		} else {
			uint256 c = 0;
			uint256 i = bInput.length;
			while (i > 0) {
				bResult[--len] = bInput[--i];
				if (++c == 18) bResult[--len] = ".";
			}
		}
		return string(bResult);
	}
}

