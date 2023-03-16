// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../Dependencies/GravitaMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/IVesselManager.sol";
import "../Interfaces/IStabilityPool.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/IGRVTStaking.sol";
import "./BorrowerOperationsScript.sol";
import "./ETHTransferScript.sol";
import "./GRVTStakingScript.sol";

contract BorrowerWrappersScript is
	BorrowerOperationsScript,
	ETHTransferScript,
	GRVTStakingScript
{
	using SafeMathUpgradeable for uint256;

	struct Local_var {
		address _asset;
		uint256 _maxFee;
		address _upperHint;
		address _lowerHint;
		uint256 netVUSDAmount;
	}

	string public constant NAME = "BorrowerWrappersScript";

	IVesselManager immutable vesselManager;
	IStabilityPool immutable stabilityPool;
	IPriceFeed immutable priceFeed;
	IERC20 immutable debtToken;
	IERC20 immutable grvtToken;

	constructor(
		address _borrowerOperationsAddress,
		address _vesselManagerAddress,
		address _GRVTStakingAddress
	)
		BorrowerOperationsScript(IBorrowerOperations(_borrowerOperationsAddress))
		GRVTStakingScript(_GRVTStakingAddress)
	{
		IVesselManager vesselManagerCached = IVesselManager(_vesselManagerAddress);
		vesselManager = vesselManagerCached;

		IStabilityPool stabilityPoolCached = vesselManagerCached.stabilityPool();
		stabilityPool = stabilityPoolCached;

		IPriceFeed priceFeedCached = vesselManagerCached.adminContract().priceFeed(); // TODO: Get from AdminContract instead if this script is active.
		priceFeed = priceFeedCached;

		address debtTokenCached = address(vesselManagerCached.debtToken());
		debtToken = IERC20(debtTokenCached);

		address grvtTokenCached = address(IGRVTStaking(_GRVTStakingAddress).grvtToken());
		grvtToken = IERC20(grvtTokenCached);

		// IGRVTStaking grvtStakingCached = vesselManagerCached.grvtStaking();
		// require(
		// 	_GRVTStakingAddress == address(grvtStakingCached),
		// 	"BorrowerWrappersScript: Wrong GRVTStaking address"
		// );
	}

	function claimCollateralAndOpenVessel(
		address _asset,
		uint256 _VUSDAmount,
		address _upperHint,
		address _lowerHint
	) external payable {
		uint256 balanceBefore = address(this).balance;

		// Claim collateral
		borrowerOperations.claimCollateral(_asset);

		uint256 balanceAfter = address(this).balance;

		// already checked in CollSurplusPool
		assert(balanceAfter > balanceBefore);

		uint256 totalCollateral = balanceAfter.sub(balanceBefore).add(msg.value);

		// Open vessel with obtained collateral, plus collateral sent by user
		borrowerOperations.openVessel(
			_asset,
			totalCollateral,
			_VUSDAmount,
			_upperHint,
			_lowerHint
		);
	}

	function claimSPRewardsAndRecycle(
		address _asset,
		uint256 _maxFee,
		address _upperHint,
		address _lowerHint
	) external {
		Local_var memory vars = Local_var(_asset, _maxFee, _upperHint, _lowerHint, 0);
		uint256 collBalanceBefore = address(this).balance;
		uint256 GRVTBalanceBefore = grvtToken.balanceOf(address(this));

		// Claim rewards
		stabilityPool.withdrawFromSP(0);

		uint256 collBalanceAfter = address(this).balance;
		uint256 GRVTBalanceAfter = grvtToken.balanceOf(address(this));
		uint256 claimedCollateral = collBalanceAfter.sub(collBalanceBefore);

		// Add claimed ETH to vessel, get more VUSD and stake it into the Stability Pool
		if (claimedCollateral > 0) {
			_requireUserHasVessel(vars._asset, address(this));
			vars.netVUSDAmount = _getNetVUSDAmount(vars._asset, claimedCollateral);
			borrowerOperations.adjustVessel(
				vars._asset,
				claimedCollateral,
				0,
				vars.netVUSDAmount,
				true,
				vars._upperHint,
				vars._lowerHint
			);
			// Provide withdrawn VUSD to Stability Pool
			if (vars.netVUSDAmount > 0) {
				stabilityPool.provideToSP(vars.netVUSDAmount);
			}
		}

		// Stake claimed GRVT
		uint256 claimedGRVT = GRVTBalanceAfter.sub(GRVTBalanceBefore);
		if (claimedGRVT > 0) {
			grvtStaking.stake(claimedGRVT);
		}
	}

	function claimStakingGainsAndRecycle(
		address _asset,
		uint256 _maxFee,
		address _upperHint,
		address _lowerHint
	) external {
		Local_var memory vars = Local_var(_asset, _maxFee, _upperHint, _lowerHint, 0);

		uint256 collBalanceBefore = address(this).balance;
		uint256 VUSDBalanceBefore = debtToken.balanceOf(address(this));
		uint256 GRVTBalanceBefore = grvtToken.balanceOf(address(this));

		// Claim gains
		grvtStaking.unstake(0);

		uint256 gainedCollateral = address(this).balance.sub(collBalanceBefore); // stack too deep issues :'(
		uint256 gainedVUSD = debtToken.balanceOf(address(this)).sub(VUSDBalanceBefore);

		// Top up vessel and get more VUSD, keeping ICR constant
		if (gainedCollateral > 0) {
			_requireUserHasVessel(vars._asset, address(this));
			vars.netVUSDAmount = _getNetVUSDAmount(vars._asset, gainedCollateral);
			borrowerOperations.adjustVessel(
				vars._asset,
				gainedCollateral,
				0,
				vars.netVUSDAmount,
				true,
				vars._upperHint,
				vars._lowerHint
			);
		}

		uint256 totalVUSD = gainedVUSD.add(vars.netVUSDAmount);
		if (totalVUSD > 0) {
			stabilityPool.provideToSP(totalVUSD);

			// Providing to Stability Pool also triggers GRVT claim, so stake it if any
			uint256 GRVTBalanceAfter = grvtToken.balanceOf(address(this));
			uint256 claimedGRVT = GRVTBalanceAfter.sub(GRVTBalanceBefore);
			if (claimedGRVT > 0) {
				grvtStaking.stake(claimedGRVT);
			}
		}
	}

	function _getNetVUSDAmount(address _asset, uint256 _collateral) internal returns (uint256) {
		uint256 price = priceFeed.fetchPrice(_asset);
		uint256 ICR = vesselManager.getCurrentICR(_asset, address(this), price);

		uint256 VUSDAmount = _collateral.mul(price).div(ICR);
		uint256 borrowingRate = vesselManager.adminContract().getBorrowingFee(_asset);
		uint256 netDebt = VUSDAmount.mul(GravitaMath.DECIMAL_PRECISION).div(
			GravitaMath.DECIMAL_PRECISION.add(borrowingRate)
		);

		return netDebt;
	}

	function _requireUserHasVessel(address _asset, address _depositor) internal view {
		require(
			vesselManager.getVesselStatus(_asset, _depositor) == 1,
			"BorrowerWrappersScript: caller must have an active vessel"
		);
	}
}
