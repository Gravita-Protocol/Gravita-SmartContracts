// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../GRVT/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {

	function obtainGRVT(uint256 _amount) external {
		grvtToken.transfer(msg.sender, _amount);
	}

	function getLastUpdateTokenDistribution() external view returns (uint256) {
		return _getLastUpdateTokenDistribution();
	}

	function unprotectedIssueGRVT() external returns (uint256) {
		return issueGRVT();
	}
}
