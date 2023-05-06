// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "../StabilityPool.sol";

contract StabilityPoolTester is StabilityPool {
	uint256 assetBalance = 0;

	function unprotectedPayable() external payable {
		assetBalance = assetBalance + msg.value;
	}

	function setCurrentScale(uint128 _currentScale) external {
		currentScale = _currentScale;
	}

	function setTotalDeposits(uint256 _totalDebtTokenDeposits) external {
		totalDebtTokenDeposits = _totalDebtTokenDeposits;
	}

	function _leftSumColls(
		Colls memory _coll1,
		address[] memory _tokens,
		uint256[] memory _amounts
	) internal pure returns (uint256[] memory) {
		if (_amounts.length == 0) {
			return _coll1.amounts;
		}

		uint256 coll1Len = _coll1.amounts.length;
		uint256 tokensLen = _tokens.length;

		for (uint256 i = 0; i < coll1Len; ) {
			for (uint256 j = 0; j < tokensLen; ) {
				if (_coll1.tokens[i] == _tokens[j]) {
					_coll1.amounts[i] += _amounts[j];
				}
				unchecked {
					j++;
				}
			}
			unchecked {
				i++;
			}
		}

		return _coll1.amounts;
	}

	function leftSumColls(
		Colls memory _coll1,
		address[] memory _tokens,
		uint256[] memory _amounts
	) external pure returns (uint256[] memory) {
		return _leftSumColls(_coll1, _tokens, _amounts);
	}

	function leftSubColls(
		Colls memory _coll1,
		address[] memory _subTokens,
		uint256[] memory _subAmounts
	) external pure returns (uint256[] memory) {
		return _leftSubColls(_coll1, _subTokens, _subAmounts);
	}
}
