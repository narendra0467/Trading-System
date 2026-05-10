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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvEscape(value) {
  const text = String(value ?? "");
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

function buildHtml({ rows, topFive, errors, qualityMode, investorMode, scanned, generatedAt }) {
  const payload = JSON.stringify({ rows, topFive, errors, qualityMode, investorMode, scanned, generatedAt }).replaceAll("</", "<\\/");
  const tableRows = rows.map((row) => `
    <tr data-sector="${escapeHtml(row.sector)}" data-score="${row.score}" data-risk="${row.riskScore}" data-market-cap="${row.marketCap}" data-quality="${row.qualityModePass ? "true" : "false"}" data-tier="${escapeHtml(row.researchTier)}">
      <td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.name)}</small></td>
      <td>${escapeHtml(row.sector)}</td>
      <td><span class="pill ${scoreTone(row.gateScore)}">${escapeHtml(row.researchTier)}</span><small>Gate ${Math.round(row.gateScore ?? 0)}/100</small></td>
      <td>${escapeHtml(row.marketCapDisplay)}</td>
      <td>${escapeHtml(row.revenueGrowthDisplay)}</td>
      <td>${escapeHtml(row.revenueCagr3Display)}</td>
      <td>${escapeHtml(row.grossMarginDisplay)}</td>
      <td>${escapeHtml(row.fcfTrend)}</td>
      <td>${escapeHtml(row.dilutionTrend)}</td>
      <td>${escapeHtml(row.cashDebt)}</td>
      <td>${escapeHtml(row.analystCoverageDisplay)}</td>
      <td>${escapeHtml(row.institutionalOwnership)}</td>
      <td>${escapeHtml(row.insiderOwnership)}</td>
      <td>${escapeHtml(row.catalyst)}</td>
      <td><span class="pill ${scoreTone(row.score)}">${Math.round(row.score)}</span></td>
      <td><span class="pill ${scoreTone(row.riskScore, true)}">${Math.round(row.riskScore)}</span></td>
      <td>${escapeHtml(row.bullCase)}</td>
      <td>${escapeHtml(row.bearCase)}</td>
    </tr>
  `).join("");
  const cards = topFive.map((row, index) => `
    <details class="candidate-card" open>
      <summary>
        <span>#${index + 1} ${escapeHtml(row.symbol)} - ${escapeHtml(row.researchTier)}</span>
        <strong>${Math.round(row.score)}/100 score | ${Math.round(row.riskScore)}/100 risk | ${Math.round(row.gateScore ?? 0)}/100 gates</strong>
      </summary>
      <div class="card-grid">
        <div><span>Business model</span><p>${escapeHtml(row.businessModel)}</p></div>
        <div><span>Why under the radar</span><p>${escapeHtml(row.whyUnderRadar)}</p></div>
        <div><span>Why it could become a multibagger</span><p>${escapeHtml(row.multibaggerWhy)}</p></div>
        <div><span>Top 1% investor read</span><p>${escapeHtml(row.investorRead)}</p></div>
      </div>
      <h3>Institutional Research Gates</h3>
      <div class="risk-grid">${(row.institutionalReview?.gates ?? []).map((item) => `<div class="${item.status === "pass" ? "pass" : item.status === "warn" ? "near" : "fail"}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.status.toUpperCase())}</strong><p>${escapeHtml(item.note)}</p></div>`).join("")}</div>
      <div class="two">
        <section>
          <h3>Proof Already Visible</h3>
          <ul>${(row.proof.length ? row.proof : ["Proof is limited or unavailable."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h3>What Has To Happen Next</h3>
          <ul>${row.mustHappen.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h3>Catalyst Timeline: 12-24 Months</h3>
          <ul>${(row.catalystTimeline.length ? row.catalystTimeline : ["No verified catalyst timeline from available feed."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h3>Upgrade Triggers</h3>
          <ul>${(row.institutionalReview?.nextReviewTriggers ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
        <section>
          <h3>Hard Flags</h3>
          <ul>${((row.institutionalReview?.hardFlags?.length ? row.institutionalReview.hardFlags : row.redFlags).length ? (row.institutionalReview?.hardFlags?.length ? row.institutionalReview.hardFlags : row.redFlags) : ["No hard rejection flags from available fields."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h3>Dilution Check</h3>
          <p>${escapeHtml(row.dilutionCheck)}</p>
          <h3>Balance Sheet Check</h3>
          <p>${escapeHtml(row.balanceSheetCheck)}</p>
          <h3>Filing Homework</h3>
          <ul>${(row.institutionalReview?.filingHomework ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <div class="bullbear">
            <div><span>Bull case</span><p>${escapeHtml(row.bullCase)}</p></div>
            <div><span>Bear case</span><p>${escapeHtml(row.bearCase)}</p></div>
          </div>
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
    <title>Hidden Multibagger Discovery Scanner</title>
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
      .metric span, .card-grid span, .bullbear span, .risk-grid span { color:var(--muted); display:block; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
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
      .card-grid, .two, .risk-grid, .bullbear { display:grid; gap:10px; padding:0 15px 15px; }
      .card-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
      .two { grid-template-columns:1fr 1fr; }
      .risk-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .bullbear { grid-template-columns:1fr 1fr; padding:0; margin-top:10px; }
      .card-grid div, .risk-grid div, .bullbear div { border:1px solid var(--line); border-radius:8px; background:rgba(148,163,184,.06); padding:10px; }
      ul { margin:0; padding-left:18px; }
      .hidden { display:none; }
      @media (max-width:900px) { .summary, .card-grid, .two, .risk-grid, .bullbear { grid-template-columns:1fr; } h1 { font-size:32px; } }
      @media print { * { print-color-adjust:exact; -webkit-print-color-adjust:exact; } .toolbar, button { display:none!important; } body { background:#071019!important; } .shell { width:100%; padding:0; } .candidate-card, .panel, .hero { break-inside:avoid; } }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <p class="eyebrow">Research Watchlist Only</p>
            <h1>Hidden Multibagger Discovery Scanner</h1>
            <p class="muted">Generated ${escapeHtml(generatedAt)}. U.S.-listed common-stock seed universe screened for under-the-radar early-stage multibagger potential. No buy/sell recommendations.</p>
          </div>
          <button id="theme">Dark / Light</button>
        </div>
        <div class="summary">
          <div class="metric"><span>Scanned</span><strong>${scanned}</strong><p>Seed candidates reviewed</p></div>
          <div class="metric"><span>Passed Filters</span><strong>${rows.length}</strong><p>${investorMode ? "Investor mode enabled" : qualityMode ? "Quality mode enabled" : "Standard mode"}</p></div>
          <div class="metric"><span>Top Score</span><strong>${rows[0] ? Math.round(rows[0].score) : "n/a"}</strong><p>Hidden Multibagger Score</p></div>
          <div class="metric"><span>Data Caveat</span><strong>${errors.length}</strong><p>Symbols with missing/error data</p></div>
        </div>
      </section>
      <section class="panel" style="margin-top:14px">
        <p class="muted">This report avoids promotion and flags uncertainty. Investor Mode is the default: a candidate must clear quality checks, institutional research gates, and hard risk flags before it appears. SEC company facts and Yahoo SEC filing links are used when available, but investor-grade verification still requires reading the latest 10-K/10-Q/8-K.</p>
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
            ${["Ticker","Sector","IC Tier","Market Cap","Rev Growth","3Y CAGR","Gross Margin","FCF Trend","Dilution","Cash/Debt","Analysts","Institutions","Insiders","Catalyst","Score","Risk","Bull Case","Bear Case"].map((header) => `<th>${header}</th>`).join("")}
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

  rows.sort((a, b) => Number(b.score) - Number(a.score) || Number(a.riskScore) - Number(b.riskScore) || a.symbol.localeCompare(b.symbol));
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
    score: Math.round(row.score),
    risk: Math.round(row.riskScore),
    cap: row.marketCapDisplay,
    growth: row.revenueGrowthDisplay,
    cagr: row.revenueCagr3Display,
    gates: Math.round(row.gateScore ?? 0),
    tier: row.researchTier,
  })));
  console.log(`Wrote ${path.join(reportDir, "hidden_multibagger_discovery_scanner.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
