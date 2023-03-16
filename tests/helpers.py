from brownie import Wei

ZERO_ADDRESS = "0x" + "0".zfill(40)
MAX_BYTES_32 = "0x" + "F" * 64


def floatToWei(amount):
    return Wei(amount * 1e18)


# Subtracts the borrowing fee
def get_USDV_amount_from_net_debt(contracts, net_debt):
    borrowing_rate = contracts.vesselManager.getBorrowingRateWithDecay()
    return Wei(net_debt * Wei(1e18) / (Wei(1e18) + borrowing_rate))


def logGlobalState(contracts):
    print("\n ---- Global state ----")
    num_vessels = contracts.sortedTroves.getSize()
    print("Num vessels      ", num_vessels)
    activePoolColl = contracts.activePool.getETH()
    activePoolDebt = contracts.activePool.getVUSDDebt()
    defaultPoolColl = contracts.defaultPool.getETH()
    defaultPoolDebt = contracts.defaultPool.getVUSDDebt()
    total_debt = (activePoolDebt + defaultPoolDebt).to("ether")
    total_coll = (activePoolColl + defaultPoolColl).to("ether")
    print("Total Debt      ", total_debt)
    print("Total Coll      ", total_coll)
    SP_USDV = contracts.stabilityPool.getTotalVUSDDeposits().to("ether")
    SP_ETH = contracts.stabilityPool.getETH().to("ether")
    print("SP VUSD         ", SP_USDV)
    print("SP ETH          ", SP_ETH)
    price_ether_current = contracts.priceFeedTestnet.getPrice()
    ETH_price = price_ether_current.to("ether")
    print("ETH price       ", ETH_price)
    TCR = contracts.vesselManager.getTCR(price_ether_current).to("ether")
    print("TCR             ", TCR)
    recovery_mode = contracts.vesselManager.checkRecoveryMode(price_ether_current)
    print("Rec. Mode       ", recovery_mode)
    stakes_snapshot = contracts.vesselManager.totalStakesSnapshot()
    coll_snapshot = contracts.vesselManager.totalCollateralSnapshot()
    print("Stake snapshot  ", stakes_snapshot.to("ether"))
    print("Coll snapshot   ", coll_snapshot.to("ether"))
    if stakes_snapshot > 0:
        print("Snapshot ratio  ", coll_snapshot / stakes_snapshot)
    last_vessel = contracts.sortedTroves.getLast()
    last_ICR = contracts.vesselManager.getCurrentICR(last_vessel, price_ether_current).to(
        "ether"
    )
    # print('Last vessel      ', last_vessel)
    print("Last vessel’s ICR", last_ICR)
    print(" ----------------------\n")

    return [
        ETH_price,
        num_vessels,
        total_coll,
        total_debt,
        TCR,
        recovery_mode,
        last_ICR,
        SP_USDV,
        SP_ETH,
    ]
