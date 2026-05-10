import { ema, rsi, last } from "./indicators.js";
import { analyzeStock } from "./stockAnalyzer.js";
import { fetchHistory, fetchOptionChain, fetchOptionExpirations } from "./marketData.js";

const DAY_SECONDS = 24 * 60 * 60;
const MIN_DTE = 180;
const PREFERRED_MIN_DTE = 365;
const PREFERRED_MAX_DTE = 730;

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function raw(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  return value;
}

function pct(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 100 : null;
}

function daysToExpiration(expiration) {
  return Math.round((expiration * 1000 - Date.now()) / (DAY_SECONDS * 1000));
}

function midPrice(contract) {
  if (Number.isFinite(contract.bid) && Number.isFinite(contract.ask) && contract.bid > 0 && contract.ask > 0) {
    return (contract.bid + contract.ask) / 2;
  }
  return Number.isFinite(contract.lastPrice) && contract.lastPrice > 0 ? contract.lastPrice : null;
}

function spreadPct(contract) {
  const mid = midPrice(contract);
  if (!mid || !Number.isFinite(contract.bid) || !Number.isFinite(contract.ask)) return Infinity;
  return (contract.ask - contract.bid) / mid;
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function normalPdf(value) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function estimateCallGreeks({ underlying, strike, dte, iv }) {
  const years = Math.max(dte / 365, 1 / 365);
  const volatility = Number.isFinite(iv) && iv > 0.02 ? iv : 0.45;
  const rate = 0.04;
  const d1 = (Math.log(underlying / strike) + (rate + volatility ** 2 / 2) * years) / (volatility * Math.sqrt(years));
  const d2 = d1 - volatility * Math.sqrt(years);
  const delta = normalCdf(d1);
  const thetaAnnual = -((underlying * normalPdf(d1) * volatility) / (2 * Math.sqrt(years))) - rate * strike * Math.exp(-rate * years) * normalCdf(d2);
  const vega = underlying * normalPdf(d1) * Math.sqrt(years) / 100;
  return {
    delta,
    theta: thetaAnnual / 365,
    vega,
  };
}

function weightingScore(analysis, label, fallback) {
  const item = analysis.reportScores?.weighting?.find((row) => row.label === label);
  return Number.isFinite(item?.score) ? item.score : fallback;
}

function buildUnderlyingScore(analysis) {
  const business = weightingScore(analysis, "Business Quality", analysis.fundamentals?.score ?? analysis.totalScore ?? 45);
  const growth = weightingScore(analysis, "Growth", analysis.reportScores?.growthPotential ?? analysis.fundamentals?.score ?? 45);
  const financial = Math.round(((analysis.fundamentals?.score ?? 45) * 0.65) + (weightingScore(analysis, "Balance Sheet", 50) * 0.35));
  const valuation = weightingScore(analysis, "Valuation", analysis.valuation?.score ?? 45);
  const catalyst = weightingScore(analysis, "Catalysts", analysis.analysts?.score ?? 45);
  const technical = analysis.technical?.score ?? 45;
  const components = [
    { label: "Business quality", weight: 20, score: round(business) },
    { label: "Growth quality", weight: 20, score: round(growth) },
    { label: "Financial strength", weight: 15, score: round(financial) },
    { label: "Valuation reasonableness", weight: 15, score: round(valuation) },
    { label: "Catalyst strength", weight: 15, score: round(catalyst) },
    { label: "Technical setup", weight: 15, score: round(technical) },
  ];
  const score = clamp(Math.round(components.reduce((sum, item) => sum + item.score * item.weight, 0) / 100));
  return { score, components };
}

function technicalSnapshot(rows, analysis) {
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const latest = last(rows);
  const latestEma50 = last(ema50);
  const latestEma200 = last(ema200);
  const high52 = Math.max(...rows.slice(-252).map((row) => row.high));
  const low52 = Math.min(...rows.slice(-252).map((row) => row.low));
  const volume20 = volumes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.min(20, volumes.length);
  return {
    currentPrice: latest?.close ?? analysis.currentPrice,
    ema50: latestEma50,
    ema200: latestEma200,
    rsi14: last(rsi14),
    high52,
    low52,
    distanceFrom52WeekHighPct: high52 ? ((latest.close / high52) - 1) * 100 : null,
    distanceFrom50DayPct: latestEma50 ? ((latest.close / latestEma50) - 1) * 100 : null,
    distanceFrom200DayPct: latestEma200 ? ((latest.close / latestEma200) - 1) * 100 : null,
    latestVolumeVs20Day: volume20 ? latest.volume / volume20 : null,
  };
}

function pullbackOpportunity(snapshot, analysis) {
  let score = 0;
  const reasons = [];
  const risks = [];
  const fromHigh = snapshot.distanceFrom52WeekHighPct;
  const from50 = snapshot.distanceFrom50DayPct;
  const from200 = snapshot.distanceFrom200DayPct;
  const rsiValue = snapshot.rsi14;
  const price = snapshot.currentPrice;

  if (fromHigh <= -8 && fromHigh >= -28) { score += 25; reasons.push("meaningful pullback from the 52-week high"); }
  else if (fromHigh > -5) { score += 8; risks.push("stock is still close to highs"); }
  else if (fromHigh < -40) { score -= 10; risks.push("drawdown is deep enough to question the thesis"); }

  if (Math.abs(from50 ?? 999) <= 6) { score += 18; reasons.push("price is near the 50-day trend area"); }
  else if (from50 < -10) { score += 6; risks.push("price is meaningfully below the 50-day average"); }

  if (price > snapshot.ema200) { score += 18; reasons.push("long-term trend remains above the 200-day average"); }
  else { score -= 16; risks.push("price is below the 200-day average"); }

  if (rsiValue >= 42 && rsiValue <= 58) { score += 16; reasons.push("RSI has reset without becoming washed out"); }
  else if (rsiValue < 35) { score += 5; risks.push("RSI is weak; wait for reclaim"); }
  else if (rsiValue > 70) { score -= 12; risks.push("RSI is extended"); }

  if ((snapshot.latestVolumeVs20Day ?? 1) <= 1.35) { score += 10; reasons.push("selloff volume is not extreme"); }
  else { risks.push("recent volume is elevated; confirm the selloff is not company-specific"); }

  if ((analysis.fundamentals?.score ?? 0) >= 55 && (analysis.riskScore ?? 70) <= 70) {
    score += 13;
    reasons.push("fundamentals still look intact from available data");
  } else {
    risks.push("fundamental/risk profile needs confirmation before DCA");
  }

  const total = clamp(Math.round(score + 20));
  const classification =
    price < snapshot.ema200 && (fromHigh ?? 0) < -35
      ? "Falling Knife / Do Not DCA"
      : price < snapshot.ema200
        ? "Waiting for Reclaim"
        : total >= 75
          ? "Healthy Pullback"
          : total >= 60
            ? "Deep Pullback but Thesis Intact"
            : total >= 45
              ? "Waiting for Reclaim"
              : "Broken Chart / Avoid";
  return {
    score: total,
    classification,
    reasons,
    risks,
    distanceFrom52WeekHighPct: round(fromHigh, 1),
    distanceFrom50DayPct: round(from50, 1),
    distanceFrom200DayPct: round(from200, 1),
    rsi14: round(rsiValue, 1),
    volumeVs20Day: round(snapshot.latestVolumeVs20Day, 2),
  };
}

function contractBucket(delta) {
  if (delta >= 0.75 && delta <= 0.9) return "Conservative";
  if (delta >= 0.55 && delta < 0.75) return "Balanced";
  if (delta >= 0.35 && delta < 0.55) return "Aggressive";
  return "Speculative / Avoid";
}

function contractQuality(contract) {
  let score = 0;
  const reasons = [];
  const risks = [];
  if (contract.dte >= PREFERRED_MIN_DTE && contract.dte <= PREFERRED_MAX_DTE) { score += 20; reasons.push("preferred 12-24 month expiration"); }
  else if (contract.dte >= MIN_DTE) { score += 10; reasons.push("meets minimum 6-month rule"); }
  else risks.push("less than 6 months to expiration");

  if (contract.delta >= 0.6 && contract.delta <= 0.85) { score += 20; reasons.push("delta is in the preferred LEAPS range"); }
  else if (contract.delta >= 0.35 && contract.delta < 0.6) { score += 10; risks.push("delta is aggressive/speculative"); }
  else risks.push("delta is outside preferred range");

  if (contract.spreadPct <= 0.08) { score += 18; reasons.push("tight bid/ask spread"); }
  else if (contract.spreadPct <= 0.15) { score += 12; reasons.push("acceptable spread"); }
  else if (contract.spreadPct <= 0.25) { score += 5; risks.push("spread is wide"); }
  else risks.push("spread is too wide");

  if (contract.openInterest >= 500) { score += 16; reasons.push("open interest is strong"); }
  else if (contract.openInterest >= 100) { score += 10; reasons.push("open interest is usable"); }
  else if (contract.volume >= 10) { score += 7; reasons.push("daily volume is usable"); }
  else risks.push("open interest/volume are thin");

  if (contract.impliedVolatility <= 0.55) { score += 10; reasons.push("IV is not extreme"); }
  else if (contract.impliedVolatility <= 0.85) { score += 4; risks.push("IV is elevated"); }
  else risks.push("IV is very high");

  if (contract.extrinsicValue >= 0 && contract.extrinsicValue <= contract.mid * 0.65) { score += 10; reasons.push("premium has meaningful intrinsic support"); }
  else if (contract.extrinsicValue > contract.mid * 0.85) risks.push("premium is mostly extrinsic/time value");

  if (contract.breakevenMovePct <= 25) { score += 6; reasons.push("breakeven move is reasonable"); }
  else if (contract.breakevenMovePct > 45) risks.push("breakeven requires a very large move");

  const total = clamp(Math.round(score));
  return { score: total, reasons, risks };
}

function normalizeCallContract(contract, underlying, expirationMeta) {
  const mid = midPrice(contract);
  const spread = spreadPct(contract);
  const impliedVolatility = raw(contract.impliedVolatility);
  const greeks = estimateCallGreeks({
    underlying,
    strike: contract.strike,
    dte: expirationMeta.dte,
    iv: impliedVolatility,
  });
  const intrinsicValue = Math.max(0, underlying - contract.strike);
  const extrinsicValue = Number.isFinite(mid) ? Math.max(0, mid - intrinsicValue) : null;
  const breakeven = Number.isFinite(mid) ? contract.strike + mid : null;
  const normalized = {
    contractSymbol: contract.contractSymbol,
    expiration: new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10),
    dte: expirationMeta.dte,
    strike: contract.strike,
    lastPrice: round(raw(contract.lastPrice)),
    bid: round(raw(contract.bid)),
    ask: round(raw(contract.ask)),
    mid: round(mid),
    delta: round(raw(contract.delta) ?? greeks.delta, 2),
    theta: round(raw(contract.theta) ?? greeks.theta, 4),
    vega: round(raw(contract.vega) ?? greeks.vega, 4),
    impliedVolatility: round(impliedVolatility * 100, 1),
    impliedVolatilityRaw: impliedVolatility,
    openInterest: raw(contract.openInterest) ?? 0,
    volume: raw(contract.volume) ?? 0,
    breakeven: round(breakeven),
    breakevenMovePct: round(breakeven && underlying ? ((breakeven / underlying) - 1) * 100 : null, 1),
    intrinsicValue: round(intrinsicValue),
    extrinsicValue: round(extrinsicValue),
    spreadPct: round(spread * 100, 1),
    spreadPctRaw: spread,
    bucket: contractBucket(raw(contract.delta) ?? greeks.delta),
  };
  const quality = contractQuality({
    ...normalized,
    impliedVolatility: impliedVolatility,
    spreadPct: spread,
  });
  return {
    ...normalized,
    contractQualityScore: quality.score,
    contractQualityReasons: quality.reasons,
    contractQualityRisks: quality.risks,
  };
}

function contractPasses(contract) {
  return contract.dte >= MIN_DTE &&
    Number.isFinite(contract.mid) &&
    contract.mid > 0 &&
    contract.delta >= 0.35 &&
    contract.delta <= 0.9 &&
    contract.spreadPctRaw <= 0.3 &&
    ((contract.openInterest ?? 0) >= 50 || (contract.volume ?? 0) >= 5);
}

function chooseExpirations(expirations) {
  return expirations
    .map((expiration) => ({ expiration, dte: daysToExpiration(expiration) }))
    .filter(({ dte }) => dte >= MIN_DTE && dte <= PREFERRED_MAX_DTE + 120)
    .sort((a, b) => {
      const aPenalty = a.dte >= PREFERRED_MIN_DTE && a.dte <= PREFERRED_MAX_DTE ? 0 : 180;
      const bPenalty = b.dte >= PREFERRED_MIN_DTE && b.dte <= PREFERRED_MAX_DTE ? 0 : 180;
      return aPenalty - bPenalty || Math.abs(a.dte - 540) - Math.abs(b.dte - 540);
    })
    .slice(0, 4);
}

function dcaPlan({ price, snapshot, pullback, analysis, contract }) {
  const thesisIntact = analysis.totalScore >= 60 && pullback.classification !== "Broken Chart / Avoid" && pullback.classification !== "Falling Knife / Do Not DCA";
  const liquidityGood = contract && contract.contractQualityScore >= 60 && contract.spreadPctRaw <= 0.25;
  const timeOk = contract && contract.dte >= 270;
  const trendOk = price > snapshot.ema200;
  const ivOk = !contract || !Number.isFinite(contract.impliedVolatilityRaw) || contract.impliedVolatilityRaw <= 0.75;
  const allowed = thesisIntact && liquidityGood && timeOk && trendOk && ivOk;
  const invalidation = Math.min(snapshot.ema200 ?? price * 0.8, analysis.technical?.stop ?? price * 0.8);
  return {
    suitability: allowed ? "DCA Allowed if Thesis Holds" : "DCA Rejected / Wait",
    allowed,
    starterPositionZone: `${round(price * 0.98)}-${round(price * 1.02)}`,
    addZone1: `${round(Math.max(invalidation, price * 0.9))}-${round(price * 0.94)}`,
    addZone2: `${round(Math.max(invalidation, price * 0.82))}-${round(price * 0.88)}`,
    stopAddingInvalidationLevel: round(invalidation),
    rules: allowed
      ? "Add only if the thesis is intact, price is near support, long-term trend survives, IV/spread remain reasonable, and total position risk remains capped."
      : "Do not DCA unless the thesis, trend, time-to-expiration, liquidity, and IV conditions improve.",
  };
}

function riskScore({ analysis, contract, pullback, underlyingScore }) {
  let risk = 45;
  risk += Math.max(0, 70 - underlyingScore) * 0.45;
  risk += Math.max(0, 50 - (analysis.valuation?.score ?? 50)) * 0.25;
  risk += Math.max(0, (analysis.riskScore ?? 50) - 50) * 0.45;
  if (contract) {
    if (contract.spreadPctRaw > 0.15) risk += 10;
    if (contract.contractQualityScore < 60) risk += 14;
    if (contract.impliedVolatilityRaw > 0.75) risk += 12;
    if (contract.delta < 0.45) risk += 10;
    if (contract.dte < 365) risk += 8;
  } else {
    risk += 22;
  }
  if (pullback.classification.includes("Falling Knife") || pullback.classification.includes("Broken")) risk += 18;
  if (pullback.classification === "Waiting for Reclaim") risk += 8;
  return clamp(Math.round(risk));
}

function opportunityLabel(score) {
  if (score >= 85) return "A+ LEAPS Candidate";
  if (score >= 75) return "Strong Watchlist Candidate";
  if (score >= 65) return "Watch Only / Wait for Better Entry";
  if (score >= 50) return "Too Risky or Poor Setup";
  return "Avoid";
}

function opportunityScore({ underlyingScore, analysis, pullback, contract, dca }) {
  if (underlyingScore < 70) return Math.min(49, Math.round(underlyingScore * 0.55));
  if (!contract) return 50;
  const growthCatalyst = Math.round(((analysis.reportScores?.growthPotential ?? 45) * 0.5) + ((analysis.analysts?.score ?? 45) * 0.25) + ((analysis.newsEngine?.score ?? 45) * 0.25));
  const valuationReward = Math.round(((analysis.valuation?.score ?? 45) * 0.7) + ((100 - (analysis.riskScore ?? 60)) * 0.3));
  const liquidity = contract.spreadPctRaw <= 0.08 && contract.openInterest >= 500
    ? 90
    : contract.spreadPctRaw <= 0.15 && contract.openInterest >= 100
      ? 75
      : contract.spreadPctRaw <= 0.25
        ? 55
        : 25;
  return clamp(Math.round(
    underlyingScore * 0.25 +
    growthCatalyst * 0.20 +
    pullback.score * 0.15 +
    contract.contractQualityScore * 0.15 +
    valuationReward * 0.10 +
    liquidity * 0.10 +
    (dca.allowed ? 85 : 35) * 0.05
  ));
}

async function optionCandidates(symbol, underlying) {
  const expirations = chooseExpirations(await fetchOptionExpirations(symbol));
  const candidates = [];
  for (const expirationMeta of expirations) {
    const chain = await fetchOptionChain(symbol, expirationMeta.expiration);
    for (const contract of chain?.calls ?? []) {
      const normalized = normalizeCallContract(contract, chain.underlyingPrice ?? underlying, expirationMeta);
      if (contractPasses(normalized)) candidates.push(normalized);
    }
  }
  return candidates.sort((a, b) =>
    b.contractQualityScore - a.contractQualityScore ||
    Math.abs(a.delta - 0.7) - Math.abs(b.delta - 0.7) ||
    a.spreadPctRaw - b.spreadPctRaw
  );
}

function statusLabel({ underlyingScore, opportunity, risk, pullback, contract }) {
  if (underlyingScore < 70) return "Avoid";
  if (!contract) return "Avoid";
  if (risk >= 75) return "Avoid";
  if (/earnings/i.test(contract?.contractQualityRisks?.join(" ") ?? "")) return "Wait for Earnings";
  if (opportunity >= 85 && pullback.score >= 60) return "Ready for Starter";
  if (opportunity >= 70) return "Watch for Pullback";
  return "Avoid";
}

function flatContract(contract) {
  if (!contract) return {};
  return {
    expiration: contract.expiration,
    dte: contract.dte,
    strike: contract.strike,
    lastPrice: contract.lastPrice,
    bid: contract.bid,
    ask: contract.ask,
    mid: contract.mid,
    delta: contract.delta,
    theta: contract.theta,
    vega: contract.vega,
    impliedVolatility: contract.impliedVolatility,
    openInterest: contract.openInterest,
    volume: contract.volume,
    breakeven: contract.breakeven,
    breakevenMovePct: contract.breakevenMovePct,
    intrinsicValue: contract.intrinsicValue,
    extrinsicValue: contract.extrinsicValue,
    spreadPct: contract.spreadPct,
    contractQualityScore: contract.contractQualityScore,
    bucket: contract.bucket,
  };
}

function riskLabel(score) {
  if (score <= 30) return "Lower Risk";
  if (score <= 60) return "Medium Risk";
  if (score <= 80) return "High Risk";
  return "Speculative / Extreme Risk";
}

function timeToExpiryBucket(dte) {
  if (dte >= 540) return "18-24+ months remaining: best zone";
  if (dte >= 365) return "12-18 months remaining: healthy";
  if (dte >= 270) return "9-12 months remaining: caution";
  if (dte >= 180) return "6-9 months remaining: roll/exit review";
  if (dte >= 90) return "Under 6 months: tactical option";
  return "Under 3 months: high danger";
}

function daysUntil(dateText) {
  const date = dateText ? new Date(dateText) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.round((date.getTime() - Date.now()) / (DAY_SECONDS * 1000));
}

function eventRiskFromAnalysis(analysis) {
  const earningsDate = analysis.dataQuality?.latestQuarterUsed;
  const earningsDays = daysUntil(earningsDate);
  const negativeNews = analysis.newsEngine?.bearishCount ?? 0;
  const catalystNews = analysis.newsEngine?.catalystCount ?? 0;
  const level =
    Number.isFinite(earningsDays) && earningsDays >= 0 && earningsDays <= 14
      ? "High Event Risk"
      : negativeNews >= 2
        ? "Medium Event Risk"
        : catalystNews >= 2
          ? "Medium Event Risk"
          : "Low Event Risk";
  return {
    level,
    earningsDate: Number.isFinite(earningsDays) ? earningsDate : "Unavailable",
    earningsDays,
    headline: Number.isFinite(earningsDays) && earningsDays >= 0
      ? `Earnings window is about ${earningsDays} days away.`
      : analysis.newsEngine?.tone ?? "No clear event risk from available data.",
    items: analysis.newsEngine?.items?.slice(0, 5) ?? [],
    upgrades: analysis.newsEngine?.upgrades?.slice(0, 5) ?? [],
  };
}

function contractClassification(contract) {
  if (!contract) return "Avoid - Poor Liquidity";
  if (contract.dte < MIN_DTE) return "Avoid - Too Little Time";
  if (contract.spreadPctRaw > 0.3 || ((contract.openInterest ?? 0) < 50 && (contract.volume ?? 0) < 5)) return "Avoid - Poor Liquidity";
  if (contract.breakevenMovePct > 45) return "Avoid - Bad Risk/Reward";
  if (contract.delta >= 0.75 && contract.delta <= 0.9) return "Conservative LEAPS Call";
  if (contract.delta >= 0.55 && contract.delta < 0.75) return "Balanced LEAPS Call";
  if (contract.delta >= 0.35 && contract.delta < 0.55) return "Aggressive LEAPS Call";
  return "Speculative Lottery Call";
}

function selectedContractSet(candidates = []) {
  const bestBy = (predicate) => candidates
    .filter(predicate)
    .sort((a, b) => b.contractQualityScore - a.contractQualityScore || a.spreadPctRaw - b.spreadPctRaw)[0] ?? null;
  return {
    conservative: bestBy((row) => row.delta >= 0.75 && row.delta <= 0.9),
    balanced: bestBy((row) => row.delta >= 0.55 && row.delta < 0.75),
    aggressive: bestBy((row) => row.delta >= 0.35 && row.delta < 0.55),
  };
}

function enhanceContract(contract, selectionReason) {
  if (!contract) return null;
  return {
    ...contract,
    gamma: contract.gamma ?? null,
    ivRankOrPercentile: "Unavailable from Yahoo option chain",
    riskLabel: contract.delta < 0.55 ? "Speculative" : contract.spreadPctRaw > 0.15 ? "Caution" : "Defined premium risk",
    classification: contractClassification(contract),
    whySelected: selectionReason,
  };
}

async function findCurrentPositionContract(symbol, expiration, strike, underlying) {
  const expirations = await fetchOptionExpirations(symbol);
  const target = expirations
    .map((item) => ({ expiration: item, date: new Date(item * 1000).toISOString().slice(0, 10), dte: daysToExpiration(item) }))
    .find((item) => item.date === expiration);
  if (!target) return null;
  const chain = await fetchOptionChain(symbol, target.expiration);
  const match = (chain?.calls ?? [])
    .map((contract) => normalizeCallContract(contract, chain.underlyingPrice ?? underlying, target))
    .sort((a, b) => Math.abs(Number(a.strike) - Number(strike)) - Math.abs(Number(b.strike) - Number(strike)))[0];
  return match ?? null;
}

function classifyDecline({ unrealizedPct, thesisStatus, technicalStatus, optionStatus, pullback, eventRisk }) {
  if (thesisStatus === "Broken") return "Company-Specific Thesis Break";
  if (technicalStatus === "Broken") return pullback.classification === "Falling Knife / Do Not DCA" ? "Falling Knife / Do Not Add" : "Technical Breakdown";
  if (optionStatus === "Time Risk" || optionStatus === "Damaged") return "Option Decay Problem";
  if (optionStatus === "Liquidity Risk") return "Liquidity / Spread Problem";
  if (eventRisk.level === "High Event Risk") return "Earnings / Guidance Damage";
  if (unrealizedPct < -15 && pullback.classification === "Healthy Pullback") return "Healthy Pullback";
  if (unrealizedPct < -15 && pullback.classification === "Deep Pullback but Thesis Intact") return "Market-Wide Selloff";
  if (unrealizedPct < -15) return "Sector Rotation";
  return "No major decline";
}

function positionHealthScore({ underlyingScore, pullback, contract, dte, unrealizedPct, thesisStatus, technicalStatus }) {
  let score = underlyingScore * 0.28 + pullback.score * 0.18 + (contract?.contractQualityScore ?? 35) * 0.18;
  score += dte >= 365 ? 18 : dte >= 270 ? 12 : dte >= 180 ? 5 : -8;
  score += unrealizedPct >= 0 ? 10 : unrealizedPct > -25 ? 4 : -8;
  if (thesisStatus === "Broken") score -= 25;
  if (thesisStatus === "Weakening") score -= 10;
  if (technicalStatus === "Broken") score -= 15;
  return clamp(Math.round(score));
}

function positionAction({ healthScore, dte, thesisStatus, technicalStatus, optionStatus, unrealizedPct, dcaAllowed }) {
  if (thesisStatus === "Broken" || healthScore < 35) return "Exit Review";
  if (dte < 180) return "Roll Candidate";
  if (dte < 270 && thesisStatus === "Intact") return "Roll Candidate";
  if (optionStatus === "Liquidity Risk" || technicalStatus === "Broken") return "No More Adds";
  if (unrealizedPct < -10 && dcaAllowed) return "DCA Candidate";
  if (healthScore >= 72 && thesisStatus === "Intact") return "Healthy Hold";
  return "Pause / Watch";
}

function dcaDecisionForPosition({ thesisStatus, technicalStatus, optionStatus, dte, contract, pullback, unrealizedPct, eventRisk }) {
  const allowed = thesisStatus === "Intact" &&
    technicalStatus !== "Broken" &&
    optionStatus === "Healthy" &&
    dte >= 270 &&
    (contract?.delta ?? 0) >= 0.45 &&
    (contract?.spreadPctRaw ?? 1) <= 0.18 &&
    eventRisk.level !== "High Event Risk" &&
    pullback.classification !== "Falling Knife / Do Not DCA" &&
    pullback.classification !== "Broken Chart / Avoid";
  const decision =
    thesisStatus === "Broken"
      ? "Exit Review"
      : dte < 270
        ? "Roll Review"
        : allowed && unrealizedPct < -10
          ? "Add Small"
          : allowed
            ? "Wait"
            : "Do Not Add";
  const confidence = allowed ? Math.min(92, Math.round(55 + pullback.score * 0.25 + (contract?.contractQualityScore ?? 0) * 0.15)) : Math.max(15, Math.round(70 - (eventRisk.level === "High Event Risk" ? 25 : 0) - (technicalStatus === "Broken" ? 20 : 0)));
  const blockers = [];
  if (thesisStatus !== "Intact") blockers.push("thesis must improve");
  if (technicalStatus === "Broken") blockers.push("stock must reclaim long-term support");
  if (optionStatus !== "Healthy") blockers.push("option time/liquidity must improve");
  if (dte < 270) blockers.push("position needs roll review before adding");
  if (eventRisk.level === "High Event Risk") blockers.push("wait for event risk to clear");
  return {
    decision,
    confidenceScore: clamp(confidence),
    why: allowed
      ? "DCA is allowed only as a small tranche because the thesis, trend, time, and liquidity checks remain acceptable."
      : `DCA rejected because ${blockers.join("; ") || "the setup is not strong enough"}.`,
    whatMustImprove: blockers.length ? blockers.join("; ") : "Keep thesis intact and wait for price stabilization near support.",
  };
}

function exitDamageReview({ thesisStatus, technicalStatus, optionStatus, dte, contract, healthScore, bestCandidate }) {
  const problemType =
    thesisStatus === "Broken"
      ? "stock-related"
      : optionStatus !== "Healthy" || dte < 270
        ? "option/time-related"
        : technicalStatus === "Broken"
          ? "market/technical-related"
          : "position-management";
  const decision =
    thesisStatus === "Broken" || healthScore < 35
      ? "Exit Review"
      : dte < 270
        ? "Roll Review"
        : optionStatus !== "Healthy"
          ? "No More Adds"
          : "Keep";
  return {
    decision,
    mainReason: decision === "Keep"
      ? "Thesis and option structure are not damaged enough to force a review."
      : `${thesisStatus}, ${technicalStatus}, ${optionStatus}, ${timeToExpiryBucket(dte)}.`,
    riskIfHolding: contract?.theta
      ? `Theta is about ${round(contract.theta, 4)} per day and time risk rises as DTE falls.`
      : "Time decay and liquidity can worsen if the thesis does not recover.",
    whatWouldChangeDecision: "Improving fundamentals, reclaim of long-term support, tighter spread, longer-dated roll candidate, or a stronger replacement score.",
    problemType,
    replacementCandidate: bestCandidate?.symbol ?? null,
  };
}

async function analyzeLeapsPosition(record, bestCandidate = null) {
  const symbol = String(record.symbol ?? "").trim().toUpperCase();
  const expiration = String(record.expiration ?? "").slice(0, 10);
  const strike = Number(record.strike);
  const costBasis = Number(record.costBasis);
  const contracts = Number(record.contracts || 1);
  const [analysis, rows] = await Promise.all([
    analyzeStock(symbol),
    fetchHistory(symbol, "2y", "1d"),
  ]);
  const underlying = buildUnderlyingScore(analysis);
  const snapshot = technicalSnapshot(rows, analysis);
  const pullback = pullbackOpportunity(snapshot, analysis);
  const contract = await findCurrentPositionContract(symbol, expiration, strike, snapshot.currentPrice).catch(() => null);
  const dte = contract?.dte ?? daysUntil(expiration) ?? 0;
  const currentOptionPrice = contract?.mid ?? null;
  const unrealizedPct = Number.isFinite(currentOptionPrice) && Number.isFinite(costBasis) && costBasis > 0
    ? ((currentOptionPrice / costBasis) - 1) * 100
    : null;
  const thesisStatus = underlying.score >= 70 && (analysis.newsEngine?.score ?? 50) >= 45 ? "Intact" : underlying.score >= 55 ? "Weakening" : "Broken";
  const technicalStatus = snapshot.currentPrice > snapshot.ema50 ? "Healthy" : snapshot.currentPrice > snapshot.ema200 ? "Caution" : "Broken";
  const optionStatus =
    !contract
      ? "Liquidity Risk"
      : dte < 180
        ? "Damaged"
        : dte < 270
          ? "Time Risk"
          : contract.spreadPctRaw > 0.25 || contract.contractQualityScore < 45
            ? "Liquidity Risk"
            : "Healthy";
  const eventRisk = eventRiskFromAnalysis(analysis);
  const dcaDecision = dcaDecisionForPosition({ thesisStatus, technicalStatus, optionStatus, dte, contract, pullback, unrealizedPct, eventRisk });
  const healthScore = positionHealthScore({ underlyingScore: underlying.score, pullback, contract, dte, unrealizedPct, thesisStatus, technicalStatus });
  const actionLabel = positionAction({ healthScore, dte, thesisStatus, technicalStatus, optionStatus, unrealizedPct, dcaAllowed: dcaDecision.decision === "Add Small" });
  const dca = dcaPlan({ price: snapshot.currentPrice, snapshot, pullback, analysis, contract });
  const declineClassification = classifyDecline({ unrealizedPct, thesisStatus, technicalStatus, optionStatus, pullback, eventRisk });
  const exitReview = exitDamageReview({ thesisStatus, technicalStatus, optionStatus, dte, contract, healthScore, bestCandidate });
  return {
    ticker: symbol,
    companyName: analysis.name,
    sector: analysis.business?.sector,
    currentStockPrice: round(snapshot.currentPrice),
    optionContract: `${symbol} ${expiration} ${strike}C`,
    expirationDate: expiration,
    daysToExpiration: dte,
    timeToExpiryBucket: timeToExpiryBucket(dte),
    strikePrice: strike,
    currentOptionPrice,
    costBasis: round(costBasis),
    contracts,
    currentOptionValue: Number.isFinite(currentOptionPrice) ? round(currentOptionPrice * 100 * contracts, 0) : null,
    costBasisValue: Number.isFinite(costBasis) ? round(costBasis * 100 * contracts, 0) : null,
    unrealizedGainLossPct: round(unrealizedPct, 1),
    positionHealthScore: healthScore,
    thesisStatus,
    technicalStatus,
    optionStatus,
    actionLabel,
    plainEnglishExplanation: `${actionLabel}: thesis is ${thesisStatus.toLowerCase()}, chart is ${technicalStatus.toLowerCase()}, option status is ${optionStatus.toLowerCase()}, and DTE is ${dte}.`,
    delta: contract?.delta ?? null,
    theta: contract?.theta ?? null,
    vega: contract?.vega ?? null,
    impliedVolatility: contract?.impliedVolatility ?? null,
    ivRankOrPercentile: "Unavailable from Yahoo option chain",
    bidAskSpreadPct: contract?.spreadPct ?? null,
    openInterest: contract?.openInterest ?? null,
    volume: contract?.volume ?? null,
    underlyingThesisStatus: thesisStatus,
    declineClassification,
    dcaDecision: dcaDecision.decision,
    dcaConfidenceScore: dcaDecision.confidenceScore,
    starterZone: dca.starterPositionZone,
    addZone1: dca.addZone1,
    addZone2: dca.addZone2,
    stopAddingLevel: dca.stopAddingInvalidationLevel,
    thesisInvalidationLevel: dca.stopAddingInvalidationLevel,
    whatMustImproveBeforeAdding: dcaDecision.whatMustImprove,
    whyDcaAllowedOrRejected: dcaDecision.why,
    dcaTrancheStructure: "25% starter, 25% add zone 1, 25% add zone 2, 25% reserved only after stabilization.",
    exitDamageReview: exitReview,
    eventRisk,
    pullback,
    optionContractDetails: contract ? enhanceContract(contract, "Current held contract matched from Yahoo option chain.") : null,
  };
}

export async function scanLeapsSymbol(symbol) {
  const [analysis, rows] = await Promise.all([
    analyzeStock(symbol),
    fetchHistory(symbol, "2y", "1d"),
  ]);
  const underlying = buildUnderlyingScore(analysis);
  const snapshot = technicalSnapshot(rows, analysis);
  const pullback = pullbackOpportunity(snapshot, analysis);
  if (underlying.score < 70) {
    return {
      symbol: analysis.symbol,
      name: analysis.name,
      sector: analysis.business?.sector,
      currentPrice: round(snapshot.currentPrice),
      decision: "Avoid - weak underlying",
      status: "Avoid",
      score: Math.min(49, Math.round(underlying.score * 0.55)),
      leapsOpportunityScore: Math.min(49, Math.round(underlying.score * 0.55)),
      underlyingScore: underlying.score,
      riskScore: riskScore({ analysis, pullback, underlyingScore: underlying.score }),
      pullbackClassification: pullback.classification,
      dcaSuitability: "DCA Rejected / Wait",
      reason: "Underlying stock quality is below 70, so the desk does not analyze LEAPS calls.",
      bullCase: analysis.report?.bullCase,
      bearCase: analysis.report?.bearCase,
      underlyingComponents: underlying.components,
      pullback,
    };
  }

  const candidates = await optionCandidates(symbol, snapshot.currentPrice);
  const bestContract = candidates[0] ?? null;
  const selectedContracts = selectedContractSet(candidates);
  const dca = dcaPlan({ price: snapshot.currentPrice, snapshot, pullback, analysis, contract: bestContract });
  const opportunity = opportunityScore({ underlyingScore: underlying.score, analysis, pullback, contract: bestContract, dca });
  const risk = riskScore({ analysis, contract: bestContract, pullback, underlyingScore: underlying.score });
  const eventRisk = eventRiskFromAnalysis(analysis);
  const label = opportunityLabel(opportunity);
  const status = eventRisk.level === "High Event Risk"
    ? "Wait for Earnings"
    : statusLabel({ underlyingScore: underlying.score, opportunity, risk, pullback, contract: bestContract });
  const preferredDelta = bestContract?.bucket === "Conservative" ? "0.75-0.90" : bestContract?.bucket === "Aggressive" ? "0.35-0.55" : "0.55-0.75";
  const preferredStrikeZone = bestContract
    ? `${bestContract.bucket}: near ${bestContract.strike} strike`
    : "No liquid strike passed filters";

  return {
    symbol: analysis.symbol,
    name: analysis.name,
    sector: analysis.business?.sector,
    currentPrice: round(snapshot.currentPrice),
    direction: "CALL",
    decision: label,
    status,
    score: opportunity,
    leapsOpportunityScore: opportunity,
    underlyingScore: underlying.score,
    riskScore: risk,
    riskLabel: riskLabel(risk),
    eventRisk: eventRisk.level,
    eventRiskHeadline: eventRisk.headline,
    earningsDate: eventRisk.earningsDate,
    preferredExpiryRange: "12-24 months preferred; 6 months minimum",
    preferredStrikeZone,
    preferredDelta,
    bestContractCandidate: bestContract ? `${bestContract.expiration} ${bestContract.strike}C near ${bestContract.mid} mid` : "No liquid LEAPS call passed filters",
    optionLiquidityStatus: bestContract
      ? bestContract.contractQualityScore >= 75 ? "Good" : bestContract.contractQualityScore >= 60 ? "Acceptable" : "Weak"
      : "Rejected",
    dcaSuitability: dca.suitability,
    pullbackClassification: pullback.classification,
    bullCase: analysis.report?.bullCase,
    bearCase: analysis.report?.bearCase,
    whyOpportunityExists: bestContract
      ? `${analysis.name} clears the underlying-quality gate and has a ${pullback.classification.toLowerCase()} setup with a usable long-dated call candidate.`
      : `${analysis.name} clears the underlying gate, but the option chain did not provide a clean liquid LEAPS call.`,
    longTermThesis: analysis.report?.shortAnalysis ?? analysis.managerRead,
    catalysts: analysis.report?.catalysts ?? "Use upcoming earnings/product/news checks before sizing.",
    technicalSetup: `${pullback.classification}. Price is ${pullback.distanceFrom52WeekHighPct}% from 52-week high, ${pullback.distanceFrom50DayPct}% from 50-day, ${pullback.distanceFrom200DayPct}% from 200-day, RSI ${pullback.rsi14}.`,
    dcaPlan: dca,
    invalidationLevel: dca.stopAddingInvalidationLevel,
    finalResearchVerdict: status === "Ready for Starter"
      ? "Research verdict: high-quality watchlist candidate for a starter only if live quotes confirm liquidity and thesis remains intact."
      : status === "Watch for Pullback"
        ? "Research verdict: watchlist candidate; wait for a better entry, cleaner pullback, or tighter spread."
        : "Research verdict: avoid for now; the underlying, option contract, or risk profile is not clean enough.",
    underlyingComponents: underlying.components,
    pullback,
    optionContracts: candidates.slice(0, 8),
    best3Contracts: {
      conservative: enhanceContract(selectedContracts.conservative, "Conservative stock-replacement style: 18-24 months preferred, ITM/deep ITM, 0.75-0.90 delta."),
      balanced: enhanceContract(selectedContracts.balanced, "Balanced LEAPS profile: 12-24 months, ITM/ATM, 0.55-0.75 delta."),
      aggressive: enhanceContract(selectedContracts.aggressive, "Aggressive/speculative profile: 12-24 months, slightly OTM, 0.35-0.55 delta."),
    },
    contractQualityReasons: bestContract?.contractQualityReasons ?? [],
    contractQualityRisks: bestContract?.contractQualityRisks ?? ["No acceptable LEAPS call contract found."],
    ...flatContract(bestContract),
  };
}

function buildPortfolioSummary(positions) {
  const averageHealth = positions.length
    ? Math.round(positions.reduce((sum, row) => sum + (row.positionHealthScore ?? 0), 0) / positions.length)
    : 100;
  return {
    portfolioHealthScore: averageHealth,
    healthyHolds: positions.filter((row) => row.actionLabel === "Healthy Hold").length,
    dcaCandidates: positions.filter((row) => row.actionLabel === "DCA Candidate").length,
    pauseWatch: positions.filter((row) => row.actionLabel === "Pause / Watch").length,
    noMoreAdds: positions.filter((row) => row.actionLabel === "No More Adds").length,
    rollCandidates: positions.filter((row) => row.actionLabel === "Roll Candidate").length,
    exitReviewPositions: positions.filter((row) => row.actionLabel === "Exit Review").length,
  };
}

function buildReplacementReview(positions, candidates) {
  return positions.map((position) => {
    const best = candidates.find((candidate) => candidate.symbol !== position.ticker) ?? candidates[0] ?? null;
    const justified = best && (best.leapsOpportunityScore ?? 0) >= (position.positionHealthScore ?? 0) + 18 && position.actionLabel !== "Healthy Hold";
    return {
      existingPositionRank: position.positionHealthScore,
      newCandidateRank: best?.leapsOpportunityScore ?? null,
      ticker: position.ticker,
      replacementTicker: best?.symbol ?? null,
      replacementJustified: justified,
      decision: justified ? "Replace Candidate Review" : "Keep / Monitor",
      reason: justified
        ? `${best.symbol} has a stronger current score and the existing position is ${position.actionLabel.toLowerCase()}.`
        : "Replacement is not clearly justified from current scores.",
      whatKeepsCurrentPosition: "Thesis remains intact, stock reclaims support, option still has time, and spread/liquidity remain acceptable.",
      newCandidateComparison: best
        ? `${best.symbol}: LEAPS ${best.leapsOpportunityScore}, risk ${best.riskScore}, status ${best.status}.`
        : "No stronger new candidate available.",
    };
  });
}

function buildRiskSummary(positions, candidates) {
  const all = [...positions, ...candidates];
  const highest = (rows, getter) => rows
    .filter((row) => Number.isFinite(getter(row)))
    .sort((a, b) => getter(b) - getter(a))[0] ?? null;
  const timeRisk = positions.slice().sort((a, b) => Number(a.daysToExpiration ?? 9999) - Number(b.daysToExpiration ?? 9999))[0] ?? null;
  const ivRisk = highest(all, (row) => Number(row.impliedVolatility ?? 0));
  const technicalRisk = positions.find((row) => row.technicalStatus === "Broken") ?? candidates.find((row) => /Broken|Falling/.test(row.pullbackClassification ?? ""));
  const earningsRisk = all.find((row) => row.eventRisk === "High Event Risk" || row.eventRisk?.level === "High Event Risk") ?? null;
  const concentration = positions.length
    ? Object.entries(positions.reduce((acc, row) => {
      acc[row.sector ?? "Unknown"] = (acc[row.sector ?? "Unknown"] ?? 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1])[0]
    : null;
  return {
    biggestTimeDecayRisk: timeRisk ? `${timeRisk.ticker} with ${timeRisk.daysToExpiration} DTE.` : "No existing LEAPS positions loaded.",
    biggestIvRisk: ivRisk ? `${ivRisk.symbol ?? ivRisk.ticker} IV ${ivRisk.impliedVolatility ?? "n/a"}%.` : "No IV risk available.",
    biggestEarningsRisk: earningsRisk ? `${earningsRisk.symbol ?? earningsRisk.ticker}: ${earningsRisk.eventRiskHeadline ?? earningsRisk.eventRisk?.headline ?? "event risk flagged"}` : "No high event risk flagged.",
    biggestTechnicalBreakdownRisk: technicalRisk ? `${technicalRisk.symbol ?? technicalRisk.ticker}: ${technicalRisk.pullbackClassification ?? technicalRisk.technicalStatus}.` : "No broken technical profile flagged.",
    biggestConcentrationRisk: concentration ? `${concentration[0]} has ${concentration[1]} position(s).` : "No concentration risk until positions are loaded.",
  };
}

function finalActionSummary({ positions, candidates, riskSummary }) {
  return {
    existingPositionsSummary: {
      healthyHolds: positions.filter((row) => row.actionLabel === "Healthy Hold").map((row) => row.ticker),
      dcaCandidates: positions.filter((row) => row.actionLabel === "DCA Candidate").map((row) => row.ticker),
      pauseWatch: positions.filter((row) => row.actionLabel === "Pause / Watch").map((row) => row.ticker),
      noMoreAdds: positions.filter((row) => row.actionLabel === "No More Adds").map((row) => row.ticker),
      rollCandidates: positions.filter((row) => row.actionLabel === "Roll Candidate").map((row) => row.ticker),
      exitReview: positions.filter((row) => row.actionLabel === "Exit Review").map((row) => row.ticker),
    },
    newOpportunitiesSummary: {
      top10: candidates.slice(0, 10).map((row) => row.symbol),
      top3Strongest: candidates.slice(0, 3).map((row) => row.symbol),
      waitForPullback: candidates.filter((row) => row.status === "Watch for Pullback").map((row) => row.symbol),
      avoid: candidates.filter((row) => row.status === "Avoid").map((row) => row.symbol),
    },
    riskSummary,
    actionWatchlist: {
      reviewToday: positions.filter((row) => ["Exit Review", "No More Adds", "Roll Candidate"].includes(row.actionLabel)).map((row) => row.ticker),
      watchForPullback: candidates.filter((row) => row.status === "Watch for Pullback").map((row) => row.symbol),
      waitForEarnings: candidates.filter((row) => row.status === "Wait for Earnings").map((row) => row.symbol),
      considerRolling: positions.filter((row) => row.actionLabel === "Roll Candidate").map((row) => row.ticker),
      doNotAdd: positions.filter((row) => ["No More Adds", "Exit Review"].includes(row.actionLabel)).map((row) => row.ticker),
      exitReview: positions.filter((row) => row.actionLabel === "Exit Review").map((row) => row.ticker),
    },
    finalPlainEnglishSummary: positions.length
      ? "The desk separates red positions from damaged positions. DCA is allowed only where thesis, trend, time, liquidity, and event risk remain acceptable."
      : "No existing LEAPS positions are loaded, so the daily monitor is waiting on your positions CSV. The weekly scanner still ranks new research candidates.",
  };
}

function scheduleInfo() {
  return {
    timeZone: "America/Edmonton",
    refreshSchedule: [
      "Every trading day at 7:00 AM Alberta time: Morning LEAPS Risk Check",
      "Every trading day after market close: Existing position health check",
      "Every Friday after market close: Weekly LEAPS deep review",
      "Immediately after earnings or major company news: Thesis reset",
      "Monthly: Portfolio concentration and replacement review",
    ],
  };
}

export async function scanLeapsDesk(symbols, positions = []) {
  const rows = [];
  for (const symbol of symbols) {
    try {
      rows.push(await scanLeapsSymbol(symbol));
    } catch (error) {
      rows.push({
        symbol,
        direction: "CALL",
        decision: "ERROR",
        status: "Avoid",
        score: 0,
        leapsOpportunityScore: 0,
        riskScore: 100,
        reason: error.message,
      });
    }
  }
  rows.sort((a, b) =>
    Number(b.leapsOpportunityScore ?? b.score ?? 0) - Number(a.leapsOpportunityScore ?? a.score ?? 0) ||
    Number(a.riskScore ?? 100) - Number(b.riskScore ?? 100) ||
    a.symbol.localeCompare(b.symbol)
  );
  const candidates = rows.filter((row) => row.underlyingScore >= 70 && row.leapsOpportunityScore >= 65 && row.status !== "Avoid");
  const positionRows = [];
  for (const position of positions) {
    if (!position.symbol) continue;
    try {
      positionRows.push(await analyzeLeapsPosition(position, candidates[0]));
    } catch (error) {
      positionRows.push({
        ticker: position.symbol,
        optionContract: `${position.symbol} ${position.expiration ?? ""} ${position.strike ?? ""}C`,
        actionLabel: "Pause / Watch",
        positionHealthScore: 0,
        thesisStatus: "Unknown",
        technicalStatus: "Unknown",
        optionStatus: "Data unavailable",
        plainEnglishExplanation: error.message,
      });
    }
  }
  const portfolioSummary = buildPortfolioSummary(positionRows);
  const replacementReview = buildReplacementReview(positionRows, candidates);
  const riskSummary = buildRiskSummary(positionRows, candidates);
  return {
    title: "LEAPS Call Opportunity Desk",
    asOf: new Date().toISOString(),
    disclaimer: "Research watchlist only. Not financial advice and not a buy/sell recommendation.",
    schedule: scheduleInfo(),
    summary: {
      scanned: rows.length,
      cleanCandidates: candidates.length,
      existingPositions: positionRows.length,
      portfolioHealthScore: portfolioSummary.portfolioHealthScore,
      healthyHolds: portfolioSummary.healthyHolds,
      dcaCandidates: portfolioSummary.dcaCandidates,
      noMoreAdds: portfolioSummary.noMoreAdds,
      rollCandidates: portfolioSummary.rollCandidates,
      exitReviewPositions: portfolioSummary.exitReviewPositions,
      topStatus: candidates.length ? "Candidates found" : "No high-quality LEAPS candidates today.",
      rule: "Calls only. Underlying score must clear 70 before any long-dated option contract can qualify.",
    },
    portfolio: {
      positions: positionRows,
      summary: portfolioSummary,
      dcaCandidates: positionRows.filter((row) => row.actionLabel === "DCA Candidate"),
      noMoreAdds: positionRows.filter((row) => row.actionLabel === "No More Adds"),
      exitReduceReview: positionRows.filter((row) => row.actionLabel === "Exit Review"),
      rollCandidates: positionRows.filter((row) => row.actionLabel === "Roll Candidate"),
      replacementReview,
    },
    riskSummary,
    finalActionSummary: finalActionSummary({ positions: positionRows, candidates, riskSummary }),
    top10: candidates.slice(0, 10),
    top5: candidates.slice(0, 5),
    rows,
  };
}
