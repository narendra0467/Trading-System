const format = (value) => value ?? "";
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

async function loadDashboard() {
  let response = await fetch("/api/dashboard", { cache: "no-store" });
  if (!response.ok) {
    response = await fetch(`./dashboard.json?v=${Date.now()}`, { cache: "no-store" });
  }
  const data = await response.json();
  document.getElementById("updated-line").textContent = `Last refreshed: ${dateTime(data.updatedAt)}`;
  const regime = data.marketRegime;
  document.getElementById("regime").innerHTML = regime ? `
    <div class="metric"><span>Regime</span><strong>${pill(regime.regime)}</strong></div>
    <div class="metric"><span>Score</span><strong>${regime.score}</strong></div>
    <div class="metric"><span>VIX</span><strong>${regime.vix ?? "n/a"}</strong></div>
    <div class="metric"><span>Read</span><strong>${regime.reason}</strong></div>
  ` : `<div class="metric"><span>Regime</span><strong>No scan yet</strong></div>`;

  renderCoachCards(data.optionsAlerts, data.optionsScan);
  renderHighRiskSummary(data.highRiskSummary, data.highRiskAlerts);
  renderHighRiskCards(data.highRiskAlerts);
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

document.getElementById("refresh").addEventListener("click", loadDashboard);
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
