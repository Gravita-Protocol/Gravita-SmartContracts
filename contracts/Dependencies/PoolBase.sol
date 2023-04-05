// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.19;

import "../Interfaces/IActivePool.sol";
import "../Interfaces/IDefaultPool.sol";
import "./GravitaBase.sol";

/**
 * @notice Base contract for CollSurplusPool and StabilityPool. Inherits from LiquityBase
 * and contains additional array operation functions and _requireCallerIsYetiController()
 */
contract PoolBase is GravitaBase {
	using SafeMathUpgradeable for uint256;
	/**
	 * @dev This empty reserved space is put in place to allow future versions to add new
	 * variables without shifting down storage in the inheritance chain.
	 * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
	 */
	uint256[50] private __gap;

	/**
	 * @notice More efficient version of sumColls when dealing with all whitelisted tokens.
	 *    Used by pool accounting of tokens inside that pool.
	 * @dev Inspired by left join in relational databases, _coll1 is always taken while
	 *    _tokens and _amounts are just added to that side. _coll1 index is actually equal
	 *    always to the index in YetiController of that token. Time complexity depends
	 *    here on the number of whitelisted tokens = L since that it equals pool coll length.
	 *    Time complexity is therefore O(L)
	 */
	function _leftSumColls(
		Colls memory _coll1,
		address[] memory _tokens,
		uint256[] memory _amounts
	) internal pure returns (uint256[] memory) {
		// If nothing on the right side then return the original.
		if (_amounts.length == 0) {
			return _coll1.amounts;
		}

		uint256 coll1Len = _coll1.amounts.length;
		uint256 tokensLen = _tokens.length;
		// Result will always be coll1 len size.
		uint256[] memory sumAmounts = new uint256[](coll1Len);

		uint256 i = 0;
		uint256 j = 0;

		// Sum through all tokens until either left or right side reaches end.
		while (i < tokensLen && j < coll1Len) {
			// If tokens match up then sum them together.
			if (_tokens[i] == _coll1.tokens[j]) {
				sumAmounts[j] = _coll1.amounts[j].add(_amounts[i]);
				++i;
			}
			// Otherwise just take the left side.
			else {
				sumAmounts[j] = _coll1.amounts[j];
			}
			++j;
		}
		// If right side ran out add the remaining amounts in the left side.
		while (j < coll1Len) {
			sumAmounts[j] = _coll1.amounts[j];
			++j;
		}

		return sumAmounts;
	}

	/**
	 * @notice More efficient version of subColls when dealing with all whitelisted tokens.
	 *    Used by pool accounting of tokens inside that pool.
	 * @dev Inspired by left join in relational databases, _coll1 is always taken while
	 *    _tokens and _amounts are just subbed from that side. _coll1 index is actually equal
	 *    always to the index in YetiController of that token. Time complexity depends
	 *    here on the number of whitelisted tokens = L since that it equals pool coll length.
	 *    Time complexity is therefore O(L)
	 */
	function _leftSubColls(
		Colls memory _coll1,
		address[] memory _subTokens,
		uint256[] memory _subAmounts
	) internal pure returns (uint256[] memory) {
		// If nothing on the right side then return the original.
		if (_subTokens.length == 0) {
			return _coll1.amounts;
		}

		uint256 coll1Len = _coll1.amounts.length;
		uint256 tokensLen = _subTokens.length;
		// Result will always be coll1 len size.
		uint256[] memory diffAmounts = new uint256[](coll1Len);

		uint256 i = 0;
		uint256 j = 0;

		// Sub through all tokens until either left or right side reaches end.
		while (i < tokensLen && j < coll1Len) {
			// If tokens match up then subtract them
			if (_subTokens[i] == _coll1.tokens[j]) {
				diffAmounts[j] = _coll1.amounts[j].sub(_subAmounts[i]);
				++i;
			}
			// Otherwise just take the left side.
			else {
				diffAmounts[j] = _coll1.amounts[j];
			}
			++j;
		}
		// If right side ran out add the remaining amounts in the left side.
		while (j < coll1Len) {
			diffAmounts[j] = _coll1.amounts[j];
			++j;
		}

		return diffAmounts;
	}
}
