// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../Interfaces/IGRVTStaking.sol";

contract GRVTStakingScript {
	IGRVTStaking immutable grvtStaking;

	constructor(address _GRVTStakingAddress) {
		grvtStaking = IGRVTStaking(_GRVTStakingAddress);
	}

	function stake(uint256 _GRVTamount) external {
		IGRVTStaking(grvtStaking).stake(_GRVTamount);
	}
}
