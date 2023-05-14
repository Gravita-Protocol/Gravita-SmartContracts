// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../GRVT/CommunityIssuance.sol";

import "@chainlink/contracts/src/v0.8/interfaces/FlagsInterface.sol";

contract ChainlinkFlagMock is FlagsInterface {
	bool private flag;

	function getFlag(address) external view override returns (bool) {
		return flag;
	}

	function setFlag(bool isRaised) external {
		flag = isRaised;
	}

	function getFlags(address[] calldata) external pure override returns (bool[] memory aa) {
		return aa;
	}

	function raiseFlag(address) external override {}

	function raiseFlags(address[] calldata) external override {}

	function lowerFlags(address[] calldata) external override {}

	function setRaisingAccessController(address) external override {}
}
