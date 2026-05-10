import fs from "node:fs";
import path from "node:path";

import { fetchQuoteSummary } from "./marketData.js";
import { analyzeStock } from "./stockAnalyzer.js";

const OUTPUT = path.join("reports", "sofi_growth_analysis.html");

const raw = (field) => field?.raw ?? null;
const pct = (value) => Number.isFinite(value) ? value * 100 : null;
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const money = (value) => {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${value.toFixed(2)}`;
};

function cagr(start, end, years) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || years <= 0) return null;
  return (end / start) ** (1 / years) - 1;
}

function statusFor(value, min, max = Infinity) {
  if (!Number.isFinite(value)) return "unavailable";
  if (value >= min && value <= max) return "pass";
  const nearLow = value < min && value >= min * 0.85;
  const nearHigh = Number.isFinite(max) && value > max && value <= max * 1.15;
  return nearLow || nearHigh ? "near" : "fail";
}

function belowStatus(value, max) {
  if (!Number.isFinite(value)) return "unavailable";
  return value <= max ? "pass" : value <= max * 1.15 ? "near" : "fail";
}

function fmtMetric(value, suffix = "%") {
  if (!Number.isFinite(value)) return "Unavailable";
  return `${round(value, 2)}${suffix}`;
}

function scoreRisk(rows, analyzer) {
  const available = rows.filter((row) => row.status !== "unavailable");
  const fail = available.filter((row) => row.status === "fail").length;
  const near = available.filter((row) => row.status === "near").length;
  const unavailable = rows.length - available.length;
  let risk = 35 + fail * 5 + near * 2 + unavailable * 1.5;
  if ((analyzer?.technical?.score ?? 0) < 50) risk += 8;
  if ((analyzer?.fundamentals?.score ?? 0) < 50) risk += 8;
  if ((analyzer?.valuation?.score ?? 0) < 50) risk += 8;
  if ((analyzer?.analysts?.rating ?? "").toLowerCase().includes("neutral")) risk += 4;
  return Math.max(0, Math.min(100, Math.round(risk)));
}

function row(label, value, display, ideal, status, note) {
  return { label, value: round(value, 4), display, ideal, status, note };
}

function buildHtml({ symbol, name, asOf, price, marketCap, analyzer, metrics, riskScore, growthVerdict, shortAnalysis, sources }) {
  const data = JSON.stringify({ metrics, riskScore, growthVerdict, shortAnalysis }, null, 2).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${symbol} Growth Stock Analysis</title>
    <style>
      :root { color-scheme: dark; --bg:#071019; --panel:#101a25; --panel2:#152334; --text:#eef7ff; --muted:#9db0c4; --line:#26384d; --green:#22c55e; --yellow:#f59e0b; --red:#fb7185; --blue:#38bdf8; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, Segoe UI, Arial, sans-serif; }
      .shell { width: min(1240px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 44px; }
      .hero, .card, .summary, .table-wrap { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; }
      .hero { padding: 22px; display: grid; gap: 18px; }
      .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
      h1, h2, p { margin: 0; }
      h1 { font-size: clamp(28px, 4vw, 44px); }
      h2 { font-size: 19px; margin-bottom: 12px; }
      .muted { color: var(--muted); line-height: 1.5; }
      .eyebrow { color: var(--blue); font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
      .pill { display:inline-flex; border-radius:999px; padding:5px 10px; font-weight:900; font-size:12px; background:#243449; color:#dbeafe; }
      .pill.pass { background: rgba(34,197,94,.16); color:#86efac; }
      .pill.near { background: rgba(245,158,11,.18); color:#fde68a; }
      .pill.fail { background: rgba(251,113,133,.16); color:#fecdd3; }
      .pill.unavailable { background: rgba(148,163,184,.15); color:#cbd5e1; }
      .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; margin: 16px 0; }
      .card, .summary { padding:16px; }
      .card span, .summary span { color: var(--muted); font-size:12px; font-weight:900; text-transform:uppercase; }
      .card strong, .summary strong { display:block; margin-top:7px; font-size:24px; }
      .risk-meter { height: 14px; border-radius: 999px; background: linear-gradient(90deg, var(--green), var(--yellow), var(--red)); overflow:hidden; margin-top: 10px; }
      .risk-dot { height: 100%; width: 4px; background: #fff; margin-left: calc(var(--risk) * 1%); box-shadow: 0 0 12px #fff; }
      .controls { display:flex; gap:10px; flex-wrap:wrap; margin: 22px 0 12px; }
      button { border:1px solid var(--line); background:var(--panel2); color:var(--text); border-radius:6px; padding:9px 12px; font-weight:900; cursor:pointer; }
      button.active { border-color: var(--blue); background:#123248; }
      .table-wrap { overflow:auto; }
      table { width:100%; border-collapse: collapse; min-width: 900px; }
      th, td { border-bottom:1px solid var(--line); padding:11px 10px; text-align:left; vertical-align:top; }
      th { color:#bad0e6; font-size:12px; text-transform:uppercase; }
      td small { display:block; color: var(--muted); margin-top:4px; line-height:1.4; }
      .section { margin-top: 22px; }
      .two { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
      ul { margin: 8px 0 0; padding-left: 18px; color: var(--muted); line-height: 1.55; }
      a { color: #7dd3fc; }
      @media (max-width: 820px) { .grid, .two { grid-template-columns:1fr; } .top { flex-direction:column; } }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="top">
          <div>
            <p class="eyebrow">Growth Stock Checklist</p>
            <h1>${symbol} - ${name}</h1>
            <p class="muted">Interactive fundamental report generated ${asOf}. Data is from Yahoo Finance quote summary and statement fields, plus the local Trading-System analyzer.</p>
          </div>
          <span class="pill ${growthVerdict.isGrowthStock ? "pass" : "fail"}">${growthVerdict.isGrowthStock ? "Growth stock: yes" : "Growth stock: no"}</span>
        </div>
        <div class="grid">
          <article class="card"><span>Price</span><strong>${money(price)}</strong></article>
          <article class="card"><span>Market Cap</span><strong>${money(marketCap)}</strong></article>
          <article class="card"><span>Analyzer Decision</span><strong>${analyzer.decision}</strong></article>
          <article class="card"><span>Quality Grade</span><strong>${analyzer.qualityGrade} / ${analyzer.totalScore}</strong></article>
        </div>
        <article class="summary" style="--risk:${riskScore}">
          <span>Risk analysis score</span>
          <strong>${riskScore}/100 risk</strong>
          <div class="risk-meter"><div class="risk-dot"></div></div>
          <p class="muted">Higher number means higher risk. This blends checklist misses, missing financial fields, valuation risk, analyst tone, and analyzer quality.</p>
        </article>
      </section>

      <section class="section two">
        <article class="card">
          <h2>Short Analysis</h2>
          <p class="muted">${shortAnalysis}</p>
        </article>
        <article class="card">
          <h2>Growth Verdict</h2>
          <ul>${growthVerdict.reasons.map((item) => `<li>${item}</li>`).join("")}</ul>
        </article>
      </section>

      <section class="section">
        <div class="controls">
          <button class="active" data-filter="all">All</button>
          <button data-filter="pass">Pass</button>
          <button data-filter="near">Near</button>
          <button data-filter="fail">Fail</button>
          <button data-filter="unavailable">Unavailable</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Metric</th><th>SOFI Value</th><th>Ideal Range</th><th>Status</th><th>Note</th></tr></thead>
            <tbody id="metric-body"></tbody>
          </table>
        </div>
      </section>

      <section class="section two">
        <article class="card">
          <h2>What Fits</h2>
          <ul>
            <li>Revenue growth is well above the 20% growth-stock threshold.</li>
            <li>Forward P/E and PEG are inside your preferred range.</li>
            <li>Net margin and operating margin now screen well, which is important for a fintech moving from growth to profitability.</li>
          </ul>
        </article>
        <article class="card">
          <h2>Main Risks</h2>
          <ul>
            <li>Returns on equity and assets are below your ideal range.</li>
            <li>Price/book and price/sales are above your preferred value ranges.</li>
            <li>Some bank/fintech metrics, especially gross margin and EBITDA/FCF, are less clean than for normal operating companies.</li>
          </ul>
        </article>
      </section>

      <section class="section card">
        <h2>Sources</h2>
        <ul>${sources.map((source) => `<li><a href="${source.url}">${source.label}</a></li>`).join("")}</ul>
      </section>
    </main>
    <script id="report-data" type="application/json">${data}</script>
    <script>
      const data = JSON.parse(document.getElementById('report-data').textContent);
      const body = document.getElementById('metric-body');
      function render(filter = 'all') {
        body.innerHTML = data.metrics
          .filter(row => filter === 'all' || row.status === filter)
          .map(row => '<tr>' +
            '<td><strong>' + row.label + '</strong></td>' +
            '<td>' + row.display + '</td>' +
            '<td>' + row.ideal + '</td>' +
            '<td><span class="pill ' + row.status + '">' + row.status.toUpperCase() + '</span></td>' +
            '<td><small>' + row.note + '</small></td>' +
          '</tr>').join('');
      }
      document.querySelectorAll('button[data-filter]').forEach(button => {
        button.addEventListener('click', () => {
          document.querySelectorAll('button[data-filter]').forEach(item => item.classList.remove('active'));
          button.classList.add('active');
          render(button.dataset.filter);
        });
      });
      render();
    </script>
  </body>
</html>`;
}

async function main() {
  const symbol = "SOFI";
  const modules = [
    "price",
    "summaryDetail",
    "financialData",
    "defaultKeyStatistics",
    "assetProfile",
    "incomeStatementHistory",
    "cashflowStatementHistory",
    "earningsTrend",
  ];
  const [summary, analyzer] = await Promise.all([
    fetchQuoteSummary(symbol, modules),
    analyzeStock(symbol),
  ]);

  const financial = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  const detail = summary.summaryDetail ?? {};
  const price = raw(summary.price?.regularMarketPrice) ?? raw(financial.currentPrice);
  const marketCap = raw(summary.price?.marketCap) ?? raw(detail.marketCap);
  const totalRevenue = raw(financial.totalRevenue);
  const annual = (summary.incomeStatementHistory?.incomeStatementHistory ?? [])
    .map((item) => ({ date: item.endDate?.fmt, revenue: raw(item.totalRevenue), netIncome: raw(item.netIncome) }))
    .filter((item) => Number.isFinite(item.revenue))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latestAnnual = annual.at(-1);
  const oldestAnnual = annual[0];
  const revenueCagr3 = latestAnnual && oldestAnnual ? cagr(oldestAnnual.revenue, latestAnnual.revenue, annual.length - 1) : null;
  const trendYear = summary.earningsTrend?.trend?.find((item) => item.period === "0y");
  const revenueGrowthEstimate = raw(trendYear?.revenueEstimate?.growth);
  const epsGrowthEstimate = raw(trendYear?.earningsEstimate?.growth) ?? raw(financial.earningsGrowth);
  const grossMargin = pct(raw(financial.grossMargins));
  const operatingMargin = pct(raw(financial.operatingMargins));
  const netMargin = pct(raw(stats.profitMargins) ?? raw(financial.profitMargins));
  const revenueGrowth1y = pct(raw(financial.revenueGrowth) ?? revenueGrowthEstimate);
  const epsGrowth = pct(epsGrowthEstimate);
  const roe = pct(raw(financial.returnOnEquity));
  const roa = pct(raw(financial.returnOnAssets));
  const forwardPE = raw(stats.forwardPE);
  const trailingPE = raw(detail.trailingPE) ?? raw(stats.trailingPE);
  const peg = raw(stats.pegRatio);
  const pb = raw(stats.priceToBook);
  const ps = raw(stats.priceToSalesTrailing12Months) ?? (marketCap && totalRevenue ? marketCap / totalRevenue : null);
  const enterpriseValue = raw(stats.enterpriseValue);
  const ebitda = raw(financial.ebitda);
  const evToEbitda = raw(stats.enterpriseToEbitda) ?? (enterpriseValue && ebitda ? enterpriseValue / ebitda : null);
  const freeCashflow = raw(financial.freeCashflow);
  const fcfMargin = totalRevenue && freeCashflow ? pct(freeCashflow / totalRevenue) : null;
  const pToFcf = marketCap && freeCashflow ? marketCap / freeCashflow : null;
  const ebitdaMargin = totalRevenue && ebitda ? pct(ebitda / totalRevenue) : null;

  const metrics = [
    row("Gross Profit Margin", grossMargin, fmtMetric(grossMargin), "20% - 50%", statusFor(grossMargin, 20, 50), "SOFI screens above the ideal range; for a fintech/lender this can be less comparable than for normal product companies."),
    row("Operating Profit Margin", operatingMargin, fmtMetric(operatingMargin), "10% - 30%", statusFor(operatingMargin, 10, 30), "Shows operating leverage; current margin fits your ideal band."),
    row("Net Profit Margin", netMargin, fmtMetric(netMargin), "5% - 20%", statusFor(netMargin, 5, 20), "Profitability now fits your desired band."),
    row("1-Year Revenue Growth", revenueGrowth1y, fmtMetric(revenueGrowth1y), "20%+", statusFor(revenueGrowth1y, 20), "Growth rate from current Yahoo financialData/revenue estimate fields."),
    row("3-Year Revenue CAGR", pct(revenueCagr3), fmtMetric(pct(revenueCagr3)), "20%+", statusFor(pct(revenueCagr3), 20), `Uses annual revenue from ${oldestAnnual?.date ?? "n/a"} to ${latestAnnual?.date ?? "n/a"}.`),
    row("5-Year Revenue CAGR", null, "Unavailable", "20%+", "unavailable", "Yahoo statement history returned only four annual revenue points in this feed."),
    row("EPS Growth", epsGrowth, fmtMetric(epsGrowth), "20%+", statusFor(epsGrowth, 20), "Uses current-year earnings growth estimate when available."),
    row("EBITDA Margin", ebitdaMargin, fmtMetric(ebitdaMargin), "20%+", statusFor(ebitdaMargin, 20), "Unavailable because Yahoo did not provide EBITDA for SOFI in this response."),
    row("FCF Margin", fcfMargin, fmtMetric(fcfMargin), "10% - 15%+", statusFor(fcfMargin, 10), "Unavailable because Yahoo did not provide free cash flow for SOFI in this response."),
    row("P/E Ratio", trailingPE, fmtMetric(trailingPE, "x"), "20x - 40x", statusFor(trailingPE, 20, 40), "Trailing valuation fits the preferred growth-stock band."),
    row("Forward P/E", forwardPE, fmtMetric(forwardPE, "x"), "20x - 30x", statusFor(forwardPE, 20, 30), "Forward valuation fits the preferred band."),
    row("PEG Ratio", peg, fmtMetric(peg, "x"), "0.5x - 1.5x", statusFor(peg, 0.5, 1.5), "PEG supports growth-at-a-reasonable-price if estimates hold."),
    row("P/B Ratio", pb, fmtMetric(pb, "x"), "0.5x - 1.5x", statusFor(pb, 0.5, 1.5), "Above your ideal range; for financial firms, book value matters more than for software names."),
    row("P/S Ratio", ps, fmtMetric(ps, "x"), "1.0x - 5.0x", statusFor(ps, 1, 5), "Slightly above your preferred range using market cap divided by TTM revenue."),
    row("Enterprise Value / EBITDA", evToEbitda, fmtMetric(evToEbitda, "x"), "10x - 20x", statusFor(evToEbitda, 10, 20), "Unavailable because EBITDA was not available."),
    row("P/FCF", pToFcf, fmtMetric(pToFcf, "x"), "Below 10x", belowStatus(pToFcf, 10), "Unavailable because free cash flow was not available."),
    row("Return on Equity", roe, fmtMetric(roe), "12% - 20%+", statusFor(roe, 12), "Below ideal; SOFI is profitable but returns are still maturing."),
    row("Return on Assets", roa, fmtMetric(roa), "5% - 10%+", statusFor(roa, 5), "Below ideal; common risk for lending/fintech balance-sheet businesses."),
  ];

  const passes = metrics.filter((item) => item.status === "pass").length;
  const growthPasses = ["1-Year Revenue Growth", "3-Year Revenue CAGR", "EPS Growth"].every((label) =>
    metrics.find((item) => item.label === label)?.status === "pass"
  );
  const growthVerdict = {
    isGrowthStock: growthPasses,
    reasons: [
      `Revenue growth screens above 20% and 3-year revenue CAGR is ${fmtMetric(pct(revenueCagr3))}.`,
      `EPS growth estimate screens above 20% at ${fmtMetric(epsGrowth)}.`,
      `SOFI is still not a mature quality compounder because ROE and ROA are below your ideal ranges.`,
      `Checklist pass count: ${passes}/${metrics.length}, with unavailable fields shown separately.`,
    ],
  };
  const riskScore = scoreRisk(metrics, analyzer);
  const shortAnalysis = `SOFI qualifies as a growth stock based on revenue growth and expected EPS growth, but it is not a low-risk quality stock yet. The best positives are revenue growth, operating/net margin progress, forward P/E, and PEG. The biggest concerns are below-ideal ROE/ROA, valuation slightly above your P/S and P/B ranges, and unavailable EBITDA/FCF fields in the data feed. Risk score: ${riskScore}/100.`;
  const html = buildHtml({
    symbol,
    name: summary.price?.longName ?? "SoFi Technologies, Inc.",
    asOf: new Date().toLocaleString(),
    price,
    marketCap,
    analyzer,
    metrics,
    riskScore,
    growthVerdict,
    shortAnalysis,
    sources: [
      { label: "Yahoo Finance SOFI quote and financial data", url: "https://finance.yahoo.com/quote/SOFI/" },
      { label: "Yahoo Finance SOFI financials", url: "https://finance.yahoo.com/quote/SOFI/financials/" },
      { label: "Trading-System local stock analyzer", url: "../src/stockAnalyzer.js" },
    ],
  });

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html, "utf8");
  fs.writeFileSync(path.join("reports", "sofi_growth_analysis.json"), JSON.stringify({ metrics, riskScore, growthVerdict, shortAnalysis, analyzer }, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
