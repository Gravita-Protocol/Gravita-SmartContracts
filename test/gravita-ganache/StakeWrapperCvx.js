const { time } = require("@openzeppelin/test-helpers")
var jsonfile = require("jsonfile")
var contractList = jsonfile.readFileSync("./test/gravita-ganache/contracts.json")

const Booster = artifacts.require("Booster")
const ConvexToken = artifacts.require("ConvexToken")
const BaseRewardPool = artifacts.require("BaseRewardPool")
const ConvexStakingWrapper = artifacts.require("ConvexStakingWrapper")
const IERC20 = artifacts.require("@openzeppelin/contracts-3.4.0/token/ERC20/IERC20.sol:IERC20")
const CvxMining = artifacts.require("CvxMining")

var snapshotId
var initialSnapshotId

const unlockAccount = async address => {
	return new Promise((resolve, reject) => {
		web3.currentProvider.send(
			{
				jsonrpc: "2.0",
				method: "evm_unlockUnknownAccount",
				params: [address],
				id: new Date().getTime(),
			},
			(err, result) => {
				if (err) {
					return reject(err)
				}
				return resolve(result)
			}
		)
	})
}

const f = v => ethers.utils.formatEther(v.toString())

contract("StakeWrapperCvx", async accounts => {

	before(async () => {
		initialSnapshotId = await network.provider.send("evm_snapshot")
	})

	beforeEach(async () => {
		snapshotId = await network.provider.send("evm_snapshot")
	})

	afterEach(async () => {
		await network.provider.send("evm_revert", [snapshotId])
	})

	after(async () => {
		await network.provider.send("evm_revert", [initialSnapshotId])
	})

	it("should deposit lp tokens and earn rewards while being transferable", async () => {
		let deployer = "0x947B7742C403f20e5FaCcDAc5E092C943E7D0277"
		let addressZero = "0x0000000000000000000000000000000000000000"

		//system
		let booster = await Booster.at(contractList.system.booster)
		let cvx = await ConvexToken.at(contractList.system.cvx)
		let crv = await IERC20.at("0xD533a949740bb3306d119CC777fa900bA034cd52")

		let userA = accounts[0]
		let userB = accounts[1]
		let userF = accounts[9]
		console.log(`send from userF to deployer`)
		console.log(`userF balance = ${f(await web3.eth.getBalance(userF))}`)
		await web3.eth.sendTransaction({ from: userF, to: deployer, value: web3.utils.toWei("8.0", "ether") })

		let gauge = "0x7E1444BA99dcdFfE8fBdb42C02F0005D14f13BE1"
		console.log(`unlock gauge account`)
		await unlockAccount(gauge)
		let curveLP = await IERC20.at("0x3A283D9c08E8b55966afb64C515f5143cf907611")
		let convexLP = await IERC20.at("0x0bC857f97c0554d1d0D602b56F2EEcE682016fBA")
		let convexRewards = await BaseRewardPool.at("0xb1Fb0BA0676A1fFA83882c7F4805408bA232C1fA")
		let poolId = 64

		console.log(`curveLP.transfer from gauge to userA`)
		await curveLP.transfer(userA, web3.utils.toWei("10.0", "ether"), { from: gauge, gasPrice: 0 })
		console.log(`curveLP.transfer from gauge to userB`)
		await curveLP.transfer(userB, web3.utils.toWei("5.0", "ether"), { from: gauge, gasPrice: 0 })
		var userABalance = await curveLP.balanceOf(userA)
		var userBBalance = await curveLP.balanceOf(userB)
		console.log("userA: " + userABalance + ",  userB: " + userBBalance)

		let lib = await CvxMining.at(contractList.system.cvxMining)
		console.log("mining lib at: " + lib.address)
		await ConvexStakingWrapper.link("CvxMining", lib.address)
		let staker = await ConvexStakingWrapper.new()
		await staker.initialize(curveLP.address, convexLP.address, convexRewards.address, poolId, addressZero, {
			from: deployer,
		})
		console.log("staker token: " + staker.address)
		await staker.name().then(a => console.log("name: " + a))
		await staker.symbol().then(a => console.log("symbol: " + a))
		await staker.setApprovals()
		await staker.addRewards({ from: deployer })

		let rewardCount = await staker.rewardLength()
		for (var i = 0; i < rewardCount; i++) {
			var rInfo = await staker.rewards(i)
			console.log("rewards " + i + ": " + JSON.stringify(rInfo))
		}

		//user A will deposit curve tokens and user B convex
		await curveLP.approve(staker.address, userABalance, { from: userA })
		await curveLP.approve(booster.address, userBBalance, { from: userB })
		await convexLP.approve(staker.address, userBBalance, { from: userB })
		console.log("approved booster and staker")
		await booster.depositAll(poolId, false, { from: userB })
		console.log("deposited into convex")

		var tx = await staker.deposit(userABalance, userA, { from: userA })
		console.log("user A deposited: " + tx.receipt.gasUsed)
		await convexLP.balanceOf(userB).then(a => console.log("user b convex lp: " + a))
		var tx = await staker.stake(userBBalance, userB, { from: userB })
		console.log("user b staked: " + tx.receipt.gasUsed)
		await staker.totalSupply().then(a => console.log("staker supply: " + a))

		await staker.balanceOf(userA).then(a => console.log("user a: " + a))
		await staker.balanceOf(userB).then(a => console.log("user b: " + a))

		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await staker.earned(userB).then(a => console.log("user b earned: " + a))

		await time.increase(86400)
		await time.advanceBlock()
		console.log("advance time...")

		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))

		console.log("checkpoint")
		var tx = await staker.user_checkpoint([userA, addressZero])
		console.log("checkpoint a gas: " + tx.receipt.gasUsed)
		var tx = await staker.user_checkpoint([userB, addressZero])
		console.log("checkpoint b gas: " + tx.receipt.gasUsed)

		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await staker.earned(userB).then(a => console.log("user b earned: " + a))

		await time.increase(86400)
		await time.advanceBlock()
		console.log("advance time...")

		console.log(">>>> call unguarded get reward for pool..")
		var tx = await convexRewards.getReward(staker.address, true)
		console.log("getReward gas: " + tx.receipt.gasUsed)

		await booster.earmarkRewards(poolId, { from: deployer })

		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await staker.earned(userB).then(a => console.log("user b earned: " + a))

		await crv.balanceOf(staker.address).then(a => console.log("staker crv: " + a))
		await cvx.balanceOf(staker.address).then(a => console.log("staker cvx: " + a))
		for (var i = 0; i < rewardCount; i++) {
			var rInfo = await staker.rewards(i)
			console.log("rewards " + i + ": " + JSON.stringify(rInfo))
		}

		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))
		for (var i = 0; i < rewardCount; i++) {
			var rInfo = await staker.rewards(i)
			console.log("rewards " + i + ": " + JSON.stringify(rInfo))
		}

		await time.increase(86400)
		await time.advanceBlock()
		console.log("\n\nadvance time...")
		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))
		console.log("claiming rewards...")
		console.log("======")
		var tx = await staker.getReward(userA, { from: userA })
		console.log("claimed A, gas: " + tx.receipt.gasUsed)
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		var tx = await staker.getReward(userB, { from: userB })
		console.log("claimed B, gas: " + tx.receipt.gasUsed)
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))

		await crv.balanceOf(staker.address).then(a => console.log("crv on staker: " + a))
		await cvx.balanceOf(staker.address).then(a => console.log("staker cvx: " + a))

		for (var i = 0; i < rewardCount; i++) {
			var rInfo = await staker.rewards(i)
			console.log("rewards " + i + ": " + JSON.stringify(rInfo))
		}

		await booster.earmarkRewards(poolId, { from: deployer })
		await time.increase(86400 * 5)
		await time.advanceBlock()
		console.log("\n\nadvance time...")
		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))
		console.log("claiming rewards...")
		var tx = await staker.getReward(userA, { from: userA })
		console.log("claimed A, gas: " + tx.receipt.gasUsed)
		var tx = await staker.getReward(userB, { from: userB })
		console.log("claimed B, gas: " + tx.receipt.gasUsed)
		await crv.balanceOf(staker.address).then(a => console.log("crv on staker: " + a))
		await cvx.balanceOf(staker.address).then(a => console.log("staker cvx: " + a))
		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))
		for (var i = 0; i < rewardCount; i++) {
			var rInfo = await staker.rewards(i)
			console.log("rewards " + i + ": " + JSON.stringify(rInfo))
		}

		await booster.earmarkRewards(poolId, { from: deployer })
		await time.increase(86400 * 10)
		await time.advanceBlock()
		console.log("\n\nadvance time...")
		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))
		console.log("claiming rewards...")
		var tx = await staker.getReward(userA, { from: userA })
		console.log("claimed A, gas: " + tx.receipt.gasUsed)
		var tx = await staker.getReward(userB, { from: userB })
		console.log("claimed B, gas: " + tx.receipt.gasUsed)
		console.log("======")
		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))

		await time.increase(86400)
		await time.advanceBlock()
		console.log("\n\nadvance time...")
		//withdraw
		console.log("withdrawing...")
		await staker.withdrawAndUnwrap(userABalance, { from: userA })
		await staker.withdraw(userBBalance, { from: userB })
		console.log("withdraw complete")

		console.log("claiming rewards...")
		var tx = await staker.getReward(userA, { from: userA })
		console.log("claimed A, gas: " + tx.receipt.gasUsed)

		console.log("--- current rewards on wrapper ---")
		await crv.balanceOf(staker.address).then(a => console.log("staker crv: " + a))
		await cvx.balanceOf(staker.address).then(a => console.log("staker cvx: " + a))
		console.log("-----")
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))

		var tx = await staker.getReward(userB, { from: userB })
		console.log("claimed B, gas: " + tx.receipt.gasUsed)

		console.log("--- current rewards on wrapper ---")
		await crv.balanceOf(staker.address).then(a => console.log("staker crv: " + a))
		await cvx.balanceOf(staker.address).then(a => console.log("staker cvx: " + a))
		console.log("-----")

		await staker.earned(userA).then(a => console.log("user a earned: " + a))
		await crv.balanceOf(userA).then(a => console.log("user a wallet crv: " + a))
		await cvx.balanceOf(userA).then(a => console.log("user a wallet cvx: " + a))
		console.log("-----")
		await staker.earned(userB).then(a => console.log("user b earned: " + a))
		await crv.balanceOf(userB).then(a => console.log("user b wallet crv: " + a))
		await cvx.balanceOf(userB).then(a => console.log("user b wallet cvx: " + a))

		//check whats left on the staker
		console.log(">>> remaining check <<<<")
		await staker.balanceOf(userA).then(a => console.log("user a staked: " + a))
		await staker.balanceOf(userB).then(a => console.log("user b staked: " + a))
		await staker.totalSupply().then(a => console.log("remaining supply: " + a))
		await crv.balanceOf(staker.address).then(a => console.log("remaining crv: " + a))
		await cvx.balanceOf(staker.address).then(a => console.log("remaining cvx: " + a))
	})
})
