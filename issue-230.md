## TITLE (PriceFeed will return the wrong price for asset if underlying aggregator hits minAnswer)
Chainlink aggregators have a built-in circuit breaker if the price of an asset goes outside of a predetermined price
band. The result is that if an asset experiences a huge drop in value (i.e. LUNA crash) the price of the oracle will
continue to return the minPrice instead of the actual price of the asset. This would allow users to continue borrowing
with the asset but at the wrong price. This is exactly what happened to Venus on BSC when LUNA imploded.

PriceFeed uses the ChainlinkFeedRegistry to obtain the price of the requested tokens.

    function latestRoundData(
 address base,
 address quote
)
 external
 view
 override
  checkPairAccess()
 returns (
  uint80 roundId,
   int256 answer,
  uint256 startedAt,
    uint256 updatedAt,
  uint80 answeredInRound
    ) 
   {
      uint16 currentPhaseId = s_currentPhaseId[base][quote];
 //@audit this pulls the Aggregator for the requested pair
 AggregatorV2V3Interface aggregator = _getFeed(base, quote);
 require(address(aggregator) != address(0), "Feed not found");
  (
   roundId,
  answer,
startedAt,
updatedAt,
answeredInRound
 ) = aggregator.latestRoundData();
 return _addPhaseIds(roundId, answer, startedAt, updatedAt, answeredInRound, currentPhaseId);
  } 
ChainlinkFeedRegistry#latestRoundData pulls the associated aggregator and
requests round data from it. ChainlinkAggregators have minPrice and maxPrice circuit breakers built into them. This
means that if the price of the asset drops below the minPrice, the protocol will continue to value the token at minPrice
instead of it's actual value. This will allow users to take out huge amounts of bad debt and bankrupt the protocol.

Example: TokenA has a minPrice of $1. The price of TokenA drops to $0.10. The aggregator still returns $1 allowing the
user to borrow against TokenA as if it is $1 which is 10x it's actual value.

## SEVERITY
HIGH. In the event that an asset crashes (i.e. LUNA) the protocol can be manipulated to give out loans at an inflated price.
So there is a chance of economic damage of millions of dollars given the conditions.
Impact Critical and Likelihood Low = High

Past attack:
https://rekt.news/venus-blizz-rekt/

## A LINK TO THE GITHUB ISSUE
Gravita-SmartContracts/contracts/PriceFeed.sol

Lines 104 to 113 in 5e45123

 function fetchPrice(address _token) public override returns (uint256) { 
 	OracleRecord storage oracle = oracleRecords[_token]; 
  
 	if (!oracle.exists) { 
 		revert PriceFeed__UnknownFeedError(_token); 
 	} 
  
 	(FeedResponse memory currResponse, FeedResponse memory prevResponse) = _fetchFeedResponses(oracle.chainLinkOracle); 
 	return _processFeedResponses(_token, oracle, currResponse, prevResponse); 
 } 

https://github.com/Gravita-Protocol/Gravita-SmartContracts/blob/main/contracts/PriceFeed.sol
Gravita-SmartContracts/contracts/PriceFeed.sol

Lines 245 to 259 in 5e45123

 try _priceAggregator.latestRoundData() returns ( 
 	uint80 roundId, 
 	int256 answer, 
 	uint256, /* startedAt */ 
 	uint256 timestamp, 
 	uint80 /* answeredInRound */ 
 ) { 
 	// If call to Chainlink succeeds, return the response and success = true 
 	response.roundId = roundId; 
 	response.answer = answer; 
 	response.timestamp = timestamp; 
 	response.success = true; 
 } catch { 
 	// If call to Chainlink aggregator reverts, return a zero response with success = false 
 	return response; 
## SOLUTION
PriceFeed should check the returned answer against the minPrice/maxPrice and revert if the answer is
outside of the bounds:

Gravita-SmartContracts/contracts/PriceFeed.sol

Lines 245 to 259 in 5e45123

 try _priceAggregator.latestRoundData() returns ( 
 	uint80 roundId, 
 	int256 answer, 
 	uint256, /* startedAt */ 
 	uint256 timestamp, 
 	uint80 /* answeredInRound */ 
 ) { 
 	// If call to Chainlink succeeds, return the response and success = true 
 	response.roundId = roundId; 
 	response.answer = answer; 
 	response.timestamp = timestamp; 
 	response.success = true; 
 } catch { 
 	// If call to Chainlink aggregator reverts, return a zero response with success = false 
 	return response; 
ADD the following line to the existing code:

if (answer >= maxPrice || answer <= minPrice) revert();