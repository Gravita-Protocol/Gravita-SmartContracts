// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Storage.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "./Dependencies/External/OpenZeppelin5/ERC4626.sol";
import "./Interfaces/IFeeCollector.sol";
import "./Interfaces/IInterestIncurringTokenizedVault.sol";

/**
 * @notice This is an ERC-4626 (Tokenized Vault) specialized contract that charges an ongoing interest rate on the
 *         underlying deposited asset. The accruing payable interest amount is recalculated whenever the vault balance
 *         changes (upon each deposit/withdrawal) and can be collected at any time to a predefined destination address.
 */
contract InterestIncurringTokenizedVault is
	IInterestIncurringTokenizedVault,
	OwnableUpgradeable,
	UUPSUpgradeable,
	ReentrancyGuardUpgradeable,
	ERC4626,
	ERC165Storage
{
	using SafeERC20Upgradeable for IERC20Upgradeable;
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Events
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	event InterestCollected(uint256 amount);
	event InterestRateUpdated(uint256 newInterestRateInBPS);
	event InterestReceiverAddressUpdated(address newInterestReceiver);

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Custom errors
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	error InterestOutOfBoundsError();
	error ZeroAmountError();

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Constants & immutables
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	uint256 public constant MIN_INTEREST_RATE_IN_BPS = 50; // 0,5%
	uint256 public constant MAX_INTEREST_RATE_IN_BPS = 500; // 5%
	uint256 private constant BASIS_POINTS_DIVISOR = 10_000;
	uint256 private constant INTEREST_RATE_PRECISION = 1e27;
	uint256 private constant SECONDS_IN_ONE_YEAR = 365 days;

	/**
	 * @dev On L2s (where gas is cheaper), interest collection will be triggered if a timeout has been surpassed.
	 *      On mainnet, this parameter should be set to zero to avoid imposing that cost on the user.
	 */
	uint256 public immutable INTEREST_AUTO_TRANSFER_TIMEOUT;
	address public immutable FEE_COLLECTOR_ADDRESS;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// State
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	uint256 public interestRatePerSecond;
	uint256 public payableInterestAmount;
	uint256 public lastInterestAmountUpdateTimestamp;
	uint256 public lastInterestPayoutTimestamp;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Initializer & setup functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	constructor(
		ERC20 _underlyingToken,
		string memory _newTokenName,
		string memory _newTokenSymbol,
		address _feeCollectorAddress,
		uint256 _interestRateInBPS,
		uint256 _interestAutoTransferTimeout
	) ERC20(_newTokenName, _newTokenSymbol) ERC4626(_underlyingToken) {
		require(address(_underlyingToken) != address(0), "Invalid token address");
		require(address(_feeCollectorAddress) != address(0), "Invalid FeeCollector address");
		FEE_COLLECTOR_ADDRESS = _feeCollectorAddress;
		INTEREST_AUTO_TRANSFER_TIMEOUT = _interestAutoTransferTimeout;
		lastInterestAmountUpdateTimestamp = block.timestamp;
		lastInterestPayoutTimestamp = block.timestamp;
		_setInterestRate(_interestRateInBPS);
		/// @dev ERC-165 interface is used by ActivePool to check if unwrapping is needed
		_registerInterface(type(IInterestIncurringTokenizedVault).interfaceId);
		_underlyingToken.approve(FEE_COLLECTOR_ADDRESS, type(uint256).max);
	}

	/**
	 * @dev Initialization using `deployProxy` happens at the same time the proxy is created, therefore, there's no
	 *      risk of front-running.
	 */
	function initialize() public initializer {
		__Ownable_init();
	}

	function setInterestRate(uint256 _interestRateInBPS) external override onlyOwner {
		_setInterestRate(_interestRateInBPS);
	}

	function _setInterestRate(uint256 _interestRateInBPS) internal {
		if (_interestRateInBPS < MIN_INTEREST_RATE_IN_BPS || _interestRateInBPS > MAX_INTEREST_RATE_IN_BPS) {
			revert InterestOutOfBoundsError();
		}
		uint256 newInterestRatePerSecond = (INTEREST_RATE_PRECISION * _interestRateInBPS) /
			(SECONDS_IN_ONE_YEAR * BASIS_POINTS_DIVISOR);
		if (newInterestRatePerSecond != interestRatePerSecond) {
			interestRatePerSecond = newInterestRatePerSecond;
			emit InterestRateUpdated(_interestRateInBPS);
		}
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Public functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	/**
	 * @notice Calculates accrued interest since the last payment and triggers the FeeCollector contract for 
	           collecting (transferring) the resulting amount.
	 */
	function collectInterest() public override {
		_accountForInterestDue();
		uint256 _payableInterestAmount = payableInterestAmount;
		if (_payableInterestAmount == 0) {
			revert ZeroAmountError();
		}
		payableInterestAmount = 0;
		lastInterestPayoutTimestamp = block.timestamp;
		IFeeCollector(FEE_COLLECTOR_ADDRESS).transferInterestRate(asset(), _payableInterestAmount);
		emit InterestCollected(_payableInterestAmount);
	}

	/**
	 * @notice Returns the interest amount available for collection.
	 */
	function getCollectableInterest() external view override returns (uint256) {
		uint256 _netTotalAssets = ERC20(asset()).balanceOf(address(this)) - payableInterestAmount;
		return payableInterestAmount + _calcInterestDue(_netTotalAssets, lastInterestAmountUpdateTimestamp);
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Public ERC-4626 overriden functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	/// @inheritdoc IERC4626
	function deposit(
		uint256 _assets,
		address _receiver
	) public override(ERC4626, IERC4626) nonReentrant returns (uint256) {
		if (_assets == 0) {
			revert ZeroAmountError();
		}
		_accountForInterestDue();
		_triggerAutoTransferInterest();
		return ERC4626.deposit(_assets, _receiver);
	}

	/// @inheritdoc IERC4626
	function mint(uint256 _shares, address _receiver) public override(ERC4626, IERC4626) nonReentrant returns (uint256) {
		if (_shares == 0) {
			revert ZeroAmountError();
		}
		_accountForInterestDue();
		_triggerAutoTransferInterest();
		return ERC4626.mint(_shares, _receiver);
	}

	/// @inheritdoc IERC4626
	function redeem(
		uint256 _shares,
		address _receiver,
		address _owner
	) public override(ERC4626, IERC4626) nonReentrant returns (uint256) {
		if (_shares == 0) {
			revert ZeroAmountError();
		}
		_accountForInterestDue();
		_triggerAutoTransferInterest();
		return ERC4626.redeem(_shares, _receiver, _owner);
	}

	/// @inheritdoc IERC4626
	function withdraw(
		uint256 _assets,
		address _receiver,
		address _owner
	) public override(ERC4626, IERC4626) nonReentrant returns (uint256) {
		if (_assets == 0) {
			revert ZeroAmountError();
		}
		_accountForInterestDue();
		_triggerAutoTransferInterest();
		return ERC4626.withdraw(_assets, _receiver, _owner);
	}

	/**
	 * @inheritdoc IERC4626
	 * @notice Returns the net available assets in the vault, accounting for the accrued interest amount.
	 */
	function totalAssets() public view override(ERC4626, IERC4626) returns (uint256 _netTotalAssets) {
		uint256 _payableInterestAmount = payableInterestAmount;
		_netTotalAssets = ERC20(asset()).balanceOf(address(this)) - _payableInterestAmount;
		uint256 _lastInterestAmountUpdateTimestamp = lastInterestAmountUpdateTimestamp;
		if (_lastInterestAmountUpdateTimestamp != block.timestamp) {
			_netTotalAssets -= _calcInterestDue(_netTotalAssets, _lastInterestAmountUpdateTimestamp);
		}
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Internal/helper functions
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	/**
	 * @notice Updates the amount of accrued interest payable since the last interest calculation.
	 */
	function _accountForInterestDue() internal {
		uint256 _lastInterestAmountUpdateTimestamp = lastInterestAmountUpdateTimestamp;
		if (_lastInterestAmountUpdateTimestamp != block.timestamp) {
			uint256 _payableInterestAmount = payableInterestAmount;
			uint256 _netTotalAssets = ERC20(asset()).balanceOf(address(this)) - _payableInterestAmount;
			payableInterestAmount =
				_payableInterestAmount +
				_calcInterestDue(_netTotalAssets, _lastInterestAmountUpdateTimestamp);
			lastInterestAmountUpdateTimestamp = block.timestamp;
		}
	}

	function _calcInterestDue(
		uint256 _amount,
		uint256 _lastInterestAmountUpdateTimestamp
	) internal view returns (uint256) {
		uint256 _interestFactor = interestRatePerSecond * (block.timestamp - _lastInterestAmountUpdateTimestamp);
		return Math.mulDiv(_amount, _interestFactor, INTEREST_RATE_PRECISION);
	}

	/**
	 * @notice Pays out the accumulated interest if a timeout has elapsed.
	 */
	function _triggerAutoTransferInterest() internal {
		if (INTEREST_AUTO_TRANSFER_TIMEOUT != 0) {
			if (block.timestamp - lastInterestPayoutTimestamp > INTEREST_AUTO_TRANSFER_TIMEOUT) {
				collectInterest();
			}
		}
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

