const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { TestHelper: th } = require("../utils/testHelpers.js")

const DSProxyFactory = artifacts.require("DSProxyFactory")
const DSProxy = artifacts.require("DSProxy")

const buildUserProxies = async users => {
	const proxies = {}
	const proxyFactory = await DSProxyFactory.new()
	for (let user of users) {
		const proxyTx = await proxyFactory.build({ from: user })
		proxies[user] = await DSProxy.at(proxyTx.logs[0].args.proxy)
	}

	return proxies
}

class Proxy {
	constructor(owner, proxies, scriptAddress, contract) {
		this.owner = owner
		this.proxies = proxies
		this.scriptAddress = scriptAddress
		this.contract = contract
		if (contract) this.address = contract.address
	}

	getFrom(params) {
		if (params.length == 0) return this.owner
		let lastParam = params[params.length - 1]
		if (lastParam.from) {
			return lastParam.from
		}

		return this.owner
	}

	getOptionalParams(params) {
		if (params.length == 0) return {}

		return params[params.length - 1]
	}

	getProxyAddressFromUser(user) {
		return this.proxies[user] ? this.proxies[user].address : user
	}

	getProxyFromUser(user) {
		return this.proxies[user]
	}

	getProxyFromParams(params) {
		const user = this.getFrom(params)
		return this.proxies[user]
	}

	getSlicedParams(params) {
		if (params.length == 0) return params
		let lastParam = params[params.length - 1]
		if (lastParam.from || lastParam.value) {
			return params.slice(0, -1)
		}

		return params
	}

	async forwardFunction(params, signature) {
		const proxy = this.getProxyFromParams(params)
		if (!proxy) {
			return this.proxyFunction(signature.slice(0, signature.indexOf("(")), params)
		}
		const optionalParams = this.getOptionalParams(params)
		const calldata = th.getTransactionData(signature, this.getSlicedParams(params))
		// console.log('proxy: ', proxy.address)
		// console.log(this.scriptAddress, calldata, optionalParams)
		return proxy.methods["execute(address,bytes)"](
			this.scriptAddress,
			calldata,
			optionalParams
		)
	}

	async proxyFunctionWithUser(functionName, user) {
		return this.contract[functionName](this.getProxyAddressFromUser(user))
	}

	async proxyFunction(functionName, params) {
		// console.log('contract: ', this.contract.address)
		// console.log('functionName: ', functionName)
		// console.log('params: ', params)
		return this.contract[functionName](...params)
	}
}

class BorrowerOperationsProxy extends Proxy {
	constructor(owner, proxies, borrowerOperationsScriptAddress, borrowerOperations) {
		super(owner, proxies, borrowerOperationsScriptAddress, borrowerOperations)
	}

	async openVessel(...params) {
		return this.forwardFunction(
			params,
			"openVessel(address,uint256,uint256,uint256,address,address)"
		)
	}

	async addColl(...params) {
		return this.forwardFunction(params, "addColl(address,address)")
	}

	async withdrawColl(...params) {
		return this.forwardFunction(params, "withdrawColl(uint256,address,address)")
	}

	async withdrawVUSD(...params) {
		return this.forwardFunction(params, "withdrawDebtTokens(uint256,uint256,address,address)")
	}

	async repayVUSD(...params) {
		return this.forwardFunction(params, "repayVUSD(uint256,address,address)")
	}

	async closeVessel(...params) {
		return this.forwardFunction(params, "closeVessel()")
	}

	async adjustVessel(...params) {
		return this.forwardFunction(
			params,
			"adjustVessel(uint256,uint256,uint256,bool,address,address)"
		)
	}

	async claimRedeemedCollateral(...params) {
		return this.forwardFunction(params, "claimRedeemedCollateral(address)")
	}

	async getNewTCRFromVesselChange(...params) {
		return this.proxyFunction("getNewTCRFromVesselChange", params)
	}

	async getNewICRFromVesselChange(...params) {
		return this.proxyFunction("getNewICRFromVesselChange", params)
	}

	async getCompositeDebt(...params) {
		return this.proxyFunction("getCompositeDebt", params)
	}

	async VUSD_GAS_COMPENSATION(...params) {
		return this.proxyFunction("VUSD_GAS_COMPENSATION", params)
	}

	async MIN_NET_DEBT(...params) {
		return this.proxyFunction("MIN_NET_DEBT", params)
	}

	async BORROWING_FEE_FLOOR(...params) {
		return this.proxyFunction("BORROWING_FEE_FLOOR", params)
	}
}

class BorrowerWrappersProxy extends Proxy {
	constructor(owner, proxies, borrowerWrappersScriptAddress) {
		super(owner, proxies, borrowerWrappersScriptAddress, null)
	}

	async claimCollateralAndOpenVessel(...params) {
		return this.forwardFunction(
			params,
			"claimCollateralAndOpenVessel(uint256,uint256,address,address)"
		)
	}

	async claimSPRewardsAndRecycle(...params) {
		return this.forwardFunction(params, "claimSPRewardsAndRecycle(uint256,address,address)")
	}

	async claimStakingGainsAndRecycle(...params) {
		return this.forwardFunction(params, "claimStakingGainsAndRecycle(uint256,address,address)")
	}

	async transferETH(...params) {
		return this.forwardFunction(params, "transferETH(address,uint256)")
	}
}

class VesselManagerProxy extends Proxy {
	constructor(owner, proxies, vesselManagerScriptAddress, vesselManager) {
		super(owner, proxies, vesselManagerScriptAddress, vesselManager)
	}

	async Vessels(user) {
		return this.proxyFunctionWithUser("Vessels", user)
	}

	async getVesselStatus(user) {
		return this.proxyFunctionWithUser("getVesselStatus", user)
	}

	async getVesselDebt(user) {
		return this.proxyFunctionWithUser("getVesselDebt", user)
	}

	async getVesselColl(user) {
		return this.proxyFunctionWithUser("getVesselColl", user)
	}

	async totalStakes() {
		return this.proxyFunction("totalStakes", [])
	}

	async getPendingETHReward(...params) {
		return this.proxyFunction("getPendingETHReward", params)
	}

	async getPendingDebtTokenReward(...params) {
		return this.proxyFunction("getPendingDebtTokenReward", params)
	}

	async liquidate(user) {
		return this.proxyFunctionWithUser("liquidate", user)
	}

	async getTCR(...params) {
		return this.proxyFunction("getTCR", params)
	}

	async getCurrentICR(user, price) {
		return this.contract.getCurrentICR(this.getProxyAddressFromUser(user), price)
	}

	async checkRecoveryMode(...params) {
		return this.proxyFunction("checkRecoveryMode", params)
	}

	async getVesselOwnersCount() {
		return this.proxyFunction("getVesselOwnersCount", [])
	}

	async baseRate() {
		return this.proxyFunction("baseRate", [])
	}

	async L_ETH() {
		return this.proxyFunction("L_ASSETS", [ZERO_ADDRESS])
	}

	async L_VUSDDebt() {
		return this.proxyFunction("L_VUSDDebts", [ZERO_ADDRESS])
	}

	async rewardSnapshots(user) {
		return this.proxyFunctionWithUser("rewardSnapshots", user)
	}

	async lastFeeOperationTime() {
		return this.proxyFunction("lastFeeOperationTime", [])
	}

	async redeemCollateral(...params) {
		return this.forwardFunction(
			params,
			"redeemCollateral(address,uint256,address,address,address,uint256,uint256,uint256)"
		)
	}

	async getActualDebtFromComposite(...params) {
		return this.proxyFunction("getActualDebtFromComposite", params)
	}

	async getRedemptionFeeWithDecay(...params) {
		return this.proxyFunction("getRedemptionFeeWithDecay", params)
	}

	async getBorrowingRate() {
		return this.proxyFunction("getBorrowingRate", [])
	}

	async getBorrowingRateWithDecay() {
		return this.proxyFunction("getBorrowingRateWithDecay", [])
	}

	async getBorrowingFee(...params) {
		return this.proxyFunction("getBorrowingFee", params)
	}

	async getBorrowingFeeWithDecay(...params) {
		return this.proxyFunction("getBorrowingFeeWithDecay", params)
	}

	async getEntireDebtAndColl(...params) {
		return this.proxyFunction("getEntireDebtAndColl", params)
	}
}

class StabilityPoolProxy extends Proxy {
	constructor(owner, proxies, stabilityPoolScriptAddress, stabilityPool) {
		super(owner, proxies, stabilityPoolScriptAddress, stabilityPool)
	}

	async provideToSP(...params) {
		return this.forwardFunction(params, "provideToSP(uint256,address)")
	}

	async getCompoundedDebtTokenDeposits(user) {
		return this.proxyFunctionWithUser("getCompoundedDebtTokenDeposits", user)
	}

	async deposits(user) {
		return this.proxyFunctionWithUser("deposits", user)
	}

	async getDepositorETHGain(user) {
		return this.proxyFunctionWithUser("getDepositorETHGain", user)
	}
}

class SortedVesselsProxy extends Proxy {
	constructor(owner, proxies, sortedVessels) {
		super(owner, proxies, null, sortedVessels)
	}

	async contains(user) {
		return this.proxyFunctionWithUser("contains", user)
	}

	async isEmpty(user) {
		return this.proxyFunctionWithUser("isEmpty", user)
	}

	async findInsertPosition(...params) {
		return this.proxyFunction("findInsertPosition", params)
	}
}

class TokenProxy extends Proxy {
	constructor(owner, proxies, tokenScriptAddress, token) {
		super(owner, proxies, tokenScriptAddress, token)
	}

	async transfer(...params) {
		// switch destination to proxy if any
		params[0] = this.getProxyAddressFromUser(params[0])
		return this.forwardFunction(params, "transfer(address,uint256)")
	}

	async transferFrom(...params) {
		// switch to proxies if any
		params[0] = this.getProxyAddressFromUser(params[0])
		params[1] = this.getProxyAddressFromUser(params[1])
		return this.forwardFunction(params, "transferFrom(address,address,uint256)")
	}

	async approve(...params) {
		// switch destination to proxy if any
		params[0] = this.getProxyAddressFromUser(params[0])
		return this.forwardFunction(params, "approve(address,uint256)")
	}

	async increaseAllowance(...params) {
		// switch destination to proxy if any
		params[0] = this.getProxyAddressFromUser(params[0])
		return this.forwardFunction(params, "increaseAllowance(address,uint256)")
	}

	async decreaseAllowance(...params) {
		// switch destination to proxy if any
		params[0] = this.getProxyAddressFromUser(params[0])
		return this.forwardFunction(params, "decreaseAllowance(address,uint256)")
	}

	async totalSupply(...params) {
		return this.proxyFunction("totalSupply", params)
	}

	async balanceOf(user) {
		return this.proxyFunctionWithUser("balanceOf", user)
	}

	async allowance(...params) {
		// switch to proxies if any
		const owner = this.getProxyAddressFromUser(params[0])
		const spender = this.getProxyAddressFromUser(params[1])

		return this.proxyFunction("allowance", [owner, spender])
	}

	async name(...params) {
		return this.proxyFunction("name", params)
	}

	async symbol(...params) {
		return this.proxyFunction("symbol", params)
	}

	async decimals(...params) {
		return this.proxyFunction("decimals", params)
	}
}

class GRVTStakingProxy extends Proxy {
	constructor(owner, proxies, tokenScriptAddress, token) {
		super(owner, proxies, tokenScriptAddress, token)
	}

	async stake(...params) {
		return this.forwardFunction(params, "stake(uint256)")
	}

	async stakes(user) {
		return this.proxyFunctionWithUser("stakes", user)
	}

	async F_VUSD(user) {
		return this.proxyFunctionWithUser("F_VUSD", user)
	}
}

module.exports = {
	buildUserProxies,
	BorrowerOperationsProxy,
	BorrowerWrappersProxy,
	VesselManagerProxy,
	StabilityPoolProxy,
	SortedVesselsProxy,
	TokenProxy,
	GRVTStakingProxy,
}

