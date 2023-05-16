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
	IActivePool public constant activePool 														= IActivePool(0xebEf95afe5Eae9357Ec0437B6D975feeeFb62424);
	IAdminContract public constant adminContract 											= IAdminContract(0xC57C351D75Be3fC813Ab0c16C64fABCb48d30feE);
	IBorrowerOperations public constant borrowerOperations 						= IBorrowerOperations(0x4d07cF667703594f6119b6a0041F293Ae9855656);
	ICollSurplusPool public constant collSurplusPool 									= ICollSurplusPool(0x98Cff4846B9AFBa9148D772fdF04eFF85a78d566);
	ICommunityIssuance public constant communityIssuance 							= ICommunityIssuance(address(0));
	IDefaultPool public constant defaultPool 													= IDefaultPool(0x7226921302D74880B76Bf821fA0619e28848B16f);
	IFeeCollector public constant feeCollector 												= IFeeCollector(0xDc335F154df3B148cc67aDFC781deE49AE596f23);
	IGRVTStaking public constant grvtStaking 													= IGRVTStaking(address(0));
	IPriceFeed public constant priceFeed 															= IPriceFeed(0x655D09c912248fa6fE55657633BA4B92a1F9be1F);
	ISortedVessels public constant sortedVessels 											= ISortedVessels(0x45Db46cd2704d0f4092c34318a5C16cfD98219B7);
	IStabilityPool public constant stabilityPool 											= IStabilityPool(0x49387C88Fb723499a9A40DFbb266FAB8028c7e57);
	IVesselManager public constant vesselManager 											= IVesselManager(0x39f9b9deb817867d573c2FABA70914335a408466);
	IVesselManagerOperations public constant vesselManagerOperations	= IVesselManagerOperations(0x4135F28DF5e1EFb4bC73D5462C5Bc199203387D9);

	address public constant gasPoolAddress 														= 0x16A64C92295Fa16C77C7E3eE5728f9e933ed665e;
	address public constant timelockAddress 													= 0xFB04d429e1826cf0B0068F4fbA7992b42a7Acf93;
	IDebtToken public constant debtToken 															= IDebtToken(0x78076562e30Fd49c70C4E91f65644d15C32C1839);
	address public constant treasuryAddress 													= 0x19596e1D6cd97916514B5DBaA4730781eFE49975;
}
