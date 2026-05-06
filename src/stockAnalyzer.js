import { addIndicators, last } from "./indicators.js";
import { fetchHistory, fetchQuoteSummary } from "./marketData.js";

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const raw = (field) => field?.raw ?? null;
const fmt = (field) => field?.fmt ?? null;
const pctRaw = (field) => {
  const value = raw(field);
  return Number.isFinite(value) ? value * 100 : null;
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function metricStatus(value, min, max = Infinity) {
  if (!Number.isFinite(value)) return "unavailable";
  if (value >= min && value <= max) return "pass";
  const nearLow = value < min && value >= min * 0.85;
  const nearHigh = Number.isFinite(max) && value > max && value <= max * 1.15;
  return nearLow || nearHigh ? "near" : "fail";
}

function belowMetricStatus(value, max) {
  if (!Number.isFinite(value)) return "unavailable";
  return value <= max ? "pass" : value <= max * 1.15 ? "near" : "fail";
}

function formatMetric(value, suffix = "%") {
  if (!Number.isFinite(value)) return "Unavailable";
  return `${round(value, 2)}${suffix}`;
}

function cagr(start, end, years) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || years <= 0) return null;
  return (end / start) ** (1 / years) - 1;
}

function metricRow(label, value, display, ideal, status, note) {
  return { label, value: round(value, 4), display, ideal, status, note };
}

function scoreTechnical(symbol, rows, benchmarkRows) {
  if (rows.length < 160) {
    return { score: 0, rating: "Weak", reasons: ["not enough price history"], risks: ["not enough price history"] };
  }
  const enriched = addIndicators(rows, benchmarkRows);
  const latest = last(enriched);
  const previous = enriched[enriched.length - 2];
  let score = 0;
  const reasons = [];
  const risks = [];

  if (latest.close > latest.ema20 && latest.ema20 > latest.ema50 && latest.ema50 > latest.ema150) {
    score += 25;
    reasons.push("price is in a clean stacked uptrend");
  } else if (latest.close > latest.ema50 && latest.ema50 > latest.ema150) {
    score += 15;
    reasons.push("primary trend is still positive");
  } else if (latest.close < latest.ema50) {
    score -= 10;
    risks.push("price is below the 50-day trend line");
  }

  if (latest.ema50Slope20 > 0.02) {
    score += 12;
    reasons.push("50-day average is rising");
  }
  if (latest.rsi14 >= 50 && latest.rsi14 <= 70) {
    score += 12;
    reasons.push("RSI shows healthy momentum");
  } else if (latest.rsi14 > 76) {
    score -= 4;
    risks.push("RSI is extended");
  } else if (latest.rsi14 < 42) {
    score -= 8;
    risks.push("RSI momentum is weak");
  }
  if (latest.macd.histogram > 0 && latest.macd.histogram > previous.macd.histogram) {
    score += 12;
    reasons.push("MACD is improving");
  }
  if (latest.adx14 > 20 && latest.plusDi14 > latest.minusDi14) {
    score += 10;
    reasons.push("ADX confirms bullish trend strength");
  }
  if (latest.close >= latest.high55) {
    score += 12;
    reasons.push("new 55-day high/breakout");
  } else if (latest.close > latest.high55 * 0.97) {
    score += 6;
    reasons.push("near a 55-day high");
  }
  if (latest.relativeStrength60 > 0) {
    score += 10;
    reasons.push(`outperforming ${symbol.endsWith(".TO") || symbol.endsWith(".V") ? "Canadian benchmark" : "QQQ"}`);
  } else if (latest.relativeStrength60 < -0.05) {
    score -= 8;
    risks.push("underperforming benchmark");
  }
  if (latest.volume > latest.volume20 * 1.25) {
    score += 7;
    reasons.push("volume is expanding");
  }

  const stopCandidates = [latest.close - 2 * latest.atr14];
  if (latest.ema50 < latest.close) stopCandidates.push(latest.ema50);
  const stop = Math.max(...stopCandidates);
  const target = latest.close + 3 * (latest.close - stop);
  return {
    score: clamp(Math.round(score + 35)),
    rating: score >= 45 ? "Strong" : score >= 25 ? "Constructive" : score >= 10 ? "Mixed" : "Weak",
    close: round(latest.close),
    ema20: round(latest.ema20),
    ema50: round(latest.ema50),
    ema150: round(latest.ema150),
    rsi14: round(latest.rsi14, 1),
    adx14: round(latest.adx14, 1),
    atr14: round(latest.atr14),
    high55: round(latest.high55),
    stop: round(stop),
    target: round(target),
    relativeStrength60: round((latest.relativeStrength60 ?? 0) * 100, 2),
    reasons,
    risks,
  };
}

function scoreFundamentals(summary) {
  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const detail = summary.summaryDetail ?? {};
  const profile = summary.assetProfile ?? {};
  let score = 0;
  const reasons = [];
  const risks = [];

  const revenueGrowth = raw(financial.revenueGrowth);
  const earningsGrowth = raw(financial.earningsGrowth);
  const grossMargins = raw(financial.grossMargins);
  const operatingMargins = raw(financial.operatingMargins);
  const profitMargins = raw(financial.profitMargins);
  const debtToEquity = raw(financial.debtToEquity);
  const currentRatio = raw(financial.currentRatio);
  const returnOnEquity = raw(financial.returnOnEquity);
  const freeCashflow = raw(financial.freeCashflow);
  const totalCash = raw(financial.totalCash);
  const totalDebt = raw(financial.totalDebt);

  if (revenueGrowth > 0.12) { score += 15; reasons.push("revenue growth is strong"); }
  else if (revenueGrowth > 0.03) { score += 8; reasons.push("revenue is growing"); }
  else if (Number.isFinite(revenueGrowth)) { risks.push("revenue growth is slow or negative"); }

  if (earningsGrowth > 0.12) { score += 13; reasons.push("earnings growth is strong"); }
  else if (earningsGrowth > 0) { score += 7; reasons.push("earnings are growing"); }

  if (grossMargins > 0.45) { score += 10; reasons.push("gross margins are high"); }
  if (operatingMargins > 0.15) { score += 12; reasons.push("operating margins are healthy"); }
  else if (Number.isFinite(operatingMargins) && operatingMargins < 0) { risks.push("operating margin is negative"); }
  if (profitMargins > 0.1) { score += 10; reasons.push("company is profitable"); }
  else if (Number.isFinite(profitMargins) && profitMargins < 0) { risks.push("profit margin is negative"); }
  if (returnOnEquity > 0.12) { score += 10; reasons.push("return on equity is attractive"); }
  if (Number.isFinite(freeCashflow) && freeCashflow > 0) { score += 10; reasons.push("free cash flow is positive"); }
  if (Number.isFinite(totalCash) && Number.isFinite(totalDebt) && totalCash > totalDebt) {
    score += 8;
    reasons.push("cash is greater than debt");
  }
  if (Number.isFinite(debtToEquity) && debtToEquity > 120) {
    score -= 8;
    risks.push("debt load is elevated");
  }
  if (Number.isFinite(currentRatio) && currentRatio < 1) {
    score -= 5;
    risks.push("current ratio is below 1");
  }

  return {
    score: clamp(Math.round(score)),
    rating: score >= 70 ? "High quality" : score >= 50 ? "Good" : score >= 30 ? "Mixed" : "Weak/Unproven",
    sector: profile.sector ?? "n/a",
    industry: profile.industry ?? "n/a",
    revenueGrowth: round(revenueGrowth * 100, 1),
    earningsGrowth: round(earningsGrowth * 100, 1),
    grossMargins: round(grossMargins * 100, 1),
    operatingMargins: round(operatingMargins * 100, 1),
    profitMargins: round(profitMargins * 100, 1),
    returnOnEquity: round(returnOnEquity * 100, 1),
    debtToEquity: round(debtToEquity, 1),
    currentRatio: round(currentRatio, 2),
    freeCashflow: round(freeCashflow, 0),
    totalCash: round(totalCash, 0),
    totalDebt: round(totalDebt, 0),
    reasons,
    risks,
  };
}

function scoreValuation(summary) {
  const stats = summary.defaultKeyStatistics ?? {};
  const detail = summary.summaryDetail ?? {};
  const financial = summary.financialData ?? {};
  let score = 45;
  const reasons = [];
  const risks = [];

  const forwardPE = raw(stats.forwardPE);
  const trailingPE = raw(summary.summaryDetail?.trailingPE) ?? raw(stats.trailingPE);
  const pegRatio = raw(stats.pegRatio);
  const priceToSales = raw(stats.priceToSalesTrailing12Months);
  const enterpriseToEbitda = raw(stats.enterpriseToEbitda);
  const dividendYield = raw(detail.dividendYield);
  const targetMeanPrice = raw(financial.targetMeanPrice);
  const currentPrice = raw(financial.currentPrice);

  if (Number.isFinite(forwardPE)) {
    if (forwardPE < 18) { score += 15; reasons.push("forward P/E is reasonable"); }
    else if (forwardPE > 45) { score -= 12; risks.push("forward P/E is expensive"); }
  }
  if (Number.isFinite(pegRatio)) {
    if (pegRatio > 0 && pegRatio < 1.5) { score += 12; reasons.push("PEG ratio supports growth valuation"); }
    else if (pegRatio > 2.5) { score -= 10; risks.push("PEG ratio is expensive"); }
  }
  if (Number.isFinite(priceToSales)) {
    if (priceToSales < 4) score += 8;
    else if (priceToSales > 12) { score -= 8; risks.push("price/sales is rich"); }
  }
  if (Number.isFinite(enterpriseToEbitda)) {
    if (enterpriseToEbitda < 18) score += 8;
    else if (enterpriseToEbitda > 35) score -= 8;
  }
  if (Number.isFinite(dividendYield) && dividendYield > 0.015) {
    score += 4;
    reasons.push("dividend yield adds support");
  }
  const analystUpside = Number.isFinite(targetMeanPrice) && Number.isFinite(currentPrice) && currentPrice > 0
    ? targetMeanPrice / currentPrice - 1
    : null;
  if (analystUpside > 0.15) { score += 8; reasons.push("analyst target implies upside"); }
  else if (analystUpside < -0.05) { score -= 8; risks.push("analyst target implies downside"); }

  return {
    score: clamp(Math.round(score)),
    rating: score >= 70 ? "Attractive" : score >= 55 ? "Fair" : score >= 40 ? "Expensive but possible" : "Stretched",
    forwardPE: round(forwardPE, 1),
    trailingPE: round(trailingPE, 1),
    pegRatio: round(pegRatio, 2),
    priceToSales: round(priceToSales, 2),
    enterpriseToEbitda: round(enterpriseToEbitda, 1),
    dividendYield: round(dividendYield * 100, 2),
    analystUpside: round(analystUpside * 100, 1),
    targetMeanPrice: round(targetMeanPrice),
    reasons,
    risks,
  };
}

function scoreAnalysts(summary) {
  const financial = summary.financialData ?? {};
  const trend = summary.recommendationTrend?.trend?.[0] ?? {};
  const recommendationMean = raw(financial.recommendationMean);
  const recommendationKey = financial.recommendationKey ?? "n/a";
  const numberOfAnalystOpinions = raw(financial.numberOfAnalystOpinions);
  const buyCount = Number(trend.strongBuy ?? 0) + Number(trend.buy ?? 0);
  const holdCount = Number(trend.hold ?? 0);
  const sellCount = Number(trend.sell ?? 0) + Number(trend.strongSell ?? 0);
  const total = buyCount + holdCount + sellCount;
  let score = 45;
  const reasons = [];
  const risks = [];

  if (Number.isFinite(recommendationMean)) {
    score += (5 - recommendationMean) * 12;
    reasons.push(`analyst consensus is ${recommendationKey}`);
  }
  if (total > 0) {
    const buyRatio = buyCount / total;
    const sellRatio = sellCount / total;
    if (buyRatio > 0.6) { score += 12; reasons.push("majority of recent analyst ratings are buy/strong buy"); }
    if (sellRatio > 0.2) { score -= 10; risks.push("meaningful sell-side caution exists"); }
  }
  if (Number.isFinite(numberOfAnalystOpinions) && numberOfAnalystOpinions < 5) {
    risks.push("limited analyst coverage");
  }

  return {
    score: clamp(Math.round(score)),
    rating: score >= 70 ? "Bullish" : score >= 55 ? "Constructive" : score >= 40 ? "Neutral" : "Bearish",
    recommendationMean: round(recommendationMean, 2),
    recommendationKey,
    numberOfAnalystOpinions,
    buyCount,
    holdCount,
    sellCount,
    reasons,
    risks,
  };
}

function finalDecision(totalScore, technical, fundamentals) {
  if (totalScore >= 78 && technical.score >= 65 && fundamentals.score >= 50) return "BUY";
  if (totalScore >= 65) return "WATCH / STARTER BUY";
  if (totalScore >= 48) return "HOLD / WAIT";
  if (totalScore >= 35) return "AVOID NEW BUY";
  return "SELL / EXIT RISK";
}

function businessTheme(sector, industry, name = "") {
  const text = `${sector ?? ""} ${industry ?? ""} ${name ?? ""}`.toLowerCase();
  if (text.includes("semiconductor")) return "AI / semiconductor infrastructure";
  if (text.includes("software") || text.includes("internet") || text.includes("information technology")) return "software / internet platform";
  if (text.includes("bank") || text.includes("financial") || text.includes("capital markets")) return "financial services";
  if (text.includes("biotech") || text.includes("pharmaceutical") || text.includes("health")) return "healthcare / biotech";
  if (text.includes("auto") || text.includes("vehicle")) return "autos / transportation";
  if (text.includes("consumer")) return "consumer brand";
  if (text.includes("energy") || text.includes("oil") || text.includes("gas")) return "energy";
  if (text.includes("real estate")) return "real estate";
  if (text.includes("etf") || text.includes("fund") || text.includes("trust")) return "diversified fund / ETF";
  return sector || "general business";
}

function beginnerRead(decision, technical, fundamentals, valuation, theme) {
  if (theme === "diversified fund / ETF") {
    return "Beginner read: this is a basket, not one company. Judge it by index exposure, cost, diversification, and overlap with what you already own.";
  }
  if (decision === "BUY") {
    return "Beginner read: this is investable quality with a supportive chart. I would still buy in stages, not all at once.";
  }
  if (decision === "WATCH / STARTER BUY") {
    return "Beginner read: interesting, but not perfect. A small starter position or watchlist spot makes more sense than a full-size buy.";
  }
  if (decision === "HOLD / WAIT") {
    return "Beginner read: okay to study or hold if you already own it, but I would wait for either better price action or a better valuation before adding.";
  }
  if (decision === "AVOID NEW BUY") {
    return "Beginner read: do not rush. Something important is not lined up yet, usually chart, business quality, or valuation.";
  }
  return "Beginner read: avoid or reduce risk until the business and chart improve.";
}

function ownershipStyle(totalScore, fundamentals, valuation, theme) {
  if (theme === "diversified fund / ETF") return "Diversified fund / ETF building block";
  if (fundamentals.score >= 70 && totalScore >= 75) return "Core compounder candidate";
  if (fundamentals.score >= 55 && valuation.score >= 55) return "Quality watchlist candidate";
  if (fundamentals.score < 35) return "Speculative / trading-only candidate";
  return "Tactical position, not automatic long-term core";
}

function buildInvestorChecklist(decision, technical, fundamentals, valuation, analysts) {
  const checklist = [];
  checklist.push(`Action: ${decision}. Use the score as a filter, then read the business and risk notes.`);
  if (technical.stop && technical.target) checklist.push(`Risk plan: chart danger level near ${technical.stop}; first upside target near ${technical.target}.`);
  if (fundamentals.rating) checklist.push(`Business quality: ${fundamentals.rating}. Look for revenue growth, margins, cash flow, and debt risk.`);
  if (valuation.rating) checklist.push(`Valuation: ${valuation.rating}. Great companies can still be bad buys if the price is stretched.`);
  if (analysts.recommendationKey && analysts.recommendationKey !== "n/a") checklist.push(`Analyst tone: ${analysts.recommendationKey}; use this as background, not as a blind buy signal.`);
  return checklist;
}

function buildGrowthChecklist(summary) {
  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const detail = summary.summaryDetail ?? {};
  const price = summary.price ?? {};
  const marketCap = raw(price.marketCap) ?? raw(detail.marketCap);
  const totalRevenue = raw(financial.totalRevenue);
  const annual = (summary.incomeStatementHistory?.incomeStatementHistory ?? [])
    .map((item) => ({ date: item.endDate?.fmt, revenue: raw(item.totalRevenue), netIncome: raw(item.netIncome) }))
    .filter((item) => Number.isFinite(item.revenue))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latestAnnual = annual.at(-1);
  const oldestAnnual = annual[0];
  const revenueCagr = latestAnnual && oldestAnnual ? cagr(oldestAnnual.revenue, latestAnnual.revenue, annual.length - 1) : null;
  const revenueCagrPct = Number.isFinite(revenueCagr) ? revenueCagr * 100 : null;
  const trendYear = summary.earningsTrend?.trend?.find((item) => item.period === "0y");
  const revenueGrowthEstimate = raw(trendYear?.revenueEstimate?.growth);
  const epsGrowthEstimate = raw(trendYear?.earningsEstimate?.growth) ?? raw(financial.earningsGrowth);
  const ebitda = raw(financial.ebitda);
  const freeCashflow = raw(financial.freeCashflow);
  const enterpriseValue = raw(stats.enterpriseValue);
  const grossMargin = pctRaw(financial.grossMargins);
  const operatingMargin = pctRaw(financial.operatingMargins);
  const profitMarginRaw = raw(stats.profitMargins) ?? raw(financial.profitMargins);
  const netMargin = Number.isFinite(profitMarginRaw) ? profitMarginRaw * 100 : null;
  const revenueGrowthRaw = raw(financial.revenueGrowth) ?? revenueGrowthEstimate;
  const revenueGrowth1y = Number.isFinite(revenueGrowthRaw) ? revenueGrowthRaw * 100 : null;
  const epsGrowth = Number.isFinite(epsGrowthEstimate) ? epsGrowthEstimate * 100 : null;
  const ebitdaMargin = totalRevenue && ebitda ? (ebitda / totalRevenue) * 100 : null;
  const fcfMargin = totalRevenue && freeCashflow ? (freeCashflow / totalRevenue) * 100 : null;
  const trailingPE = raw(detail.trailingPE) ?? raw(stats.trailingPE);
  const forwardPE = raw(stats.forwardPE);
  const peg = raw(stats.pegRatio);
  const pb = raw(stats.priceToBook);
  const ps = raw(stats.priceToSalesTrailing12Months) ?? (marketCap && totalRevenue ? marketCap / totalRevenue : null);
  const evToEbitda = raw(stats.enterpriseToEbitda) ?? (enterpriseValue && ebitda ? enterpriseValue / ebitda : null);
  const pToFcf = marketCap && freeCashflow ? marketCap / freeCashflow : null;
  const roe = pctRaw(financial.returnOnEquity);
  const roa = pctRaw(financial.returnOnAssets);

  const rows = [
    metricRow("Gross Profit Margin", grossMargin, formatMetric(grossMargin), "20% - 50%", metricStatus(grossMargin, 20, 50), "For banks/fintech/lenders this can be less comparable than for normal product companies."),
    metricRow("Operating Profit Margin", operatingMargin, formatMetric(operatingMargin), "10% - 30%", metricStatus(operatingMargin, 10, 30), "Shows whether growth is turning into operating leverage."),
    metricRow("Net Profit Margin", netMargin, formatMetric(netMargin), "5% - 20%", metricStatus(netMargin, 5, 20), "Profitability after all costs."),
    metricRow("1-Year Revenue Growth", revenueGrowth1y, formatMetric(revenueGrowth1y), "20%+", metricStatus(revenueGrowth1y, 20), "Growth-stock threshold."),
    metricRow("3-Year Revenue CAGR", revenueCagrPct, formatMetric(revenueCagrPct), "20%+", metricStatus(revenueCagrPct, 20), annual.length >= 2 ? `Uses annual revenue from ${oldestAnnual.date} to ${latestAnnual.date}.` : "Annual revenue history was not available."),
    metricRow("5-Year Revenue CAGR", null, "Unavailable", "20%+", "unavailable", "Yahoo quote summary often returns only four annual statement rows."),
    metricRow("EPS Growth", epsGrowth, formatMetric(epsGrowth), "20%+", metricStatus(epsGrowth, 20), "Uses current-year earnings growth estimate when available."),
    metricRow("EBITDA Margin", ebitdaMargin, formatMetric(ebitdaMargin), "20%+", metricStatus(ebitdaMargin, 20), "Unavailable when EBITDA is missing from the data source."),
    metricRow("FCF Margin", fcfMargin, formatMetric(fcfMargin), "10% - 15%+", metricStatus(fcfMargin, 10), "Unavailable when free cash flow is missing from the data source."),
    metricRow("P/E Ratio", trailingPE, formatMetric(trailingPE, "x"), "20x - 40x", metricStatus(trailingPE, 20, 40), "Trailing valuation range for profitable growth companies."),
    metricRow("Forward P/E", forwardPE, formatMetric(forwardPE, "x"), "20x - 30x", metricStatus(forwardPE, 20, 30), "Forward valuation based on estimates."),
    metricRow("PEG Ratio", peg, formatMetric(peg, "x"), "0.5x - 1.5x", metricStatus(peg, 0.5, 1.5), "Growth adjusted valuation."),
    metricRow("P/B Ratio", pb, formatMetric(pb, "x"), "0.5x - 1.5x", metricStatus(pb, 0.5, 1.5), "Important for banks/fintech balance-sheet businesses."),
    metricRow("P/S Ratio", ps, formatMetric(ps, "x"), "1.0x - 5.0x", metricStatus(ps, 1, 5), "Sales multiple; too high can mean expectations are stretched."),
    metricRow("Enterprise Value / EBITDA", evToEbitda, formatMetric(evToEbitda, "x"), "10x - 20x", metricStatus(evToEbitda, 10, 20), "Unavailable when EBITDA is missing."),
    metricRow("P/FCF", pToFcf, formatMetric(pToFcf, "x"), "Below 10x", belowMetricStatus(pToFcf, 10), "Unavailable when free cash flow is missing."),
    metricRow("Return on Equity", roe, formatMetric(roe), "12% - 20%+", metricStatus(roe, 12), "Quality and capital efficiency."),
    metricRow("Return on Assets", roa, formatMetric(roa), "5% - 10%+", metricStatus(roa, 5), "Asset efficiency; especially useful for lenders/financials."),
  ];
  const growthLabels = ["1-Year Revenue Growth", "3-Year Revenue CAGR", "EPS Growth"];
  const isGrowthStock = growthLabels.every((label) => rows.find((item) => item.label === label)?.status === "pass");
  return {
    rows,
    passCount: rows.filter((item) => item.status === "pass").length,
    nearCount: rows.filter((item) => item.status === "near").length,
    failCount: rows.filter((item) => item.status === "fail").length,
    unavailableCount: rows.filter((item) => item.status === "unavailable").length,
    isGrowthStock,
    verdict: isGrowthStock ? "Growth stock: yes" : "Growth stock: not confirmed",
    summary: isGrowthStock
      ? "Revenue and EPS growth clear the growth-stock thresholds. Now judge quality, valuation, returns, and chart risk before buying."
      : "Growth is not strong enough across the required revenue/EPS tests, or key growth fields are unavailable.",
  };
}

function growthRiskScore(growthChecklist, technical, fundamentals, valuation, analysts) {
  const rows = growthChecklist.rows ?? [];
  let risk = 30;
  risk += growthChecklist.failCount * 5;
  risk += growthChecklist.nearCount * 2;
  risk += growthChecklist.unavailableCount * 1.5;
  if (!growthChecklist.isGrowthStock) risk += 8;
  if ((technical?.score ?? 0) < 50) risk += 8;
  if ((fundamentals?.score ?? 0) < 50) risk += 8;
  if ((valuation?.score ?? 0) < 50) risk += 8;
  if ((analysts?.rating ?? "").toLowerCase().includes("neutral")) risk += 4;
  if (rows.some((row) => row.label === "Return on Equity" && row.status === "fail")) risk += 4;
  if (rows.some((row) => row.label === "Return on Assets" && row.status === "fail")) risk += 4;
  return clamp(Math.round(risk));
}

export async function analyzeStock(symbolInput) {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");
  const benchmark = symbol.endsWith(".TO") || symbol.endsWith(".V") || symbol.endsWith(".NE") || symbol.endsWith(".CN") ? "XIU.TO" : "QQQ";
  const [rows, benchmarkRows, summary] = await Promise.all([
    fetchHistory(symbol, "18mo"),
    fetchHistory(benchmark, "18mo"),
    fetchQuoteSummary(symbol, [
      "price",
      "summaryDetail",
      "financialData",
      "defaultKeyStatistics",
      "recommendationTrend",
      "earningsTrend",
      "assetProfile",
      "incomeStatementHistory",
    ]),
  ]);

  const technical = scoreTechnical(symbol, rows, benchmarkRows);
  const fundamentals = scoreFundamentals(summary);
  const valuation = scoreValuation(summary);
  const analysts = scoreAnalysts(summary);
  const price = summary.price ?? {};
  const profile = summary.assetProfile ?? {};
  const totalScore = Math.round(
    technical.score * 0.35 +
    fundamentals.score * 0.35 +
    valuation.score * 0.15 +
    analysts.score * 0.15
  );
  const decision = finalDecision(totalScore, technical, fundamentals);
  const strengths = [
    ...technical.reasons.slice(0, 3),
    ...fundamentals.reasons.slice(0, 3),
    ...valuation.reasons.slice(0, 2),
    ...analysts.reasons.slice(0, 1),
  ].slice(0, 7);
  const risks = [
    ...technical.risks,
    ...fundamentals.risks,
    ...valuation.risks,
    ...analysts.risks,
  ].slice(0, 7);
  const sector = profile.sector ?? fundamentals.sector ?? "n/a";
  const industry = profile.industry ?? fundamentals.industry ?? "n/a";
  const companyName = price.longName ?? price.shortName ?? symbol;
  const theme = businessTheme(sector, industry, companyName);
  const plainEnglish = theme === "diversified fund / ETF"
    ? `${companyName} is a diversified fund/ETF. For a beginner, think about what index or basket it tracks, fees, concentration, and whether it overlaps with funds you already own.`
    : `${companyName} is classified in ${sector} / ${industry}. For a beginner, think of it as a ${theme} name, then judge whether growth, profits, balance sheet, valuation, and chart all support owning it.`;
  const growthChecklist = buildGrowthChecklist(summary);
  const riskScore = growthRiskScore(growthChecklist, technical, fundamentals, valuation, analysts);

  return {
    symbol,
    name: companyName,
    exchange: price.exchangeName ?? price.fullExchangeName ?? "n/a",
    currency: price.currency ?? "USD",
    decision,
    totalScore,
    qualityGrade: totalScore >= 80 ? "A" : totalScore >= 65 ? "B" : totalScore >= 50 ? "C" : "D",
    currentPrice: raw(price.regularMarketPrice) ?? technical.close,
    marketCap: raw(price.marketCap),
    benchmark,
    technical,
    fundamentals,
    valuation,
    analysts,
    strengths,
    risks,
    business: {
      sector,
      industry,
      country: profile.country ?? "n/a",
      employees: raw(profile.fullTimeEmployees),
      website: profile.website ?? "",
      theme,
      plainEnglish,
      ownershipStyle: ownershipStyle(totalScore, fundamentals, valuation, theme),
      beginnerRead: beginnerRead(decision, technical, fundamentals, valuation, theme),
      investorChecklist: buildInvestorChecklist(decision, technical, fundamentals, valuation, analysts),
    },
    growthChecklist,
    riskScore,
    managerRead: `${decision}: ${symbol} scores ${totalScore}/100. Technicals are ${technical.rating.toLowerCase()}, fundamentals are ${fundamentals.rating.toLowerCase()}, valuation is ${valuation.rating.toLowerCase()}, and analyst sentiment is ${analysts.rating.toLowerCase()}.`,
    asOf: new Date().toISOString(),
  };
}
