// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../BorrowerOperations.sol";

/* Tester contract inherits from BorrowerOperations, and provides external functions 
for testing the parent's internal functions. */
contract BorrowerOperationsTester is BorrowerOperations {
	function getNewICRFromVesselChange(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool isCollIncrease,
		uint256 _debtChange,
		bool isDebtIncrease,
		uint256 _price
	) external pure returns (uint256) {
		return
			_getNewICRFromVesselChange(
				_coll,
				_debt,
				_collChange,
				isCollIncrease,
				_debtChange,
				isDebtIncrease,
				_price
			);
	}

	function getNewTCRFromVesselChange(
		address _asset,
		uint256 _collChange,
		bool isCollIncrease,
		uint256 _debtChange,
		bool isDebtIncrease,
		uint256 _price
	) external view returns (uint256) {
		return
			_getNewTCRFromVesselChange(
				_asset,
				_collChange,
				isCollIncrease,
				_debtChange,
				isDebtIncrease,
				_price
			);
	}

	function getUSDValue(uint256 _coll, uint256 _price) external pure returns (uint256) {
		return _getUSDValue(_coll, _price);
	}

	function callInternalAdjustLoan(
		address _asset,
		uint256 _amount,
		address _borrower,
		uint256 _collWithdrawal,
		uint256 _debtChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint
	) external {
		_adjustVessel(
			_asset,
			_amount,
			_borrower,
			_collWithdrawal,
			_debtChange,
			_isDebtIncrease,
			_upperHint,
			_lowerHint
		);
	}

	// Payable fallback function
	receive() external payable {}
}
