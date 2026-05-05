import { ema, macd, rsi } from "./indicators.js";
import { fetchHistory } from "./marketData.js";

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function riskReward(entry, stop, target, direction) {
  if (![entry, stop, target].every(Number.isFinite)) return null;
  const risk = direction === "long" ? entry - stop : stop - entry;
  const reward = direction === "long" ? target - entry : entry - target;
  return risk > 0 ? reward / risk : null;
}

function sessionRows(rows) {
  const latestDate = rows.at(-1)?.date;
  return rows.filter((row) => row.date === latestDate);
}

function addVwap(rows) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return rows.map((row) => {
    const typicalPrice = (row.high + row.low + row.close) / 3;
    cumulativePriceVolume += typicalPrice * row.volume;
    cumulativeVolume += row.volume;
    return {
      ...row,
      vwap: cumulativeVolume ? cumulativePriceVolume / cumulativeVolume : null,
    };
  });
}

export async function scanIntradaySymbol(symbol, config = {}) {
  const settings = { range: "5d", interval: "5m", ...config };
  const rows = await fetchHistory(symbol, settings.range, settings.interval);
  if (rows.length < 80) return { symbol, signal: "SKIP", reason: "Not enough intraday bars" };

  const closes = rows.map((row) => row.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);
  const macdValues = macd(closes);
  const enriched = rows.map((row, index) => ({
    ...row,
    ema9: ema9[index],
    ema21: ema21[index],
    rsi14: rsi14[index],
    macd: macdValues[index],
  }));

  const today = addVwap(sessionRows(enriched));
  if (today.length < 12) return { symbol, signal: "SKIP", reason: "Current session too young" };

  const openingRange = today.slice(0, 6);
  const openingHigh = Math.max(...openingRange.map((row) => row.high));
  const openingLow = Math.min(...openingRange.map((row) => row.low));
  const latest = today.at(-1);
  const previous = today.at(-2);
  const avgVolume = today.slice(-20).reduce((total, row) => total + row.volume, 0) / Math.min(20, today.length);
  const priorVolume = today.slice(-21, -1).reduce((total, row) => total + row.volume, 0) / Math.min(20, Math.max(1, today.length - 1));
  const volumeSurge = latest.volume > avgVolume * 1.4;
  const volumeRatio = priorVolume ? latest.volume / priorVolume : 0;
  const aboveVwap = latest.close > latest.vwap;
  const belowVwap = latest.close < latest.vwap;
  const nearVwap = Math.abs(latest.close / latest.vwap - 1) < 0.0015;
  const bullishMomentum = latest.ema9 > latest.ema21 && latest.rsi14 > 55 && latest.macd.histogram > previous.macd.histogram;
  const bearishMomentum = latest.ema9 < latest.ema21 && latest.rsi14 < 45 && latest.macd.histogram < previous.macd.histogram;
  const longBreakout = latest.close > openingHigh;
  const shortBreakdown = latest.close < openingLow;

  let signal = "WAIT";
  let action = "No intraday trade right now.";
  let score = 0;
  const reasons = [];

  if (aboveVwap) {
    score += 20;
    reasons.push("above VWAP");
  }
  if (belowVwap) reasons.push("below VWAP");
  if (bullishMomentum) {
    score += 25;
    reasons.push("bullish 5m momentum");
  }
  if (bearishMomentum) {
    score += 25;
    reasons.push("bearish 5m momentum");
  }
  if (longBreakout) {
    score += 25;
    reasons.push("above opening range high");
  }
  if (shortBreakdown) {
    score += 25;
    reasons.push("below opening range low");
  }
  if (volumeSurge) {
    score += 15;
    reasons.push("volume surge");
  }

  if (nearVwap) reasons.push("too close to VWAP");

  const longStop = round(Math.max(latest.vwap, openingHigh) * 0.997);
  const shortStop = round(Math.min(latest.vwap, openingLow) * 1.003);
  const longTarget = round(latest.close + (latest.close - Math.max(latest.vwap, openingHigh)) * 1.5);
  const shortTarget = round(latest.close - (Math.min(latest.vwap, openingLow) - latest.close) * 1.5);
  const longRewardRisk = riskReward(latest.close, longStop, longTarget, "long");
  const shortRewardRisk = riskReward(latest.close, shortStop, shortTarget, "short");

  if (aboveVwap && bullishMomentum && (longBreakout || score >= 60)) {
    signal = "INTRADAY_LONG";
    action = `Buy-call idea only if ${symbol} holds above VWAP and stays above ${round(openingHigh)}.`;
  } else if (belowVwap && bearishMomentum && (shortBreakdown || score >= 60)) {
    signal = "INTRADAY_SHORT";
    action = `Buy-put idea only if ${symbol} stays below VWAP and below ${round(openingLow)}.`;
  }

  const isLong = signal === "INTRADAY_LONG";
  const isShort = signal === "INTRADAY_SHORT";
  const rewardRisk = isLong ? longRewardRisk : isShort ? shortRewardRisk : null;
  const tradeNow = (isLong || isShort) && score >= 70 && rewardRisk >= 1.4 && !nearVwap;
  const decision = tradeNow ? "TRADE_NOW" : score >= 40 ? "WAIT" : "NO_TRADE";
  const direction = isLong ? "BULLISH" : isShort ? "BEARISH" : aboveVwap ? "BULLISH_LEAN" : belowVwap ? "BEARISH_LEAN" : "NEUTRAL";
  const setup =
    decision === "NO_TRADE"
      ? "No clean edge"
      : tradeNow && isLong
      ? "VWAP hold + opening range breakout"
      : tradeNow && isShort
        ? "VWAP reject + opening range breakdown"
        : decision === "WAIT"
          ? "Needs cleaner confirmation"
          : "No clean edge";
  const plainDecision =
    decision === "TRADE_NOW"
      ? isLong
        ? "TRADE NOW: bullish call idea"
        : "TRADE NOW: bearish put idea"
      : decision === "WAIT"
        ? "WAIT: setup is not strong enough yet"
        : "NO TRADE: protect capital";
  const noTradeReason =
    decision === "TRADE_NOW"
      ? ""
      : nearVwap
        ? "Price is too close to VWAP, which often means chop."
        : score < 40
          ? "Score is low, so there is no clean intraday edge."
          : "Momentum or risk/reward is not strong enough for a trade now.";

  return {
    symbol,
    signal,
    decision,
    plainDecision,
    setup,
    direction,
    score,
    price: round(latest.close),
    vwap: round(latest.vwap),
    vwapState: aboveVwap ? "ABOVE_VWAP" : belowVwap ? "BELOW_VWAP" : "AT_VWAP",
    openingHigh: round(openingHigh),
    openingLow: round(openingLow),
    openingRangeState: longBreakout ? "ABOVE_OPENING_RANGE" : shortBreakdown ? "BELOW_OPENING_RANGE" : "INSIDE_OPENING_RANGE",
    rsi14: round(latest.rsi14, 1),
    volumeRatio: round(volumeRatio, 2),
    volumeState: volumeSurge ? "VOLUME_SURGE" : "NORMAL_VOLUME",
    stop: isLong ? longStop : isShort ? shortStop : "",
    target: isLong ? longTarget : isShort ? shortTarget : "",
    rewardRisk: round(rewardRisk, 2),
    entryPlan: isLong
      ? `Only enter above ${round(openingHigh)} while price is above VWAP.`
      : isShort
        ? `Only enter below ${round(openingLow)} while price is below VWAP.`
        : "No entry plan until price clears VWAP and momentum confirms.",
    invalidation: isLong
      ? `Cancel if price loses VWAP or falls back below ${round(openingHigh)}.`
      : isShort
        ? `Cancel if price reclaims VWAP or moves back above ${round(openingLow)}.`
        : noTradeReason,
    action,
    noTradeReason,
    reason: reasons.join("; ") || "No clean intraday edge",
    updatedAt: latest.datetime,
  };
}

export function summarizeIntraday(rows) {
  const cleanRows = rows.filter((row) => Number.isFinite(Number(row.price)) && Number.isFinite(Number(row.vwap)));
  const tradeNow = cleanRows.filter((row) => row.decision === "TRADE_NOW");
  const aboveVwap = cleanRows.filter((row) => Number(row.price) > Number(row.vwap)).length;
  const belowVwap = cleanRows.filter((row) => Number(row.price) < Number(row.vwap)).length;
  const longSignals = cleanRows.filter((row) => row.signal === "INTRADAY_LONG").length;
  const shortSignals = cleanRows.filter((row) => row.signal === "INTRADAY_SHORT").length;
  const biasScore = aboveVwap - belowVwap + longSignals * 2 - shortSignals * 2;
  const marketBias =
    biasScore >= 3
      ? "BULLISH_DAY"
      : biasScore <= -3
        ? "BEARISH_DAY"
        : "CHOP_DAY";
  const primaryAction =
    tradeNow.length > 0
      ? "One or more A setups are active. Keep size small and obey the stop."
      : marketBias === "CHOP_DAY"
        ? "No clean day-trading edge. Wait for VWAP to choose a side."
        : "Bias exists, but no A setup is confirmed yet.";

  return {
    marketBias,
    primaryAction,
    tradeNowCount: tradeNow.length,
    waitCount: cleanRows.filter((row) => row.decision === "WAIT").length,
    noTradeCount: cleanRows.filter((row) => row.decision === "NO_TRADE").length,
    aboveVwap,
    belowVwap,
    longSignals,
    shortSignals,
    maxTradesToday: 3,
    stopAfterLosses: 2,
    maxRiskPerTradePct: 0.5,
    rules: [
      "Only trade A setups.",
      "Maximum 3 intraday trades.",
      "Stop after 2 losses.",
      "Do not trade when price chops around VWAP.",
      "No averaging down.",
    ],
    updatedAt: new Date().toISOString(),
  };
}
