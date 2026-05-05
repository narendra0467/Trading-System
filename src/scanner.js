import { addIndicators, last } from "./indicators.js";

export function scoreStock(symbol, rows, benchmarkRows, config = {}) {
  const settings = {
    minPrice: 10,
    minAvgVolume: 200000,
    watchScore: 55,
    buyScore: 75,
    ...config,
  };

  if (rows.length < 160) {
    return { symbol, signal: "SKIP", score: 0, reason: "Not enough history" };
  }

  const enriched = addIndicators(rows, benchmarkRows);
  const latest = last(enriched);
  const previous = enriched[enriched.length - 2];
  let score = 0;
  const reasons = [];

  if (latest.close < settings.minPrice) {
    return { symbol, signal: "SKIP", score: 0, reason: "Below minimum price" };
  }
  if (!latest.volume20 || latest.volume20 < settings.minAvgVolume) {
    return { symbol, signal: "SKIP", score: 0, reason: "Below minimum liquidity" };
  }

  if (latest.close > latest.ema20 && latest.ema20 > latest.ema50 && latest.ema50 > latest.ema150) {
    score += 25;
    reasons.push("stacked uptrend");
  } else if (latest.close > latest.ema50 && latest.ema50 > latest.ema150) {
    score += 15;
    reasons.push("primary trend up");
  }

  if (latest.ema50Slope20 > 0.02) {
    score += 15;
    reasons.push("rising 50 EMA");
  }
  if (latest.rsi14 >= 50 && latest.rsi14 <= 72) {
    score += 15;
    reasons.push("constructive RSI");
  } else if (latest.rsi14 > 72) {
    score += 5;
    reasons.push("extended RSI");
  }
  if (latest.macd.histogram > 0 && latest.macd.histogram > previous.macd.histogram) {
    score += 15;
    reasons.push("MACD improving");
  }
  const breakoutDistance = latest.close / latest.high55 - 1;
  if (breakoutDistance >= 0) {
    score += 15;
    reasons.push("55-day breakout");
  } else if (breakoutDistance >= -0.03) {
    score += 10;
    reasons.push("near 55-day high");
  }
  if (latest.volume > latest.volume20 * 1.25) {
    score += 10;
    reasons.push("volume expansion");
  }
  if (latest.relativeStrength60 > 0) {
    score += 10;
    reasons.push("outperforming benchmark");
  }

  const stop = Math.max(latest.ema50, latest.close - 2 * latest.atr14);
  const risk = latest.close - stop;
  const riskPctRaw = ((latest.close - stop) / latest.close) * 100;
  const target1 = latest.close + 1.5 * risk;
  const target = latest.close + 3 * (latest.close - stop);
  let signal = "NO_SETUP";
  if (latest.close < latest.ema50 || latest.rsi14 < 45) signal = "EXIT_WARNING";
  else if (score >= settings.buyScore) signal = "BUY_SETUP";
  else if (score >= settings.watchScore) signal = "WATCH";
  else if (latest.close > latest.ema20 && latest.ema20 > latest.ema50) signal = "HOLD_TREND";

  const setup =
    signal === "BUY_SETUP" && breakoutDistance >= 0
      ? "Breakout trend"
      : signal === "BUY_SETUP"
        ? "Trend continuation"
        : signal === "WATCH"
          ? "Watch for breakout"
          : signal === "HOLD_TREND"
            ? "Existing uptrend"
            : signal === "EXIT_WARNING"
              ? "Protect or avoid"
              : "No clean setup";
  const buyZoneLow = latest.close - 0.5 * latest.atr14;
  const buyZoneHigh = latest.close + 0.25 * latest.atr14;
  const extended = latest.rsi14 > 75 || riskPctRaw > 10;
  const entryPlan =
    signal === "BUY_SETUP" && extended
      ? `Extended move. Starter only near ${buyZoneLow.toFixed(2)}-${buyZoneHigh.toFixed(2)}, or wait for a pullback toward EMA20.`
      : signal === "BUY_SETUP"
      ? `Buy zone ${buyZoneLow.toFixed(2)}-${buyZoneHigh.toFixed(2)} if price holds above EMA20.`
      : signal === "WATCH"
        ? `Wait for a close above ${latest.high55.toFixed(2)} or a calm pullback near EMA20.`
        : signal === "HOLD_TREND"
          ? "Good existing trend, but wait for a cleaner entry before starting new size."
          : signal === "EXIT_WARNING"
            ? "No new buy. Protect capital until price repairs above EMA50."
            : "No new buy until trend, momentum, and relative strength improve.";
  const holdPlan =
    signal === "BUY_SETUP" || signal === "WATCH" || signal === "HOLD_TREND"
      ? "Plan for 2-8 weeks. Stay only while price respects the stop and trend stays intact."
      : "No swing hold plan right now.";
  const sizePlan =
    signal === "BUY_SETUP" && extended
      ? "Starter size only. Add later only if the stock holds trend and risk tightens."
      : signal === "BUY_SETUP"
        ? "Normal starter position. Add only after the setup proves itself."
        : signal === "WATCH"
          ? "No position yet. Keep it on watch."
          : signal === "EXIT_WARNING"
            ? "Reduce or avoid."
            : "No position.";

  return {
    symbol,
    signal,
    setup,
    score,
    close: Number(latest.close.toFixed(2)),
    rsi14: Number(latest.rsi14.toFixed(1)),
    ema20: Number(latest.ema20.toFixed(2)),
    ema50: Number(latest.ema50.toFixed(2)),
    high55: Number(latest.high55.toFixed(2)),
    buyZoneLow: Number(buyZoneLow.toFixed(2)),
    buyZoneHigh: Number(buyZoneHigh.toFixed(2)),
    stop: Number(stop.toFixed(2)),
    target1: Number(target1.toFixed(2)),
    target: Number(target.toFixed(2)),
    riskPct: Number(riskPctRaw.toFixed(2)),
    rewardRisk: risk > 0 ? 3 : null,
    avgVolume20: Math.round(latest.volume20),
    relativeStrength60:
      latest.relativeStrength60 === null ? null : Number(latest.relativeStrength60.toFixed(4)),
    entryPlan,
    holdPlan,
    sizePlan,
    reason: reasons.join("; ") || "No technical edge",
  };
}
