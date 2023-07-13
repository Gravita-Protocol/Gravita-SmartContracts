const {
	setBalance,
	impersonateAccount,
	stopImpersonatingAccount,
	time,
} = require("@nomicfoundation/hardhat-network-helpers")

const Booster = artifacts.require("Booster")
const ConvexToken = artifacts.require("ConvexToken")
const BaseRewardPool = artifacts.require("BaseRewardPool")
const ConvexStakingWrapper = artifacts.require("ConvexStakingWrapper")
const IERC20 = artifacts.require("@openzeppelin/contracts-3.4.0/token/ERC20/IERC20.sol:IERC20")

const f = v => ethers.utils.formatEther(v.toString())
const toEther = v => ethers.utils.parseEther(v.toString())

contract("StakeWrapperCvx", async accounts => {
	it("should deposit lp tokens and earn rewards while being transferable", async () => {
		const printBalances = async () => {
			await wrapper.earned(userA)
			console.log(`Wrapper.earned(UserA): ${formatEarnedData(await wrapper.earnedPeek(userA))}`)
			console.log(`CRV.balanceOf(UserA): ${f(await crv.balanceOf(userA))}`)
			console.log(`CVX.balanceOf(UserA): ${f(await crv.balanceOf(userA))}`)

			await wrapper.earned(userB)
			console.log(`Wrapper.earned(UserB): ${formatEarnedData(await wrapper.earnedPeek(userB))}`)
			console.log(`CRV.balanceOf(UserB): ${f(await crv.balanceOf(userB))}`)
			console.log(`CVX.balanceOf(UserB): ${f(await crv.balanceOf(userB))}`)

			console.log(`CRV.balanceOf(Wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
			console.log(`CVX.balanceOf(Wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
		}

		const printRewards = async () => {
			let rewardCount = await wrapper.rewardLength()
			for (var i = 0; i < rewardCount; i++) {
				var r = await wrapper.rewards(i)
				console.log(`Reward #${i}: ${formatRewardType(r)}`)
			}
		}

		const formatRewardType = r => {
			const token = r.reward_token == crv.address ? "CRV" : r.reward_token == cvx.address ? "CVX" : r.reward_token
			return `[${token}] integral: ${f(r.reward_integral)} remaining: ${f(r.reward_remaining)}`
		}

		const formatEarnedData = earnedDataArray => {
			return earnedDataArray.map(d => {
				const token = d[0] == crv.address ? "CRV" : d[0] == cvx.address ? "CVX" : d[0]
				return `[${token}] = ${f(d[1])}`
			})
		}

		let deployer = "0x947B7742C403f20e5FaCcDAc5E092C943E7D0277"

		let booster = await Booster.at("0xF403C135812408BFbE8713b5A23a04b3D48AAE31")
		let cvx = await ConvexToken.at("0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B")
		let crv = await IERC20.at("0xD533a949740bb3306d119CC777fa900bA034cd52")

		let userA = accounts[0]
		let userB = accounts[1]
		let userF = accounts[9]

		const userF_signer = ethers.provider.getSigner(userF)
		await setBalance(userF, 10e18)
		await userF_signer.sendTransaction({ to: deployer, value: toEther("8") })

		let gauge = "0x7E1444BA99dcdFfE8fBdb42C02F0005D14f13BE1"
		let curveLP = await IERC20.at("0x3A283D9c08E8b55966afb64C515f5143cf907611")
		let convexLP = await IERC20.at("0x0bC857f97c0554d1d0D602b56F2EEcE682016fBA")
		let convexRewards = await BaseRewardPool.at("0xb1Fb0BA0676A1fFA83882c7F4805408bA232C1fA")
		let poolId = 64

		console.log(`curveLP.transfer from gauge to userA`)
		await impersonateAccount(gauge)
		await setBalance(gauge, 20e18)
		await curveLP.transfer(userA, toEther("10"), { from: gauge })
		console.log(`curveLP.transfer from gauge to userB`)
		await curveLP.transfer(userB, toEther("5"), { from: gauge })
		await stopImpersonatingAccount(gauge)

		const userA_balance = await curveLP.balanceOf(userA)
		const userB_balance = await curveLP.balanceOf(userB)
		console.log(`curveLP.balanceOf(userA): ${f(userA_balance)}`)
		console.log(`curveLP.balanceOf(userB): ${f(userB_balance)}`)

		await impersonateAccount(deployer)
		let wrapper = await ConvexStakingWrapper.new()
		await wrapper.initialize(poolId, { from: deployer })
		console.log(`ConvexStakingWrapper.address: ${wrapper.address}`)
		console.log(`ConvexStakingWrapper.name: ${await wrapper.name()}`)
		console.log(`ConvexStakingWrapper.symbol: ${await wrapper.symbol()}`)
		await wrapper.setApprovals()
		await wrapper.addRewards({ from: deployer })
		await stopImpersonatingAccount(deployer)

		await printRewards()

		// UserA will deposit curve tokens, and UserB convex
		console.log("Approving Booster and wrapper for UserA and UserB")
		await curveLP.approve(wrapper.address, userA_balance, { from: userA })
		await curveLP.approve(booster.address, userB_balance, { from: userB })
		await convexLP.approve(wrapper.address, userB_balance, { from: userB })

		console.log("UserB depositing into Booster")
		await booster.depositAll(poolId, false, { from: userB })
		console.log(`ConvexLP.balanceOf(UserB): ${f(await convexLP.balanceOf(userB))}`)

		console.log("UserA depositing into wrapper")
		await wrapper.deposit(userA_balance, userA, { from: userA })
		console.log("UserB staking into wrapper")
		await wrapper.stake(userB_balance, userB, { from: userB })
		console.log(`Wrapper supply: ${f(await wrapper.totalSupply())}`)

		await printBalances()

		console.log(" --- Advancing 1 day --- ")
		await time.increase(86_400)

		await printBalances()

		console.log("Triggering user checkpoints")
		await wrapper.user_checkpoint(userA)
		await wrapper.user_checkpoint(userB)

		await printBalances()

		console.log(" --- Advancing 1 more day --- ")
		await time.increase(86_400)

		console.log("ConvexRewards.getReward()")
		await convexRewards.getReward(wrapper.address, true)

		await impersonateAccount(deployer)
		console.log("Booster.earmarkRewards()")
		await booster.earmarkRewards(poolId, { from: deployer })
		await stopImpersonatingAccount(deployer)

		await printBalances()
		await printRewards()

		console.log(" --- Advancing 1 more day --- ")
		await time.increase(86_400)

		await printBalances()

		console.log("Claiming rewards...")
		await wrapper.getReward(userA, { from: userA })
		await wrapper.getReward(userB, { from: userB })

		await printBalances()
		await printRewards()

		await impersonateAccount(deployer)
		console.log("Booster.earmarkRewards()")
		await booster.earmarkRewards(poolId, { from: deployer })
		await stopImpersonatingAccount(deployer)

		console.log(" --- Advancing 5 more days --- ")
		await time.increase(86_400 * 5)

		await printBalances()

		console.log("Claiming rewards...")
		await wrapper.getReward(userA, { from: userA })
		await wrapper.getReward(userB, { from: userB })

		await printBalances()
		await printRewards()

		await impersonateAccount(deployer)
		console.log("Booster.earmarkRewards()")
		await booster.earmarkRewards(poolId, { from: deployer })
		await stopImpersonatingAccount(deployer)

		console.log(" --- Advancing 10 more days --- ")
		await time.increase(86_400 * 5)

		await printBalances()

		console.log("Claiming rewards...")
		await wrapper.getReward(userA, { from: userA })
		await wrapper.getReward(userB, { from: userB })

		await printBalances()
		await printRewards()

		console.log(" --- Advancing 1 more day --- ")
		await time.increase(86_400)
		console.log("Withdrawing...")
		await wrapper.withdrawAndUnwrap(userA_balance, { from: userA })
		await wrapper.withdraw(userB_balance, { from: userB })
		console.log("Withdraw complete")

		console.log("Claiming rewards...")
		await wrapper.getReward(userA, { from: userA })
		await wrapper.getReward(userB, { from: userB })

		await printBalances()

		// check what is left on the wrapper
		console.log(">>> remaining check <<<<")

		console.log(`Wrapper supply: ${f(await wrapper.totalSupply())}`)

		console.log(`Wrapper.balanceOf(UserA): ${f(await wrapper.balanceOf(userA))}`)
		console.log(`Wrapper.balanceOf(UserB): ${f(await wrapper.balanceOf(userB))}`)

		console.log(`CRV.balanceOf(Wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
		console.log(`CVX.balanceOf(Wrapper): ${f(await crv.balanceOf(wrapper.address))}`)
	})
})
