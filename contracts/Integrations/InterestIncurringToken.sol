// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "../Dependencies/External/OpenZeppelin5/ERC4626.sol";

contract InterestIncurringToken is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable, ERC4626 {
	using SafeERC20Upgradeable for IERC20Upgradeable;
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Events
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	event InterestCollected(uint256 amount);
	event InterestRateUpdated(uint256 newInterestRateInBPS);
	event InterestReceiverAddressUpdated(address newInterestReceiver);

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Constants
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	uint256 constant INTEREST_RATE_PRECISION = 1e27;
	uint256 constant SECONDS_IN_ONE_YEAR = 365 days;
	uint256 public constant MIN_INTEREST_RATE_IN_BPS = 50; // 0,5%
	uint256 public constant MAX_INTEREST_RATE_IN_BPS = 500; // 5%

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// State
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	address public interestReceiverAddress;
	uint256 public interestRatePerSecond;
	uint256 public payableInterestAmount;
	uint256 public lastInterestPayoutTimestamp;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Initializer & setup functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	constructor(
		ERC20 _underlyingToken,
		string memory _newTokenName,
		string memory _newTokenSymbol,
		address _interestReceiverAddress,
		uint256 _interestRateInBPS
	) ERC20(_newTokenName, _newTokenSymbol) ERC4626(_underlyingToken) {
		require(address(_underlyingToken) != address(0), "Invalid token address");
		lastInterestPayoutTimestamp = block.timestamp;
		_setInterestReceiverAddress(_interestReceiverAddress);
		_setInterestRate(_interestRateInBPS);
	}

	/**
	 * @dev Initialization using `deployProxy` happens at the same time the proxy is created, therefore, there's no
	 *      risk of front-running.
	 */
	function initialize() public initializer {
		__Ownable_init();
	}

	function setInterestRate(uint256 _interestRateInBPS) external onlyOwner {
		_setInterestRate(_interestRateInBPS);
	}

	function _setInterestRate(uint256 _interestRateInBPS) internal {
		require(_interestRateInBPS >= MIN_INTEREST_RATE_IN_BPS, "Interest < Minimum");
		require(_interestRateInBPS <= MAX_INTEREST_RATE_IN_BPS, "Interest > Maximum");
		uint256 newInterestRatePerSecond = (INTEREST_RATE_PRECISION * _interestRateInBPS) / (10_000 * SECONDS_IN_ONE_YEAR);
		if (newInterestRatePerSecond != interestRatePerSecond) {
			_accountForInterestDue();
			interestRatePerSecond = newInterestRatePerSecond;
			emit InterestRateUpdated(_interestRateInBPS);
		}
	}

	function setInterestReceiverAddress(address _interestReceiverAddress) external onlyOwner {
		_setInterestReceiverAddress(_interestReceiverAddress);
	}

	function _setInterestReceiverAddress(address _interestReceiverAddress) internal {
		require(_interestReceiverAddress != address(0), "Invalid interest receiver address");
		interestReceiverAddress = _interestReceiverAddress;
		emit InterestReceiverAddressUpdated(_interestReceiverAddress);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Public functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function depositAssets(uint256 assets) external nonReentrant {
		require(assets > 0, "Deposit amount must be greater than 0");
		_accountForInterestDue();
		ERC4626.deposit(assets, msg.sender);
	}

	function withdrawShares(uint256 shares) external nonReentrant {
		require(shares > 0, "Withdrawal amount must be greater than 0");
		_accountForInterestDue();
		ERC4626.redeem(shares, msg.sender, msg.sender);
	}

	function collectInterest() external nonReentrant {
		_accountForInterestDue();
		uint256 payableInterestAmountCached = payableInterestAmount;
		require(payableInterestAmountCached > 0, "Nothing to collect");
		IERC20Upgradeable(asset()).safeTransfer(interestReceiverAddress, payableInterestAmountCached);
		payableInterestAmount = 0;
		lastInterestPayoutTimestamp = block.timestamp;
		emit InterestCollected(payableInterestAmountCached);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Private/helper functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function _accountForInterestDue() internal {
		uint256 lastInterestPayoutTimestampCached = lastInterestPayoutTimestamp;
		if (lastInterestPayoutTimestampCached == block.timestamp) {
			return;
		}
		uint256 interestRatePerSecondCached = interestRatePerSecond;
		uint256 interestFactor = interestRatePerSecondCached * (block.timestamp - lastInterestPayoutTimestampCached);
		uint256 interestDue = Math.mulDiv(totalAssets(), interestFactor, INTEREST_RATE_PRECISION);
		payableInterestAmount += interestDue;
		lastInterestPayoutTimestamp = block.timestamp;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// ERC4626 overriden functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function totalAssets() public view override returns (uint256) {
		return ERC20(asset()).balanceOf(address(this)) - payableInterestAmount;
	}

	function redeem(uint256, address, address) public pure override returns (uint256) {
		revert("Not implemented");
	}

	function withdraw(uint256, address, address) public pure override returns (uint256) {
		revert("Not implemented");
	}

	function mint(uint256, address) public pure override returns (uint256) {
		revert("Not implemented");
	}

	function deposit(uint256, address) public pure override returns (uint256) {
		revert("Not implemented");
	}

	function _msgSender() internal view override(Context, ContextUpgradeable) returns (address) {
		return msg.sender;
	}

	function _msgData() internal pure override(Context, ContextUpgradeable) returns (bytes calldata) {
		return msg.data;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Upgrade functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
