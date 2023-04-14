// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../Dependencies/BaseMath.sol";
import "../Dependencies/GravitaMath.sol";

import "../Interfaces/ICommunityIssuance.sol";
import "../Interfaces/IStabilityPool.sol";

contract CommunityIssuance is ICommunityIssuance, OwnableUpgradeable, BaseMath {
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "CommunityIssuance";
	uint256 public constant DISTRIBUTION_DURATION = 7 days / 60;
	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;

	IERC20Upgradeable public grvtToken;
	IStabilityPool public stabilityPool;

	uint256 public totalGRVTIssued;
	uint256 public lastUpdateTime;
	uint256 public GRVTSupplyCap;
	uint256 public grvtDistribution;

	address public adminContract;

	bool public isInitialized;

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	modifier isStabilityPool(address _pool) {
		require(address(stabilityPool) == _pool, "CommunityIssuance: caller is not SP");
		_;
	}

	modifier onlyStabilityPool() {
		require(address(stabilityPool) == msg.sender, "CommunityIssuance: caller is not SP");
		_;
	}

	// --- Functions ---
	function setAddresses(
		address _grvtTokenAddress,
		address _stabilityPoolAddress,
		address _adminContract
	) external override initializer {
		require(!isInitialized, "Already initialized");
		isInitialized = true;
		__Ownable_init();

		adminContract = _adminContract;

		grvtToken = IERC20Upgradeable(_grvtTokenAddress);
		stabilityPool = IStabilityPool(_stabilityPoolAddress);
	}

	function setAdminContract(address _admin) external onlyOwner {
		require(_admin != address(0));
		adminContract = _admin;
	}

	function addFundToStabilityPool(uint256 _assignedSupply) external override isController {
		_addFundToStabilityPoolFrom(_assignedSupply, msg.sender);
	}

	function removeFundFromStabilityPool(uint256 _fundToRemove) external onlyOwner {
		uint256 newCap = GRVTSupplyCap - _fundToRemove;
		require(
			totalGRVTIssued <= newCap,
			"CommunityIssuance: Stability Pool doesn't have enough supply."
		);

		GRVTSupplyCap -= _fundToRemove;

		grvtToken.safeTransfer(msg.sender, _fundToRemove);
	}

	function addFundToStabilityPoolFrom(uint256 _assignedSupply, address _spender)
		external
		override
		isController
	{
		_addFundToStabilityPoolFrom(_assignedSupply, _spender);
	}

	function _addFundToStabilityPoolFrom(uint256 _assignedSupply, address _spender) internal {
		if (lastUpdateTime == 0) {
			lastUpdateTime = block.timestamp;
		}

		GRVTSupplyCap += _assignedSupply;
		grvtToken.safeTransferFrom(_spender, address(this), _assignedSupply);
	}

	function issueGRVT() public override onlyStabilityPool returns (uint256) {
		uint256 maxPoolSupply = GRVTSupplyCap;

		if (totalGRVTIssued >= maxPoolSupply) return 0;

		uint256 issuance = _getLastUpdateTokenDistribution();
		uint256 totalIssuance = issuance + totalGRVTIssued;

		if (totalIssuance > maxPoolSupply) {
			issuance = maxPoolSupply - totalGRVTIssued;
			totalIssuance = maxPoolSupply;
		}

		lastUpdateTime = block.timestamp;
		totalGRVTIssued = totalIssuance;
		emit TotalGRVTIssuedUpdated(totalIssuance);

		return issuance;
	}

	function _getLastUpdateTokenDistribution() internal view returns (uint256) {
		require(lastUpdateTime != 0, "Stability pool hasn't been assigned");
		uint256 timePassed = (block.timestamp - lastUpdateTime) / SECONDS_IN_ONE_MINUTE;
		uint256 totalDistribuedSinceBeginning = grvtDistribution * timePassed;

		return totalDistribuedSinceBeginning;
	}

	function sendGRVT(address _account, uint256 _GRVTamount)
		external
		override
		onlyStabilityPool
	{
		uint256 balanceGRVT = grvtToken.balanceOf(address(this));
		uint256 safeAmount = balanceGRVT >= _GRVTamount ? _GRVTamount : balanceGRVT;

		if (safeAmount == 0) {
			return;
		}

		IERC20Upgradeable(address(grvtToken)).safeTransfer(_account, safeAmount);
	}

	function setWeeklyGrvtDistribution(uint256 _weeklyReward) external isController {
		grvtDistribution = _weeklyReward / DISTRIBUTION_DURATION;
	}
}
