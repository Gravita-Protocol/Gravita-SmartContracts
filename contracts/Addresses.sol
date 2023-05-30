// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

contract Addresses { 
	
	// GOERLI ADDRESSES:
	address public constant activePool = 0xebEf95afe5Eae9357Ec0437B6D975feeeFb62424;
	address public constant adminContract = 0xC57C351D75Be3fC813Ab0c16C64fABCb48d30feE;
	address public constant borrowerOperations = 0x4d07cF667703594f6119b6a0041F293Ae9855656;
	address public constant collSurplusPool = 0x98Cff4846B9AFBa9148D772fdF04eFF85a78d566;
	address public constant communityIssuance = address(0);
	address public constant debtToken = 0x78076562e30Fd49c70C4E91f65644d15C32C1839;
	address public constant defaultPool = 0x7226921302D74880B76Bf821fA0619e28848B16f;
	address public constant feeCollector = 0xDc335F154df3B148cc67aDFC781deE49AE596f23;
	address public constant gasPoolAddress = 0x16A64C92295Fa16C77C7E3eE5728f9e933ed665e;
	address public constant grvtStaking = address(0);
	address public constant priceFeed = 0x655D09c912248fa6fE55657633BA4B92a1F9be1F;
	address public constant sortedVessels = 0x45Db46cd2704d0f4092c34318a5C16cfD98219B7;
	address public constant stabilityPool = 0x49387C88Fb723499a9A40DFbb266FAB8028c7e57;
	address public constant timelockAddress = 0xFB04d429e1826cf0B0068F4fbA7992b42a7Acf93;
	address public constant treasuryAddress = 0x6F8Fe995422c5efE6487A7B07f67E84aaD9D4eC8;
	address public constant vesselManager = 0x39f9b9deb817867d573c2FABA70914335a408466;
	address public constant vesselManagerOperations = 0x4135F28DF5e1EFb4bC73D5462C5Bc199203387D9;

	/**
	 * @dev This empty reserved space is put in place to allow future versions to add new
	 * variables without shifting down storage in the inheritance chain.
	 * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
	 */
	uint256[47] private __gap;

	// TEST SECTION - UNCOMMENT THIS TO RUN LOCAL TESTS SO WE CAN CHANGE THE DEPLOYED ADDRESSES
	// address public activePool;
	// address public adminContract;
	// address public borrowerOperations;
	// address public collSurplusPool;
	// address public communityIssuance;
	// address public debtToken;
	// address public defaultPool;
	// address public feeCollector;
	// address public gasPoolAddress;
	// address public grvtStaking;
	// address public priceFeed;
	// address public sortedVessels;
	// address public stabilityPool;
	// address public timelockAddress;
	// address public treasuryAddress;
	// address public vesselManager;
	// address public vesselManagerOperations;

	// // Setter functions enabled only when running tests - requires contants to be regular variables
	// function setAdminContract(address _adminContract) public {
	// 	adminContract = _adminContract;
	// }

	// function setBorrowerOperations(address _borrowerOperations) public {
	// 	borrowerOperations = _borrowerOperations;
	// }

	// function setVesselManager(address _vesselManager) public {
	// 	vesselManager = _vesselManager;
	// }

	// function setVesselManagerOperations(address _vesselManagerOperations) public {
	// 	vesselManagerOperations = _vesselManagerOperations;
	// }

	// function setTimelock(address _timelock) public {
	// 	timelockAddress = _timelock;
	// }

	// function setCommunityIssuance(address _communityIssuance) public {
	// 	communityIssuance = _communityIssuance;
	// }

	// function setActivePool(address _activePool) public {
	// 	activePool = _activePool;
	// }

	// function setDefaultPool(address _defaultPool) public {
	// 	defaultPool = _defaultPool;
	// }

	// function setStabilityPool(address _stabilityPool) public {
	// 	stabilityPool = _stabilityPool;
	// }

	// function setCollSurplusPool(address _collSurplusPool) public {
	// 	collSurplusPool = _collSurplusPool;
	// }

	// function setPriceFeed(address _priceFeed) public {
	// 	priceFeed = _priceFeed;
	// }

	// function setDebtToken(address _debtToken) public {
	// 	debtToken = _debtToken;
	// }

	// function setGasPool(address _gasPool) public {
	// 	gasPoolAddress = _gasPool;
	// }

	// function setFeeCollector(address _feeCollector) public {
	// 	feeCollector = _feeCollector;
	// }

	// function setSortedVessels(address _sortedVessels) public {
	// 	sortedVessels = _sortedVessels;
	// }

	// function setTreasury(address _treasuryAddress) public {
	// 	treasuryAddress = _treasuryAddress;
	// }

	// function setGRVTStaking(address _grvtStaking) public {
	// 	grvtStaking = _grvtStaking;
	// }
}
