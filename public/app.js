const format = (value) => value ?? "";
const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "n/a";
};
const wholeMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(0)}` : "n/a";
};

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
  if (signal === "INTRADAY_LONG") return "Intraday bullish idea";
  if (signal === "INTRADAY_SHORT") return "Intraday bearish idea";
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

function decisionLabel(decision) {
  if (decision === "TRADE_NOW") return "Trade Now";
  if (decision === "WAIT") return "Wait";
  if (decision === "NO_TRADE") return "No Trade";
  return decision || "No Trade";
}

function decisionClass(decision) {
  if (decision === "TRADE_NOW") return "decision-badge decision-badge--trade";
  if (decision === "WAIT") return "decision-badge decision-badge--wait";
  return "decision-badge decision-badge--no";
}

function decisionBadge(decision) {
  return `<span class="${decisionClass(decision)}">${decisionLabel(decision)}</span>`;
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

function renderCoachCards(optionsAlerts) {
  const target = document.getElementById("coach-cards");
  const longOptionRows = (optionsAlerts ?? [])
    .filter((row) => ["CALL_SETUP", "PUT_SETUP", "WATCH"].includes(row.signal) && ["BUY_CALL", "BUY_PUT"].includes(row.beginnerStrategy));
  const hasPut = longOptionRows.some((row) => row.beginnerStrategy === "BUY_PUT");
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

  const cards = [...optionCards, putNote].filter(Boolean);
  target.innerHTML = cards.length ? cards.join("") : `<p class="empty">Run scans first, then beginner cards will appear here.</p>`;
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

function renderIntradayCockpit(summary, rows) {
  const cockpit = document.getElementById("intraday-cockpit");
  const rules = document.getElementById("day-rules");
  const tradeNowRows = (rows ?? []).filter((row) => row.decision === "TRADE_NOW");
  const waitRows = (rows ?? []).filter((row) => row.decision === "WAIT");
  const noTradeRows = (rows ?? []).filter((row) => row.decision === "NO_TRADE");
  const bias = summary?.marketBias;
  const topTrade = tradeNowRows[0];
  const nextWait = waitRows[0];
  cockpit.innerHTML = `
    <article class="${biasClass(bias)}">
      <span>Market Bias</span>
      <strong>${biasLabel(bias)}</strong>
      <p>${summary?.primaryAction || "Run intraday scan to get today's read."}</p>
    </article>
    <article class="bias-card">
      <span>Best Action</span>
      <strong>${topTrade ? `${topTrade.symbol} ${topTrade.signal === "INTRADAY_LONG" ? "Call" : "Put"}` : "Do Nothing Yet"}</strong>
      <p>${topTrade ? topTrade.entryPlan : nextWait ? `${nextWait.symbol}: ${nextWait.noTradeReason || nextWait.action}` : "No clean intraday setup is active."}</p>
    </article>
    <article class="bias-card">
      <span>Board</span>
      <strong>${summary?.tradeNowCount ?? tradeNowRows.length} trade / ${summary?.waitCount ?? waitRows.length} wait / ${summary?.noTradeCount ?? noTradeRows.length} skip</strong>
      <p>${summary?.aboveVwap ?? 0} above VWAP, ${summary?.belowVwap ?? 0} below VWAP.</p>
    </article>
  `;

  const ruleItems = summary?.rules ?? [
    "Only trade A setups.",
    "Maximum 3 intraday trades.",
    "Stop after 2 losses.",
    "No averaging down.",
  ];
  rules.innerHTML = ruleItems.map((rule) => `<span>${rule}</span>`).join("");
}

function renderVwapNote(rows) {
  const target = document.getElementById("vwap-note");
  const cleanRows = (rows ?? []).filter((row) => Number.isFinite(Number(row.price)) && Number.isFinite(Number(row.vwap)));
  const aboveCount = cleanRows.filter((row) => Number(row.price) > Number(row.vwap)).length;
  const belowCount = cleanRows.filter((row) => Number(row.price) < Number(row.vwap)).length;
  target.innerHTML = `
    <div>
      <strong>VWAP = volume-weighted average price.</strong>
      <span>Think of it as today's fair-price line. Above VWAP means buyers are willing to pay above the day's average. Below VWAP means sellers have control.</span>
    </div>
    <div class="vwap-stats">
      <span class="mini-stat mini-stat--good">${aboveCount} above VWAP</span>
      <span class="mini-stat mini-stat--bad">${belowCount} below VWAP</span>
    </div>
  `;
}

function renderIntradayCards(rows) {
  const target = document.getElementById("intraday-cards");
  const cards = (rows ?? [])
    .filter((row) => ["TRADE_NOW", "WAIT", "NO_TRADE"].includes(row.decision))
    .sort((a, b) => {
      const order = { TRADE_NOW: 0, WAIT: 1, NO_TRADE: 2 };
      return (order[a.decision] ?? 3) - (order[b.decision] ?? 3) || Number(b.score) - Number(a.score);
    })
    .slice(0, 6)
    .map((row) => `
      <article class="coach-card ${row.decision === "TRADE_NOW" && row.signal === "INTRADAY_LONG" ? "coach-card--bullish" : row.decision === "TRADE_NOW" && row.signal === "INTRADAY_SHORT" ? "coach-card--bearish" : row.decision === "NO_TRADE" ? "coach-card--quiet" : "coach-card--neutral"}">
        <div class="coach-head">
          <div>
            <span class="symbol">${row.symbol}</span>
            ${decisionBadge(row.decision)}
          </div>
          ${confidenceBadge(row.score)}
        </div>
        <p class="action">${row.plainDecision || row.action || "No intraday trade right now."}</p>
        <div class="explain-grid">
          <div><span>Price</span><strong>${money(row.price)}</strong></div>
          <div><span>VWAP</span><strong>${money(row.vwap)}</strong></div>
          <div><span>Stop</span><strong>${money(row.stop)}</strong></div>
          <div><span>Target</span><strong>${money(row.target)}</strong></div>
        </div>
        <ul class="plain-list">
          <li>Setup: ${row.setup || "No clean setup"}</li>
          <li>Entry: ${row.entryPlan || "No entry plan yet."}</li>
          <li>Cancel if: ${row.invalidation || row.noTradeReason || "Conditions fade."}</li>
          <li>Reward/risk: ${row.rewardRisk || "n/a"}</li>
          <li>Why: ${row.reason}</li>
        </ul>
      </article>
    `);
  target.innerHTML = cards.length ? cards.join("") : `<p class="empty">Run intraday scan first.</p>`;
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

async function loadDashboard() {
  let response = await fetch("/api/dashboard");
  if (!response.ok) {
    response = await fetch("./dashboard.json");
  }
  const data = await response.json();
  const regime = data.marketRegime;
  document.getElementById("regime").innerHTML = regime ? `
    <div class="metric"><span>Regime</span><strong>${pill(regime.regime)}</strong></div>
    <div class="metric"><span>Score</span><strong>${regime.score}</strong></div>
    <div class="metric"><span>VIX</span><strong>${regime.vix ?? "n/a"}</strong></div>
    <div class="metric"><span>Read</span><strong>${regime.reason}</strong></div>
  ` : `<div class="metric"><span>Regime</span><strong>No scan yet</strong></div>`;

  renderCoachCards(data.optionsAlerts);
  renderLongTermStarterPack(data.longTermStarterPack);
  renderSwingSummary(data.stockScan, data.stockAlerts);
  renderSwingCards(data.stockAlerts);
  renderIntradayCockpit(data.intradaySummary, data.intradayScan);
  renderVwapNote(data.intradayScan);
  renderIntradayCards(data.intradayScan);

  const longOptions = (data.optionsScan ?? []).filter((row) => ["BUY_CALL", "BUY_PUT"].includes(row.beginnerStrategy));
  renderTable("options-alerts", longOptions, [
    { key: "symbol", label: "Symbol" },
    { key: "signal", label: "Signal", pill: true },
    { key: "score", label: "Score", formatter: scoreBadge },
    { key: "expiration", label: "Exp" },
    { key: "beginnerStrategy", label: "Trade" },
    { key: "optionStrike", label: "Strike" },
    { key: "optionEntry", label: "Option Price", formatter: money },
    { key: "optionCost", label: "1 Contract Cost", formatter: wholeMoney },
    { key: "optionStop", label: "Option Stop", formatter: money },
    { key: "optionTarget1", label: "Target 1", formatter: money },
  ]);

  renderTable("stock-alerts", data.stockAlerts, [
    { key: "symbol", label: "Symbol" },
    { key: "signal", label: "Signal", pill: true },
    { key: "score", label: "Score", formatter: scoreBadge },
    { key: "setup", label: "Setup" },
    { key: "close", label: "Close" },
    { key: "stop", label: "Stop" },
    { key: "target1", label: "Target 1" },
    { key: "target", label: "Target" },
    { key: "riskPct", label: "Risk %" },
    { key: "reason", label: "Reason" },
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

  renderTable("backtest", data.backtest, [
    { key: "symbol", label: "Symbol" },
    { key: "trades", label: "Trades" },
    { key: "winRate", label: "Win %" },
    { key: "avgReturnPct", label: "Avg %" },
    { key: "profitFactor", label: "PF" },
  ]);

  renderTable("journal", data.journal.map((item) => ({
    symbol: item.latestIdea?.symbol,
    strategy: item.latestIdea?.beginnerStrategy || item.latestIdea?.strategy,
    status: item.status,
    updatedAt: item.updatedAt,
  })), [
    { key: "symbol", label: "Symbol" },
    { key: "strategy", label: "Trade" },
    { key: "status", label: "Status", pill: true },
    { key: "updatedAt", label: "Updated" },
  ]);

  renderTable("intraday-table", data.intradayScan, [
    { key: "symbol", label: "Symbol" },
    { key: "decision", label: "Decision", formatter: decisionBadge },
    { key: "score", label: "Score", formatter: scoreBadge },
    { key: "setup", label: "Setup" },
    { key: "price", label: "Price" },
    { key: "vwap", label: "VWAP" },
    { key: "stop", label: "Stop" },
    { key: "target", label: "Target" },
    { key: "rewardRisk", label: "R/R" },
    { key: "reason", label: "Reason" },
  ]);
}

document.getElementById("refresh").addEventListener("click", loadDashboard);
document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("tab-button--active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("tab-panel--active"));
    button.classList.add("tab-button--active");
    document.getElementById(`tab-${button.dataset.tab}`).classList.add("tab-panel--active");
  });
});
loadDashboard();
