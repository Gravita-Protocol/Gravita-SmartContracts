// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./Interfaces/IDebtToken.sol";
import { IPool } from "lib/aave-v3-core/contracts/interfaces/IPool.sol";

import "./Dependencies/SafetyTransfer.sol";
import "./Addresses.sol";

contract LUSDPSM is UUPSUpgradeable, OwnableUpgradeable, Addresses, ReentrancyGuardUpgradeable {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "LUSDPSM";

	uint256 public buyFee;
	uint256 public sellFee;
	uint256 public constant DECIMAL_PRECISION = 1 ether;
	address public immutable lusd;
	IPool public immutable aavePool;

	event BuyLUSD(address indexed user, uint256 amount, uint256 fee);
	event SellLUSD(address indexed user, uint256 amount, uint256 fee);
	event NewBuyFee(uint256 fee);
	event NewSellFee(uint256 fee);

	constructor(address _lusd, address _pool) {
		lusd = _lusd;
		aavePool = IPool(_pool);
	}

	// --- Initializer ---
	function initialize() public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
		__ReentrancyGuard_init();
	}

	function sellLUSD(uint256 _lusdAmount) public nonReentrant {
		uint256 fee = (_lusdAmount * sellFee) / DECIMAL_PRECISION;
		uint256 graiAmount = _lusdAmount - fee;
		IERC20Upgradeable(lusd).transferFrom(msg.sender, address(this), _lusdAmount);
		aavePool.supply(lusd, _lusdAmount, address(this), 0);

		IDebtToken(debtToken).mintFromWhitelistedContract(graiAmount);
		IERC20Upgradeable(debtToken).safeTransferFrom(address(this), msg.sender, graiAmount);
		emit SellLUSD(msg.sender, _lusdAmount, fee);
	}

	function buyLUSD(uint256 _lusdAmount) public nonReentrant {
		uint256 fee = (_lusdAmount * buyFee) / DECIMAL_PRECISION;
		uint256 graiAmount = _lusdAmount + fee;
		IERC20Upgradeable(debtToken).transferFrom(msg.sender, address(this), graiAmount);
		IERC20Upgradeable(debtToken).transfer(treasuryAddress, fee);
		IDebtToken(debtToken).burnFromWhitelistedContract(graiAmount - fee);
		aavePool.withdraw(lusd, _lusdAmount, msg.sender);
		emit BuyLUSD(msg.sender, _lusdAmount, fee);
	}

	function setBuyFee(uint256 _fee) public onlyOwner {
		buyFee = _fee;
		emit NewBuyFee(_fee);
	}

	function setSellFee(uint256 _fee) public onlyOwner {
		sellFee = _fee;
		emit NewSellFee(_fee);
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
