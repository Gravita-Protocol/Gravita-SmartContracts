// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../Interfaces/IVesselManager.sol";
import "../Interfaces/IVesselManagerOperations.sol";

contract VesselManagerScript {
	string public constant NAME = "VesselManagerScript";

	IVesselManager immutable vesselManager;

	constructor(IVesselManager _vesselManager) {
		vesselManager = _vesselManager;
	}

	function redeemCollateral(
		address _asset,
		uint256 _VUSDAmount,
		address _firstRedemptionHint,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR,
		uint256 _maxIterations,
		uint256 _maxFee
	) external {
		vesselManager.vesselManagerOperations().redeemCollateral(
			_asset,
			_VUSDAmount,
			_upperPartialRedemptionHint,
			_lowerPartialRedemptionHint,
			_firstRedemptionHint,
			_partialRedemptionHintNICR,
			_maxIterations,
			_maxFee
		);
	}
}
