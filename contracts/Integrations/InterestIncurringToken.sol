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
import "hardhat/console.sol";

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
	uint256 public constant MAX_INTEREST_RATE_IN_BPS = 5000; // 50%

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

	function setInterestReceiverAddress(address _interestReceiverAddress) external onlyOwner {
		_setInterestReceiverAddress(_interestReceiverAddress);
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

	function _setInterestReceiverAddress(address _interestReceiverAddress) internal {
		require(_interestReceiverAddress != address(0), "Invalid interest receiver address");
		interestReceiverAddress = _interestReceiverAddress;
		emit InterestReceiverAddressUpdated(_interestReceiverAddress);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Public functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	/**
	 * @notice Updates the payable accrued interest amount since the last interest calculation.
	 */
	function accountForInterestDue() public {
		uint256 _lastInterestPayoutTimestamp = lastInterestPayoutTimestamp;
		if (_lastInterestPayoutTimestamp != block.timestamp) {
			uint256 _payableInterestAmount = payableInterestAmount;
			uint256 _netTotalAssets = ERC20(asset()).balanceOf(address(this)) - _payableInterestAmount;
			payableInterestAmount = _payableInterestAmount + _calcInterestDue(_netTotalAssets, _lastInterestPayoutTimestamp);
			lastInterestPayoutTimestamp = block.timestamp;
		}
	}

	/**
	 * @notice Calculates accrued interest since the last payment and transfers the resulting amount to a previously
	 *         defined destination address.
	 */
	function collectInterest() external nonReentrant {
		accountForInterestDue();
		uint256 _payableInterestAmount = payableInterestAmount;
		require(_payableInterestAmount > 0, "Nothing to collect");
		IERC20Upgradeable(asset()).safeTransfer(interestReceiverAddress, _payableInterestAmount);
		payableInterestAmount = 0;
		lastInterestPayoutTimestamp = block.timestamp;
		emit InterestCollected(_payableInterestAmount);
	}

	/// @inheritdoc IERC4626
	function deposit(uint256 _assets, address _receiver) public override nonReentrant returns (uint256) {
		require(_assets > 0, "Deposit amount must be greater than 0");
		accountForInterestDue();
		return ERC4626.deposit(_assets, _receiver);
	}

	/// @inheritdoc IERC4626
	function mint(uint256 _shares, address _receiver) public override nonReentrant returns (uint256) {
		require(_shares > 0, "Mint amount must be greater than 0");
		accountForInterestDue();
		return ERC4626.mint(_shares, _receiver);
	}

	/// @inheritdoc IERC4626
	function redeem(uint256 _shares, address _receiver, address _owner) public override nonReentrant returns (uint256) {
		require(_shares > 0, "Redemption amount must be greater than 0");
		accountForInterestDue();
		return ERC4626.redeem(_shares, _receiver, _owner);
	}

	/// @inheritdoc IERC4626
	function withdraw(uint256 _assets, address _receiver, address _owner) public override nonReentrant returns (uint256) {
		require(_assets > 0, "Withdrawal amount must be greater than 0");
		accountForInterestDue();
		return ERC4626.withdraw(_assets, _receiver, _owner);
	}

	/**
	 * @notice Returns the net available assets in the vault, accounting for the accrued interest amount.
	 */
	function totalAssets() public view override returns (uint256 _netTotalAssets) {
		uint256 _payableInterestAmount = payableInterestAmount;
		_netTotalAssets = ERC20(asset()).balanceOf(address(this)) - _payableInterestAmount;
		uint256 _lastInterestPayoutTimestamp = lastInterestPayoutTimestamp;
		if (_lastInterestPayoutTimestamp != block.timestamp) {
			_netTotalAssets -= _calcInterestDue(_netTotalAssets, _lastInterestPayoutTimestamp);
		}
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Internal/helper functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function _calcInterestDue(uint256 _amount, uint256 _lastInterestPayoutTimestamp) internal view returns (uint256) {
		uint256 _interestFactor = interestRatePerSecond * (block.timestamp - _lastInterestPayoutTimestamp);
		return Math.mulDiv(_amount, _interestFactor, INTEREST_RATE_PRECISION);
	}

	/// @dev This function is necessary for the compiler to resolve dual-inheritance determinism.
	function _msgSender() internal view override(Context, ContextUpgradeable) returns (address) {
		return msg.sender;
	}

	/// @dev This function is necessary for the compiler to resolve dual-inheritance determinism.
	function _msgData() internal pure override(Context, ContextUpgradeable) returns (bytes calldata) {
		return msg.data;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Upgrade functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	function authorizeUpgrade(address _newImplementation) public {
		_authorizeUpgrade(_newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
