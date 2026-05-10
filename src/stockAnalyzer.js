import { addIndicators, last } from "./indicators.js";
import { fetchHistory, fetchQuoteSummary, fetchYahooNews, fetchSecCompanyFacts } from "./marketData.js";

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

function compactMoney(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  if (Math.abs(value) >= 1_000_000_000_000) return `$${round(value / 1_000_000_000_000, 2)}T`;
  if (Math.abs(value) >= 1_000_000_000) return `$${round(value / 1_000_000_000, 2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${round(value / 1_000_000, 1)}M`;
  return `$${round(value, 2)}`;
}

function cleanSentence(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentences(text, count = 2) {
  const sentences = cleanSentence(text).match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, count).join(" ").trim();
}

function competitorSet(sector, industry, symbol) {
  const text = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  const candidates = [
    [/(semiconductor|chip)/, ["NVDA", "AMD", "AVGO", "INTC", "QCOM"]],
    [/(software|application|internet|cloud)/, ["MSFT", "GOOGL", "AMZN", "ORCL", "CRM"]],
    [/(bank|credit|financial|capital markets|fintech)/, ["JPM", "BAC", "PYPL"]],
    [/(auto|vehicle|ev)/, ["TSLA", "GM", "F"]],
    [/(biotech|pharma|health)/, ["LLY", "MRK", "PFE"]],
    [/(retail|consumer|apparel)/, ["AMZN", "WMT", "TGT"]],
    [/(entertainment|streaming|media)/, ["NFLX", "DIS", "WBD"]],
    [/(energy|oil|gas)/, ["XOM", "CVX", "COP"]],
  ];
  const match = candidates.find(([pattern]) => pattern.test(text));
  return (match?.[1] ?? ["SPY", "QQQ", "IWM"]).filter((item) => item !== symbol).slice(0, 3);
}

function technologyAdvantage(theme, profileSummary) {
  const text = `${theme} ${profileSummary}`.toLowerCase();
  if (text.includes("semiconductor") || text.includes("ai")) {
    return "Possible edge comes from product performance, ecosystem, supply chain access, and developer/customer adoption. Patent-level proof is not available from Yahoo data, so treat this as a moat hypothesis.";
  }
  if (text.includes("software") || text.includes("platform")) {
    return "Possible edge comes from switching costs, data, ecosystem integrations, and customer workflow lock-in. Yahoo data does not confirm unique patents.";
  }
  if (text.includes("financial")) {
    return "Possible edge comes from customer acquisition, underwriting/data quality, funding cost, and product bundle. Yahoo data does not confirm a unique patent advantage.";
  }
  return "No clear unique technological or patent advantage is confirmed from the Yahoo Finance structured data. Treat moat claims as research items, not proven facts.";
}

function classifyNewsItem(item) {
  const title = String(item.title ?? "").toLowerCase();
  const bullishWords = ["beats", "raises", "upgrade", "upgrades", "buy", "partnership", "deal", "contract", "approval", "launch", "record", "surges", "profit"];
  const bearishWords = ["misses", "cuts", "downgrade", "downgrades", "sell", "lawsuit", "probe", "delay", "loss", "drops", "warning", "bankruptcy"];
  const catalystWords = ["earnings", "launch", "approval", "partnership", "deal", "contract", "guidance", "forecast", "target", "upgrade", "downgrade"];
  const bullishHits = bullishWords.filter((word) => title.includes(word));
  const bearishHits = bearishWords.filter((word) => title.includes(word));
  const catalystHits = catalystWords.filter((word) => title.includes(word));
  const tone = bullishHits.length > bearishHits.length ? "bullish" : bearishHits.length > bullishHits.length ? "bearish" : "neutral";
  return {
    ...item,
    tone,
    catalyst: catalystHits.length > 0,
    reason: catalystHits.length ? `Keywords: ${catalystHits.slice(0, 3).join(", ")}` : "No obvious catalyst keyword in headline.",
  };
}

function buildNewsEngine(newsItems, summary) {
  const items = newsItems.map(classifyNewsItem).slice(0, 8);
  const bullish = items.filter((item) => item.tone === "bullish").length;
  const bearish = items.filter((item) => item.tone === "bearish").length;
  const catalystCount = items.filter((item) => item.catalyst).length;
  const filings = (summary.secFilings?.filings ?? []).slice(0, 5).map((item) => ({
    date: item.date,
    type: item.type,
    title: item.title,
    url: item.edgarUrl,
  }));
  const upgrades = (summary.upgradeDowngradeHistory?.history ?? []).slice(0, 5).map((item) => ({
    firm: item.firm,
    action: item.action,
    toGrade: item.toGrade,
    fromGrade: item.fromGrade,
    priceTargetAction: item.priceTargetAction,
    currentPriceTarget: raw(item.currentPriceTarget) ?? item.currentPriceTarget,
    priorPriceTarget: raw(item.priorPriceTarget) ?? item.priorPriceTarget,
    date: item.epochGradeDate ? new Date(item.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
  }));
  const filingFlags = filings.map((item) => `${item.type}${item.title ? `: ${item.title}` : ""}`);
  const score = clamp(50 + bullish * 7 - bearish * 8 + catalystCount * 4 + upgrades.filter((item) => /buy|outperform|overweight/i.test(item.toGrade ?? "")).length * 4);
  return {
    score,
    tone: score >= 70 ? "Positive catalyst tape" : score >= 45 ? "Mixed / normal tape" : "Caution tape",
    bullishCount: bullish,
    bearishCount: bearish,
    catalystCount,
    items,
    filings,
    upgrades,
    filingRead: filingFlags.length ? filingFlags.slice(0, 3).join(" | ") : "No recent SEC filing summary found from Yahoo.",
    caveat: "Headline classification is a filter, not a final truth. Open the source article or filing before acting on a catalyst.",
  };
}

function moatScore(theme, fundamentals, valuation, technical, report) {
  let score = 35;
  const points = [];
  const risks = [];
  if ((fundamentals.grossMargins ?? 0) > 45) { score += 15; points.push("high gross margin suggests pricing power or product differentiation"); }
  if ((fundamentals.operatingMargins ?? 0) > 15) { score += 12; points.push("operating margin supports business quality"); }
  if ((fundamentals.returnOnEquity ?? 0) > 12) { score += 12; points.push("return on equity supports capital efficiency"); }
  if ((technical.relativeStrength60 ?? 0) > 0) { score += 8; points.push("stock is outperforming its benchmark"); }
  if (/software|internet|semiconductor|platform|financial services/.test(String(theme).toLowerCase())) { score += 8; points.push("business type can support scale advantages if execution stays strong"); }
  if ((valuation.priceToSales ?? 0) > 10) { score -= 8; risks.push("valuation demands a strong moat already"); }
  if ((fundamentals.profitMargins ?? 0) < 5) { score -= 8; risks.push("thin profitability weakens moat proof"); }
  return {
    score: clamp(Math.round(score)),
    rating: score >= 75 ? "Strong moat candidate" : score >= 55 ? "Possible moat" : score >= 40 ? "Unproven moat" : "Weak moat evidence",
    points: points.slice(0, 4),
    risks: risks.slice(0, 3),
    read: report?.technologyAdvantage ?? "Moat read unavailable.",
  };
}

function buildCatalystRead(summary, symbol) {
  const earnings = summary.calendarEvents?.earnings;
  const earningsDates = [earnings?.earningsDate?.[0]?.fmt, earnings?.earningsDate?.[1]?.fmt].filter(Boolean);
  const catalysts = [];
  if (earningsDates.length) catalysts.push(`Next earnings window shown by Yahoo: ${earningsDates.join(" to ")}.`);
  const revenueGrowth = raw(summary.financialData?.revenueGrowth);
  const targetMeanPrice = raw(summary.financialData?.targetMeanPrice);
  const currentPrice = raw(summary.financialData?.currentPrice) ?? raw(summary.price?.regularMarketPrice);
  if (revenueGrowth > 0.2) catalysts.push("Growth itself is a catalyst if management keeps beating expectations.");
  if (Number.isFinite(targetMeanPrice) && Number.isFinite(currentPrice) && targetMeanPrice > currentPrice) {
    catalysts.push("Analyst target is above current price, so estimate revisions matter.");
  }
  if (!catalysts.length) {
    catalysts.push(`No specific product launch, approval, or partnership catalyst was available from Yahoo structured data for ${symbol}.`);
  }
  return catalysts;
}

function buildAsymmetryRead(growthChecklist, valuation, technical) {
  const growthPass = growthChecklist.passCount >= 7 && growthChecklist.isGrowthStock;
  const valuationOkay = valuation.score >= 55;
  const chartOkay = technical.score >= 60;
  if (growthPass && valuationOkay && chartOkay) {
    return "Asymmetry looks favorable: growth is strong, valuation is not completely broken, and the chart is supporting the thesis.";
  }
  if (growthPass && !valuationOkay) {
    return "Upside ceiling exists, but valuation is the risk. The stock needs growth to stay very strong or the downside floor can move lower.";
  }
  if (!growthPass && valuationOkay) {
    return "Valuation may give some floor, but the high-growth ceiling is not confirmed by the checklist.";
  }
  return "Asymmetry is not clearly favorable yet. Either growth, valuation, or price trend needs to improve before this becomes a strong risk/reward setup.";
}

function buildReportScores(growthChecklist, technical, fundamentals, valuation, analysts, riskScore, newsEngine = null) {
  const growthRows = ["1-Year Revenue Growth", "3-Year Revenue CAGR", "5-Year Revenue CAGR", "EPS Growth"]
    .map((label) => growthChecklist.rows.find((row) => row.label === label))
    .filter(Boolean);
  const growthBase = growthRows.length
    ? growthRows.reduce((sum, row) => sum + (row.status === "pass" ? 100 : row.status === "near" ? 65 : row.status === "fail" ? 20 : 35), 0) / growthRows.length
    : 35;
  const marginRows = ["Gross Profit Margin", "Operating Profit Margin", "Net Profit Margin", "EBITDA Margin", "FCF Margin", "Return on Equity", "Return on Assets"]
    .map((label) => growthChecklist.rows.find((row) => row.label === label))
    .filter(Boolean);
  const qualityBase = marginRows.length
    ? marginRows.reduce((sum, row) => sum + (row.status === "pass" ? 100 : row.status === "near" ? 65 : row.status === "fail" ? 25 : 40), 0) / marginRows.length
    : fundamentals.score;
  const moatLeg = clamp(Math.round((fundamentals.score * 0.45) + (qualityBase * 0.35) + (technical.score * 0.2)));
  const catalystLeg = clamp(Math.round((analysts.score * 0.45) + ((newsEngine?.score ?? newsEngineScorePlaceholder(growthChecklist)) * 0.55)));
  const balanceSheetLeg = fundamentals.score >= 65 ? 78 : fundamentals.score >= 45 ? 58 : 35;
  const profitabilityLeg = clamp(Math.round(qualityBase));
  const growthPotential = clamp(Math.round(growthBase * 0.42 + technical.score * 0.15 + analysts.score * 0.12 + (100 - riskScore) * 0.12 + moatLeg * 0.19));
  const valuationLeg = valuation.score;
  const qualityLeg = clamp(Math.round(qualityBase * 0.45 + fundamentals.score * 0.35 + technical.score * 0.2));
  const weighting = [
    { label: "Business Quality", weight: 20, score: round(qualityLeg), note: "Business model, margins, cash flow, and quality of execution." },
    { label: "Growth", weight: 20, score: round(growthBase), note: "Revenue, EPS, free cash flow, and revenue-per-share growth where available." },
    { label: "Profitability", weight: 15, score: round(profitabilityLeg), note: "Gross, operating, net, EBITDA, FCF margins, ROE, and ROA." },
    { label: "Valuation", weight: 15, score: round(valuationLeg), note: "P/E, forward P/E, PEG, P/S, P/B, EV/EBITDA, and P/FCF." },
    { label: "Balance Sheet", weight: 10, score: round(balanceSheetLeg), note: "Cash, debt, liquidity, and downturn survivability." },
    { label: "Moat", weight: 10, score: round(moatLeg), note: "Evidence of pricing power, scale, switching costs, and durability." },
    { label: "Catalysts", weight: 5, score: round(catalystLeg), note: "Upcoming earnings, product/news catalysts, and analyst revisions." },
    { label: "Technical Trend", weight: 5, score: round(technical.score), note: "Trend, momentum, relative strength, and breakout condition." },
  ];
  const overallScore = clamp(Math.round(weighting.reduce((sum, item) => sum + item.score * item.weight, 0) / 100));
  return {
    growthPotential,
    overallScore,
    riskScore,
    weighting,
  };
}

function newsEngineScorePlaceholder(growthChecklist) {
  return growthChecklist.catalystProxyScore ?? 50;
}

function buildAdvisorChecks(summary, fundamentals, valuation, analysts, technical, newsEngine) {
  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const totalCash = raw(financial.totalCash);
  const totalDebt = raw(financial.totalDebt);
  const freeCashflow = raw(financial.freeCashflow);
  const totalRevenue = raw(financial.totalRevenue);
  const currentRatio = raw(financial.currentRatio);
  const debtToEquity = raw(financial.debtToEquity);
  const heldPercentInsiders = pctRaw(stats.heldPercentInsiders);
  const heldPercentInstitutions = pctRaw(stats.heldPercentInstitutions);
  const sharesOutstanding = raw(summary.price?.sharesOutstanding) ?? raw(stats.sharesOutstanding);
  const floatShares = raw(stats.floatShares);
  const fcfMargin = totalRevenue && freeCashflow ? (freeCashflow / totalRevenue) * 100 : null;
  const cashDebtRead =
    Number.isFinite(totalCash) && Number.isFinite(totalDebt)
      ? totalCash > totalDebt
        ? "Cash is greater than debt, which gives management more flexibility."
        : "Debt is greater than cash, so rate/credit risk deserves attention."
      : "Cash/debt data was incomplete from Yahoo.";
  const liquidityRead =
    Number.isFinite(currentRatio)
      ? currentRatio >= 1.5
        ? "Short-term liquidity looks comfortable."
        : currentRatio >= 1
          ? "Short-term liquidity is acceptable but not huge."
          : "Current ratio is below 1, so liquidity risk is higher."
      : "Current ratio was unavailable.";
  const ownershipRead =
    Number.isFinite(heldPercentInsiders) || Number.isFinite(heldPercentInstitutions)
      ? `Insider ownership ${formatMetric(heldPercentInsiders)}; institutional ownership ${formatMetric(heldPercentInstitutions)}.`
      : "Ownership mix was unavailable from Yahoo.";
  const coverageRead =
    Number.isFinite(analysts.numberOfAnalystOpinions)
      ? `${analysts.numberOfAnalystOpinions} analyst opinions; consensus is ${analysts.recommendationKey || "n/a"}.`
      : "Analyst coverage was unavailable or thin.";
  return [
    { label: "Balance Sheet", status: Number.isFinite(totalCash) && Number.isFinite(totalDebt) && totalCash > totalDebt ? "pass" : "near", value: cashDebtRead },
    { label: "Liquidity", status: Number.isFinite(currentRatio) && currentRatio >= 1 ? "pass" : "near", value: liquidityRead },
    { label: "Cash Generation", status: Number.isFinite(fcfMargin) && fcfMargin >= 10 ? "pass" : Number.isFinite(fcfMargin) && fcfMargin > 0 ? "near" : "fail", value: `FCF margin: ${formatMetric(fcfMargin)}. Positive cash generation matters more than headline growth.` },
    { label: "Ownership", status: "near", value: ownershipRead },
    { label: "Analyst Coverage", status: analysts.score >= 55 ? "pass" : "near", value: coverageRead },
    { label: "Trading Plan", status: technical.score >= 60 ? "pass" : technical.score >= 45 ? "near" : "fail", value: `Chart stop near ${round(technical.stop)} and first target near ${round(technical.target)}. Do not buy without a risk plan.` },
    { label: "Dilution Watch", status: Number.isFinite(floatShares) && Number.isFinite(sharesOutstanding) && floatShares <= sharesOutstanding ? "near" : "unavailable", value: Number.isFinite(floatShares) && Number.isFinite(sharesOutstanding) ? `Float is about ${round((floatShares / sharesOutstanding) * 100, 1)}% of shares outstanding.` : "Share float/outstanding data was incomplete." },
    { label: "News/Filing Risk", status: (newsEngine?.score ?? 50) >= 60 ? "pass" : (newsEngine?.score ?? 50) >= 40 ? "near" : "fail", value: newsEngine?.filingRead || "No recent filing summary found from Yahoo." },
  ];
}

function checklistValue(checklist, label) {
  return checklist.rows.find((row) => row.label === label) ?? null;
}

function buildKpiRows({ summary, growthChecklist, currentPrice, marketCap, fundamentals }) {
  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const totalCash = raw(financial.totalCash);
  const totalDebt = raw(financial.totalDebt);
  const debtToEquity = raw(financial.debtToEquity);
  const rows = [
    { label: "Current Price", display: compactMoney(currentPrice), status: "near", tooltip: "Latest price from Yahoo Finance." },
    { label: "Market Cap", display: compactMoney(marketCap), status: "near", tooltip: "Equity market value from Yahoo Finance." },
    checklistValue(growthChecklist, "1-Year Revenue Growth"),
    checklistValue(growthChecklist, "3-Year Revenue CAGR"),
    checklistValue(growthChecklist, "5-Year Revenue CAGR"),
    checklistValue(growthChecklist, "Gross Profit Margin"),
    checklistValue(growthChecklist, "Operating Profit Margin"),
    checklistValue(growthChecklist, "Net Profit Margin"),
    checklistValue(growthChecklist, "FCF Margin"),
    checklistValue(growthChecklist, "P/E Ratio"),
    checklistValue(growthChecklist, "Forward P/E"),
    checklistValue(growthChecklist, "PEG Ratio"),
    checklistValue(growthChecklist, "P/S Ratio"),
    checklistValue(growthChecklist, "P/B Ratio"),
    checklistValue(growthChecklist, "Enterprise Value / EBITDA"),
    checklistValue(growthChecklist, "P/FCF"),
    checklistValue(growthChecklist, "Return on Equity"),
    checklistValue(growthChecklist, "Return on Assets"),
    metricRow("Debt / Equity", debtToEquity, formatMetric(debtToEquity, "x"), "Lower is safer; sector-adjusted", Number.isFinite(debtToEquity) ? debtToEquity <= 120 ? "pass" : debtToEquity <= 180 ? "near" : "fail" : "unavailable", "Financial leverage from Yahoo Finance."),
    metricRow("Cash / Debt", totalCash && totalDebt ? totalCash / totalDebt : null, totalCash && totalDebt ? `${round(totalCash / totalDebt, 2)}x` : "Unavailable", "Above 1x preferred", totalCash && totalDebt ? totalCash >= totalDebt ? "pass" : totalCash >= totalDebt * 0.5 ? "near" : "fail" : "unavailable", "Cash relative to total debt."),
    checklistValue(growthChecklist, "Shares Outstanding Growth"),
  ].filter(Boolean);
  return rows.map((row) => ({
    ...row,
    tooltip: row.tooltip || row.note || "Yahoo Finance metric; verify important values against filings.",
  }));
}

function statusRisk(row, fallback = 48) {
  if (!row) return fallback;
  if (row.status === "pass") return 24;
  if (row.status === "near") return 44;
  if (row.status === "fail") return 68;
  return fallback;
}

function averageStatusRisk(growthChecklist, labels, fallback = 48) {
  const rows = labels.map((label) => checklistValue(growthChecklist, label)).filter(Boolean);
  if (!rows.length) return fallback;
  return rows.reduce((sum, row) => sum + statusRisk(row, fallback), 0) / rows.length;
}

function riskLevel(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "Unavailable";
  if (value < 35) return "Low";
  if (value < 55) return "Moderate";
  if (value < 75) return "Elevated";
  return "Very high";
}

function estimateRiskComponents({ growthChecklist, valuation, fundamentals, technical, analysts, newsEngine, summary }) {
  const financial = summary?.financialData ?? {};
  const price = summary?.price ?? {};
  const stats = summary?.defaultKeyStatistics ?? {};
  const marketCap = raw(price.marketCap) ?? raw(summary?.summaryDetail?.marketCap);
  const totalCash = raw(financial.totalCash) ?? fundamentals.totalCash;
  const totalDebt = raw(financial.totalDebt) ?? fundamentals.totalDebt;
  const currentRatio = raw(financial.currentRatio) ?? fundamentals.currentRatio;
  const debtToEquity = raw(financial.debtToEquity) ?? fundamentals.debtToEquity;
  const forwardPE = valuation.forwardPE ?? raw(stats.forwardPE);
  const priceToSales = valuation.priceToSales ?? raw(stats.priceToSalesTrailing12Months);
  const pegRatio = valuation.pegRatio ?? raw(stats.pegRatio);
  const analystUpside = valuation.analystUpside;
  const revenueGrowthRow = checklistValue(growthChecklist, "1-Year Revenue Growth");

  let valuationRisk = valuation.score >= 70 ? 26 : valuation.score >= 55 ? 38 : valuation.score >= 40 ? 55 : 70;
  if (Number.isFinite(forwardPE) && forwardPE > 60) valuationRisk += 8;
  if (Number.isFinite(priceToSales) && priceToSales > 15) valuationRisk += 8;
  if (Number.isFinite(pegRatio) && pegRatio > 3) valuationRisk += 6;
  if (fundamentals.score >= 70) valuationRisk -= 12;
  else if (fundamentals.score >= 55) valuationRisk -= 7;
  if (revenueGrowthRow?.status === "pass") valuationRisk -= 5;
  if (Number.isFinite(analystUpside) && analystUpside > 0) valuationRisk -= 3;
  valuationRisk = clamp(Math.round(valuationRisk));

  let balanceSheetRisk = 48;
  if (Number.isFinite(totalCash) && Number.isFinite(totalDebt)) {
    const cashDebt = totalDebt > 0 ? totalCash / totalDebt : 5;
    balanceSheetRisk = cashDebt >= 1 ? 24 : cashDebt >= 0.5 ? 42 : 62;
  }
  if (Number.isFinite(debtToEquity) && debtToEquity > 180) balanceSheetRisk += 14;
  else if (Number.isFinite(debtToEquity) && debtToEquity > 120) balanceSheetRisk += 7;
  if (Number.isFinite(currentRatio) && currentRatio < 1) balanceSheetRisk += 10;
  if (Number.isFinite(fundamentals.freeCashflow) && fundamentals.freeCashflow > 0) balanceSheetRisk -= 6;
  balanceSheetRisk = clamp(Math.round(balanceSheetRisk));

  const dilutionRow = checklistValue(growthChecklist, "Shares Outstanding Growth");
  const dilutionRisk = dilutionRow?.status === "fail" ? 70 : dilutionRow?.status === "near" ? 52 : dilutionRow?.status === "pass" ? 24 : 42;

  const executionLabels = [
    "1-Year Revenue Growth",
    "3-Year Revenue CAGR",
    "5-Year Revenue CAGR",
    "EPS Growth",
    "FCF Growth",
    "Gross Profit Margin",
    "Operating Profit Margin",
    "Net Profit Margin",
    "EBITDA Margin",
    "FCF Margin",
    "Return on Equity",
    "Return on Assets",
  ];
  let executionRisk = averageStatusRisk(growthChecklist, executionLabels, 48);
  if (fundamentals.score >= 70) executionRisk -= 10;
  else if (fundamentals.score >= 55) executionRisk -= 5;
  if ((analysts?.score ?? 50) >= 65) executionRisk -= 3;
  executionRisk = clamp(Math.round(executionRisk));

  let competitionRisk = 44;
  if ((fundamentals.grossMargins ?? 0) >= 45 && (fundamentals.operatingMargins ?? 0) >= 15) competitionRisk = 28;
  if ((fundamentals.grossMargins ?? 0) < 20 || (fundamentals.operatingMargins ?? 0) < 0) competitionRisk = 66;
  if (Number.isFinite(marketCap) && marketCap > 200_000_000_000 && competitionRisk > 34) competitionRisk -= 6;
  competitionRisk = clamp(Math.round(competitionRisk));

  const regulatoryNewsRisk = (newsEngine?.score ?? 50) < 40 ? 68 : (newsEngine?.bearishCount ?? 0) > 2 ? 60 : (newsEngine?.score ?? 50) >= 65 ? 28 : 38;
  const technicalRisk = technical.score < 40 ? 72 : technical.score < 55 ? 54 : technical.score >= 70 ? 26 : 34;
  let overallRisk = clamp(Math.round(
    valuationRisk * 0.24 +
    balanceSheetRisk * 0.15 +
    dilutionRisk * 0.08 +
    executionRisk * 0.17 +
    competitionRisk * 0.11 +
    regulatoryNewsRisk * 0.1 +
    technicalRisk * 0.15
  ));
  if ((Number.isFinite(priceToSales) && priceToSales > 10) || (Number.isFinite(forwardPE) && forwardPE > 45)) {
    overallRisk = Math.max(overallRisk, fundamentals.score >= 70 && revenueGrowthRow?.status === "pass" ? 38 : 44);
  }
  overallRisk = clamp(overallRisk);

  return {
    valuationRisk,
    balanceSheetRisk,
    dilutionRisk,
    executionRisk,
    competitionRisk,
    regulatoryNewsRisk,
    technicalRisk,
    overallRisk,
  };
}

function buildRiskBreakdown({ growthChecklist, valuation, fundamentals, technical, analysts, newsEngine, summary }) {
  const components = estimateRiskComponents({ growthChecklist, valuation, fundamentals, technical, analysts, newsEngine, summary });
  const dilutionRow = checklistValue(growthChecklist, "Shares Outstanding Growth");
  return [
    { label: "Valuation risk", score: components.valuationRisk, note: `${valuation.rating}. Quality can offset some premium, but not remove it.` },
    { label: "Balance sheet risk", score: components.balanceSheetRisk, note: fundamentals.totalDebt > fundamentals.totalCash ? "Debt exceeds cash" : "Debt/cash looks manageable" },
    { label: "Dilution risk", score: components.dilutionRisk, note: dilutionRow?.display || "Share trend unavailable; treated as neutral, not automatically high risk" },
    { label: "Execution risk", score: components.executionRisk, note: "Growth, margin, FCF, ROE, and ROA delivery risk" },
    { label: "Competition risk", score: components.competitionRisk, note: fundamentals.grossMargins < 20 ? "Margin pressure" : "Margins/scale reduce competitive risk" },
    { label: "Regulatory/news risk", score: components.regulatoryNewsRisk, note: newsEngine?.tone || "Normal tape" },
    { label: "Technical breakdown risk", score: components.technicalRisk, note: technical.rating },
  ];
}

function scorePass(value, pass, near, missing = 45) {
  if (!Number.isFinite(value)) return missing;
  if (value >= pass) return 100;
  if (value >= near) return 70;
  if (value > 0) return 45;
  return 20;
}

function marketCapStageScore(marketCap) {
  if (!Number.isFinite(marketCap)) return 45;
  if (marketCap < 100_000_000) return 35;
  if (marketCap < 300_000_000) return 60;
  if (marketCap < 2_000_000_000) return 95;
  if (marketCap < 10_000_000_000) return 85;
  if (marketCap < 25_000_000_000) return 55;
  if (marketCap < 75_000_000_000) return 28;
  return 8;
}

function marketSizeScore(theme, sector, industry) {
  const text = `${theme ?? ""} ${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/(ai|semiconductor|software|cloud|cyber|data|robot|automation|biotech|genomics|defense|aerospace|energy|grid|fintech|payments)/.test(text)) return 85;
  if (/(internet|platform|medical|health|consumer|ecommerce|financial)/.test(text)) return 70;
  if (/(industrial|materials|real estate|utility)/.test(text)) return 48;
  return 55;
}

function annualStatementRows(summary) {
  const income = (summary.incomeStatementHistory?.incomeStatementHistory ?? [])
    .map((item) => ({
      date: item.endDate?.fmt,
      revenue: raw(item.totalRevenue),
      operatingIncome: raw(item.operatingIncome),
      netIncome: raw(item.netIncome),
    }))
    .filter((item) => Number.isFinite(item.revenue))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cashflow = (summary.cashflowStatementHistory?.cashflowStatements ?? [])
    .map((item) => ({
      date: item.endDate?.fmt,
      fcf: raw(item.freeCashFlow) ?? (raw(item.totalCashFromOperatingActivities) - raw(item.capitalExpenditures)),
    }))
    .filter((item) => Number.isFinite(item.fcf))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { income, cashflow };
}

function multibaggerClassification({ score, riskScore, marketCap, revenueGrowth, operatingMarginTrend, fcfTrend, hypeRisk, underRadarScore }) {
  const earlyEnough = !Number.isFinite(marketCap) || marketCap < 25_000_000_000;
  if (score >= 72 && riskScore <= 58 && earlyEnough && underRadarScore >= 45) return "Early Quality Compounder";
  if (score >= 58 && revenueGrowth >= 25 && riskScore <= 75 && earlyEnough) return "Speculative Multibagger Candidate";
  if (score >= 45 && (operatingMarginTrend > 0 || fcfTrend > 0) && riskScore <= 72 && earlyEnough) return "Turnaround Candidate";
  if (hypeRisk >= 70 && score < 55) return "Hype Stock With Weak Fundamentals";
  if (score >= 58 && riskScore <= 60) return "Speculative Multibagger Candidate";
  return "Avoid / Too Many Red Flags";
}

function buildHiddenMultibaggerHunter({ summary, growthChecklist, fundamentals, valuation, analysts, technical, moat, newsEngine, report, theme, sector, industry }) {
  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const price = summary.price ?? {};
  const detail = summary.summaryDetail ?? {};
  const marketCap = raw(price.marketCap) ?? raw(detail.marketCap);
  const currentPrice = raw(financial.currentPrice) ?? raw(price.regularMarketPrice) ?? technical.close;
  const averageVolume = raw(price.averageDailyVolume3Month) ?? raw(price.averageDailyVolume10Day) ?? raw(detail.averageVolume);
  const dollarVolume = Number.isFinite(currentPrice) && Number.isFinite(averageVolume) ? currentPrice * averageVolume : null;
  const totalCash = raw(financial.totalCash);
  const totalDebt = raw(financial.totalDebt);
  const currentRatio = raw(financial.currentRatio);
  const totalRevenue = raw(financial.totalRevenue);
  const freeCashflow = raw(financial.freeCashflow);
  const heldPercentInsiders = pctRaw(stats.heldPercentInsiders);
  const heldPercentInstitutions = pctRaw(stats.heldPercentInstitutions);
  const shortPercentOfFloat = pctRaw(stats.shortPercentOfFloat);
  const sharesShort = raw(stats.sharesShort);
  const revenueGrowth = checklistValue(growthChecklist, "1-Year Revenue Growth")?.value;
  const revenueCagr3 = checklistValue(growthChecklist, "3-Year Revenue CAGR")?.value;
  const grossMargin = checklistValue(growthChecklist, "Gross Profit Margin")?.value;
  const fcfMargin = checklistValue(growthChecklist, "FCF Margin")?.value;
  const { income, cashflow } = annualStatementRows(summary);
  const latestIncome = income.at(-1);
  const priorIncome = income.at(-2);
  const latestOperatingMargin = latestIncome?.revenue ? (latestIncome.operatingIncome / latestIncome.revenue) * 100 : null;
  const priorOperatingMargin = priorIncome?.revenue ? (priorIncome.operatingIncome / priorIncome.revenue) * 100 : null;
  const operatingMarginTrend = Number.isFinite(latestOperatingMargin) && Number.isFinite(priorOperatingMargin)
    ? latestOperatingMargin - priorOperatingMargin
    : Number.isFinite(fundamentals.operatingMargins) ? fundamentals.operatingMargins : null;
  const latestFcf = cashflow.at(-1)?.fcf;
  const priorFcf = cashflow.at(-2)?.fcf;
  const fcfTrend = Number.isFinite(latestFcf) && Number.isFinite(priorFcf) ? latestFcf - priorFcf : null;
  const cashRunwayYears = Number.isFinite(totalCash) && Number.isFinite(freeCashflow) && freeCashflow < 0
    ? totalCash / Math.abs(freeCashflow)
    : Number.isFinite(freeCashflow) && freeCashflow >= 0 ? Infinity : null;
  const analystCount = analysts.numberOfAnalystOpinions;
  const mediaCoverage = newsEngine.items?.length ?? 0;
  const socialHypeProxy = mediaCoverage + (newsEngine.bullishCount ?? 0) + (shortPercentOfFloat > 15 ? 2 : 0);

  const revenueAccelerationScore = clamp(Math.round(
    scorePass(revenueGrowth, 25, 15, 40) * 0.55 +
    scorePass(revenueCagr3, 20, 12, 40) * 0.3 +
    (Number.isFinite(revenueGrowth) && Number.isFinite(revenueCagr3) && revenueGrowth > revenueCagr3 ? 100 : 45) * 0.15
  ));
  const tamScore = clamp(Math.round(marketSizeScore(theme, sector, industry) * 0.7 + marketCapStageScore(marketCap) * 0.3));
  const grossMarginScore = Number.isFinite(grossMargin) ? clamp(Math.round(grossMargin >= 55 ? 100 : grossMargin >= 40 ? 82 : grossMargin >= 25 ? 58 : 25)) : 45;
  const operatingLeverageScore = Number.isFinite(operatingMarginTrend)
    ? clamp(Math.round((operatingMarginTrend > 5 ? 100 : operatingMarginTrend > 1 ? 78 : operatingMarginTrend > -2 ? 52 : 25)))
    : fundamentals.operatingMargins > 10 ? 70 : 45;
  const survivalScore = (() => {
    if (Number.isFinite(freeCashflow) && freeCashflow > 0) return 85;
    if (Number.isFinite(cashRunwayYears)) {
      if (cashRunwayYears >= 3) return 82;
      if (cashRunwayYears >= 2) return 68;
      if (cashRunwayYears >= 1) return 45;
      return 20;
    }
    if (Number.isFinite(totalCash) && Number.isFinite(totalDebt) && totalCash > totalDebt) return 68;
    if (Number.isFinite(currentRatio) && currentRatio >= 1.5) return 60;
    return 42;
  })();
  const dilutionScore = (() => {
    const dilutionRow = checklistValue(growthChecklist, "Shares Outstanding Growth");
    if (dilutionRow?.status === "pass") return 85;
    if (dilutionRow?.status === "near") return 62;
    if (dilutionRow?.status === "fail") return 25;
    if (survivalScore >= 75 && Number.isFinite(heldPercentInsiders) && heldPercentInsiders >= 8) return 68;
    return 50;
  })();
  const moatUniquenessScore = clamp(Math.round((moat?.score ?? 45) * 0.7 + grossMarginScore * 0.3));
  const catalystScore = clamp(Math.round((newsEngine.score ?? 50) * 0.55 + Math.min(100, (newsEngine.catalystCount ?? 0) * 30 + 35) * 0.45));
  const underRadarFactors = [
    { label: "Market cap", value: compactMoney(marketCap), score: marketCapStageScore(marketCap), note: "Best hidden setups are usually small or mid cap, not already mega-cap." },
    { label: "Analyst coverage", value: Number.isFinite(analystCount) ? `${analystCount} analysts` : "Unavailable", score: !Number.isFinite(analystCount) ? 55 : analystCount <= 5 ? 95 : analystCount <= 12 ? 72 : analystCount <= 25 ? 38 : 12, note: "Lower coverage can mean fewer investors understand the story yet." },
    { label: "Institutional ownership", value: formatMetric(heldPercentInstitutions), score: !Number.isFinite(heldPercentInstitutions) ? 50 : heldPercentInstitutions < 10 ? 45 : heldPercentInstitutions <= 65 ? 82 : 36, note: "Some sponsorship is good; extreme sponsorship can mean the name is already discovered." },
    { label: "Media coverage", value: `${mediaCoverage} Yahoo headlines`, score: mediaCoverage <= 3 ? 85 : mediaCoverage <= 7 ? 58 : 28, note: "Low headline count can support under-the-radar status." },
    { label: "Social media hype", value: `Proxy ${socialHypeProxy}`, score: socialHypeProxy <= 5 ? 78 : socialHypeProxy <= 10 ? 48 : 22, note: "Uses headlines, bullish headline count, and short interest as a hype proxy." },
    { label: "Trading volume", value: Number.isFinite(dollarVolume) ? `${compactMoney(dollarVolume)}/day` : "Unavailable", score: !Number.isFinite(dollarVolume) ? 50 : dollarVolume < 2_000_000 ? 35 : dollarVolume < 25_000_000 ? 80 : dollarVolume < 150_000_000 ? 62 : 24, note: "Enough liquidity matters, but very high dollar volume usually means the stock is already known." },
    { label: "Short interest", value: formatMetric(shortPercentOfFloat), score: !Number.isFinite(shortPercentOfFloat) ? 50 : shortPercentOfFloat < 5 ? 62 : shortPercentOfFloat <= 15 ? 72 : 38, note: "Moderate skepticism can create fuel; extreme short interest can also flag real problems." },
    { label: "Insider ownership", value: formatMetric(heldPercentInsiders), score: !Number.isFinite(heldPercentInsiders) ? 50 : heldPercentInsiders >= 10 ? 86 : heldPercentInsiders >= 3 ? 65 : 36, note: "Founder/insider ownership helps alignment when the company is still early." },
  ];
  const underRadarScore = clamp(Math.round(underRadarFactors.reduce((sum, item) => sum + item.score, 0) / underRadarFactors.length));
  const scoreBreakdown = [
    { label: "Revenue acceleration", weight: 20, score: revenueAccelerationScore, note: `1Y growth ${formatMetric(revenueGrowth)}, 3Y CAGR ${formatMetric(revenueCagr3)}.` },
    { label: "Market size / TAM", weight: 15, score: tamScore, note: `${theme} market with stage-adjusted market-cap room.` },
    { label: "Gross margin quality", weight: 10, score: grossMarginScore, note: `Gross margin ${formatMetric(grossMargin)}.` },
    { label: "Operating leverage", weight: 15, score: operatingLeverageScore, note: Number.isFinite(operatingMarginTrend) ? `Operating margin trend ${round(operatingMarginTrend, 2)} pts.` : "Operating leverage trend unavailable." },
    { label: "Balance sheet survival", weight: 10, score: survivalScore, note: Number.isFinite(cashRunwayYears) ? `Cash runway around ${round(cashRunwayYears, 1)} years.` : "Uses cash, debt, liquidity, and FCF." },
    { label: "Dilution control", weight: 10, score: dilutionScore, note: "Uses share trend when available; otherwise cash runway and insider alignment." },
    { label: "Moat / uniqueness", weight: 10, score: moatUniquenessScore, note: moat?.rating || "Moat evidence unavailable." },
    { label: "Catalyst strength", weight: 5, score: catalystScore, note: `${newsEngine.catalystCount ?? 0} catalyst headlines; ${newsEngine.tone || "normal tape"}.` },
    { label: "Under-the-radar factor", weight: 5, score: underRadarScore, note: "Market cap, coverage, ownership, media, volume, short interest, and insiders." },
  ];
  const score = clamp(Math.round(scoreBreakdown.reduce((sum, item) => sum + item.score * item.weight, 0) / 100));
  const valuationRisk = clamp(100 - (valuation.score ?? 45));
  const cashBurnRisk = Number.isFinite(freeCashflow) && freeCashflow < 0 ? cashRunwayYears >= 2 ? 45 : cashRunwayYears >= 1 ? 68 : 88 : 25;
  const balanceSheetRisk = survivalScore >= 75 ? 25 : survivalScore >= 55 ? 45 : 72;
  const dilutionRisk = 100 - dilutionScore;
  const hypeRisk = socialHypeProxy >= 11 ? 76 : socialHypeProxy >= 7 ? 55 : 34;
  const liquidityRisk = !Number.isFinite(dollarVolume) ? 52 : dollarVolume < 2_000_000 ? 78 : dollarVolume < 10_000_000 ? 58 : 32;
  const filingRisk = newsEngine.filings?.length ? 28 : 52;
  const insiderSellingRisk = !Number.isFinite(heldPercentInsiders) ? 50 : heldPercentInsiders < 1 ? 62 : 35;
  const customerConcentrationRisk = 50;
  const riskBreakdown = [
    { label: "Dilution risk", score: dilutionRisk, note: "High if cash runway is weak or share growth is heavy." },
    { label: "Cash burn risk", score: cashBurnRisk, note: Number.isFinite(freeCashflow) ? `FCF ${compactMoney(freeCashflow)}.` : "FCF unavailable." },
    { label: "Balance sheet risk", score: balanceSheetRisk, note: Number.isFinite(totalCash) && Number.isFinite(totalDebt) ? `Cash ${compactMoney(totalCash)} vs debt ${compactMoney(totalDebt)}.` : "Cash/debt incomplete." },
    { label: "Valuation risk", score: valuationRisk, note: valuation.rating || "Valuation unavailable." },
    { label: "Customer concentration", score: customerConcentrationRisk, note: "Requires 10-K/customer disclosures; neutral until verified." },
    { label: "Hype / promotion risk", score: hypeRisk, note: "Headline and short-interest proxy; verify social/media manually." },
    { label: "Liquidity risk", score: liquidityRisk, note: Number.isFinite(dollarVolume) ? `${compactMoney(dollarVolume)} estimated daily dollar volume.` : "Volume unavailable." },
    { label: "Filing / reporting risk", score: filingRisk, note: newsEngine.filings?.length ? "Recent filing links found." : "No filing links found in Yahoo feed." },
    { label: "Insider selling risk", score: insiderSellingRisk, note: "Insider selling feed unavailable; insider ownership used as proxy." },
  ];
  const riskScore = clamp(Math.round(riskBreakdown.reduce((sum, row) => sum + row.score, 0) / riskBreakdown.length));
  const earlyProof = [
    { label: "Revenue growth above 25%", passed: Number.isFinite(revenueGrowth) && revenueGrowth >= 25, value: formatMetric(revenueGrowth) },
    { label: "3-year revenue CAGR above 20%", passed: Number.isFinite(revenueCagr3) && revenueCagr3 >= 20, value: formatMetric(revenueCagr3) },
    { label: "Gross margin stable or improving", passed: grossMarginScore >= 70, value: formatMetric(grossMargin) },
    { label: "Operating losses narrowing / leverage improving", passed: operatingLeverageScore >= 70, value: Number.isFinite(operatingMarginTrend) ? `${round(operatingMarginTrend, 2)} pts` : "Unavailable" },
    { label: "FCF improving", passed: Number.isFinite(fcfTrend) ? fcfTrend > 0 : Number.isFinite(fcfMargin) && fcfMargin > 0, value: Number.isFinite(fcfTrend) ? compactMoney(fcfTrend) : formatMetric(fcfMargin) },
    { label: "Revenue per share growing", passed: false, value: "Needs share history verification" },
    { label: "Low dilution", passed: dilutionScore >= 60, value: checklistValue(growthChecklist, "Shares Outstanding Growth")?.display || "Unavailable" },
    { label: "Strong cash runway", passed: survivalScore >= 68, value: Number.isFinite(cashRunwayYears) ? `${round(cashRunwayYears, 1)} years` : Number.isFinite(freeCashflow) && freeCashflow >= 0 ? "FCF positive" : "Unavailable" },
    { label: "Real signed customers or backlog", passed: /contract|deal|customer|backlog|government|partnership/i.test(`${report?.partnerships ?? ""} ${(newsEngine.items ?? []).map((item) => item.title).join(" ")}`), value: "Verify source documents" },
    { label: "Clear catalyst in next 12-24 months", passed: (newsEngine.catalystCount ?? 0) > 0 || (report?.catalysts ?? []).length > 0, value: `${(report?.catalysts ?? []).length} listed` },
  ];
  const classification = multibaggerClassification({ score, riskScore, marketCap, revenueGrowth, operatingMarginTrend, fcfTrend, hypeRisk, underRadarScore });
  const classificationReason =
    underRadarScore < 40
      ? "Business progress may be real, but the stock does not look hidden or undiscovered. Treat this as a multibagger-filter warning, not a company-quality downgrade."
      : score >= 70 && riskScore <= 58
        ? "The setup has enough business progress and survivability to deserve deeper research."
        : riskScore >= 70
          ? "The upside story is fighting serious financing, valuation, liquidity, or reporting risk."
          : "The setup has some proof, but the thesis still needs more evidence before it becomes high conviction.";
  const upsideCase = score >= 60
    ? "The upside case is that revenue keeps compounding, margins scale, dilution stays controlled, and catalysts prove there is a real business curve rather than a one-quarter trade."
    : "The upside case is still mostly unproven. The stock needs clearer growth acceleration, margin leverage, or customer/backlog proof before the multibagger thesis has teeth.";
  const downsideCase = riskScore >= 65
    ? "The downside case is severe: dilution, cash burn, weak liquidity, or promotional hype could overwhelm the growth story before shareholders see operating leverage."
    : "The downside case is that valuation expectations reset, growth slows, or the market decides the company is not as unique as the story suggests.";
  const mustHappen = [
    "Revenue growth should stay above 25% or reaccelerate with proof from filings.",
    "Gross margin should remain stable while operating losses narrow or profits expand.",
    "Free cash flow should improve without heavy share dilution.",
    "Customer wins, backlog, or partnerships must show real revenue impact, not vague press-release language.",
    "The stock should remain liquid enough to exit and avoid becoming a purely hype-driven trade.",
  ];
  return {
    score,
    riskScore,
    classification,
    classificationReason,
    scoreBreakdown,
    riskBreakdown,
    underRadarScore,
    underRadarFactors,
    earlyProof,
    upsideCase,
    downsideCase,
    mustHappen,
    caveat: "This section hunts for asymmetric early-stage potential. It is not a buy/sell recommendation and should be verified against SEC filings, customer announcements, and dilution history.",
  };
}

function buildDataQuality({ summary, secFacts, growthChecklist }) {
  const earnings = summary.calendarEvents?.earnings;
  const latestQuarter =
    earnings?.earningsDate?.[0]?.fmt ||
    summary.earningsTrend?.trend?.find((item) => item.period === "0q")?.endDate ||
    "Unavailable";
  const unavailable = growthChecklist.rows.filter((row) => row.status === "unavailable").map((row) => row.label);
  return {
    marketDataDate: new Date().toISOString(),
    latestQuarterUsed: latestQuarter,
    secCrossCheck: secFacts
      ? `SEC company facts loaded for CIK ${secFacts.cik}. Use EDGAR filing links for final verification.`
      : "SEC company facts not available for this ticker/session; Yahoo Finance structured data used.",
    missingOrEstimatedValues: unavailable.slice(0, 12),
    caveat: "This is an analytical research report, not financial advice. Missing and estimated fields are explicitly flagged when Yahoo/SEC data is incomplete.",
  };
}

function investigateFurtherLabel(reportScores, growthChecklist, technical, valuation, newsEngine) {
  if (reportScores.overallScore >= 72 && reportScores.riskScore <= 65 && (technical.score >= 50 || growthChecklist.isGrowthStock)) {
    return "Yes - high-quality watchlist candidate";
  }
  if (reportScores.overallScore >= 58 || reportScores.growthPotential >= 65) {
    return "Maybe - interesting but valuation/risk is high";
  }
  if (reportScores.growthPotential >= 50 || (newsEngine?.catalystCount ?? 0) >= 2) {
    return "Only speculative - needs small position sizing";
  }
  if (technical.score < 40 || valuation.score < 35 || reportScores.riskScore >= 82) {
    return "No - weak fundamentals or too many red flags";
  }
  return "Maybe - needs more proof";
}

function buildBusinessReport(symbol, companyName, sector, industry, theme, summary, growthChecklist, technical, fundamentals, valuation, analysts, riskScore, newsEngine = null) {
  const profileSummary = summary.assetProfile?.longBusinessSummary ?? "";
  const productRead = firstSentences(profileSummary, 2) || `${companyName} operates in ${sector} / ${industry}. Yahoo did not provide a full business summary.`;
  const catalystRead = [
    ...buildCatalystRead(summary, symbol),
    ...(newsEngine?.items ?? [])
      .filter((item) => item.catalyst)
      .slice(0, 3)
      .map((item) => `Recent Yahoo headline catalyst: ${item.title}`),
  ].slice(0, 6);
  const businessModel = theme === "diversified fund / ETF"
    ? "It makes money as a fund product by tracking a basket/index and charging fund expenses, while investors get exposure to the underlying holdings."
    : `It makes money by selling products or services tied to ${industry || sector}. In plain English: ${productRead}`;
  const bullParts = [];
  const bearParts = [];
  if (growthChecklist.isGrowthStock) bullParts.push("growth is strong enough to qualify as a growth-stock candidate");
  else bearParts.push("growth is not fully confirmed by the checklist");
  if (technical.score >= 65) bullParts.push("the chart trend is supportive");
  else bearParts.push("the chart is not giving a clean confirmation");
  if (valuation.score >= 55) bullParts.push("valuation is not fighting the story too hard");
  else bearParts.push("valuation or missing valuation support can limit upside");
  if (fundamentals.score >= 55) bullParts.push("business quality is acceptable");
  else bearParts.push("fundamental quality still needs proof");

  return {
    businessModel,
    coreProduct: productRead,
    moat: `The likely moat is ${theme === "diversified fund / ETF" ? "diversification, brand, liquidity, and low-cost access" : "brand, product ecosystem, customer relationships, execution quality, and scale"}. This dashboard does not claim a proven patent moat unless Yahoo data explicitly supports it.`,
    competitors: competitorSet(sector, industry, symbol),
    technologyAdvantage: technologyAdvantage(theme, profileSummary),
    catalysts: catalystRead,
    asymmetry: buildAsymmetryRead(growthChecklist, valuation, technical),
    partnerships: (newsEngine?.items ?? []).some((item) => /partnership|deal|contract|backlog|government|nvidia|nvda|microsoft|msft/i.test(item.title ?? ""))
      ? "Recent Yahoo headlines may include deal/partnership language. Open the linked story and company release to confirm revenue impact before treating it as real backlog."
      : "Yahoo structured data does not reliably list fresh deals, backlogs, or government/mega-cap partnerships. If a thesis depends on an NVDA/MSFT/government deal, confirm it from company press releases before buying.",
    bullCase: bullParts.length ? `Bull case: ${bullParts.join(", ")}.` : "Bull case: the setup needs more proof before it becomes compelling.",
    bearCase: bearParts.length ? `Bear case: ${bearParts.join(", ")}.` : "Bear case: the main risk is paying too much after a strong move.",
    shortAnalysis: `${companyName} is a ${theme} candidate. Overall, I would treat it as ${growthChecklist.isGrowthStock ? "a growth stock candidate" : "not yet a confirmed growth stock"} with risk around ${riskScore}/100. The key is whether revenue growth can stay ahead of the stock's valuation. Analyst tone is ${analysts.rating.toLowerCase()}.`,
  };
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
  const cashflowAnnual = (summary.cashflowStatementHistory?.cashflowStatements ?? [])
    .map((item) => ({ date: item.endDate?.fmt, fcf: raw(item.freeCashFlow) ?? (raw(item.totalCashFromOperatingActivities) - raw(item.capitalExpenditures)) }))
    .filter((item) => Number.isFinite(item.fcf))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latestAnnual = annual.at(-1);
  const oldestAnnual = annual[0];
  const revenueCagr = latestAnnual && oldestAnnual ? cagr(oldestAnnual.revenue, latestAnnual.revenue, annual.length - 1) : null;
  const revenueCagrPct = Number.isFinite(revenueCagr) ? revenueCagr * 100 : null;
  const revenueCagr5 = annual.length >= 6 ? cagr(annual.at(-6).revenue, latestAnnual.revenue, 5) : null;
  const revenueCagr5Pct = Number.isFinite(revenueCagr5) ? revenueCagr5 * 100 : null;
  const fcfGrowth = cashflowAnnual.length >= 2 ? (cashflowAnnual.at(-1).fcf / cashflowAnnual.at(-2).fcf - 1) * 100 : null;
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
    metricRow("5-Year Revenue CAGR", revenueCagr5Pct, Number.isFinite(revenueCagr5Pct) ? formatMetric(revenueCagr5Pct) : "Unavailable", "20%+", metricStatus(revenueCagr5Pct, 20), annual.length >= 6 ? "Uses five annual revenue intervals." : "Yahoo quote summary often returns fewer than six annual statement rows."),
    metricRow("EPS Growth", epsGrowth, formatMetric(epsGrowth), "20%+", metricStatus(epsGrowth, 20), "Uses current-year earnings growth estimate when available."),
    metricRow("FCF Growth", fcfGrowth, formatMetric(fcfGrowth), "20%+", metricStatus(fcfGrowth, 20), "Uses annual free-cash-flow change when Yahoo cash flow fields are available."),
    metricRow("Revenue / Share Growth", null, "Unavailable", "Positive and preferably 15%+", "unavailable", "Requires reliable historical share-count data; use SEC filings for final verification."),
    metricRow("Shares Outstanding Growth", null, "Unavailable", "Flat or falling preferred", "unavailable", "Yahoo quote summary does not provide a reliable 1/3/5-year share-count series here."),
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

function growthRiskScore(growthChecklist, technical, fundamentals, valuation, analysts, newsEngine, summary) {
  return estimateRiskComponents({
    growthChecklist,
    technical,
    fundamentals,
    valuation,
    analysts,
    newsEngine,
    summary,
  }).overallRisk;
}

async function buildPeerComparison(targetRow, peers) {
  const rows = await Promise.allSettled(peers.map(async (peer) => {
    const summary = await fetchQuoteSummary(peer, ["price", "summaryDetail", "defaultKeyStatistics", "financialData"]);
    const price = summary.price ?? {};
    const stats = summary.defaultKeyStatistics ?? {};
    const detail = summary.summaryDetail ?? {};
    const financial = summary.financialData ?? {};
    return {
      symbol: peer,
      name: price.shortName ?? peer,
      marketCap: raw(price.marketCap),
      revenueGrowth: round(raw(financial.revenueGrowth) * 100, 1),
      grossMargin: round(raw(financial.grossMargins) * 100, 1),
      operatingMargin: round(raw(financial.operatingMargins) * 100, 1),
      forwardPE: round(raw(stats.forwardPE), 1),
      ps: round(raw(stats.priceToSalesTrailing12Months), 2),
      evEbitda: round(raw(stats.enterpriseToEbitda), 1),
      trailingPE: round(raw(detail.trailingPE) ?? raw(stats.trailingPE), 1),
    };
  }));
  return [
    { ...targetRow, isTarget: true },
    ...rows.filter((row) => row.status === "fulfilled").map((row) => row.value),
  ];
}

export async function analyzeStock(symbolInput) {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");
  const benchmark = symbol.endsWith(".TO") || symbol.endsWith(".V") || symbol.endsWith(".NE") || symbol.endsWith(".CN") ? "XIU.TO" : "QQQ";
  const [rows, benchmarkRows, summary, newsItems, secFacts] = await Promise.all([
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
      "cashflowStatementHistory",
      "calendarEvents",
      "secFilings",
      "upgradeDowngradeHistory",
    ]),
    fetchYahooNews(symbol, 10).catch(() => []),
    fetchSecCompanyFacts(symbol).catch(() => null),
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
  const newsEngine = buildNewsEngine(newsItems, summary);
  const riskScore = growthRiskScore(growthChecklist, technical, fundamentals, valuation, analysts, newsEngine, summary);
  const reportScores = buildReportScores(growthChecklist, technical, fundamentals, valuation, analysts, riskScore, newsEngine);
  const report = buildBusinessReport(symbol, companyName, sector, industry, theme, summary, growthChecklist, technical, fundamentals, valuation, analysts, riskScore, newsEngine);
  const moat = moatScore(theme, fundamentals, valuation, technical, report);
  const hiddenMultibagger = buildHiddenMultibaggerHunter({ summary, growthChecklist, fundamentals, valuation, analysts, technical, moat, newsEngine, report, theme, sector, industry });
  const advisorChecks = buildAdvisorChecks(summary, fundamentals, valuation, analysts, technical, newsEngine);
  const kpiRows = buildKpiRows({ summary, growthChecklist, currentPrice: raw(price.regularMarketPrice) ?? technical.close, marketCap: raw(price.marketCap), fundamentals });
  const riskBreakdown = buildRiskBreakdown({ growthChecklist, valuation, fundamentals, technical, analysts, newsEngine, summary });
  const dataQuality = buildDataQuality({ summary, secFacts, growthChecklist });
  const peerComparison = await buildPeerComparison({
    symbol,
    name: companyName,
    marketCap: raw(price.marketCap),
    revenueGrowth: fundamentals.revenueGrowth,
    grossMargin: fundamentals.grossMargins,
    operatingMargin: fundamentals.operatingMargins,
    forwardPE: valuation.forwardPE,
    ps: valuation.priceToSales,
    evEbitda: valuation.enterpriseToEbitda,
    trailingPE: valuation.trailingPE,
  }, report.competitors ?? []);
  const investigateFurther = investigateFurtherLabel(reportScores, growthChecklist, technical, valuation, newsEngine);

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
    riskLevel: riskLevel(riskScore),
    growthPotential: reportScores.growthPotential,
    reportScores,
    kpiRows,
    riskBreakdown,
    dataQuality,
    peerComparison,
    report,
    moat,
    hiddenMultibagger,
    advisorChecks,
    newsEngine,
    investigateFurther,
    finalAction: investigateFurther,
    managerRead: `${decision}: ${symbol} scores ${totalScore}/100. Technicals are ${technical.rating.toLowerCase()}, fundamentals are ${fundamentals.rating.toLowerCase()}, valuation is ${valuation.rating.toLowerCase()}, and analyst sentiment is ${analysts.rating.toLowerCase()}.`,
    asOf: new Date().toISOString(),
  };
}
