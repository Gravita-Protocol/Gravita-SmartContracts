## TITLE (Un-Upgradeable Contracts)
The following contracts are missing the methods to actually be upgraded. They do inherit from upgradeable contracts, but
they are not upgradeable themselves. The contracts forget to inherit Openzepplin's UUPSUpgradeable/TPP contract.
Therefore, it is missing the authorize upgrade method, and the contract cannot be upgraded.

https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/ActivePool.sol
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/FeeCollector.sol

## SEVERITY (either high or medium, see the rules)
HIGH, The entire codebase has been designed with the purpose of being upgradeable, inherting from upgradeable contracts
and contracts with storage gaps. In these case, as the contracts can't be upgraded, as gravity has a very extensive
codebase, it is very likely that in the future they get hacked or somebody discloses a critical bug, happens to even the
best projects. In these case, gravity would potentially lose more money due to having to re-deploy new contracts and it
would probably break previous states and connections. Having a fast response of upgrading the contracts in these case is
crucial to prevent the loss of funds, therefore as funds are involved classifyng the impact as high.

## A LINK TO THE GITHUB ISSUE
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/ActivePool.sol
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/FeeCollector.sol

## SOLUTION
Inherit from one of the common upgradeability patterns from OpenZeppelin. You can chosse between UUPS or TPP. There are
more, but those are the most used ones.

contract FeeCollector is IFeeCollector, OwnableUpgradeable {}
contract FeeCollector is IFeeCollector, OwnableUpgradeable UUPSUpgradeable {}