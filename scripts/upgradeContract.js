const { ethers, upgrades } = require("hardhat");

async function main() {
  const v2 = await ethers.getContractFactory("FeeCollector");
  await upgrades.upgradeProxy('0x8a828e5834cd64f2139057c517079ff1A17378fc', v2);
  console.log("FeeCollector upgraded");
}

main();