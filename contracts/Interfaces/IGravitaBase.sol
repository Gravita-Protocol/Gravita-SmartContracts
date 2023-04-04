// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "./IAdminContract.sol";

interface IGravitaBase {
	function adminContract() external view returns (IAdminContract);
}
