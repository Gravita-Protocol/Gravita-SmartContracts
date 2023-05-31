// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

abstract contract AddressesHardhat {
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

	// Setter functions enabled only when running tests - requires contants to be regular variables
	function setAdminContract(address _adminContract) public {
		adminContract = _adminContract;
	}

	function setBorrowerOperations(address _borrowerOperations) public {
		borrowerOperations = _borrowerOperations;
	}

	function setVesselManager(address _vesselManager) public {
		vesselManager = _vesselManager;
	}

	function setVesselManagerOperations(address _vesselManagerOperations) public {
		vesselManagerOperations = _vesselManagerOperations;
	}

	function setTimelock(address _timelock) public {
		timelockAddress = _timelock;
	}

	function setCommunityIssuance(address _communityIssuance) public {
		communityIssuance = _communityIssuance;
	}

	function setActivePool(address _activePool) public {
		activePool = _activePool;
	}

	function setDefaultPool(address _defaultPool) public {
		defaultPool = _defaultPool;
	}

	function setStabilityPool(address _stabilityPool) public {
		stabilityPool = _stabilityPool;
	}

	function setCollSurplusPool(address _collSurplusPool) public {
		collSurplusPool = _collSurplusPool;
	}

	function setPriceFeed(address _priceFeed) public {
		priceFeed = _priceFeed;
	}

	function setDebtToken(address _debtToken) public {
		debtToken = _debtToken;
	}

	function setGasPool(address _gasPool) public {
		gasPoolAddress = _gasPool;
	}

	function setFeeCollector(address _feeCollector) public {
		feeCollector = _feeCollector;
	}

	function setSortedVessels(address _sortedVessels) public {
		sortedVessels = _sortedVessels;
	}

	function setTreasury(address _treasuryAddress) public {
		treasuryAddress = _treasuryAddress;
	}

	function setGRVTStaking(address _grvtStaking) public {
		grvtStaking = _grvtStaking;
	}
}

