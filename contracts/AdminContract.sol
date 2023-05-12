// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./Interfaces/IActivePool.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ICommunityIssuance.sol";
import "./Interfaces/IAdminContract.sol";

contract AdminContract is IAdminContract, OwnableUpgradeable {
	// Constants --------------------------------------------------------------------------------------------------------

	string public constant NAME = "AdminContract";
	uint256 public constant DECIMAL_PRECISION = 1 ether;
	uint256 public constant _100pct = 1 ether; // 1e18 == 100%
	uint256 private constant DEFAULT_DECIMALS = 18;

	uint256 public constant BORROWING_FEE_DEFAULT = 0.005 ether; // 0.5%
	uint256 public constant CCR_DEFAULT = 1.5 ether; // 150%
	uint256 public constant MCR_DEFAULT = 1.1 ether; // 110%
	uint256 public constant MIN_NET_DEBT_DEFAULT = 2_000 ether;
	uint256 public constant MINT_CAP_DEFAULT = 1_000_000 ether; // 1 million GRAI
	uint256 public constant PERCENT_DIVISOR_DEFAULT = 100; // dividing by 100 yields 1%
	uint256 public constant REDEMPTION_FEE_FLOOR_DEFAULT = (DECIMAL_PRECISION / 1000) * 5; // 0.5%
	uint256 public constant REDEMPTION_BLOCK_DAYS_DEFAULT = type(uint256).max; // never

	// State ------------------------------------------------------------------------------------------------------------

	address public shortTimelock;
	address public longTimelock;

	ICommunityIssuance public communityIssuance;
	IActivePool public activePool;
	IDefaultPool public defaultPool;
	IStabilityPool public stabilityPool;
	ICollSurplusPool public collSurplusPool;
	IPriceFeed public priceFeed;

	/**
		@dev Cannot be public as struct has too many variables for the stack. 
		@dev Create special view structs/getters instead.
	 */
	mapping(address => CollateralParams) internal collateralParams;

	// list of all collateral types in collateralParams (active and deprecated)
	// Addresses for easy access
	address[] public validCollateral; // index maps to token address.

	bool public isSetupInitialized;

	// Modifiers --------------------------------------------------------------------------------------------------------

	// Require that the collateral exists in the controller. If it is not the 0th index, and the
	// index is still 0 then it does not exist in the mapping.
	// no require here for valid collateral 0 index because that means it exists.
	modifier exists(address _collateral) {
		_exists(_collateral);
		_;
	}

	modifier shortTimelockOnly() {
		if (isSetupInitialized) {
			if (msg.sender != shortTimelock) {
				revert AdminContract__ShortTimelockOnly();
			}
		} else {
			if (msg.sender != owner()) {
				revert AdminContract__OnlyOwner();
			}
		}
		_;
	}

	modifier longTimelockOnly() {
		if (isSetupInitialized) {
			if (msg.sender != longTimelock) {
				revert AdminContract__LongTimelockOnly();
			}
		} else {
			if (msg.sender != owner()) {
				revert AdminContract__OnlyOwner();
			}
		}
		_;
	}

	modifier safeCheck(
		string memory parameter,
		address _collateral,
		uint256 enteredValue,
		uint256 min,
		uint256 max
	) {
		require(collateralParams[_collateral].active, "Collateral is not configured, use setCollateralParameters");

		if (enteredValue < min || enteredValue > max) {
			revert SafeCheckError(parameter, enteredValue, min, max);
		}
		_;
	}

	// Initializer ------------------------------------------------------------------------------------------------------

	function initialize() public initializer {
		__Ownable_init();
	}

	// External Functions -----------------------------------------------------------------------------------------------

	function setAddresses(
		address _communityIssuanceAddress,
		address _activePoolAddress,
		address _defaultPoolAddress,
		address _stabilityPoolAddress,
		address _collSurplusPoolAddress,
		address _priceFeedAddress,
		address _shortTimelock,
		address _longTimelock
	) external onlyOwner {
		require(!isSetupInitialized, "Setup is already initialized");
		communityIssuance = ICommunityIssuance(_communityIssuanceAddress);
		activePool = IActivePool(_activePoolAddress);
		defaultPool = IDefaultPool(_defaultPoolAddress);
		stabilityPool = IStabilityPool(_stabilityPoolAddress);
		collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
		priceFeed = IPriceFeed(_priceFeedAddress);
		shortTimelock = _shortTimelock;
		longTimelock = _longTimelock;
	}

	/**
	 * @dev The deployment script will call this function when all initial collaterals have been configured; 
	 *      after this is set to true, all subsequent config/setters will need to go through the timelocks.
	 */
	function setSetupIsInitialized() external onlyOwner {
		isSetupInitialized = true;
	}

	function addNewCollateral(
		address _collateral,
		uint256 _debtTokenGasCompensation, // the gas compensation is initialized here as it won't be changed
		uint256 _decimals,
		bool _isWrapped
	) external longTimelockOnly {
		require(collateralParams[_collateral].mcr == 0, "collateral already exists");
		// for the moment, require collaterals to have 18 decimals
		require(_decimals == DEFAULT_DECIMALS, "collaterals must have the default decimals");
		validCollateral.push(_collateral);
		collateralParams[_collateral] = CollateralParams({
			decimals: _decimals,
			index: validCollateral.length - 1,
			active: false,
			isWrapped: _isWrapped,
			debtTokenGasCompensation: _debtTokenGasCompensation,
			borrowingFee: BORROWING_FEE_DEFAULT,
			ccr: CCR_DEFAULT,
			mcr: MCR_DEFAULT,
			minNetDebt: MIN_NET_DEBT_DEFAULT,
			mintCap: MINT_CAP_DEFAULT,
			percentDivisor: PERCENT_DIVISOR_DEFAULT,
			redemptionFeeFloor: REDEMPTION_FEE_FLOOR_DEFAULT,
			redemptionBlockTimestamp: REDEMPTION_BLOCK_DAYS_DEFAULT
		});

		stabilityPool.addCollateralType(_collateral);

		emit CollateralAdded(_collateral);
	}

	function setCollateralParameters(
		address _collateral,
		uint256 borrowingFee,
		uint256 ccr,
		uint256 mcr,
		uint256 minNetDebt,
		uint256 mintCap,
		uint256 percentDivisor,
		uint256 redemptionFeeFloor
	) public override onlyOwner {
		collateralParams[_collateral].active = true;
		setBorrowingFee(_collateral, borrowingFee);
		setCCR(_collateral, ccr);
		setMCR(_collateral, mcr);
		setMinNetDebt(_collateral, minNetDebt);
		setMintCap(_collateral, mintCap);
		setPercentDivisor(_collateral, percentDivisor);
		setRedemptionFeeFloor(_collateral, redemptionFeeFloor);
	}

	function setIsActive(address _collateral, bool _active) public onlyOwner {
		CollateralParams storage collParams = collateralParams[_collateral];
		collParams.active = _active;
	}

	function setBorrowingFee(
		address _collateral,
		uint256 borrowingFee
	)
		public
		override
		onlyOwner
		safeCheck("Borrowing Fee", _collateral, borrowingFee, 0, 0.1 ether) // 0% - 10%
	{
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldBorrowing = collParams.borrowingFee;
		collParams.borrowingFee = borrowingFee;
		emit BorrowingFeeChanged(oldBorrowing, borrowingFee);
	}

	function setCCR(
		address _collateral,
		uint256 newCCR
	)
		public
		override
		shortTimelockOnly
		safeCheck("CCR", _collateral, newCCR, 1.01 ether, 10 ether) // 101% - 1,000%
	{
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldCCR = collParams.ccr;
		collParams.ccr = newCCR;
		emit CCRChanged(oldCCR, newCCR);
	}

	function setMCR(
		address _collateral,
		uint256 newMCR
	)
		public
		override
		shortTimelockOnly
		safeCheck("MCR", _collateral, newMCR, 1.01 ether, 10 ether) // 101% - 1,000%
	{
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldMCR = collParams.mcr;
		collParams.mcr = newMCR;
		emit MCRChanged(oldMCR, newMCR);
	}

	function setMinNetDebt(
		address _collateral,
		uint256 minNetDebt
	) public override shortTimelockOnly safeCheck("Min Net Debt", _collateral, minNetDebt, 0, 2_000 ether) {
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldMinNet = collParams.minNetDebt;
		collParams.minNetDebt = minNetDebt;
		emit MinNetDebtChanged(oldMinNet, minNetDebt);
	}

	function setMintCap(address _collateral, uint256 mintCap) public override shortTimelockOnly {
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldMintCap = collParams.mintCap;
		collParams.mintCap = mintCap;
		emit MintCapChanged(oldMintCap, mintCap);
	}

	function setPercentDivisor(
		address _collateral,
		uint256 percentDivisor
	) public override onlyOwner safeCheck("Percent Divisor", _collateral, percentDivisor, 2, 200) {
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldPercent = collParams.percentDivisor;
		collParams.percentDivisor = percentDivisor;
		emit PercentDivisorChanged(oldPercent, percentDivisor);
	}

	function setRedemptionFeeFloor(
		address _collateral,
		uint256 redemptionFeeFloor
	)
		public
		override
		onlyOwner
		safeCheck("Redemption Fee Floor", _collateral, redemptionFeeFloor, 0.001 ether, 0.1 ether) // 0.10% - 10%
	{
		CollateralParams storage collParams = collateralParams[_collateral];
		uint256 oldRedemptionFeeFloor = collParams.redemptionFeeFloor;
		collParams.redemptionFeeFloor = redemptionFeeFloor;
		emit RedemptionFeeFloorChanged(oldRedemptionFeeFloor, redemptionFeeFloor);
	}

	function setRedemptionBlockTimestamp(address _collateral, uint256 _blockTimestamp) public override shortTimelockOnly {
		collateralParams[_collateral].redemptionBlockTimestamp = _blockTimestamp;
		emit RedemptionBlockTimestampChanged(_collateral, _blockTimestamp);
	}

	// View functions ---------------------------------------------------------------------------------------------------

	function isWrapped(address _collateral) external view returns (bool) {
		return collateralParams[_collateral].isWrapped;
	}

	function isWrappedMany(address[] calldata _collaterals) external view returns (bool[] memory wrapped) {
		wrapped = new bool[](_collaterals.length);
		for (uint256 i = 0; i < _collaterals.length; ) {
			wrapped[i] = collateralParams[_collaterals[i]].isWrapped;
			unchecked {
				i++;
			}
		}
	}

	function getValidCollateral() external view override returns (address[] memory) {
		return validCollateral;
	}

	function getIsActive(address _collateral) external view override exists(_collateral) returns (bool) {
		return collateralParams[_collateral].active;
	}

	function getDecimals(address _collateral) external view exists(_collateral) returns (uint256) {
		return collateralParams[_collateral].decimals;
	}

	function getIndex(address _collateral) external view override exists(_collateral) returns (uint256) {
		return (collateralParams[_collateral].index);
	}

	function getIndices(address[] memory _colls) external view returns (uint256[] memory indices) {
		uint256 len = _colls.length;
		indices = new uint256[](len);

		for (uint256 i; i < len; ) {
			_exists(_colls[i]);
			indices[i] = collateralParams[_colls[i]].index;
			unchecked {
				i++;
			}
		}
	}

	function getMcr(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].mcr;
	}

	function getCcr(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].ccr;
	}

	function getDebtTokenGasCompensation(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].debtTokenGasCompensation;
	}

	function getMinNetDebt(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].minNetDebt;
	}

	function getPercentDivisor(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].percentDivisor;
	}

	function getBorrowingFee(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].borrowingFee;
	}

	function getRedemptionFeeFloor(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].redemptionFeeFloor;
	}

	function getRedemptionBlockTimestamp(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].redemptionBlockTimestamp;
	}

	function getMintCap(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].mintCap;
	}

	function getTotalAssetDebt(address _asset) external view override returns (uint256) {
		return activePool.getDebtTokenBalance(_asset) + defaultPool.getDebtTokenBalance(_asset);
	}

	// Internal Functions -----------------------------------------------------------------------------------------------

	function _exists(address _collateral) internal view {
		require(collateralParams[_collateral].mcr != 0, "collateral does not exist");
	}
}
