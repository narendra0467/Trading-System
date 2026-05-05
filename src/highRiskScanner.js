import { addIndicators, last } from "./indicators.js";

function pct(value) {
  return Number((value * 100).toFixed(2));
}

function money(value) {
  return Number(value.toFixed(2));
}

function classifyRisk(latest, riskPct) {
  if ((latest.hv20 ?? 0) > 1.1 || riskPct > 18) return "Extreme";
  if ((latest.hv20 ?? 0) > 0.75 || riskPct > 12) return "Very High";
  return "High";
}

function allocationForRating(rating) {
  if (rating === "A") return 700;
  if (rating === "B") return 500;
  if (rating === "C") return 300;
  return 0;
}

export function scoreHighRiskIdea(symbol, rows, benchmarkRows, meta = {}) {
  if (rows.length < 160) {
    return { symbol, name: meta.name ?? symbol, signal: "SKIP", score: 0, reason: "Not enough history" };
  }

  const enriched = addIndicators(rows, benchmarkRows);
  const latest = last(enriched);
  const previous = enriched[enriched.length - 2];
  const close20 = enriched[enriched.length - 21]?.close;
  const close60 = enriched[enriched.length - 61]?.close;
  const close120 = enriched[enriched.length - 121]?.close;
  const return20 = close20 ? latest.close / close20 - 1 : 0;
  const return60 = close60 ? latest.close / close60 - 1 : 0;
  const return120 = close120 ? latest.close / close120 - 1 : 0;
  const atrPct = latest.atr14 / latest.close;
  const volumeRatio = latest.volume20 ? latest.volume / latest.volume20 : 0;
  const breakoutDistance = latest.high55 ? latest.close / latest.high55 - 1 : -1;
  const stop = Math.max(latest.close - 2.4 * latest.atr14, latest.ema50 * 0.95);
  const risk = latest.close - stop;
  const riskPct = risk / latest.close;
  const target1 = latest.close + 2 * risk;
  const target2 = latest.close + 4 * risk;
  const doubleTarget = latest.close * 2;

  if (latest.close < 1 || (latest.volume20 ?? 0) < 100000) {
    return {
      symbol,
      name: meta.name ?? symbol,
      market: meta.market ?? "",
      theme: meta.theme ?? "",
      signal: "SKIP",
      score: 0,
      close: money(latest.close),
      reason: "Too illiquid or too low-priced for this system",
    };
  }

  let score = 0;
  const reasons = [];

  if (latest.close > latest.ema20 && latest.ema20 > latest.ema50) {
    score += 18;
    reasons.push("price above rising short-term trend");
  } else if (latest.close > latest.ema50) {
    score += 10;
    reasons.push("price above 50 EMA");
  }

  if (return20 > 0.18) {
    score += 18;
    reasons.push("explosive 20-day momentum");
  } else if (return20 > 0.08) {
    score += 12;
    reasons.push("strong 20-day momentum");
  }

  if (return60 > 0.35) {
    score += 18;
    reasons.push("major 60-day momentum");
  } else if (return60 > 0.15) {
    score += 12;
    reasons.push("positive 60-day trend");
  }

  if ((latest.relativeStrength60 ?? -1) > 0.2) {
    score += 15;
    reasons.push("crushing its benchmark");
  } else if ((latest.relativeStrength60 ?? -1) > 0) {
    score += 8;
    reasons.push("beating benchmark");
  }

  if (breakoutDistance >= 0) {
    score += 15;
    reasons.push("new 55-day breakout");
  } else if (breakoutDistance > -0.05) {
    score += 9;
    reasons.push("near 55-day high");
  }

  if (volumeRatio >= 1.8) {
    score += 14;
    reasons.push("heavy volume confirmation");
  } else if (volumeRatio >= 1.25) {
    score += 8;
    reasons.push("above-normal volume");
  }

  if (latest.rsi14 >= 55 && latest.rsi14 <= 82) {
    score += 10;
    reasons.push("momentum RSI without total blow-off");
  } else if (latest.rsi14 > 82) {
    score += 4;
    reasons.push("very extended RSI");
  }

  if (latest.macd.histogram > 0 && latest.macd.histogram > previous.macd.histogram) {
    score += 8;
    reasons.push("MACD acceleration");
  }

  if (latest.adx14 > 22 && latest.plusDi14 > latest.minusDi14) {
    score += 8;
    reasons.push("trend strength confirmed by ADX/DMI");
  }

  if (atrPct > 0.04 || (latest.hv20 ?? 0) > 0.55) {
    score += 6;
    reasons.push("enough volatility for outsized move");
  }

  const tooExtended = latest.rsi14 > 88 || riskPct > 0.24;
  const signal =
    score >= 82 && !tooExtended
      ? "SPEC_BUY"
      : score >= 70
        ? "STARTER_BUY"
        : score >= 58
          ? "WATCHLIST"
          : "NO_EDGE";
  const rating = score >= 82 && !tooExtended ? "A" : score >= 70 ? "B" : score >= 58 ? "C" : "D";
  const capitalPlan = allocationForRating(rating);
  const shares = capitalPlan > 0 ? Math.floor(capitalPlan / latest.close) : 0;
  const riskDollars = shares > 0 ? shares * risk : 0;
  const upsideToDouble = doubleTarget / latest.close - 1;
  const setup =
    signal === "SPEC_BUY"
      ? "Speculative buy setup"
      : signal === "STARTER_BUY"
        ? "Starter-only buy"
        : signal === "WATCHLIST"
          ? "Watch for trigger"
          : "No technical edge";
  const entryPlan =
    signal === "SPEC_BUY"
      ? `Buy only near ${money(latest.close - 0.4 * latest.atr14)}-${money(latest.close + 0.2 * latest.atr14)} while price holds above EMA20.`
      : signal === "STARTER_BUY"
        ? `Starter only. Better entry is a pullback toward EMA20 near ${money(latest.ema20)}.`
        : signal === "WATCHLIST"
          ? `Wait for a close above ${money(latest.high55)} with volume at least 1.25x normal.`
          : "No buy until trend and momentum repair.";
  const managerRead =
    signal === "SPEC_BUY"
      ? "This is the kind of technical risk I would fund from a small speculative sleeve because momentum, relative strength, and volume agree."
      : signal === "STARTER_BUY"
        ? "Good chart, but not clean enough for full speculative size. I would nibble only or wait for a better entry."
        : signal === "WATCHLIST"
          ? "Interesting high-beta name, but it still needs proof. I would keep it on the board, not buy blindly."
          : "The chart does not justify risking speculative capital right now.";

  return {
    symbol,
    name: meta.name ?? symbol,
    market: meta.market ?? "",
    theme: meta.theme ?? "",
    signal,
    setup,
    rating,
    score,
    close: money(latest.close),
    buyZoneLow: money(latest.close - 0.4 * latest.atr14),
    buyZoneHigh: money(latest.close + 0.2 * latest.atr14),
    stop: money(stop),
    target1: money(target1),
    target2: money(target2),
    doubleTarget: money(doubleTarget),
    riskPct: pct(riskPct),
    return20: pct(return20),
    return60: pct(return60),
    return120: pct(return120),
    relativeStrength60: latest.relativeStrength60 === null ? null : pct(latest.relativeStrength60),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    atrPct: pct(atrPct),
    hv20: latest.hv20 === null ? null : pct(latest.hv20),
    rsi14: Number(latest.rsi14.toFixed(1)),
    adx14: Number(latest.adx14.toFixed(1)),
    ema20: money(latest.ema20),
    ema50: money(latest.ema50),
    high55: money(latest.high55),
    capitalPlan,
    shares,
    riskDollars: money(riskDollars),
    maxLossMindset: "This sleeve can go to zero. Still use stops so one bad idea does not waste the whole $5K.",
    upsideGoal: `${pct(upsideToDouble)}% moonshot target`,
    riskClass: classifyRisk(latest, riskPct * 100),
    entryPlan,
    managerRead,
    reason: reasons.join("; ") || "No technical edge",
  };
}

export function summarizeHighRisk(rows, marketContext, accountSize = 5000) {
  const ranked = rows.filter((row) => ["SPEC_BUY", "STARTER_BUY", "WATCHLIST"].includes(row.signal));
  const buyRows = rows.filter((row) => row.signal === "SPEC_BUY");
  const starterRows = rows.filter((row) => row.signal === "STARTER_BUY");
  const top = ranked[0];
  const plannedCapital = ranked.slice(0, 7).reduce((total, row) => total + Number(row.capitalPlan || 0), 0);
  return {
    accountSize,
    sleeveName: "Very High Risk / High Reward",
    primaryAction: top ? `${top.symbol}: ${top.signal.replace("_", " ")}` : "No speculative edge today",
    topSymbol: top?.symbol ?? "",
    topReason: top?.managerRead ?? "No top setup.",
    buyCount: buyRows.length,
    starterCount: starterRows.length,
    watchCount: rows.filter((row) => row.signal === "WATCHLIST").length,
    plannedCapital,
    cashReserve: Math.max(0, accountSize - plannedCapital),
    rules: [
      "This is not retirement money.",
      "Maximum 5-7 names.",
      "No averaging down below stop.",
      "Take partial profit near target 1.",
      "Keep cash if the chart is not clean.",
    ],
    marketContext,
  };
}
