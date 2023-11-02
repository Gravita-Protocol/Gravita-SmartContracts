// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

pragma abicoder v2;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "../Dependencies/External/OpenZeppelin5/ERC4626.sol";

/**
 * @notice This is an ERC-4626 (Tokenized Vault) specialized contract that charges an ongoing interest rate on the 
 *         underlying deposited asset. The accruing payable interest amount is recalculated whenever the vault balance 
 *         changes (upon each deposit/withdrawal) and can be collected at any time to a predefined destination address.
 */
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
			accountForInterestDue();
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

	function depositAssets(uint256 _assets) external nonReentrant {
		require(_assets > 0, "Deposit amount must be greater than 0");
		accountForInterestDue();
		ERC4626.deposit(_assets, msg.sender);
	}

	function withdrawShares(uint256 _shares) external nonReentrant {
		require(_shares > 0, "Withdrawal amount must be greater than 0");
		accountForInterestDue();
		ERC4626.redeem(_shares, msg.sender, msg.sender);
	}

	function accountForInterestDue() public {
		uint256 _lastInterestPayoutTimestamp = lastInterestPayoutTimestamp;
		if (_lastInterestPayoutTimestamp == block.timestamp) {
			return;
		}
		uint256 _interestRatePerSecond = interestRatePerSecond;
		uint256 _interestFactor = _interestRatePerSecond * (block.timestamp - _lastInterestPayoutTimestamp);
		uint256 _interestDue = Math.mulDiv(totalAssets(), _interestFactor, INTEREST_RATE_PRECISION);
		payableInterestAmount += _interestDue;
		lastInterestPayoutTimestamp = block.timestamp;
	}

	function collectInterest() external nonReentrant {
		accountForInterestDue();
		uint256 payableInterestAmountCached = payableInterestAmount;
		require(payableInterestAmountCached > 0, "Nothing to collect");
		IERC20Upgradeable(asset()).safeTransfer(interestReceiverAddress, payableInterestAmountCached);
		payableInterestAmount = 0;
		lastInterestPayoutTimestamp = block.timestamp;
		emit InterestCollected(payableInterestAmountCached);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// ERC4626 overriden functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	/**
	 * Returns the net available assets in the vault, accounting for the accrued interest amount.
	 * @dev The pending payable interest amount can become outdated; for increased precision, calling 
	 *      `accountForInterestDue()` is necessary beforehand. 
	 */
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
