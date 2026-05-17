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

const PEER_RULES = [
  {
    pattern: /(beverage|energy drink|non-alcoholic|soft drink|functional drink|consumer defensive)/i,
    groups: {
      directOperating: [["MNST", "Monster Beverage", "Energy drink operating peer."], ["PEP", "PepsiCo", "Beverage distribution and portfolio peer."], ["KDP", "Keurig Dr Pepper", "North American beverage peer."], ["FIZZ", "National Beverage", "Public beverage-brand peer."], ["VITA", "Vita Coco", "Functional beverage peer."]],
      publicValuation: [["MNST", "Monster Beverage", "Closest scaled energy-drink valuation peer."], ["KO", "Coca-Cola", "Global beverage franchise anchor."], ["PEP", "PepsiCo", "Global beverage/snack anchor."], ["KDP", "Keurig Dr Pepper", "Beverage portfolio comp."], ["FIZZ", "National Beverage", "Smaller beverage comp."]],
      adjacentStrategic: [["KO", "Coca-Cola", "Strategic distribution and brand benchmark."], ["PEP", "PepsiCo", "Distribution and shelf-space benchmark."], [null, "Red Bull", "Private energy-drink leader; strategic context only."], [null, "Ghost / Alani Nu / Rockstar", "Private or portfolio brands; category context only."]],
    },
  },
  {
    pattern: /(semiconductor|chip|gpu|processor)/i,
    groups: {
      directOperating: [["NVDA", "NVIDIA", "Accelerated compute leader."], ["AMD", "Advanced Micro Devices", "CPU/GPU peer."], ["AVGO", "Broadcom", "Diversified semiconductor peer."]],
      publicValuation: [["NVDA", "NVIDIA", "Premium AI semiconductor multiple."], ["AVGO", "Broadcom", "Quality semiconductor comp."], ["QCOM", "Qualcomm", "Semiconductor valuation comp."]],
      adjacentStrategic: [["TSM", "Taiwan Semiconductor", "Foundry benchmark."], ["ASML", "ASML", "Equipment constraint benchmark."], ["INTC", "Intel", "Legacy CPU/foundry contrast."]],
    },
  },
  {
    // Fintech / consumer lending / digital banking — must be BEFORE generic software rule
    // Matches Financial Services companies: credit services, lending, digital banking
    // blockedSectors prevents accidental matches from tech/software companies
    sectorIndustryMatch: (s, i) =>
      i.includes("credit services") || i.includes("consumer finance") ||
      i.includes("mortgage finance") || i.includes("financial") && s.includes("financial"),
    pattern: /(credit services|consumer finance|digital bank|neobank|consumer lending|personal loan|student loan|installment loan|buy.now.pay.later|bnpl|fintech.*lend|lend.*platform|online.*bank|bank.*digital)/i,
    groups: {
      directOperating: [
        ["LC",   "LendingClub",       "Digital consumer lending — direct overlap in personal loans and bank charter."],
        ["UPST", "Upstart",           "AI-based consumer lending peer — similar origination model and credit risk."],
        ["AFRM", "Affirm",            "Installment/BNPL lending peer — consumer credit overlap."],
        ["ALLY", "Ally Financial",    "Digital banking and auto/consumer finance peer — deposit-funded model."],
        ["COF",  "Capital One",       "Digital-first consumer lending and banking — scale and product overlap."],
      ],
      publicValuation: [
        ["ALLY", "Ally Financial",    "Digital banking valuation anchor — deposit-funded consumer lender."],
        ["COF",  "Capital One",       "Consumer credit valuation comp — scale and digital product mix."],
        ["SYF",  "Synchrony Financial", "Consumer credit card / lending valuation comp."],
        ["LC",   "LendingClub",       "Digital lending multiple comp — bank-charter fintech."],
        ["UPST", "Upstart",           "AI lending growth multiple comp — high-beta fintech."],
      ],
      adjacentStrategic: [
        ["SQ",   "Block",             "Fintech payments and consumer financial services adjacency."],
        ["PYPL", "PayPal",            "Digital payments and buy-now-pay-later adjacency."],
        ["HOOD", "Robinhood",         "Digital brokerage / consumer fintech platform adjacency."],
        ["MQ",   "Marqeta",           "Card-issuing platform adjacency (comparable to Galileo segment)."],
        ["FI",   "Fiserv",            "Financial infrastructure and core banking technology adjacency."],
      ],
    },
  },
  {
    // Traditional banking and capital markets
    pattern: /(diversified bank|regional bank|investment bank|capital markets|asset management|wealth management)/i,
    groups: {
      directOperating: [["JPM", "JPMorgan Chase", "Scaled diversified banking peer."], ["BAC", "Bank of America", "Large U.S. bank peer."], ["C", "Citigroup", "Global bank peer."]],
      publicValuation: [["JPM", "JPMorgan Chase", "Quality large-cap bank anchor."], ["GS", "Goldman Sachs", "Capital-markets comp."], ["MS", "Morgan Stanley", "Capital-markets/wealth comp."]],
      adjacentStrategic: [["V", "Visa", "Payments infrastructure adjacency."], ["MA", "Mastercard", "Payments infrastructure adjacency."], ["PYPL", "PayPal", "Digital payments contrast."]],
    },
  },
  {
    // Generic financial / fintech fallback (catches remaining financial sector patterns)
    // blockedSectors ensures software companies don't hit this rule
    pattern: /(bank|credit|financial|capital markets|fintech|payments|insurance|lending)/i,
    blockedSectors: ["technology", "communication services", "consumer"],
    groups: {
      directOperating: [["JPM", "JPMorgan Chase", "Scaled banking/financial peer."], ["BAC", "Bank of America", "Large bank peer."], ["C", "Citigroup", "Global bank peer."]],
      publicValuation: [["JPM", "JPMorgan Chase", "Quality bank anchor."], ["GS", "Goldman Sachs", "Capital-markets comp."], ["MS", "Morgan Stanley", "Capital-markets/wealth comp."]],
      adjacentStrategic: [["V", "Visa", "Payments adjacency."], ["MA", "Mastercard", "Payments adjacency."], ["PYPL", "PayPal", "Digital payments contrast."]],
    },
  },
  {
    // Software / cloud / SaaS — blockedSectors prevents Financial Services companies
    // from matching due to words like "platform" or "data" in their descriptions
    pattern: /(software|application|cloud|saas|internet platform|cybersecurity|enterprise software)/i,
    blockedSectors: ["financial services", "financials", "insurance", "real estate"],
    groups: {
      directOperating: [["MSFT", "Microsoft", "Software/cloud platform peer."], ["ORCL", "Oracle", "Enterprise software/cloud peer."], ["CRM", "Salesforce", "Application software peer."]],
      publicValuation: [["MSFT", "Microsoft", "Mega-cap software anchor."], ["ADBE", "Adobe", "High-margin software comp."], ["NOW", "ServiceNow", "Premium workflow software comp."]],
      adjacentStrategic: [["GOOGL", "Alphabet", "Cloud/AI/ads adjacency."], ["AMZN", "Amazon", "AWS/platform adjacency."], ["META", "Meta Platforms", "AI platform adjacency."]],
    },
  },
  {
    pattern: /(auto|vehicle|ev|automaker)/i,
    groups: {
      directOperating: [["TSLA", "Tesla", "EV operating peer."], ["GM", "General Motors", "Legacy automaker peer."], ["F", "Ford", "Legacy automaker peer."]],
      publicValuation: [["TSLA", "Tesla", "EV valuation anchor."], ["TM", "Toyota", "Global auto anchor."], ["GM", "General Motors", "U.S. auto comp."]],
      adjacentStrategic: [["RIVN", "Rivian", "EV challenger."], ["LCID", "Lucid", "EV challenger."], ["UBER", "Uber", "Mobility adjacency."]],
    },
  },
  {
    pattern: /(retail|marketplace|e-commerce|consumer cyclical|apparel)/i,
    groups: {
      directOperating: [["AMZN", "Amazon", "Marketplace/e-commerce peer."], ["WMT", "Walmart", "Retail scale peer."], ["TGT", "Target", "U.S. retail peer."]],
      publicValuation: [["COST", "Costco", "Premium retail anchor."], ["WMT", "Walmart", "Scaled retail comp."], ["AMZN", "Amazon", "Marketplace/platform comp."]],
      adjacentStrategic: [["SHOP", "Shopify", "Merchant platform adjacency."], ["MELI", "MercadoLibre", "Marketplace/fintech adjacency."], ["BABA", "Alibaba", "Global marketplace contrast."]],
    },
  },
  {
    pattern: /(media|streaming|entertainment|advertising)/i,
    groups: {
      directOperating: [["NFLX", "Netflix", "Streaming peer."], ["DIS", "Disney", "Media/streaming peer."], ["WBD", "Warner Bros. Discovery", "Media peer."]],
      publicValuation: [["NFLX", "Netflix", "Streaming valuation anchor."], ["DIS", "Disney", "Diversified media comp."], ["META", "Meta Platforms", "Advertising platform comp."]],
      adjacentStrategic: [["GOOGL", "Alphabet", "Digital ads/video adjacency."], ["AMZN", "Amazon", "Prime Video/ads adjacency."], ["SPOT", "Spotify", "Subscription media adjacency."]],
    },
  },
  {
    pattern: /(energy|oil|gas|exploration|integrated oil)/i,
    groups: {
      directOperating: [["XOM", "Exxon Mobil", "Integrated energy peer."], ["CVX", "Chevron", "Integrated energy peer."], ["COP", "ConocoPhillips", "E&P peer."]],
      publicValuation: [["XOM", "Exxon Mobil", "Quality energy anchor."], ["CVX", "Chevron", "Integrated energy anchor."], ["EOG", "EOG Resources", "E&P valuation comp."]],
      adjacentStrategic: [["SLB", "SLB", "Oilfield services adjacency."], ["LNG", "Cheniere", "LNG adjacency."], ["OXY", "Occidental", "E&P/chemicals adjacency."]],
    },
  },
];

function peerGroupsForCompany(sector, industry, symbol, companyName = "", profileSummary = "") {
  const text = `${sector ?? ""} ${industry ?? ""} ${companyName ?? ""} ${profileSummary ?? ""}`.toLowerCase();
  const sectorLC   = (sector   ?? "").toLowerCase();
  const industryLC = (industry ?? "").toLowerCase();

  const rule = PEER_RULES.find((item) => {
    // Sector+industry exact match overrides keyword matching entirely
    if (item.sectorIndustryMatch && item.sectorIndustryMatch(sectorLC, industryLC)) return true;
    // Skip if this rule is blocked for this company's sector
    if (item.blockedSectors && item.blockedSectors.some((s) => sectorLC.includes(s))) return false;
    // Keyword match against full text
    return item.pattern.test(text);
  });
  const groups = rule?.groups ?? {
    directOperating: [["SPY", "S&P 500 ETF", "Broad market benchmark until industry peers are validated."], ["QQQ", "Nasdaq 100 ETF", "Growth benchmark until industry peers are validated."], ["IWM", "Russell 2000 ETF", "Small/mid-cap benchmark until industry peers are validated."]],
    publicValuation: [["SPY", "S&P 500 ETF", "Market multiple anchor."], ["QQQ", "Nasdaq 100 ETF", "Growth multiple anchor."], ["IWM", "Russell 2000 ETF", "Small/mid-cap multiple anchor."]],
    adjacentStrategic: [],
  };
  const normalize = ([peerSymbol, name, reason]) => ({ symbol: peerSymbol, name, reason, isPublic: Boolean(peerSymbol) });
  const exclude = String(symbol ?? "").toUpperCase();
  return {
    directOperating: groups.directOperating.map(normalize).filter((peer) => peer.symbol !== exclude),
    publicValuation: groups.publicValuation.map(normalize).filter((peer) => peer.symbol !== exclude),
    adjacentStrategic: groups.adjacentStrategic.map(normalize).filter((peer) => peer.symbol !== exclude),
  };
}

function competitorSet(sector, industry, symbol) {
  const groups = peerGroupsForCompany(sector, industry, symbol);
  return [
    ...groups.directOperating,
    ...groups.publicValuation,
  ].map((peer) => peer.symbol).filter(Boolean).filter((item, index, rows) => rows.indexOf(item) === index).slice(0, 5);
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
  const financial = summary?.financialData ?? {};
  const earningsTrend = summary?.earningsTrend?.trend ?? [];
  const earningsHistory = summary?.earningsHistory?.history ?? [];
  const calendarEvents = summary?.calendarEvents ?? {};
  const nextEarningsRaw = calendarEvents?.earnings?.earningsDate?.[0]?.raw;
  const daysUntilEarnings = nextEarningsRaw ? Math.ceil((nextEarningsRaw * 1000 - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const earningsProximate = Number.isFinite(daysUntilEarnings) && daysUntilEarnings >= 0 && daysUntilEarnings <= 10;
  const beatCount = earningsHistory.filter((e) => (raw(e.epsDifference) ?? 0) > 0).length;
  const beatRate = earningsHistory.length > 0 ? (beatCount / earningsHistory.length) * 100 : null;

  let earningsRisk = 40;
  if (earningsProximate) earningsRisk += 35;
  else if (Number.isFinite(daysUntilEarnings) && daysUntilEarnings <= 20 && daysUntilEarnings >= 0) earningsRisk += 18;
  if (beatRate !== null && beatRate < 40) earningsRisk += 18;
  else if (beatRate !== null && beatRate >= 80) earningsRisk -= 12;
  earningsRisk = clamp(Math.round(earningsRisk));
  const earningsRiskNote = earningsProximate
    ? `Earnings within ${daysUntilEarnings} days — elevated binary risk.`
    : Number.isFinite(daysUntilEarnings) && daysUntilEarnings >= 0
      ? `${daysUntilEarnings} days to earnings. Beat rate: ${beatRate !== null ? Math.round(beatRate) + "%" : "unavailable"}.`
      : `Beat rate: ${beatRate !== null ? Math.round(beatRate) + "%" : "unavailable"}. Calendar date unavailable.`;

  const gm = fundamentals.grossMargins ?? 0;
  const om = fundamentals.operatingMargins ?? 0;
  let marginRisk = 38;
  if (gm < 15) marginRisk += 28;
  else if (gm < 30) marginRisk += 14;
  else if (gm > 55) marginRisk -= 15;
  if (om < 0) marginRisk += 22;
  else if (om < 5) marginRisk += 12;
  else if (om > 20) marginRisk -= 12;
  marginRisk = clamp(Math.round(marginRisk));
  const marginRiskNote = om < 0 ? "Operating loss — margin improvement is required for the thesis" : gm > 50 ? "High gross margins reduce margin compression risk" : "Monitor gross and operating margin trends in quarterly filings";

  const downsideRisk = clamp(Math.round(
    components.valuationRisk * 0.28 + earningsRisk * 0.20 + components.balanceSheetRisk * 0.20 +
    (100 - (fundamentals.score ?? 35)) * 0.17 + components.technicalRisk * 0.15
  ));

  return [
    { label: "Valuation risk", score: components.valuationRisk, note: `${valuation.rating}. Quality can offset some premium, but not remove it.` },
    { label: "Earnings risk", score: earningsRisk, note: earningsRiskNote },
    { label: "Margin compression risk", score: marginRisk, note: marginRiskNote },
    { label: "Balance sheet risk", score: components.balanceSheetRisk, note: fundamentals.totalDebt > fundamentals.totalCash ? "Debt exceeds cash — monitor leverage" : "Debt/cash looks manageable at current levels" },
    { label: "Dilution risk", score: components.dilutionRisk, note: dilutionRow?.display || "Share trend unavailable; treated as neutral, not automatically high risk" },
    { label: "Execution risk", score: components.executionRisk, note: "Revenue growth, margin, FCF, ROE, and ROA delivery risk vs. expectations" },
    { label: "Competition risk", score: components.competitionRisk, note: gm < 20 ? "Low margins indicate pricing pressure from competition" : "Margins and scale reduce near-term competitive risk" },
    { label: "Technical breakdown risk", score: components.technicalRisk, note: `Chart trend: ${technical.rating}. A break below key support invalidates short-term thesis.` },
    { label: "Regulatory / news risk", score: components.regulatoryNewsRisk, note: newsEngine?.tone || "Normal tape — monitor news for sector-specific regulatory changes" },
    { label: "Overall downside risk", score: downsideRisk, note: "Composite downside score: valuation + earnings + balance sheet + business quality + technical." },
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
  const peerGroups = peerGroupsForCompany(sector, industry, symbol, companyName, profileSummary);
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
    peerGroups,
    peerValidation: "Peers are selected from industry-specific rule sets. Adjacent strategic peers are labeled separately and should not be treated as direct operating comps.",
    competitors: [
      ...peerGroups.directOperating,
      ...peerGroups.publicValuation,
    ].map((peer) => peer.symbol).filter(Boolean).filter((item, index, rows) => rows.indexOf(item) === index).slice(0, 5),
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

// ─────────────────────────────────────────────────────────────────────────────
// SENIOR STOCK ANALYZER — Institutional-grade analysis layer
// ─────────────────────────────────────────────────────────────────────────────

function build5YearFinancialTable(summary) {
  const income = (summary.incomeStatementHistory?.incomeStatementHistory ?? [])
    .map((item) => ({
      date: item.endDate?.fmt,
      revenue: raw(item.totalRevenue),
      grossProfit: raw(item.grossProfit),
      operatingIncome: raw(item.operatingIncome),
      netIncome: raw(item.netIncome),
      ebitda: raw(item.ebitda),
      basicEPS: raw(item.basicEps),
      dilutedEPS: raw(item.dilutedEps),
    }))
    .filter((item) => Number.isFinite(item.revenue))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const cashflow = (summary.cashflowStatementHistory?.cashflowStatements ?? [])
    .map((item) => ({
      date: item.endDate?.fmt,
      operatingCF: raw(item.totalCashFromOperatingActivities),
      capex: raw(item.capitalExpenditures),
      fcf: raw(item.freeCashFlow) ??
        (Number.isFinite(raw(item.totalCashFromOperatingActivities)) && Number.isFinite(raw(item.capitalExpenditures))
          ? raw(item.totalCashFromOperatingActivities) + raw(item.capitalExpenditures)
          : null),
    }))
    .filter((item) => Number.isFinite(item.operatingCF))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const price = summary.price ?? {};

  const rows = income.map((inc, idx) => {
    const cf = cashflow.find((item) => item.date === inc.date) ?? cashflow[idx] ?? {};
    const prev = income[idx - 1];
    const revenueGrowth = prev?.revenue ? round(((inc.revenue - prev.revenue) / prev.revenue) * 100, 1) : null;
    const grossMarginPct = inc.revenue && inc.grossProfit ? round((inc.grossProfit / inc.revenue) * 100, 1) : null;
    const opMarginPct = inc.revenue && Number.isFinite(inc.operatingIncome) ? round((inc.operatingIncome / inc.revenue) * 100, 1) : null;
    const netMarginPct = inc.revenue && Number.isFinite(inc.netIncome) ? round((inc.netIncome / inc.revenue) * 100, 1) : null;
    const ebitdaMarginPct = inc.revenue && Number.isFinite(inc.ebitda) ? round((inc.ebitda / inc.revenue) * 100, 1) : null;
    const fcfMarginPct = inc.revenue && Number.isFinite(cf.fcf) ? round((cf.fcf / inc.revenue) * 100, 1) : null;
    return {
      year: inc.date,
      revenue: inc.revenue,
      revenueGrowth,
      grossProfit: inc.grossProfit,
      grossMargin: grossMarginPct,
      operatingIncome: inc.operatingIncome,
      operatingMargin: opMarginPct,
      ebitda: inc.ebitda,
      ebitdaMargin: ebitdaMarginPct,
      netIncome: inc.netIncome,
      netMargin: netMarginPct,
      eps: inc.dilutedEPS ?? inc.basicEPS,
      fcf: cf.fcf ?? null,
      fcfMargin: fcfMarginPct,
      capex: cf.capex ?? null,
    };
  });

  const revGrowthRates = rows.slice(1).map((r) => r.revenueGrowth).filter((v) => v !== null);
  const allRevPositive = revGrowthRates.length > 0 && revGrowthRates.every((r) => r > 0);
  const recentAccel = revGrowthRates.length >= 2 && revGrowthRates.at(-1) > revGrowthRates.at(-2);
  const latest = rows.at(-1);
  const oldest = rows[0];

  const narrativePoints = [];
  if (allRevPositive) narrativePoints.push("Revenue has grown consistently across all reported annual periods");
  else if (revGrowthRates.some((r) => r > 0)) narrativePoints.push("Revenue growth has been mixed — some years showed declines or flattening");
  else narrativePoints.push("Revenue has been declining or stagnant");
  if (recentAccel) narrativePoints.push("growth appears to be accelerating in recent periods");
  else if (revGrowthRates.length >= 2) narrativePoints.push("the growth rate appears to be decelerating or stable");
  if (latest?.grossMargin && oldest?.grossMargin) {
    const diff = (latest.grossMargin ?? 0) - (oldest.grossMargin ?? 0);
    if (diff > 3) narrativePoints.push("gross margins are expanding — a positive sign of pricing power or scale");
    else if (diff < -3) narrativePoints.push("gross margins have compressed — watch for competitive pressure");
    else narrativePoints.push("gross margins are relatively stable");
  }
  const fcfRows = rows.filter((r) => r.fcf !== null);
  if (fcfRows.length >= 2) {
    if (fcfRows.every((r) => r.fcf > 0)) narrativePoints.push("free cash flow has been consistently positive — a key quality signal");
    else if ((fcfRows.at(-1)?.fcf ?? 0) > 0 && (fcfRows.at(-2)?.fcf ?? 0) <= 0) narrativePoints.push("the company recently turned FCF positive — an improving trajectory");
    else if ((fcfRows.at(-1)?.fcf ?? 0) < 0) narrativePoints.push("the company is still FCF negative — a risk factor to monitor");
  }

  const currentRevenue = raw(financial.totalRevenue);
  const currentFCF = raw(financial.freeCashflow);
  const currentCash = raw(financial.totalCash);
  const currentDebt = raw(financial.totalDebt);
  const currentROE = pctRaw(financial.returnOnEquity);
  const currentROA = pctRaw(financial.returnOnAssets);
  const rev3CAGR = income.length >= 4 ? round((cagr(income.at(-4)?.revenue, income.at(-1)?.revenue, 3) ?? 0) * 100, 1) : null;
  const rev5CAGR = income.length >= 6 ? round((cagr(income.at(-6)?.revenue, income.at(-1)?.revenue, 5) ?? 0) * 100, 1) : null;

  return {
    rows,
    rev3CAGR,
    rev5CAGR,
    currentRevenue,
    currentFCF,
    currentCash,
    currentDebt,
    netCash: Number.isFinite(currentCash) && Number.isFinite(currentDebt) ? currentCash - currentDebt : null,
    currentROE: round(currentROE, 1),
    currentROA: round(currentROA, 1),
    narrative: narrativePoints.join(". ") + ".",
  };
}

function buildEnhancedTechnicalPlan(technical, summary) {
  const detail = summary?.summaryDetail ?? {};
  const close  = technical.close;
  const ema20  = technical.ema20;
  const ema50  = technical.ema50;
  const ema150 = technical.ema150;
  const atr14  = technical.atr14;
  const high55 = technical.high55;
  const rsi14  = technical.rsi14;
  const high52w = raw(detail.fiftyTwoWeekHigh);
  const low52w  = raw(detail.fiftyTwoWeekLow);

  if (!Number.isFinite(close) || !Number.isFinite(atr14) || atr14 <= 0) {
    return { available: false };
  }

  // ── 1. Technical Trend ───────────────────────────────────────────────────
  let technicalTrend;
  const hasMAs = Number.isFinite(ema20) && Number.isFinite(ema50) && Number.isFinite(ema150);
  if (hasMAs) {
    if (close > ema20 && ema20 > ema50 && ema50 > ema150)  technicalTrend = "Bullish";
    else if (close > ema50 && ema50 > ema150)              technicalTrend = "Neutral";
    else if (close > ema150 && close < ema50)              technicalTrend = "Weakening";
    else                                                    technicalTrend = "Bearish";
  } else if (Number.isFinite(ema50)) {
    technicalTrend = close > ema50 ? "Neutral" : "Bearish";
  } else {
    technicalTrend = "Data limited";
  }
  const isBearishTrend = technicalTrend === "Bearish" || technicalTrend === "Weakening";

  // ── 2. Entry Timing ──────────────────────────────────────────────────────
  let entryTiming;
  if (technicalTrend === "Bearish") {
    entryTiming = "Wait for trend repair";
  } else if (technicalTrend === "Weakening") {
    entryTiming = "DCA only — wait for trend repair";
  } else if (rsi14 > 75 || (Number.isFinite(high55) && close > high55 * 1.10)) {
    entryTiming = "Avoid chasing";
  } else if (Number.isFinite(ema50) && close >= ema50 * 0.97 && close <= ema50 * 1.03) {
    entryTiming = "Attractive now";
  } else if (Number.isFinite(ema20) && close >= ema20 * 0.98 && close <= ema20 * 1.02) {
    entryTiming = "Attractive now";
  } else if (Number.isFinite(high55) && close > high55) {
    entryTiming = "Wait for breakout confirmation";
  } else {
    entryTiming = "Good for DCA only";
  }

  // ── 3. Classify each MA — support only if BELOW current price ───────────
  const masBelow = [ema20, ema50, ema150]
    .filter((ma) => Number.isFinite(ma) && ma < close)
    .sort((a, b) => b - a); // nearest below first (descending)
  const masAbove = [ema20, ema50, ema150]
    .filter((ma) => Number.isFinite(ma) && ma > close)
    .sort((a, b) => a - b); // nearest above first (ascending)

  const ema20Label  = Number.isFinite(ema20)  ? (ema20  < close ? "support"       : "resistance / reclaim") : null;
  const ema50Label  = Number.isFinite(ema50)  ? (ema50  < close ? "support"       : "resistance / reclaim") : null;
  const ema150Label = Number.isFinite(ema150) ? (ema150 < close ? "major support" : "resistance / reclaim") : null;

  // ── 4. Support: build ONLY from levels that are below current price ──────
  //
  // Priority: MAs below price (nearest first), then 52-week low (if below price), then ATR fallback.
  // We sort ALL candidates together by proximity to price (nearest first), then pick top-2.
  //
  const supportCandidates = [
    ...masBelow,
    (Number.isFinite(low52w) && low52w < close) ? low52w : null,
    close - 1.5 * atr14,
  ].filter((v) => Number.isFinite(v) && v < close);
  supportCandidates.sort((a, b) => b - a); // nearest to current price first

  let supportLevel      = round(supportCandidates[0] ?? close - atr14);
  let majorSupportLevel = round(supportCandidates[1] ?? close - 3 * atr14);

  // Push majorSupport lower if it is too close to support (within 0.5 ATR)
  if (majorSupportLevel >= supportLevel - 0.5 * atr14) {
    majorSupportLevel = round(supportLevel - atr14);
  }
  // Hard guards — both MUST be strictly below close
  if (supportLevel      >= close) supportLevel      = round(close - atr14);
  if (majorSupportLevel >= close) majorSupportLevel = round(close - 2 * atr14);
  if (majorSupportLevel >= supportLevel) majorSupportLevel = round(supportLevel - atr14);

  // ── 5. Resistance: only levels ABOVE current price ──────────────────────
  let resistanceLevel = masAbove.length > 0
    ? round(masAbove[0])
    : (Number.isFinite(high55) && high55 > close ? round(high55 * 1.005) : round(close * 1.08));

  let majorResistanceLevel = masAbove.length > 1
    ? round(masAbove[masAbove.length - 1])
    : (Number.isFinite(high52w) && high52w > close * 1.05 ? round(high52w) : round(resistanceLevel * 1.15));

  // Hard guards — both MUST be strictly above close
  if (resistanceLevel      <= close)             resistanceLevel      = round(close + atr14);
  if (majorResistanceLevel <= resistanceLevel)   majorResistanceLevel = round(resistanceLevel + 2 * atr14);

  // ── 6. Trend repair levels ───────────────────────────────────────────────
  const trendRepairAbove   = masAbove.length > 0 ? round(masAbove[0])    : null;
  const strongConfirmAbove = masAbove.length > 1 ? round(masAbove[1])
    : trendRepairAbove !== null ? round(trendRepairAbove * 1.05) : null;

  // ── 7. Invalidation: below nearest support, always < close ──────────────
  // Use 0.75× ATR below the nearest support level as the invalidation.
  // Hard caps: never more than 10% below close, always at least 1 ATR below close.
  const invalidationBelow = round(
    Math.min(
      supportLevel - 0.75 * atr14, // primary: just below nearest real support
      close * 0.90,                 // max 10% drawdown cap
      close - atr14                 // at least 1 ATR of breathing room
    )
  );

  // ── 8. Risk amount (always positive) ────────────────────────────────────
  const riskAmt = close - invalidationBelow; // guaranteed > 0

  // ── 9. Buy zones ─────────────────────────────────────────────────────────
  // Bearish/Weakening: DCA zone = [nearest support, just above current price]
  //   This is the "accumulate in tranches" zone when thesis is intact but trend is down.
  // Bullish/Neutral: DCA zone is near the support MA below price.
  let idealBuyZoneLow, idealBuyZoneHigh, dcaZoneLow, dcaZoneHigh;
  if (isBearishTrend) {
    idealBuyZoneLow  = round(supportLevel * 0.99);
    idealBuyZoneHigh = round(Math.min(close * 1.005, resistanceLevel - 0.01));
    dcaZoneLow       = round(supportLevel);
    dcaZoneHigh      = round(Math.min(close * 1.01, resistanceLevel - 0.01));
  } else {
    const idealHighRaw = Math.min(close * 1.005, resistanceLevel - 0.01);
    const idealLowRaw  = Math.max(supportLevel * 0.98, invalidationBelow * 1.10);
    idealBuyZoneHigh   = round(idealHighRaw);
    idealBuyZoneLow    = round(Math.min(idealLowRaw, idealHighRaw - 0.01));
    dcaZoneHigh = round(Math.min(supportLevel * 1.01, idealBuyZoneLow - 0.01));
    dcaZoneLow  = round(Math.max(majorSupportLevel * 0.99, invalidationBelow * 1.08));
    if (dcaZoneLow >= dcaZoneHigh) dcaZoneLow = round(dcaZoneHigh - atr14);
  }
  const pullbackBuyZoneLow  = round(close * 0.93);
  const pullbackBuyZoneHigh = round(close * 0.97);

  // ── 10. TP1 / TP2: MUST be above current price ──────────────────────────
  // Bearish/Weakening: TPs are INACTIVE — shown as reclaim benchmarks only.
  //   tp1 = nearest resistance (first MA to reclaim)
  //   tp2 = major resistance (extended recovery target)
  // Bullish/Neutral: active risk-reward targets above entry.
  let tp1, tp2, tp1Active, tp2Active;
  if (isBearishTrend) {
    tp1 = resistanceLevel;
    tp2 = majorResistanceLevel;
    tp1Active = false;
    tp2Active = false;
  } else {
    tp1 = round(close + riskAmt * 1.5);
    tp2 = round(close + riskAmt * 3.0);
    tp1Active = true;
    tp2Active = true;
  }
  // Hard safety — TPs must always be above close (even if labelled inactive)
  if (tp1 <= close) tp1 = round(close + atr14 * 1.5);
  if (tp2 <= tp1)   tp2 = round(tp1  + atr14 * 2.5);

  const longTermBullCase = (Number.isFinite(high52w) && high52w > close * 1.15)
    ? round(high52w * 1.10)
    : round(close * 2.5);

  // ── 11. Risk/Reward ──────────────────────────────────────────────────────
  // Only meaningful for confirmed bullish/neutral setups.
  let riskReward = "No clean long setup yet";
  let noCleanEntry = true;
  if (!isBearishTrend && riskAmt > 0) {
    const rrRatio = round((tp1 - close) / riskAmt, 1);
    if (rrRatio > 0) { riskReward = `${rrRatio}:1`; noCleanEntry = false; }
  }

  // ── 12. Breakout confirmation ────────────────────────────────────────────
  const breakoutBuyAbove = (Number.isFinite(high55) && high55 > close)
    ? round(high55 * 1.005)
    : round(resistanceLevel * 1.005);

  return {
    available: true,
    currentPrice:        round(close),
    idealBuyZoneLow,
    idealBuyZoneHigh,
    dcaZoneLow,
    dcaZoneHigh,
    breakoutBuyAbove,
    pullbackBuyZoneLow,
    pullbackBuyZoneHigh,
    trendRepairAbove,
    strongConfirmAbove,
    supportLevel,
    majorSupportLevel,
    resistanceLevel,
    majorResistanceLevel,
    invalidationBelow,
    tp1,
    tp2,
    tp1Active,
    tp2Active,
    longTermBullCase,
    riskReward,
    noCleanEntry,
    technicalTrend,
    entryTiming,
    ema20:  round(ema20),  ema20Label,
    ema50:  round(ema50),  ema50Label,
    ema150: round(ema150), ema150Label,
    rsi14:  technical.rsi14,
    atr14:  round(atr14),
    adx14:  technical.adx14,
    high52w: round(high52w),
    low52w:  round(low52w),
    pctFrom52wHigh: Number.isFinite(high52w) && high52w > 0 ? round(((close - high52w) / high52w) * 100, 1) : null,
    relativeStrength60: technical.relativeStrength60,
    macdHistogram: null,
    volume:  null,
    reasons: technical.reasons ?? [],
    risks:   technical.risks   ?? [],
  };
}

function buildEarningsWatchList(symbol, theme) {
  const watchLists = {
    NVDA: ["Data center revenue and growth rate", "Blackwell GPU demand/ramp status", "Gross margin trajectory", "Hyperscaler capex commentary", "China/export restriction impact"],
    AAPL: ["iPhone unit demand and ASP", "Services revenue growth and margin", "Gross margin trend", "China market exposure", "AI integration/monetization progress"],
    MSFT: ["Azure cloud growth rate", "Copilot/AI revenue monetization", "Operating margin", "Capex guidance and AI infrastructure", "Enterprise spending environment"],
    AMZN: ["AWS revenue growth and margin", "Retail segment operating margin", "Advertising revenue growth", "AI/Bedrock services monetization", "Capex and data center investment"],
    META: ["Daily/monthly active users and engagement", "Ad pricing and ARPU", "AI spending and capex trajectory", "Reality Labs losses trend", "Regulatory risk update"],
    GOOGL: ["Search revenue vs AI disruption risk", "YouTube ad revenue growth", "Google Cloud growth and margin", "AI monetization in products", "Regulatory/antitrust developments"],
    TSLA: ["Vehicle delivery numbers vs expectations", "Auto gross margin trajectory", "Energy storage segment growth", "FSD/Robotaxi progress and timelines", "China competition and market share"],
    AMAT: ["WFE (equipment spending) outlook", "Orders vs shipments trend", "China revenue as % of total", "AI-driven node complexity demand", "New node customer adoption"],
    APP: ["Software platform revenue growth", "EBITDA margin expansion", "Advertiser demand and retention", "Privacy/ecosystem dependency risk", "International expansion"],
    SHOP: ["Gross merchandise value growth", "Subscription vs merchant solutions mix", "Operating margin trajectory", "International expansion progress", "AI tools adoption"],
  };
  if (watchLists[symbol]) return watchLists[symbol];
  const themeStr = String(theme ?? "").toLowerCase();
  if (themeStr.includes("semiconductor")) return ["Equipment/chip demand trajectory", "Gross margin", "China/export compliance", "AI-driven demand", "Next-gen product ramp"];
  if (themeStr.includes("software") || themeStr.includes("cloud")) return ["ARR/NRR growth rate", "Gross margin", "Operating leverage trend", "AI product monetization", "Guidance vs consensus"];
  if (themeStr.includes("financial")) return ["Net interest margin", "Loan growth", "Credit quality/charge-offs", "Expense discipline", "Capital adequacy"];
  if (themeStr.includes("consumer")) return ["Same-store sales/volume", "Gross margin", "Unit economics", "Consumer spending environment", "Inventory management"];
  if (themeStr.includes("healthcare") || themeStr.includes("biotech")) return ["Pipeline milestones/approvals", "Revenue growth vs guidance", "Gross margin", "R&D spend efficiency", "Competitive landscape"];
  return ["Revenue growth vs consensus", "Gross and operating margin trends", "Free cash flow generation", "Forward guidance changes", "Management commentary on demand environment"];
}

function buildEarningsAnalysis(summary, newsEngine, symbol, theme) {
  const calendar = summary.calendarEvents ?? {};
  const earningsEvent = calendar.earnings ?? {};
  const earningsTrend = summary.earningsTrend?.trend ?? [];
  const earningsHistory = summary.earningsHistory?.history ?? [];
  const financial = summary.financialData ?? {};

  const nextEarningsDates = earningsEvent.earningsDate ?? [];
  const nextEarningsDate = nextEarningsDates[0]?.fmt ?? null;
  const nextEarningsConfirmed = Boolean(nextEarningsDate);

  let daysUntilEarnings = null;
  if (nextEarningsDate) {
    const diff = new Date(nextEarningsDate).getTime() - Date.now();
    daysUntilEarnings = Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  const lastQTrend = earningsTrend.find((t) => t.period === "-1q") ?? earningsTrend.find((t) => t.period === "0q");
  const currentQTrend = earningsTrend.find((t) => t.period === "0q");

  const lastEarningsEntry = earningsHistory.at(-1);
  const lastEarningsDate = lastEarningsEntry?.quarter?.fmt ?? null;
  const epsActual = raw(lastEarningsEntry?.epsActual);
  const epsEstimate = raw(lastEarningsEntry?.epsEstimate);
  const epsDiff = raw(lastEarningsEntry?.epsDifference);
  const epsSurprisePct = raw(lastEarningsEntry?.surprisePercent);

  let epsVsExpectations = "Data unavailable from Yahoo";
  if (Number.isFinite(epsDiff)) {
    epsVsExpectations = epsDiff > 0 ? `Beat by $${round(Math.abs(epsDiff), 2)}` : `Missed by $${round(Math.abs(epsDiff), 2)}`;
  }

  const lastRevenue = raw(financial.totalRevenue);
  const revEstimate = raw(lastQTrend?.revenueEstimate?.avg);
  let revVsExpectations = "Unavailable from Yahoo structured data";
  let revenueBeatPct = null;
  if (Number.isFinite(lastRevenue) && Number.isFinite(revEstimate) && revEstimate > 0) {
    revenueBeatPct = ((lastRevenue - revEstimate) / revEstimate) * 100;
    revVsExpectations = revenueBeatPct >= 0 ? `Beat by approximately ${round(revenueBeatPct, 1)}%` : `Missed by approximately ${round(Math.abs(revenueBeatPct), 1)}%`;
  }

  const revenueBeatSanityFlag = Number.isFinite(revenueBeatPct) && Math.abs(revenueBeatPct) > 50
    ? "Needs verification — beat/miss appears abnormally large. Possible unit mismatch (annual vs quarterly) or data error. Cross-check with company IR filing."
    : null;

  const revenueGrowth = raw(financial.revenueGrowth);
  let guidanceChange = "Guidance data not available in Yahoo structured feed — check company press release";
  if (Number.isFinite(revenueGrowth)) {
    if (revenueGrowth > 0.20) guidanceChange = "Revenue trajectory suggests guidance was likely raised or maintained strongly";
    else if (revenueGrowth > 0.05) guidanceChange = "Revenue pace suggests guidance was maintained or modestly raised";
    else if (revenueGrowth <= 0) guidanceChange = "Slowing or negative revenue growth may signal cautious or lowered guidance";
  }

  const beatCount = earningsHistory.filter((e) => (raw(e.epsDifference) ?? 0) > 0).length;
  const totalCount = earningsHistory.length;
  const beatRate = totalCount > 0 ? round((beatCount / totalCount) * 100, 1) : null;
  const consecutiveBeats = (() => {
    let count = 0;
    for (const entry of [...earningsHistory].reverse()) {
      if ((raw(entry.epsDifference) ?? 0) > 0) count++;
      else break;
    }
    return count;
  })();

  let thesisClassification;
  if (beatRate !== null && Number.isFinite(revenueGrowth)) {
    if (beatRate >= 75 && revenueGrowth >= 0.15) thesisClassification = "Thesis Strengthened";
    else if (beatRate >= 50 && revenueGrowth >= 0) thesisClassification = "Thesis Unchanged";
    else thesisClassification = "Thesis Weakened";
  } else if (beatRate !== null) {
    thesisClassification = beatRate >= 65 ? "Thesis Unchanged" : "Thesis Weakened";
  } else {
    thesisClassification = "Insufficient data";
  }

  const watchNext = buildEarningsWatchList(symbol, theme);
  const earningsProximate = daysUntilEarnings !== null && daysUntilEarnings <= 10 && daysUntilEarnings >= 0;
  const earningsRiskLabel = earningsProximate ? "High" : daysUntilEarnings !== null && daysUntilEarnings <= 20 ? "Moderate" : "Low";

  const grossMargins = raw(financial.grossMargins);
  const operatingMargins = raw(financial.operatingMargins);
  const grossMarginsComment = Number.isFinite(grossMargins) ? `Gross margin at ${round(grossMargins * 100, 1)}%.` : "Gross margin data unavailable.";
  const opMarginsComment = Number.isFinite(operatingMargins) ? `Operating margin at ${round(operatingMargins * 100, 1)}%.` : "Operating margin data unavailable.";

  return {
    nextEarningsDate: nextEarningsDate ?? "Not available from Yahoo",
    nextEarningsConfirmed,
    daysUntilEarnings,
    lastEarningsDate: lastEarningsDate ?? "Not available from Yahoo",
    lastQuarterRevenue: lastRevenue,
    revVsExpectations,
    revenueBeatSanityFlag,
    lastQuarterEPS: epsActual,
    epsVsExpectations,
    epsSurprisePct: round(epsSurprisePct, 1),
    guidanceChange,
    grossMarginsComment,
    opMarginsComment,
    thesisClassification,
    beatRate,
    consecutiveBeats,
    watchNext,
    earningsProximate,
    earningsRiskLabel,
  };
}

function buildSeniorScorecard({ growthChecklist, technical, fundamentals, valuation, moat, analysts, newsEngine, riskScore, summary, earnings }) {
  const financial = summary?.financialData ?? {};
  const gm = fundamentals.grossMargins ?? 0;
  const om = fundamentals.operatingMargins ?? 0;
  const pm = fundamentals.profitMargins ?? 0;
  const roe = fundamentals.returnOnEquity ?? 0;
  const roa = fundamentals.returnOnAssets ?? 0;
  const fcfMarginRow = checklistValue(growthChecklist, "FCF Margin");
  const fcfMarginVal = fcfMarginRow?.value ?? 0;
  const fcf = raw(financial.freeCashflow);
  const totalCash = raw(financial.totalCash);
  const totalDebt = raw(financial.totalDebt);
  const currentRatio = raw(financial.currentRatio);
  const debtToEquity = raw(financial.debtToEquity);
  const forwardPE = valuation.forwardPE;
  const ps = valuation.priceToSales;
  const peg = valuation.pegRatio;
  const revGrowth1y = checklistValue(growthChecklist, "1-Year Revenue Growth")?.value ?? 0;
  const revCagr3 = checklistValue(growthChecklist, "3-Year Revenue CAGR")?.value ?? 0;
  const revCagr5 = checklistValue(growthChecklist, "5-Year Revenue CAGR")?.value;
  const ebitdaRow = checklistValue(growthChecklist, "EBITDA Margin");
  const ebitdaVal = ebitdaRow?.value ?? 0;

  // 1. Business Quality (0–100)
  let bq = 30;
  if (gm > 55) bq += 22; else if (gm > 40) bq += 14; else if (gm > 25) bq += 7; else if (gm > 0) bq += 2;
  if (om > 25) bq += 22; else if (om > 15) bq += 14; else if (om > 5) bq += 7; else if (om < 0) bq -= 8;
  if (pm > 20) bq += 15; else if (pm > 10) bq += 9; else if (pm > 0) bq += 4; else if (pm < 0) bq -= 6;
  if (roe > 25) bq += 11; else if (roe > 15) bq += 7; else if (roe > 8) bq += 4;
  const businessQualityScore = clamp(Math.round(bq));

  // 2. Revenue Growth (0–100)
  let rg = 20;
  if (revGrowth1y >= 30) rg += 40; else if (revGrowth1y >= 20) rg += 30; else if (revGrowth1y >= 10) rg += 18; else if (revGrowth1y >= 3) rg += 8; else if (revGrowth1y < 0) rg -= 5;
  if (revCagr3 >= 25) rg += 25; else if (revCagr3 >= 15) rg += 16; else if (revCagr3 >= 7) rg += 9; else if (revCagr3 < 0) rg -= 5;
  if (Number.isFinite(revCagr5) && revCagr5 >= 15) rg += 15; else if (Number.isFinite(revCagr5) && revCagr5 >= 8) rg += 9;
  const revenueGrowthScore = clamp(Math.round(rg));

  // 3. Margin Quality (0–100)
  let mq = 25;
  if (gm > 55) mq += 22; else if (gm > 40) mq += 14; else if (gm > 25) mq += 7;
  if (om > 25) mq += 22; else if (om > 15) mq += 14; else if (om > 5) mq += 7; else if (om < 0) mq -= 8;
  if (fcfMarginVal > 20) mq += 18; else if (fcfMarginVal > 10) mq += 12; else if (fcfMarginVal > 0) mq += 6;
  if (ebitdaVal > 30) mq += 13; else if (ebitdaVal > 18) mq += 8; else if (ebitdaVal > 5) mq += 4;
  const marginQualityScore = clamp(Math.round(mq));

  // 4. Free Cash Flow (0–100)
  let fcfScore = 25;
  if (Number.isFinite(fcf) && fcf > 0) fcfScore += 30; else if (Number.isFinite(fcf) && fcf < 0) fcfScore -= 10;
  if (fcfMarginVal >= 20) fcfScore += 30; else if (fcfMarginVal >= 12) fcfScore += 20; else if (fcfMarginVal >= 5) fcfScore += 12; else if (fcfMarginVal >= 0) fcfScore += 5;
  if (checklistValue(growthChecklist, "FCF Growth")?.status === "pass") fcfScore += 15;
  const freeCashFlowScore = clamp(Math.round(fcfScore));

  // 5. Balance Sheet (0–100)
  let bs = 40;
  if (Number.isFinite(totalCash) && Number.isFinite(totalDebt)) {
    const cashDebt = totalDebt > 0 ? totalCash / totalDebt : 5;
    if (cashDebt >= 2) bs += 28; else if (cashDebt >= 1) bs += 20; else if (cashDebt >= 0.5) bs += 10; else bs -= 12;
  }
  if (Number.isFinite(currentRatio)) {
    if (currentRatio >= 2.5) bs += 15; else if (currentRatio >= 1.5) bs += 10; else if (currentRatio >= 1) bs += 5; else bs -= 10;
  }
  if (Number.isFinite(debtToEquity)) {
    if (debtToEquity < 30) bs += 10; else if (debtToEquity < 80) bs += 5; else if (debtToEquity > 200) bs -= 12;
  }
  if (Number.isFinite(fcf) && fcf > 0) bs += 7;
  const balanceSheetScore = clamp(Math.round(bs));

  // 6. Moat (0–100)
  const moatScore = clamp(moat?.score ?? 35);

  // 7. Management / Execution (0–100)
  let mgmt = 38;
  if (earnings?.beatRate >= 80) mgmt += 28; else if (earnings?.beatRate >= 65) mgmt += 18; else if (earnings?.beatRate >= 50) mgmt += 10; else if (earnings?.beatRate < 30) mgmt -= 10;
  if (earnings?.consecutiveBeats >= 4) mgmt += 12; else if (earnings?.consecutiveBeats >= 2) mgmt += 6;
  if (fundamentals.score >= 70) mgmt += 15; else if (fundamentals.score >= 55) mgmt += 8;
  if (analysts.score >= 70) mgmt += 10; else if (analysts.score >= 55) mgmt += 5;
  const managementScore = clamp(Math.round(mgmt));

  // 8. Valuation Risk (0–100, higher = more risky)
  let vr = 48;
  if (Number.isFinite(forwardPE)) {
    if (forwardPE < 12) vr -= 25; else if (forwardPE < 20) vr -= 14; else if (forwardPE > 60) vr += 25; else if (forwardPE > 40) vr += 15; else if (forwardPE > 28) vr += 7;
  }
  if (Number.isFinite(ps)) {
    if (ps < 2) vr -= 12; else if (ps < 5) vr -= 5; else if (ps > 20) vr += 22; else if (ps > 12) vr += 14; else if (ps > 7) vr += 7;
  }
  if (Number.isFinite(peg) && peg > 0) {
    if (peg < 1) vr -= 12; else if (peg < 1.5) vr -= 6; else if (peg > 3.5) vr += 18; else if (peg > 2.5) vr += 10;
  }
  if (fundamentals.score >= 75) vr -= 8;
  if (revenueGrowthScore >= 80) vr -= 5;
  const valuationRiskScore = clamp(Math.round(vr));

  // 9. Earnings Risk (0–100, higher = more risky)
  let er = 45;
  if (earnings?.earningsProximate) er += 35;
  else if (Number.isFinite(earnings?.daysUntilEarnings) && earnings.daysUntilEarnings <= 20 && earnings.daysUntilEarnings >= 0) er += 18;
  if (earnings?.thesisClassification === "Thesis Weakened") er += 22;
  else if (earnings?.thesisClassification === "Thesis Strengthened") er -= 15;
  if (earnings?.beatRate < 40) er += 18; else if (earnings?.beatRate >= 80) er -= 12;
  const earningsRiskScore = clamp(Math.round(er));

  // 10. Technical Setup (0–100)
  const technicalSetupScore = clamp(technical.score ?? 35);

  // 11. Entry Timing (0–100)
  let et = technical.score >= 70 ? 78 : technical.score >= 55 ? 62 : technical.score >= 40 ? 48 : 28;
  if (technical.rsi14 > 75) et -= 18; else if (technical.rsi14 < 35) et -= 12; else if (technical.rsi14 >= 45 && technical.rsi14 <= 60) et += 8;
  const entryTimingScore = clamp(Math.round(et));

  // 12. 5-Year Hold Confidence
  const fiveYearConfidenceScore = clamp(Math.round(
    businessQualityScore * 0.30 + moatScore * 0.25 + revenueGrowthScore * 0.22 + balanceSheetScore * 0.12 + managementScore * 0.11
  ));

  // 13. Growth Potential
  const growthPotentialScore = clamp(Math.round(
    revenueGrowthScore * 0.40 + marginQualityScore * 0.22 + freeCashFlowScore * 0.20 + moatScore * 0.18
  ));

  // 14. Downside Risk (higher = more risky)
  const downsideRiskScore = clamp(Math.round(
    valuationRiskScore * 0.30 + earningsRiskScore * 0.20 + (100 - balanceSheetScore) * 0.20 + (100 - businessQualityScore) * 0.15 + (100 - technicalSetupScore) * 0.15
  ));

  // 15. Shares vs LEAPS Suitability
  const sharesVsLeapsSuitabilityScore = clamp(Math.round(
    businessQualityScore * 0.25 + moatScore * 0.20 + fiveYearConfidenceScore * 0.20 + (100 - valuationRiskScore) * 0.15 + technicalSetupScore * 0.10 + entryTimingScore * 0.10
  ));

  // 0. Overall Long-Term Score (spec weighting)
  const overallLongTermScore = clamp(Math.round(
    businessQualityScore * 0.18 +
    revenueGrowthScore * 0.14 +
    ((marginQualityScore + freeCashFlowScore) / 2) * 0.14 +
    moatScore * 0.14 +
    balanceSheetScore * 0.10 +
    managementScore * 0.08 +
    (100 - valuationRiskScore) * 0.10 +
    (100 - earningsRiskScore) * 0.05 +
    technicalSetupScore * 0.07
  ));

  return {
    overallLongTermScore,
    businessQualityScore,
    revenueGrowthScore,
    marginQualityScore,
    freeCashFlowScore,
    balanceSheetScore,
    moatScore,
    managementScore,
    valuationRiskScore,
    earningsRiskScore,
    technicalSetupScore,
    entryTimingScore,
    fiveYearConfidenceScore,
    growthPotentialScore,
    downsideRiskScore,
    sharesVsLeapsSuitabilityScore,
  };
}

function determineFinalRating(scorecard, growthChecklist, valuation, technical, earnings) {
  const s = scorecard;
  if (s.overallLongTermScore < 35 || (s.businessQualityScore < 30 && s.revenueGrowthScore < 30)) return "Avoid";
  if (earnings?.thesisClassification === "Thesis Weakened" && s.businessQualityScore < 58) return "Thesis Weakening";
  if (s.overallLongTermScore >= 78 && s.businessQualityScore >= 72 && s.moatScore >= 68 && s.fiveYearConfidenceScore >= 74 && s.downsideRiskScore <= 58) return "Core 5-Year Compounder";
  if (s.overallLongTermScore >= 68 && s.businessQualityScore >= 62 && s.valuationRiskScore >= 70) return "Strong Company, Wait for Better Price";
  if (s.revenueGrowthScore >= 74 && s.downsideRiskScore >= 62) return "High Growth / High Risk";
  if (s.overallLongTermScore >= 62 && s.businessQualityScore >= 55) return "DCA Candidate";
  if (s.overallLongTermScore >= 45) return "Watchlist Only";
  return "Avoid";
}

function determineFinalAction(finalRating, technical, earnings, scorecard) {
  if (Number.isFinite(earnings?.daysUntilEarnings) && earnings.daysUntilEarnings >= 0 && earnings.daysUntilEarnings <= 4) return "Wait after earnings";
  switch (finalRating) {
    case "Core 5-Year Compounder":
      if (technical.score >= 65) return "Buy shares slowly";
      if (technical.score >= 45) return "DCA shares";
      return "Wait for pullback";
    case "Strong Company, Wait for Better Price": return "Wait for pullback";
    case "DCA Candidate":
      return technical.score >= 50 ? "DCA shares" : "Wait for pullback";
    case "High Growth / High Risk":
      if (scorecard.overallLongTermScore >= 76 && technical.score >= 58) return "LEAPS starter allowed";
      if (technical.score >= 48) return "Watch after earnings";
      return "LEAPS watch only";
    case "Watchlist Only":
      if (Number.isFinite(earnings?.daysUntilEarnings) && earnings.daysUntilEarnings >= 0 && earnings.daysUntilEarnings <= 30) return "Watch after earnings";
      return "Wait for pullback";
    case "Thesis Weakening": return "Watch after earnings";
    default: return "Avoid";
  }
}

function buildSharesVsLeapsDecision(scorecard, technical, valuation, earnings, summary) {
  const meetsMinimum =
    scorecard.overallLongTermScore >= 75 &&
    scorecard.businessQualityScore >= 70 &&
    scorecard.moatScore >= 70 &&
    scorecard.freeCashFlowScore >= 48 &&
    scorecard.balanceSheetScore >= 48;
  const notTooExpensive = scorecard.valuationRiskScore < 82;
  const technicalOK = technical.score >= 42;
  const earningsOK = !earnings?.earningsProximate;

  let sharesDecision;
  if (scorecard.overallLongTermScore >= 72 && scorecard.entryTimingScore >= 58) sharesDecision = "Buy shares slowly";
  else if (scorecard.overallLongTermScore >= 64 && scorecard.entryTimingScore >= 42) sharesDecision = "DCA shares";
  else if (scorecard.overallLongTermScore >= 52) sharesDecision = "Wait for pullback";
  else sharesDecision = "Avoid shares for now";

  let leapsDecision;
  if (!meetsMinimum) leapsDecision = "Avoid LEAPS";
  else if (!earningsOK) leapsDecision = "Wait until after earnings";
  else if (!notTooExpensive) leapsDecision = "LEAPS too expensive";
  else if (!technicalOK) leapsDecision = "LEAPS watch only";
  else if (scorecard.overallLongTermScore >= 82) leapsDecision = "LEAPS starter allowed";
  else leapsDecision = "Shares better than LEAPS";

  const whyShares = sharesDecision === "Buy shares slowly" || sharesDecision === "DCA shares"
    ? "Shares are preferred because the company has sufficient business quality and the risk/reward for long-term equity ownership is favorable. For 5-year compounders, shares with no expiry and unlimited upside are the better vehicle."
    : "Shares suit patient DCA accumulation. Wait for technically sound entry levels before building position size.";

  const whyLeaps = meetsMinimum
    ? "LEAPS may be considered because the company scores above the quality threshold. Preferred: 12–24 month expiry, delta 0.60–0.80, in-the-money only. Never full size."
    : "LEAPS are not suitable here because the company does not clear the minimum quality, moat, and balance sheet requirements. The premium carries meaningful risk of going to zero.";

  const reasonsNotMet = [
    scorecard.overallLongTermScore < 75 ? `overall score ${scorecard.overallLongTermScore}/100 below the 75 minimum` : null,
    scorecard.businessQualityScore < 70 ? `business quality ${scorecard.businessQualityScore}/100 below 70` : null,
    scorecard.moatScore < 70 ? `moat score ${scorecard.moatScore}/100 below 70` : null,
    earnings?.earningsProximate ? "earnings are within 5 trading days" : null,
    scorecard.valuationRiskScore >= 82 ? "valuation is extreme" : null,
    !technicalOK ? "technical setup is too weak" : null,
  ].filter(Boolean);

  return {
    meetsLeapsMinimum: meetsMinimum,
    leapsAllowed: meetsMinimum && notTooExpensive && technicalOK && earningsOK,
    sharesDecision,
    leapsDecision,
    whyShares,
    whyLeaps,
    tooRiskyReason: reasonsNotMet.length ? reasonsNotMet.join("; ") : "Criteria met",
    minimumRequirements: {
      overallScore: scorecard.overallLongTermScore,
      businessScore: scorecard.businessQualityScore,
      moatScore: scorecard.moatScore,
      fcfScore: scorecard.freeCashFlowScore,
      balanceSheetScore: scorecard.balanceSheetScore,
      passed: meetsMinimum,
    },
    contractPreference: (meetsMinimum && notTooExpensive && technicalOK && earningsOK) ? {
      preferredExpiry: "12–24 months",
      minimumExpiry: "6 months (aggressive only)",
      preferredDelta: "0.60–0.80",
      note: "Never full-size LEAPS. Premium can go to zero. Starter position only (0.5–1% of portfolio).",
    } : null,
  };
}

function buildPositionSizing(finalRating, scorecard) {
  let classification, starterPct, coreTargetPct, maxPct;
  if (finalRating === "Core 5-Year Compounder") {
    classification = "Core holding"; starterPct = 2.5; coreTargetPct = 10; maxPct = 15;
  } else if (finalRating === "DCA Candidate") {
    classification = "Core holding"; starterPct = 2; coreTargetPct = 8; maxPct = 12;
  } else if (finalRating === "High Growth / High Risk") {
    classification = "Satellite growth"; starterPct = 1; coreTargetPct = 4; maxPct = 6;
  } else if (finalRating === "Strong Company, Wait for Better Price") {
    classification = "Core holding (wait mode)"; starterPct = 0; coreTargetPct = 8; maxPct = 12;
  } else if (finalRating === "Watchlist Only") {
    classification = "Watchlist"; starterPct = 0; coreTargetPct = 3; maxPct = 5;
  } else {
    classification = "Speculative / avoid"; starterPct = 0; coreTargetPct = 0; maxPct = 2;
  }
  const examplePortfolio = 10000;
  return {
    classification,
    examplePortfolio,
    starterPct,
    coreTargetPct,
    maxPct,
    starterDollar: round(examplePortfolio * starterPct / 100, 0),
    coreDollar: round(examplePortfolio * coreTargetPct / 100, 0),
    dcaPlan: starterPct > 0
      ? `Start with ${starterPct}% (~$${round(examplePortfolio * starterPct / 100, 0)} in a $${examplePortfolio.toLocaleString()} portfolio). Build toward ${coreTargetPct}% over 3–6 months in tranches. Never rush to full size.`
      : "Wait for better conditions before initiating. Do not buy just because the stock moved.",
    addOnZones: "Add at key technical support zones (EMA50, EMA150), on earnings-driven pullbacks, or when thesis is confirmed by consecutive beats.",
    trimConditions: [
      "Two consecutive quarters: revenue deceleration + guidance cut",
      "Valuation becomes extreme (forward P/E more than 2x historical average with no growth acceleration)",
      "Moat or business quality scores drop below 45",
      "Position exceeds maximum allocation without rebalance",
    ],
    leapsNote: "LEAPS: Max 0.5–1% of portfolio per name. Max 2–3% total LEAPS exposure. Never average down on LEAPS. Premium can go to zero.",
  };
}

function buildFundManagerVerdict({ symbol, companyName, scorecard, finalRating, finalAction, technicalPlan, valuation, earnings, report, growthChecklist }) {
  const investable5Years = scorecard.fiveYearConfidenceScore >= 62 && scorecard.businessQualityScore >= 58;
  const buyNowOrWait = ["Buy shares slowly", "DCA shares"].includes(finalAction)
    ? "Accumulate slowly in tranches. Do not rush to full size. Use the entry zones provided."
    : finalAction.toLowerCase().includes("pullback") || finalAction === "Strong Company, Wait for Better Price"
      ? "Wait for a technically sound pullback. The business quality is there, but price needs to correct."
      : finalAction.toLowerCase().includes("earnings")
        ? "Wait until after the next earnings report before adding or initiating a position."
        : "Do not buy yet. Conditions need to improve before the risk/reward is favorable.";

  const idealEntry = technicalPlan?.available
    ? `${compactMoney(technicalPlan.idealBuyZoneLow)} – ${compactMoney(technicalPlan.idealBuyZoneHigh)}`
    : "See technical section";
  const dcaZoneStr = technicalPlan?.available
    ? `${compactMoney(technicalPlan.dcaZoneLow)} – ${compactMoney(technicalPlan.dcaZoneHigh)}`
    : "See technical section";
  const biggestUpside = growthChecklist.isGrowthStock
    ? "Revenue continuing to compound above market expectations while operating leverage expands margins"
    : report?.bullCase ?? "Business improvement and potential valuation re-rating";
  const biggestRisk = report?.bearCase ??
    (scorecard.valuationRiskScore >= 72 ? "Valuation contraction if growth decelerates" :
      scorecard.earningsRiskScore >= 72 ? "Earnings miss risk near upcoming catalyst window" :
        "Execution and competitive risk in the core business");
  const watchNext = earnings?.watchNext?.slice(0, 3)?.join("; ") ?? "Revenue growth, margin trends, forward guidance";
  const sellReduce = [
    "Two consecutive quarters of revenue deceleration below expectations AND guidance cut",
    "Gross margin compression of more than 3 percentage points with no clear path to recovery",
    "Clear moat erosion: loss of key customers, pricing power, or market share to competitors",
    technicalPlan?.available ? `Close below invalidation at ${compactMoney(technicalPlan.invalidationBelow)} on weekly basis` : "Price breaks major long-term support on heavy volume",
  ];
  const buyMore = [
    "Earnings beat with raised guidance on both revenue and margins",
    technicalPlan?.available ? `Price pulls back to DCA zone (${compactMoney(technicalPlan.dcaZoneLow)} – ${compactMoney(technicalPlan.dcaZoneHigh)}) with thesis intact` : "Price returns to a technically attractive zone with thesis intact",
    "New major product cycle, contract, or market expansion directly addresses core thesis",
    "Valuation becomes materially more attractive (20%+ pullback, same or better earnings outlook)",
  ];

  const qualWord = scorecard.businessQualityScore >= 72 ? "strong" : scorecard.businessQualityScore >= 55 ? "adequate" : "weak";
  const growWord = scorecard.revenueGrowthScore >= 72 ? "impressive" : scorecard.revenueGrowthScore >= 52 ? "moderate" : "unproven or slow";
  const ratingRead = finalRating === "Core 5-Year Compounder" ? "This is a compelling long-term compounder with strong business quality and moat"
    : finalRating === "Avoid" ? "This does not meet the standards of this system at current levels"
      : finalRating === "Thesis Weakening" ? "Thesis shows signs of weakening and requires close monitoring"
        : "This warrants patient accumulation at the right entry zones with disciplined position sizing";
  const valuationWord = scorecard.valuationRiskScore >= 72 ? "elevated and demanding strong execution" : scorecard.valuationRiskScore <= 38 ? "attractive relative to growth prospects" : "reasonable for a company of this quality";
  const actionSummary = finalAction === "Avoid" ? "At this time, the risk/reward does not support initiating a position."
    : `The recommended approach is to ${finalAction.toLowerCase()}, focusing on the entry zones defined in the technical plan.`;

  const plainEnglish = [
    `${companyName} scores ${scorecard.overallLongTermScore}/100 in the Senior Stock Analyzer — a composite of business quality, growth, moat, balance sheet, valuation, and technical setup.`,
    `The business quality is ${qualWord} and revenue growth is ${growWord}.`,
    `${ratingRead}.`,
    `Current valuation is ${valuationWord}, with valuation risk at ${scorecard.valuationRiskScore}/100 (higher means riskier).`,
    actionSummary,
  ].join(" ");

  return {
    finalRating,
    finalAction,
    investable5Years,
    buyNowOrWait,
    idealEntryZone: idealEntry,
    dcaZone: dcaZoneStr,
    tp1: technicalPlan?.tp1,
    tp2: technicalPlan?.tp2,
    invalidationLevel: technicalPlan?.invalidationBelow,
    sharesVsLeapsDecision: finalAction.toLowerCase().includes("leaps") ? "LEAPS starter allowed with strict sizing rules" : "Shares preferred for long-term position building",
    biggestUpsideDriver: biggestUpside,
    biggestRisk,
    watchNextEarnings: watchNext,
    sellReduceConditions: sellReduce,
    buyMoreConditions: buyMore,
    plainEnglishSummary: plainEnglish,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
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
      "earningsHistory",
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

  // ── Senior Analyzer layer ──────────────────────────────────────────────────
  const earningsAnalysis = buildEarningsAnalysis(summary, newsEngine, symbol, theme);
  const fiveYearTable = build5YearFinancialTable(summary);
  const technicalPlan = buildEnhancedTechnicalPlan(technical, summary);
  const seniorScorecard = buildSeniorScorecard({
    growthChecklist, technical, fundamentals, valuation, moat, analysts, newsEngine, riskScore, summary, earnings: earningsAnalysis,
  });
  const seniorFinalRating = determineFinalRating(seniorScorecard, growthChecklist, valuation, technical, earningsAnalysis);
  const seniorFinalAction = determineFinalAction(seniorFinalRating, technical, earningsAnalysis, seniorScorecard);
  const sharesVsLeaps = buildSharesVsLeapsDecision(seniorScorecard, technical, valuation, earningsAnalysis, summary);
  const positionSizing = buildPositionSizing(seniorFinalRating, seniorScorecard);
  const fundManagerVerdict = buildFundManagerVerdict({
    symbol, companyName, scorecard: seniorScorecard, finalRating: seniorFinalRating, finalAction: seniorFinalAction,
    technicalPlan, valuation, earnings: earningsAnalysis, report, growthChecklist,
  });

  const detail = summary.summaryDetail ?? {};

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
    high52w: raw(detail.fiftyTwoWeekHigh),
    low52w: raw(detail.fiftyTwoWeekLow),
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
      profileSummary: profile.longBusinessSummary ?? "",
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
    // Senior Analyzer fields
    seniorScorecard,
    seniorFinalRating,
    seniorFinalAction,
    earningsAnalysis,
    fiveYearTable,
    technicalPlan,
    sharesVsLeaps,
    positionSizing,
    fundManagerVerdict,
    finalAction: seniorFinalAction,
    managerRead: `${seniorFinalRating}: ${symbol} scores ${seniorScorecard.overallLongTermScore}/100 in the Senior Analyzer. Technicals are ${technical.rating.toLowerCase()}, fundamentals are ${fundamentals.rating.toLowerCase()}, valuation is ${valuation.rating.toLowerCase()}.`,
    asOf: new Date().toISOString(),
  };
}
