// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../Interfaces/IBorrowerOperations.sol";

contract BorrowerOperationsScript  {
	IBorrowerOperations immutable borrowerOperations;

	constructor(IBorrowerOperations _borrowerOperations) {
		borrowerOperations = _borrowerOperations;
	}

	function openVessel(
		address _asset,
		uint256 _assetAmountSent,
		uint256 _debtTokenAmount,
		address _upperHint,
		address _lowerHint
	) external {
		borrowerOperations.openVessel(
			_asset,
			_assetAmountSent,
			_debtTokenAmount,
			_upperHint,
			_lowerHint
		);
	}

	function addColl(
		address _asset,
		uint256 _assetAmountSent,
		address _upperHint,
		address _lowerHint
	) external payable {
		borrowerOperations.addColl(
			_asset,
			_assetAmountSent,
			_upperHint,
			_lowerHint
		);
	}

	function withdrawColl(
		address _asset,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		borrowerOperations.withdrawColl(_asset, _amount, _upperHint, _lowerHint);
	}

	function withdrawDebtTokens(
		address _asset,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		borrowerOperations.withdrawDebtTokens(_asset,  _amount, _upperHint, _lowerHint);
	}

	function repayDebtTokens(
		address _asset,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		borrowerOperations.repayDebtTokens(_asset, _amount, _upperHint, _lowerHint);
	}

	function closeVessel(address _asset) external {
		borrowerOperations.closeVessel(_asset);
	}

	function adjustVessel(
		address _asset,
		uint256 _assetAmountSent,
		uint256 _collWithdrawal,
		uint256 _debtChange,
		bool isDebtIncrease,
		address _upperHint,
		address _lowerHint
	) external payable {
		borrowerOperations.adjustVessel(
			_asset,
			_assetAmountSent,
			_collWithdrawal,
			_debtChange,
			isDebtIncrease,
			_upperHint,
			_lowerHint
		);
	}

	function claimCollateral(address _asset) external {
		borrowerOperations.claimCollateral(_asset);
	}

}
