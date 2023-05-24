// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

contract Addresses {
	address public constant activePool = 0x2b0024ecee0626E9cFB5F0195F69DCaC5b759Dc9;
	address public constant adminContract = 0xf7Cc67326F9A1D057c1e4b110eF6c680B13a1f53;
	address public constant borrowerOperations = 0x2bCA0300c2aa65de6F19c2d241B54a445C9990E2;
	address public constant collSurplusPool = 0x09dfdF392a56E4316e97A13e20b09C415fCD3d7b;
	address public constant communityIssuance = address(0);
	address public constant debtToken = 0x15f74458aE0bFdAA1a96CA1aa779D715Cc1Eefe4;
	address public constant defaultPool = 0x84446698694B348EaeCE187b55df06AB4Ce72b35;
	address public constant feeCollector = 0x4928c8F8c20A1E3C295DddBe05095A9aBBdB3d14;
	address public constant gasPoolAddress = 0x40E0e274A42D9b1a9D4B64dC6c46D21228d45C20;
	address public constant grvtStaking = address(0);
	address public constant priceFeed = 0x89F1ecCF2644902344db02788A790551Bb070351;
	address public constant sortedVessels = 0xF31D88232F36098096d1eB69f0de48B53a1d18Ce;
	address public constant stabilityPool = 0x4F39F12064D83F6Dd7A2BDb0D53aF8be560356A6;
	address public constant timelockAddress = 0x57a1953bF194A1EF73396e442Ac7Dc761dCd23cc;
	address public constant treasuryAddress = 0x6F8Fe995422c5efE6487A7B07f67E84aaD9D4eC8;
	address public constant vesselManager = 0xdB5DAcB1DFbe16326C3656a88017f0cB4ece0977;
	address public constant vesselManagerOperations = 0xc49B737fa56f9142974a54F6C66055468eC631d0;

	/**
	 * @dev This empty reserved space is put in place to allow future versions to add new
	 * variables without shifting down storage in the inheritance chain.
	 * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
	 */
	uint256[40] private __gap;

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
