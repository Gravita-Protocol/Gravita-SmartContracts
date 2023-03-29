// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface IFeeCollector {

	/** Events ------------------------------------------------------------------------------------------------------- */

	event FeeRecordUpdated(address borrower, address asset, uint256 from, uint256 to, uint256 amount);
	event FeeCollected(address borrower, address asset, address collector, uint256 amount);
	event FeeRefunded(address borrower, address asset, uint256 amount);
	event GRVTStakingAddressChanged(address newAddress);
	event RedemptionFeeCollected(address asset, uint256 amount);
	event RouteToGRVTStakingChanged(bool routeToGRVTStaking);

	/** Structs ------------------------------------------------------------------------------------------------------ */

	struct FeeRecord {
		uint256 from; // timestamp in seconds
		uint256 to; // timestamp in seconds
		uint256 amount; // refundable fee amount
	}

	/** Custom Errors ------------------------------------------------------------------------------------------------ */

	error FeeCollector__ArrayMismatch();
	error FeeCollector__BorrowerOperationsOnly(address sender, address expected);
	error FeeCollector__BorrowerOperationsOrVesselManagerOnly(address sender, address expected1, address expected2);
	error FeeCollector__InvalidGRVTStakingAddress();
	error FeeCollector__VesselManagerOnly(address sender, address expected);

	/** Methods ------------------------------------------------------------------------------------------------------ */


	function setGRVTStakingAddress(address _grvtStakingAddress) external;
	
	function setRouteToGRVTStaking(bool _routeToGRVTStaking) external;

	function increaseDebt(
		address _borrower,
		address _asset,
		uint256 _feeAmount
	) external;

	function decreaseDebt(
		address _borrower,
		address _asset,
		uint256 _paybackFraction
	) external;

	function closeDebt(address _borrower, address _asset) external;

	function liquidateDebt(address _borrower, address _asset) external;

	function simulateRefund(address _borrower, address _asset, uint256 _paybackFraction) external returns (uint256);

	function collectFees(address[] memory _borrowers, address[] memory _assets) external;

	function handleRedemptionFee(address _asset, uint256 _amount) external;
}

