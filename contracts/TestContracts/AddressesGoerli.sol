// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract AddressesGoerli is OwnableUpgradeable {
	address public activePool;
	address public adminContract;
	address public borrowerOperations;
	address public collSurplusPool;
	address public communityIssuance;
	address public debtToken;
	address public defaultPool;
	address public feeCollector;
	address public gasPoolAddress;
	address public grvtStaking;
	address public priceFeed;
	address public sortedVessels;
	address public stabilityPool;
	address public timelockAddress;
	address public treasuryAddress;
	address public vesselManager;
	address public vesselManagerOperations;

	bool public isAddressSetupInitialized;

	/**
	 * @dev This empty reserved space is put in place to allow future versions to add new
	 * variables without shifting down storage in the inheritance chain.
	 * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
	 */
	uint256[47] private __gap;

	// Dependency setters -----------------------------------------------------------------------------------------------

	function setAddresses(address[] calldata _addresses) external onlyOwner {
		require(!isAddressSetupInitialized, "Setup is already initialized");
		require(_addresses.length == 15, "Expected 15 addresses at setup");

		activePool = _addresses[0];
		adminContract = _addresses[1];
		borrowerOperations = _addresses[2];
		collSurplusPool = _addresses[3];
		debtToken = _addresses[4];
		defaultPool = _addresses[5];
		feeCollector = _addresses[6];
		gasPoolAddress = _addresses[7];
		priceFeed = _addresses[8];
		sortedVessels = _addresses[9];
		stabilityPool = _addresses[10];
		timelockAddress = _addresses[11];
		treasuryAddress = _addresses[12];
		vesselManager = _addresses[13];
		vesselManagerOperations = _addresses[14];

		isAddressSetupInitialized = true;
	}

	function setCommunityIssuance(address _communityIssuance) public onlyOwner {
		communityIssuance = _communityIssuance;
	}

	function setGRVTStaking(address _grvtStaking) public onlyOwner {
		grvtStaking = _grvtStaking;
	}
}

