// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/**
 * @notice Interface for reading dAPI data feeds from https://market.api3.org/dapis
 */
interface API3ProxyInterface {
	function read() external view returns (int224 value, uint32 timestamp);
}

/// @see https://vscode.blockscan.com/arbitrum-one/0x26690F9f17FdC26D419371315bc17950a0FC90eD

/// @dev The proxy contracts are generalized to support most types of numerical
/// data feeds. This means that the user of this proxy is expected to validate
/// the read values according to the specific use-case. For example, `value` is
/// a signed integer, yet it being negative may not make sense in the case that
/// the data feed represents the spot price of an asset. In that case, the user
/// is responsible with ensuring that `value` is not negative.
/// In the case that the data feed is from a single source, `timestamp` is the
/// system time of the Airnode when it signed the data. In the case that the
/// data feed is from multiple sources, `timestamp` is the median of system
/// times of the Airnodes when they signed the respective data. There are two
/// points to consider while using `timestamp` in your contract logic: (1) It
/// is based on the system time of the Airnodes, and not the block timestamp.
/// This may be relevant when either of them drifts. (2) `timestamp` is an
/// off-chain value that is being reported, similar to `value`. Both should
/// only be trusted as much as the Airnode(s) that report them.
