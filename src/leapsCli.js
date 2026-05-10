import fs from "node:fs";
import path from "node:path";

import { scanLeapsDesk } from "./leapsScanner.js";
import { loadUniverse, loadUniverseRecords } from "./universe.js";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function toCsv(rows) {
  const flattenedRows = rows.map(({ underlyingComponents, pullback, optionContracts, dcaPlan, ...row }) => ({
    ...row,
    pullbackScore: pullback?.score,
    starterPositionZone: dcaPlan?.starterPositionZone,
    addZone1: dcaPlan?.addZone1,
    addZone2: dcaPlan?.addZone2,
    stopAddingInvalidationLevel: dcaPlan?.stopAddingInvalidationLevel,
  }));
  const headers = Object.keys(flattenedRows[0] ?? { symbol: "", decision: "", score: "" });
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...flattenedRows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function positionCsv(rows) {
  const flat = rows.map(({ pullback, eventRisk, exitDamageReview, optionContractDetails, ...row }) => ({
    ...row,
    eventRisk: eventRisk?.level,
    eventRiskHeadline: eventRisk?.headline,
    exitReviewDecision: exitDamageReview?.decision,
    exitReviewReason: exitDamageReview?.mainReason,
  }));
  return toCsv(flat);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "n/a";
}

function num(value, suffix = "") {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}${suffix}` : "n/a";
}

function tierClass(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("a+") || text.includes("ready") || text.includes("good") || text.includes("allowed")) return "good";
  if (text.includes("avoid") || text.includes("rejected") || text.includes("broken") || text.includes("falling")) return "bad";
  return "warn";
}

function meter(label, value, kind = "") {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  return `
    <div class="meter ${kind}">
      <span>${esc(label)}</span>
      <strong>${score}</strong>
      <div class="bar"><i style="width:${score}%"></i></div>
    </div>
  `;
}

function contractTable(contracts = []) {
  if (!contracts.length) return `<p class="empty">No contract passed the liquidity, spread, DTE, and delta filters.</p>`;
  return `
    <div class="contract-table">
      <table>
        <thead>
          <tr>
            <th>Expiration</th><th>Strike</th><th>Mid</th><th>Delta</th><th>Theta</th><th>Vega</th><th>IV</th><th>OI</th><th>Vol</th><th>BE</th><th>Intrinsic</th><th>Extrinsic</th><th>Spread</th><th>Quality</th>
          </tr>
        </thead>
        <tbody>
          ${contracts.map((row) => `
            <tr>
              <td>${esc(row.expiration)}</td>
              <td>${esc(row.strike)}</td>
              <td>${money(row.mid)}</td>
              <td>${esc(row.delta)}</td>
              <td>${esc(row.theta)}</td>
              <td>${esc(row.vega)}</td>
              <td>${esc(row.impliedVolatility)}%</td>
              <td>${esc(row.openInterest)}</td>
              <td>${esc(row.volume)}</td>
              <td>${money(row.breakeven)}</td>
              <td>${money(row.intrinsicValue)}</td>
              <td>${money(row.extrinsicValue)}</td>
              <td>${esc(row.spreadPct)}%</td>
              <td>${esc(row.contractQualityScore)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function miniTable(rows = [], columns = []) {
  if (!rows.length) return `<p class="empty">No rows in this section.</p>`;
  return `
    <div class="table-wrap table-wrap--small">
      <table>
        <thead><tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${columns.map((column) => `<td>${column.badge ? `<span class="pill ${tierClass(row[column.key])}">${esc(row[column.key])}</span>` : esc(column.formatter ? column.formatter(row[column.key], row) : row[column.key])}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHtml(report) {
  const rows = report.rows ?? [];
  const top10 = report.top10 ?? [];
  const top5 = report.top5 ?? [];
  const positions = report.portfolio?.positions ?? [];
  const portfolio = report.portfolio?.summary ?? {};
  const dcaRows = report.portfolio?.dcaCandidates ?? [];
  const noMoreAdds = report.portfolio?.noMoreAdds ?? [];
  const exitRows = report.portfolio?.exitReduceReview ?? [];
  const rollRows = report.portfolio?.rollCandidates ?? [];
  const replacementRows = report.portfolio?.replacementReview ?? [];
  const final = report.finalActionSummary ?? {};
  const top10Json = JSON.stringify(top10).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LEAPS Call Opportunity Desk</title>
    <style>
      :root { color-scheme: dark; --bg:#070b10; --panel:#111922; --panel2:#172331; --text:#f5f8fb; --muted:#95a5b8; --line:#293648; --green:#22c55e; --amber:#fbbf24; --red:#fb7185; --blue:#38bdf8; }
      body.light { color-scheme: light; --bg:#f5f7fb; --panel:#ffffff; --panel2:#eef3f8; --text:#0f172a; --muted:#526173; --line:#d8e0ea; }
      * { box-sizing:border-box; }
      body { margin:0; background:linear-gradient(180deg, rgba(56,189,248,.11), transparent 320px), var(--bg); color:var(--text); font-family:Inter,Segoe UI,Arial,sans-serif; }
      .shell { width:min(1380px, calc(100vw - 32px)); margin:0 auto; padding:24px 0 44px; }
      .topbar, .section-title, .toolbar { align-items:center; display:flex; gap:16px; justify-content:space-between; }
      h1,h2,h3 { margin:0; letter-spacing:0; }
      h1 { font-size:38px; }
      h2 { font-size:23px; }
      p { color:var(--muted); line-height:1.5; }
      .eyebrow { color:var(--blue); font-size:12px; font-weight:900; margin:0 0 6px; text-transform:uppercase; }
      button, select, input { border:1px solid var(--line); border-radius:6px; background:var(--panel2); color:var(--text); padding:10px 12px; }
      button { cursor:pointer; font-weight:900; }
      .hero { border:1px solid rgba(56,189,248,.28); background:linear-gradient(135deg, rgba(56,189,248,.14), rgba(34,197,94,.08), rgba(251,191,36,.08)); border-radius:8px; display:grid; gap:14px; grid-template-columns:1.2fr 1fr; margin:18px 0; padding:18px; }
      .meters { display:grid; gap:10px; grid-template-columns:repeat(3,minmax(0,1fr)); }
      .meter, .card, .context, .table-card { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:14px; }
      .meter span, .kpi span, .card span { color:var(--muted); display:block; font-size:11px; font-weight:900; text-transform:uppercase; }
      .meter strong { display:block; font-size:28px; margin:5px 0; }
      .bar { background:rgba(148,163,184,.23); border-radius:999px; height:8px; overflow:hidden; }
      .bar i { background:var(--blue); display:block; height:100%; }
      .meter.good .bar i { background:var(--green); }
      .meter.warn .bar i { background:var(--amber); }
      .meter.bad .bar i { background:var(--red); }
      .kpis, .cards, .module-grid { display:grid; gap:12px; grid-template-columns:repeat(5,minmax(0,1fr)); margin:16px 0 28px; }
      .kpi { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:14px; }
      .kpi strong { display:block; font-size:24px; margin-top:6px; }
      .pill { border-radius:999px; display:inline-flex; font-size:12px; font-weight:900; padding:5px 9px; }
      .pill.good { background:rgba(34,197,94,.16); color:#86efac; }
      .pill.warn { background:rgba(251,191,36,.16); color:#fde68a; }
      .pill.bad { background:rgba(251,113,133,.16); color:#fecdd3; }
      .toolbar { margin:18px 0; }
      .toolbar input { min-width:260px; }
      .table-wrap { border:1px solid var(--line); background:var(--panel); border-radius:8px; max-height:620px; overflow:auto; }
      .table-wrap--small { max-height:360px; }
      table { border-collapse:collapse; min-width:1280px; width:100%; }
      th,td { border-bottom:1px solid var(--line); padding:10px; text-align:left; vertical-align:top; white-space:nowrap; }
      th { color:var(--muted); cursor:pointer; font-size:12px; text-transform:uppercase; }
      .cards { grid-template-columns:1fr; }
      .module-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .module { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:14px; }
      .module strong { display:block; font-size:20px; margin:6px 0; }
      details.card { overflow:hidden; padding:0; }
      summary { cursor:pointer; list-style:none; padding:16px; }
      .card-body { border-top:1px solid var(--line); overflow:hidden; padding:16px; }
      .contract-table { border:1px solid var(--line); border-radius:8px; margin:10px 0 18px; max-width:100%; overflow:auto; }
      .contract-table table { font-size:12px; min-width:940px; }
      .contract-table th, .contract-table td { padding:8px; }
      .grid2 { display:grid; gap:12px; grid-template-columns:repeat(2,minmax(0,1fr)); }
      .levels { display:grid; gap:8px; grid-template-columns:repeat(4,minmax(0,1fr)); margin:12px 0; }
      .levels div { border:1px solid var(--line); border-radius:6px; background:rgba(255,255,255,.035); padding:10px; }
      .empty { color:var(--muted); padding:14px; }
      .print-note { color:var(--muted); font-size:12px; }
      @media print { button, .toolbar { display:none; } body { background:#fff; color:#111; } .card, .meter, .kpi, .table-wrap, .hero { break-inside:avoid; } }
      @media (max-width: 900px) { .topbar,.section-title,.toolbar,.hero { align-items:flex-start; flex-direction:column; } .hero,.meters,.kpis,.cards,.grid2,.levels,.module-grid { grid-template-columns:1fr; } table { min-width:1100px; } }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Research Watchlist Only</p>
          <h1>LEAPS Call Opportunity Desk</h1>
          <p>Generated ${esc(new Date(report.asOf).toLocaleString())}. ${esc(report.disclaimer)}</p>
        </div>
        <div><button id="theme">Dark / Light</button> <button onclick="window.print()">Print / Export PDF</button></div>
      </header>

      <section class="hero">
        <div>
          <p class="eyebrow">Desk Read</p>
          <h2>${esc(report.summary.topStatus)}</h2>
          <p>${esc(report.summary.rule)} Do not force opportunities; cheap calls are rejected when the underlying, spread, liquidity, or thesis is weak.</p>
        </div>
        <div class="meters">
          ${meter("Portfolio Health", report.summary.portfolioHealthScore ?? 100, positions.length ? tierClass(report.summary.portfolioHealthScore >= 70 ? "good" : report.summary.portfolioHealthScore >= 50 ? "warn" : "bad") : "warn")}
          ${meter("Clean Candidates", report.summary.cleanCandidates, report.summary.cleanCandidates ? "good" : "bad")}
          ${meter("Event Risk", top10.some((row) => row.eventRisk === "High Event Risk") ? 80 : 25, top10.some((row) => row.eventRisk === "High Event Risk") ? "bad" : "good")}
        </div>
      </section>

      <section class="kpis">
        <article class="kpi"><span>Healthy Holds</span><strong>${portfolio.healthyHolds ?? 0}</strong></article>
        <article class="kpi"><span>DCA Candidates</span><strong>${portfolio.dcaCandidates ?? 0}</strong></article>
        <article class="kpi"><span>No More Adds</span><strong>${portfolio.noMoreAdds ?? 0}</strong></article>
        <article class="kpi"><span>Roll Candidates</span><strong>${portfolio.rollCandidates ?? 0}</strong></article>
        <article class="kpi"><span>Exit Review</span><strong>${portfolio.exitReviewPositions ?? 0}</strong></article>
      </section>

      <section>
        <div class="section-title"><div><p class="eyebrow">Portfolio Monitor</p><h2>Existing LEAPS Health</h2></div></div>
        ${miniTable(positions, [
          { key: "ticker", label: "Ticker" },
          { key: "optionContract", label: "Contract" },
          { key: "currentStockPrice", label: "Stock", formatter: money },
          { key: "currentOptionPrice", label: "Option", formatter: money },
          { key: "costBasis", label: "Cost", formatter: money },
          { key: "unrealizedGainLossPct", label: "P/L %" },
          { key: "daysToExpiration", label: "DTE" },
          { key: "positionHealthScore", label: "Health" },
          { key: "thesisStatus", label: "Thesis", badge: true },
          { key: "technicalStatus", label: "Technical", badge: true },
          { key: "optionStatus", label: "Option", badge: true },
          { key: "actionLabel", label: "Action", badge: true },
          { key: "plainEnglishExplanation", label: "Read" },
        ])}
      </section>

      <section class="module-grid">
        <article class="module"><span>DCA Candidates</span><strong>${dcaRows.length || "None"}</strong><p>${dcaRows.map((row) => `${row.ticker}: ${row.whyDcaAllowedOrRejected}`).join(" ") || "DCA engine is waiting for loaded positions that are down but still thesis-intact."}</p></article>
        <article class="module"><span>No More Adds</span><strong>${noMoreAdds.length || "None"}</strong><p>${noMoreAdds.map((row) => `${row.ticker}: ${row.plainEnglishExplanation}`).join(" ") || "No current no-more-adds warnings."}</p></article>
        <article class="module"><span>Exit / Reduce Review</span><strong>${exitRows.length || "None"}</strong><p>${exitRows.map((row) => `${row.ticker}: ${row.exitDamageReview?.mainReason}`).join(" ") || "No exit-review positions from loaded data."}</p></article>
        <article class="module"><span>Roll Candidates</span><strong>${rollRows.length || "None"}</strong><p>${rollRows.map((row) => `${row.ticker}: ${row.timeToExpiryBucket}`).join(" ") || "No roll candidates from loaded data."}</p></article>
        <article class="module"><span>Theta / Time Risk</span><strong>${esc(report.riskSummary?.biggestTimeDecayRisk)}</strong></article>
        <article class="module"><span>IV Risk</span><strong>${esc(report.riskSummary?.biggestIvRisk)}</strong></article>
        <article class="module"><span>Earnings Risk</span><strong>${esc(report.riskSummary?.biggestEarningsRisk)}</strong></article>
        <article class="module"><span>Technical Risk</span><strong>${esc(report.riskSummary?.biggestTechnicalBreakdownRisk)}</strong></article>
        <article class="module"><span>Concentration Risk</span><strong>${esc(report.riskSummary?.biggestConcentrationRisk)}</strong></article>
      </section>

      <section>
        <div class="section-title">
          <div><p class="eyebrow">Top 10</p><h2>LEAPS Call Candidates</h2></div>
          <p class="print-note">Click column headers to sort.</p>
        </div>
        <div class="toolbar">
          <input id="search" placeholder="Search ticker, sector, status..." />
          <select id="status-filter">
            <option value="">All statuses</option>
            <option>Ready for Starter</option>
            <option>Watch for Pullback</option>
            <option>Avoid</option>
          </select>
        </div>
        <div class="table-wrap">
          <table id="candidate-table">
            <thead><tr>
              <th data-key="symbol">Ticker</th><th data-key="name">Company</th><th data-key="sector">Sector</th><th data-key="currentPrice">Stock</th><th data-key="underlyingScore">Underlying</th><th data-key="leapsOpportunityScore">LEAPS</th><th data-key="riskScore">Risk</th><th data-key="preferredExpiryRange">Expiry</th><th data-key="preferredStrikeZone">Strike Zone</th><th data-key="preferredDelta">Delta</th><th data-key="bestContractCandidate">Best Contract</th><th data-key="optionLiquidityStatus">Liquidity</th><th data-key="dcaSuitability">DCA</th><th data-key="status">Status</th><th data-key="bullCase">Bull Case</th><th data-key="bearCase">Bear Case</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <section>
        <div class="section-title"><div><p class="eyebrow">Top 5</p><h2>LEAPS Trade Research Cards</h2></div></div>
        <div class="cards">
          ${top5.map((row, index) => `
            <details class="card" ${index === 0 ? "open" : ""}>
              <summary>
                <div class="section-title">
                  <div><h3>${esc(row.symbol)} - ${esc(row.name)}</h3><p>${esc(row.bestContractCandidate)}</p></div>
                  <span class="pill ${tierClass(row.status)}">${esc(row.status)}</span>
                </div>
                <div class="meters">
                  ${meter("Underlying", row.underlyingScore, row.underlyingScore >= 70 ? "good" : "bad")}
                  ${meter("LEAPS", row.leapsOpportunityScore, tierClass(row.decision))}
                  ${meter("Risk", row.riskScore, row.riskScore >= 70 ? "bad" : row.riskScore >= 50 ? "warn" : "good")}
                </div>
              </summary>
              <div class="card-body">
                <p><strong>Why this opportunity exists:</strong> ${esc(row.whyOpportunityExists)}</p>
                <p><strong>Long-term thesis:</strong> ${esc(row.longTermThesis)}</p>
                <p><strong>Catalysts:</strong> ${esc(row.catalysts)}</p>
                <p><strong>Technical setup:</strong> ${esc(row.technicalSetup)}</p>
                <div class="levels">
                  <div><span>Starter zone</span><strong>${esc(row.dcaPlan?.starterPositionZone)}</strong></div>
                  <div><span>Add zone 1</span><strong>${esc(row.dcaPlan?.addZone1)}</strong></div>
                  <div><span>Add zone 2</span><strong>${esc(row.dcaPlan?.addZone2)}</strong></div>
                  <div><span>Invalidation</span><strong>${money(row.invalidationLevel)}</strong></div>
                </div>
                <div class="grid2">
                  <div class="context"><span>Bull case</span><p>${esc(row.bullCase)}</p></div>
                  <div class="context"><span>Bear case</span><p>${esc(row.bearCase)}</p></div>
                </div>
                <p><strong>Final research verdict:</strong> ${esc(row.finalResearchVerdict)}</p>
                <h3>Best 3 Contract Lanes</h3>
                ${contractTable([row.best3Contracts?.conservative, row.best3Contracts?.balanced, row.best3Contracts?.aggressive].filter(Boolean))}
                <h3>Option Contract Comparison Table</h3>
                ${contractTable(row.optionContracts)}
              </div>
            </details>
          `).join("") || `<p class="empty">No high-quality LEAPS candidates today.</p>`}
        </div>
      </section>

      <section>
        <div class="section-title"><div><p class="eyebrow">Replacement Review</p><h2>Portfolio Replacement Review</h2></div></div>
        ${miniTable(replacementRows, [
          { key: "ticker", label: "Current" },
          { key: "existingPositionRank", label: "Current Rank" },
          { key: "replacementTicker", label: "Candidate" },
          { key: "newCandidateRank", label: "Candidate Rank" },
          { key: "decision", label: "Decision", badge: true },
          { key: "reason", label: "Reason" },
          { key: "whatKeepsCurrentPosition", label: "Keep If" },
        ])}
      </section>

      <section class="module-grid">
        <div class="section-title" style="grid-column:1/-1"><div><p class="eyebrow">Daily Output</p><h2>Final Action Summary</h2></div></div>
        <article class="module"><span>Existing Positions Summary</span><strong>${positions.length ? `${positions.length} loaded` : "No positions loaded"}</strong><p>${esc(final.finalPlainEnglishSummary)}</p></article>
        <article class="module"><span>Top 3 Strongest</span><strong>${esc(final.newOpportunitiesSummary?.top3Strongest?.join(", ") || "None")}</strong></article>
        <article class="module"><span>Watch for Pullback</span><strong>${esc(final.actionWatchlist?.watchForPullback?.join(", ") || "None")}</strong></article>
        <article class="module"><span>Wait for Earnings</span><strong>${esc(final.actionWatchlist?.waitForEarnings?.join(", ") || "None")}</strong></article>
        <article class="module"><span>Consider Rolling</span><strong>${esc(final.actionWatchlist?.considerRolling?.join(", ") || "None")}</strong></article>
        <article class="module"><span>Do Not Add</span><strong>${esc(final.actionWatchlist?.doNotAdd?.join(", ") || "None")}</strong></article>
      </section>
    </main>
    <script>
      const rows = ${top10Json};
      let sortKey = "leapsOpportunityScore";
      let sortDir = -1;
      const tbody = document.querySelector("#candidate-table tbody");
      function cls(value) {
        const text = String(value || "").toLowerCase();
        if (text.includes("ready") || text.includes("good") || text.includes("a+")) return "good";
        if (text.includes("avoid") || text.includes("rejected")) return "bad";
        return "warn";
      }
      function cell(value, badge = false) {
        return badge ? '<span class="pill ' + cls(value) + '">' + String(value ?? "n/a") + '</span>' : String(value ?? "n/a");
      }
      function render() {
        const q = document.getElementById("search").value.toLowerCase();
        const status = document.getElementById("status-filter").value;
        const filtered = rows.filter((row) => {
          const haystack = Object.values(row).join(" ").toLowerCase();
          return (!q || haystack.includes(q)) && (!status || row.status === status);
        }).sort((a,b) => {
          const av = a[sortKey], bv = b[sortKey];
          if (Number.isFinite(Number(av)) && Number.isFinite(Number(bv))) return (Number(av) - Number(bv)) * sortDir;
          return String(av ?? "").localeCompare(String(bv ?? "")) * sortDir;
        });
        tbody.innerHTML = filtered.map((row) => '<tr>' +
          '<td>' + cell(row.symbol) + '</td>' +
          '<td>' + cell(row.name) + '</td>' +
          '<td>' + cell(row.sector) + '</td>' +
          '<td>' + cell(row.currentPrice) + '</td>' +
          '<td>' + cell(row.underlyingScore) + '</td>' +
          '<td>' + cell(row.leapsOpportunityScore) + '</td>' +
          '<td>' + cell(row.riskScore) + '</td>' +
          '<td>' + cell(row.preferredExpiryRange) + '</td>' +
          '<td>' + cell(row.preferredStrikeZone) + '</td>' +
          '<td>' + cell(row.preferredDelta) + '</td>' +
          '<td>' + cell(row.bestContractCandidate) + '</td>' +
          '<td>' + cell(row.optionLiquidityStatus, true) + '</td>' +
          '<td>' + cell(row.dcaSuitability, true) + '</td>' +
          '<td>' + cell(row.status, true) + '</td>' +
          '<td>' + cell(row.bullCase) + '</td>' +
          '<td>' + cell(row.bearCase) + '</td>' +
        '</tr>').join("");
      }
      document.getElementById("search").addEventListener("input", render);
      document.getElementById("status-filter").addEventListener("change", render);
      document.querySelectorAll("th[data-key]").forEach((th) => th.addEventListener("click", () => {
        const key = th.dataset.key;
        sortDir = sortKey === key ? sortDir * -1 : -1;
        sortKey = key;
        render();
      }));
      document.getElementById("theme").addEventListener("click", () => document.body.classList.toggle("light"));
      render();
      setInterval(() => window.location.reload(), 5 * 60 * 1000);
    </script>
  </body>
</html>`;
}

async function main() {
  const universePath = getArg("universe", "data/universe_leaps_budget.csv");
  const positionsPath = getArg("positions", "data/leaps_positions.csv");
  const reportDir = getArg("report-dir", "reports");
  const symbols = loadUniverse(universePath);
  const positions = fs.existsSync(positionsPath) ? loadUniverseRecords(positionsPath).filter((row) => row.symbol) : [];
  console.log(`Scanning ${symbols.length} symbols for LEAPS call candidates...`);
  console.log(`Monitoring ${positions.length} existing LEAPS positions...`);
  const report = await scanLeapsDesk(symbols, positions);
  const results = report.rows;
  const alerts = report.top10;
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_leaps_scan.csv"), toCsv(results), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_leaps_positions.csv"), positionCsv(report.portfolio.positions), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_leaps_alerts.json"), JSON.stringify(alerts, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_leaps_report.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "leaps_call_opportunity_desk.html"), renderHtml(report), "utf8");

  console.table(alerts.map(({ symbol, decision, status, leapsOpportunityScore, underlyingScore, riskScore, currentPrice, strike, expiration, mid, breakevenMovePct, spreadPct }) => ({
    symbol,
    decision,
    status,
    leapsOpportunityScore,
    underlyingScore,
    riskScore,
    currentPrice,
    strike,
    expiration,
    mid,
    breakevenMovePct,
    spreadPct,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_leaps_scan.csv")}`);
  console.log(`Wrote ${path.join(reportDir, "leaps_call_opportunity_desk.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
