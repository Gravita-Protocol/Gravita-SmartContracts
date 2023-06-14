// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import "../Addresses.sol";
import "../Interfaces/IPythPriceFeed.sol";

/**
 * @author spider-g
 */ 
contract PythPriceFeed is IPythPriceFeed, OwnableUpgradeable, UUPSUpgradeable, Addresses {
	// Constants --------------------------------------------------------------------------------------------------------

	string public constant NAME = "PythPriceFeed";

	/// @dev Used to convert an oracle price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;

	// State ------------------------------------------------------------------------------------------------------------

	IPyth public pyth;
	mapping(address => bytes32) public tokenToPriceID;

	// Constructor ------------------------------------------------------------------------------------------------------

	constructor(address _pythContractAddress) {
		pyth = IPyth(_pythContractAddress);
		__Ownable_init();
		__UUPSUpgradeable_init();
	}

	// Admin routines ---------------------------------------------------------------------------------------------------

	function setTokenPriceId(address _token, bytes32 _priceID) external override {
		_requireOwnerOrTimelock(_token);
    tokenToPriceID[_token] = _priceID;
    emit NewPriceIdRegistered(_token, _priceID);
  }

	// Public functions -------------------------------------------------------------------------------------------------

	/**
	 * @notice Fetches the price for an asset from a previosly configured oracle.
	 * @dev Callers:
	 *     - BorrowerOperations.openVessel()
	 *     - BorrowerOperations.adjustVessel()
	 *     - BorrowerOperations.closeVessel()
	 *     - VesselManagerOperations.liquidateVessels()
	 *     - VesselManagerOperations.batchLiquidateVessels()
	 *     - VesselManagerOperations.redeemCollateral()
	 */
	function fetchPrice(address _token, bytes[] calldata _pythPriceUpdateData) external payable returns (uint256) {
    bytes32 priceID = tokenToPriceID[_token];

    // Update the prices to the latest available values and pay the required fee for it. The `priceUpdateData` data
		// should be retrieved from our off-chain Price Service API using the `pyth-evm-js` package.
		// See section "How Pyth Works on EVM Chains" below for more information.
		uint fee = pyth.getUpdateFee(_pythPriceUpdateData);
		pyth.updatePriceFeeds{ value: fee }(_pythPriceUpdateData);

		// Read the current value of priceID, aborting the transaction if the price has not been updated recently.
		// Every chain has a default recency threshold which can be retrieved by calling the getValidTimePeriod() function on the contract.
		// Please see IPyth.sol for variants of this function that support configurable recency thresholds and other useful features.
    PythStructs.Price memory priceResponse = pyth.getPrice(priceID);
		return uint256(uint64(priceResponse.price));
	}

	// Access control functions -----------------------------------------------------------------------------------------

	/**
	 * @dev Requires msg.sender to be the contract owner when the priceID is first set. Subsequent updates need to come 
	 *     through the timelock contract.
	 */
	function _requireOwnerOrTimelock(address _token) internal view {
		if (tokenToPriceID[_token].length == 0) {
			_checkOwner();
		} else if (msg.sender != timelockAddress) {
			revert PriceFeed__TimelockOnlyError();
		}
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
