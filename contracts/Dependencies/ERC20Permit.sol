// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../Interfaces/IERC2612Permit.sol";

abstract contract ERC20Permit is ERC20, IERC2612Permit {
	mapping(address => uint256) private _nonces;

	// keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
	bytes32 public constant PERMIT_TYPEHASH =
		0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;

	bytes32 public immutable DOMAIN_SEPARATOR;

	constructor() payable {
		DOMAIN_SEPARATOR = keccak256(
			abi.encode(
				keccak256(
					"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
				),
				keccak256(bytes(name())),
				keccak256("1"), // Version
				block.chainid,
				address(this)
			)
		);
	}

	/**
	 * @dev See {IERC2612Permit-permit}.
	 *
	 */
	function permit(
		address owner,
		address spender,
		uint256 amount,
		uint256 deadline,
		uint8 v,
		bytes32 r,
		bytes32 s
	) external virtual override {
		require(block.timestamp <= deadline, "Permit: expired deadline");

		unchecked {
			bytes32 hashStruct = keccak256(
				abi.encode(PERMIT_TYPEHASH, owner, spender, amount, _nonces[owner]++, deadline)
			);

			bytes32 _hash = keccak256(abi.encodePacked(uint16(0x1901), DOMAIN_SEPARATOR, hashStruct));

			address signer = ECDSA.recover(_hash, v, r, s);
			require(signer != address(0) && signer == owner, "ERC20Permit: Invalid signature");

			_approve(owner, spender, amount);
		}
	}

	/**
	 * @dev See {IERC2612Permit-nonces}.
	 */
	function nonces(address owner) external view override returns (uint256) {
		return _nonces[owner];
	}
}
