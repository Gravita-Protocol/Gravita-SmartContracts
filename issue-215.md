## TITLE (Missing Storage gaps)
The following contracts are missing storage gaps:

https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/ActivePool.sol
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/FeeCollector.sol

When creating upgradable contracts that inherit from other contracts is important that there is a storage gap in case
storage variables are added to inherited contracts. If an inherited contract is a stateless contract (i.e. it doesn't
have any storage) then it is acceptable to omit a storage gap, since these function is similar to libraries and aren't
intended to add any storage.

## SEVERITY (either high or medium, see the rules)
MEDIUM, As you can see in past reports from top-tier companies, the issue is classified as a medium severity issue.

https://solodit.xyz/issues/6453 https://solodit.xyz/issues/3340 https://solodit.xyz/issues/10322
https://solodit.xyz/issues/10804

## A LINK TO THE GITHUB ISSUE
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/ActivePool.sol
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/FeeCollector.sol

## SOLUTION
Add the following line to the contracts:

uint256[50] private __gap;
https://solodit.xyz/issues/6453 https://solodit.xyz/issues/3340 https://solodit.xyz/issues/10322
https://solodit.xyz/issues/10804