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

contract LusdPsm is UUPSUpgradeable, OwnableUpgradeable, Addresses, ReentrancyGuardUpgradeable {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "LusdPsm";

	uint256 public buyFee;
	uint256 public sellFee;
	uint256 public constant DECIMAL_PRECISION = 1 ether;
	address public immutable lusd;
	IPool public immutable aavePool;

	event BuyLUSD(address indexed user, uint256 amount, uint256 fee);
	event SellLUSD(address indexed user, uint256 amount, uint256 fee);
	event BuyFeeChanged(uint256 fee);
	event SellFeeChanged(uint256 fee);

	error LusdPsm__InvalidAddress();
	error LusdPsm__InvalidAmount();

	constructor(address _lusd, address _pool) {
		if (_lusd == address(0) || _pool == address(0)) {
			revert LusdPsm__InvalidAddress();
		}
		lusd = _lusd;
		aavePool = IPool(_pool);
	}

	// --- Initializer ---
	function initialize(uint256 _buyFee, uint256 _sellFee) public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
		__ReentrancyGuard_init();

		buyFee = _buyFee;
		sellFee = _sellFee;
	}

	function sellLUSD(uint256 _lusdAmount) public nonReentrant {
		if (_lusdAmount == 0) {
			revert LusdPsm__InvalidAmount();
		}
		uint256 feeAmount = (_lusdAmount * sellFee) / DECIMAL_PRECISION;
		uint256 graiAmount = _lusdAmount - feeAmount;
		IERC20Upgradeable(lusd).transferFrom(msg.sender, address(this), _lusdAmount);
		IERC20Upgradeable(lusd).transfer(treasuryAddress, feeAmount);
		aavePool.supply(lusd, _lusdAmount, address(this), 0);

		IDebtToken(debtToken).mintFromWhitelistedContract(graiAmount);
		IERC20Upgradeable(debtToken).safeTransferFrom(address(this), msg.sender, graiAmount);
		emit SellLUSD(msg.sender, _lusdAmount, feeAmount);
	}

	function buyLUSD(uint256 _lusdAmount) public nonReentrant {
		if (_lusdAmount == 0) {
			revert LusdPsm__InvalidAmount();
		}
		uint256 feeAmount = (_lusdAmount * buyFee) / DECIMAL_PRECISION;
		uint256 graiAmount = _lusdAmount + feeAmount;
		IERC20Upgradeable(debtToken).transferFrom(msg.sender, address(this), graiAmount);
		IERC20Upgradeable(debtToken).transfer(treasuryAddress, feeAmount);
		IDebtToken(debtToken).burnFromWhitelistedContract(_lusdAmount);
		aavePool.withdraw(lusd, _lusdAmount, msg.sender);
		emit BuyLUSD(msg.sender, _lusdAmount, feeAmount);
	}

	function setBuyFee(uint256 _fee) public onlyOwner {
		buyFee = _fee;
		emit BuyFeeChanged(_fee);
	}

	function setSellFee(uint256 _fee) public onlyOwner {
		sellFee = _fee;
		emit SellFeeChanged(_fee);
	}

	function withdrawExcessFromDeposits(uint256 _amount) public onlyOwner {
		aavePool.withdraw(lusd, _amount, treasuryAddress);
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
