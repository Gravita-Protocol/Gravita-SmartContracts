// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./Addresses.sol";
import "./Interfaces/IPriceFeed.sol";

/**
 * @title The PriceFeed contract contains a directory of oracles for fetching prices for assets based on their 
 *     addresses; optionally fallback oracles can also be registered in case the primary source fails or is stale.
 * @author spider-g
 */ 
contract PriceFeed is IPriceFeed, OwnableUpgradeable, UUPSUpgradeable, Addresses {
	// Constants --------------------------------------------------------------------------------------------------------

	string public constant NAME = "PriceFeed";

	/// @dev Used to convert an oracle price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;

	/// @dev Deprecated, but retained for upgradeability
	uint256 private constant RESPONSE_TIMEOUT = 25 hours;
	uint256 private constant MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_LOWER_LIMIT = 0.2 ether;
	uint256 private constant MAX_PRICE_DEVIATION_BETWEEN_ROUNDS_UPPER_LIMIT = 0.5 ether;

	// State ------------------------------------------------------------------------------------------------------------

	/// @dev Deprecated, but retained for upgradeability
	mapping(address => OracleRecord) private oracleRecords;
	mapping(address => PriceRecord) private priceRecords;

	mapping(address => OracleRecordV2) public oracles;
	mapping(address => OracleRecordV2) public fallbacks;

	// Initializer ------------------------------------------------------------------------------------------------------

	function initialize() public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
	}

	// Admin routines ---------------------------------------------------------------------------------------------------

	function setOracle(
		address _token,
		address _oracle,
		ProviderType _type,
		uint256 _timeoutMinutes,
		bool _isEthIndexed,
		bool _isFallback
	) external override {
		_requireOwnerOrTimelock(_token, _isFallback);
		if (_isFallback && oracles[_token].oracleAddress == address(0)) {
			// fallback setup requires an existing primary oracle for the asset
			revert PriceFeed__ExistingOracleRequired();
		}
		uint256 decimals = _fetchDecimals(_oracle, _type);
		if (decimals == 0) {
			revert PriceFeed__InvalidDecimalsError();
		}
		OracleRecordV2 memory newOracle = OracleRecordV2({
			oracleAddress: _oracle,
			providerType: _type,
			timeoutMinutes: _timeoutMinutes,
			decimals: decimals,
			isEthIndexed: _isEthIndexed
		});
		uint256 price = _fetchOracleScaledPrice(newOracle);
		if (price == 0) {
			revert PriceFeed__InvalidOracleResponseError(_token);
		}
		if (_isFallback) {
			fallbacks[_token] = newOracle;
		} else {
			oracles[_token] = newOracle;
		}
		emit NewOracleRegistered(_token, _oracle, _isEthIndexed, _isFallback);
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
	function fetchPrice(address _token) public view override returns (uint256) {
		OracleRecordV2 memory oracle = oracles[_token];
		uint256 price = _fetchOracleScaledPrice(oracle);
		if (price != 0) {
			return oracle.isEthIndexed ? _calcEthIndexedPrice(price) : price;
		}
		oracle = fallbacks[_token];
		price = _fetchOracleScaledPrice(oracle);
		if (price != 0) {
			return oracle.isEthIndexed ? _calcEthIndexedPrice(price) : price;
		}
		revert PriceFeed__InvalidOracleResponseError(_token);
	}

	// Internal functions -----------------------------------------------------------------------------------------------

	function _fetchDecimals(address _oracle, ProviderType _type) internal view returns (uint8) {
		if (_type == ProviderType.Chainlink) {
			return ChainlinkAggregatorV3Interface(_oracle).decimals();
		}
		return 0;
	}

	function _fetchOracleScaledPrice(OracleRecordV2 memory oracle) internal view returns (uint256) {
		uint256 oraclePrice;
		uint256 priceTimestamp;
		if (oracle.oracleAddress == address(0)) {
			revert PriceFeed__UnknownAssetError();
		}
		if (ProviderType.Chainlink == oracle.providerType) {
			(oraclePrice, priceTimestamp) = _fetchChainlinkOracleResponse(oracle.oracleAddress);
		}
		if (oraclePrice != 0 && !_isStalePrice(priceTimestamp, oracle.timeoutMinutes)) {
			return _scalePriceByDigits(oraclePrice, oracle.decimals);
		}
		return 0;
	}

	function _isStalePrice(uint256 _priceTimestamp, uint256 _oracleTimeoutMinutes) internal view returns (bool) {
		return block.timestamp - _priceTimestamp > _oracleTimeoutMinutes * 60;
	}

	function _fetchChainlinkOracleResponse(
		address _chainlinkOracleAddress
	) internal view returns (uint256 price, uint256 timestamp) {
		try ChainlinkAggregatorV3Interface(_chainlinkOracleAddress).latestRoundData() returns (
			uint80 roundId,
			int256 answer,
			uint256 /* startedAt */,
			uint256 updatedAt,
			uint80 /* answeredInRound */
		) {
			if (roundId != 0 && updatedAt != 0 && answer != 0 && updatedAt <= block.timestamp) {
				price = uint256(answer);
				timestamp = updatedAt;
			}
		} catch {
			// If call to Chainlink aggregator reverts, return a zero response
		}
	}

	/**
	 * @dev Fetches the ETH:USD price (using the zero address as being the ETH asset), then multiplies it by the 
	 *     indexed price. Assumes an oracle has been set for that purpose.
	 */
	function _calcEthIndexedPrice(uint256 _ethAmount) internal view returns (uint256) {
		uint256 ethPrice = fetchPrice(address(0));
		return (ethPrice * _ethAmount) / 1 ether;
	}

	/**
	 * @dev Scales oracle's response up/down to Gravita's target precision; returns unaltered price if already on 
	 *     target digits.
	 */
	function _scalePriceByDigits(uint256 _price, uint256 _priceDigits) internal pure returns (uint256) {
		if (_priceDigits > TARGET_DIGITS) {
			return _price / (10 ** (_priceDigits - TARGET_DIGITS));
		} else if (_priceDigits < TARGET_DIGITS) {
			return _price * (10 ** (TARGET_DIGITS - _priceDigits));
		}
		return _price;
	}

	// Access control functions -----------------------------------------------------------------------------------------

	/**
	 * @dev Requires msg.sender to be the contract owner when the oracle is first set. Subsequent updates need to come 
	 *     through the timelock contract.
	 */
	function _requireOwnerOrTimelock(address _token, bool _isFallback) internal view {
		OracleRecordV2 memory record = _isFallback ? fallbacks[_token] : oracles[_token];
		if (record.oracleAddress == address(0)) {
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
