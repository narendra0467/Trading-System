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

function plainSignal(signal) {
  if (signal === "CALL_SETUP") return "Bullish option idea";
  if (signal === "PUT_SETUP") return "Bearish option idea";
  if (signal === "WATCH") return "Watch only";
  if (signal === "PREMIUM_SELL_WATCH") return "No simple buy trade";
  if (signal === "BUY_SETUP") return "Bullish stock idea";
  if (signal === "EXIT_WARNING") return "Exit warning";
  return signal;
}

function confidence(score) {
  const number = Number(score);
  if (number >= 80) return "High";
  if (number >= 70) return "Good";
  if (number >= 60) return "Medium";
  return "Low";
}

function confidenceClass(score) {
  const label = confidence(score).toLowerCase();
  return `confidence-badge confidence-badge--${label}`;
}

function confidenceBadge(score) {
  return `<span class="${confidenceClass(score)}">${confidence(score)} confidence</span>`;
}

function scoreBadge(score) {
  const number = Number(score);
  return `<span class="${confidenceClass(number)}">${Number.isFinite(number) ? `${number}/100` : "n/a"}</span>`;
}

function biasLabel(bias) {
  if (bias === "BULLISH_DAY") return "Bullish Day";
  if (bias === "BEARISH_DAY") return "Bearish Day";
  if (bias === "CHOP_DAY") return "Chop Day";
  return "No Read Yet";
}

function biasClass(bias) {
  if (bias === "BULLISH_DAY") return "bias-card bias-card--bullish";
  if (bias === "BEARISH_DAY") return "bias-card bias-card--bearish";
  return "bias-card bias-card--chop";
}

function optionAction(row) {
  if (!row.beginnerStrategy) {
    return "No simple call/put trade here right now. This is only a watch item.";
  }
  return `Simple trade: ${row.beginnerAction}`;
}

function renderCoachCards(optionsAlerts, optionsScan) {
  const target = document.getElementById("coach-cards");
  const scanRows = optionsScan ?? [];
  const longOptionRows = (optionsAlerts ?? [])
    .filter((row) => ["CALL_SETUP", "PUT_SETUP", "WATCH"].includes(row.signal) && ["BUY_CALL", "BUY_PUT"].includes(row.beginnerStrategy));
  const hasPut = longOptionRows.some((row) => row.beginnerStrategy === "BUY_PUT");
  const topWatch = scanRows[0];
  const optionCards = longOptionRows
    .slice(0, 6)
    .map((row) => {
      const optionCost = Number(row.optionCost);
      return `
        <article class="coach-card ${row.signal === "CALL_SETUP" ? "coach-card--bullish" : row.signal === "PUT_SETUP" ? "coach-card--bearish" : "coach-card--neutral"}">
          <div class="coach-head">
            <div>
              <span class="symbol">${row.symbol}</span>
              ${pill(plainSignal(row.signal))}
            </div>
            ${confidenceBadge(row.score)}
          </div>
          <p class="action">${optionAction(row)}</p>
          <div class="explain-grid">
            <div><span>Option price</span><strong>${money(row.optionEntry)}</strong></div>
            <div><span>Cost for 1 contract</span><strong>${wholeMoney(optionCost)}</strong></div>
            <div><span>Take profit area</span><strong>${money(row.optionTarget1)} to ${money(row.optionTarget2)}</strong></div>
            <div><span>Cut loss near</span><strong>${money(row.optionStop)}</strong></div>
          </div>
          <div class="explain-grid">
            <div><span>Stock now</span><strong>${money(row.underlying)}</strong></div>
            <div><span>Stock target</span><strong>${money(row.underlyingTarget || row.targetUnderlying)}</strong></div>
            <div><span>Stock danger level</span><strong>${money(row.underlyingStop || row.stopUnderlying)}</strong></div>
            <div><span>Score</span><strong>${scoreBadge(row.score)}</strong></div>
          </div>
          <ul class="plain-list">
            <li>This card is for buying one option contract, then selling it later for profit or loss.</li>
            <li>One option contract controls 100 shares, so ${money(row.optionEntry)} costs about ${wholeMoney(optionCost)}.</li>
            <li>If option drops near ${money(row.optionStop)}, cut the loss. If it reaches ${money(row.optionTarget1)}, consider taking profit.</li>
            <li>Why: ${row.reason || "technical setup matched"}</li>
          </ul>
        </article>
      `;
    });

  const scanStatusCard = optionCards.length === 0 && scanRows.length > 0 ? `
    <article class="coach-card coach-card--neutral">
      <div class="coach-head">
        <div>
          <span class="symbol">OPTIONS</span>
          ${pill("Scan ran")}
        </div>
        ${topWatch ? confidenceBadge(topWatch.score) : ""}
      </div>
      <p class="action">Scanned ${scanRows.length} popular option stocks. No clean beginner buy-call or buy-put passed the risk and contract filters right now.</p>
      <ul class="plain-list">
        <li>Best technical watch: ${topWatch ? `${topWatch.symbol} ${scoreBadge(topWatch.score)}` : "n/a"}.</li>
        <li>That means wait. For simple trading, cash is a valid position until the contract price, trend, and stop make sense.</li>
        <li>The table below still shows the watchlist so you can see the scan actually updated.</li>
      </ul>
    </article>
  ` : "";

  const putNote = hasPut ? "" : `
    <article class="coach-card coach-card--neutral">
      <div class="coach-head">
        <div>
          <span class="symbol">PUTS</span>
          ${pill("No bearish put setup now")}
        </div>
      </div>
      <p class="action">The system checks puts too. Right now it does not see a clean bearish put-buy setup in the core stock universe.</p>
      <ul class="plain-list">
        <li>That usually means trend, momentum, or market regime is not bearish enough.</li>
        <li>When bearish setups appear, they will show here as "Bearish option idea."</li>
      </ul>
    </article>
  `;

  const cards = [...optionCards, scanStatusCard, putNote].filter(Boolean);
  target.innerHTML = cards.length ? cards.join("") : `<p class="empty">Run scans first, then beginner cards will appear here.</p>`;
}

function renderLeapsCards(leapsAlerts) {
  const target = document.getElementById("leaps-cards");
  const cards = (leapsAlerts ?? []).slice(0, 8).map((row) => `
    <article class="coach-card ${row.status === "Ready for Starter" ? "coach-card--bullish" : row.status === "Avoid" ? "coach-card--bearish" : "coach-card--neutral"}">
      <div class="coach-head">
        <div>
          <span class="symbol">${row.symbol}</span>
          ${pill(row.status || row.decision)}
        </div>
        <strong>${row.leapsOpportunityScore ?? row.score ?? "n/a"}/100</strong>
      </div>
      <p class="action">${row.finalResearchVerdict || row.whyOpportunityExists || row.tradePlan || "No LEAPS trade plan available."}</p>
      <div class="explain-grid">
        <div><span>Underlying score</span><strong>${row.underlyingScore ?? "n/a"}</strong></div>
        <div><span>Risk score</span><strong>${row.riskScore ?? "n/a"}</strong></div>
        <div><span>Pullback</span><strong>${row.pullbackClassification || "n/a"}</strong></div>
        <div><span>DCA</span><strong>${row.dcaSuitability || "n/a"}</strong></div>
      </div>
      <div class="explain-grid">
        <div><span>Stock Now</span><strong>${money(row.currentPrice)}</strong></div>
        <div><span>Best contract</span><strong>${row.bestContractCandidate || "n/a"}</strong></div>
        <div><span>Delta</span><strong>${row.delta ?? row.preferredDelta ?? "n/a"}</strong></div>
        <div><span>Spread / OI</span><strong>${row.spreadPct ?? "n/a"}% / ${row.openInterest ?? "n/a"}</strong></div>
      </div>
      <ul class="plain-list">
        <li>This is calls-only, long-dated option research. It is not a buy/sell recommendation.</li>
        <li>Preferred expiry: ${row.preferredExpiryRange || "12-24 months preferred; 6 months minimum"}.</li>
        <li>Bull case: ${row.bullCase || "No bull case available."}</li>
        <li>Bear case: ${row.bearCase || row.reason || "No bear case available."}</li>
      </ul>
    </article>
  `);
  target.innerHTML = cards.length ? cards.join("") : `<p class="empty">No high-quality LEAPS candidates today.</p>`;
}

function renderSwingSummary(stockScan, stockAlerts) {
  const target = document.getElementById("swing-summary");
  const rows = stockScan ?? [];
  const alerts = stockAlerts ?? [];
  const buyCount = alerts.filter((row) => row.signal === "BUY_SETUP").length;
  const watchCount = alerts.filter((row) => row.signal === "WATCH" || row.signal === "HOLD_TREND").length;
  const exitCount = alerts.filter((row) => row.signal === "EXIT_WARNING").length;
  const best = alerts.find((row) => row.signal === "BUY_SETUP") ?? alerts[0];
  target.innerHTML = `
    <article class="bias-card bias-card--bullish">
      <span>Universe</span>
      <strong>${rows.length || alerts.length} stocks scanned</strong>
      <p>This tab now scans a bigger liquid swing universe, not just the old 10-name seed list.</p>
    </article>
    <article class="bias-card">
      <span>Best Swing Action</span>
      <strong>${best ? `${best.symbol} ${plainSignal(best.signal)}` : "No fresh setup"}</strong>
      <p>${best?.entryPlan || "Wait for a clean trend setup before risking money."}</p>
    </article>
    <article class="bias-card">
      <span>Board</span>
      <strong>${buyCount} buy / ${watchCount} watch / ${exitCount} exit</strong>
      <p>Big swings are 2-8 week trades. The stop decides if the idea is wrong.</p>
    </article>
  `;
}

function renderSwingCards(stockAlerts) {
  const target = document.getElementById("swing-cards");
  const priority = { BUY_SETUP: 0, WATCH: 1, HOLD_TREND: 2, EXIT_WARNING: 3 };
  const cards = (stockAlerts ?? [])
    .filter((row) => ["BUY_SETUP", "WATCH", "HOLD_TREND", "EXIT_WARNING"].includes(row.signal))
    .sort((a, b) => (priority[a.signal] ?? 9) - (priority[b.signal] ?? 9) || Number(b.score) - Number(a.score))
    .slice(0, 8)
    .map((row) => `
      <article class="coach-card ${row.signal === "BUY_SETUP" ? "coach-card--bullish" : row.signal === "EXIT_WARNING" ? "coach-card--bearish" : "coach-card--neutral"}">
        <div class="coach-head">
          <div>
            <span class="symbol">${row.symbol}</span>
            ${pill(plainSignal(row.signal))}
          </div>
          ${confidenceBadge(row.score)}
        </div>
        <p class="action">${row.setup || "Swing setup"}: ${row.entryPlan || "Wait for a cleaner entry."}</p>
        <div class="explain-grid">
          <div><span>Stock now</span><strong>${money(row.close)}</strong></div>
          <div><span>Buy zone</span><strong>${money(row.buyZoneLow)}-${money(row.buyZoneHigh)}</strong></div>
          <div><span>Stop</span><strong>${money(row.stop)}</strong></div>
          <div><span>Main target</span><strong>${money(row.target)}</strong></div>
        </div>
        <ul class="plain-list">
          <li>Hold plan: ${row.holdPlan || "2-8 weeks if trend holds."}</li>
          <li>Size plan: ${row.sizePlan || "Starter size first. Add only if it works."}</li>
          <li>First target: ${money(row.target1)}. Risk: ${row.riskPct || "n/a"}%. Reward/risk: ${row.rewardRisk || "n/a"}.</li>
          <li>Trend levels: EMA20 ${money(row.ema20)}, EMA50 ${money(row.ema50)}, 55-day high ${money(row.high55)}.</li>
          <li>Why: ${row.reason || "technical setup matched"}</li>
        </ul>
      </article>
    `);
  target.innerHTML = cards.length ? cards.join("") : `<p class="empty">Run stock swing scan first.</p>`;
}

function highRiskSignalLabel(signal) {
  if (signal === "SPEC_BUY") return "Spec Buy";
  if (signal === "STARTER_BUY") return "Starter Buy";
  if (signal === "WATCHLIST") return "Watch";
  return signal || "No Edge";
}

function highRiskClass(signal) {
  if (signal === "SPEC_BUY") return "decision-badge decision-badge--trade";
  if (signal === "STARTER_BUY") return "decision-badge decision-badge--wait";
  return "decision-badge decision-badge--no";
}

function highRiskBadge(signal) {
  return `<span class="${highRiskClass(signal)}">${highRiskSignalLabel(signal)}</span>`;
}

function analyzerDecisionClass(decision) {
  if (decision === "BUY" || decision === "WATCH / STARTER BUY") return "coach-card--bullish";
  if (decision === "SELL / EXIT RISK" || decision === "AVOID NEW BUY") return "coach-card--bearish";
  return "coach-card--neutral";
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

function rowsByLabel(checklist, labels) {
  return labels.map((label) => checklist?.rows?.find((row) => row.label === label)).filter(Boolean);
}

function renderReportSection(result) {
  const checklist = result.growthChecklist;
  const report = result.report ?? {};
  const moat = result.moat ?? {};
  const newsEngine = result.newsEngine ?? {};
  const reportScores = result.reportScores ?? {
    overallScore: result.totalScore,
    growthPotential: result.growthPotential,
    riskScore: result.riskScore,
    weighting: [],
  };
  const valuationRows = rowsByLabel(checklist, ["P/E Ratio", "Forward P/E", "PEG Ratio", "P/B Ratio", "P/S Ratio", "Enterprise Value / EBITDA"]);
  const healthRows = rowsByLabel(checklist, ["Gross Profit Margin", "Operating Profit Margin", "Net Profit Margin", "EBITDA Margin", "FCF Margin", "Return on Equity"]);
  const growthRows = rowsByLabel(checklist, ["1-Year Revenue Growth", "3-Year Revenue CAGR", "5-Year Revenue CAGR", "EPS Growth", "Return on Assets", "P/FCF"]);
  const advisorRows = result.advisorChecks ?? [];
  const kpiRows = result.kpiRows ?? [];
  const riskRows = result.riskBreakdown ?? [];
  const dataQuality = result.dataQuality ?? {};
  return `
    <article class="analyzer-detail investor-report" id="printable-analyzer-report">
      <div class="section-title">
        <div>
          <p class="eyebrow">Interactive Investor Report</p>
          <h2>${escapeHtml(result.symbol)} Stock Analysis</h2>
          <p class="muted">Latest live Yahoo Finance data as of ${dateTime(result.asOf)}.</p>
        </div>
        <div class="report-actions">
          <span class="growth-status growth-status--${checklist?.isGrowthStock ? "pass" : "fail"}">${checklist?.isGrowthStock ? "Growth stock" : "Not confirmed"}</span>
          <button type="button" class="print-report-button" data-toggle-report-theme>Dark / Light</button>
          <button type="button" class="print-report-button" data-print-analyzer>Download PDF</button>
        </div>
      </div>
      <div class="kpi-strip">
        ${reportMeter("Overall Score", reportScores.overallScore, "Revenue growth versus what the stock price already demands.")}
        ${reportMeter("Growth Potential", reportScores.growthPotential, "Higher means the company has growth plus enough chart/analyst support.")}
        ${reportMeter("Risk Analysis", reportScores.riskScore, `${result.riskLevel || riskLevel(reportScores.riskScore)} risk. Higher means more things can go wrong, but quality and balance sheet strength reduce the score.`, true)}
      </div>
      <div class="report-snapshot">
        <div><span>Research view</span><strong>${escapeHtml(result.investigateFurther || result.finalAction || "Research only")}</strong><p>No buy/sell call. This separates company quality, valuation, risk, growth potential, and timing.</p></div>
        <div><span>Quality profile</span><strong>${escapeHtml(result.fundamentals?.rating || "n/a")}</strong><p>${escapeHtml(result.business?.ownershipStyle || "Watchlist candidate")}</p></div>
        <div><span>Valuation profile</span><strong>${escapeHtml(result.valuation?.rating || "n/a")}</strong><p>Premium multiples are risk, not automatic danger when quality and growth are strong.</p></div>
        <div><span>Risk level</span><strong>${escapeHtml(result.riskLevel || riskLevel(reportScores.riskScore))}</strong><p>Built from valuation, balance sheet, dilution, execution, competition, news, and trend risk.</p></div>
      </div>
      <div class="decision-strip">
        <div><span>Would I investigate this further?</span><strong>${escapeHtml(result.investigateFurther || result.finalAction || "Research only")}</strong><p>Not a buy/sell recommendation. Use this as a research priority label.</p></div>
        <div><span>Moat Score</span><strong>${Number.isFinite(Number(moat.score)) ? Math.round(moat.score) : "n/a"}/100</strong><p>${escapeHtml(moat.rating || "Moat evidence not available.")}</p></div>
        <div><span>News / Catalyst Tape</span><strong>${escapeHtml(newsEngine.tone || "n/a")}</strong><p>${Number(newsEngine.catalystCount ?? 0)} catalyst headlines, ${Number(newsEngine.bullishCount ?? 0)} bullish, ${Number(newsEngine.bearishCount ?? 0)} bearish.</p></div>
      </div>
      <div class="data-quality">
        <div><span>Data date</span><strong>${escapeHtml(dateTime(dataQuality.marketDataDate || result.asOf))}</strong></div>
        <div><span>Latest quarter used</span><strong>${escapeHtml(dataQuality.latestQuarterUsed || "Unavailable")}</strong></div>
        <div><span>SEC / filing cross-check</span><strong>${escapeHtml(dataQuality.secCrossCheck || "Unavailable")}</strong></div>
      </div>
      <div class="kpi-ticker-strip">${kpiRows.map(kpiCard).join("")}</div>
      <div class="score-bars">
        ${(reportScores.weighting ?? []).map((item) => `
          <div>
            <div><span>${escapeHtml(item.label)} (${item.weight}%)</span><strong>${Math.round(item.score)}/100</strong></div>
            <div class="meter-track"><span style="width:${Math.max(0, Math.min(100, Number(item.score) || 0))}%"></span></div>
            <p>${escapeHtml(item.note)}</p>
          </div>
        `).join("")}
      </div>
      <details class="report-section" open><summary>1. Business Model</summary><p>${escapeHtml(report.businessModel || "Business model was not available.")}</p></details>
      <details class="report-section" open><summary>2. Moat and Competition</summary><p>${escapeHtml(report.moat || "Moat read was not available.")}</p><p><strong>Peers:</strong> ${(report.competitors ?? []).map(escapeHtml).join(" / ") || "n/a"}</p><p>${escapeHtml(report.technologyAdvantage || "Technology advantage was not confirmed.")}</p></details>
      <details class="report-section" open><summary>3-5. Financial Quality, Growth, Valuation</summary>
        <h3>Financial Health</h3><div class="metric-card-grid">${healthRows.map(metricCard).join("")}</div>
        <h3>Growth</h3><div class="metric-card-grid">${growthRows.map(metricCard).join("")}</div>
        <h3>Valuation</h3><div class="metric-card-grid">${valuationRows.map(metricCard).join("")}</div>
      </details>
      <details class="report-section"><summary>6-7. Balance Sheet and Dilution Risk</summary><div class="metric-card-grid metric-card-grid--advisor">${advisorRows.slice(0, 8).map(advisorCard).join("")}</div></details>
      <details class="report-section" open><summary>8-9. Catalysts, Deals, Backlog, Partnerships</summary><ul class="plain-list">${(report.catalysts ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No specific catalysts found.</li>"}</ul><p>${escapeHtml(report.partnerships || "Partnership data was not available.")}</p></details>
      <details class="report-section" open><summary>10. Asymmetry Check</summary><p>${escapeHtml(report.asymmetry || "Asymmetry read was not available.")}</p></details>
      ${renderHiddenMultibagger(result)}
      <details class="report-section" open><summary>13. Technical Trend Snapshot</summary><div class="metric-card-grid metric-card-grid--advisor">
        ${advisorCard({ label: "Trend", status: result.technical?.score >= 60 ? "pass" : result.technical?.score >= 45 ? "near" : "fail", value: `${result.technical?.rating || "n/a"} trend. Price ${money(result.technical?.close)}, EMA50 ${money(result.technical?.ema50)}, EMA150 ${money(result.technical?.ema150)}.` })}
        ${advisorCard({ label: "Momentum", status: result.technical?.rsi14 >= 50 ? "pass" : "near", value: `RSI ${result.technical?.rsi14 ?? "n/a"}, ADX ${result.technical?.adx14 ?? "n/a"}, relative strength ${result.technical?.relativeStrength60 ?? "n/a"}%.` })}
        ${advisorCard({ label: "Support / Resistance", status: "near", value: `Chart stop near ${money(result.technical?.stop)}; target zone near ${money(result.technical?.target)}; 55-day high ${money(result.technical?.high55)}.` })}
      </div></details>
      <details class="report-section" open><summary>14. Red Flags</summary><ul class="plain-list">${[...(result.risks ?? []), ...(dataQuality.missingOrEstimatedValues ?? []).map((item) => `Missing/estimated: ${item}`)].slice(0, 12).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No major red flags from available fields.</li>"}</ul></details>
      <h3>Peer Comparison</h3>
      ${peerTable(result.peerComparison ?? [])}
      <h3>Risk Heatmap</h3>
      <div class="risk-heatmap">${riskRows.map(riskHeatCell).join("")}</div>
      <h3>Advisor Add-ons</h3>
      <div class="metric-card-grid metric-card-grid--advisor">${advisorRows.map(advisorCard).join("")}</div>
      <div class="analyzer-columns">
        <div>
          <h3>Moat Evidence</h3>
          <ul class="plain-list">${(moat.points ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No strong moat evidence found in available fields.</li>"}</ul>
        </div>
        <div>
          <h3>Moat Risks</h3>
          <ul class="plain-list">${(moat.risks ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No major moat risks from available fields.</li>"}</ul>
        </div>
      </div>
      <div class="news-panel">
        <div class="section-title">
          <div>
            <p class="eyebrow">Yahoo News + Filings</p>
            <h3>Catalyst Intelligence</h3>
          </div>
          <span class="growth-status growth-status--${scoreTone(newsEngine.score) === "good" ? "pass" : scoreTone(newsEngine.score) === "bad" ? "fail" : "near"}">${Number.isFinite(Number(newsEngine.score)) ? Math.round(newsEngine.score) : "n/a"}/100</span>
        </div>
        <div class="news-grid">
          <div>
            <span>Recent Headlines</span>
            <ul class="plain-list">${(newsEngine.items ?? []).slice(0, 5).map((item) => `<li><a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a><small>${escapeHtml(item.publisher || "")} - ${escapeHtml(item.tone || "neutral")}</small></li>`).join("") || "<li>No Yahoo headline feed available.</li>"}</ul>
          </div>
          <div>
            <span>SEC Filing Watch</span>
            <p>${escapeHtml(newsEngine.filingRead || "No filing read available.")}</p>
            <ul class="plain-list">${(newsEngine.filings ?? []).slice(0, 3).map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(`${item.date || ""} ${item.type || ""}: ${item.title || ""}`)}</a></li>`).join("") || "<li>No recent filings from Yahoo.</li>"}</ul>
          </div>
          <div>
            <span>Analyst Revisions</span>
            <ul class="plain-list">${(newsEngine.upgrades ?? []).slice(0, 4).map((item) => `<li>${escapeHtml(`${item.date || ""} ${item.firm || ""}: ${item.fromGrade || "n/a"} -> ${item.toGrade || "n/a"}${item.priceTargetAction ? `, target ${item.priceTargetAction}` : ""}`)}</li>`).join("") || "<li>No recent upgrade/downgrade history from Yahoo.</li>"}</ul>
            <p>${escapeHtml(newsEngine.caveat || "")}</p>
          </div>
        </div>
      </div>
      <div class="analyzer-columns">
        <div class="thesis-card thesis-card--bull"><h3>Bull Case</h3><p>${escapeHtml(report.bullCase || "Bull case was not available.")}</p></div>
        <div class="thesis-card thesis-card--bear"><h3>Bear Case</h3><p>${escapeHtml(report.bearCase || "Bear case was not available.")}</p></div>
      </div>
      <p class="action">${escapeHtml(report.shortAnalysis || checklist?.summary || "Use this as a research starting point.")}</p>
      <div class="final-summary-card">
        <span>15. Final Short Analysis</span>
        <p>${escapeHtml(report.shortAnalysis || "Use this as a research starting point.")}</p>
        <p>${escapeHtml(dataQuality.caveat || "This is an analytical research report, not financial advice.")}</p>
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

function renderHighRiskSummary(summary, rows) {
  const summaryTarget = document.getElementById("highrisk-summary");
  const rulesTarget = document.getElementById("highrisk-rules");
  const cleanRows = rows ?? [];
  const top = cleanRows.find((row) => ["SPEC_BUY", "STARTER_BUY", "WATCHLIST"].includes(row.signal));
  const context = summary?.marketContext ?? {};
  const qqq = context.QQQ;
  const xiu = context["XIU.TO"];
  const eventRiskCount = cleanRows.filter((row) => row.eventRisk && row.eventRisk !== "CLEAR").length;
  summaryTarget.innerHTML = `
    <article class="bias-card bias-card--bearish">
      <span>Sleeve</span>
      <strong>${money(summary?.accountSize ?? 5000)}</strong>
      <p>This is money you accept can go to zero. The system still uses stops to avoid wasting the whole sleeve on one bad chart.</p>
    </article>
    <article class="bias-card">
      <span>Best Spec Setup</span>
      <strong>${top ? `${top.symbol} ${highRiskSignalLabel(top.signal)}` : "No clean setup"}</strong>
      <p>${top?.managerRead || "No speculative chart is strong enough right now."}</p>
    </article>
    <article class="bias-card">
      <span>Market Context</span>
      <strong>QQQ ${qqq?.return20 ?? "n/a"}% / XIU ${xiu?.return20 ?? "n/a"}%</strong>
      <p>${summary?.buyCount ?? 0} spec buys, ${summary?.starterCount ?? 0} starter buys, ${summary?.watchCount ?? 0} watchlist names. ${eventRiskCount} need macro/news review before entry.</p>
    </article>
  `;
  const rulePills = (summary?.rules ?? [
    "This is not retirement money.",
    "Maximum 5-7 names.",
    "No averaging down below stop.",
  ]).map((rule) => `<span>${rule}</span>`);
  const indexPills = ["SPY", "QQQ", "IWM", "ARKK", "XIU.TO", "XIC.TO"]
    .filter((symbol) => context[symbol])
    .map((symbol) => `<span>${symbol} 20D ${context[symbol].return20 ?? "n/a"}% / 60D ${context[symbol].return60 ?? "n/a"}%</span>`);
  rulesTarget.innerHTML = [...rulePills, ...indexPills].join("");
}

function renderHighRiskCards(rows) {
  const target = document.getElementById("highrisk-cards");
  const priority = { SPEC_BUY: 0, STARTER_BUY: 1, WATCHLIST: 2 };
  const cards = (rows ?? [])
    .filter((row) => ["SPEC_BUY", "STARTER_BUY", "WATCHLIST"].includes(row.signal))
    .sort((a, b) => (priority[a.signal] ?? 9) - (priority[b.signal] ?? 9) || Number(b.score) - Number(a.score))
    .slice(0, 8)
    .map((row) => `
      <article class="coach-card ${row.signal === "SPEC_BUY" ? "coach-card--moonshot" : row.signal === "STARTER_BUY" ? "coach-card--bullish" : "coach-card--neutral"}">
        <div class="coach-head">
          <div>
            <span class="symbol">${row.symbol}</span>
            ${highRiskBadge(row.signal)}
          </div>
          <strong>${row.conviction || `Rating ${row.rating}`}</strong>
        </div>
        <p class="action">${row.managerRead}</p>
        <div class="explain-grid">
          <div><span>Action</span><strong>${row.clientAction || highRiskSignalLabel(row.signal)}</strong></div>
          <div><span>Buy zone</span><strong>${money(row.buyZoneLow)}-${money(row.buyZoneHigh)}</strong></div>
          <div><span>Stop loss</span><strong>${money(row.stop)}</strong></div>
          <div><span>Target 1</span><strong>${money(row.target1)}</strong></div>
        </div>
        <ul class="plain-list">
          <li>Theme: ${row.theme || "speculative growth"} (${row.market || "US/Canada"}).</li>
          <li>Setup read: ${row.scoreSummary || row.conviction || "Technical setup under review."}</li>
          <li>Technical reason: ${row.reason}</li>
          <li>News/macro: ${row.macroRead || "Manual news check required."} ${row.eventRiskReason || ""}</li>
          <li>20-day: ${row.return20}%, 60-day: ${row.return60}%, relative strength: ${row.relativeStrength60 ?? "n/a"}%.</li>
          <li>Risk: ${row.riskClass}; stop risk ${row.riskPct}%; planned capital ${money(row.capitalPlan)}; shares ${row.shares}.</li>
          <li>Entry: ${row.entryPlan}</li>
        </ul>
      </article>
    `);
  target.innerHTML = cards.length ? cards.join("") : `<p class="empty">Run npm run highrisk:scan first.</p>`;
}

function daysOld(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function renderHiddenMultibaggerDashboard(report) {
  const summaryTarget = document.getElementById("hidden-summary");
  const cardsTarget = document.getElementById("hidden-cards");
  const rows = report?.candidates ?? [];
  const ageDays = daysOld(report?.generatedAt);
  const isStale = Number.isFinite(ageDays) && ageDays > 7;
  const top = rows[0];
  summaryTarget.innerHTML = `
    <article class="bias-card ${isStale ? "bias-card--bearish" : "bias-card--bullish"}">
      <span>Refresh Status</span>
      <strong>${Number.isFinite(ageDays) ? `${ageDays} day${ageDays === 1 ? "" : "s"} old` : "Not scanned"}</strong>
      <p>${isStale ? "Older than one week. Run npm run hidden:scan before relying on this watchlist." : "Fresh enough for weekly research review."} Auto-refresh runs Mondays at 7:00 AM Alberta time when the dashboard server is open.</p>
    </article>
    <article class="bias-card">
      <span>Watchlist</span>
      <strong>${rows.length} candidates</strong>
      <p>${report?.scanned ?? 0} seed stocks scanned. ${report?.investorMode ? "Investor mode is on." : "This is research only, not a buy/sell list."}</p>
    </article>
    <article class="bias-card">
      <span>Top Candidate</span>
      <strong>${top ? `${top.symbol} ${Math.round(top.researchDeskScore ?? top.score)}/100` : "No candidate"}</strong>
      <p>${top?.positionSizingCategory || top?.researchTier || top?.classification || "Run npm run hidden:scan to generate this section."}</p>
    </article>
  `;

  cardsTarget.innerHTML = rows.slice(0, 6).map((row) => `
    <article class="coach-card hidden-card">
      <div class="coach-head">
        <div>
          <span class="symbol">${escapeHtml(row.symbol)}</span>
          ${pill(row.positionSizingCategory || row.researchTier || row.classification)}
        </div>
        <strong>${Math.round(row.researchDeskScore ?? row.score)}/100</strong>
      </div>
      <p class="action">${escapeHtml(row.name)}: ${escapeHtml(row.bestPracticalApproach || row.investorRead || row.bullCase || "Research candidate.")}</p>
      <div class="explain-grid">
        <div><span>Market cap</span><strong>${escapeHtml(row.marketCapDisplay)}</strong></div>
        <div><span>3x path</span><strong>${escapeHtml(row.multibaggerPath?.path3 || "n/a")}</strong></div>
        <div><span>Proof</span><strong>${Math.round(row.proofScore ?? 0)}/100</strong></div>
        <div><span>Entry</span><strong>${escapeHtml(row.entryQuality?.classification || "n/a")}</strong></div>
      </div>
      <ul class="plain-list">
        <li>Risk: ${Math.round(row.riskScore)}/100. Hidden factor: ${Math.round(row.hiddenFactorScore ?? 0)}/100.</li>
        <li>Kill criteria: ${escapeHtml(row.killCriteria?.[0] || "Monitor revenue, margin, dilution, and balance-sheet deterioration.")}</li>
        <li>Catalyst: ${escapeHtml(row.catalyst || "No confirmed catalyst found.")}</li>
        <li>Verdict: ${escapeHtml(row.finalResearchVerdict || row.researchTier || row.verdict || row.classification || "Research only.")}</li>
      </ul>
    </article>
  `).join("") || `<p class="empty">Run npm run hidden:scan to generate hidden multibagger candidates.</p>`;

  renderTable("hidden-table", rows.slice(0, 20), [
    { key: "symbol", label: "Ticker" },
    { key: "name", label: "Company" },
    { key: "sector", label: "Sector" },
    { key: "marketCapDisplay", label: "Market Cap" },
    { key: "revenueGrowthDisplay", label: "Rev Growth" },
    { key: "revenueCagr3Display", label: "3Y CAGR" },
    { key: "researchDeskScore", label: "Desk", formatter: (value) => `${Math.round(Number(value) || 0)}/100` },
    { key: "proofScore", label: "Proof", formatter: (value) => `${Math.round(Number(value) || 0)}/100` },
    { key: "hiddenFactorScore", label: "Hidden", formatter: (value) => `${Math.round(Number(value) || 0)}/100` },
    { key: "multibaggerPath", label: "3x Path", formatter: (value) => value?.path3 || "n/a", pill: true },
    { key: "entryQuality", label: "Entry", formatter: (value) => value?.classification || "n/a", pill: true },
    { key: "gateScore", label: "Gates", formatter: (value) => `${Math.round(Number(value) || 0)}/100` },
    { key: "score", label: "Score", formatter: (value) => `${Math.round(Number(value) || 0)}/100` },
    { key: "riskScore", label: "Risk", formatter: (value) => `${Math.round(Number(value) || 0)}/100` },
    { key: "positionSizingCategory", label: "Category", pill: true },
    { key: "catalyst", label: "Catalyst" },
  ]);
}

function renderLongTermStarterPack(pack) {
  const summaryTarget = document.getElementById("longterm-summary");
  const rulesTarget = document.getElementById("longterm-rules");
  const cardsTarget = document.getElementById("longterm-cards");
  if (!pack) {
    summaryTarget.innerHTML = `<article class="bias-card"><span>Status</span><strong>No starter pack</strong><p>Long-term portfolio data is missing.</p></article>`;
    rulesTarget.innerHTML = "";
    cardsTarget.innerHTML = `<p class="empty">No long-term starter pack data.</p>`;
    return;
  }

  const holdings = pack.holdings ?? [];
  const etfPct = holdings.filter((row) => row.type === "ETF").reduce((total, row) => total + Number(row.allocationPct || 0), 0);
  const stockPct = holdings.filter((row) => row.type === "Stock").reduce((total, row) => total + Number(row.allocationPct || 0), 0);
  const topHolding = holdings[0];
  summaryTarget.innerHTML = `
    <article class="bias-card bias-card--bullish">
      <span>Starter Capital</span>
      <strong>${money(pack.accountSize)}</strong>
      <p>${holdings.length} holdings. ETFs are the base, stocks are satellites.</p>
    </article>
    <article class="bias-card">
      <span>Structure</span>
      <strong>${etfPct}% ETFs / ${stockPct}% stocks</strong>
      <p>Broad funds do the heavy lifting so one company cannot wreck the plan.</p>
    </article>
    <article class="bias-card">
      <span>Anchor</span>
      <strong>${topHolding?.symbol || "VOO"}</strong>
      <p>${pack.philosophy}</p>
    </article>
  `;

  rulesTarget.innerHTML = (pack.rules ?? []).map((rule) => `<span>${rule}</span>`).join("");

  const cards = holdings.map((row) => `
    <article class="coach-card ${row.type === "ETF" ? "coach-card--neutral" : "coach-card--bullish"}">
      <div class="coach-head">
        <div>
          <span class="symbol">${row.symbol}</span>
          ${pill(row.grade)}
        </div>
        <strong>${row.allocationPct}% / ${money(row.dollars)}</strong>
      </div>
      <p class="action">${row.role}: ${row.whyOwn}</p>
      <div class="explain-grid">
        <div><span>Type</span><strong>${row.type}</strong></div>
        <div><span>Dollars</span><strong>${money(row.dollars)}</strong></div>
        <div><span>Allocation</span><strong>${row.allocationPct}%</strong></div>
        <div><span>Buy plan</span><strong>${row.buyPlan}</strong></div>
      </div>
      <ul class="plain-list">
        <li>Moat: ${row.moat}</li>
        <li>Financial read: ${row.fundamentalRead}</li>
        <li>Risk: ${row.risk}</li>
        <li>Review rule: ${row.reviewRule}</li>
      </ul>
    </article>
  `);
  cardsTarget.innerHTML = cards.join("");
}

function renderTable(targetId, rows, columns) {
  const target = document.getElementById(targetId);
  if (!rows || rows.length === 0) {
    target.innerHTML = `<p class="empty">No data yet.</p>`;
    return;
  }
  target.innerHTML = `
    <table>
      <thead>
        <tr>${columns.map((column) => `<th>${column.label}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            ${columns.map((column) => {
              const value = column.formatter ? column.formatter(row[column.key], row) : row[column.key];
              return `<td>${column.pill ? pill(value) : format(value)}</td>`;
            }).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadDashboard(statusPrefix = "") {
  let response = await fetch(`/api/dashboard?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
    response = await fetch(`./dashboard.json?v=${Date.now()}`, { cache: "no-store" });
  }
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Dashboard data is not available.");
  }
  const data = await response.json();
  document.getElementById("updated-line").textContent = `${statusPrefix}Last refreshed: ${dateTime(data.updatedAt)}`;
  const regime = data.marketRegime;
  document.getElementById("regime").innerHTML = regime ? `
    <div class="metric"><span>Purpose</span><strong>Market permission filter</strong><p>Decides whether the desk should trade normally, trade smaller, or stay defensive.</p></div>
    <div class="metric"><span>Market mode</span><strong>${pill(regime.regime)}</strong><p>Broad tape read before individual setups.</p></div>
    <div class="metric"><span>Breadth / volatility</span><strong>${regime.score} / ${regime.vix ?? "n/a"}</strong><p>Breadth score and VIX risk check.</p></div>
    <div class="metric"><span>Trade read</span><strong>${regime.reason}</strong><p>This is a gate, not a standalone trade signal.</p></div>
  ` : `<div class="metric"><span>Market mode</span><strong>No scan yet</strong></div>`;

  renderCoachCards(data.optionsAlerts, data.optionsScan);
  const leapsRows = data.leapsReport?.top10?.length ? data.leapsReport.top10 : data.leapsAlerts;
  renderLeapsCards(leapsRows);
  renderHighRiskSummary(data.highRiskSummary, data.highRiskAlerts);
  renderHighRiskCards(data.highRiskAlerts);
  renderHiddenMultibaggerDashboard(data.hiddenMultibagger);
  renderLongTermStarterPack(data.longTermStarterPack);

  const longOptions = (data.optionsScan ?? []).filter((row) => ["BUY_CALL", "BUY_PUT"].includes(row.beginnerStrategy));
  const optionRows = longOptions.length ? longOptions : (data.optionsScan ?? []).slice(0, 20);
  renderTable("options-alerts", optionRows, [
    { key: "symbol", label: "Symbol" },
    { key: "signal", label: "Signal", formatter: plainSignal, pill: true },
    { key: "score", label: "Score", formatter: scoreBadge },
    { key: "expiration", label: "Exp" },
    { key: "beginnerStrategy", label: "Trade", formatter: (value) => value || "No simple buy" },
    { key: "optionStrike", label: "Strike" },
    { key: "optionEntry", label: "Option Price", formatter: money },
    { key: "optionCost", label: "1 Contract Cost", formatter: wholeMoney },
    { key: "optionStop", label: "Option Stop", formatter: money },
    { key: "optionTarget1", label: "Target 1", formatter: money },
    { key: "beginnerAction", label: "Beginner Read", formatter: (value) => value || "Watch only. No trade approved." },
  ]);

  renderTable("leaps-table", data.leapsReport?.top10?.length ? data.leapsReport.top10 : data.leapsScan, [
    { key: "symbol", label: "Symbol" },
    { key: "status", label: "Status", pill: true },
    { key: "decision", label: "Decision", pill: true },
    { key: "leapsOpportunityScore", label: "LEAPS Score" },
    { key: "underlyingScore", label: "Underlying" },
    { key: "riskScore", label: "Risk" },
    { key: "currentPrice", label: "Stock", formatter: money },
    { key: "pullbackClassification", label: "Pullback" },
    { key: "dcaSuitability", label: "DCA" },
    { key: "bestContractCandidate", label: "Best Contract" },
    { key: "optionLiquidityStatus", label: "Liquidity", pill: true },
    { key: "strike", label: "Strike" },
    { key: "expiration", label: "Exp" },
    { key: "dte", label: "DTE" },
    { key: "mid", label: "Mid", formatter: money },
    { key: "delta", label: "Delta" },
    { key: "impliedVolatility", label: "IV %" },
    { key: "breakeven", label: "Breakeven", formatter: money },
    { key: "breakevenMovePct", label: "BE Move %" },
    { key: "spreadPct", label: "Spread %" },
    { key: "openInterest", label: "OI" },
    { key: "finalResearchVerdict", label: "Verdict" },
  ]);

  renderTable("longterm-table", data.longTermStarterPack?.holdings, [
    { key: "symbol", label: "Symbol" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type", pill: true },
    { key: "allocationPct", label: "Allocation %" },
    { key: "dollars", label: "Dollars", formatter: money },
    { key: "role", label: "Role" },
    { key: "moat", label: "Moat" },
    { key: "fundamentalRead", label: "Fundamental Read" },
    { key: "risk", label: "Risk" },
    { key: "reviewRule", label: "Review Rule" },
  ]);

  renderTable("highrisk-table", data.highRiskAlerts, [
    { key: "symbol", label: "Symbol" },
    { key: "signal", label: "Signal", formatter: highRiskBadge },
    { key: "conviction", label: "Conviction" },
    { key: "clientAction", label: "Action" },
    { key: "close", label: "Close", formatter: money },
    { key: "buyZoneLow", label: "Buy Low", formatter: money },
    { key: "buyZoneHigh", label: "Buy High", formatter: money },
    { key: "stop", label: "Stop", formatter: money },
    { key: "target1", label: "Target 1", formatter: money },
    { key: "target2", label: "Target 2", formatter: money },
    { key: "doubleTarget", label: "100% Target", formatter: money },
    { key: "riskPct", label: "Stop Risk %" },
    { key: "return20", label: "20D %" },
    { key: "return60", label: "60D %" },
    { key: "volumeRatio", label: "Vol x" },
    { key: "eventRisk", label: "Event Risk" },
    { key: "scoreSummary", label: "Setup Read" },
    { key: "reason", label: "Technical Reason" },
  ]);

}

async function waitForRefreshToFinish() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const response = await fetch(`/api/refresh/status?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    const status = await response.json();
    if (!status.running) return status;
    document.getElementById("updated-line").textContent = `Refresh running... started ${dateTime(status.lastStartedAt)}`;
  }
  return { running: true, lastError: "Refresh is still running. Check again in a minute." };
}

async function manualRefreshDashboard() {
  const button = document.getElementById("refresh");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing...";
  document.getElementById("updated-line").textContent = "Starting refresh...";
  try {
    const response = await fetch(`/api/refresh?v=${Date.now()}`, { cache: "no-store" });
    const isJson = response.ok && (response.headers.get("content-type") ?? "").includes("application/json");
    if (!isJson) {
      await loadDashboard("Static reload only. Start npm run dashboard locally for live refresh. ");
      return;
    }
    const payload = await response.json();
    document.getElementById("updated-line").textContent = payload.message || "Refresh started...";
    const status = await waitForRefreshToFinish();
    const prefix = status?.lastError
      ? `Refresh issue: ${status.lastError}. `
      : status?.running
        ? "Refresh still running. "
        : "Live refresh complete. ";
    await loadDashboard(prefix);
  } catch (error) {
    await loadDashboard(`Refresh failed: ${error.message}. `);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.getElementById("refresh").addEventListener("click", manualRefreshDashboard);
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
setInterval(loadDashboard, 5 * 60 * 1000);
document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("tab-button--active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("tab-panel--active"));
    button.classList.add("tab-button--active");
    document.getElementById(`tab-${button.dataset.tab}`).classList.add("tab-panel--active");
  });
});
loadDashboard();
