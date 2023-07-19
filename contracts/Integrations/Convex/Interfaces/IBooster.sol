// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IBooster {
	function depositAll(uint256 _pid, bool _stake) external returns (bool);

	function earmarkRewards(uint256 _pid) external returns (bool);

	function poolInfo(
		uint256 _pid
	)
		external
		view
		returns (address _lptoken, address _token, address _gauge, address _crvRewards, address _stash, bool _shutdown);
}
