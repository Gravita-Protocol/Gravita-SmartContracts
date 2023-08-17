// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Interfaces/IDebtToken.sol";

contract CanonicalToL0 is Ownable {
	string public constant NAME = "CanonicalToL0";

	address public immutable canonicalAddress;
	address public immutable debtToken;
	address public immutable treasury;
	uint256 public fee;
	uint256 public constant PRECISION = 10000;

	event NewSwap(address indexed user, uint256 amount, uint256 fee);
	event FeeChanged(uint256 fee);

	error InvalidAddress();
	error InvalidFee();

	constructor(address _canonicalAddress, address _debtToken, address _treasury, uint256 _fee) {
		require(_canonicalAddress != address(0) && _debtToken != address(0) && _treasury != address(0));
		canonicalAddress = _canonicalAddress;
		debtToken = _debtToken;
		treasury = _treasury;
		setFee(_fee);
	}

	function swapCanonicalToL0(uint256 _amount) public {
		require(_amount > 0);
		IERC20(canonicalAddress).transferFrom(msg.sender, address(this), _amount);

		IDebtToken(debtToken).mintFromWhitelistedContract(_amount);
		uint256 feeAmount = (_amount * fee) / PRECISION;
		IDebtToken(debtToken).transfer(treasury, feeAmount);
		IDebtToken(debtToken).transfer(msg.sender, _amount - feeAmount);
		emit NewSwap(msg.sender, _amount, fee);
	}

	function setFee(uint256 _fee) public onlyOwner {
		if (_fee > 10000) {
			revert InvalidFee();
		}
		fee = _fee;
		emit FeeChanged(_fee);
	}
}
