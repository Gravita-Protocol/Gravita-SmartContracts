// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.19;

import "./GravitaBase.sol";

contract PoolBase is GravitaBase {
	/**
	 * @dev This empty reserved space is put in place to allow future versions to add new
	 * variables without shifting down storage in the inheritance chain.
	 * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
	 */
	uint256[50] private __gap;

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

	function _leftSubColls(
		Colls memory _coll1,
		address[] memory _tokens,
		uint256[] memory _amounts
	) internal pure returns (uint256[] memory) {
		uint256 coll1Len = _coll1.amounts.length;
		uint256 tokensLen = _tokens.length;

		for (uint256 i = 0; i < coll1Len; ) {
			for (uint256 j = 0; j < tokensLen; ) {
				if (_coll1.tokens[i] == _tokens[j]) {
					_coll1.amounts[i] -= _amounts[j];
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
}
