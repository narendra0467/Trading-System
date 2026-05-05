import { analyzeStock } from "./stockAnalyzer.js";
import { fetchOptionChain, fetchOptionExpirations } from "./marketData.js";

const DAY_SECONDS = 24 * 60 * 60;

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

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

function chooseLeapsExpiration(expirations) {
  const candidates = expirations
    .map((expiration) => ({ expiration, dte: daysToExpiration(expiration) }))
    .filter(({ dte }) => dte >= 90 && dte <= 730)
    .sort((a, b) => Math.abs(a.dte - 540) - Math.abs(b.dte - 540));
  return candidates[0] ?? null;
}

function estimateDelta(type, strike, underlying) {
  const moneyness = underlying / strike - 1;
  const base = type === "call" ? 0.5 + moneyness * 3.5 : -0.5 + moneyness * 3.5;
  return Math.max(type === "call" ? 0.15 : -0.9, Math.min(type === "call" ? 0.9 : -0.15, base));
}

function normalize(contract, type, underlying) {
  const mid = midPrice(contract);
  return {
    ...contract,
    type,
    mid,
    spreadPct: spreadPct(contract),
    deltaEstimate: estimateDelta(type, contract.strike, underlying),
    breakeven: type === "call" ? contract.strike + mid : contract.strike - mid,
  };
}

function chooseLeapsContract(contracts, type, underlying, { minCost = 500, maxCost = 1000 } = {}) {
  const minDelta = type === "call" ? 0.2 : 0.2;
  const maxDelta = type === "call" ? 0.55 : 0.55;
  return contracts
    .map((contract) => normalize(contract, type, underlying))
    .filter((contract) => Number.isFinite(contract.mid) && contract.mid * 100 >= minCost && contract.mid * 100 <= maxCost)
    .filter((contract) => contract.spreadPct <= 0.25)
    .filter((contract) => (contract.openInterest ?? 0) >= 25 || (contract.volume ?? 0) >= 5)
    .filter((contract) => {
      const delta = Math.abs(contract.deltaEstimate);
      return delta >= minDelta && delta <= maxDelta;
    })
    .sort((a, b) => {
      const aCostScore = Math.abs(a.mid * 100 - 750);
      const bCostScore = Math.abs(b.mid * 100 - 750);
      const aLiquidity = (a.openInterest ?? 0) + (a.volume ?? 0) * 3;
      const bLiquidity = (b.openInterest ?? 0) + (b.volume ?? 0) * 3;
      return aCostScore - bCostScore || bLiquidity - aLiquidity || Math.abs(a.deltaEstimate - 0.35) - Math.abs(b.deltaEstimate - 0.35);
    })[0] ?? null;
}

function chooseBudgetLeapsContract(contracts, type, underlying) {
  return chooseLeapsContract(contracts, type, underlying, { minCost: 350, maxCost: 1500 });
}

function buildLeapsDecision(analysis, contract, direction, expirationMeta) {
  const isCall = direction === "CALL";
  const premium = contract.mid;
  const cost = premium * 100;
  const breakevenMove = isCall
    ? contract.breakeven / analysis.currentPrice - 1
    : 1 - contract.breakeven / analysis.currentPrice;
  const spread = contract.spreadPct;
  let score = 0;
  const reasons = [];
  const risks = [];

  if (analysis.totalScore >= 80) { score += 25; reasons.push("stock analyzer grade is A-quality"); }
  else if (analysis.totalScore >= 65) { score += 17; reasons.push("stock analyzer supports a starter idea"); }
  else if (analysis.totalScore < 50) { score -= 12; risks.push("stock analyzer score is weak"); }

  if (isCall && analysis.technical.score >= 65) { score += 18; reasons.push("technical trend supports bullish LEAPS"); }
  if (!isCall && analysis.technical.score <= 45) { score += 18; reasons.push("technical trend supports bearish LEAPS"); }
  if (analysis.fundamentals.score >= 65 && isCall) { score += 18; reasons.push("fundamentals support owning long-term upside"); }
  if (analysis.analysts.score >= 60) { score += 10; reasons.push("analyst sentiment is supportive"); }
  if (analysis.valuation.score >= 55) { score += 10; reasons.push("valuation is not fighting the trade"); }
  else if (analysis.valuation.score < 40) { score -= 8; risks.push("valuation is stretched"); }

  if (expirationMeta.dte >= 365) { score += 10; reasons.push("enough time for thesis to work"); }
  if (Math.abs(contract.deltaEstimate) >= 0.3) { score += 8; reasons.push("delta is acceptable for a starter LEAPS trade"); }
  if (spread <= 0.1) { score += 8; reasons.push("option spread is reasonably tight"); }
  else if (spread > 0.15) { score -= 10; risks.push("option spread is wide"); }
  if ((contract.openInterest ?? 0) >= 250) { score += 6; reasons.push("open interest is healthy"); }
  if (cost >= 500 && cost <= 1000) {
    score += 18;
    reasons.push("premium fits the $500-$1000 starter range");
  } else if (cost >= 350 && cost <= 1500) {
    score += 6;
    reasons.push("premium is near the starter range but not perfect");
    risks.push("premium is outside the preferred $500-$1000 range");
  } else {
    score -= 30;
    risks.push("premium is outside the $500-$1000 starter range");
  }
  if (breakevenMove > 0.45) {
    score -= 24;
    risks.push("breakeven requires an extreme move");
  } else if (breakevenMove > 0.3) {
    score -= 16;
    risks.push("breakeven requires a large move");
  } else if (breakevenMove > 0.22) {
    score -= 6;
    risks.push("breakeven is not cheap");
  } else {
    score += 8;
    reasons.push("breakeven move is reasonable for LEAPS");
  }

  const totalScore = Math.max(0, Math.min(100, Math.round(score)));
  const decision =
    totalScore >= 75 && cost >= 500 && cost <= 1000 && breakevenMove <= 0.45
      ? "LEAPS BUY CANDIDATE"
      : totalScore >= 60 && cost >= 350 && cost <= 1500
        ? "STARTER / WATCH"
        : totalScore >= 45
          ? "WATCH ONLY"
          : "NO LEAPS TRADE";
  const stopStock = isCall ? analysis.technical.stop : analysis.technical.target;
  const targetStock = isCall ? analysis.technical.target : analysis.technical.stop;
  const optionStop = premium * 0.65;
  const optionTarget1 = premium * 1.45;
  const optionTarget2 = premium * 2;

  return {
    symbol: analysis.symbol,
    name: analysis.name,
    direction,
    decision,
    score: totalScore,
    qualityGrade: totalScore >= 80 ? "A" : totalScore >= 65 ? "B" : totalScore >= 50 ? "C" : "D",
    analyzerDecision: analysis.decision,
    stockScore: analysis.totalScore,
    technicalScore: analysis.technical.score,
    fundamentalScore: analysis.fundamentals.score,
    valuationScore: analysis.valuation.score,
    analystScore: analysis.analysts.score,
    currentPrice: round(analysis.currentPrice),
    expiration: new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10),
    dte: expirationMeta.dte,
    contractSymbol: contract.contractSymbol,
    strike: contract.strike,
    bid: round(contract.bid),
    ask: round(contract.ask),
    mid: round(premium),
    cost: round(cost, 0),
    breakeven: round(contract.breakeven),
    breakevenMovePct: round(breakevenMove * 100, 1),
    spreadPct: round(spread * 100, 1),
    openInterest: contract.openInterest ?? 0,
    volume: contract.volume ?? 0,
    deltaEstimate: round(contract.deltaEstimate, 2),
    stopStock: round(stopStock),
    targetStock: round(targetStock),
    optionStop: round(optionStop),
    optionTarget1: round(optionTarget1),
    optionTarget2: round(optionTarget2),
    positionRead: `Starter LEAPS sizing: one contract costs about $${round(cost, 0)}. Risk is premium paid, but the plan should cut earlier if the thesis breaks.`,
    tradePlan: `${decision}: ${direction} ${contract.strike} exp ${new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10)} near ${round(premium)} mid. Stock thesis target ${round(targetStock)}, danger level ${round(stopStock)}.`,
    fundManagerRead: `${analysis.managerRead} LEAPS score ${totalScore}/100 because ${reasons.slice(0, 3).join("; ") || "the setup is mixed"}.`,
    reasons: reasons.join("; "),
    risks: risks.join("; ") || "No major LEAPS-specific risk flag from available fields.",
  };
}

export async function scanLeapsSymbol(symbol) {
  const analysis = await analyzeStock(symbol);
  const expirations = await fetchOptionExpirations(symbol);
  const expirationMeta = chooseLeapsExpiration(expirations);
  if (!expirationMeta) {
    return { symbol, decision: "NO LEAPS TRADE", score: 0, reason: "No 90-730 day expiration found" };
  }
  const chain = await fetchOptionChain(symbol, expirationMeta.expiration);
  if (!chain) {
    return { symbol, decision: "NO LEAPS TRADE", score: 0, reason: "No option chain found" };
  }
  const underlying = chain.underlyingPrice ?? analysis.currentPrice;
  const direction = analysis.decision === "SELL / EXIT RISK" || analysis.decision === "AVOID NEW BUY" ? "PUT" : "CALL";
  const contracts = direction === "CALL" ? chain.calls : chain.puts;
  const preferredContract = chooseLeapsContract(contracts, direction.toLowerCase(), underlying);
  const contract = preferredContract ?? chooseBudgetLeapsContract(contracts, direction.toLowerCase(), underlying);
  if (!contract) {
    return {
      symbol,
      name: analysis.name,
      direction,
      decision: "NO LEAPS TRADE",
      score: Math.round(analysis.totalScore * 0.4),
      stockScore: analysis.totalScore,
      currentPrice: round(analysis.currentPrice),
      reason: "No liquid $500-$1000 LEAPS contract passed cost/delta/spread/open-interest filters",
    };
  }
  return buildLeapsDecision(analysis, contract, direction, expirationMeta);
}
