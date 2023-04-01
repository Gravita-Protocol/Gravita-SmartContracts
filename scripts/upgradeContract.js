const { ethers, upgrades } = require("hardhat");

async function main() {
  const v2 = await ethers.getContractFactory("StabilityPool");
  await upgrades.upgradeProxy('0xdc8A17E999763831Fa6F521c2A3daBAA4aF2c5e1', v2);
  console.log("Contract upgraded");
}

main();