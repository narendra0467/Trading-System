const format = (value) => value ?? "";
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "n/a";
};
const wholeMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(0)}` : "n/a";
};
const dateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "n/a"
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
};
let latestAnalyzerPrintTitle = "Stock analysis report";

function pill(value) {
  const text = String(value ?? "");
  const className =
    text.includes("SETUP") ||
    text.includes("Bullish") ||
    value === "RISK_ON"
      ? "pill good"
      : text.includes("Bearish") || text.includes("SHORT") || text.includes("EXIT")
        ? "pill bad"
        : "pill warn";
  return `<span class="${className}">${format(value)}</span>`;
}


function pct(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : "n/a";
}

function bigMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (Math.abs(number) >= 1_000_000_000_000) return `$${(number / 1_000_000_000_000).toFixed(2)}T`;
  if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  return money(number);
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "n/a";
}

function growthStatusPill(status) {
  return `<span class="growth-status growth-status--${status || "unavailable"}">${String(status || "unavailable").toUpperCase()}</span>`;
}

function scoreTone(score, inverse = false) {
  const number = Number(score);
  if (!Number.isFinite(number)) return "neutral";
  const adjusted = inverse ? 100 - number : number;
  if (adjusted >= 70) return "good";
  if (adjusted >= 45) return "caution";
  return "bad";
}

function riskLevel(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return "Unavailable";
  if (number < 35) return "Low";
  if (number < 55) return "Moderate";
  if (number < 75) return "Elevated";
  return "Very high";
}

function reportMeter(label, score, helper, inverse = false) {
  const number = Number(score);
  const value = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
  return `
    <div class="report-meter report-meter--${scoreTone(score, inverse)}">
      <div><span>${escapeHtml(label)}</span><strong>${Number.isFinite(number) ? Math.round(number) : "n/a"}/100</strong></div>
      <div class="meter-track"><span style="width:${value}%"></span></div>
      <p>${escapeHtml(helper)}</p>
    </div>
  `;
}

function metricCard(row) {
  if (!row) return "";
  return `
    <div class="metric-card metric-card--${row.status}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.display)}</strong>
      <p>Ideal: ${escapeHtml(row.ideal)}</p>
      ${growthStatusPill(row.status)}
    </div>
  `;
}

function kpiCard(row) {
  if (!row) return "";
  return `
    <div class="kpi-card kpi-card--${row.status || "unavailable"}" title="${escapeHtml(row.tooltip || row.note || "")}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.display)}</strong>
    </div>
  `;
}

function advisorCard(row) {
  if (!row) return "";
  return `
    <div class="metric-card metric-card--${row.status || "near"}">
      <span>${escapeHtml(row.label)}</span>
      <p>${escapeHtml(row.value)}</p>
    </div>
  `;
}

function riskHeatCell(row) {
  const score = Number(row.score);
  const tone = score >= 70 ? "fail" : score >= 45 ? "near" : "pass";
  return `
    <div class="risk-heat risk-heat--${tone}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${Number.isFinite(score) ? Math.round(score) : "n/a"}/100</strong>
      <p>${escapeHtml(row.note || "")}</p>
    </div>
  `;
}

function hiddenScoreBar(item) {
  const score = Number(item.score);
  return `
    <div>
      <div><span>${escapeHtml(item.label)} (${item.weight ?? ""}${item.weight ? " pts" : ""})</span><strong>${Number.isFinite(score) ? Math.round(score) : "n/a"}/100</strong></div>
      <div class="meter-track"><span style="width:${Math.max(0, Math.min(100, score || 0))}%"></span></div>
      <p>${escapeHtml(item.note || "")}</p>
    </div>
  `;
}

function proofPill(passed) {
  return `<span class="growth-status growth-status--${passed ? "pass" : "fail"}">${passed ? "PROOF" : "NOT YET"}</span>`;
}

function renderHiddenMultibagger(result) {
  const hunter = result.hiddenMultibagger;
  if (!hunter) return "";
  return `
    <section class="hidden-hunter">
      <div class="section-title">
        <div>
          <p class="eyebrow">Asymmetric Research</p>
          <h3>Hidden Multibagger Hunter</h3>
          <p class="muted">Separates real business progress from hype. This is not a buy/sell recommendation.</p>
        </div>
        <span class="growth-status growth-status--${hunter.score >= 70 ? "pass" : hunter.score >= 50 ? "near" : "fail"}">${escapeHtml(hunter.classification)}</span>
      </div>
      <div class="kpi-strip">
        ${reportMeter("Multibagger Potential", hunter.score, "Early-stage upside score from growth, TAM, margins, leverage, survival, dilution, moat, catalysts, and under-the-radar status.")}
        ${reportMeter("Multibagger Risk", hunter.riskScore, "Separate downside score for dilution, burn, balance sheet, valuation, hype, liquidity, filings, and insider risk.", true)}
        ${reportMeter("Under-the-Radar", hunter.underRadarScore, "Higher means the company appears less discovered by analysts, institutions, media, or trading volume.")}
      </div>
      <div class="hidden-thesis-grid">
        <div><span>Classification read</span><p>${escapeHtml(hunter.classificationReason || "Use this as a research filter, not a buy/sell recommendation.")}</p></div>
        <div><span>Upside case</span><p>${escapeHtml(hunter.upsideCase)}</p></div>
        <div><span>Downside case</span><p>${escapeHtml(hunter.downsideCase)}</p></div>
      </div>
      <h3>Multibagger Score Breakdown</h3>
      <div class="score-bars hidden-score-bars">${(hunter.scoreBreakdown ?? []).map(hiddenScoreBar).join("")}</div>
      <h3>Early Proof Checklist</h3>
      <div class="proof-grid">
        ${(hunter.earlyProof ?? []).map((item) => `
          <div>
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            ${proofPill(item.passed)}
          </div>
        `).join("")}
      </div>
      <h3>Under-the-Radar Checks</h3>
      <div class="metric-card-grid metric-card-grid--advisor">
        ${(hunter.underRadarFactors ?? []).map((item) => advisorCard({ label: `${item.label}: ${Number.isFinite(Number(item.score)) ? Math.round(item.score) : "n/a"}/100`, status: item.score >= 70 ? "pass" : item.score >= 45 ? "near" : "fail", value: `${item.value}. ${item.note}` })).join("")}
      </div>
      <h3>Multibagger Risk Map</h3>
      <div class="risk-heatmap">${(hunter.riskBreakdown ?? []).map(riskHeatCell).join("")}</div>
      <h3>What Must Happen For The Thesis To Become Real</h3>
      <ul class="plain-list">${(hunter.mustHappen ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p class="muted">${escapeHtml(hunter.caveat || "")}</p>
    </section>
  `;
}

function peerTable(rows = []) {
  if (!rows.length) return `<p class="empty">Peer data was unavailable.</p>`;
  return `
    <div class="table-wrap peer-table">
      <table>
        <thead><tr><th>Peer</th><th>Market Cap</th><th>Rev Growth</th><th>Gross Margin</th><th>Op Margin</th><th>P/E</th><th>Fwd P/E</th><th>P/S</th><th>EV/EBITDA</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr class="${row.isTarget ? "peer-target" : ""}">
              <td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.name || "")}</small></td>
              <td>${bigMoney(row.marketCap)}</td>
              <td>${pct(row.revenueGrowth)}</td>
              <td>${pct(row.grossMargin)}</td>
              <td>${pct(row.operatingMargin)}</td>
              <td>${format(row.trailingPE)}</td>
              <td>${format(row.forwardPE)}</td>
              <td>${format(row.ps)}</td>
              <td>${format(row.evEbitda)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

const CLIENT_PEER_RULES = [
  {
    pattern: /(beverage|energy drink|non-alcoholic|soft drink|functional drink|celsius|consumer defensive)/i,
    groups: {
      directOperating: [["MNST", "Monster Beverage", "Energy drink operating peer."], ["PEP", "PepsiCo", "Beverage distribution and portfolio peer."], ["KDP", "Keurig Dr Pepper", "North American beverage peer."], ["FIZZ", "National Beverage", "Public beverage-brand peer."], ["VITA", "Vita Coco", "Functional beverage peer."]],
      publicValuation: [["MNST", "Monster Beverage", "Closest scaled energy-drink valuation peer."], ["KO", "Coca-Cola", "Global beverage franchise anchor."], ["PEP", "PepsiCo", "Global beverage/snack anchor."], ["KDP", "Keurig Dr Pepper", "Beverage portfolio comp."], ["FIZZ", "National Beverage", "Smaller beverage comp."]],
      adjacentStrategic: [["KO", "Coca-Cola", "Strategic distribution and brand benchmark."], ["PEP", "PepsiCo", "Distribution and shelf-space benchmark."], ["", "Red Bull", "Private energy-drink leader; strategic context only."], ["", "Ghost / Alani Nu / Rockstar", "Private or portfolio brands; category context only."]],
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
    pattern: /(software|application|cloud|internet|platform|data|cybersecurity)/i,
    groups: {
      directOperating: [["MSFT", "Microsoft", "Software/cloud platform peer."], ["ORCL", "Oracle", "Enterprise software/cloud peer."], ["CRM", "Salesforce", "Application software peer."]],
      publicValuation: [["MSFT", "Microsoft", "Mega-cap software anchor."], ["ADBE", "Adobe", "High-margin software comp."], ["NOW", "ServiceNow", "Premium workflow software comp."]],
      adjacentStrategic: [["GOOGL", "Alphabet", "Cloud/AI/ads adjacency."], ["AMZN", "Amazon", "AWS/platform adjacency."], ["META", "Meta Platforms", "AI platform adjacency."]],
    },
  },
  {
    pattern: /(bank|credit|financial|capital markets|fintech|payments)/i,
    groups: {
      directOperating: [["JPM", "JPMorgan Chase", "Scaled banking/financial peer."], ["BAC", "Bank of America", "Large bank peer."], ["C", "Citigroup", "Global bank peer."]],
      publicValuation: [["JPM", "JPMorgan Chase", "Quality bank anchor."], ["GS", "Goldman Sachs", "Capital-markets comp."], ["MS", "Morgan Stanley", "Capital-markets/wealth comp."]],
      adjacentStrategic: [["V", "Visa", "Payments adjacency."], ["MA", "Mastercard", "Payments adjacency."], ["PYPL", "PayPal", "Digital payments contrast."]],
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
];

function normalizePeerGroups(result) {
  const symbol = String(result.symbol ?? "").toUpperCase();
  const reportGroups = result.report?.peerGroups;
  const text = [result.name, result.business?.sector, result.business?.industry, result.business?.theme, result.report?.businessModel, result.report?.coreProduct].join(" ");
  const selected = reportGroups || CLIENT_PEER_RULES.find((rule) => rule.pattern.test(text))?.groups || {
    directOperating: [["SPY", "S&P 500 ETF", "Broad market benchmark until direct peers are validated."]],
    publicValuation: [["QQQ", "Nasdaq 100 ETF", "Growth benchmark until valuation peers are validated."]],
    adjacentStrategic: [],
  };
  const convert = (rows = []) => rows
    .map((row) => Array.isArray(row) ? { symbol: row[0], name: row[1], reason: row[2], isPublic: Boolean(row[0]) } : row)
    .filter((row) => String(row.symbol ?? "").toUpperCase() !== symbol);
  return {
    directOperating: convert(selected.directOperating),
    publicValuation: convert(selected.publicValuation),
    adjacentStrategic: convert(selected.adjacentStrategic),
  };
}

function peerGroupTable(groups) {
  const rows = [
    ["Direct operating peers", groups.directOperating],
    ["Public valuation peers", groups.publicValuation],
    ["Adjacent strategic peers", groups.adjacentStrategic],
  ].flatMap(([group, peers]) => peers.map((peer) => ({ group, ...peer })));
  return `
    <div class="table-wrap peer-table">
      <table>
        <thead><tr><th>Group</th><th>Ticker</th><th>Company / brand</th><th>Why included</th></tr></thead>
        <tbody>${rows.map((peer) => `
          <tr>
            <td>${escapeHtml(peer.group)}</td>
            <td><strong>${escapeHtml(peer.symbol || "Private / portfolio")}</strong></td>
            <td>${escapeHtml(peer.name || "")}</td>
            <td>${escapeHtml(peer.reason || "Industry context.")}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function filteredPeerComparison(result) {
  const groups = normalizePeerGroups(result);
  const allowed = new Set([...groups.directOperating, ...groups.publicValuation].map((peer) => String(peer.symbol || "").toUpperCase()).filter(Boolean));
  return (result.peerComparison ?? []).filter((row) => row.isTarget || allowed.has(String(row.symbol || "").toUpperCase()));
}

function institutionalMemo(result, context) {
  const checklist = result.growthChecklist ?? {};
  const report = result.report ?? {};
  const technical = result.technical ?? {};
  const valuation = result.valuation ?? {};
  const groups = normalizePeerGroups(result);
  const currentPrice = Number(result.currentPrice ?? technical.close);
  const support = Number(technical.stop ?? technical.low55);
  const resistance = Number(technical.target ?? technical.high55);
  const starter = Number.isFinite(currentPrice) ? currentPrice : null;
  const pullback = Number.isFinite(support) ? support : Number.isFinite(currentPrice) ? currentPrice * 0.92 : null;
  const breakout = Number.isFinite(resistance) ? resistance : Number.isFinite(currentPrice) ? currentPrice * 1.08 : null;
  const fairLow = Number.isFinite(currentPrice) ? currentPrice * (valuation.score >= 55 ? 0.95 : 0.8) : null;
  const fairHigh = Number.isFinite(currentPrice) ? currentPrice * (checklist.isGrowthStock ? 1.35 : 1.15) : null;
  return `
    <section class="institutional-memo">
      <h3>A. Executive Summary</h3>
      <div class="report-grid">
        <div><span>Bull thesis</span><p>${escapeHtml(report.bullCase || "Bull case needs more company-specific proof.")}</p></div>
        <div><span>Bear thesis</span><p>${escapeHtml(report.bearCase || "Bear case needs more company-specific proof.")}</p></div>
        <div><span>Base-case view</span><p>${escapeHtml(result.managerRead || report.shortAnalysis || "Use as research, not a buy/sell instruction.")}</p></div>
        <div><span>Rating / Confidence / Risk</span><p>${escapeHtml(result.investigateFurther || result.decision || "Watchlist")} | Confidence ${Math.round(Number(context.reportScores.overallScore ?? result.totalScore ?? 0))}/100 | Risk ${Math.round(Number(result.riskScore ?? 0))}/100</p></div>
      </div>
      <h3>B. Business Model</h3>
      <p>${escapeHtml(report.businessModel || result.business?.plainEnglish || "Business model unavailable.")}</p>
      <div class="metric-card-grid metric-card-grid--advisor">
        ${advisorCard({ label: "Sector / industry", value: `${result.business?.sector || "n/a"} / ${result.business?.industry || "n/a"}` })}
        ${advisorCard({ label: "Revenue stream", value: report.coreProduct || "Use filings to confirm revenue mix." })}
        ${advisorCard({ label: "Customer / distribution", value: result.business?.theme || "Use filings to confirm customer and distribution model." })}
      </div>
      <h3>C. Industry & Competitive Position</h3>
      ${peerGroupTable(groups)}
      <p>${escapeHtml(report.peerValidation || "Peers are grouped by operating relevance first; broad-market or adjacent peers are labeled separately.")}</p>
      <h3>D. Financial Analysis</h3>
      <div class="metric-card-grid">${context.healthRows.map(metricCard).join("")}${context.growthRows.map(metricCard).join("")}</div>
      <h3>E. Valuation</h3>
      <div class="metric-card-grid">${context.valuationRows.map(metricCard).join("")}</div>
      <p>Fair value framework: ${money(fairLow)} to ${money(fairHigh)} from current available market data. Missing valuation fields stay marked unavailable.</p>
      <h3>F. Catalysts</h3>
      <ul class="plain-list">${(report.catalysts ?? []).slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No specific catalyst found in the published data.</li>"}</ul>
      <h3>G. Risks</h3>
      <div class="risk-heatmap">${context.riskRows.map(riskHeatCell).join("")}</div>
      <h3>H. Technical Analysis</h3>
      <div class="metric-card-grid metric-card-grid--advisor">
        ${advisorCard({ label: "Trend", status: technical.score >= 60 ? "pass" : technical.score >= 45 ? "near" : "fail", value: `${technical.rating || "n/a"} trend. Price ${money(currentPrice)}, EMA50 ${money(technical.ema50)}, EMA150 ${money(technical.ema150)}.` })}
        ${advisorCard({ label: "Momentum", status: technical.rsi14 >= 50 ? "pass" : "near", value: `RSI ${technical.rsi14 ?? "n/a"}, ADX ${technical.adx14 ?? "n/a"}, relative strength ${technical.relativeStrength60 ?? "n/a"}%.` })}
        ${advisorCard({ label: "Support / resistance", value: `Support/invalidation near ${money(pullback)}; breakout/reference target near ${money(breakout)}.` })}
      </div>
      <h3>I. Position Sizing Plan</h3>
      <table><tbody>
        <tr><th>Starter position</th><td>20%-25% near ${money(starter)} only if thesis and chart are acceptable.</td></tr>
        <tr><th>Add on pullback</th><td>25%-30% near ${money(pullback)} if fundamentals remain intact.</td></tr>
        <tr><th>Add on breakout</th><td>25%-30% above ${money(breakout)} with volume/earnings confirmation.</td></tr>
        <tr><th>Cash reserve</th><td>20%-30% for volatility, earnings, or better valuation.</td></tr>
        <tr><th>Invalidation</th><td>Reassess if support breaks or the next filing contradicts the thesis.</td></tr>
      </tbody></table>
      <h3>J. Final Verdict</h3>
      <p>${escapeHtml(report.shortAnalysis || result.managerRead || "Research verdict unavailable.")}</p>
      <p><strong>What must happen:</strong> Revenue, margins, valuation, and technical trend must support the same thesis; if any are missing, keep it as watchlist research.</p>
    </section>
  `;
}

function rowsByLabel(checklist, labels) {
  return labels.map((label) => checklist?.rows?.find((row) => row.label === label)).filter(Boolean);
}

// ─── helper: round to N decimal places ───────────────────────────────────────
function round(value, decimals = 1) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(decimals)) : null;
}

function renderReportSection(result) {
  // Derive fallback scorecard from existing fields when seniorScorecard is missing (old cache / old API)
  function deriveFallbackScorecard(r) {
    const f = r.fundamentals ?? {};
    const t = r.technical ?? {};
    const v = r.valuation ?? {};
    const m = r.moat ?? {};
    const rs = r.reportScores ?? {};
    const bq = Math.round(Math.min(100, Math.max(0, f.score ?? 35)));
    const tq = Math.round(Math.min(100, Math.max(0, t.score ?? 35)));
    const moatS = Math.round(Math.min(100, Math.max(0, m.score ?? 40)));
    const growth = Math.round(Math.min(100, Math.max(0, rs.growthPotential ?? r.growthPotential ?? 40)));
    const vRisk = Number.isFinite(v.score) ? Math.round(Math.min(100, Math.max(0, 100 - v.score))) : 55;
    const riskS = Math.round(Math.min(100, Math.max(0, rs.riskScore ?? r.riskScore ?? 50)));
    const analystS = Math.round(Math.min(100, Math.max(0, r.analysts?.score ?? 45)));
    const total = Math.round(Math.min(100, Math.max(0, r.totalScore ?? 0)));
    const conf = Math.round(bq * 0.35 + moatS * 0.35 + growth * 0.30);
    return {
      overallLongTermScore: total,
      businessQualityScore: bq,
      revenueGrowthScore: growth,
      marginQualityScore: bq,
      freeCashFlowScore: Math.max(0, bq - 5),
      balanceSheetScore: 50,
      moatScore: moatS,
      managementScore: analystS,
      valuationRiskScore: vRisk,
      earningsRiskScore: 45,
      technicalSetupScore: tq,
      entryTimingScore: Math.max(0, tq - 8),
      fiveYearConfidenceScore: Math.min(100, conf),
      growthPotentialScore: growth,
      downsideRiskScore: riskS,
      sharesVsLeapsSuitabilityScore: Math.max(0, total - 20),
      _isFallback: true,
    };
  }

  const rawScorecard = result.seniorScorecard ?? {};
  const s = Object.keys(rawScorecard).length > 0 ? rawScorecard : deriveFallbackScorecard(result);
  const tp = result.technicalPlan ?? {};
  const ea = result.earningsAnalysis ?? {};
  const fy = result.fiveYearTable ?? {};
  const svl = result.sharesVsLeaps ?? {};
  const ps = result.positionSizing ?? {};
  const fmv = result.fundManagerVerdict ?? {};
  const report = result.report ?? {};
  const technical = result.technical ?? {};
  const valuation = result.valuation ?? {};
  const moat = result.moat ?? {};
  const newsEngine = result.newsEngine ?? {};
  const dataQuality = result.dataQuality ?? {};
  const checklist = result.growthChecklist ?? {};
  const advisorRows = result.advisorChecks ?? [];
  const currentPrice = Number(result.currentPrice ?? technical.close);
  const finalRating = result.seniorFinalRating ?? result.investigateFurther ?? "Watchlist Only";
  const finalAction = result.seniorFinalAction ?? result.finalAction ?? "Wait for pullback";

  function ratingClass(rating) {
    if (["Core 5-Year Compounder", "DCA Candidate"].includes(rating)) return "chip-green";
    if (["Strong Company, Wait for Better Price", "High Growth / High Risk"].includes(rating)) return "chip-amber";
    if (["Thesis Weakening", "Avoid"].includes(rating)) return "chip-red";
    return "chip-neutral";
  }
  function actionClass(action) {
    if (!action) return "chip-neutral";
    if (["Buy shares slowly", "DCA shares", "LEAPS starter allowed"].includes(action)) return "chip-green";
    if (["Wait for pullback", "Watch after earnings", "LEAPS watch only"].includes(action)) return "chip-amber";
    if (action.toLowerCase().includes("avoid")) return "chip-red";
    return "chip-neutral";
  }
  function seniorMeter(label, score, note, inverse = false) {
    const n = Number(score);
    const pctVal = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    const tone = inverse
      ? (n >= 70 ? "bad" : n >= 45 ? "caution" : "good")
      : (n >= 70 ? "good" : n >= 45 ? "caution" : "bad");
    return `
      <div class="senior-meter senior-meter--${tone}">
        <div class="senior-meter-head">
          <span>${escapeHtml(label)}</span>
          <strong>${Number.isFinite(n) ? Math.round(n) : "n/a"}/100</strong>
        </div>
        <div class="meter-track"><span style="width:${pctVal}%"></span></div>
        <p>${escapeHtml(note)}</p>
      </div>`;
  }
  function buildFYTableHTML(fyData) {
    if (!fyData.rows?.length) {
      return `<p class="empty">5-year financial data requires annual income statement history from Yahoo Finance. Data may be limited for some tickers.</p>`;
    }
    const hdr = ["Year", "Revenue", "Rev Growth", "Gross Margin", "Op Margin", "Net Margin", "EBITDA Margin", "FCF", "FCF Margin", "Capex"];
    return `
      <div class="table-wrap fy-table">
        <table>
          <thead><tr>${hdr.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>
            ${fyData.rows.map((row) => {
              const fmtPct = (v) => v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : "—";
              const growthClass = row.revenueGrowth != null ? (Number(row.revenueGrowth) >= 15 ? "cell-good" : Number(row.revenueGrowth) >= 5 ? "" : "cell-bad") : "";
              return `
              <tr>
                <td><strong>${escapeHtml(String(row.year ?? "n/a"))}</strong></td>
                <td>${bigMoney(row.revenue)}</td>
                <td class="${growthClass}">${fmtPct(row.revenueGrowth)}</td>
                <td>${fmtPct(row.grossMargin)}</td>
                <td>${fmtPct(row.operatingMargin)}</td>
                <td>${fmtPct(row.netMargin)}</td>
                <td>${fmtPct(row.ebitdaMargin)}</td>
                <td>${bigMoney(row.fcf)}</td>
                <td>${fmtPct(row.fcfMargin)}</td>
                <td>${bigMoney(row.capex)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }
  function entryPlanCard(plan) {
    if (!plan?.available) {
      return `<p class="empty">Insufficient price history for technical entry plan (minimum 160 trading days required).</p>`;
    }
    return `
      <div class="entry-plan-card">
        <div class="entry-plan-grid">
          <div class="entry-row"><span>Current Price</span><strong>${money(plan.currentPrice)}</strong></div>
          <div class="entry-row entry-row--highlight"><span>Ideal Buy Zone</span><strong>${money(plan.idealBuyZoneLow)} – ${money(plan.idealBuyZoneHigh)}</strong></div>
          <div class="entry-row"><span>DCA Zone</span><strong>${money(plan.dcaZoneLow)} – ${money(plan.dcaZoneHigh)}</strong></div>
          <div class="entry-row"><span>Breakout Buy Above</span><strong>${money(plan.breakoutBuyAbove)}</strong></div>
          <div class="entry-row"><span>Pullback Buy Zone</span><strong>${money(plan.pullbackBuyZoneLow)} – ${money(plan.pullbackBuyZoneHigh)}</strong></div>
          <div class="entry-row"><span>Support (EMA50)</span><strong>${money(plan.supportLevel)}</strong></div>
          <div class="entry-row"><span>Major Support (EMA150)</span><strong>${money(plan.majorSupportLevel)}</strong></div>
          <div class="entry-row"><span>Resistance</span><strong>${money(plan.resistanceLevel)}</strong></div>
          <div class="entry-row entry-row--danger"><span>Invalidation (Stop)</span><strong>Below ${money(plan.invalidationBelow)}</strong></div>
          <div class="entry-row entry-row--tp1"><span>TP1 — Partial Trim Zone</span><strong>${money(plan.tp1)}</strong></div>
          <div class="entry-row entry-row--tp2"><span>TP2 — Extended Bull Target</span><strong>${money(plan.tp2)}</strong></div>
          <div class="entry-row"><span>Long-Term Bull Case</span><strong>${money(plan.longTermBullCase)}</strong></div>
          <div class="entry-row"><span>Risk / Reward</span><strong>${escapeHtml(plan.riskReward ?? "n/a")}</strong></div>
        </div>
        <div class="entry-plan-indicators">
          <div><span>EMA20</span><strong>${money(plan.ema20)}</strong></div>
          <div><span>EMA50</span><strong>${money(plan.ema50)}</strong></div>
          <div><span>EMA150</span><strong>${money(plan.ema150)}</strong></div>
          <div><span>RSI(14)</span><strong>${plan.rsi14 ?? "n/a"}</strong></div>
          <div><span>ATR(14)</span><strong>${money(plan.atr14)}</strong></div>
          <div><span>52W High</span><strong>${money(plan.high52w)}</strong></div>
          <div><span>52W Low</span><strong>${money(plan.low52w)}</strong></div>
          <div><span>vs 52W High</span><strong>${Number.isFinite(Number(plan.pctFrom52wHigh)) ? `${Number(plan.pctFrom52wHigh).toFixed(1)}%` : "n/a"}</strong></div>
          <div><span>Rel Strength</span><strong>${Number.isFinite(Number(plan.relativeStrength60)) ? `${Number(plan.relativeStrength60) >= 0 ? "+" : ""}${Number(plan.relativeStrength60).toFixed(1)}%` : "n/a"}</strong></div>
        </div>
        <div class="tp-rules-block">
          <div><strong>TP1 Rule:</strong> First technical target. Possible partial trim (20-25% of position). Reassess valuation and risk. Do NOT exit full position automatically.</div>
          <div><strong>TP2 Rule:</strong> Extended bull-case target. Reduce risk if valuation becomes extreme. If thesis is intact and valuation is reasonable, hold core position.</div>
          <div><strong>Hold-Through Rule:</strong> TP1/TP2 are trim zones, not automatic exits. Continue holding if thesis and valuation support it.</div>
        </div>
      </div>`;
  }

  const groups = normalizePeerGroups(result);
  const filteredPeers = filteredPeerComparison(result);

  return `
    <article class="analyzer-detail senior-report investor-report" id="printable-analyzer-report">

      <!-- COVER HEADER -->
      <div class="senior-header">
        <div class="senior-header-title">
          <div class="senior-eyebrow">Senior Stock Analyzer</div>
          <h2 class="senior-company">${escapeHtml(result.symbol)} — ${escapeHtml(result.name)}</h2>
          <p class="senior-subtitle">5-Year Fundamentals · Technical Entry Plan · Valuation Risk · Earnings Thesis · Shares vs LEAPS</p>
        </div>
        <div class="senior-header-meta">
          <p class="muted">Report: ${dateTime(result.asOf)}</p>
          <div class="report-actions">
            <button type="button" class="print-report-button" data-toggle-report-theme>🌓 Dark / Light</button>
            <button type="button" class="print-report-button print-report-button--primary" data-print-analyzer>⬇ Download Full PDF Report</button>
          </div>
        </div>
      </div>

      <!-- KPI STRIP -->
      <div class="senior-kpi-strip">
        <div class="senior-kpi"><span>Sector</span><strong>${escapeHtml(result.business?.sector ?? "n/a")}</strong></div>
        <div class="senior-kpi"><span>Industry</span><strong>${escapeHtml(result.business?.industry ?? "n/a")}</strong></div>
        <div class="senior-kpi"><span>Market Cap</span><strong>${bigMoney(result.marketCap)}</strong></div>
        <div class="senior-kpi"><span>Price</span><strong>${money(currentPrice)}</strong></div>
        <div class="senior-kpi"><span>52W High</span><strong>${money(result.high52w)}</strong></div>
        <div class="senior-kpi"><span>52W Low</span><strong>${money(result.low52w)}</strong></div>
        <div class="senior-kpi${ea.earningsProximate ? " senior-kpi--urgent" : ""}"><span>Next Earnings</span><strong>${escapeHtml(ea.nextEarningsDate ?? "n/a")}${Number.isFinite(ea.daysUntilEarnings) && ea.daysUntilEarnings >= 0 ? ` (${ea.daysUntilEarnings}d)` : ""}${ea.earningsProximate ? " ⚠️" : ""}</strong></div>
        <div class="senior-kpi"><span>Last Earnings</span><strong>${escapeHtml(ea.lastEarningsDate ?? "n/a")}</strong></div>
        <div class="senior-kpi"><span>Exchange</span><strong>${escapeHtml(result.exchange ?? "n/a")}</strong></div>
      </div>

      <!-- FINAL RATING / ACTION BANNER -->
      <div class="senior-verdict-banner">
        <div class="senior-verdict-item">
          <span>Final Rating</span>
          <strong class="chip ${ratingClass(finalRating)}">${escapeHtml(finalRating)}</strong>
        </div>
        <div class="senior-verdict-item">
          <span>Final Action</span>
          <strong class="chip ${actionClass(finalAction)}">${escapeHtml(finalAction)}</strong>
        </div>
        <div class="senior-verdict-item">
          <span>Overall Long-Term Score</span>
          <strong class="score-badge">${Number.isFinite(Number(s.overallLongTermScore)) ? Math.round(s.overallLongTermScore) : "n/a"}/100</strong>
        </div>
        <div class="senior-verdict-item">
          <span>5-Year Hold Confidence</span>
          <strong class="score-badge">${Number.isFinite(Number(s.fiveYearConfidenceScore)) ? Math.round(s.fiveYearConfidenceScore) : "n/a"}/100</strong>
        </div>
        <div class="senior-verdict-item">
          <span>Earnings Thesis</span>
          <strong class="chip ${ea.thesisClassification === "Thesis Strengthened" ? "chip-green" : ea.thesisClassification === "Thesis Weakened" ? "chip-red" : "chip-amber"}">${escapeHtml(ea.thesisClassification ?? "Insufficient data")}</strong>
        </div>
      </div>

      <!-- SCORECARD -->
      <details class="report-section report-section--open" open>
        <summary>Score Dashboard — 16 Dimensions</summary>
        <p class="scorecard-legend">Quality/strength scores: higher = better. Risk scores (Valuation Risk, Earnings Risk, Downside Risk): higher = more risky.${s._isFallback ? " <em>(Scores estimated from available data — use the live local dashboard for full precision.)</em>" : ""}</p>
        <div class="senior-scorecard-grid">
          ${seniorMeter("Overall Long-Term Score", s.overallLongTermScore, "Weighted composite. Business quality 18%, Revenue growth 14%, Margin/FCF 14%, Moat 14%, Balance Sheet 10%, Management 8%, Valuation risk (inverted) 10%, Earnings risk (inverted) 5%, Technical 7%.")}
          ${seniorMeter("Business Quality", s.businessQualityScore, "Gross margin, operating margin, net margin, ROE. Core measure of profitability and business strength.")}
          ${seniorMeter("Revenue Growth", s.revenueGrowthScore, "1-year, 3-year, and 5-year revenue growth rates. Growth consistency and acceleration.")}
          ${seniorMeter("Margin Quality", s.marginQualityScore, "Gross, operating, EBITDA, and FCF margins. Higher margins = stronger pricing power and operating leverage.")}
          ${seniorMeter("Free Cash Flow", s.freeCashFlowScore, "FCF generation, FCF margin, and FCF growth trend. The most honest measure of cash profitability.")}
          ${seniorMeter("Balance Sheet", s.balanceSheetScore, "Cash vs debt, current ratio, D/E ratio. Financial resilience and ability to survive downturns.")}
          ${seniorMeter("Moat", s.moatScore, "Evidence of pricing power, scale, switching costs, ecosystem, network effects, or data advantage.")}
          ${seniorMeter("Management / Execution", s.managementScore, "Earnings beat rate, consecutive beats, analyst sentiment, and delivery consistency.")}
          ${seniorMeter("Valuation Risk", s.valuationRiskScore, "⚠ RISK SCORE — Higher = more expensive and risky. Based on Forward P/E, P/S, PEG. Premium multiples increase downside vulnerability.", true)}
          ${seniorMeter("Earnings Risk", s.earningsRiskScore, "⚠ RISK SCORE — Higher = more risk around earnings. Proximity to earnings, beat rate history, thesis trajectory.", true)}
          ${seniorMeter("Technical Setup", s.technicalSetupScore, "Price trend, EMAs, RSI, MACD, ADX, relative strength vs benchmark. Chart quality and momentum.")}
          ${seniorMeter("Entry Timing", s.entryTimingScore, "How attractive the current entry point is. Near support = higher. Overextended above resistance = lower.")}
          ${seniorMeter("5-Year Hold Confidence", s.fiveYearConfidenceScore, "Composite of business quality, moat, growth, balance sheet, and execution. Long-term durability.")}
          ${seniorMeter("Growth Potential", s.growthPotentialScore, "Revenue growth, margin quality, FCF, and moat combined. Upside potential over 3-5 years.")}
          ${seniorMeter("Downside Risk", s.downsideRiskScore, "⚠ RISK SCORE — Higher = more downside risk. Valuation, earnings, balance sheet, business quality, and technical risk combined.", true)}
          ${seniorMeter("Shares vs LEAPS Suitability", s.sharesVsLeapsSuitabilityScore, "How suitable this stock is for long-dated options. Requires strong business quality, moat, and reasonable valuation.")}
        </div>
      </details>

      <!-- 5-YEAR FINANCIAL TABLE -->
      <details class="report-section report-section--open" open>
        <summary>5-Year Financial History</summary>
        ${buildFYTableHTML(fy)}
        ${(Number.isFinite(Number(fy.rev3CAGR)) || Number.isFinite(Number(fy.rev5CAGR))) ? `
          <div class="fy-summary-strip">
            ${Number.isFinite(Number(fy.rev3CAGR)) ? `<div class="fy-summary-kpi"><span>3-Year Revenue CAGR</span><strong>${fy.rev3CAGR}%</strong></div>` : ""}
            ${Number.isFinite(Number(fy.rev5CAGR)) ? `<div class="fy-summary-kpi"><span>5-Year Revenue CAGR</span><strong>${fy.rev5CAGR}%</strong></div>` : ""}
            ${Number.isFinite(Number(fy.currentCash)) ? `<div class="fy-summary-kpi"><span>Cash (TTM)</span><strong>${bigMoney(fy.currentCash)}</strong></div>` : ""}
            ${Number.isFinite(Number(fy.currentDebt)) ? `<div class="fy-summary-kpi"><span>Debt (TTM)</span><strong>${bigMoney(fy.currentDebt)}</strong></div>` : ""}
            ${Number.isFinite(Number(fy.netCash)) ? `<div class="fy-summary-kpi"><span>Net Cash / Debt</span><strong>${bigMoney(fy.netCash)}</strong></div>` : ""}
            ${Number.isFinite(Number(fy.currentROE)) ? `<div class="fy-summary-kpi"><span>ROE (TTM)</span><strong>${fy.currentROE}%</strong></div>` : ""}
            ${Number.isFinite(Number(fy.currentROA)) ? `<div class="fy-summary-kpi"><span>ROA (TTM)</span><strong>${fy.currentROA}%</strong></div>` : ""}
          </div>` : ""}
        <div class="fy-narrative"><strong>Fund Manager Read:</strong> ${escapeHtml(fy.narrative ?? "Insufficient annual data from Yahoo Finance for narrative.")}</div>
      </details>

      <!-- BUSINESS MODEL -->
      <details class="report-section report-section--open" open>
        <summary>Business Model Analysis</summary>
        <div class="report-grid">
          <div><span>What does the company do?</span><p>${escapeHtml((result.business?.profileSummary ?? "").slice(0, 500) || report.businessModel || "Business summary unavailable.")}</p></div>
          <div><span>Revenue model</span><p>${escapeHtml(report.businessModel || report.coreProduct || "Revenue model not detailed in Yahoo structured data.")}</p></div>
          <div><span>Business theme</span><p>${escapeHtml(result.business?.theme ?? "n/a")}</p></div>
          <div><span>Demand type</span><p>${escapeHtml(result.business?.theme?.includes("semiconductor") || result.business?.theme?.includes("software") || result.business?.theme?.includes("ai") ? "Likely secular — structural long-term demand driven by AI and digital transformation." : "Verify demand durability against business cycle sensitivity.")}</p></div>
        </div>
        <div class="beginner-read-card">
          <strong>Explain this business like I'm new to investing:</strong>
          <p>${escapeHtml(result.business?.plainEnglish || "Business explanation unavailable.")}</p>
        </div>
        <div class="report-grid">
          <div><span>Bull case</span><p>${escapeHtml(report.bullCase || "Not available.")}</p></div>
          <div><span>Bear case</span><p>${escapeHtml(report.bearCase || "Not available.")}</p></div>
          <div><span>Why should it still matter in 5 years?</span><p>${escapeHtml(report.moat || "Requires deep research into competitive position.")}</p></div>
          <div><span>Technology / IP advantage</span><p>${escapeHtml(report.technologyAdvantage || "Not confirmed from Yahoo structured data.")}</p></div>
        </div>
      </details>

      <!-- MOAT & COMPETITION -->
      <details class="report-section report-section--open" open>
        <summary>Moat and Competitive Position</summary>
        <div class="moat-header">
          <div class="moat-kpi"><span>Moat Score</span><strong>${moat.score ?? "n/a"}/100</strong></div>
          <div class="moat-kpi"><span>Moat Rating</span><strong>${escapeHtml(moat.rating ?? "n/a")}</strong></div>
        </div>
        <div class="analyzer-columns">
          <div><h4>Moat Evidence</h4><ul class="plain-list">${(moat.points ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No strong moat evidence confirmed.</li>"}</ul></div>
          <div><h4>Moat Risks</h4><ul class="plain-list">${(moat.risks ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No major moat risks identified.</li>"}</ul></div>
        </div>
        <h4>Peer Groups</h4>
        ${peerGroupTable(groups)}
        ${filteredPeers.length ? `<h4>Peer Comparison</h4>${peerTable(filteredPeers)}` : ""}
        <p class="muted">${escapeHtml(report.peerValidation || "Peers grouped by operating relevance.")}</p>
      </details>

      <!-- EARNINGS ANALYSIS -->
      <details class="report-section report-section--open" open>
        <summary>Earnings Analysis</summary>
        <div class="earnings-header-strip">
          <div class="earnings-kpi${ea.earningsProximate ? " earnings-kpi--urgent" : ""}"><span>Next Earnings</span><strong>${escapeHtml(ea.nextEarningsDate ?? "n/a")}${ea.earningsProximate ? " ⚠️ SOON" : ""}</strong><p>${Number.isFinite(ea.daysUntilEarnings) && ea.daysUntilEarnings >= 0 ? `${ea.daysUntilEarnings} days away` : "Timing uncertain"}</p></div>
          <div class="earnings-kpi"><span>Last Earnings</span><strong>${escapeHtml(ea.lastEarningsDate ?? "n/a")}</strong></div>
          <div class="earnings-kpi"><span>EPS vs Expectations</span><strong>${escapeHtml(ea.epsVsExpectations ?? "n/a")}</strong></div>
          <div class="earnings-kpi"><span>Revenue vs Expectations</span><strong>${escapeHtml(ea.revVsExpectations ?? "n/a")}</strong></div>
          <div class="earnings-kpi"><span>Guidance</span><strong>${escapeHtml(ea.guidanceChange ?? "n/a")}</strong></div>
          <div class="earnings-kpi"><span>EPS Beat Rate</span><strong>${ea.beatRate !== null && ea.beatRate !== undefined ? `${ea.beatRate}%` : "n/a"}</strong></div>
          <div class="earnings-kpi"><span>Consecutive Beats</span><strong>${ea.consecutiveBeats ?? "n/a"}</strong></div>
          <div class="earnings-kpi earnings-kpi--classification earnings-kpi--${ea.thesisClassification === "Thesis Strengthened" ? "green" : ea.thesisClassification === "Thesis Weakened" ? "red" : "amber"}"><span>Earnings Thesis</span><strong>${escapeHtml(ea.thesisClassification ?? "Insufficient data")}</strong></div>
        </div>
        <div class="earnings-commentary">
          <div><strong>Gross Margin Commentary:</strong> ${escapeHtml(ea.grossMarginsComment ?? "n/a")}</div>
          <div><strong>Operating Margin Commentary:</strong> ${escapeHtml(ea.opMarginsComment ?? "n/a")}</div>
          <div><strong>Earnings Risk:</strong> <span class="chip chip-${ea.earningsRiskLabel === "High" ? "red" : ea.earningsRiskLabel === "Moderate" ? "amber" : "green"}">${escapeHtml(ea.earningsRiskLabel ?? "Low")}</span></div>
        </div>
        <div class="watch-next-block">
          <strong>What to Watch in the Next Earnings Report:</strong>
          <ol>${(ea.watchNext ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
        </div>
        <div class="news-panel">
          <div class="section-title">
            <div><p class="eyebrow">Yahoo Finance</p><h4>Catalyst Intelligence</h4></div>
            <span class="growth-status growth-status--${scoreTone(newsEngine.score) === "good" ? "pass" : scoreTone(newsEngine.score) === "bad" ? "fail" : "near"}">${Number.isFinite(Number(newsEngine.score)) ? Math.round(newsEngine.score) : "n/a"}/100</span>
          </div>
          <div class="news-grid">
            <div><span>Recent Headlines</span><ul class="plain-list">${(newsEngine.items ?? []).slice(0, 5).map((item) => `<li><a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a><small>${escapeHtml(item.publisher || "")} — ${escapeHtml(item.tone || "neutral")}</small></li>`).join("") || "<li>No headline feed.</li>"}</ul></div>
            <div><span>SEC Filings</span><ul class="plain-list">${(newsEngine.filings ?? []).slice(0, 3).map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(`${item.date ?? ""} ${item.type ?? ""}: ${item.title ?? ""}`)}</a></li>`).join("") || "<li>No recent filings.</li>"}</ul></div>
            <div><span>Analyst Revisions</span><ul class="plain-list">${(newsEngine.upgrades ?? []).slice(0, 4).map((item) => `<li>${escapeHtml(`${item.date ?? ""} ${item.firm ?? ""}: ${item.fromGrade ?? "n/a"} → ${item.toGrade ?? "n/a"}${item.priceTargetAction ? `, target ${item.priceTargetAction}` : ""}`)}</li>`).join("") || "<li>No upgrade/downgrade history.</li>"}</ul></div>
          </div>
        </div>
      </details>

      <!-- VALUATION ANALYSIS -->
      <details class="report-section report-section--open" open>
        <summary>Valuation Analysis</summary>
        <div class="valuation-header">
          <div class="val-kpi"><span>Valuation Risk</span><strong class="${Number(s.valuationRiskScore) >= 70 ? "text-red" : Number(s.valuationRiskScore) >= 50 ? "text-amber" : "text-green"}">${s.valuationRiskScore ?? "n/a"}/100</strong></div>
          <div class="val-kpi"><span>Trailing P/E</span><strong>${Number.isFinite(Number(valuation.trailingPE)) ? `${valuation.trailingPE}x` : "n/a"}</strong></div>
          <div class="val-kpi"><span>Forward P/E</span><strong>${Number.isFinite(Number(valuation.forwardPE)) ? `${valuation.forwardPE}x` : "n/a"}</strong></div>
          <div class="val-kpi"><span>PEG Ratio</span><strong>${Number.isFinite(Number(valuation.pegRatio)) ? `${valuation.pegRatio}x` : "n/a"}</strong></div>
          <div class="val-kpi"><span>P/S Ratio</span><strong>${Number.isFinite(Number(valuation.priceToSales)) ? `${valuation.priceToSales}x` : "n/a"}</strong></div>
          <div class="val-kpi"><span>EV/EBITDA</span><strong>${Number.isFinite(Number(valuation.enterpriseToEbitda)) ? `${valuation.enterpriseToEbitda}x` : "n/a"}</strong></div>
          <div class="val-kpi"><span>Analyst Target</span><strong>${money(valuation.targetMeanPrice)}</strong></div>
          <div class="val-kpi"><span>Analyst Upside</span><strong>${Number.isFinite(Number(valuation.analystUpside)) ? `${Number(valuation.analystUpside) > 0 ? "+" : ""}${valuation.analystUpside}%` : "n/a"}</strong></div>
        </div>
        <div class="valuation-rating-block">
          <span>Valuation Profile:</span>
          <strong class="chip ${Number(s.valuationRiskScore) >= 75 ? "chip-red" : Number(s.valuationRiskScore) >= 55 ? "chip-amber" : "chip-green"}">${escapeHtml(valuation.rating ?? "n/a")}</strong>
          <p>${(valuation.reasons ?? []).concat(valuation.risks ?? []).slice(0, 4).map((item) => escapeHtml(item)).join(" · ") || "Valuation commentary unavailable."}</p>
        </div>
        <div class="valuation-interpretation">
          <div><strong>Is valuation justified by growth?</strong> ${Number(s.revenueGrowthScore) >= 70 && Number(s.valuationRiskScore) >= 65 ? "The premium valuation requires continued strong growth to be justified. Revenue growth score supports it, but execution must remain strong." : Number(s.valuationRiskScore) <= 40 ? "Valuation appears reasonable or attractive relative to growth prospects." : "Valuation carries meaningful risk. Any growth deceleration could lead to significant multiple compression."}</div>
          <div><strong>What pullback level would be more attractive?</strong> ${tp.available ? `A pullback toward the DCA zone (${money(tp.dcaZoneLow)} – ${money(tp.dcaZoneHigh)}) or ideal buy zone (${money(tp.idealBuyZoneLow)} – ${money(tp.idealBuyZoneHigh)}) would improve risk/reward meaningfully.` : "A 15–20% pullback from current levels would generally create better entry value."}</div>
        </div>
        <div class="metric-card-grid">${rowsByLabel(checklist, ["P/E Ratio", "Forward P/E", "PEG Ratio", "P/B Ratio", "P/S Ratio", "Enterprise Value / EBITDA", "P/FCF"]).map(metricCard).join("")}</div>
      </details>

      <!-- TECHNICAL ANALYSIS + ENTRY PLAN -->
      <details class="report-section report-section--open" open>
        <summary>Technical Analysis and Entry Plan</summary>
        <div class="tech-header-strip">
          <div class="tech-kpi"><span>Technical Trend</span><strong class="chip ${tp.technicalTrend === "Bullish" ? "chip-green" : tp.technicalTrend === "Neutral" ? "chip-amber" : "chip-red"}">${escapeHtml(tp.technicalTrend ?? technical.rating ?? "n/a")}</strong></div>
          <div class="tech-kpi"><span>Entry Timing</span><strong class="chip ${tp.entryTiming === "Attractive now" ? "chip-green" : (tp.entryTiming ?? "").includes("Avoid") ? "chip-red" : "chip-amber"}">${escapeHtml(tp.entryTiming ?? "n/a")}</strong></div>
          <div class="tech-kpi"><span>Technical Score</span><strong>${s.technicalSetupScore ?? technical.score ?? "n/a"}/100</strong></div>
          <div class="tech-kpi"><span>Entry Timing Score</span><strong>${s.entryTimingScore ?? "n/a"}/100</strong></div>
        </div>
        ${(tp.reasons ?? technical.reasons ?? []).length ? `<div class="tech-reasons"><strong>Bullish signals:</strong> ${(tp.reasons ?? technical.reasons ?? []).map((r) => escapeHtml(r)).join(" · ")}</div>` : ""}
        ${(tp.risks ?? technical.risks ?? []).length ? `<div class="tech-reasons tech-reasons--risk"><strong>Risk signals:</strong> ${(tp.risks ?? technical.risks ?? []).map((r) => escapeHtml(r)).join(" · ")}</div>` : ""}
        <h4>Entry Plan</h4>
        ${entryPlanCard(tp)}
        <p class="muted">Entry zones are calculated from moving averages and ATR. Verify with current chart before acting. This is research, not financial advice.</p>
        <div class="report-snapshot" style="margin-top:12px;">
          <div><span>Relative Strength</span><strong>${Number.isFinite(Number(technical.relativeStrength60)) ? `${Number(technical.relativeStrength60) >= 0 ? "+" : ""}${Number(technical.relativeStrength60).toFixed(1)}%` : "n/a"}</strong><p>vs ${escapeHtml(result.benchmark ?? "QQQ")} over 60 days.</p></div>
          <div><span>RSI / ADX</span><strong>${technical.rsi14 ?? "n/a"} / ${technical.adx14 ?? "n/a"}</strong><p>RSI 14-day momentum. ADX trend strength.</p></div>
          <div><span>EMA50 / EMA150</span><strong>${money(technical.ema50)} / ${money(technical.ema150)}</strong><p>Key trend support levels.</p></div>
          <div><span>Stop / Target</span><strong>${money(technical.stop)} / ${money(technical.target)}</strong><p>Existing system stop and target levels.</p></div>
        </div>
      </details>

      <!-- SHARES vs LEAPS -->
      <details class="report-section report-section--open" open>
        <summary>Shares vs LEAPS Decision</summary>
        <div class="leaps-decision-grid">
          <div class="leaps-card leaps-card--shares">
            <h4>Shares Decision</h4>
            <strong class="chip ${actionClass(svl.sharesDecision ?? "Wait for pullback")}">${escapeHtml(svl.sharesDecision ?? "n/a")}</strong>
            <p>${escapeHtml(svl.whyShares ?? "Shares analysis unavailable.")}</p>
          </div>
          <div class="leaps-card ${svl.leapsAllowed ? "leaps-card--allowed" : "leaps-card--avoid"}">
            <h4>LEAPS Decision</h4>
            <strong class="chip ${svl.leapsAllowed ? "chip-amber" : "chip-red"}">${escapeHtml(svl.leapsDecision ?? "n/a")}</strong>
            <p>${escapeHtml(svl.whyLeaps ?? "LEAPS analysis unavailable.")}</p>
          </div>
        </div>
        ${!svl.meetsLeapsMinimum ? `
          <div class="leaps-minimum-block">
            <strong>LEAPS Minimum Requirements (Not Met):</strong>
            <div class="explain-grid">
              <div><span>Overall Score (need ≥75)</span><strong>${svl.minimumRequirements?.overallScore ?? "n/a"}</strong></div>
              <div><span>Business Quality (need ≥70)</span><strong>${svl.minimumRequirements?.businessScore ?? "n/a"}</strong></div>
              <div><span>Moat Score (need ≥70)</span><strong>${svl.minimumRequirements?.moatScore ?? "n/a"}</strong></div>
              <div><span>FCF Score (need ≥48)</span><strong>${svl.minimumRequirements?.fcfScore ?? "n/a"}</strong></div>
            </div>
            ${svl.tooRiskyReason ? `<p>${escapeHtml(svl.tooRiskyReason)}</p>` : ""}
          </div>` : svl.contractPreference ? `
          <div class="leaps-contract-block">
            <strong>Preferred LEAPS Contract Parameters:</strong>
            <div class="explain-grid">
              <div><span>Preferred Expiry</span><strong>${escapeHtml(svl.contractPreference.preferredExpiry ?? "n/a")}</strong></div>
              <div><span>Minimum Expiry</span><strong>${escapeHtml(svl.contractPreference.minimumExpiry ?? "n/a")}</strong></div>
              <div><span>Preferred Delta</span><strong>${escapeHtml(svl.contractPreference.preferredDelta ?? "n/a")}</strong></div>
              <div><span>OTM Contracts</span><strong>Avoid far OTM lottery contracts</strong></div>
            </div>
            <p>${escapeHtml(svl.contractPreference.note ?? "")}</p>
          </div>` : ""}
      </details>

      <!-- POSITION SIZING -->
      <details class="report-section">
        <summary>Position Sizing Guidance (Example: $10,000 Portfolio)</summary>
        <div class="position-sizing-grid">
          <div class="ps-card"><span>Classification</span><strong>${escapeHtml(ps.classification ?? "n/a")}</strong></div>
          <div class="ps-card"><span>Starter Position</span><strong>${ps.starterPct ?? 0}% (~$${ps.starterDollar ?? 0})</strong></div>
          <div class="ps-card"><span>Core Target</span><strong>${ps.coreTargetPct ?? 0}% (~$${ps.coreDollar ?? 0})</strong></div>
          <div class="ps-card"><span>Max Allocation</span><strong>${ps.maxPct ?? 0}%</strong></div>
        </div>
        <div class="ps-detail">
          <div><strong>DCA Plan:</strong> ${escapeHtml(ps.dcaPlan ?? "n/a")}</div>
          <div><strong>Add-On Zones:</strong> ${escapeHtml(ps.addOnZones ?? "n/a")}</div>
          <div><strong>LEAPS Note:</strong> ${escapeHtml(ps.leapsNote ?? "n/a")}</div>
        </div>
        <div class="ps-trim"><strong>Trim / Reduce Conditions:</strong><ul class="plain-list">${(ps.trimConditions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </details>

      <!-- RISK HEATMAP -->
      <details class="report-section">
        <summary>Risk Heatmap</summary>
        <div class="risk-heatmap">${(result.riskBreakdown ?? []).map(riskHeatCell).join("")}</div>
        ${(result.risks ?? []).length ? `<ul class="plain-list">${result.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        ${(dataQuality.missingOrEstimatedValues ?? []).length ? `<p class="muted">Missing or estimated: ${dataQuality.missingOrEstimatedValues.slice(0, 8).join(", ")}</p>` : ""}
        <h4>Balance Sheet and Dilution Checks</h4>
        <div class="metric-card-grid metric-card-grid--advisor">${advisorRows.slice(0, 8).map(advisorCard).join("")}</div>
      </details>

      <!-- HIDDEN MULTIBAGGER (if available) -->
      ${renderHiddenMultibagger(result)}

      <!-- FUND MANAGER VERDICT -->
      <div class="fund-manager-verdict" id="fund-manager-verdict">
        <div class="verdict-title">
          <h3>Senior Fund Manager Verdict</h3>
          <span class="chip ${ratingClass(fmv.finalRating ?? finalRating)}">${escapeHtml(fmv.finalRating ?? finalRating)}</span>
        </div>
        <div class="verdict-grid">
          <div><span>1. Final Rating</span><strong>${escapeHtml(fmv.finalRating ?? finalRating)}</strong></div>
          <div><span>2. Final Action</span><strong class="chip ${actionClass(fmv.finalAction ?? finalAction)}">${escapeHtml(fmv.finalAction ?? finalAction)}</strong></div>
          <div><span>3. Investable 5+ years?</span><strong>${fmv.investable5Years ? "✅ Yes" : "⚠️ Not confirmed"}</strong></div>
          <div><span>4. Buy today or wait?</span><strong>${escapeHtml(fmv.buyNowOrWait ?? "n/a")}</strong></div>
          <div><span>5. Ideal Entry Zone</span><strong>${escapeHtml(fmv.idealEntryZone ?? "n/a")}</strong></div>
          <div><span>6. DCA Zone</span><strong>${escapeHtml(fmv.dcaZone ?? "n/a")}</strong></div>
          <div><span>7. TP1</span><strong>${money(fmv.tp1)}</strong></div>
          <div><span>8. TP2</span><strong>${money(fmv.tp2)}</strong></div>
          <div><span>9. Invalidation Level</span><strong>${money(fmv.invalidationLevel)}</strong></div>
          <div><span>10. Shares vs LEAPS</span><strong>${escapeHtml(fmv.sharesVsLeapsDecision ?? "n/a")}</strong></div>
          <div><span>11. Biggest Upside Driver</span><strong>${escapeHtml(fmv.biggestUpsideDriver ?? "n/a")}</strong></div>
          <div><span>12. Biggest Risk</span><strong>${escapeHtml(fmv.biggestRisk ?? "n/a")}</strong></div>
          <div><span>13. Watch Next Earnings</span><strong>${escapeHtml(fmv.watchNextEarnings ?? "n/a")}</strong></div>
        </div>
        <div class="verdict-conditions">
          <div><strong>14. What would make me sell / reduce:</strong><ul class="plain-list">${(fmv.sellReduceConditions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
          <div><strong>15. What would make me buy more:</strong><ul class="plain-list">${(fmv.buyMoreConditions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        </div>
        <div class="verdict-plain-english">
          <strong>Plain-English 5-Sentence Summary:</strong>
          <p>${escapeHtml(fmv.plainEnglishSummary ?? result.managerRead ?? "Analysis unavailable.")}</p>
        </div>
        <p class="muted">${escapeHtml(dataQuality.caveat ?? "This is an analytical research report, not financial advice. Data sourced from Yahoo Finance and SEC EDGAR. Verify critical figures against company filings before making investment decisions.")}</p>
      </div>

      <!-- DATA SOURCE SECTION -->
      <div class="data-source-section">
        <div class="data-source-header">
          <strong>Data Sources &amp; Quality</strong>
          <span class="muted">Verify critical figures against company filings before making investment decisions.</span>
        </div>
        <div class="data-source-grid">
          <div><span>Report Generated</span><strong>${escapeHtml(dateTime(result.asOf))}</strong></div>
          <div><span>Price / Market Data</span><strong>Yahoo Finance (real-time on local server; cached on GitHub Pages)</strong></div>
          <div><span>Financial Statements</span><strong>Yahoo Finance incomeStatementHistory &amp; cashflowStatementHistory modules</strong></div>
          <div><span>Latest Quarter Used</span><strong>${escapeHtml(dataQuality.latestQuarterUsed || "Not confirmed — check company filings")}</strong></div>
          <div><span>SEC / Filing Cross-Check</span><strong>${escapeHtml(dataQuality.secCrossCheck || "SEC EDGAR facts requested; Yahoo Finance is primary fallback")}</strong></div>
          <div><span>Earnings Calendar</span><strong>Yahoo Finance calendarEvents + earningsHistory modules</strong></div>
          <div><span>Analyst Estimates</span><strong>Yahoo Finance earningsTrend module (consensus estimates)</strong></div>
          <div><span>Technical Indicators</span><strong>Computed from Yahoo Finance OHLCV candle history (18 months)</strong></div>
          <div><span>News / Headlines</span><strong>Yahoo Finance news feed (sentiment-tagged; not used for thesis)</strong></div>
          <div><span>Peer Comparison</span><strong>Yahoo Finance (auto-fetched peers based on sector/theme rules)</strong></div>
          ${(dataQuality.missingOrEstimatedValues ?? []).length ? `<div style="grid-column:1/-1"><span>Missing / Estimated Fields</span><strong style="color:#b45309">${dataQuality.missingOrEstimatedValues.slice(0, 12).join(", ")}</strong></div>` : ""}
        </div>
        <p class="muted" style="margin:8px 0 0;font-size:0.75rem">Primary sources: Yahoo Finance (price, financials, estimates, candles) · SEC EDGAR (10-K/10-Q cross-check where available) · Company IR (guidance, confirmed earnings dates). This report is analytical research only — not financial advice.</p>
      </div>

    </article>
  `;
}

function renderGrowthChecklist(result) {
  const checklist = result.growthChecklist;
  if (!checklist?.rows?.length) {
    return `<article class="analyzer-detail"><h2>Growth Checklist</h2><p class="empty">Growth checklist data was not available.</p></article>`;
  }
  return `
    <article class="analyzer-detail growth-checklist">
      <div class="section-title">
        <div>
          <p class="eyebrow">Growth Stock Framework</p>
          <h2>Growth Checklist</h2>
        </div>
        <span class="growth-status growth-status--${checklist.isGrowthStock ? "pass" : "fail"}">${escapeHtml(checklist.verdict)}</span>
      </div>
      <div class="growth-summary">
        <div><span>Risk Score</span><strong>${result.riskScore ?? "n/a"}/100</strong><p>Higher means riskier.</p></div>
        <div><span>Pass</span><strong>${checklist.passCount}</strong><p>Metrics inside ideal range.</p></div>
        <div><span>Near</span><strong>${checklist.nearCount}</strong><p>Close, but not perfect.</p></div>
        <div><span>Fail</span><strong>${checklist.failCount}</strong><p>Outside ideal range.</p></div>
      </div>
      <p class="action">${escapeHtml(checklist.summary)}</p>
      <div class="growth-filters">
        ${["all", "pass", "near", "fail", "unavailable"].map((filter) => `<button type="button" data-growth-filter="${filter}">${filter}</button>`).join("")}
      </div>
      <div class="table-wrap growth-table">
        <table>
          <thead><tr><th>Metric</th><th>Value</th><th>Ideal</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            ${checklist.rows.map((row) => `
              <tr data-growth-row="${row.status}">
                <td><strong>${escapeHtml(row.label)}</strong></td>
                <td>${escapeHtml(row.display)}</td>
                <td>${escapeHtml(row.ideal)}</td>
                <td>${growthStatusPill(row.status)}</td>
                <td>${escapeHtml(row.note)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderAnalyzer(result) {
  const target = document.getElementById("analyzer-result");
  if (!result) {
    target.innerHTML = "";
    return;
  }
  latestAnalyzerPrintTitle = `${result.symbol} stock analysis`;
  target.innerHTML = renderReportSection(result);
  document.querySelector("[data-toggle-report-theme]")?.addEventListener("click", () => {
    document.getElementById("printable-analyzer-report")?.classList.toggle("investor-report--light");
  });
  document.querySelector("[data-print-analyzer]")?.addEventListener("click", () => {
    document.title = latestAnalyzerPrintTitle;
    document.body.classList.add("printing-analyzer");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-analyzer"), 800);
  });
}

let analyzerCachePromise = null;

async function loadAnalyzerCache() {
  if (!analyzerCachePromise) {
    analyzerCachePromise = fetch(`./analyzer-cache.json?v=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
          throw new Error("Analyzer cache is not published yet.");
        }
        return response.json();
      });
  }
  return analyzerCachePromise;
}

function analyzerOptionsFromCache(cache) {
  return Object.values(cache.results ?? {})
    .map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      name: row.name || row.symbol || "",
      exchange: row.exchange || "Cached",
      assetType: row.assetType || "Equity",
      sector: row.sector || row.businessModel?.sector || "n/a",
      decision: row.decision || "Cached",
      score: row.totalScore,
    }))
    .filter((row) => row.symbol)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function compactText(value) {
  return String(value ?? "").trim();
}

function isUsListedMatch(row) {
  const symbol = compactText(row.symbol).toUpperCase();
  const exchange = compactText(row.exchange).toLowerCase();
  const assetType = compactText(row.assetType).toLowerCase();
  if (!symbol || symbol.includes(".") || symbol.includes("=")) return false;
  if (assetType && !/(equity|stock|etf)/i.test(assetType)) return false;
  return /(nasdaq|nyse|amex|arca|nms|ngm|ncm|nyq|pcx|ase)/i.test(exchange) || exchange === "cached";
}

function fuzzyContains(text, query) {
  let cursor = 0;
  for (const char of query) {
    cursor = text.indexOf(char, cursor);
    if (cursor === -1) return false;
    cursor += 1;
  }
  return true;
}

function scoreAnalyzerMatch(option, query) {
  const clean = query.trim().toLowerCase();
  if (!clean) return -1;
  const symbol = compactText(option.symbol).toLowerCase();
  const name = compactText(option.name).toLowerCase();
  const words = name.split(/[^a-z0-9.]+/).filter(Boolean);
  if (symbol === clean) return 1000;
  if (symbol.startsWith(clean)) return 900;
  if (name === clean) return 820;
  if (words.some((word) => word.startsWith(clean))) return 760;
  if (name.startsWith(clean)) return 720;
  if (symbol.includes(clean)) return 600;
  if (name.includes(clean)) return 520;
  if (fuzzyContains(symbol, clean)) return 340;
  if (fuzzyContains(name, clean)) return 280;
  return -1;
}

function rankAnalyzerMatches(rows, query, limit = 12) {
  const seen = new Set();
  return (rows ?? [])
    .map((option) => ({
      symbol: compactText(option.symbol).toUpperCase(),
      name: compactText(option.name || option.shortname || option.longname || option.symbol),
      exchange: compactText(option.exchange || option.exchDisp || option.fullExchangeName || "n/a"),
      assetType: compactText(option.assetType || option.quoteType || option.typeDisp || "n/a"),
      sector: compactText(option.sector || "n/a"),
      decision: option.decision,
      score: option.score,
    }))
    .filter((option) => option.symbol && !seen.has(option.symbol) && seen.add(option.symbol))
    .map((option) => ({ ...option, matchScore: scoreAnalyzerMatch(option, query) }))
    .filter((option) => option.matchScore >= 0)
    .sort((a, b) => b.matchScore - a.matchScore || Number(b.score ?? 0) - Number(a.score ?? 0) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}

function searchAnalyzerOptions(query, cache, limit = 8) {
  return rankAnalyzerMatches(analyzerOptionsFromCache(cache), query, limit);
}

async function searchAnalyzerSymbols(query, limit = 12) {
  const clean = query.trim();
  if (!clean) return [];
  const response = await fetch(`/api/search-symbols?q=${encodeURIComponent(clean)}`, { cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Symbol search did not return JSON.");
  }
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Symbol search failed.");
  }
  return rankAnalyzerMatches(payload.results ?? [], clean, limit);
}

async function searchAnalyzerSymbolsWithFallback(query, limit = 12) {
  try {
    const liveMatches = await searchAnalyzerSymbols(query, limit);
    if (liveMatches.length) return liveMatches;
  } catch {
    // Fall back to the published analyzer cache when the local live API is unavailable.
  }
  const cache = await loadAnalyzerCache();
  return searchAnalyzerOptions(query, cache, limit);
}

function setAnalyzerInput(symbol) {
  const input = document.getElementById("analyzer-symbol");
  input.value = symbol;
  input.dataset.symbol = symbol;
  document.getElementById("analyzer-suggestions").classList.remove("analyzer-suggestions--open");
}

async function renderAnalyzerSuggestions() {
  const input = document.getElementById("analyzer-symbol");
  const target = document.getElementById("analyzer-suggestions");
  const query = input.value.trim();
  input.dataset.symbol = "";
  if (query.length < 2) {
    target.classList.remove("analyzer-suggestions--open");
    target.innerHTML = "";
    return;
  }
  try {
    const matches = await searchAnalyzerSymbolsWithFallback(query, 8);
    if (!matches.length) {
      target.classList.remove("analyzer-suggestions--open");
      target.innerHTML = "";
      return;
    }
    target.innerHTML = matches.map((row) => `
      <button class="analyzer-suggestion" type="button" data-symbol="${escapeHtml(row.symbol)}">
        <strong>${escapeHtml(row.symbol)}</strong>
        <span>${escapeHtml(row.name)}</span>
        <small>${escapeHtml(row.exchange)} | ${escapeHtml(row.assetType)}${row.sector && row.sector !== "n/a" ? ` | ${escapeHtml(row.sector)}` : ""}</small>
      </button>
    `).join("");
    target.classList.add("analyzer-suggestions--open");
  } catch {
    target.classList.remove("analyzer-suggestions--open");
    target.innerHTML = "";
  }
}

function exactTickerIntent(query) {
  const raw = query.trim();
  if (!/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(raw)) return false;
  return raw === raw.toUpperCase() || raw.length >= 4;
}

function getDirectAnalyzerMatch(query, matches) {
  const clean = query.trim().toUpperCase();
  if (!exactTickerIntent(query)) return null;
  return matches.find((row) => row.symbol === clean && isUsListedMatch(row)) ?? null;
}

function renderAnalyzerMatchList(query, matches) {
  const target = document.getElementById("analyzer-result");
  if (!matches.length) {
    target.innerHTML = `
      <article class="analyzer-detail">
        <h2>No ticker matches found</h2>
        <p class="empty">I could not find a Yahoo Finance symbol for "${escapeHtml(query)}". Try the ticker or a more complete company name.</p>
      </article>
    `;
    return;
  }
  target.innerHTML = `
    <article class="analyzer-detail ticker-resolver">
      <h2>Select ticker</h2>
      <p class="analyzer-note">"${escapeHtml(query)}" matched multiple symbols. Pick the exact company first, then I will generate the full stock analysis report.</p>
      <div class="ticker-choice-list">
        ${matches.map((row) => `
          <button class="ticker-choice" type="button" data-analyzer-pick="${escapeHtml(row.symbol)}">
            <strong>${escapeHtml(row.symbol)}</strong>
            <span>${escapeHtml(row.name)}</span>
            <small>${escapeHtml(row.exchange)}</small>
            <small>${escapeHtml(row.assetType)}</small>
            <small>${escapeHtml(row.sector || "n/a")}</small>
          </button>
        `).join("")}
      </div>
    </article>
  `;
}

async function resolveOrShowAnalyzerMatches(rawInput) {
  const input = document.getElementById("analyzer-symbol");
  const selected = input.dataset.symbol;
  if (selected) {
    analyzeTicker(selected);
    return;
  }
  const query = rawInput.trim();
  const target = document.getElementById("analyzer-result");
  if (!query) return;
  target.innerHTML = `<p class="empty">Searching tickers for ${escapeHtml(query)}...</p>`;
  try {
    const matches = await searchAnalyzerSymbolsWithFallback(query, 12);
    const direct = getDirectAnalyzerMatch(query, matches);
    if (direct) {
      setAnalyzerInput(direct.symbol);
      analyzeTicker(direct.symbol);
      return;
    }
    renderAnalyzerMatchList(query, matches);
  } catch (error) {
    const fallbackSymbol = query.match(/^[A-Z0-9.-]+/i)?.[0]?.toUpperCase();
    target.innerHTML = `<p class="empty">${escapeHtml(error.message)}${fallbackSymbol ? ` Try selecting a suggestion or enter a full ticker such as ${escapeHtml(fallbackSymbol)}.` : ""}</p>`;
  }
}

async function renderCachedAnalyzer(symbol, lastError) {
  const target = document.getElementById("analyzer-result");
  try {
    const cache = await loadAnalyzerCache();
    const cleanSymbol = symbol.trim().toUpperCase();
    const cached = cache.results?.[cleanSymbol];
    if (cached) {
      renderAnalyzer({
        ...cached,
        managerRead: `${cached.managerRead} Public cached read from ${dateTime(cache.updatedAt)}. Local dashboard gives a live refresh.`,
      });
      return true;
    }
    target.innerHTML = `
      <p class="empty">
        ${lastError} Public GitHub Pages can only analyze cached symbols right now.
        ${cache.symbols?.length ? `Cached symbols include: ${cache.symbols.slice(0, 28).join(", ")}${cache.symbols.length > 28 ? "..." : ""}.` : ""}
        For any ticker live, open the local dashboard at http://127.0.0.1:5050.
      </p>
    `;
    return true;
  } catch (error) {
    target.innerHTML = `<p class="empty">${lastError} Analyzer cache is not published yet. Open the local dashboard at http://127.0.0.1:5050 for live ticker-by-ticker analysis.</p>`;
    return false;
  }
}

async function analyzeTicker(symbol) {
  const target = document.getElementById("analyzer-result");
  target.innerHTML = `<p class="empty">Analyzing ${symbol.toUpperCase()}...</p>`;
  const apiUrls = [
    `/api/analyze?symbol=${encodeURIComponent(symbol)}`,
    `https://trading-system-dashboard.onrender.com/api/analyze?symbol=${encodeURIComponent(symbol)}`,
  ];
  let lastError = "Analyzer failed.";
  try {
    for (const apiUrl of apiUrls) {
      const response = await fetch(apiUrl, { cache: "no-store" });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        lastError = "Live API did not return JSON.";
        continue;
      }
      const data = await response.json();
      if (!response.ok || data.error) {
        lastError = data.error || "Analyzer failed.";
        continue;
      }
      renderAnalyzer(data);
      return;
    }
    await renderCachedAnalyzer(symbol, lastError);
  } catch (error) {
    await renderCachedAnalyzer(symbol, `${error.message}. The hosted analyzer backend may be sleeping or not deployed yet.`);
  }
}


document.getElementById("analyzer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await resolveOrShowAnalyzerMatches(document.getElementById("analyzer-symbol").value);
});
document.getElementById("analyzer-symbol").addEventListener("input", renderAnalyzerSuggestions);
document.getElementById("analyzer-symbol").addEventListener("focus", renderAnalyzerSuggestions);
document.getElementById("analyzer-suggestions").addEventListener("click", (event) => {
  const button = event.target.closest(".analyzer-suggestion");
  if (!button) return;
  setAnalyzerInput(button.dataset.symbol);
  analyzeTicker(button.dataset.symbol);
});
document.getElementById("analyzer-result").addEventListener("click", (event) => {
  const button = event.target.closest("[data-analyzer-pick]");
  if (!button) return;
  setAnalyzerInput(button.dataset.analyzerPick);
  analyzeTicker(button.dataset.analyzerPick);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".analyzer-form")) {
    document.getElementById("analyzer-suggestions").classList.remove("analyzer-suggestions--open");
  }
});
