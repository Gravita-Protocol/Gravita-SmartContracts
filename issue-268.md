## TITLE ERC20Token/ETH chainlink oracle has too long of heartbeat and deviation threshold which will cause loss of funds
The Pricefeed.sol contract uses the pairs of erc20 tokens to ETH (USDC/ETH) chainlink oracle to calculate the current
price of those tokens. This is problematic since ETH pairs have a much longer heartbeat and deviation threshold than USD
pairs. For example, USDC/ETH has a 24 hour heartbeat and a 1% deviation threshold, meanwhile, USDC/USD has a 0.25%
deviation threshold. This deviation in price will easily cause a loss of funds to the user. As the actual loss of funds
due to deviation in specific market turns is in the hands of Gravita due to fetching the price from a non-optimal oracle,
the impact is in scope.

https://data.chain.link/ethereum/mainnet/stablecoins/usdc-eth
https://data.chain.link/ethereum/mainnet/stablecoins/usdc-usd

Note. It is not possible to know just by looking at the codebases that you are going to use oracles with pairs in ETH.
That is why I ratified the issue of ETH-paired oracles with munchkiner #1299 on Twitter confirming that the oracles
are indeed paired with ETH.

## SEVERITY
High because the loss of funds from the user due to deviation in price in specific market conditions, is an economic damage,
which is categorized as high.

## A LINK TO THE GITHUB ISSUE
https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/PriceFeed.sol

## SOLUTION
Instead of fetching prices paired with ETH, fetch prices paired with USD. Calling different oracle contracts. Check the full list to choose depending on the token:

https://data.chain.link/