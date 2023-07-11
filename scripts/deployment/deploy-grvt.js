const GrvtDeploymentHelper = require("../utils/deploymentHelper-grvt.js")
const { Deployer } = require("./deployer-common.js")

/**
 * Exported deployment script, invoked from hardhat tasks defined on hardhat.config.js
 */
class GrvtDeployer extends Deployer {
	helper
	coreContracts
	grvtContracts
	deploymentState

	constructor(hre, targetNetwork) {
		super(hre, targetNetwork)
		this.helper = new GrvtDeploymentHelper(this.hre, this.config, this.deployerWallet)
		this.deploymentState = this.helper.loadPreviousDeployment()
	}

	async run() {
		console.log(`Deploying Gravita GRVT on ${this.targetNetwork}...`)

		await this.printDeployerBalance()

		// grvtContracts = await helper.deployGrvtContracts(TREASURY_WALLET, deploymentState)
		// await deployOnlyGRVTContracts()
		// await helper.connectgrvtContractsToCore(grvtContracts, coreContracts, TREASURY_WALLET)
		// await approveGRVTTokenAllowanceForCommunityIssuance()
		// await this.transferGrvtContractsOwnerships()

		this.helper.saveDeployment(this.deploymentState)

		await this.transferContractsOwnerships(this.coreContracts)

		await this.printDeployerBalance()
	}

	async deployOnlyGRVTContracts() {
		console.log("INIT GRVT ONLY")
		const partialContracts = await helper.deployPartially(TREASURY_WALLET, deploymentState)
		// create vesting rule to beneficiaries
		console.log("Beneficiaries")
		if (
			(await partialContracts.GRVTToken.allowance(deployerWallet.address, partialContracts.lockedGrvt.address)) == 0
		) {
			await partialContracts.GRVTToken.approve(partialContracts.lockedGrvt.address, ethers.constants.MaxUint256)
		}
		for (const [wallet, amount] of Object.entries(config.GRVT_BENEFICIARIES)) {
			if (amount == 0) continue
			if (!(await partialContracts.lockedGrvt.isEntityExits(wallet))) {
				console.log("Beneficiary: %s for %s", wallet, amount)
				const txReceipt = await helper.sendAndWaitForTransaction(
					partialContracts.lockedGrvt.addEntityVesting(wallet, amount.concat("0".repeat(18)))
				)
				deploymentState[wallet] = {
					amount: amount,
					txHash: txReceipt.transactionHash,
				}
				helper.saveDeployment(deploymentState)
			}
		}
		await transferOwnership(partialContracts.lockedGrvt, TREASURY_WALLET)
		const balance = await partialContracts.GRVTToken.balanceOf(deployerWallet.address)
		console.log(`Sending ${balance} GRVT to ${TREASURY_WALLET}`)
		await partialContracts.GRVTToken.transfer(TREASURY_WALLET, balance)
		console.log(`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`)
	}

	async approveGRVTTokenAllowanceForCommunityIssuance() {
		const allowance = await grvtContracts.GRVTToken.allowance(
			deployerWallet.address,
			grvtContracts.communityIssuance.address
		)
		if (allowance == 0) {
			await grvtContracts.GRVTToken.approve(grvtContracts.communityIssuance.address, ethers.constants.MaxUint256)
		}
	}
}

module.exports = CoreDeployer
