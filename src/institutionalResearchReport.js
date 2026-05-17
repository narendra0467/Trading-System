import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { fetchHistory, fetchQuoteSummary } from "./marketData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const reportsDir = path.join(rootDir, "reports");
const publicReportsDir = path.join(rootDir, "public", "reports");

const ticker = (process.argv[2] || "AMZN").toUpperCase();
const reportSymbol = ticker === "AMZN" ? ticker : "AMZN";

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function raw(field) {
  return field?.raw ?? null;
}

function money(value, suffix = "") {
  if (!Number.isFinite(value)) return "Unavailable";
  if (Math.abs(value) >= 1_000_000_000_000) return `$${round(value / 1_000_000_000_000, 2)}T${suffix}`;
  if (Math.abs(value) >= 1_000_000_000) return `$${round(value / 1_000_000_000, 1)}B${suffix}`;
  if (Math.abs(value) >= 1_000_000) return `$${round(value / 1_000_000, 1)}M${suffix}`;
  return `$${round(value, 2)}${suffix}`;
}

function pct(value) {
  return Number.isFinite(value) ? `${round(value, 1)}%` : "Unavailable";
}

function sma(values, period) {
  if (!values.length || values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  values.forEach((value, index) => {
    out.push(index === 0 ? value : value * k + out[index - 1] * (1 - k));
  });
  return out;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function macd(values) {
  if (values.length < 35) return null;
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) => fast[i] - slow[i]).slice(25);
  const signal = ema(line, 9);
  return {
    line: line.at(-1),
    signal: signal.at(-1),
    histogram: line.at(-1) - signal.at(-1),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toFileUrl(filePath) {
  return `file:///${filePath.replaceAll("\\", "/").replaceAll(" ", "%20")}`;
}

function findBrowsers() {
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((candidate) => fs.existsSync(candidate));
}

function printPdf(htmlPath, pdfPath) {
  const browsers = findBrowsers();
  if (!browsers.length) {
    return {
      ok: false,
      message: "Chrome or Edge was not found. HTML was generated; open it and print to PDF manually.",
    };
  }

  const errors = [];
  for (const browser of browsers) {
    const userDataDir = path.join(reportsDir, ".pdf-browser-profile");
    const result = spawnSync(browser, [
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--user-data-dir=${userDataDir}`,
      `--print-to-pdf=${pdfPath}`,
      toFileUrl(htmlPath),
    ], {
      cwd: rootDir,
      encoding: "utf8",
    });

    if (result.status === 0 && fs.existsSync(pdfPath)) {
      return { ok: true, message: pdfPath };
    }

    errors.push(`${path.basename(browser)}: ${result.stderr || result.stdout || `status ${result.status}`}`);
  }

  return { ok: false, message: errors.join(" | ") };
}

function sparkline(rows) {
  const closes = rows.map((row) => row.close).filter(Number.isFinite).slice(-180);
  if (closes.length < 2) return "";
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const points = closes.map((value, index) => {
    const x = (index / (closes.length - 1)) * 760;
    const y = 170 - ((value - min) / Math.max(max - min, 1)) * 150;
    return `${round(x, 1)},${round(y, 1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 780 190" class="chart"><polyline fill="none" stroke="#2dd4bf" stroke-width="4" points="${points}"/><line x1="0" x2="780" y1="170" y2="170" stroke="#334155"/><text x="8" y="24">${money(max)}</text><text x="8" y="164">${money(min)}</text></svg>`;
}

function metricRows(metrics) {
  return metrics.map(([label, value, note]) => `<tr><td>${label}</td><td>${value}</td><td>${note}</td></tr>`).join("");
}

function peerRows(peers) {
  return peers.map((peer) => `<tr><td>${peer.group}</td><td>${peer.ticker}</td><td>${peer.name}</td><td>${peer.reason}</td><td>${peer.use}</td></tr>`).join("");
}

async function getMarketData(symbol) {
  const result = {
    price: null,
    marketCap: null,
    forwardPE: null,
    trailingPE: null,
    evEbitda: null,
    ps: null,
    history: [],
    unavailable: [],
  };
  try {
    const summary = await fetchQuoteSummary(symbol, ["price", "summaryDetail", "defaultKeyStatistics", "financialData"]);
    result.price = raw(summary.price?.regularMarketPrice);
    result.marketCap = raw(summary.price?.marketCap);
    result.forwardPE = raw(summary.summaryDetail?.forwardPE) ?? raw(summary.defaultKeyStatistics?.forwardPE);
    result.trailingPE = raw(summary.summaryDetail?.trailingPE) ?? raw(summary.defaultKeyStatistics?.trailingPE);
    result.evEbitda = raw(summary.defaultKeyStatistics?.enterpriseToEbitda);
    result.ps = raw(summary.summaryDetail?.priceToSalesTrailing12Months);
  } catch (error) {
    result.unavailable.push(`Yahoo quote summary unavailable: ${error.message}`);
  }
  try {
    result.history = await fetchHistory(symbol, "2y", "1d");
  } catch (error) {
    result.unavailable.push(`Yahoo chart history unavailable: ${error.message}`);
  }
  return result;
}

function buildTechnical(history, price) {
  const closes = history.map((row) => row.close).filter(Number.isFinite);
  const current = price ?? closes.at(-1) ?? null;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma100 = sma(closes, 100);
  const ma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const macdNow = macd(closes);
  const recent = closes.slice(-90);
  const support = recent.length ? Math.min(...recent.slice(-45)) : null;
  const resistance = recent.length ? Math.max(...recent.slice(-45)) : null;
  return {
    current,
    ma20,
    ma50,
    ma100,
    ma200,
    rsi14,
    macdNow,
    support,
    resistance,
    breakout: Number.isFinite(resistance) ? resistance * 1.02 : null,
    breakdown: Number.isFinite(support) ? support * 0.97 : null,
  };
}

function buildHtml({ market, technical }) {
  const generatedAt = new Date().toLocaleString("en-US", { timeZone: "America/Edmonton" });
  const price = technical.current;
  const baseFair = Number.isFinite(price) ? [price * 0.95, price * 1.18] : [null, null];
  const bullTarget = Number.isFinite(price) ? price * 1.3 : null;
  const bearTarget = Number.isFinite(price) ? price * 0.78 : null;
  const entry = Number.isFinite(price) ? price * 0.97 : null;
  const pullback = Number.isFinite(technical.ma50) ? technical.ma50 : (Number.isFinite(price) ? price * 0.9 : null);
  const stop = Number.isFinite(technical.ma200) ? technical.ma200 * 0.94 : (Number.isFinite(price) ? price * 0.82 : null);

  const peers = [
    { group: "Direct operating", ticker: "WMT", name: "Walmart", reason: "Scaled retail, marketplace, grocery, fulfillment.", use: "Retail execution and margin benchmark" },
    { group: "Direct operating", ticker: "BABA", name: "Alibaba", reason: "Marketplace + cloud + ads mix, non-U.S. regulatory contrast.", use: "Marketplace monetization benchmark" },
    { group: "Direct operating", ticker: "MSFT", name: "Microsoft Azure", reason: "Hyperscale cloud and AI infrastructure competitor.", use: "AWS cloud growth/margin comp" },
    { group: "Public valuation", ticker: "GOOGL", name: "Alphabet", reason: "Digital advertising, cloud, high-margin platform economics.", use: "Ad/cloud valuation comp" },
    { group: "Public valuation", ticker: "META", name: "Meta Platforms", reason: "Advertising scale, AI capex debate, margin comparison.", use: "Ad platform multiple comp" },
    { group: "Public valuation", ticker: "COST", name: "Costco", reason: "Premium retail multiple and membership economics.", use: "Retail quality multiple comp" },
    { group: "Adjacent strategic", ticker: "ORCL", name: "Oracle", reason: "Cloud infrastructure capacity and enterprise workloads.", use: "AI infrastructure demand signal" },
    { group: "Adjacent strategic", ticker: "NFLX", name: "Netflix", reason: "Streaming/ads attention competitor, not a retail peer.", use: "Prime Video strategic context" },
    { group: "Adjacent strategic", ticker: "SHOP", name: "Shopify", reason: "Merchant enablement and commerce software ecosystem.", use: "Marketplace adjacency" },
  ];

  const financialRows = [
    ["FY2025 revenue", "$716.9B", "Amazon 2025 Form 10-K / Q4 release; +13% YoY."],
    ["FY2025 operating income", "$80.0B", "Operating margin roughly 11.2%; scale efficiency continued."],
    ["FY2025 net income", "$77.7B", "Includes non-operating investment impacts; normalize for core earnings."],
    ["2025 segment revenue", "NA $426.3B / Int'l $161.9B / AWS $128.7B", "AWS was ~18% of revenue but majority of operating profit."],
    ["2025 segment operating income", "NA $29.6B / Int'l ~$4.8B / AWS $45.6B", "AWS remains the profit engine."],
    ["Q1 2026 revenue", "$181.5B", "Official Q1 release; +17% YoY."],
    ["Q1 2026 segment revenue", "NA $104.1B / Int'l $39.8B / AWS $37.6B", "AWS +28% YoY, fastest growth in 15 quarters per Amazon."],
    ["Gross margin", "Missing", "Amazon does not present a simple gross margin in the release; use operating margin by segment."],
    ["Free cash flow", "Missing in memo model", "Must be refreshed from cash-flow statement before final IC use."],
    ["Cash / debt", "Cash unavailable in live fetch", "Pull from latest 10-Q/10-K before trading-size decision."],
  ];

  const valuationRows = [
    ["Current market cap", money(market.marketCap), market.marketCap ? "Yahoo Finance quote summary." : "Unavailable; PDF labels missing data."],
    ["Trailing P/E", market.trailingPE ? `${round(market.trailingPE, 1)}x` : "Unavailable", "Use cautiously due investment gains and capex cycle."],
    ["Forward P/E", market.forwardPE ? `${round(market.forwardPE, 1)}x` : "Unavailable", "Better proxy for normalized earnings power."],
    ["EV/EBITDA", market.evEbitda ? `${round(market.evEbitda, 1)}x` : "Unavailable", "Useful but cloud capex intensity matters."],
    ["P/S", market.ps ? `${round(market.ps, 1)}x` : "Unavailable", "Blended retail + AWS + ads multiple has limited precision."],
    ["Bear case", money(bearTarget), "AWS slows, capex absorbs FCF, retail margin stalls."],
    ["Base fair value", `${money(baseFair[0])} - ${money(baseFair[1])}`, "Assumes AWS/ads growth funds AI capex while retail margins grind higher."],
    ["Bull case", money(bullTarget), "AWS AI demand, ads, logistics automation, and international margin expansion compound."],
  ];

  const technicalRows = [
    ["Last price", money(technical.current), "Latest Yahoo chart/quote when available."],
    ["20 / 50 / 100 / 200 DMA", `${money(technical.ma20)} / ${money(technical.ma50)} / ${money(technical.ma100)} / ${money(technical.ma200)}`, "Trend stack."],
    ["RSI", technical.rsi14 ? round(technical.rsi14, 1) : "Unavailable", "Overbought above 70, washed out below 30."],
    ["MACD", technical.macdNow ? `${round(technical.macdNow.line, 2)} vs signal ${round(technical.macdNow.signal, 2)}` : "Unavailable", "Positive histogram supports momentum."],
    ["Support / resistance", `${money(technical.support)} / ${money(technical.resistance)}`, "Recent 45-session range."],
    ["Breakout / breakdown", `${money(technical.breakout)} / ${money(technical.breakdown)}`, "Use with volume confirmation."],
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>AMZN Institutional Research Memo</title>
  <style>
    @page { size: Letter; margin: 0.45in; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #111827; background: #f8fafc; line-height: 1.35; }
    .page { background: white; border: 1px solid #e5e7eb; padding: 26px; margin: 0 auto 18px; box-shadow: 0 12px 30px #dbe3ef; page-break-after: always; }
    .cover { background: linear-gradient(135deg, #0f172a, #172554 58%, #0f766e); color: white; min-height: 860px; display: flex; flex-direction: column; justify-content: space-between; }
    h1 { font-size: 42px; margin: 0; letter-spacing: -0.02em; }
    h2 { font-size: 20px; color: #0f172a; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-top: 0; }
    h3 { font-size: 15px; margin-bottom: 6px; color: #334155; }
    .cover h2 { color: #ccfbf1; border: 0; }
    .kicker { text-transform: uppercase; letter-spacing: 0.18em; color: #5eead4; font-weight: 800; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .two { grid-template-columns: repeat(2, 1fr); }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 13px; background: #f8fafc; }
    .darkCard { border: 1px solid rgba(255,255,255,.22); border-radius: 12px; padding: 16px; background: rgba(255,255,255,.08); }
    .metric { font-size: 28px; font-weight: 800; color: #0f766e; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0 16px; }
    th { text-align: left; background: #0f172a; color: white; padding: 8px; }
    td { border-bottom: 1px solid #e5e7eb; padding: 7px 8px; vertical-align: top; }
    ul { margin-top: 6px; padding-left: 18px; }
    .badge { display: inline-block; padding: 4px 9px; border-radius: 999px; background: #ccfbf1; color: #0f766e; font-weight: 800; font-size: 11px; margin-right: 6px; }
    .warn { background: #fff7ed; color: #9a3412; }
    .risk { background: #fee2e2; color: #991b1b; }
    .chart { width: 100%; height: 190px; background: #0f172a; border-radius: 10px; }
    .small { font-size: 11px; color: #64748b; }
    .sources li { margin-bottom: 5px; }
  </style>
</head>
<body>
  <section class="page cover">
    <div>
      <div class="kicker">Institutional Equity Research Memo</div>
      <h1>Amazon.com, Inc. (AMZN)</h1>
      <h2>Cloud, Advertising, Logistics Scale, and AI Infrastructure Optionality</h2>
    </div>
    <div class="grid">
      <div class="darkCard"><div>Final rating</div><div class="metric" style="color:#5eead4">Buy</div><div>Watch sizing around AI capex and market-data freshness.</div></div>
      <div class="darkCard"><div>Confidence</div><div class="metric" style="color:#5eead4">74 / 100</div><div>High-quality assets; valuation and capex reduce certainty.</div></div>
      <div class="darkCard"><div>Risk</div><div class="metric" style="color:#fecaca">58 / 100</div><div>Execution, capex, antitrust, and multiple risk.</div></div>
    </div>
    <div class="small">Generated ${generatedAt} Edmonton. This is research, not financial advice. Missing fields are explicitly labeled.</div>
  </section>

  <section class="page">
    <h2>A. Executive Summary</h2>
    <div class="grid two">
      <div class="card"><h3>Bull thesis</h3><ul><li>AWS growth reaccelerated to 28% YoY in Q1 2026 on a very large base.</li><li>Advertising exceeded a $70B TTM revenue run-rate per Amazon commentary, adding high-margin monetization to retail traffic.</li><li>Retail fulfillment speed, robotics, regionalization, and international margin improvement can support durable operating leverage.</li></ul></div>
      <div class="card"><h3>Bear thesis</h3><ul><li>AI infrastructure spend can pressure free cash flow and returns if demand or pricing disappoints.</li><li>AWS competes with Microsoft Azure, Google Cloud, Oracle, and specialist AI clouds.</li><li>Regulatory, labor, tariff, and marketplace risks remain structurally high.</li></ul></div>
    </div>
    <p><span class="badge">Base-case view</span> AMZN remains a high-quality compounder with three profit pools: AWS, advertising, and retail/logistics scale. The stock deserves a premium, but new money should prefer staged entries because the AI capex cycle can create valuation volatility.</p>
    <p><span class="badge warn">Rating: Buy</span> The setup is attractive for long-term investors, but not a blind Strong Buy without confirming current valuation and technical entry.</p>

    <h2>B. Business Model</h2>
    <table><tr><th>Area</th><th>Validated read</th></tr>
      <tr><td>What Amazon sells</td><td>Online and physical retail, third-party marketplace services, Prime subscriptions, advertising, AWS cloud infrastructure/platform services, devices, media, and logistics capabilities.</td></tr>
      <tr><td>Customers</td><td>Consumers, third-party sellers, advertisers, developers, enterprises, public sector entities, and media subscribers.</td></tr>
      <tr><td>Revenue streams</td><td>Online stores, physical stores, third-party seller services, subscription services, advertising services, AWS, and other services.</td></tr>
      <tr><td>Distribution</td><td>Owned fulfillment network, regionalized delivery, third-party seller marketplace, AWS global regions, Prime ecosystem, and digital channels.</td></tr>
      <tr><td>Key partners</td><td>Third-party sellers, AWS enterprise customers, Anthropic/OpenAI/Meta/NVIDIA and other AI/cloud relationships cited in recent Amazon releases.</td></tr>
    </table>

    <h2>C. Industry & Competitive Position</h2>
    <table><tr><th>Peer group</th><th>Ticker</th><th>Company</th><th>Why included</th><th>Use</th></tr>${peerRows(peers)}</table>
    <p>Rejected unrelated peers: autos, banks, biotech, and unrelated software names are not operating peers for AMZN. Microsoft/Alphabet/Meta are included only where their cloud or advertising businesses directly overlap.</p>
  </section>

  <section class="page">
    <h2>D. Financial Analysis</h2>
    <table><tr><th>Metric</th><th>Value</th><th>Analyst note</th></tr>${metricRows(financialRows)}</table>
    <div class="grid two">
      <div class="card"><h3>Quality read</h3><p>AWS drives the majority of operating income while retail and international are increasingly profitable. Advertising is a high-margin layer on top of retail intent.</p></div>
      <div class="card"><h3>Working capital / inventory</h3><p>Detailed inventory and working-capital trend analysis should be refreshed directly from the latest 10-Q cash-flow and balance-sheet tables before final IC distribution.</p></div>
    </div>

    <h2>E. Valuation</h2>
    <table><tr><th>Item</th><th>Value</th><th>Interpretation</th></tr>${metricRows(valuationRows)}</table>
    <p>Base valuation method: sum-of-the-parts thinking rather than a single retail multiple. AWS and ads warrant higher software/platform-like multiples; first-party retail/logistics warrants lower commerce multiples. The final fair-value range is deliberately conservative until live market cap and normalized FCF are refreshed.</p>

    <h2>F. Catalysts</h2>
    <div class="grid two">
      <div class="card"><h3>Near-term</h3><ul><li>Q2 2026 guide: 16%-19% sales growth per Amazon IR.</li><li>AWS AI customer wins and Bedrock usage acceleration.</li><li>Advertising growth and retail unit growth.</li><li>Analyst estimate revisions after Q1 2026.</li></ul></div>
      <div class="card"><h3>Long-term</h3><ul><li>Trainium/Graviton/Nitro chip economics.</li><li>International margin expansion.</li><li>Robotics and same-day logistics productivity.</li><li>Project Kuiper/Amazon Leo optionality.</li></ul></div>
    </div>
  </section>

  <section class="page">
    <h2>G. Risks</h2>
    <table><tr><th>Risk</th><th>Why it matters</th></tr>
      <tr><td>Valuation risk</td><td>Premium multiple can compress if AI capex does not convert to durable AWS/ads earnings.</td></tr>
      <tr><td>Execution risk</td><td>Retail, logistics, AWS, ads, devices, media, and satellite initiatives require disciplined capital allocation.</td></tr>
      <tr><td>Competition risk</td><td>Azure/GCP/Oracle in cloud, Walmart/Target/Costco/Alibaba in commerce, Google/Meta/TikTok in ads.</td></tr>
      <tr><td>Margin risk</td><td>AI infrastructure, fulfillment wages, energy, memory supply, tariffs, and shipping costs can pressure margins.</td></tr>
      <tr><td>Regulatory risk</td><td>Marketplace, labor, privacy, antitrust, and international tax scrutiny remain persistent.</td></tr>
      <tr><td>Technical breakdown risk</td><td>Breakdown below ${money(technical.breakdown)} would weaken the setup and force reassessment.</td></tr>
    </table>

    <h2>H. Technical Analysis</h2>
    ${sparkline(market.history)}
    <table><tr><th>Metric</th><th>Value</th><th>Read</th></tr>${metricRows(technicalRows)}</table>
    <p><span class="badge">Entry plan</span> Starter near ${money(entry)}; better pullback near ${money(pullback)}; add-on breakout above ${money(technical.breakout)} on volume; invalidation near ${money(stop)}.</p>
    <p>3-month target: ${money(technical.resistance)} to ${money(technical.breakout)}. 12-month technical target range: ${money(baseFair[0])} to ${money(bullTarget)} if trend and fundamentals confirm.</p>

    <h2>I. Position Sizing Plan</h2>
    <table><tr><th>Tranche</th><th>Allocation</th><th>Trigger</th></tr>
      <tr><td>Starter</td><td>20%-25%</td><td>Near ${money(entry)} if price holds above short-term support.</td></tr>
      <tr><td>Add on pullback</td><td>25%-30%</td><td>Near ${money(pullback)} if fundamentals remain intact.</td></tr>
      <tr><td>Add on breakout</td><td>25%-30%</td><td>Above ${money(technical.breakout)} with volume confirmation.</td></tr>
      <tr><td>Reserve</td><td>20%-30%</td><td>Keep dry powder for market-wide volatility or capex-related drawdowns.</td></tr>
      <tr><td>Max loss / invalidation</td><td>Defined by stop</td><td>Reassess below ${money(stop)} or if AWS/ads growth decelerates sharply.</td></tr>
    </table>
  </section>

  <section class="page">
    <h2>J. Final Verdict</h2>
    <table><tr><th>Item</th><th>Answer</th></tr>
      <tr><td>Investment rating</td><td>Buy</td></tr>
      <tr><td>Ideal entry price</td><td>${money(entry)}</td></tr>
      <tr><td>Pullback buy zone</td><td>${money(pullback)} +/- 3%</td></tr>
      <tr><td>Breakout buy zone</td><td>Above ${money(technical.breakout)} with volume confirmation</td></tr>
      <tr><td>Fair value range</td><td>${money(baseFair[0])} - ${money(baseFair[1])}</td></tr>
      <tr><td>12-month target range</td><td>${money(baseFair[1])} - ${money(bullTarget)}</td></tr>
      <tr><td>Key reason to buy</td><td>AWS + advertising + retail productivity create multiple compounding levers.</td></tr>
      <tr><td>Key reason to avoid</td><td>AI capex and valuation can overwhelm near-term free cash flow optics.</td></tr>
      <tr><td>What must happen</td><td>AWS AI demand must convert into revenue growth and margin dollars while retail/ads continue operating leverage.</td></tr>
    </table>

    <h2>Source List</h2>
    <ul class="sources">
      <li>Amazon Investor Relations, Q1 2026 Results: https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-First-Quarter-Results/</li>
      <li>Amazon Q1 2026 company release summary: https://www.aboutamazon.com/news/company-news/amazon-earnings-q1-2026-report</li>
      <li>Amazon FY2025 Form 10-K, SEC EDGAR: https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231.htm</li>
      <li>Amazon FY2025 Annual Report PDF: https://s2.q4cdn.com/299287126/files/doc_financials/2026/ar/Amazon-2025-Annual-Report.pdf</li>
      <li>Market data and technicals: Yahoo Finance endpoints via local stock analyzer, when available.</li>
    </ul>
    ${market.unavailable.length ? `<p class="small"><strong>Missing data notes:</strong> ${market.unavailable.map(escapeHtml).join("; ")}</p>` : ""}
  </section>
</body>
</html>`;
}

async function main() {
  if (ticker !== "AMZN") {
    console.warn(`This institutional template currently validates peer logic for AMZN. Requested ${ticker}; defaulting to AMZN until ticker-specific peer validation is added.`);
  }
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(publicReportsDir, { recursive: true });
  const market = await getMarketData(reportSymbol);
  const technical = buildTechnical(market.history, market.price);
  const html = buildHtml({ market, technical });
  const htmlPath = path.join(reportsDir, "AMZN_institutional_research_report.html");
  const pdfPath = path.join(reportsDir, "AMZN_institutional_research_report.pdf");
  const publicHtmlPath = path.join(publicReportsDir, "AMZN_institutional_research_report.html");
  const publicPdfPath = path.join(publicReportsDir, "AMZN_institutional_research_report.pdf");
  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(publicHtmlPath, html, "utf8");
  console.log(`Institutional AMZN report HTML written: ${htmlPath}`);
  console.log(`GitHub Pages AMZN report HTML written: ${publicHtmlPath}`);
  const pdf = printPdf(htmlPath, pdfPath);
  if (pdf.ok) {
    fs.copyFileSync(pdfPath, publicPdfPath);
    console.log(`Institutional AMZN report PDF written: ${pdfPath}`);
    console.log(`GitHub Pages AMZN report PDF written: ${publicPdfPath}`);
  } else {
    console.warn(`PDF export skipped: ${pdf.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
