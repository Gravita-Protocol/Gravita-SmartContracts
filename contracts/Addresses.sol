// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

contract Addresses {
	address public constant activePool = address(0);
	address public constant adminContract = address(0);
	address public constant borrowerOperations = address(0);
	address public constant collSurplusPool = address(0);
	address public constant communityIssuance = address(0);
	address public constant debtToken = address(0);
	address public constant defaultPool = address(0);
	address public constant feeCollector = address(0);
	address public constant gasPoolAddress = address(0);
	address public constant grvtStaking = address(0);
	address public constant priceFeed = address(0);
	address public constant sortedVessels = address(0);
	address public constant stabilityPool = address(0);
	address public constant timelockAddress = address(0);
	address public constant treasuryAddress = address(0);
	address public constant vesselManager = address(0);
	address public constant vesselManagerOperations = address(0);

	/**
	 * @dev This empty reserved space is put in place to allow future versions to add new
	 * variables without shifting down storage in the inheritance chain.
	 * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
	 */
	uint256[40] private __gap;

	// TEST SECTION - UNCOMMENT THIS TO RUN LOCAL TESTS SO WE CAN CHANGE THE DEPLOYED ADDRESSES
	// IActivePool public activePool;
	// IAdminContract public adminContract;
	// IBorrowerOperations public borrowerOperations;
	// ICollSurplusPool public collSurplusPool;
	// ICommunityIssuance public communityIssuance;
	// IDebtToken public debtToken;
	// IDefaultPool public defaultPool;
	// IFeeCollector public feeCollector;
	// address public gasPoolAddress;
	// IGRVTStaking public grvtStaking;
	// IPriceFeed public priceFeed;
	// ISortedVessels public sortedVessels;
	// IStabilityPool public stabilityPool;
	// address public timelockAddress;
	// address public treasuryAddress;
	// IVesselManager public vesselManager;
	// IVesselManagerOperations public vesselManagerOperations;

	// // Setter functions enabled only when running tests - requires contants to be regular variables
	// function setAdminContract(address _adminContract) public {
	// 	adminContract = IAdminContract(_adminContract);
	// }

	// function setBorrowerOperations(address _borrowerOperations) public {
	// 	borrowerOperations = IBorrowerOperations(_borrowerOperations);
	// }

	// function setVesselManager(address _vesselManager) public {
	// 	vesselManager = IVesselManager(_vesselManager);
	// }

	// function setVesselManagerOperations(address _vesselManagerOperations) public {
	// 	vesselManagerOperations = IVesselManagerOperations(_vesselManagerOperations);
	// }

	// function setTimelock(address _timelock) public {
	// 	timelockAddress = _timelock;
	// }

	// function setCommunityIssuance(address _communityIssuance) public {
	// 	communityIssuance = ICommunityIssuance(_communityIssuance);
	// }

	// function setActivePool(address _activePool) public {
	// 	activePool = IActivePool(_activePool);
	// }

	// function setDefaultPool(address _defaultPool) public {
	// 	defaultPool = IDefaultPool(_defaultPool);
	// }

	// function setStabilityPool(address _stabilityPool) public {
	// 	stabilityPool = IStabilityPool(_stabilityPool);
	// }

	// function setCollSurplusPool(address _collSurplusPool) public {
	// 	collSurplusPool = ICollSurplusPool(_collSurplusPool);
	// }

	// function setPriceFeed(address _priceFeed) public {
	// 	priceFeed = IPriceFeed(_priceFeed);
	// }

	// function setDebtToken(address _debtToken) public {
	// 	debtToken = IDebtToken(_debtToken);
	// }

	// function setGasPool(address _gasPool) public {
	// 	gasPoolAddress = _gasPool;
	// }

	// function setFeeCollector(address _feeCollector) public {
	// 	feeCollector = IFeeCollector(_feeCollector);
	// }

	// function setSortedVessels(address _sortedVessels) public {
	// 	sortedVessels = ISortedVessels(_sortedVessels);
	// }

	// function setTreasury(address _treasuryAddress) public {
	// 	treasuryAddress = _treasuryAddress;
	// }

	// function setGRVTStaking(address _grvtStaking) public {
	// 	grvtStaking = IGRVTStaking(_grvtStaking);
	// }
}
