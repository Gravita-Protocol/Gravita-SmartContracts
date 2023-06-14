// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IBorrowerOperations {
	// --- Enums ---
	enum BorrowerOperation {
		openVessel,
		closeVessel,
		adjustVessel
	}

	// --- Events ---

	event BorrowingFeePaid(address indexed _asset, address indexed _borrower, uint256 _feeAmount);
	event VesselCreated(address indexed _asset, address indexed _borrower, uint256 arrayIndex);
	event VesselUpdated(
		address indexed _asset,
		address indexed _borrower,
		uint256 _debt,
		uint256 _coll,
		uint256 stake,
		BorrowerOperation operation
	);

	// --- Functions ---

	function openVessel(
		address _asset,
		uint256 _assetAmount,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint,
		bytes[] calldata _pythPriceUpdateData
	) external payable;

	function addColl(
		address _asset,
		uint256 _assetSent,
		address _upperHint,
		address _lowerHint,
		bytes[] calldata _pythPriceUpdateData
	) external payable;

	function withdrawColl(
		address _asset,
		uint256 _assetAmount,
		address _upperHint,
		address _lowerHint,
		bytes[] calldata _pythPriceUpdateData
	) external payable;

	function withdrawDebtTokens(
		address _asset,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint,
		bytes[] calldata _pythPriceUpdateData
	) external payable;

	function repayDebtTokens(
		address _asset,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint,
		bytes[] calldata _pythPriceUpdateData
	) external payable;

	function closeVessel(address _asset, bytes[] calldata _pythPriceUpdateData) external payable;

	function adjustVessel(
		address _asset,
		uint256 _assetSent,
		uint256 _collWithdrawal,
		uint256 _debtChange,
		bool isDebtIncrease,
		address _upperHint,
		address _lowerHint,
		bytes[] calldata _pythPriceUpdateData
	) external payable;

	function claimCollateral(address _asset) external;

	function getCompositeDebt(address _asset, uint256 _debt) external view returns (uint256);
}
