const money = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "n/a";
const fmt = (value) => value ?? "n/a";
const displaySignal = (row) => row.setupSignal || row.signal || "";
const time = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
};

function pill(row) {
  const label = row.decisionCode || row.signal;
  const cls = label === "TRADE_NOW" ? "pill--call" : label === "NO_TRADE" ? "pill--put" : "pill--watch";
  return `<span class="pill ${cls}">${String(label).replaceAll("_", " ")}</span>`;
}

function grade(row) {
  const cls = row.tradeGrade === "A+" || row.tradeGrade === "A" ? "grade--a" : row.tradeGrade === "B" ? "grade--b" : row.tradeGrade === "C" ? "grade--c" : "grade--d";
  return `<span class="grade ${cls}">${row.tradeGrade || "D"} / ${fmt(row.confidenceRating)}%</span>`;
}

function renderSummary(summary, alerts) {
  const target = document.getElementById("summary");
  if (!summary) {
    document.getElementById("updated").textContent = "No local scan loaded yet";
    document.getElementById("trade-policy").innerHTML = "";
    target.innerHTML = `<article class="metric"><span>Status</span><strong>No scan yet</strong><p class="muted">Click Run Scan to build the first intraday board.</p></article>`;
    return;
  }
  document.getElementById("updated").textContent = `Last scan: ${time(summary.updatedAt)}`;
  const eventNames = (summary.eventPolicy?.events ?? [])
    .slice(0, 4)
    .map((event) => event.symbol && event.symbol !== "ALL" ? `${event.symbol}: ${event.event}` : event.event)
    .join("; ");
  const earningsNames = (summary.eventPolicy?.earningsEvents ?? [])
    .slice(0, 4)
    .map((event) => event.event)
    .join("; ");
  const reminderNames = (summary.eventPolicy?.manualReminders ?? [])
    .slice(0, 3)
    .map((event) => event.symbol && event.symbol !== "ALL" ? `${event.symbol}: ${event.event}` : event.event)
    .join("; ");
  document.getElementById("trade-policy").innerHTML = `
    <article class="policy-card policy-card--${String(summary.eventPolicy?.level || "normal").toLowerCase()}">
      <span>Auto Event Scan</span>
      <strong>${fmt(summary.eventPolicy?.headline)}</strong>
      <p>${fmt(summary.eventPolicy?.rule)}</p>
      ${eventNames ? `<p>Events: ${eventNames}</p>` : ""}
      ${earningsNames ? `<p>Earnings watch: ${earningsNames}</p>` : ""}
      ${reminderNames ? `<p>Manual reminders: ${reminderNames}</p>` : ""}
      <p>Cadence: ${summary.decisionCadence || "15-minute primary signals"}; next review in about ${summary.nextReviewMinutes || 15} minutes.</p>
      <p>Discipline: ${summary.disciplineMode || "2-3 trades max. Only spend slots on clean VWAP trend setups."}</p>
    </article>
  `;
  target.innerHTML = `
    <article class="metric"><span>Scanned</span><strong>${summary.scanned}</strong><p class="muted">Indexes plus high-liquidity names.</p></article>
    <article class="metric"><span>Daily Slots</span><strong>${summary.approvedTradeSlots || 0}/${summary.dailyTradeLimit || 3}</strong><p class="muted">${summary.tradeSlotsRemaining ?? 0} slots left. Stop after 2 losses.</p></article>
    <article class="metric"><span>Best Idea</span><strong>${summary.bestIdea ? summary.bestIdea.symbol : "Wait"}</strong><p class="muted">${summary.bestIdea?.action || summary.rule}</p></article>
    <article class="metric"><span>Breadth</span><strong>${summary.marketBreadth?.aboveVwap ?? 0} above VWAP</strong><p class="muted">${summary.marketBreadth?.callBias ?? 0} call bias / ${summary.marketBreadth?.putBias ?? 0} put bias.</p></article>
  `;
}

function tierClass(tier) {
  if (tier === "A+ Trade") return "tier--aplus";
  if (tier === "Watch for Trigger") return "tier--watch";
  return "tier--no";
}

function renderMorningBrief(summary) {
  const target = document.getElementById("morning-brief");
  const brief = summary?.morningBrief;
  if (!brief) {
    target.innerHTML = `<p class="empty">Morning brief appears after the next intraday scan.</p>`;
    return;
  }
  const topTickers = brief.topTickers?.slice(0, 5) ?? [];
  const priceLevel = (value) => Number.isFinite(Number(value)) ? money(value) : "Pending";
  target.innerHTML = `
    <article class="brief-hero">
      <div>
        <span>Market Condition</span>
        <strong>${fmt(brief.marketCondition)}</strong>
        <p>${fmt(brief.marketRead)}</p>
      </div>
      <div class="brief-meters">
        ${miniLevel("Event Risk", brief.eventRisk)}
        ${miniLevel("A+ Setups", brief.counts?.aPlus ?? 0)}
        ${miniLevel("Watch", brief.counts?.watch ?? 0)}
        ${miniLevel("No Trade", brief.counts?.noTrade ?? 0)}
      </div>
    </article>
    <div class="top-watch">
      ${topTickers.map((row) => `
        <article class="watch-row ${tierClass(row.signalTier || "No Trade")}">
          <div>
            <strong>${row.ticker}</strong>
            <span>${row.companyName || ""}</span>
          </div>
          <p>${row.reason || "No catalyst note yet."}</p>
          <div class="levels levels--compact">
            ${miniLevel("Tier", row.signalTier || "No Trade")}
            ${miniLevel("Bias", row.bias || "Neutral")}
            ${miniLevel("RVOL", row.relativeVolume ?? "Pending")}
            ${miniLevel("Status", row.tradeStatus || "Do Not Trade")}
            ${miniLevel("Support", row.keySupport, priceLevel)}
            ${miniLevel("Resistance", row.keyResistance, priceLevel)}
          </div>
        </article>
      `).join("") || `<p class="empty">No top tickers yet.</p>`}
    </div>
    <article class="plan-card">
      <strong>Trading Plan</strong>
      <p>${brief.tradingPlan?.longSetupPlan}</p>
      <p>${brief.tradingPlan?.shortSetupPlan}</p>
      <p>${brief.tradingPlan?.noTradeCondition}</p>
      <p>${brief.tradingPlan?.bestTriggerToWaitFor}</p>
    </article>
  `;
}

function miniLevel(label, value, formatter = fmt) {
  const display = value === null || value === undefined || value === "" ? "Pending" : formatter(value);
  return `<div><span>${label}</span><strong>${display}</strong></div>`;
}

function optionChecklist(row) {
  const positives = row.optionContractPositives ?? [];
  const risks = row.optionContractRisks ?? [];
  if (!row.optionContractScore) {
    return `<p>${row.contractDecision || "Contract analysis appears after the option chain check."}</p>`;
  }
  return `
    <div class="option-score">
      <span>Contract Grade</span>
      <strong>${row.optionContractGrade || "n/a"} / ${row.optionContractScore}/100</strong>
    </div>
    <div class="option-metrics">
      ${miniLevel("Bid", row.optionBid, money)}
      ${miniLevel("Ask", row.optionAsk, money)}
      ${miniLevel("Mid", row.optionMid, money)}
      ${miniLevel("Spread", `${fmt(row.optionSpreadPct)}%`)}
      ${miniLevel("Volume", row.optionVolume)}
      ${miniLevel("Open Int", row.optionOpenInterest)}
    </div>
    <p>${row.contractWhy || ""}</p>
    <p>Good: ${positives.slice(0, 3).join("; ") || "No strong contract positives yet."}</p>
    <p>Watch: ${risks.slice(0, 3).join("; ") || "No major contract risks flagged."}</p>
  `;
}

function ruleChecklist(row) {
  const checks = [
    ["Market", row.marketConfirmation, row.marketConfirmationReason, row.marketConfirmation === "SPY + QQQ agree"],
    ["5m Close", row.candleConfirmation, row.candleConfirmationReason, row.candleConfirmation === "5m close confirmed"],
    ["Retest", row.retestEntry, row.retestEntryReason, row.retestEntry === "Retest acceptable"],
    ["Time", row.timeWindow, row.timeWindowReason, row.timeWindow === "Trade window open" || row.timeWindow === "Power hour"],
    ["Broker", "Manual check", row.brokerCheckRequired, false],
  ];
  return `
    <div class="rule-checks">
      ${checks.map(([label, value, reason, passed]) => `
        <div class="${passed ? "rule-check rule-check--pass" : "rule-check rule-check--wait"}">
          <span>${label}</span>
          <strong>${fmt(value)}</strong>
          <p>${fmt(reason)}</p>
        </div>
      `).join("")}
    </div>
    <div class="playbook">
      <p>${fmt(row.riskRule)}</p>
      <p>${fmt(row.profitRule)}</p>
    </div>
  `;
}

function renderIndexTape(summary, rows = []) {
  const target = document.getElementById("index-tape");
  const indexes = summary?.indexTape?.length ? summary.indexTape : rows.filter((row) => ["SPY", "QQQ", "IWM"].includes(row.symbol));
  if (!indexes.length) {
    target.innerHTML = `<p class="empty">Index data will appear after the next scan.</p>`;
    return;
  }
  target.innerHTML = indexes.map((row) => {
    const signal = displaySignal(row);
    const bias = signal.includes("CALL")
      ? "Call bias"
      : signal.includes("PUT")
        ? "Put bias"
        : row.close > row.vwap
          ? "Slight bullish, no trigger"
          : "Slight bearish, no trigger";
    const type = signal.includes("CALL") ? "call" : signal.includes("PUT") ? "put" : "watch";
    return `
      <article class="index-card card--${type}">
        <span>${row.name || "Index"}</span>
        <strong>${row.symbol} ${bias}</strong>
        <p class="reason">${grade(row)} ${row.tradeDecision || "Pass for now"}.</p>
        <p class="reason">Now ${money(row.close)} vs VWAP ${money(row.vwap)} (${fmt(row.vwapDistancePct)}%). Trigger ${money(row.trigger)}, stop ${money(row.stop)}. ${row.eventRiskHeadline || row.reason || "No clean index trigger yet."}</p>
      </article>
    `;
  }).join("");
}

function tradeCard(row, compact = false) {
  const signal = displaySignal(row);
  const type = signal.includes("CALL") ? "call" : signal.includes("PUT") ? "put" : "watch";
  return `
    <article class="trade-card card--${type} ${row.tradeSlotApproved ? "trade-card--approved" : "trade-card--watch"}">
      <div class="trade-card__top">
        <div>
          <div class="symbol-line">
            <strong>${row.symbol}</strong>
            ${grade(row)}
          </div>
          <p>${row.name || row.group || ""}</p>
        </div>
        ${pill(row)}
      </div>

      <div class="slot ${row.tradeSlotApproved ? "slot--approved" : "slot--wait"}">
        <span>${row.tradeSlotApproved ? "Approved Trade Slot" : "Waitlist"}</span>
        <strong>${row.tradeSlotApproved ? `Slot ${row.dailyTradeSlot || "?"}/3` : row.executionLabel || "Wait"}</strong>
        <p>${row.setupType ? `${row.setupType}. ` : ""}${row.slotPlan || row.executionReason || "Wait until the setup becomes A/A+ quality."}</p>
      </div>

      <div class="trade-ticket">
        <span>${fmt(row.optionSide)}</span>
        <strong>${row.optionContractLabel || `${money(row.stockEntryTrigger || row.trigger)} entry trigger`}</strong>
        <p>${row.skipRule || "Wait for confirmation."}</p>
      </div>

      <div class="levels levels--primary">
        ${miniLevel("Stop", row.stockStop || row.stop, money)}
        ${miniLevel("Target", row.stockTarget || row.target, money)}
        ${miniLevel("R/R", row.rewardRisk)}
        ${miniLevel("Score", row.decisionScore ? `${row.decisionScore}/100` : "n/a")}
      </div>

      ${compact ? "" : `
        ${ruleChecklist(row)}
        <div class="levels levels--analysis">
          ${miniLevel("VWAP", row.vwap, money)}
          ${miniLevel("Key", row.keyLevel || "n/a")}
          ${miniLevel("15m", row.timeframe15)}
          ${miniLevel("5m", row.timeframe5)}
          ${miniLevel("30m", row.timeframe30)}
        </div>
        <div class="playbook">
          <p>${row.decisionScoreSummary || ""}</p>
        </div>
        <div class="contract-strip">
          <span>Contract</span>
          <p>${row.contractHint || row.strikeHint || "Use a liquid at-the-money contract."}</p>
          ${optionChecklist(row)}
        </div>
      `}

      <p class="reason">${row.traderRead || row.beginnerRead}</p>
      <p class="why-line">${row.reason}</p>
    </article>
  `;
}

function renderTradeDeck(summary, alerts = []) {
  const approvedTarget = document.getElementById("approved-cards");
  const watchTarget = document.getElementById("watch-cards");
  const phase = summary?.sessionPolicy?.phase;
  const marketClosed = ["WEEKEND", "CLOSED", "AFTER_HOURS"].includes(phase);
  if (marketClosed) {
    approvedTarget.innerHTML = `
      <article class="no-trade-panel">
        <span>${fmt(summary?.sessionPolicy?.label)}</span>
        <strong>Market is closed. No live trades today.</strong>
        <p>${fmt(summary?.sessionPolicy?.reason)}</p>
      </article>
    `;
    watchTarget.innerHTML = `<p class="empty">Watchlist is hidden while the market is closed. The next automatic prep scan starts at 7:00 AM MST on the next trading day.</p>`;
    return;
  }
  const approved = summary?.approvedTrades?.length
    ? summary.approvedTrades
    : alerts.filter((row) => row.tradeSlotApproved);
  const watch = summary?.watchlist?.length
    ? summary.watchlist
    : alerts.filter((row) => !row.tradeSlotApproved).slice(0, 6);

  if (!approved.length) {
    approvedTarget.innerHTML = `
      <article class="no-trade-panel">
        <span>No approved trade slots</span>
        <strong>Wait. This is discipline doing its job.</strong>
        <p>Only A/A+ VWAP trend setups with volume, slope, multi-timeframe alignment, and acceptable reward/risk get a trade slot.</p>
      </article>
    `;
  } else {
    approvedTarget.innerHTML = approved.map((row) => tradeCard(row)).join("");
  }

  if (!watch.length) {
    watchTarget.innerHTML = `<p class="empty">No watchlist names. Market is too messy or data is still forming.</p>`;
    return;
  }
  watchTarget.innerHTML = watch.slice(0, 6).map((row) => tradeCard(row, true)).join("");
}

function v2Card(row) {
  const noTrade = row.signalTier === "No Trade";
  return `
    <article class="desk-card ${tierClass(row.signalTier)}">
      <div class="trade-card__top">
        <div>
          <div class="symbol-line">
            <strong>${row.ticker}</strong>
            <span class="tier">${row.signalTier}</span>
          </div>
          <p>${row.companyName || ""}</p>
        </div>
        <div class="score-stack">
          <span>Confidence</span>
          <strong>${fmt(row.confidenceScore)}</strong>
          <span>Risk ${fmt(row.riskScore)}</span>
        </div>
      </div>
      <p class="reason">${row.whyThisTradeExists || row.noTradeReason}</p>
      <div class="levels">
        ${miniLevel("Direction", row.direction)}
        ${miniLevel("Entry Zone", row.entryZone)}
        ${miniLevel("Stop", row.stopLoss, money)}
        ${miniLevel("Target 1", row.target1, money)}
        ${miniLevel("Target 2", row.target2, money)}
        ${miniLevel("R/R", row.riskReward)}
        ${miniLevel("Max Loss", row.maxLossIfWrong)}
        ${miniLevel("Status", row.tradeStatus)}
      </div>
      ${row.triggerNeeded ? `<div class="plan-card plan-card--small"><strong>Trigger Needed</strong><p>${row.triggerNeeded}</p></div>` : ""}
      ${noTrade ? `<div class="no-trade-reason"><strong>No-Trade Reason</strong><p>${row.noTradeReason}</p></div>` : ""}
      <p class="why-line">${row.invalidationReason || ""}</p>
    </article>
  `;
}

function renderV2Board(summary) {
  const target = document.getElementById("v2-trade-cards");
  const active = summary?.activeTradeCards ?? [];
  const watch = summary?.watchForTriggerCards ?? [];
  const noTrade = summary?.noTradeCards ?? [];
  const cards = [...active, ...watch.slice(0, 4), ...noTrade.slice(0, 3)];
  if (!cards.length) {
    target.innerHTML = `<p class="empty">No Trading Desk v2 cards yet.</p>`;
    return;
  }
  target.innerHTML = cards.map(v2Card).join("");
}

function simpleTable(rows, columns) {
  if (!rows?.length) return `<p class="empty">No rows yet.</p>`;
  return `
    <table class="mini-table">
      <thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${columns.map(([key]) => `<td>${fmt(row[key])}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderDeskContext(summary) {
  const target = document.getElementById("desk-context");
  if (!summary) {
    target.innerHTML = `<p class="empty">Context appears after scan.</p>`;
    return;
  }
  target.innerHTML = `
    <article class="context-card">
      <span>Event Risk Calendar</span>
      ${simpleTable(summary.eventRiskCalendar?.slice(0, 6), [["symbol", "Symbol"], ["event", "Event"], ["risk", "Risk"]])}
    </article>
    <article class="context-card">
      <span>Sector Strength</span>
      ${simpleTable(summary.sectorStrength?.slice(0, 6), [["sector", "Sector"], ["relativeStrengthPct", "RS %"], ["averageRelativeVolume", "RVOL"], ["bias", "Bias"]])}
    </article>
    <article class="context-card">
      <span>Premarket / RVOL Movers</span>
      ${simpleTable(summary.premarketMovers?.slice(0, 6), [["ticker", "Ticker"], ["relativeVolume", "RVOL"], ["signalTier", "Tier"], ["bias", "Bias"]])}
    </article>
  `;
}

function renderPaperResults(summary, paperResults) {
  const target = document.getElementById("paper-results");
  const stats = paperResults || summary?.paperResults;
  if (!stats) {
    target.innerHTML = `<p class="empty">Paper stats appear after the next scan.</p>`;
    return;
  }
  target.innerHTML = `
    <article class="metric">${miniLevel("Tracked Signals", stats.totalTracked ?? 0)}</article>
    <article class="metric">${miniLevel("Pending", stats.pending ?? 0)}</article>
    <article class="metric">${miniLevel("Win Rate", stats.winRate == null ? "Pending" : `${stats.winRate}%`)}</article>
    <article class="metric">${miniLevel("Expectancy", stats.expectancy ?? "Pending")}</article>
    <article class="plan-card paper-note"><strong>Review Note</strong><p>${stats.note || "Tracking started."}</p></article>
  `;
}

function renderTable(rows) {
  const target = document.getElementById("table");
  if (!rows?.length) {
    target.innerHTML = `<p class="empty">Run a scan first.</p>`;
    return;
  }
  const columns = [
    ["symbol", "Symbol"],
    ["decisionCode", "Decision"],
    ["signalTier", "Tier"],
    ["signal", "Signal"],
    ["optionSide", "Option"],
    ["confidence", "Confidence"],
    ["confidenceRating", "Rating"],
    ["riskScore", "Risk Score"],
    ["decisionScore", "Checklist"],
    ["setupType", "Setup Type"],
    ["tradeDecision", "Decision"],
    ["noTradeReason", "No-Trade Reason"],
    ["tradeSlotApproved", "Slot"],
    ["dailyTradeSlot", "Slot #"],
    ["marketConfirmation", "Market"],
    ["candleConfirmation", "5m Close"],
    ["retestEntry", "Retest"],
    ["timeWindow", "Time"],
    ["optionQuality", "Contract"],
    ["optionContractGrade", "Option Grade"],
    ["optionContractScore", "Option Score"],
    ["optionStrike", "Strike"],
    ["optionMid", "Mid"],
    ["optionSpreadPct", "Spread %"],
    ["optionVolume", "Opt Vol"],
    ["optionOpenInterest", "OI"],
    ["optionMoneynessPct", "Moneyness %"],
    ["setupQuality", "Setup"],
    ["riskQuality", "Risk"],
    ["multiTimeframe", "MTF"],
    ["keyLevel", "Key Level"],
    ["eventRiskLevel", "Event"],
    ["chopRisk", "Chop"],
    ["sessionPhase", "Phase"],
    ["score", "Score"],
    ["close", "Close"],
    ["vwap", "VWAP"],
    ["ema20", "EMA20"],
    ["ema50", "EMA50"],
    ["ema200", "EMA200"],
    ["previousDayHigh", "Prev High"],
    ["previousDayLow", "Prev Low"],
    ["vwapDistancePct", "VWAP %"],
    ["vwapSlopePct", "VWAP Slope"],
    ["rsi14", "RSI"],
    ["volumeRatio", "Vol x"],
    ["rangePosition", "Range %"],
    ["trigger", "Trigger"],
    ["entryZone", "Entry Zone"],
    ["stop", "Stop"],
    ["target", "Target"],
    ["target2", "Target 2"],
    ["targetPlan", "Target Plan"],
    ["stopPlan", "Stop Plan"],
    ["reason", "Why"],
  ];
  target.innerHTML = `
    <table>
      <thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${columns.map(([key]) => {
          const value = ["close", "vwap", "trigger", "stop", "target"].includes(key) ? money(row[key]) : fmt(row[key]);
          return `<td>${key === "signal" ? pill(row) : key === "confidenceRating" ? grade(row) : value}</td>`;
        }).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function loadLatest() {
  try {
    document.getElementById("status").textContent = "Loading...";
    const response = await fetch("/api/intraday", { cache: "no-store" });
    const data = await response.json();
    renderSummary(data.summary, data.alerts);
    renderMorningBrief(data.summary);
    renderIndexTape(data.summary, data.alerts);
    renderTradeDeck(data.summary, data.alerts);
    renderV2Board(data.summary);
    renderDeskContext(data.summary);
    renderPaperResults(data.summary, data.paperResults);
    renderTable(data.results?.length ? data.results : data.alerts);
    document.getElementById("status").textContent = "Ready";
  } catch (error) {
    document.getElementById("status").textContent = "Local server/API error";
    document.getElementById("approved-cards").innerHTML = `<p class="empty">${error.message}. Make sure npm run intraday:dashboard is running.</p>`;
  }
}

async function runScan() {
  if (runScan.active) return;
  runScan.active = true;
  try {
    document.getElementById("status").textContent = "Scanning live data...";
    const response = await fetch("/api/intraday/scan", { cache: "no-store" });
    const data = await response.json();
    if (data.error) {
      document.getElementById("status").textContent = data.error;
      document.getElementById("approved-cards").innerHTML = `<p class="empty">${data.error}</p>`;
      return;
    }
    renderSummary(data.summary, data.tradeIdeas);
    renderMorningBrief(data.summary);
    renderIndexTape(data.summary, data.results);
    renderTradeDeck(data.summary, data.tradeIdeas);
    renderV2Board(data.summary);
    renderDeskContext(data.summary);
    renderPaperResults(data.summary, data.summary?.paperResults);
    renderTable(data.results);
    document.getElementById("status").textContent = "Ready";
  } catch (error) {
    document.getElementById("status").textContent = "Scan failed";
    document.getElementById("approved-cards").innerHTML = `<p class="empty">${error.message}. Keep the local server running and check network access.</p>`;
  } finally {
    runScan.active = false;
  }
}

const LOCAL_MARKET_TIME_ZONE = "America/Edmonton";
const AUTO_REFRESH_START_MINUTES = 7 * 60;
const AUTO_REFRESH_END_MINUTES = 14 * 60;

function localMarketMinutesNow() {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_MARKET_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(local.find((part) => part.type === "hour")?.value);
  const minute = Number(local.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function isAutoRefreshWindow() {
  const minutes = localMarketMinutesNow();
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_MARKET_TIME_ZONE,
    weekday: "short",
  }).format(new Date());
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return isWeekday && Number.isFinite(minutes) && minutes >= AUTO_REFRESH_START_MINUTES && minutes <= AUTO_REFRESH_END_MINUTES;
}

function runScheduledScan() {
  if (isAutoRefreshWindow()) {
    runScan();
    return;
  }
  document.getElementById("status").textContent = "Auto-refresh paused until 7:00 AM MST";
}

document.getElementById("scan").addEventListener("click", runScan);
document.getElementById("load").addEventListener("click", loadLatest);
setInterval(runScheduledScan, 15 * 60 * 1000);
loadLatest().then(() => {
  if (isAutoRefreshWindow()) runScan();
});
