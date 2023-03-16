// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/*
This contract is reserved for Linear Vesting to the Team members and the Advisors team.
*/
contract LockedGRVT is Ownable {
	using SafeERC20 for IERC20;
	using SafeMath for uint256;

	struct Rule {
		uint256 createdDate;
		uint256 totalSupply;
		uint256 startVestingDate;
		uint256 endVestingDate;
		uint256 claimed;
	}

	string public constant NAME = "LockedGRVT";
	uint256 public constant SIX_MONTHS = 26 weeks;
	uint256 public constant TWO_YEARS = 730 days;

	bool public isInitialized;

	IERC20 private grvtToken;
	uint256 private assignedGRVTTokens;

	mapping(address => Rule) public entitiesVesting;

	modifier entityRuleExists(address _entity) {
		require(entitiesVesting[_entity].createdDate != 0, "Entity doesn't have a Vesting Rule");
		_;
	}

	function setAddresses(address _grvtAddress) public onlyOwner {
		require(!isInitialized, "Already Initialized");
		isInitialized = true;

		grvtToken = IERC20(_grvtAddress);
	}

	function addEntityVesting(address _entity, uint256 _totalSupply) public onlyOwner {
		require(address(0) != _entity, "Invalid Address");

		require(entitiesVesting[_entity].createdDate == 0, "Entity already has a Vesting Rule");

		assignedGRVTTokens += _totalSupply;

		entitiesVesting[_entity] = Rule(
			block.timestamp,
			_totalSupply,
			block.timestamp.add(SIX_MONTHS),
			block.timestamp.add(TWO_YEARS),
			0
		);

		grvtToken.safeTransferFrom(msg.sender, address(this), _totalSupply);
	}

	function lowerEntityVesting(address _entity, uint256 newTotalSupply)
		public
		onlyOwner
		entityRuleExists(_entity)
	{
		sendGRVTTokenToEntity(_entity);
		Rule storage vestingRule = entitiesVesting[_entity];

		require(
			newTotalSupply > vestingRule.claimed,
			"Total Supply goes lower or equal than the claimed total."
		);

		vestingRule.totalSupply = newTotalSupply;
	}

	function removeEntityVesting(address _entity) public onlyOwner entityRuleExists(_entity) {
		sendGRVTTokenToEntity(_entity);
		Rule memory vestingRule = entitiesVesting[_entity];

		assignedGRVTTokens = assignedGRVTTokens.sub(
			vestingRule.totalSupply.sub(vestingRule.claimed)
		);

		delete entitiesVesting[_entity];
	}

	function claimGRVTToken() public entityRuleExists(msg.sender) {
		sendGRVTTokenToEntity(msg.sender);
	}

	function sendGRVTTokenToEntity(address _entity) private {
		uint256 unclaimedAmount = getClaimableGRVT(_entity);
		if (unclaimedAmount == 0) return;

		Rule storage entityRule = entitiesVesting[_entity];
		entityRule.claimed += unclaimedAmount;

		assignedGRVTTokens = assignedGRVTTokens.sub(unclaimedAmount);
		grvtToken.safeTransfer(_entity, unclaimedAmount);
	}

	function transferUnassignedGRVT() external onlyOwner {
		uint256 unassignedTokens = getUnassignGRVTTokensAmount();

		if (unassignedTokens == 0) return;

		grvtToken.safeTransfer(msg.sender, unassignedTokens);
	}

	function getClaimableGRVT(address _entity) public view returns (uint256 claimable) {
		Rule memory entityRule = entitiesVesting[_entity];
		claimable = 0;

		if (entityRule.startVestingDate > block.timestamp) return claimable;

		if (block.timestamp >= entityRule.endVestingDate) {
			claimable = entityRule.totalSupply.sub(entityRule.claimed);
		} else {
			claimable = entityRule
				.totalSupply
				.div(TWO_YEARS)
				.mul(block.timestamp.sub(entityRule.createdDate))
				.sub(entityRule.claimed);
		}

		return claimable;
	}

	function getUnassignGRVTTokensAmount() public view returns (uint256) {
		return grvtToken.balanceOf(address(this)).sub(assignedGRVTTokens);
	}

	function isEntityExits(address _entity) public view returns (bool) {
		return entitiesVesting[_entity].createdDate != 0;
	}
}
