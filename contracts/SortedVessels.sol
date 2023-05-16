// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;
import "./Addresses.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./Interfaces/ISortedVessels.sol";
import "./Interfaces/IVesselManager.sol";

/*
 * A sorted doubly linked list with nodes sorted in descending order.
 *
 * Nodes map to active Vessels in the system - the ID property is the address of a Vessel owner.
 * Nodes are ordered according to their current nominal individual collateral ratio (NICR),
 * which is like the ICR but without the price, i.e., just collateral / debt.
 *
 * The list optionally accepts insert position hints.
 *
 * NICRs are computed dynamically at runtime, and not stored on the Node. This is because NICRs of active Vessels
 * change dynamically as liquidation events occur.
 *
 * The list relies on the fact that liquidation events preserve ordering: a liquidation decreases the NICRs of all active Vessels,
 * but maintains their order. A node inserted based on current NICR will maintain the correct position,
 * relative to it's peers, as rewards accumulate, as long as it's raw collateral and debt have not changed.
 * Thus, Nodes remain sorted by current NICR.
 *
 * Nodes need only be re-inserted upon a Vessel operation - when the owner adds or removes collateral or debt
 * to their position.
 *
 * The list is a modification of the following audited SortedDoublyLinkedList:
 * https://github.com/livepeer/protocol/blob/master/contracts/libraries/SortedDoublyLL.sol
 *
 *
 * Changes made in the Gravita implementation:
 *
 * - Keys have been removed from nodes
 *
 * - Ordering checks for insertion are performed by comparing an NICR argument to the current NICR, calculated at runtime.
 *   The list relies on the property that ordering by ICR is maintained as the ETH:USD price varies.
 *
 * - Public functions with parameters have been made internal to save gas, and given an external wrapper function for external access
 */
contract SortedVessels is OwnableUpgradeable, UUPSUpgradeable, ISortedVessels, Addresses {
	string public constant NAME = "SortedVessels";

	// Information for a node in the list
	struct Node {
		bool exists;
		address nextId; // Id of next node (smaller NICR) in the list
		address prevId; // Id of previous node (larger NICR) in the list
	}

	// Information for the list
	struct Data {
		address head; // Head of the list. Also the node in the list with the largest NICR
		address tail; // Tail of the list. Also the node in the list with the smallest NICR
		uint256 size; // Current size of the list
		// Depositor address => node
		mapping(address => Node) nodes; // Track the corresponding ids for each node in the list
	}

	// Collateral type address => ordered list
	mapping(address => Data) public data;

	// --- Initializer ---

	function initialize() public initializer {
		__Ownable_init();
		__UUPSUpgradeable_init();
	}

	/*
	 * @dev Add a node to the list
	 * @param _id Node's id
	 * @param _NICR Node's NICR
	 * @param _prevId Id of previous node for the insert position
	 * @param _nextId Id of next node for the insert position
	 */

	function insert(address _asset, address _id, uint256 _NICR, address _prevId, address _nextId) external override {
		_requireCallerIsBOorVesselM();
		_insert(_asset, _id, _NICR, _prevId, _nextId);
	}

	function _insert(address _asset, address _id, uint256 _NICR, address _prevId, address _nextId) internal {
		Data storage assetData = data[_asset];

		// List must not already contain node
		require(!_contains(assetData, _id), "SortedVessels: List already contains the node");
		// Node id must not be null
		require(_id != address(0), "SortedVessels: Id cannot be zero");
		// NICR must be non-zero
		require(_NICR != 0, "SortedVessels: NICR must be positive");

		address prevId = _prevId;
		address nextId = _nextId;

		if (!_validInsertPosition(_asset, _NICR, prevId, nextId)) {
			// Sender's hint was not a valid insert position
			// Use sender's hint to find a valid insert position
			(prevId, nextId) = _findInsertPosition(_asset, _NICR, prevId, nextId);
		}

		Node storage node = assetData.nodes[_id];
		node.exists = true;

		if (prevId == address(0) && nextId == address(0)) {
			// Insert as head and tail
			assetData.head = _id;
			assetData.tail = _id;
		} else if (prevId == address(0)) {
			// Insert before `prevId` as the head
			node.nextId = assetData.head;
			assetData.nodes[assetData.head].prevId = _id;
			assetData.head = _id;
		} else if (nextId == address(0)) {
			// Insert after `nextId` as the tail
			node.prevId = assetData.tail;
			assetData.nodes[assetData.tail].nextId = _id;
			assetData.tail = _id;
		} else {
			// Insert at insert position between `prevId` and `nextId`
			node.nextId = nextId;
			node.prevId = prevId;
			assetData.nodes[prevId].nextId = _id;
			assetData.nodes[nextId].prevId = _id;
		}

		assetData.size = assetData.size + 1;
		emit NodeAdded(_asset, _id, _NICR);
	}

	function remove(address _asset, address _id) external override {
		_requireCallerIsVesselManager();
		_remove(_asset, _id);
	}

	/*
	 * @dev Remove a node from the list
	 * @param _id Node's id
	 */
	function _remove(address _asset, address _id) internal {
		Data storage assetData = data[_asset];

		// List must contain the node
		require(_contains(assetData, _id), "SortedVessels: List does not contain the id");

		Node storage node = assetData.nodes[_id];
		if (assetData.size > 1) {
			// List contains more than a single node
			if (_id == assetData.head) {
				// The removed node is the head
				// Set head to next node
				assetData.head = node.nextId;
				// Set prev pointer of new head to null
				assetData.nodes[assetData.head].prevId = address(0);
			} else if (_id == assetData.tail) {
				// The removed node is the tail
				// Set tail to previous node
				assetData.tail = node.prevId;
				// Set next pointer of new tail to null
				assetData.nodes[assetData.tail].nextId = address(0);
			} else {
				// The removed node is neither the head nor the tail
				// Set next pointer of previous node to the next node
				assetData.nodes[node.prevId].nextId = node.nextId;
				// Set prev pointer of next node to the previous node
				assetData.nodes[node.nextId].prevId = node.prevId;
			}
		} else {
			// List contains a single node
			// Set the head and tail to null
			assetData.head = address(0);
			assetData.tail = address(0);
		}

		delete assetData.nodes[_id];
		assetData.size = assetData.size - 1;
		emit NodeRemoved(_asset, _id);
	}

	/*
	 * @dev Re-insert the node at a new position, based on its new NICR
	 * @param _id Node's id
	 * @param _newNICR Node's new NICR
	 * @param _prevId Id of previous node for the new insert position
	 * @param _nextId Id of next node for the new insert position
	 */
	function reInsert(address _asset, address _id, uint256 _newNICR, address _prevId, address _nextId) external override {
		_requireCallerIsBOorVesselM();
		// List must contain the node
		require(contains(_asset, _id), "SortedVessels: List does not contain the id");
		// NICR must be non-zero
		require(_newNICR != 0, "SortedVessels: NICR must be positive");

		// Remove node from the list
		_remove(_asset, _id);

		_insert(_asset, _id, _newNICR, _prevId, _nextId);
	}

	/*
	 * @dev Checks if the list contains a node
	 */
	function contains(address _asset, address _id) public view override returns (bool) {
		return data[_asset].nodes[_id].exists;
	}

	function _contains(Data storage _dataAsset, address _id) internal view returns (bool) {
		return _dataAsset.nodes[_id].exists;
	}

	/*
	 * @dev Checks if the list is empty
	 */
	function isEmpty(address _asset) public view override returns (bool) {
		return data[_asset].size == 0;
	}

	/*
	 * @dev Returns the current size of the list
	 */
	function getSize(address _asset) external view override returns (uint256) {
		return data[_asset].size;
	}

	/*
	 * @dev Returns the first node in the list (node with the largest NICR)
	 */
	function getFirst(address _asset) external view override returns (address) {
		return data[_asset].head;
	}

	/*
	 * @dev Returns the last node in the list (node with the smallest NICR)
	 */
	function getLast(address _asset) external view override returns (address) {
		return data[_asset].tail;
	}

	/*
	 * @dev Returns the next node (with a smaller NICR) in the list for a given node
	 * @param _id Node's id
	 */
	function getNext(address _asset, address _id) external view override returns (address) {
		return data[_asset].nodes[_id].nextId;
	}

	/*
	 * @dev Returns the previous node (with a larger NICR) in the list for a given node
	 * @param _id Node's id
	 */
	function getPrev(address _asset, address _id) external view override returns (address) {
		return data[_asset].nodes[_id].prevId;
	}

	/*
	 * @dev Check if a pair of nodes is a valid insertion point for a new node with the given NICR
	 * @param _NICR Node's NICR
	 * @param _prevId Id of previous node for the insert position
	 * @param _nextId Id of next node for the insert position
	 */
	function validInsertPosition(
		address _asset,
		uint256 _NICR,
		address _prevId,
		address _nextId
	) external view override returns (bool) {
		return _validInsertPosition(_asset, _NICR, _prevId, _nextId);
	}

	function _validInsertPosition(
		address _asset,
		uint256 _NICR,
		address _prevId,
		address _nextId
	) internal view returns (bool) {
		if (_prevId == address(0) && _nextId == address(0)) {
			// `(null, null)` is a valid insert position if the list is empty
			return isEmpty(_asset);
		} else if (_prevId == address(0)) {
			// `(null, _nextId)` is a valid insert position if `_nextId` is the head of the list
			return data[_asset].head == _nextId && _NICR >= IVesselManager(vesselManager).getNominalICR(_asset, _nextId);
		} else if (_nextId == address(0)) {
			// `(_prevId, null)` is a valid insert position if `_prevId` is the tail of the list
			return data[_asset].tail == _prevId && _NICR <= IVesselManager(vesselManager).getNominalICR(_asset, _prevId);
		} else {
			// `(_prevId, _nextId)` is a valid insert position if they are adjacent nodes and `_NICR` falls between the two nodes' NICRs
			return
				data[_asset].nodes[_prevId].nextId == _nextId &&
				IVesselManager(vesselManager).getNominalICR(_asset, _prevId) >= _NICR &&
				_NICR >= IVesselManager(vesselManager).getNominalICR(_asset, _nextId);
		}
	}

	/*
	 * @dev Descend the list (larger NICRs to smaller NICRs) to find a valid insert position
	 * @param _vesselManager VesselManager contract, passed in as param to save SLOAD’s
	 * @param _NICR Node's NICR
	 * @param _startId Id of node to start descending the list from
	 */
	function _descendList(address _asset, uint256 _NICR, address _startId) internal view returns (address, address) {
		Data storage assetData = data[_asset];

		// If `_startId` is the head, check if the insert position is before the head
		if (assetData.head == _startId && _NICR >= IVesselManager(vesselManager).getNominalICR(_asset, _startId)) {
			return (address(0), _startId);
		}

		address prevId = _startId;
		address nextId = assetData.nodes[prevId].nextId;

		// Descend the list until we reach the end or until we find a valid insert position
		while (prevId != address(0) && !_validInsertPosition(_asset, _NICR, prevId, nextId)) {
			prevId = assetData.nodes[prevId].nextId;
			nextId = assetData.nodes[prevId].nextId;
		}

		return (prevId, nextId);
	}

	/*
	 * @dev Ascend the list (smaller NICRs to larger NICRs) to find a valid insert position
	 * @param _vesselManager VesselManager contract, passed in as param to save SLOAD’s
	 * @param _NICR Node's NICR
	 * @param _startId Id of node to start ascending the list from
	 */
	function _ascendList(address _asset, uint256 _NICR, address _startId) internal view returns (address, address) {
		Data storage assetData = data[_asset];

		// If `_startId` is the tail, check if the insert position is after the tail
		if (assetData.tail == _startId && _NICR <= IVesselManager(vesselManager).getNominalICR(_asset, _startId)) {
			return (_startId, address(0));
		}

		address nextId = _startId;
		address prevId = assetData.nodes[nextId].prevId;

		// Ascend the list until we reach the end or until we find a valid insertion point
		while (nextId != address(0) && !_validInsertPosition(_asset, _NICR, prevId, nextId)) {
			nextId = assetData.nodes[nextId].prevId;
			prevId = assetData.nodes[nextId].prevId;
		}

		return (prevId, nextId);
	}

	/*
	 * @dev Find the insert position for a new node with the given NICR
	 * @param _NICR Node's NICR
	 * @param _prevId Id of previous node for the insert position
	 * @param _nextId Id of next node for the insert position
	 */
	function findInsertPosition(
		address _asset,
		uint256 _NICR,
		address _prevId,
		address _nextId
	) external view override returns (address, address) {
		return _findInsertPosition(_asset, _NICR, _prevId, _nextId);
	}

	function _findInsertPosition(
		address _asset,
		uint256 _NICR,
		address _prevId,
		address _nextId
	) internal view returns (address, address) {
		address prevId = _prevId;
		address nextId = _nextId;

		if (prevId != address(0)) {
			if (!contains(_asset, prevId) || _NICR > IVesselManager(vesselManager).getNominalICR(_asset, prevId)) {
				// `prevId` does not exist anymore or now has a smaller NICR than the given NICR
				prevId = address(0);
			}
		}

		if (nextId != address(0)) {
			if (!contains(_asset, nextId) || _NICR < IVesselManager(vesselManager).getNominalICR(_asset, nextId)) {
				// `nextId` does not exist anymore or now has a larger NICR than the given NICR
				nextId = address(0);
			}
		}

		if (prevId == address(0) && nextId == address(0)) {
			// No hint - descend list starting from head
			return _descendList(_asset, _NICR, data[_asset].head);
		} else if (prevId == address(0)) {
			// No `prevId` for hint - ascend list starting from `nextId`
			return _ascendList(_asset, _NICR, nextId);
		} else if (nextId == address(0)) {
			// No `nextId` for hint - descend list starting from `prevId`
			return _descendList(_asset, _NICR, prevId);
		} else {
			// Descend list starting from `prevId`
			return _descendList(_asset, _NICR, prevId);
		}
	}

	// --- 'require' functions ---

	function _requireCallerIsVesselManager() internal view {
		require(msg.sender == address(vesselManager), "SortedVessels: Caller is not the VesselManager");
	}

	function _requireCallerIsBOorVesselM() internal view {
		require(
			msg.sender == address(borrowerOperations) || msg.sender == address(vesselManager),
			"SortedVessels: Caller is neither BO nor VesselM"
		);
	}

	function authorizeUpgrade(address newImplementation) public {
		_authorizeUpgrade(newImplementation);
	}

	function _authorizeUpgrade(address) internal override onlyOwner {}
}
