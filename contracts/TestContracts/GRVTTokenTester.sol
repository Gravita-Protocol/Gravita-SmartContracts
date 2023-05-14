// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../GRVT/GRVTToken.sol";

contract GRVTTokenTester is GRVTToken {
	constructor(address _treasury) GRVTToken(_treasury) {}

	function unprotectedMint(address account, uint256 amount) external {
		// No check for the caller here

		_mint(account, amount);
	}

	function unprotectedTransferFrom(
		address _sender,
		address _receiver,
		uint256 _amount
	) external {
		_transfer(_sender, _receiver, _amount);
	}

	function callInternalApprove(
		address owner,
		address spender,
		uint256 amount
	) external {
		_approve(owner, spender, amount);
	}

	function callInternalTransfer(
		address sender,
		address recipient,
		uint256 amount
	) external {
		_transfer(sender, recipient, amount);
	}

	function getChainId() external view returns (uint256 chainID) {
		assembly {
			chainID := chainid()
		}
	}
}
