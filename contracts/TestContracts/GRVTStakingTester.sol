// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../GRVT/GRVTStaking.sol";

contract GRVTStakingTester is GRVTStaking {
	function requireCallerIsVesselManager() external view callerIsVesselManager {}
}
