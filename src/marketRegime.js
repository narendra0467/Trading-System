import { addIndicators, last } from "./indicators.js";
import { fetchHistory } from "./marketData.js";

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function scoreIndex(symbol, rows, benchmarkRows = []) {
  const enriched = addIndicators(rows, benchmarkRows);
  const latest = last(enriched);
  let score = 0;
  const reasons = [];

  if (latest.close > latest.ema20) score += 10;
  else reasons.push(`${symbol} below 20 EMA`);
  if (latest.close > latest.ema50) score += 15;
  else reasons.push(`${symbol} below 50 EMA`);
  if (latest.close > latest.ema150) score += 15;
  else reasons.push(`${symbol} below 150 EMA`);
  if (latest.ema50Slope20 > 0.01) score += 15;
  if (latest.adx14 > 20 && latest.plusDi14 > latest.minusDi14) score += 15;
  if (latest.rsi14 >= 45 && latest.rsi14 <= 72) score += 10;
  if (latest.relativeStrength60 > -0.02 || symbol === "SPY") score += 10;

  return {
    symbol,
    score,
    close: round(latest.close),
    rsi14: round(latest.rsi14, 1),
    adx14: round(latest.adx14, 1),
    above20: latest.close > latest.ema20,
    above50: latest.close > latest.ema50,
    above150: latest.close > latest.ema150,
    reasons,
  };
}

export async function buildMarketRegime({ benchmark = "QQQ", range = "18mo" } = {}) {
  const [spyRows, qqqRows, iwmRows, vixRows] = await Promise.all([
    fetchHistory("SPY", range),
    fetchHistory("QQQ", range),
    fetchHistory("IWM", range),
    fetchHistory("^VIX", range).catch(() => []),
  ]);
  const benchmarkRows = benchmark === "SPY" ? spyRows : qqqRows;
  const indexes = [
    scoreIndex("SPY", spyRows, benchmarkRows),
    scoreIndex("QQQ", qqqRows, benchmarkRows),
    scoreIndex("IWM", iwmRows, benchmarkRows),
  ];
  const vixLatest = vixRows.length ? last(addIndicators(vixRows, [])) : null;
  const indexScore = indexes.reduce((total, item) => total + item.score, 0) / indexes.length;
  let score = indexScore;
  const reasons = indexes.flatMap((item) => item.reasons);

  if (vixLatest) {
    if (vixLatest.close < 20 && vixLatest.close < vixLatest.ema20) score += 10;
    if (vixLatest.close > 25) {
      score -= 15;
      reasons.push("VIX above 25");
    }
    if (vixLatest.close > vixLatest.ema20 && vixLatest.ema20 > vixLatest.ema50) {
      score -= 10;
      reasons.push("VIX trend rising");
    }
  }

  const regime = score >= 70 ? "RISK_ON" : score >= 50 ? "MIXED" : "RISK_OFF";
  const bullishSizeMultiplier = regime === "RISK_ON" ? 1 : regime === "MIXED" ? 0.5 : 0.25;
  const bearishSizeMultiplier = regime === "RISK_OFF" ? 1 : regime === "MIXED" ? 0.75 : 0.5;

  return {
    regime,
    score: round(score, 0),
    bullishSizeMultiplier,
    bearishSizeMultiplier,
    vix: vixLatest ? round(vixLatest.close, 2) : null,
    indexes,
    reason: reasons.length ? reasons.join("; ") : "Market breadth and trend acceptable",
  };
}

