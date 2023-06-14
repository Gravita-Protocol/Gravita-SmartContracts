import { Wallet, utils } from "zksync-web3"
import * as ethers from "ethers"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { Deployer } from "@matterlabs/hardhat-zksync-deploy"

import LZ_ENDPOINTS from "../constants/layerzeroEndpoints.json"

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for Gravita's Debt Token contract on network ${hre.network.name}`)

    const lzEndpointAddress = LZ_ENDPOINTS[hre.network.name]
    const sharedDecimals = 6

    const wallet = new Wallet(String(process.env.DEPLOYER_PRIVATEKEY))
    const deployer = new Deployer(hre, wallet)
    const artifact = await deployer.loadArtifact("GravitaDebtToken")
    const constructorArgs = [lzEndpointAddress, sharedDecimals]

    const walletBalance = await hre.ethers.provider.getBalance(await wallet.getAddress())
    const walletBalanceStr = ethers.utils.formatEther(walletBalance.toString())
    console.log(`Using wallet ${await wallet.getAddress()} [balance: ${walletBalanceStr}]`)

    const deploymentFee = await deployer.estimateDeployFee(artifact, constructorArgs)
    const deploymentFeeStr = ethers.utils.formatEther(deploymentFee.toString())
    console.log(`The deployment is estimated to cost ${deploymentFeeStr}`)

    if (deploymentFee.gt(walletBalance)) {
        console.log(`ERROR: Not enough balance on wallet to cover estimated deployment cost`)
        process.exit(1)
    }

    console.log(`Deploying contract...`)

    const contract = await deployer.deploy(artifact, constructorArgs)

    console.log(
        `${artifact.contractName} was deployed to ${contract.address} [constructor args: ${contract.interface.encodeDeploy(constructorArgs)}]`
    )
}