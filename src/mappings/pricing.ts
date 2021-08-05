/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'
//Addresses need to be in lowercase!!!!!!!!!!!!!
const DCTD_ADDRESS = '0x8db2dbdfb50480fe79f6576deaa4f6e68dcbfb15'
const DUSDT_DCTD_PAIR = '0x05ff108f9a204d9abe22d0b435e6503e3222d534' 

export function getDctdPriceInUSD(): BigDecimal {
  // fetch dctd prices for each stablecoin
  let dusdtPair = Pair.load(DUSDT_DCTD_PAIR) // usdt is token1

  if (dusdtPair !== null) {
    return dusdtPair.token1Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
//Addresses need to be in lowercase!!!!!!!!!!!!!
let WHITELIST: string[] = [
  DCTD_ADDRESS, // DCTD
  '0xbf61c387c9a9535140ecc572eeb22c7aa3fcf7a9', // DWETH
  '0x017801b52f3e40178c75c4b4f19f1a0c8f8a0b78', //DUSDT
  '0xf20d962a6c8f70c731bd838a3a388d7d48fa6e15', // ETH
  '0xde3a24028580884448a5397872046a019649b084', //USDT
  '0x846d50248baf8b7ceaa9d9b53bfd12d7d7fbb25a', // VSO
  '0xae9d2385ff2e2951dd4fa061e74c4d3dedd24347', // TOK
  '0x85da29f4f8a59c2a1d0353da57c57edfb3a17f0b' //SPDR
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('30000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_DCTD = BigDecimal.fromString('4500')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findDctdPerToken(token: Token): BigDecimal {
  if (token.id == DCTD_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveDCTD.gt(MINIMUM_LIQUIDITY_THRESHOLD_DCTD)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedDCTD as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveDCTD.gt(MINIMUM_LIQUIDITY_THRESHOLD_DCTD)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedDCTD as BigDecimal) // return token0 per our token * DCTD per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedDCTD.times(bundle.dctdPrice)
  let price1 = token1.derivedDCTD.times(bundle.dctdPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedDCTD.times(bundle.dctdPrice)
  let price1 = token1.derivedDCTD.times(bundle.dctdPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
