// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";

import "./Interfaces/IActivePool.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ICommunityIssuance.sol";
import "./Interfaces/IAdminContract.sol";

contract AdminContract is IAdminContract, ProxyAdmin {
	struct CollateralParams {
		uint256 decimals;
		uint256 index; //Maps to token address in validCollateral[]
		bool active;
		bool isWrapped;
		uint256 mcr;
		uint256 ccr;
		uint256 debtTokenGasCompensation; // Amount of debtToken to be locked in gas pool on opening vessels
		uint256 minNetDebt; // Minimum amount of net debtToken a vessel must have
		uint256 percentDivisor; // dividing by 200 yields 0.5%
		uint256 borrowingFee;
		uint256 redemptionFeeFloor;
		uint256 redemptionBlock;
		uint256 mintCap;
		bool hasCollateralConfigured;
	}

	error AdminContract__ShortTimelockOnly();
	error AdminContract__LongTimelockOnly();
	error AdminContract__OnlyOwner();

	// ---------- Default Parameters ---------- //
	string public constant NAME = "AdminContract";
	uint256 public constant DECIMAL_PRECISION = 1 ether;
	uint256 public constant _100pct = 1 ether; // 1e18 == 100%
	uint256 public constant REDEMPTION_BLOCK_DAY = 14;
	uint256 public constant MCR_DEFAULT = 1.1 ether; // 110%
	uint256 public constant CCR_DEFAULT = 1.5 ether; // 150%
	uint256 public constant PERCENT_DIVISOR_DEFAULT = 100; // dividing by 100 yields 0.5%
	uint256 public constant BORROWING_FEE_DEFAULT = (DECIMAL_PRECISION / 1000) * 5; // 0.5%
	uint256 public constant DEBT_TOKEN_GAS_COMPENSATION_DEFAULT = 30 ether;
	uint256 public constant MIN_NET_DEBT_DEFAULT = 300 ether;
	uint256 public constant REDEMPTION_FEE_FLOOR_DEFAULT = (DECIMAL_PRECISION / 1000) * 5; // 0.5%
	uint256 public constant MINT_CAP_DEFAULT = 1_000_000 ether; // 1 million

	bool public isInitialized;

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

	// Require that the collateral exists in the controller. If it is not the 0th index, and the
	// index is still 0 then it does not exist in the mapping.
	// no require here for valid collateral 0 index because that means it exists.
	modifier exists(address _collateral) {
		_exists(_collateral);
		_;
	}

	modifier shortTimelockOnly() {
		if (isInitialized) {
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
		if (isInitialized) {
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
		require(
			collateralParams[_collateral].hasCollateralConfigured,
			"Collateral is not configured, use setAsDefault or setCollateralParameters"
		);

		if (enteredValue < min || enteredValue > max) {
			revert SafeCheckError(parameter, enteredValue, min, max);
		}
		_;
	}

	// Calling from here makes it not inline, reducing contract size significantly.
	function _exists(address _collateral) internal view {
		if (validCollateral[0] != _collateral) {
			require(collateralParams[_collateral].index != 0, "collateral does not exist");
		}
	}

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
		require(!isInitialized);
		communityIssuance = ICommunityIssuance(_communityIssuanceAddress);
		activePool = IActivePool(_activePoolAddress);
		defaultPool = IDefaultPool(_defaultPoolAddress);
		stabilityPool = IStabilityPool(_stabilityPoolAddress);
		collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
		priceFeed = IPriceFeed(_priceFeedAddress);
		shortTimelock = _shortTimelock;
		longTimelock = _longTimelock;
	}

	function setInitialized() external onlyOwner {
		isInitialized = true;
	}

	//Needs to approve Community Issuance to use this fonction.
	function addNewCollateral(
		address _collateral,
		uint256 _decimals,
		bool _isWrapped
	) external longTimelockOnly {
		// If collateral list is not 0, and if the 0th index is not equal to this collateral,
		// then if index is 0 that means it is not set yet.
		if (validCollateral.length != 0) {
			require(
				validCollateral[0] != _collateral && collateralParams[_collateral].index == 0,
				"collateral already exists"
			);
		}
		validCollateral.push(_collateral);
		collateralParams[_collateral] = CollateralParams({
			decimals: _decimals,
			index: validCollateral.length - 1,
			active: true,
			isWrapped: _isWrapped,
			mcr: 0,
			ccr: 0,
			debtTokenGasCompensation: 0,
			minNetDebt: 0,
			percentDivisor: 0,
			borrowingFee: 0,
			redemptionFeeFloor: 0,
			redemptionBlock: 0,
			mintCap: type(uint256).max,
			hasCollateralConfigured: false
		});

		// defaultPool.addCollateralType(_collateral);
		stabilityPool.addCollateralType(_collateral);
		// collSurplusPool.addCollateralType(_collateral);

		// 	address proxyAddress = address(proxy);
		// 	stabilityPoolManager.addStabilityPool(_collateral, proxyAddress);
		// 	communityIssuance.addFundToStabilityPoolFrom(proxyAddress, assignedToken, msg.sender);
		// 	communityIssuance.setWeeklyGrvtDistribution(proxyAddress, _tokenPerWeekDistributed);

		// throw event
		emit CollateralAdded(_collateral);
	}

	// ======= VIEW FUNCTIONS FOR COLLATERAL =======

	function isWrapped(address _collateral) external view returns (bool) {
		return collateralParams[_collateral].isWrapped;
	}

	function isWrappedMany(
		address[] memory _collaterals
	) external view returns (bool[] memory wrapped) {
		wrapped = new bool[](_collaterals.length);
		for (uint256 i = 0; i < _collaterals.length; i++) {
			wrapped[i] = collateralParams[_collaterals[i]].isWrapped;
		}
	}

	function getValidCollateral() external view override returns (address[] memory) {
		return validCollateral;
	}

	function getIsActive(address _collateral) external view override exists(_collateral) returns (bool) {
		return collateralParams[_collateral].active;
	}

	function getDecimals(
		address _collateral
	) external view exists(_collateral) returns (uint256) {
		return collateralParams[_collateral].decimals;
	}

	function getIndex(
		address _collateral
	) external view override exists(_collateral) returns (uint256) {
		return (collateralParams[_collateral].index);
	}

	function getIndices(
		address[] memory _colls
	) external view returns (uint256[] memory indices) {
		uint256 len = _colls.length;
		indices = new uint256[](len);

		for (uint256 i; i < len; ++i) {
			_exists(_colls[i]);
			indices[i] = collateralParams[_colls[i]].index;
		}
	}

	function setCollateralParameters(
		address _collateral,
		uint256 newMCR,
		uint256 newCCR,
		uint256 gasCompensation,
		uint256 minNetDebt,
		uint256 percentDivisor,
		uint256 borrowingFee,
		uint256 redemptionFeeFloor,
		uint256 mintCap
	) public onlyOwner {
		collateralParams[_collateral].hasCollateralConfigured = true;
		setMCR(_collateral, newMCR);
		setCCR(_collateral, newCCR);
		setDebtTokenGasCompensation(_collateral, gasCompensation);
		setMinNetDebt(_collateral, minNetDebt);
		setPercentDivisor(_collateral, percentDivisor);
		setBorrowingFee(_collateral, borrowingFee);
		setRedemptionFeeFloor(_collateral, redemptionFeeFloor);
		setMintCap(_collateral, mintCap);
	}

	function sanitizeParameters(address _collateral) external {
		if (!collateralParams[_collateral].hasCollateralConfigured) {
			_setAsDefault(_collateral);
		}
	}

	function setAsDefault(address _collateral) external onlyOwner {
		_setAsDefault(_collateral);
	}

	function setAsDefaultWithRedemptionBlock(
		address _collateral,
		uint256 blockInDays
	)
		external
		onlyOwner // TODO: Review if should set to controller
	{
		if (blockInDays > REDEMPTION_BLOCK_DAY) {
			blockInDays = REDEMPTION_BLOCK_DAY;
		}

		if (collateralParams[_collateral].redemptionBlock == 0) {
			collateralParams[_collateral].redemptionBlock = block.timestamp + (blockInDays * 1 days);
		}

		_setAsDefault(_collateral);
	}

	function _setAsDefault(address _collateral) private {
		CollateralParams storage collateralParam = collateralParams[_collateral];
		collateralParam.hasCollateralConfigured = true;
		collateralParam.mcr = MCR_DEFAULT;
		collateralParam.ccr = CCR_DEFAULT;
		collateralParam.debtTokenGasCompensation = DEBT_TOKEN_GAS_COMPENSATION_DEFAULT;
		collateralParam.minNetDebt = MIN_NET_DEBT_DEFAULT;
		collateralParam.percentDivisor = PERCENT_DIVISOR_DEFAULT;
		collateralParam.borrowingFee = BORROWING_FEE_DEFAULT;
		collateralParam.redemptionFeeFloor = REDEMPTION_FEE_FLOOR_DEFAULT;
		collateralParam.mintCap = MINT_CAP_DEFAULT;
	}

	function setMCR(
		address _collateral,
		uint256 newMCR
	)
		public
		override
		shortTimelockOnly
		safeCheck("MCR", _collateral, newMCR, 1010000000000000000, 10000000000000000000) /// 101% - 1000%
	{
		uint256 oldMCR = collateralParams[_collateral].mcr;
		collateralParams[_collateral].mcr = newMCR;

		emit MCRChanged(oldMCR, newMCR);
	}

	function setCCR(
		address _collateral,
		uint256 newCCR
	)
		public
		override
		shortTimelockOnly
		safeCheck("CCR", _collateral, newCCR, 1010000000000000000, 10000000000000000000) /// 101% - 1000%
	{
		uint256 oldCCR = collateralParams[_collateral].ccr;
		collateralParams[_collateral].ccr = newCCR;

		emit CCRChanged(oldCCR, newCCR);
	}

	function setPercentDivisor(
		address _collateral,
		uint256 percentDivisor
	)
		public
		override
		onlyOwner
		safeCheck("Percent Divisor", _collateral, percentDivisor, 2, 200)
	{
		uint256 oldPercent = collateralParams[_collateral].percentDivisor;
		collateralParams[_collateral].percentDivisor = percentDivisor;

		emit PercentDivisorChanged(oldPercent, percentDivisor);
	}

	function setBorrowingFee(
		address _collateral,
		uint256 borrowingFee
	)
		public
		override
		onlyOwner
		safeCheck("Borrowing Fee Floor", _collateral, borrowingFee, 0, 1000) /// 0% - 10%
	{
		uint256 oldBorrowing = collateralParams[_collateral].borrowingFee;
		uint256 newBorrowingFee = (DECIMAL_PRECISION / 10000) * borrowingFee;

		collateralParams[_collateral].borrowingFee = newBorrowingFee;

		emit BorrowingFeeChanged(oldBorrowing, newBorrowingFee);
	}

	function setDebtTokenGasCompensation(
		address _collateral,
		uint256 gasCompensation
	)
		public
		override
		longTimelockOnly
		safeCheck("Gas Compensation", _collateral, gasCompensation, 1 ether, 400 ether)
	{
		uint256 oldGasComp = collateralParams[_collateral].debtTokenGasCompensation;
		collateralParams[_collateral].debtTokenGasCompensation = gasCompensation;
		emit GasCompensationChanged(oldGasComp, gasCompensation);
	}

	function setMinNetDebt(
		address _collateral,
		uint256 minNetDebt
	)
		public
		override
		longTimelockOnly
		safeCheck("Min Net Debt", _collateral, minNetDebt, 0, 1800 ether)
	{
		uint256 oldMinNet = collateralParams[_collateral].minNetDebt;
		collateralParams[_collateral].minNetDebt = minNetDebt;

		emit MinNetDebtChanged(oldMinNet, minNetDebt);
	}

	function setRedemptionFeeFloor(
		address _collateral,
		uint256 redemptionFeeFloor
	)
		public
		override
		onlyOwner
		safeCheck("Redemption Fee Floor", _collateral, redemptionFeeFloor, 10, 1000) /// 0.10% - 10%
	{
		uint256 oldRedemptionFeeFloor = collateralParams[_collateral].redemptionFeeFloor;
		uint256 newRedemptionFeeFloor = (DECIMAL_PRECISION / 10000) * redemptionFeeFloor;

		collateralParams[_collateral].redemptionFeeFloor = newRedemptionFeeFloor;
		emit RedemptionFeeFloorChanged(oldRedemptionFeeFloor, newRedemptionFeeFloor);
	}

	function setMintCap(address _collateral, uint256 mintCap) public override shortTimelockOnly {
		uint256 oldMintCap = collateralParams[_collateral].mintCap;
		uint256 newMintCap = mintCap;

		collateralParams[_collateral].mintCap = newMintCap;
		emit MintCapChanged(oldMintCap, newMintCap);
	}

	function setRedemptionBlock(
		address _collateral,
		uint256 _block
	) external override shortTimelockOnly {
		collateralParams[_collateral].redemptionBlock = _block;
		emit RedemptionBlockChanged(_collateral, _block);
	}

	function getMcr(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].mcr;
	}

	function getCcr(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].ccr;
	}

	function getDebtTokenGasCompensation(
		address _collateral
	) external view override returns (uint256) {
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

	function getRedemptionFeeFloor(
		address _collateral
	) external view override returns (uint256) {
		return collateralParams[_collateral].redemptionFeeFloor;
	}

	function getRedemptionBlock(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].redemptionBlock;
	}

	function getMintCap(address _collateral) external view override returns (uint256) {
		return collateralParams[_collateral].mintCap;
	}

	function getTotalAssetDebt(address _asset) external view override returns (uint256) {
		return activePool.getDebtTokenBalance(_asset) + defaultPool.getDebtTokenBalance(_asset);
	}
}
