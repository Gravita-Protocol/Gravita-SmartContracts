// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "../Interfaces/IVesselManager.sol";
import "../Interfaces/ISortedVessels.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Dependencies/GravitaMath.sol";

/* Wrapper contract - used for calculating gas of read-only and internal functions. 
Not part of the Gravita application. */
contract FunctionCaller {
	IVesselManager vesselManager;
	address public vesselManagerAddress;

	ISortedVessels sortedVessels;
	address public sortedVesselsAddress;

	IPriceFeed priceFeed;
	address public priceFeedAddress;

	// --- Dependency setters ---

	function setVesselManagerAddress(address _vesselManagerAddress) external {
		vesselManagerAddress = _vesselManagerAddress;
		vesselManager = IVesselManager(_vesselManagerAddress);
	}

	function setSortedVesselsAddress(address _sortedVesselsAddress) external {
		vesselManagerAddress = _sortedVesselsAddress;
		sortedVessels = ISortedVessels(_sortedVesselsAddress);
	}

	function setPriceFeedAddress(address _priceFeedAddress) external {
		priceFeedAddress = _priceFeedAddress;
		priceFeed = IPriceFeed(_priceFeedAddress);
	}

	// --- Non-view wrapper functions used for calculating gas ---

	function vesselManager_getCurrentICR(
		address _asset,
		address _address,
		uint256 _price
	) external view returns (uint256) {
		return vesselManager.getCurrentICR(_asset, _address, _price);
	}

	function sortedVessels_findInsertPosition(
		address _asset,
		uint256 _NICR,
		address _prevId,
		address _nextId
	) external view returns (address, address) {
		return sortedVessels.findInsertPosition(_asset, _NICR, _prevId, _nextId);
	}
}
