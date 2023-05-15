// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Interfaces/IActivePool.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ICommunityIssuance.sol";
import "./Interfaces/IAdminContract.sol";
import "./Interfaces/IBorrowerOperations.sol";
import "./Interfaces/IVesselManager.sol";
import "./Interfaces/IVesselManagerOperations.sol";
import "./Interfaces/IAdminContract.sol";
import "./Interfaces/IFeeCollector.sol";
import "./Interfaces/IGRVTStaking.sol";

contract Addresses {
	// IAdminContract public constant adminContract = IAdminContract(address(0));
	// IBorrowerOperations public constant borrowerOperations = IBorrowerOperations(address(0));
	// IVesselManager public constant vesselManager = IVesselManager(address(0));
	// IVesselManagerOperations public constant vesselManagerOperations = IVesselManagerOperations(address(0));
	// address public constant timelockAddress = address(0);
	// ICommunityIssuance public constant communityIssuance = ICommunityIssuance(address(0));
	// IActivePool public constant activePool = IActivePool(address(0));
	// IDefaultPool public constant defaultPool = IDefaultPool(address(0));
	// IStabilityPool public constant stabilityPool = IStabilityPool(address(0));
	// ICollSurplusPool public constant collSurplusPool = ICollSurplusPool(address(0));
	// IPriceFeed public constant priceFeed = IPriceFeed(address(0));
	// IDebtToken public constant debtToken = IDebtToken(address(0));
	// address public constant gasPoolAddress = address(0);
	// IFeeCollector public constant feeCollector = IFeeCollector(address(0));
	// ISortedVessels public constant sortedVessels = ISortedVessels(address(0)); // double-linked list, sorted by their collateral ratios
	// address public constant treasuryAddress = address(0);
	// IGRVTStaking public constant grvtStaking = IGRVTStaking(address(0));

	IAdminContract public adminContract;
	IBorrowerOperations public borrowerOperations;
	IVesselManager public vesselManager;
	IVesselManagerOperations public vesselManagerOperations;
	address public timelockAddress;
	ICommunityIssuance public communityIssuance;
	IActivePool public activePool;
	IDefaultPool public defaultPool;
	IStabilityPool public stabilityPool;
	ICollSurplusPool public collSurplusPool;
	IPriceFeed public priceFeed;
	IDebtToken public debtToken;
	address public gasPoolAddress;
	IFeeCollector public feeCollector;
	ISortedVessels public sortedVessels;
	address public treasuryAddress;
	IGRVTStaking public grvtStaking;

	// Setter functions enabled only when running tests - requires contants to be regular variables
	function setAdminContract(address _adminContract) public {
		adminContract = IAdminContract(_adminContract);
	}

	function setBorrowerOperations(address _borrowerOperations) public {
		borrowerOperations = IBorrowerOperations(_borrowerOperations);
	}

	function setVesselManager(address _vesselManager) public {
		vesselManager = IVesselManager(_vesselManager);
	}

	function setVesselManagerOperations(address _vesselManagerOperations) public {
		vesselManagerOperations = IVesselManagerOperations(_vesselManagerOperations);
	}

	function setTimelock(address _timelock) public {
		timelockAddress = _timelock;
	}

	function setCommunityIssuance(address _communityIssuance) public {
		communityIssuance = ICommunityIssuance(_communityIssuance);
	}

	function setActivePool(address _activePool) public {
		activePool = IActivePool(_activePool);
	}

	function setDefaultPool(address _defaultPool) public {
		defaultPool = IDefaultPool(_defaultPool);
	}

	function setStabilityPool(address _stabilityPool) public {
		stabilityPool = IStabilityPool(_stabilityPool);
	}

	function setCollSurplusPool(address _collSurplusPool) public {
		collSurplusPool = ICollSurplusPool(_collSurplusPool);
	}

	function setPriceFeed(address _priceFeed) public {
		priceFeed = IPriceFeed(_priceFeed);
	}

	function setDebtToken(address _debtToken) public {
		debtToken = IDebtToken(_debtToken);
	}

	function setGasPool(address _gasPool) public {
		gasPoolAddress = _gasPool;
	}

	function setFeeCollector(address _feeCollector) public {
		feeCollector = IFeeCollector(_feeCollector);
	}

	function setSortedVessels(address _sortedVessels) public {
		sortedVessels = ISortedVessels(_sortedVessels);
	}

	function setTreasury(address _treasuryAddress) public {
		treasuryAddress = _treasuryAddress;
	}

	function setGRVTStaking(address _grvtStaking) public {
		grvtStaking = IGRVTStaking(_grvtStaking);
	}
}
