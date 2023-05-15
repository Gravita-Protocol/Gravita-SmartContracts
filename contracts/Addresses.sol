// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "./Interfaces/IActivePool.sol";
import "./Interfaces/IAdminContract.sol";
import "./Interfaces/IBorrowerOperations.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ICommunityIssuance.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IFeeCollector.sol";
import "./Interfaces/IGRVTStaking.sol";
import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/IVesselManager.sol";
import "./Interfaces/IVesselManagerOperations.sol";

contract Addresses {
	IActivePool public constant activePool = IActivePool(address(0));
	IAdminContract public constant adminContract = IAdminContract(address(0));
	IBorrowerOperations public constant borrowerOperations = IBorrowerOperations(address(0));
	ICollSurplusPool public constant collSurplusPool = ICollSurplusPool(address(0));
	ICommunityIssuance public constant communityIssuance = ICommunityIssuance(address(0));
	IDebtToken public constant debtToken = IDebtToken(address(0));
	IDefaultPool public constant defaultPool = IDefaultPool(address(0));
	IFeeCollector public constant feeCollector = IFeeCollector(address(0));
	address public constant gasPoolAddress = address(0);
	IGRVTStaking public constant grvtStaking = IGRVTStaking(address(0));
	IPriceFeed public constant priceFeed = IPriceFeed(address(0));
	ISortedVessels public constant sortedVessels = ISortedVessels(address(0));
	IStabilityPool public constant stabilityPool = IStabilityPool(address(0));
	address public constant timelockAddress = address(0);
	address public constant treasuryAddress = address(0);
	IVesselManager public constant vesselManager = IVesselManager(address(0));
	IVesselManagerOperations public constant vesselManagerOperations = IVesselManagerOperations(address(0));
}
