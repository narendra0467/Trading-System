import { addIndicators, last } from "./indicators.js";
import { blackScholesGreeks } from "./greeks.js";
import { fetchHistory, fetchOptionChain, fetchOptionExpirations } from "./marketData.js";

const DAY_SECONDS = 24 * 60 * 60;

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function daysToExpiration(expiration) {
  return Math.round((expiration * 1000 - Date.now()) / (DAY_SECONDS * 1000));
}

function midPrice(contract) {
  if (Number.isFinite(contract.bid) && Number.isFinite(contract.ask) && contract.bid > 0 && contract.ask > 0) {
    return (contract.bid + contract.ask) / 2;
  }
  return Number.isFinite(contract.lastPrice) ? contract.lastPrice : null;
}

function spreadPct(contract) {
  const mid = midPrice(contract);
  if (!mid || !Number.isFinite(contract.bid) || !Number.isFinite(contract.ask)) return Infinity;
  return (contract.ask - contract.bid) / mid;
}

function normalizeContract(contract, type, underlyingPrice, dte) {
  const mid = midPrice(contract);
  const greeks = blackScholesGreeks({
    type,
    underlying: underlyingPrice,
    strike: contract.strike,
    dte,
    iv: contract.impliedVolatility,
  });
  return {
    type,
    contractSymbol: contract.contractSymbol,
    strike: contract.strike,
    bid: contract.bid,
    ask: contract.ask,
    mid,
    spreadPct: spreadPct(contract),
    volume: contract.volume ?? 0,
    openInterest: contract.openInterest ?? 0,
    impliedVolatility: contract.impliedVolatility,
    delta: greeks.delta ?? estimateDelta(type, contract.strike, underlyingPrice),
    gamma: greeks.gamma,
    theta: greeks.theta,
    vega: greeks.vega,
    probabilityItm: greeks.probabilityItm,
  };
}

function estimateDelta(type, strike, underlyingPrice) {
  const moneyness = underlyingPrice / strike - 1;
  const base = type === "call" ? 0.5 + moneyness * 4 : -0.5 + moneyness * 4;
  return Math.max(type === "call" ? 0.05 : -0.95, Math.min(type === "call" ? 0.95 : -0.05, base));
}

function chooseExpiration(expirations, minDte, maxDte) {
  return expirations
    .map((expiration) => ({ expiration, dte: daysToExpiration(expiration) }))
    .filter(({ dte }) => dte >= minDte && dte <= maxDte)
    .sort((a, b) => Math.abs(a.dte - 35) - Math.abs(b.dte - 35))[0];
}

function chooseLongContract(contracts, targetDeltaRange) {
  return contracts
    .filter((contract) => Math.abs(contract.delta) >= targetDeltaRange[0] && Math.abs(contract.delta) <= targetDeltaRange[1])
    .filter((contract) => contract.mid > 0.2)
    .filter((contract) => contract.spreadPct <= 0.18)
    .filter((contract) => contract.openInterest >= 100 || contract.volume >= 50)
    .sort((a, b) => b.openInterest + b.volume - (a.openInterest + a.volume))[0];
}

function chooseShortWing(contracts, longContract, direction, widthPct = 0.05) {
  const targetStrike =
    direction === "bull"
      ? longContract.strike * (1 + widthPct)
      : longContract.strike * (1 - widthPct);
  return contracts
    .filter((contract) => (direction === "bull" ? contract.strike > longContract.strike : contract.strike < longContract.strike))
    .filter((contract) => contract.mid > 0.05)
    .sort((a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike))[0];
}

function simpleLongOptionIdea(longContract, strategy, regime, expirationMeta) {
  if (!longContract) return {};
  const entry = longContract.mid;
  const stop = entry * 0.7;
  const firstTarget = entry * 1.35;
  const secondTarget = entry * 1.7;
  return {
    beginnerStrategy: strategy === "CALL_DEBIT_SPREAD" ? "BUY_CALL" : "BUY_PUT",
    beginnerAction:
      strategy === "CALL_DEBIT_SPREAD"
        ? `Buy the ${longContract.strike} CALL expiring ${new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10)}.`
        : `Buy the ${longContract.strike} PUT expiring ${new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10)}.`,
    optionStrike: longContract.strike,
    optionType: strategy === "CALL_DEBIT_SPREAD" ? "CALL" : "PUT",
    optionEntry: round(entry),
    optionCost: round(entry * 100),
    optionStop: round(stop),
    optionStopDollars: round(stop * 100),
    optionTarget1: round(firstTarget),
    optionTarget1Dollars: round(firstTarget * 100),
    optionTarget2: round(secondTarget),
    optionTarget2Dollars: round(secondTarget * 100),
    underlyingStop: round(strategy === "CALL_DEBIT_SPREAD" ? Math.max(regime.ema50, regime.close - 1.5 * regime.atr14) : Math.min(regime.ema50, regime.close + 1.5 * regime.atr14)),
    underlyingTarget: round(strategy === "CALL_DEBIT_SPREAD" ? regime.close + 2.5 * regime.atr14 : regime.close - 2.5 * regime.atr14),
  };
}

function technicalRegime(rows, benchmarkRows) {
  const enriched = addIndicators(rows, benchmarkRows);
  const latest = last(enriched);
  const previous = enriched[enriched.length - 2];
  const reasons = [];
  let bullScore = 0;
  let bearScore = 0;

  if (latest.close > latest.ema20 && latest.ema20 > latest.ema50 && latest.ema50 > latest.ema150) {
    bullScore += 25;
    reasons.push("bull trend stack");
  }
  if (latest.close < latest.ema20 && latest.ema20 < latest.ema50) {
    bearScore += 25;
    reasons.push("bear trend stack");
  }
  if (latest.ema50Slope20 > 0.02) bullScore += 15;
  if (latest.ema50Slope20 < -0.02) bearScore += 15;
  if (latest.rsi14 >= 50 && latest.rsi14 <= 72) bullScore += 12;
  if (latest.rsi14 < 45) bearScore += 12;
  if (latest.rsi14 > 75) reasons.push("overbought risk");
  if (latest.macd.histogram > 0 && latest.macd.histogram > previous.macd.histogram) bullScore += 12;
  if (latest.macd.histogram < 0 && latest.macd.histogram < previous.macd.histogram) bearScore += 12;
  if (latest.adx14 > 20 && latest.plusDi14 > latest.minusDi14) {
    bullScore += 10;
    reasons.push("ADX confirms bullish trend");
  }
  if (latest.adx14 > 20 && latest.minusDi14 > latest.plusDi14) {
    bearScore += 10;
    reasons.push("ADX confirms bearish trend");
  }
  if (latest.adx14 < 15) reasons.push("weak trend strength");
  if (latest.close >= latest.high55) bullScore += 12;
  if (latest.close <= latest.low20) bearScore += 10;
  if (latest.close > latest.bollingerUpper20) reasons.push("above upper Bollinger band");
  if (latest.close < latest.bollingerLower20) reasons.push("below lower Bollinger band");
  if (latest.relativeStrength60 > 0) bullScore += 10;
  if (latest.relativeStrength60 < -0.05) bearScore += 10;
  if (latest.obv > latest.obvEma20) bullScore += 8;
  if (latest.obv < latest.obvEma20) bearScore += 8;
  if (latest.volume > latest.volume20 * 1.25) reasons.push("volume expansion");

  const direction =
    bullScore >= 65 && bullScore >= bearScore + 15
      ? "BULLISH"
      : bearScore >= 55 && bearScore >= bullScore + 10
        ? "BEARISH"
        : "NEUTRAL";

  return {
    direction,
    bullScore,
    bearScore,
    close: latest.close,
    rsi14: latest.rsi14,
    atr14: latest.atr14,
    hv20: latest.hv20,
    adx14: latest.adx14,
    ema20: latest.ema20,
    ema50: latest.ema50,
    high20: latest.high20,
    low20: latest.low20,
    relativeStrength60: latest.relativeStrength60,
    reasons,
  };
}

function buildTradeIdea(symbol, regime, chain, expirationMeta, context = {}) {
  const underlyingPrice = chain.underlyingPrice ?? regime.close;
  const calls = chain.calls.map((contract) => normalizeContract(contract, "call", underlyingPrice, expirationMeta.dte));
  const puts = chain.puts.map((contract) => normalizeContract(contract, "put", underlyingPrice, expirationMeta.dte));
  const allContracts = [...calls, ...puts];
  const atmIvValues = allContracts
    .filter((contract) => Math.abs(contract.strike / underlyingPrice - 1) < 0.03)
    .map((contract) => contract.impliedVolatility)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const atmIv = atmIvValues[Math.floor(atmIvValues.length / 2)];
  const ivHvRatio = Number.isFinite(atmIv) && regime.hv20 ? atmIv / regime.hv20 : null;

  if (regime.direction === "BULLISH") {
    const longCall = chooseLongContract(calls, [0.35, 0.6]);
    const shortCall = longCall ? chooseShortWing(calls, longCall, "bull") : null;
    return createDirectionalIdea(symbol, "CALL_DEBIT_SPREAD", regime, longCall, shortCall, expirationMeta, atmIv, ivHvRatio, context);
  }

  if (regime.direction === "BEARISH") {
    const longPut = chooseLongContract(puts, [0.35, 0.6]);
    const shortPut = longPut ? chooseShortWing(puts, longPut, "bear") : null;
    return createDirectionalIdea(symbol, "PUT_DEBIT_SPREAD", regime, longPut, shortPut, expirationMeta, atmIv, ivHvRatio, context);
  }

  return {
    symbol,
    signal: ivHvRatio && ivHvRatio > 1.25 ? "PREMIUM_SELL_WATCH" : "NO_TRADE",
    strategy: ivHvRatio && ivHvRatio > 1.25 ? "IRON_CONDOR_WATCH" : "NONE",
    score: Math.max(regime.bullScore, regime.bearScore),
    dte: expirationMeta.dte,
    underlying: round(regime.close),
    atmIv: round(atmIv * 100, 1),
    ivHvRatio: round(ivHvRatio, 2),
    reason: [...regime.reasons, "neutral technical regime"].join("; "),
    marketRegime: context.marketRegime?.regime,
    eventRisk: context.eventRisk?.level,
    eventReason: context.eventRisk?.reason,
  };
}

function createDirectionalIdea(symbol, strategy, regime, longContract, shortContract, expirationMeta, atmIv, ivHvRatio, context = {}) {
  if (!longContract) {
    return {
      symbol,
      signal: "NO_TRADE",
      strategy,
      score: Math.max(regime.bullScore, regime.bearScore),
      reason: "No liquid long option found",
      marketRegime: context.marketRegime?.regime,
      eventRisk: context.eventRisk?.level,
    };
  }

  const debit = shortContract ? Math.max(longContract.mid - shortContract.mid, 0) : null;
  const width = shortContract ? Math.abs(shortContract.strike - longContract.strike) : null;
  const reward = Number.isFinite(width) && Number.isFinite(debit) ? width - debit : null;
  const rewardRisk = Number.isFinite(debit) && debit > 0 ? reward / debit : null;
  const technicalScore = strategy === "CALL_DEBIT_SPREAD" ? regime.bullScore : regime.bearScore;
  const liquidityPenalty = longContract.spreadPct > 0.12 ? 10 : 0;
  const ivPenalty = ivHvRatio && ivHvRatio > 1.5 ? 10 : 0;
  const marketPenalty =
    strategy === "CALL_DEBIT_SPREAD" && context.marketRegime?.regime === "RISK_OFF"
      ? 20
      : strategy === "PUT_DEBIT_SPREAD" && context.marketRegime?.regime === "RISK_ON"
        ? 10
        : 0;
  const eventPenalty = context.eventRisk?.level === "HIGH" ? 15 : context.eventRisk?.level === "MANUAL_CHECK" ? 5 : 0;
  const score = technicalScore - liquidityPenalty - ivPenalty - marketPenalty - eventPenalty;
  let signal = score >= 70 && (!Number.isFinite(rewardRisk) || rewardRisk >= 1.2) ? strategy.replace("_DEBIT_SPREAD", "_SETUP") : "WATCH";
  if (context.eventRisk?.level === "HIGH") signal = "AVOID_EVENT_RISK";
  if (strategy === "CALL_DEBIT_SPREAD" && context.marketRegime?.regime === "RISK_OFF") signal = "WATCH";

  return {
    symbol,
    signal,
    strategy,
    score: round(score, 0),
    dte: expirationMeta.dte,
    expiration: new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10),
    underlying: round(regime.close),
    longStrike: longContract.strike,
    shortStrike: shortContract?.strike,
    longBid: round(longContract.bid),
    longAsk: round(longContract.ask),
    longMid: round(longContract.mid),
    shortBid: round(shortContract?.bid),
    shortAsk: round(shortContract?.ask),
    shortMid: round(shortContract?.mid),
    debit: round(debit),
    maxReward: round(reward),
    rewardRisk: round(rewardRisk, 2),
    stopUnderlying: round(strategy === "CALL_DEBIT_SPREAD" ? Math.max(regime.ema50, regime.close - 1.5 * regime.atr14) : Math.min(regime.ema50, regime.close + 1.5 * regime.atr14)),
    targetUnderlying: round(strategy === "CALL_DEBIT_SPREAD" ? regime.close + 2.5 * regime.atr14 : regime.close - 2.5 * regime.atr14),
    ...simpleLongOptionIdea(longContract, strategy, regime, expirationMeta),
    longVolume: longContract.volume,
    longOpenInterest: longContract.openInterest,
    longSpreadPct: round(longContract.spreadPct * 100, 1),
    longDelta: round(longContract.delta, 2),
    longGamma: round(longContract.gamma, 4),
    longTheta: round(longContract.theta, 3),
    longVega: round(longContract.vega, 3),
    probabilityItm: round(longContract.probabilityItm * 100, 1),
    atmIv: round(atmIv * 100, 1),
    ivHvRatio: round(ivHvRatio, 2),
    marketRegime: context.marketRegime?.regime,
    marketScore: context.marketRegime?.score,
    eventRisk: context.eventRisk?.level,
    eventReason: context.eventRisk?.reason,
    reason: regime.reasons.join("; "),
  };
}

export async function scanOptionsSymbol(symbol, benchmarkRows, config = {}) {
  const settings = { range: "18mo", minDte: 21, maxDte: 60, ...config };
  const rows = await fetchHistory(symbol, settings.range);
  if (rows.length < 160) return { symbol, signal: "SKIP", reason: "Not enough price history" };

  const regime = technicalRegime(rows, benchmarkRows);
  const expirations = await fetchOptionExpirations(symbol);
  const expirationMeta = chooseExpiration(expirations, settings.minDte, settings.maxDte);
  if (!expirationMeta) return { symbol, signal: "NO_TRADE", reason: "No target expiry found" };

  const chain = await fetchOptionChain(symbol, expirationMeta.expiration);
  if (!chain) return { symbol, signal: "NO_TRADE", reason: "No option chain found" };

  return buildTradeIdea(symbol, regime, chain, expirationMeta, {
    marketRegime: settings.marketRegime,
    eventRisk: settings.eventRisk,
  });
}
