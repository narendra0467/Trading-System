import fs from "node:fs";
import path from "node:path";

import { analyzeStock } from "./stockAnalyzer.js";
import { loadUniverseRecords } from "./universe.js";

const DEFAULT_UNIVERSE = "data/universe_hidden_multibagger.csv";
const DEFAULT_REPORT_DIR = "reports";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function boolArg(name, fallback = false) {
  const value = getArg(name, String(fallback));
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function money(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  if (Math.abs(value) >= 1_000_000_000_000) return `$${round(value / 1_000_000_000_000, 2)}T`;
  if (Math.abs(value) >= 1_000_000_000) return `$${round(value / 1_000_000_000, 2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${round(value / 1_000_000, 1)}M`;
  return `$${round(value, 2)}`;
}

function pct(value) {
  return Number.isFinite(value) ? `${round(value, 1)}%` : "Unavailable";
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvEscape(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? { symbol: "", score: "", riskScore: "" });
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

function growthValue(result, label) {
  const value = result.growthChecklist?.rows?.find((row) => row.label === label)?.value;
  return Number.isFinite(value) ? value : null;
}

function hiddenBreakdownScore(result, label) {
  const value = result.hiddenMultibagger?.scoreBreakdown?.find((row) => row.label === label)?.score;
  return Number.isFinite(value) ? value : null;
}

function hiddenRiskScore(result, label) {
  const value = result.hiddenMultibagger?.riskBreakdown?.find((row) => row.label === label)?.score;
  return Number.isFinite(value) ? value : null;
}

function underRadarValue(result, label) {
  return result.hiddenMultibagger?.underRadarFactors?.find((row) => row.label === label)?.value ?? "Unavailable";
}

function fieldStatus(row, label) {
  return row.raw?.growthChecklist?.rows?.find((item) => item.label === label)?.status ?? null;
}

function proofValue(row, label) {
  return row.earlyProof?.find((item) => item.label === label)?.value ?? "Unavailable";
}

function latestCatalyst(result) {
  return result.report?.catalysts?.find((item) => !/^No specific/i.test(item)) ||
    result.newsEngine?.items?.find((item) => item.catalyst)?.title ||
    "No confirmed catalyst found in available feed";
}

function isUsCommonStockSymbol(symbol) {
  return /^[A-Z][A-Z0-9]{0,4}$/.test(symbol) && !symbol.includes(".");
}

function candidateFromAnalysis(result, seed = {}) {
  const hidden = result.hiddenMultibagger ?? {};
  const marketCap = result.marketCap;
  const revenueGrowth = growthValue(result, "1-Year Revenue Growth");
  const revenueCagr3 = growthValue(result, "3-Year Revenue CAGR");
  const grossMargin = growthValue(result, "Gross Profit Margin");
  const fcfMargin = growthValue(result, "FCF Margin");
  const cashDebt = result.kpiRows?.find((row) => row.label === "Cash / Debt")?.display ?? "Unavailable";
  const dilution = result.kpiRows?.find((row) => row.label === "Shares Outstanding Growth")?.display ?? "Unavailable";
  const fcfProof = hidden.earlyProof?.find((item) => item.label === "FCF improving");
  const catalyst = latestCatalyst(result);
  const candidate = {
    symbol: result.symbol,
    name: result.name,
    sector: result.business?.sector || seed.sector_hint || "n/a",
    theme: seed.theme || result.business?.theme || "n/a",
    marketCap,
    marketCapDisplay: money(marketCap),
    revenueGrowth,
    revenueGrowthDisplay: pct(revenueGrowth),
    revenueCagr3,
    revenueCagr3Display: pct(revenueCagr3),
    grossMargin,
    grossMarginDisplay: pct(grossMargin),
    fcfTrend: fcfProof?.value || (Number.isFinite(fcfMargin) ? pct(fcfMargin) : "Unavailable"),
    dilutionTrend: dilution,
    cashDebt,
    analystCoverage: result.analysts?.numberOfAnalystOpinions ?? null,
    analystCoverageDisplay: Number.isFinite(result.analysts?.numberOfAnalystOpinions) ? `${result.analysts.numberOfAnalystOpinions}` : "Unavailable",
    institutionalOwnership: underRadarValue(result, "Institutional ownership"),
    insiderOwnership: underRadarValue(result, "Insider ownership"),
    catalyst,
    score: hidden.score ?? 0,
    riskScore: hidden.riskScore ?? 100,
    underRadarScore: hidden.underRadarScore ?? 0,
    classification: hidden.classification || "Avoid / Too Many Red Flags",
    classificationReason: hidden.classificationReason || "",
    bullCase: hidden.upsideCase || result.report?.bullCase || "Upside case unavailable.",
    bearCase: hidden.downsideCase || result.report?.bearCase || "Bear case unavailable.",
    businessModel: result.report?.businessModel || "Business model unavailable.",
    whyUnderRadar: (hidden.underRadarFactors ?? [])
      .filter((item) => Number(item.score) >= 60)
      .slice(0, 3)
      .map((item) => `${item.label}: ${item.value}`)
      .join("; ") || hidden.classificationReason || "Under-the-radar proof is weak or unavailable.",
    multibaggerWhy: hidden.score >= 65
      ? "Growth, market size, margin quality, survivability, and catalysts create an asymmetric research setup if execution continues."
      : "The multibagger thesis is not yet proven; it needs stronger growth, leverage, or survivability evidence.",
    proof: (hidden.earlyProof ?? []).filter((item) => item.passed).map((item) => `${item.label}: ${item.value}`),
    mustHappen: hidden.mustHappen ?? [],
    redFlags: [
      ...(result.risks ?? []),
      ...(hidden.riskBreakdown ?? []).filter((item) => Number(item.score) >= 60).map((item) => `${item.label}: ${item.note}`),
    ].slice(0, 8),
    dilutionCheck: hidden.riskBreakdown?.find((row) => row.label === "Dilution risk")?.note || "Dilution data unavailable.",
    balanceSheetCheck: hidden.riskBreakdown?.find((row) => row.label === "Balance sheet risk")?.note || "Balance sheet data unavailable.",
    catalystTimeline: result.report?.catalysts ?? [],
    verdict: `${hidden.classification || "Research only"}: ${hidden.classificationReason || "Use as a watchlist filter only."}`,
    dataQuality: result.dataQuality,
    riskBreakdown: hidden.riskBreakdown ?? [],
    scoreBreakdown: hidden.scoreBreakdown ?? [],
    earlyProof: hidden.earlyProof ?? [],
    underRadarFactors: hidden.underRadarFactors ?? [],
    raw: result,
  };
  candidate.institutionalReview = buildInstitutionalReview(candidate);
  candidate.researchTier = candidate.institutionalReview.tier;
  candidate.gateScore = candidate.institutionalReview.gateScore;
  candidate.investorRead = candidate.institutionalReview.investorRead;
  buildResearchDesk(candidate);
  return candidate;
}

function passesInitialFilters(row) {
  if (!isUsCommonStockSymbol(row.symbol)) return false;
  if (!Number.isFinite(row.marketCap) || row.marketCap < 300_000_000 || row.marketCap > 10_000_000_000) return false;
  if (!Number.isFinite(row.revenueGrowth) || row.revenueGrowth < 20) return false;
  if (!Number.isFinite(row.revenueCagr3) || row.revenueCagr3 < 15) return false;
  if ((row.score ?? 0) < 45 || (row.riskScore ?? 100) > 82) return false;
  if (/Hype Stock|Avoid/i.test(row.classification) && row.score < 60) return false;
  if (hiddenRiskScore(row.raw, "Liquidity risk") > 78) return false;
  if (hiddenRiskScore(row.raw, "Filing / reporting risk") > 70) return false;
  if (hiddenRiskScore(row.raw, "Hype / promotion risk") > 78) return false;
  return true;
}

function passesQualityMode(row) {
  if (!passesInitialFilters(row)) return false;
  if (hiddenBreakdownScore(row.raw, "Dilution control") < 50) return false;
  if (hiddenBreakdownScore(row.raw, "Balance sheet survival") < 55) return false;
  if (hiddenRiskScore(row.raw, "Liquidity risk") > 65) return false;
  if (hiddenRiskScore(row.raw, "Filing / reporting risk") > 55) return false;
  if (hiddenRiskScore(row.raw, "Hype / promotion risk") > 65) return false;
  if (!(row.raw.hiddenMultibagger?.earlyProof ?? []).some((item) => item.label === "Clear catalyst in next 12-24 months" && item.passed)) return false;
  return true;
}

function rowScore(row, label) {
  const value = row.scoreBreakdown?.find((item) => item.label === label)?.score;
  return Number.isFinite(value) ? value : null;
}

function rowRisk(row, label) {
  const value = row.riskBreakdown?.find((item) => item.label === label)?.score;
  return Number.isFinite(value) ? value : null;
}

function gate(label, status, note) {
  return { label, status, note };
}

function scoreGate(label, score, passAt, warnAt, note) {
  if (!Number.isFinite(score)) return gate(label, "fail", `${note} Data unavailable.`);
  if (score >= passAt) return gate(label, "pass", `${note} Score ${Math.round(score)}/100.`);
  if (score >= warnAt) return gate(label, "warn", `${note} Score ${Math.round(score)}/100.`);
  return gate(label, "fail", `${note} Score ${Math.round(score)}/100.`);
}

function riskFlag(row, label, rejectAt, warnAt) {
  const score = rowRisk(row, label);
  if (!Number.isFinite(score)) return null;
  if (score >= rejectAt) return `${label} is very high (${Math.round(score)}/100)`;
  if (score >= warnAt) return `${label} needs extra verification (${Math.round(score)}/100)`;
  return null;
}

function buildInstitutionalReview(row) {
  const catalystProof = row.earlyProof?.some((item) => item.label === "Clear catalyst in next 12-24 months" && item.passed);
  const realRevenue = Number.isFinite(row.revenueGrowth) && Number.isFinite(row.marketCap);
  const gates = [
    gate(
      "Real revenue and normal listing",
      realRevenue && isUsCommonStockSymbol(row.symbol) ? "pass" : "fail",
      realRevenue ? "Revenue and market-cap fields are available." : "Revenue or market-cap proof is missing."
    ),
    gate(
      "Growth durability",
      row.revenueGrowth >= 25 && row.revenueCagr3 >= 20 ? "pass" : row.revenueGrowth >= 20 && row.revenueCagr3 >= 15 ? "warn" : "fail",
      `Revenue growth ${row.revenueGrowthDisplay}; 3-year CAGR ${row.revenueCagr3Display}.`
    ),
    scoreGate("Gross margin quality", rowScore(row, "Gross margin quality"), 70, 50, "High-quality compounders usually need durable gross margins."),
    scoreGate("Operating leverage", rowScore(row, "Operating leverage"), 65, 45, "Losses should narrow or margins should expand as revenue scales."),
    scoreGate("Balance sheet survival", rowScore(row, "Balance sheet survival"), 70, 55, "The company should be able to fund the next stage without desperate financing."),
    scoreGate("Dilution control", rowScore(row, "Dilution control"), 70, 55, "Revenue per share and share-count discipline matter more than headline revenue."),
    scoreGate("Moat or uniqueness", rowScore(row, "Moat / uniqueness"), 65, 45, "The business needs a reason competitors cannot easily copy the upside."),
    gate(
      "Catalyst backed by real evidence",
      catalystProof ? "pass" : row.catalyst && !/^No confirmed/i.test(row.catalyst) ? "warn" : "fail",
      catalystProof ? "A 12-24 month catalyst passed the proof checklist." : row.catalyst || "No confirmed catalyst found."
    ),
    gate(
      "Under-the-radar but investable",
      row.underRadarScore >= 55 ? "pass" : row.underRadarScore >= 35 ? "warn" : "fail",
      `Under-the-radar score ${Math.round(row.underRadarScore ?? 0)}/100. This should mean overlooked, not illiquid or broken.`
    ),
  ];

  const hardFlags = [
    riskFlag(row, "Filing / reporting risk", 65, 55),
    riskFlag(row, "Hype / promotion risk", 72, 60),
    riskFlag(row, "Liquidity risk", 75, 62),
    riskFlag(row, "Dilution risk", 72, 60),
    riskFlag(row, "Cash burn risk", 75, 62),
    riskFlag(row, "Debt risk", 75, 62),
  ].filter(Boolean);

  if (!passesInitialFilters(row)) hardFlags.push("Failed the basic universe, growth, market-cap, or risk screen");
  if ((row.score ?? 0) < 55) hardFlags.push("Hidden Multibagger Score is too weak for deep work");
  if ((row.riskScore ?? 100) > 72) hardFlags.push("Aggregate risk score is too high");

  const passCount = gates.filter((item) => item.status === "pass").length;
  const warnCount = gates.filter((item) => item.status === "warn").length;
  const failCount = gates.filter((item) => item.status === "fail").length;
  const gateScore = Math.round(((passCount * 100) + (warnCount * 55)) / gates.length);

  let tier = "Reject / Too Many Red Flags";
  if (hardFlags.length === 0 && failCount === 0 && gateScore >= 78 && row.score >= 68 && row.riskScore <= 58) {
    tier = "Deep Research Candidate";
  } else if (hardFlags.length <= 1 && failCount <= 1 && gateScore >= 64 && row.score >= 60 && row.riskScore <= 68) {
    tier = "Watchlist - Needs Proof";
  } else if (hardFlags.length <= 2 && gateScore >= 52 && row.score >= 55) {
    tier = "Track Only";
  }

  const filingHomework = [
    "Read the latest 10-K and 10-Q revenue footnotes: product mix, geography, customer concentration, and one-time revenue.",
    "Verify share count, stock-based compensation, convertibles, warrants, ATM programs, and revenue per share trend.",
    "Check cash burn, debt maturities, covenants, interest cost, and whether cash runway is at least 12-24 months if unprofitable.",
    "Confirm backlog, customer wins, and partnerships in filings or earnings calls instead of relying on press-release wording.",
    "Compare gross margin and operating margin direction against the closest public peers.",
  ];

  const nextReviewTriggers = [
    "Next earnings report confirms revenue acceleration without worse dilution.",
    "Operating losses narrow or FCF trend improves for another quarter.",
    "A major customer, backlog, product, or regulatory catalyst becomes measurable in filings.",
    "Valuation resets enough that upside is not dependent on perfect execution.",
  ];

  const investorRead =
    tier === "Deep Research Candidate"
      ? "Worth serious due diligence before it earns watchlist capital. The data clears the first institutional screen, but filings still decide."
      : tier === "Watchlist - Needs Proof"
        ? "Interesting, but not proven enough. Track the next two quarters and demand better evidence before upgrading."
        : tier === "Track Only"
          ? "Keep it on the radar only. Something is promising, but risk, proof, or quality is not yet good enough."
          : "Do not force it. Too many red flags or too little proof for a top-tier multibagger process.";

  return { gates, hardFlags, gateScore, tier, investorRead, filingHomework, nextReviewTriggers };
}

function weightedScore(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return 0;
  return clamp(Math.round(items.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight));
}

function buildProofScore(row) {
  const components = [
    {
      label: "Real revenue growth",
      weight: 16,
      score: Number.isFinite(row.revenueGrowth) ? row.revenueGrowth >= 40 ? 95 : row.revenueGrowth >= 25 ? 78 : row.revenueGrowth >= 15 ? 55 : 25 : 35,
      read: row.revenueGrowthDisplay,
    },
    {
      label: "Gross margin stability",
      weight: 11,
      score: rowScore(row, "Gross margin quality") ?? 45,
      read: row.grossMarginDisplay,
    },
    {
      label: "Operating margin improvement",
      weight: 14,
      score: rowScore(row, "Operating leverage") ?? 45,
      read: row.scoreBreakdown?.find((item) => item.label === "Operating leverage")?.note ?? "Operating leverage trend unavailable.",
    },
    {
      label: "Free cash flow improvement",
      weight: 12,
      score: /positive|improving|\$|%|pass/i.test(String(row.fcfTrend)) ? 70 : row.earlyProof?.some((item) => item.label === "FCF improving" && item.passed) ? 78 : 42,
      read: row.fcfTrend,
    },
    {
      label: "Revenue per share growth",
      weight: 11,
      score: row.earlyProof?.some((item) => item.label === "Revenue per share growing" && item.passed) ? 82 : fieldStatus(row, "Shares Outstanding Growth") === "pass" ? 70 : 42,
      read: proofValue(row, "Revenue per share growing"),
    },
    {
      label: "Customer/backlog proof",
      weight: 10,
      score: row.earlyProof?.some((item) => item.label === "Real signed customers or backlog" && item.passed) ? 82 : /contract|deal|customer|backlog|government|award/i.test(row.catalyst) ? 64 : 38,
      read: proofValue(row, "Real signed customers or backlog"),
    },
    {
      label: "Management execution",
      weight: 10,
      score: clamp(Math.round(((row.gateScore ?? 45) * 0.5) + ((100 - (row.riskScore ?? 70)) * 0.3) + ((row.score ?? 45) * 0.2))),
      read: row.investorRead,
    },
    {
      label: "Insider/institutional confidence",
      weight: 8,
      score: rowScore(row, "Under-the-radar factor") ?? row.underRadarScore ?? 45,
      read: `Institutions: ${row.institutionalOwnership}; insiders: ${row.insiderOwnership}.`,
    },
    {
      label: "Story becoming real",
      weight: 8,
      score: row.proof?.length >= 6 ? 85 : row.proof?.length >= 4 ? 70 : row.proof?.length >= 2 ? 55 : 35,
      read: `${row.proof?.length ?? 0} early proof signals passed.`,
    },
  ];
  return { score: weightedScore(components), components };
}

function buildHiddenFactorScore(row) {
  const analystCount = Number(row.analystCoverage);
  const marketCapScore = Number.isFinite(row.marketCap)
    ? row.marketCap < 1_500_000_000 ? 90 : row.marketCap < 4_000_000_000 ? 78 : row.marketCap < 10_000_000_000 ? 58 : 30
    : 45;
  const mediaCount = row.raw?.newsEngine?.items?.length ?? 0;
  const riskHype = rowRisk(row, "Hype / promotion risk");
  const components = [
    { label: "Low analyst coverage", weight: 15, score: Number.isFinite(analystCount) ? analystCount <= 3 ? 90 : analystCount <= 8 ? 70 : analystCount <= 15 ? 48 : 25 : 45, read: row.analystCoverageDisplay },
    { label: "Low media coverage", weight: 12, score: mediaCount <= 2 ? 82 : mediaCount <= 5 ? 65 : 38, read: `${mediaCount} recent Yahoo items.` },
    { label: "Low retail hype", weight: 14, score: Number.isFinite(riskHype) ? 100 - riskHype : 55, read: row.riskBreakdown?.find((item) => item.label === "Hype / promotion risk")?.note ?? "Hype proxy unavailable." },
    { label: "Low but improving institutional ownership", weight: 12, score: row.underRadarFactors?.find((item) => item.label === "Institutional ownership")?.score ?? 55, read: row.institutionalOwnership },
    { label: "Recently improving fundamentals", weight: 16, score: clamp(Math.round((rowScore(row, "Revenue acceleration") ?? 45) * 0.45 + (rowScore(row, "Operating leverage") ?? 45) * 0.35 + (rowScore(row, "Balance sheet survival") ?? 45) * 0.2)), read: "Uses growth, leverage, and survivability." },
    { label: "Small/mid-cap status", weight: 11, score: marketCapScore, read: row.marketCapDisplay },
    { label: "Misunderstood business model", weight: 10, score: /n\/a|unavailable/i.test(row.theme) ? 42 : 66, read: row.theme },
    { label: "Inflection not fully priced", weight: 10, score: row.score >= 70 && row.riskScore <= 60 ? 74 : row.score >= 60 ? 58 : 38, read: "Score/risk balance proxy; verify valuation manually." },
  ];
  return { score: weightedScore(components), components };
}

function pathLabel(row, multiple, proofScore, hiddenFactorScore) {
  const growth = Number.isFinite(row.revenueGrowth) ? row.revenueGrowth : 0;
  const cap = Number.isFinite(row.marketCap) ? row.marketCap : Infinity;
  const risk = row.riskScore ?? 100;
  const base = (row.score ?? 0) * 0.34 + proofScore * 0.28 + hiddenFactorScore * 0.16 + (100 - risk) * 0.14 + (row.gateScore ?? 0) * 0.08;
  if (multiple === 3) {
    if (base >= 68 && growth >= 20 && risk <= 68) return "realistic";
    if (base >= 54 && risk <= 78) return "stretched";
    return "unrealistic";
  }
  if (multiple === 5) {
    if (base >= 78 && growth >= 30 && risk <= 58 && cap <= 5_000_000_000) return "realistic";
    if (base >= 63 && growth >= 20 && risk <= 72) return "stretched";
    return "unrealistic";
  }
  if (base >= 86 && growth >= 40 && proofScore >= 78 && hiddenFactorScore >= 60 && risk <= 48 && cap <= 2_000_000_000) return "realistic";
  if (base >= 70 && growth >= 25 && risk <= 65 && cap <= 5_000_000_000) return "stretched";
  return "unrealistic";
}

function buildMultibaggerPath(row, proofScore, hiddenFactorScore) {
  const current = row.marketCap;
  const path3 = pathLabel(row, 3, proofScore, hiddenFactorScore);
  const path5 = pathLabel(row, 5, proofScore, hiddenFactorScore);
  const path10 = pathLabel(row, 10, proofScore, hiddenFactorScore);
  return {
    currentMarketCap: money(current),
    threeXMarketCap: money(Number.isFinite(current) ? current * 3 : null),
    fiveXMarketCap: money(Number.isFinite(current) ? current * 5 : null),
    tenXMarketCap: money(Number.isFinite(current) ? current * 10 : null),
    path3,
    path5,
    path10,
    operational3x: "Sustain above-market revenue growth, keep dilution controlled, and show margin or FCF improvement over the next several quarters.",
    operational5x: "Compound revenue for multiple years, prove operating leverage, convert catalysts into measurable revenue, and avoid balance-sheet stress.",
    operational10x: "Become a category leader in a large market with durable margins, strong execution, limited dilution, and a valuation re-rating backed by fundamentals.",
    overall: path3 === "realistic" && path5 !== "unrealistic" ? "credible early path" : path3 === "stretched" ? "needs more proof" : "not proven yet",
  };
}

function buildDilutionResearch(row) {
  const dilutionRisk = rowRisk(row, "Dilution risk");
  const dilutionControl = rowScore(row, "Dilution control");
  const riskLabel = Number.isFinite(dilutionRisk)
    ? dilutionRisk >= 65 ? "High" : dilutionRisk >= 45 ? "Medium" : "Low"
    : dilutionControl >= 70 ? "Low" : dilutionControl >= 50 ? "Medium" : "High";
  return {
    shareCountGrowth1y: row.dilutionTrend || "Unavailable",
    shareCountGrowth3y: "Unavailable - verify in SEC filings",
    shareCountGrowth5y: "Unavailable - verify in SEC filings",
    stockBasedCompensation: "Unavailable in scanner feed - check latest 10-K/10-Q",
    revenuePerShareTrend: proofValue(row, "Revenue per share growing"),
    recentOfferingsOrConvertibles: row.redFlags?.find((item) => /offering|convertible|warrant|atm|dilut/i.test(item)) || "No offering/convertible flag found in available feed.",
    dilutionRisk: riskLabel,
    read: row.dilutionCheck,
  };
}

function buildInflectionSignal(row) {
  const signals = [
    { label: "Revenue acceleration", passed: row.revenueGrowth >= 25 || rowScore(row, "Revenue acceleration") >= 70, value: row.revenueGrowthDisplay },
    { label: "Margin expansion", passed: rowScore(row, "Operating leverage") >= 70 || rowScore(row, "Gross margin quality") >= 75, value: row.scoreBreakdown?.find((item) => item.label === "Operating leverage")?.note ?? "Unavailable" },
    { label: "Operating loss narrowing", passed: row.earlyProof?.some((item) => item.label === "Operating losses narrowing / leverage improving" && item.passed), value: proofValue(row, "Operating losses narrowing / leverage improving") },
    { label: "Free cash flow improvement", passed: row.earlyProof?.some((item) => item.label === "FCF improving" && item.passed), value: proofValue(row, "FCF improving") },
    { label: "First profitable quarter", passed: /profit|profitable|positive earnings/i.test(`${row.catalyst} ${row.raw?.newsEngine?.items?.map((item) => item.title).join(" ")}`), value: "Headline proxy - verify earnings release." },
    { label: "Backlog growth", passed: /backlog|bookings|remaining performance/i.test(`${row.catalyst} ${row.businessModel}`), value: "Headline/report proxy." },
    { label: "Product adoption", passed: /customer|adoption|users|deployment|contract/i.test(`${row.catalyst} ${row.raw?.newsEngine?.items?.map((item) => item.title).join(" ")}`), value: "Headline/report proxy." },
    { label: "Major customer wins", passed: row.earlyProof?.some((item) => item.label === "Real signed customers or backlog" && item.passed), value: proofValue(row, "Real signed customers or backlog") },
    { label: "Sector tailwind", passed: /ai|cloud|semiconductor|cyber|energy|defense|data|automation|fintech|healthcare/i.test(`${row.theme} ${row.sector} ${row.catalyst}`), value: row.theme },
    { label: "Valuation reset after selloff", passed: row.raw?.technical?.score >= 45 && row.raw?.valuation?.score >= 55, value: row.raw?.valuation?.rating ?? "Unavailable" },
  ];
  const passed = signals.filter((item) => item.passed).length;
  const risk = row.riskScore ?? 100;
  const classification = passed >= 6 && risk <= 65
    ? "Strong inflection"
    : passed >= 4
      ? "Early inflection"
      : row.score < 45 || risk > 82
        ? "Broken inflection"
        : "No clear inflection";
  return { classification, signals };
}

function catalystStrength(text) {
  if (/contract|revenue|backlog|order|award|guidance|approval|customer|signed|earnings/i.test(text)) return "Strong";
  if (/partnership|launch|pilot|expansion|analyst|upgrade|tailwind|product/i.test(text)) return "Medium";
  return "Weak";
}

function buildCatalystTimeline(row) {
  const rawItems = [
    ...(row.raw?.report?.catalysts ?? []),
    ...(row.raw?.newsEngine?.items ?? []).filter((item) => item.catalyst).map((item) => item.title),
  ].filter(Boolean);
  const unique = [...new Set(rawItems)].slice(0, 8);
  const first = unique[0] || row.catalyst || "No confirmed catalyst found in available feed.";
  return {
    next3Months: [{ text: first, strength: catalystStrength(first) }],
    next6Months: unique.slice(1, 3).map((text) => ({ text, strength: catalystStrength(text) })),
    next12Months: unique.slice(3, 5).map((text) => ({ text, strength: catalystStrength(text) })),
    next24Months: [
      ...unique.slice(5, 8).map((text) => ({ text, strength: catalystStrength(text) })),
      { text: "Next two to four earnings reports must confirm growth, margin, cash flow, and dilution trends.", strength: "Strong" },
    ],
  };
}

function buildEntryQuality(row) {
  const technical = row.raw?.technical ?? {};
  const close = technical.close;
  const ma50 = technical.ema50;
  const ma200 = technical.ema150 ?? technical.ema200;
  const rsi = technical.rsi14;
  const high = technical.high55;
  const support = Number.isFinite(technical.stop) ? technical.stop : ma50;
  const resistance = Number.isFinite(technical.target) ? technical.target : high;
  const over50 = Number.isFinite(close) && Number.isFinite(ma50) ? close >= ma50 : null;
  const overLong = Number.isFinite(close) && Number.isFinite(ma200) ? close >= ma200 : null;
  const extended = Number.isFinite(rsi) && rsi >= 72;
  const nearHigh = Number.isFinite(close) && Number.isFinite(high) ? close >= high * 0.96 : false;
  const recentEarnings = /earnings|guidance|quarter/i.test(row.catalyst);
  let classification = "Wait for pullback";
  if ((row.riskScore ?? 100) > 78 || row.score < 50) classification = "Avoid";
  else if (over50 === false && overLong === false) classification = "Broken chart";
  else if (extended || nearHigh) classification = "Too extended";
  else if (recentEarnings && row.riskScore > 55) classification = "Wait for earnings";
  else if ((row.gateScore ?? 0) >= 70 && (row.proofScore ?? 0) >= 65 && (over50 || technical.score >= 60)) classification = "Ready for starter";
  return {
    classification,
    priceVs50Day: Number.isFinite(close) && Number.isFinite(ma50) ? `${pct(((close - ma50) / ma50) * 100)} vs 50-day EMA` : "Unavailable",
    priceVs200Day: Number.isFinite(close) && Number.isFinite(ma200) ? `${pct(((close - ma200) / ma200) * 100)} vs long-term EMA proxy` : "Unavailable",
    rsi: Number.isFinite(rsi) ? round(rsi, 1) : "Unavailable",
    support: Number.isFinite(support) ? `$${round(support, 2)}` : "Unavailable",
    resistance: Number.isFinite(resistance) ? `$${round(resistance, 2)}` : "Unavailable",
    volumeTrend: technical.rating ?? "Unavailable",
    highLowLocation: Number.isFinite(close) && Number.isFinite(high) ? `${pct((close / high) * 100)} of 55-day high` : "Unavailable",
    earningsReaction: recentEarnings ? "Earnings/guidance language found - wait for confirmation if volatility is elevated." : "No near-term earnings reaction found in scanner feed.",
  };
}

function buildKillCriteria(row) {
  return [
    `Revenue growth drops materially below the current ${row.revenueGrowthDisplay} trajectory or misses the growth thesis for two quarters.`,
    "Gross margin or operating leverage deteriorates instead of improving with scale.",
    "Free cash flow worsens and cash runway becomes dependent on unfavorable financing.",
    `Dilution accelerates beyond the current read: ${row.dilutionTrend}.`,
    "A major customer, backlog, product, or partnership catalyst fails to convert into real revenue.",
    `The stock breaks major long-term support near ${row.entryQuality?.support ?? "key support"} and fails to recover.`,
    "Balance sheet risk, filing/reporting risk, or hype/promotion risk moves into the red zone.",
  ];
}

function positionSizingCategory(row) {
  if (row.researchTier === "Reject / Too Many Red Flags" || row.score < 55 || row.riskScore > 75) return "Avoid";
  if (row.proofScore >= 78 && row.riskScore <= 45 && row.multibaggerPath?.path3 === "realistic") return "Core-quality growth candidate";
  if (row.proofScore >= 60 && row.riskScore <= 68 && row.multibaggerPath?.path3 !== "unrealistic") return "Small speculative basket candidate";
  return "Watchlist only";
}

function finalResearchVerdict(row) {
  if (row.positionSizingCategory === "Avoid") return "Avoid";
  if (row.researchTier === "Deep Research Candidate" && row.entryQuality?.classification === "Ready for starter") return "Research candidate";
  if (row.researchTier === "Deep Research Candidate") return "Deep research candidate";
  return "Watchlist only";
}

function buildResearchDesk(row) {
  const proof = buildProofScore(row);
  const hiddenFactor = buildHiddenFactorScore(row);
  row.proofScore = proof.score;
  row.proofComponents = proof.components;
  row.hiddenFactorScore = hiddenFactor.score;
  row.hiddenFactorComponents = hiddenFactor.components;
  row.multibaggerPath = buildMultibaggerPath(row, proof.score, hiddenFactor.score);
  row.dilutionResearch = buildDilutionResearch(row);
  row.inflectionSignal = buildInflectionSignal(row);
  row.catalystTimelineDesk = buildCatalystTimeline(row);
  row.entryQuality = buildEntryQuality(row);
  row.killCriteria = buildKillCriteria(row);
  row.positionSizingCategory = positionSizingCategory(row);
  row.finalResearchVerdict = finalResearchVerdict(row);
  row.bestPracticalApproach = row.positionSizingCategory === "Core-quality growth candidate"
    ? "Deep-research first; track as a top candidate and only size up after proof improves."
    : row.positionSizingCategory === "Small speculative basket candidate"
      ? "Use basket discipline: top 20 watchlist, top 5 deep research, top 3 starter candidates, add only after proof improves."
      : row.positionSizingCategory === "Watchlist only"
        ? "Do not force it. Wait for cleaner proof, better entry quality, or lower risk."
        : "Avoid until red flags clear and the business thesis becomes investable.";
  row.researchDeskScore = clamp(Math.round((row.score ?? 0) * 0.35 + proof.score * 0.25 + hiddenFactor.score * 0.15 + (row.gateScore ?? 0) * 0.15 + (100 - (row.riskScore ?? 100)) * 0.1));
  return row;
}

function passesInvestorMode(row) {
  if (!passesQualityMode(row)) return false;
  if ((row.institutionalReview?.hardFlags ?? []).some((item) => /very high|Failed|too weak|too high/i.test(item))) return false;
  if ((row.gateScore ?? 0) < 62) return false;
  if ((row.score ?? 0) < 60) return false;
  if ((row.riskScore ?? 100) > 68) return false;
  return ["Deep Research Candidate", "Watchlist - Needs Proof", "Track Only"].includes(row.researchTier);
}

function lightCandidate(row) {
  const { raw, ...rest } = row;
  return rest;
}

function scoreTone(score, inverse = false) {
  const number = Number(score);
  if (!Number.isFinite(number)) return "unavailable";
  const adjusted = inverse ? 100 - number : number;
  if (adjusted >= 70) return "pass";
  if (adjusted >= 45) return "near";
  return "fail";
}

function labelTone(label) {
  if (/realistic|ready|core|research candidate|strong|low|healthy/i.test(String(label))) return "pass";
  if (/stretched|wait|watch|medium|early|small speculative|needs/i.test(String(label))) return "near";
  if (/unrealistic|avoid|broken|high|too extended/i.test(String(label))) return "fail";
  return "near";
}

function listItems(items, fallback = "Unavailable.") {
  const rows = (items ?? []).filter(Boolean);
  return (rows.length ? rows : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function timelineItems(items) {
  const rows = (items ?? []).filter(Boolean);
  return rows.map((item) => `<li><strong>${escapeHtml(item.strength)}:</strong> ${escapeHtml(item.text)}</li>`).join("") || "<li>Unavailable.</li>";
}

function buildHtml({ rows, topFive, errors, qualityMode, investorMode, scanned, generatedAt }) {
  const payload = JSON.stringify({ rows, topFive, errors, qualityMode, investorMode, scanned, generatedAt }).replaceAll("</", "<\\/");
  const tableRows = rows.map((row) => `
    <tr data-sector="${escapeHtml(row.sector)}" data-score="${row.researchDeskScore ?? row.score}" data-risk="${row.riskScore}" data-market-cap="${row.marketCap}" data-quality="${row.qualityModePass ? "true" : "false"}" data-tier="${escapeHtml(row.researchTier)}">
      <td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.name)}</small></td>
      <td>${escapeHtml(row.sector)}</td>
      <td><span class="pill ${scoreTone(row.researchDeskScore)}">${Math.round(row.researchDeskScore ?? row.score)}</span><small>Research Desk</small></td>
      <td><span class="pill ${scoreTone(row.riskScore, true)}">${Math.round(row.riskScore)}</span></td>
      <td><span class="pill ${labelTone(row.positionSizingCategory)}">${escapeHtml(row.positionSizingCategory)}</span><small>${escapeHtml(row.finalResearchVerdict)}</small></td>
      <td><span class="pill ${labelTone(row.multibaggerPath?.path3)}">3x ${escapeHtml(row.multibaggerPath?.path3)}</span><small>5x ${escapeHtml(row.multibaggerPath?.path5)} / 10x ${escapeHtml(row.multibaggerPath?.path10)}</small></td>
      <td><span class="pill ${scoreTone(row.proofScore)}">${Math.round(row.proofScore ?? 0)}</span><small>Proof</small></td>
      <td><span class="pill ${scoreTone(row.hiddenFactorScore)}">${Math.round(row.hiddenFactorScore ?? 0)}</span><small>Hidden Factor</small></td>
      <td><span class="pill ${labelTone(row.inflectionSignal?.classification)}">${escapeHtml(row.inflectionSignal?.classification)}</span></td>
      <td><span class="pill ${labelTone(row.entryQuality?.classification)}">${escapeHtml(row.entryQuality?.classification)}</span></td>
      <td>${escapeHtml(row.marketCapDisplay)}</td>
      <td>${escapeHtml(row.revenueGrowthDisplay)}</td>
      <td>${escapeHtml(row.revenueCagr3Display)}</td>
      <td>${escapeHtml(row.grossMarginDisplay)}</td>
      <td>${escapeHtml(row.dilutionTrend)}</td>
      <td>${escapeHtml(row.cashDebt)}</td>
      <td>${escapeHtml(row.catalyst)}</td>
      <td>${escapeHtml(row.bullCase)}</td>
      <td>${escapeHtml(row.bearCase)}</td>
    </tr>
  `).join("");
  const cards = topFive.map((row, index) => `
    <details class="candidate-card" open>
      <summary>
        <span>#${index + 1} ${escapeHtml(row.symbol)} - ${escapeHtml(row.name)}</span>
        <strong>${Math.round(row.researchDeskScore ?? row.score)}/100 desk | ${Math.round(row.riskScore)}/100 risk | ${escapeHtml(row.finalResearchVerdict)}</strong>
      </summary>
      <div class="score-strip">
        <div><span>Hidden Score</span><strong>${Math.round(row.score)}</strong></div>
        <div><span>Proof Score</span><strong>${Math.round(row.proofScore ?? 0)}</strong></div>
        <div><span>Hidden Factor</span><strong>${Math.round(row.hiddenFactorScore ?? 0)}</strong></div>
        <div><span>Research Gates</span><strong>${Math.round(row.gateScore ?? 0)}</strong></div>
        <div><span>Category</span><strong>${escapeHtml(row.positionSizingCategory)}</strong></div>
      </div>
      <div class="card-grid">
        <div><span>Why it is interesting</span><p>${escapeHtml(row.multibaggerWhy)}</p></div>
        <div><span>Why it may be hidden</span><p>${escapeHtml(row.whyUnderRadar)}</p></div>
        <div><span>Business model</span><p>${escapeHtml(row.businessModel)}</p></div>
        <div><span>Best practical approach</span><p>${escapeHtml(row.bestPracticalApproach)}</p></div>
      </div>
      <h3>Multibagger Path</h3>
      <div class="path-grid">
        <div><span>Current market cap</span><strong>${escapeHtml(row.multibaggerPath?.currentMarketCap)}</strong><p>Today&apos;s base.</p></div>
        <div class="${labelTone(row.multibaggerPath?.path3)}"><span>3x path</span><strong>${escapeHtml(row.multibaggerPath?.threeXMarketCap)}</strong><p>${escapeHtml(row.multibaggerPath?.path3)}: ${escapeHtml(row.multibaggerPath?.operational3x)}</p></div>
        <div class="${labelTone(row.multibaggerPath?.path5)}"><span>5x path</span><strong>${escapeHtml(row.multibaggerPath?.fiveXMarketCap)}</strong><p>${escapeHtml(row.multibaggerPath?.path5)}: ${escapeHtml(row.multibaggerPath?.operational5x)}</p></div>
        <div class="${labelTone(row.multibaggerPath?.path10)}"><span>10x path</span><strong>${escapeHtml(row.multibaggerPath?.tenXMarketCap)}</strong><p>${escapeHtml(row.multibaggerPath?.path10)}: ${escapeHtml(row.multibaggerPath?.operational10x)}</p></div>
      </div>
      <div class="two">
        <section>
          <h3>Proof</h3>
          <div class="risk-grid compact">${(row.proofComponents ?? []).map((item) => `<div class="${scoreTone(item.score)}"><span>${escapeHtml(item.label)}</span><strong>${Math.round(item.score)}/100</strong><p>${escapeHtml(item.read)}</p></div>`).join("")}</div>
          <h3>Inflection Signal: ${escapeHtml(row.inflectionSignal?.classification)}</h3>
          <ul>${listItems((row.inflectionSignal?.signals ?? []).filter((item) => item.passed).map((item) => `${item.label}: ${item.value}`), "No strong inflection signal found yet.")}</ul>
          <h3>Dilution Check</h3>
          <ul>
            <li>1-year share growth: ${escapeHtml(row.dilutionResearch?.shareCountGrowth1y)}</li>
            <li>3-year share growth: ${escapeHtml(row.dilutionResearch?.shareCountGrowth3y)}</li>
            <li>5-year share growth: ${escapeHtml(row.dilutionResearch?.shareCountGrowth5y)}</li>
            <li>Stock-based compensation: ${escapeHtml(row.dilutionResearch?.stockBasedCompensation)}</li>
            <li>Revenue per share: ${escapeHtml(row.dilutionResearch?.revenuePerShareTrend)}</li>
            <li>Recent offerings/convertibles: ${escapeHtml(row.dilutionResearch?.recentOfferingsOrConvertibles)}</li>
            <li>Dilution risk: ${escapeHtml(row.dilutionResearch?.dilutionRisk)}</li>
          </ul>
        </section>
        <section>
          <h3>Catalyst Timeline</h3>
          <div class="timeline">
            <div><span>Next 3 months</span><ul>${timelineItems(row.catalystTimelineDesk?.next3Months)}</ul></div>
            <div><span>Next 6 months</span><ul>${timelineItems(row.catalystTimelineDesk?.next6Months)}</ul></div>
            <div><span>Next 12 months</span><ul>${timelineItems(row.catalystTimelineDesk?.next12Months)}</ul></div>
            <div><span>Next 24 months</span><ul>${timelineItems(row.catalystTimelineDesk?.next24Months)}</ul></div>
          </div>
          <h3>Entry Quality: ${escapeHtml(row.entryQuality?.classification)}</h3>
          <ul>
            <li>Price vs 50-day: ${escapeHtml(row.entryQuality?.priceVs50Day)}</li>
            <li>Price vs 200-day / long trend: ${escapeHtml(row.entryQuality?.priceVs200Day)}</li>
            <li>RSI: ${escapeHtml(row.entryQuality?.rsi)}</li>
            <li>Support: ${escapeHtml(row.entryQuality?.support)}</li>
            <li>Resistance: ${escapeHtml(row.entryQuality?.resistance)}</li>
            <li>52-week/high-low proxy: ${escapeHtml(row.entryQuality?.highLowLocation)}</li>
            <li>Recent earnings reaction: ${escapeHtml(row.entryQuality?.earningsReaction)}</li>
          </ul>
          <div class="bullbear">
            <div><span>Bull case</span><p>${escapeHtml(row.bullCase)}</p></div>
            <div><span>Bear case</span><p>${escapeHtml(row.bearCase)}</p></div>
          </div>
        </section>
      </div>
      <div class="two">
        <section>
          <h3>Kill Criteria</h3>
          <ul>${listItems(row.killCriteria, "No kill criteria generated.")}</ul>
        </section>
        <section>
          <h3>Final Verdict</h3>
          <p>${escapeHtml(row.finalResearchVerdict)}. ${escapeHtml(row.investorRead)}</p>
          <h3>Basket Discipline</h3>
          <ul>
            <li>Top 20 watchlist.</li>
            <li>Top 5 deep research.</li>
            <li>Top 3 starter candidates only after proof improves.</li>
            <li>Remove if thesis breaks.</li>
          </ul>
        </section>
      </div>
      <h3>Risk Heatmap</h3>
      <div class="risk-grid">${row.riskBreakdown.map((item) => `<div class="${scoreTone(item.score, true)}"><span>${escapeHtml(item.label)}</span><strong>${Math.round(item.score)}/100</strong><p>${escapeHtml(item.note)}</p></div>`).join("")}</div>
    </details>
  `).join("");
  const sectors = [...new Set(rows.map((row) => row.sector).filter(Boolean))].sort();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Multibagger Research Desk</title>
    <style>
      :root { color-scheme: dark; --bg:#071019; --panel:#101820; --panel2:#132232; --line:#26364a; --text:#f4fbff; --muted:#9db0c4; --green:#22c55e; --amber:#f59e0b; --red:#fb7185; --blue:#38bdf8; }
      body.light { color-scheme: light; --bg:#f8fafc; --panel:#ffffff; --panel2:#eef5fb; --line:#cbd5e1; --text:#0f172a; --muted:#475569; }
      * { box-sizing:border-box; }
      body { margin:0; background:var(--bg); color:var(--text); font-family: Inter, Segoe UI, Arial, sans-serif; }
      .shell { width:min(1500px, calc(100vw - 32px)); margin:0 auto; padding:28px 0 48px; }
      .hero, .panel, .candidate-card { border:1px solid var(--line); border-radius:10px; background:var(--panel); }
      .hero { padding:22px; background:linear-gradient(135deg, rgba(56,189,248,.15), rgba(34,197,94,.1), rgba(245,158,11,.08)); }
      .hero-top, .toolbar, .summary { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; flex-wrap:wrap; }
      h1, h2, h3, p { margin:0; }
      h1 { font-size:42px; line-height:1; letter-spacing:0; }
      h2 { margin:22px 0 10px; }
      h3 { margin:16px 0 8px; font-size:15px; }
      .eyebrow { color:var(--blue); font-size:12px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; margin-bottom:6px; }
      .muted, p, li, small { color:var(--muted); line-height:1.5; }
      button, input, select { border:1px solid var(--line); border-radius:7px; background:var(--panel2); color:var(--text); padding:10px 12px; font:inherit; font-weight:800; }
      button { cursor:pointer; }
      .quality-toggle { align-items:center; border:1px solid var(--line); border-radius:7px; background:var(--panel2); color:var(--text); display:inline-flex; gap:8px; padding:10px 12px; font-weight:900; }
      .quality-toggle input { min-width:auto; padding:0; }
      .summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); margin-top:16px; }
      .metric, .panel { padding:14px; }
      .metric { border:1px solid rgba(148,163,184,.18); border-radius:8px; background:rgba(15,23,42,.34); }
      .metric span, .card-grid span, .bullbear span, .risk-grid span, .path-grid span, .score-strip span, .timeline span { color:var(--muted); display:block; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
      .metric strong { display:block; font-size:26px; }
      .toolbar { margin:18px 0 10px; }
      .toolbar input { min-width:280px; }
      .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:10px; background:var(--panel); }
      table { width:100%; min-width:1600px; border-collapse:collapse; font-size:13px; }
      th, td { border-bottom:1px solid var(--line); padding:10px; text-align:left; vertical-align:top; }
      th { color:#b7cce2; cursor:pointer; font-size:11px; text-transform:uppercase; white-space:nowrap; }
      td strong { color:var(--text); }
      td small { display:block; margin-top:3px; }
      .pill { display:inline-flex; border-radius:999px; padding:4px 9px; font-weight:900; font-size:12px; }
      .pass { background:rgba(34,197,94,.16); color:#86efac; border-color:rgba(34,197,94,.35)!important; }
      .near { background:rgba(245,158,11,.17); color:#fde68a; border-color:rgba(245,158,11,.35)!important; }
      .fail { background:rgba(251,113,133,.16); color:#fecdd3; border-color:rgba(251,113,133,.35)!important; }
      .candidate-card { margin-top:14px; padding:0; overflow:hidden; }
      .candidate-card summary { align-items:center; cursor:pointer; display:flex; justify-content:space-between; gap:12px; padding:15px; }
      .candidate-card summary span { font-size:17px; font-weight:900; }
      .card-grid, .two, .risk-grid, .bullbear, .score-strip, .path-grid { display:grid; gap:10px; padding:0 15px 15px; }
      .card-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
      .score-strip { grid-template-columns:repeat(5,minmax(0,1fr)); padding-top:2px; }
      .score-strip div, .path-grid div, .timeline div { border:1px solid var(--line); border-radius:8px; background:rgba(148,163,184,.06); padding:10px; }
      .score-strip strong, .path-grid strong { display:block; font-size:20px; }
      .path-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
      .two { grid-template-columns:1fr 1fr; }
      .risk-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .risk-grid.compact { grid-template-columns:repeat(2,minmax(0,1fr)); padding:0; }
      .bullbear { grid-template-columns:1fr 1fr; padding:0; margin-top:10px; }
      .card-grid div, .risk-grid div, .bullbear div { border:1px solid var(--line); border-radius:8px; background:rgba(148,163,184,.06); padding:10px; }
      .timeline { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      ul { margin:0; padding-left:18px; }
      .hidden { display:none; }
      @media (max-width:900px) { .summary, .card-grid, .two, .risk-grid, .bullbear, .score-strip, .path-grid, .timeline { grid-template-columns:1fr; } h1 { font-size:32px; } }
      @media print { * { print-color-adjust:exact; -webkit-print-color-adjust:exact; } .toolbar, button { display:none!important; } body { background:#071019!important; } .shell { width:100%; padding:0; } .candidate-card, .panel, .hero { break-inside:avoid; } }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <p class="eyebrow">Research Watchlist Only</p>
            <h1>Multibagger Research Desk</h1>
            <p class="muted">Generated ${escapeHtml(generatedAt)}. U.S.-listed common-stock seed universe screened for realistic 3x, 5x, and 10x paths using proof, hidden-factor, dilution, inflection, entry-quality, and kill-criteria logic. No buy/sell recommendations.</p>
          </div>
          <button id="theme">Dark / Light</button>
        </div>
        <div class="summary">
          <div class="metric"><span>Scanned</span><strong>${scanned}</strong><p>Seed candidates reviewed</p></div>
          <div class="metric"><span>Passed Filters</span><strong>${rows.length}</strong><p>${investorMode ? "Investor mode enabled" : qualityMode ? "Quality mode enabled" : "Standard mode"}</p></div>
          <div class="metric"><span>Top Desk Score</span><strong>${rows[0] ? Math.round(rows[0].researchDeskScore ?? rows[0].score) : "n/a"}</strong><p>Research score blends hidden score, proof, gates, and risk</p></div>
          <div class="metric"><span>Data Caveat</span><strong>${errors.length}</strong><p>Symbols with missing/error data</p></div>
        </div>
      </section>
      <section class="panel" style="margin-top:14px">
        <p class="muted">This report avoids promotion and flags uncertainty. Investor Mode is the default: a candidate must clear quality checks, institutional research gates, and hard risk flags before it appears. The desk does not try to pick one magic winner: it builds a top 20 watchlist, top 5 deep-research list, and top 3 starter-candidate shortlist, then removes names when the thesis breaks.</p>
      </section>
      <div class="toolbar">
        <input id="search" placeholder="Search ticker, company, sector, catalyst..." />
        <select id="sector"><option value="">All sectors</option>${sectors.map((sector) => `<option>${escapeHtml(sector)}</option>`).join("")}</select>
        <select id="cap"><option value="">All market caps</option><option value="small">300M-2B</option><option value="mid">2B-10B</option></select>
        <select id="score"><option value="0">Any score</option><option value="60">60+</option><option value="70">70+</option><option value="80">80+</option></select>
        <select id="risk"><option value="100">Any risk</option><option value="70">Risk <= 70</option><option value="55">Risk <= 55</option><option value="40">Risk <= 40</option></select>
        <label class="quality-toggle"><input id="quality" type="checkbox" ${qualityMode ? "checked" : ""} /> Quality Mode</label>
        <button onclick="window.print()">Export / Print PDF</button>
      </div>
      <section class="table-wrap">
        <table id="candidate-table">
          <thead><tr>
            ${["Ticker","Sector","Desk Score","Risk","Category","Path","Proof","Hidden","Inflection","Entry","Market Cap","Rev Growth","3Y CAGR","Gross Margin","Dilution","Cash/Debt","Catalyst","Bull Case","Bear Case"].map((header) => `<th>${header}</th>`).join("")}
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>
      <h2>Detailed Cards: Top 5</h2>
      ${cards || `<section class="panel"><p class="muted">No candidates passed the current filters. Try standard mode or expand the universe file.</p></section>`}
      <section class="panel" style="margin-top:18px">
        <h2>Missing Or Uncertain Data</h2>
        <ul>${(errors.length ? errors : ["No scan errors. Some metrics can still be unavailable inside candidate rows."]).map((item) => `<li>${escapeHtml(item.symbol ? `${item.symbol}: ${item.error}` : item)}</li>`).join("")}</ul>
      </section>
    </main>
    <script id="scanner-data" type="application/json">${payload}</script>
    <script>
      const table = document.getElementById("candidate-table");
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      const search = document.getElementById("search");
      const sector = document.getElementById("sector");
      const cap = document.getElementById("cap");
      const score = document.getElementById("score");
      const risk = document.getElementById("risk");
      const quality = document.getElementById("quality");
      function applyFilters() {
        const q = search.value.trim().toLowerCase();
        const minScore = Number(score.value);
        const maxRisk = Number(risk.value);
        rows.forEach((row) => {
          const text = row.textContent.toLowerCase();
          const mc = Number(row.dataset.marketCap);
          const capOk = !cap.value || (cap.value === "small" ? mc >= 300000000 && mc < 2000000000 : mc >= 2000000000 && mc <= 10000000000);
          const show = (!q || text.includes(q)) &&
            (!sector.value || row.dataset.sector === sector.value) &&
            capOk &&
            Number(row.dataset.score) >= minScore &&
            Number(row.dataset.risk) <= maxRisk &&
            (!quality.checked || row.dataset.quality === "true");
          row.classList.toggle("hidden", !show);
        });
      }
      [search, sector, cap, score, risk, quality].forEach((control) => control.addEventListener("input", applyFilters));
      document.getElementById("theme").addEventListener("click", () => document.body.classList.toggle("light"));
      table.querySelectorAll("th").forEach((th, index) => {
        th.addEventListener("click", () => {
          const sorted = rows.slice().sort((a, b) => {
            const av = a.children[index].innerText.replace(/[$,%BMT]/g, "");
            const bv = b.children[index].innerText.replace(/[$,%BMT]/g, "");
            const an = Number(av);
            const bn = Number(bv);
            return Number.isFinite(an) && Number.isFinite(bn) ? bn - an : av.localeCompare(bv);
          });
          table.querySelector("tbody").append(...sorted);
        });
      });
    </script>
  </body>
</html>`;
}

async function main() {
  const universePath = getArg("universe", DEFAULT_UNIVERSE);
  const reportDir = getArg("report-dir", DEFAULT_REPORT_DIR);
  const max = Number(getArg("max", "80"));
  const investorMode = boolArg("investor-mode", true);
  const qualityMode = boolArg("quality-mode", investorMode);
  const records = loadUniverseRecords(universePath)
    .filter((record) => isUsCommonStockSymbol(String(record.symbol ?? "").toUpperCase()))
    .slice(0, max);
  const rows = [];
  const errors = [];

  console.log(`Scanning ${records.length} U.S. hidden-multibagger seed candidates...`);
  console.log(`Mode: ${investorMode ? "investor" : qualityMode ? "quality" : "standard"}`);
  for (const record of records) {
    const symbol = String(record.symbol ?? "").toUpperCase();
    try {
      const analysis = await analyzeStock(symbol);
      const row = candidateFromAnalysis(analysis, record);
      row.initialFilterPass = passesInitialFilters(row);
      row.qualityModePass = passesQualityMode(row);
      row.investorModePass = passesInvestorMode(row);
      const pass = investorMode ? row.investorModePass : qualityMode ? row.qualityModePass : row.initialFilterPass;
      if (pass) rows.push(row);
      console.log(`${symbol}: ${Math.round(row.score)} score / ${Math.round(row.riskScore)} risk / ${row.researchTier}${pass ? "" : " (filtered)"}`);
    } catch (error) {
      errors.push({ symbol, error: error.message });
      console.log(`${symbol}: ERROR ${error.message}`);
    }
  }

  rows.sort((a, b) => Number(b.researchDeskScore ?? b.score) - Number(a.researchDeskScore ?? a.score) || Number(a.riskScore) - Number(b.riskScore) || a.symbol.localeCompare(b.symbol));
  const topRows = rows.slice(0, 20);
  const topFive = topRows.slice(0, 5);
  const generatedAt = new Date().toISOString();
  const html = buildHtml({
    rows: topRows.map(lightCandidate),
    topFive: topFive.map(lightCandidate),
    errors,
    qualityMode,
    investorMode,
    scanned: records.length,
    generatedAt,
  });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "hidden_multibagger_discovery_scanner.html"), html, "utf8");
  fs.writeFileSync(path.join(reportDir, "hidden_multibagger_discovery_scanner.json"), JSON.stringify({
    generatedAt,
    qualityMode,
    investorMode,
    scanned: records.length,
    candidates: topRows.map(lightCandidate),
    errors,
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "hidden_multibagger_discovery_scanner.csv"), toCsv(topRows.map(lightCandidate)), "utf8");

  console.table(topRows.slice(0, 20).map((row) => ({
    symbol: row.symbol,
    desk: Math.round(row.researchDeskScore ?? row.score),
    score: Math.round(row.score),
    proof: Math.round(row.proofScore ?? 0),
    hidden: Math.round(row.hiddenFactorScore ?? 0),
    risk: Math.round(row.riskScore),
    cap: row.marketCapDisplay,
    growth: row.revenueGrowthDisplay,
    cagr: row.revenueCagr3Display,
    path3x: row.multibaggerPath?.path3,
    entry: row.entryQuality?.classification,
    category: row.positionSizingCategory,
  })));
  console.log(`Wrote ${path.join(reportDir, "hidden_multibagger_discovery_scanner.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
