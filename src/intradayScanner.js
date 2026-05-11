import fs from "node:fs";

import { ema, macd, rsi, atr, dmi, stochastic, last } from "./indicators.js";
import { fetchHistory, fetchOptionChain, fetchOptionExpirations, fetchQuoteSummary, fetchYahooSearchNews } from "./marketData.js";
import { loadUniverseRecords } from "./universe.js";

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const EVENT_CALENDAR_PATH = "data/event_calendar.csv";
const MAX_DAILY_TRADES = 3;
const PRIMARY_TRADE_LIMIT = 3;
const MIN_A_PLUS_CONFIDENCE = 86;
const MIN_A_CONFIDENCE = 80;
const MIN_STARTER_CONFIDENCE = 76;
const EXCHANGE_TIME_ZONE = "America/New_York";
const PREP_START_MINUTES = 9 * 60;
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const MAX_LIVE_CANDLE_AGE_MINUTES = 45;

function exchangeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EXCHANGE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function exchangeDateKey(date = new Date()) {
  const parts = exchangeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function marketSessionPolicy(now = new Date()) {
  const parts = exchangeParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  const isWeekday = !["Sat", "Sun"].includes(parts.weekday);
  if (!isWeekday) {
    return {
      tradeAllowed: false,
      label: "Market closed",
      phase: "WEEKEND",
      reason: "Weekend session. Do not create live trade entries from old candles.",
    };
  }
  if (minutes < PREP_START_MINUTES) {
    return {
      tradeAllowed: false,
      label: "Before prep window",
      phase: "CLOSED",
      reason: "Auto-prep has not started yet.",
    };
  }
  if (minutes < MARKET_OPEN_MINUTES) {
    return {
      tradeAllowed: false,
      label: "Pre-market prep",
      phase: "PRE_MARKET_PREP",
      reason: "Build the watchlist now, but wait for regular-session candles before taking trades.",
    };
  }
  if (minutes <= MARKET_CLOSE_MINUTES) {
    return {
      tradeAllowed: true,
      label: "Regular session",
      phase: "REGULAR_SESSION",
      reason: "Live trade entries are allowed if the setup and broker check agree.",
    };
  }
  return {
    tradeAllowed: false,
    label: "After-hours review",
    phase: "AFTER_HOURS",
    reason: "Market is closed. Use signals for review only, not new entries.",
  };
}

function dataFreshness(datetime, now = new Date()) {
  const candleDate = datetime ? new Date(datetime) : null;
  if (!candleDate || Number.isNaN(candleDate.getTime())) {
    return { freshForTrading: false, label: "No candle time", reason: "Could not verify the latest candle timestamp." };
  }
  const sameExchangeDay = exchangeDateKey(candleDate) === exchangeDateKey(now);
  const ageMinutes = Math.round((now.getTime() - candleDate.getTime()) / 60000);
  const freshForTrading = sameExchangeDay && ageMinutes >= 0 && ageMinutes <= MAX_LIVE_CANDLE_AGE_MINUTES;
  return {
    freshForTrading,
    label: freshForTrading ? "Live candle fresh" : "Stale candle",
    reason: freshForTrading
      ? `Latest candle is about ${ageMinutes} minutes old.`
      : `Latest candle is not fresh enough for a live entry (${datetime}).`,
    ageMinutes,
    sameExchangeDay,
  };
}

function marketMinutesFromIso(datetime) {
  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) return null;
  const eastern = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(eastern.find((part) => part.type === "hour")?.value);
  const minute = Number(eastern.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour * 60 + minute) - (9 * 60 + 30);
}

function noTradeWindow(datetime) {
  const minutes = marketMinutesFromIso(datetime);
  if (!Number.isFinite(minutes)) return { blocked: false, label: "Time unknown", reason: "Could not identify market time." };
  if (minutes < 15) return { blocked: true, label: "Opening volatility", reason: "Avoid first 15 minutes. Let VWAP and opening range form." };
  if (minutes >= 150 && minutes <= 240) return { blocked: true, label: "Lunch chop", reason: "Avoid midday chop unless setup is exceptional." };
  if (minutes >= 360) return { blocked: false, label: "Power hour", reason: "Late-day trades allowed only if trend stays clean." };
  return { blocked: false, label: "Trade window open", reason: "Time window is acceptable." };
}

function candleConfirmation(rows5, direction, trigger) {
  const latest5 = last(rows5);
  const previous5 = rows5[rows5.length - 2];
  if (!latest5 || !Number.isFinite(trigger)) {
    return { confirmed: false, label: "No 5m confirmation", reason: "Need a completed 5-minute candle near the trigger." };
  }
  const buffer = latest5.close * 0.0004;
  const confirmed = direction === "CALL"
    ? latest5.close > trigger + buffer
    : latest5.close < trigger - buffer;
  const improving = previous5
    ? direction === "CALL"
      ? latest5.close > previous5.close
      : latest5.close < previous5.close
    : false;
  return {
    confirmed: confirmed && improving,
    label: confirmed && improving ? "5m close confirmed" : "Wait for 5m close",
    reason: direction === "CALL"
      ? `Need a 5m candle close above ${round(trigger)}. Latest 5m close ${round(latest5.close)}.`
      : `Need a 5m candle close below ${round(trigger)}. Latest 5m close ${round(latest5.close)}.`,
  };
}

function retestQuality(rows, direction, trigger, vwapNow, atrValue) {
  const recent = rows.slice(-6);
  if (!recent.length || !Number.isFinite(trigger)) return { passed: false, label: "No retest proof", reason: "Need pullback/retest evidence." };
  const tolerance = Math.max((atrValue ?? 0) * 0.25, trigger * 0.0015);
  const touchedTrigger = recent.some((row) => direction === "CALL"
    ? row.low <= trigger + tolerance && row.close >= trigger - tolerance
    : row.high >= trigger - tolerance && row.close <= trigger + tolerance);
  const heldVwap = direction === "CALL"
    ? recent.every((row) => row.close >= vwapNow * 0.998)
    : recent.every((row) => row.close <= vwapNow * 1.002);
  const notChasing = Math.abs((last(rows).close / vwapNow - 1) * 100) <= 1.2;
  const passed = (touchedTrigger || heldVwap) && notChasing;
  return {
    passed,
    label: passed ? "Retest acceptable" : "Avoid chase",
    reason: passed
      ? "Price has either retested the trigger/VWAP area or is not too stretched from VWAP."
      : "Price is stretched or has not shown a clean retest/hold yet.",
  };
}

function marketConfirmation(direction, qqqRows, spyRows) {
  const qqq = timeframeTrend(qqqRows, direction);
  const spy = timeframeTrend(spyRows, direction);
  const confirmed = qqq.aligned && spy.aligned;
  return {
    confirmed,
    label: confirmed ? "SPY + QQQ agree" : "Market not aligned",
    reason: `SPY: ${spy.label}. QQQ: ${qqq.label}.`,
    spy,
    qqq,
  };
}

function vwap(rows) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return rows.map((row) => {
    const typical = (row.high + row.low + row.close) / 3;
    cumulativePriceVolume += typical * row.volume;
    cumulativeVolume += row.volume;
    return cumulativeVolume ? cumulativePriceVolume / cumulativeVolume : null;
  });
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((total, value) => total + value, 0) / clean.length;
}

function latestSessionRows(rows) {
  const latest = last(rows);
  if (!latest) return [];
  const latestDate = latest.datetime.slice(0, 10);
  return rows.filter((row) => row.datetime.slice(0, 10) === latestDate);
}

function sessionContextRows(rows) {
  const latest = last(rows);
  if (!latest) return { current: [], previous: [] };
  const dates = [...new Set(rows.map((row) => row.datetime.slice(0, 10)))];
  const latestDate = latest.datetime.slice(0, 10);
  const previousDate = dates.filter((date) => date < latestDate).at(-1);
  return {
    current: rows.filter((row) => row.datetime.slice(0, 10) === latestDate),
    previous: previousDate ? rows.filter((row) => row.datetime.slice(0, 10) === previousDate) : [],
  };
}

function sessionLevels(rows) {
  if (!rows?.length) return { high: null, low: null, close: null };
  return {
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    close: last(rows)?.close ?? null,
  };
}

function openingRange(rows, candles = 2) {
  const window = rows.slice(0, Math.min(candles, rows.length));
  return {
    high: Math.max(...window.map((row) => row.high)),
    low: Math.min(...window.map((row) => row.low)),
  };
}

function daysToExpiration(expiration) {
  return Math.round((expiration * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
}

function midPrice(contract) {
  if (Number.isFinite(contract.bid) && Number.isFinite(contract.ask) && contract.bid > 0 && contract.ask > 0) {
    return (contract.bid + contract.ask) / 2;
  }
  return Number.isFinite(contract.lastPrice) ? contract.lastPrice : null;
}

function spreadPct(contract) {
  const mid = midPrice(contract);
  if (!mid || !Number.isFinite(contract.bid) || !Number.isFinite(contract.ask)) return null;
  return (contract.ask - contract.bid) / mid;
}

function chooseIntradayExpiration(expirations) {
  return expirations
    .map((expiration) => ({ expiration, dte: daysToExpiration(expiration) }))
    .filter(({ dte }) => dte >= 1 && dte <= 14)
    .sort((a, b) => a.dte - b.dte)[0] ?? null;
}

function chooseIntradayContract(contracts, underlying) {
  return contracts
    .map((contract) => ({
      contract,
      mid: midPrice(contract),
      spreadPct: spreadPct(contract),
      distance: Math.abs(contract.strike - underlying),
    }))
    .filter(({ mid }) => Number.isFinite(mid) && mid >= 0.25)
    .filter(({ spreadPct: spread }) => Number.isFinite(spread) && spread <= 0.25)
    .filter(({ contract }) => (contract.openInterest ?? 0) >= 50 || (contract.volume ?? 0) >= 20)
    .sort((a, b) => a.distance - b.distance || (b.contract.volume ?? 0) - (a.contract.volume ?? 0))[0]
    ?.contract ?? null;
}

function scoreOptionContract(contract, { underlying, direction, expirationMeta }) {
  const mid = midPrice(contract);
  const spread = spreadPct(contract);
  const volume = contract.volume ?? 0;
  const openInterest = contract.openInterest ?? 0;
  const moneynessPct = underlying ? ((contract.strike / underlying) - 1) * 100 : null;
  const absMoneyness = Math.abs(moneynessPct ?? 999);
  let score = 0;
  const positives = [];
  const risks = [];

  if (Number.isFinite(mid) && mid >= 0.35 && mid <= 8) { score += 18; positives.push("premium is day-tradable"); }
  else if (Number.isFinite(mid) && mid > 8) { score += 8; risks.push("contract is expensive; size carefully"); }
  else risks.push("premium may be too cheap/unstable");

  if (Number.isFinite(spread) && spread <= 0.1) { score += 25; positives.push("bid/ask spread is tight"); }
  else if (Number.isFinite(spread) && spread <= 0.18) { score += 17; positives.push("bid/ask spread is acceptable"); }
  else risks.push("spread is wide; fills can hurt");

  if (volume >= 500) { score += 20; positives.push("same-day option volume is strong"); }
  else if (volume >= 100) { score += 14; positives.push("same-day option volume is usable"); }
  else if (volume >= 20) { score += 7; risks.push("volume is light"); }
  else risks.push("very low option volume");

  if (openInterest >= 1000) { score += 17; positives.push("open interest is deep"); }
  else if (openInterest >= 250) { score += 12; positives.push("open interest is usable"); }
  else if (openInterest >= 50) { score += 6; risks.push("open interest is thin"); }
  else risks.push("open interest is very thin");

  if (absMoneyness <= 2.5) { score += 12; positives.push("strike is near the money"); }
  else if (absMoneyness <= 5) { score += 6; positives.push("strike is close enough to the money"); }
  else risks.push("strike is far from the stock price");

  if (expirationMeta.dte >= 2 && expirationMeta.dte <= 10) { score += 8; positives.push("DTE fits an intraday/short swing option"); }
  else risks.push("expiry timing is not ideal");

  const grade = score >= 85 ? "A" : score >= 72 ? "B" : score >= 58 ? "C" : "D";
  const action =
    grade === "A"
      ? "Contract acceptable with limit order."
      : grade === "B"
        ? "Usable, but only with limit order and smaller size."
        : grade === "C"
          ? "Weak contract. Prefer a better strike/expiry if available."
          : "Avoid this contract; liquidity/spread is not good enough.";
  const label = `${new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10)} ${contract.strike} ${direction.toLowerCase()}`;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    grade,
    action,
    label,
    mid,
    spread,
    volume,
    openInterest,
    moneynessPct,
    positives,
    risks,
  };
}

function timeframeTrend(rows, direction) {
  if (rows.length < 8) return { label: "No confirmation", aligned: false, reason: "not enough higher-timeframe candles" };
  const closes = rows.map((row) => row.close);
  const ema9Values = ema(closes, 9);
  const ema21Values = ema(closes, 21);
  const latest = last(rows);
  const index = rows.length - 1;
  const bullish = latest.close > ema9Values[index] && ema9Values[index] >= ema21Values[index];
  const bearish = latest.close < ema9Values[index] && ema9Values[index] <= ema21Values[index];
  const aligned = direction === "CALL" ? bullish : bearish;
  return {
    label: aligned ? "Aligned" : bullish ? "Bullish opposite" : bearish ? "Bearish opposite" : "Mixed",
    aligned,
    reason: `close ${round(latest.close)} / EMA9 ${round(ema9Values[index])} / EMA21 ${round(ema21Values[index])}`,
  };
}

function vwapCrosses(rows, vwapValues, lookback = 10) {
  const start = Math.max(1, rows.length - lookback);
  let crosses = 0;
  for (let index = start; index < rows.length; index += 1) {
    const prevAbove = rows[index - 1].close > vwapValues[index - 1];
    const nowAbove = rows[index].close > vwapValues[index];
    if (prevAbove !== nowAbove) crosses += 1;
  }
  return crosses;
}

function sessionPhase(rows) {
  if (rows.length <= 2) return "Opening range";
  if (rows.length <= 8) return "Morning trend window";
  if (rows.length <= 20) return "Midday discipline";
  return "Late-day / power-hour window";
}

function parseCsvLine(line) {
  const columns = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      columns.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  columns.push(value);
  return columns;
}

function readEventCalendar(filePath = EVENT_CALENDAR_PATH) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return lines.filter(Boolean).map((line) => {
    const columns = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""]));
  });
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDaysKey(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return dateKey(next);
}

function rawYahoo(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  return value;
}

function recentNews(items, now = new Date(), hours = 36) {
  const cutoff = now.getTime() - hours * 60 * 60 * 1000;
  return items.filter((item) => {
    const published = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
    return Number.isFinite(published) && published >= cutoff;
  });
}

function macroNewsImpact(item) {
  const title = String(item.title ?? "").toLowerCase();
  const scheduledMacro = /\b(cpi|ppi|pce|fomc|fed decision|rate decision|jobs report|nonfarm|payrolls?)\b/.test(title);
  const releaseContext = /\b(today|tomorrow|due|release|released|report|data|decision|meeting|speech|testimony|hotter|cooler|beats|misses|comes in|unexpected)\b/.test(title);
  const geopoliticalShock = /\b(war|geopolitical|missile|invasion|attack|escalation)\b/.test(title);
  const highPatterns = [/\btariffs?\b/];
  const mediumPatterns = [/\bcpi\b/, /\binflation\b/, /\bfed\b/, /\bpowell\b/, /\brates\b/, /\btreasury yields\b/, /\boil prices\b/, /\brecession\b/];
  if ((scheduledMacro && releaseContext) || geopoliticalShock || highPatterns.some((pattern) => pattern.test(title))) return "high";
  if (mediumPatterns.some((pattern) => pattern.test(title))) return "medium";
  return null;
}

function earningsDatesFromSummary(summary) {
  const rawDates = summary?.calendarEvents?.earnings?.earningsDate ?? [];
  return rawDates
    .map((item) => rawYahoo(item))
    .filter((value) => Number.isFinite(value))
    .map((seconds) => new Date(seconds * 1000).toISOString().slice(0, 10));
}

async function buildEarningsEvents(universe, now = new Date()) {
  const today = dateKey(now);
  const tomorrow = addDaysKey(now, 1);
  const records = universe.filter((record) => record.type !== "Index ETF");
  const checks = await Promise.allSettled(records.map(async (record) => {
    const summary = await fetchQuoteSummary(record.symbol, ["calendarEvents", "price"]);
    const dates = earningsDatesFromSummary(summary);
    const match = dates.find((date) => date === today || date === tomorrow);
    if (!match) return null;
    const when = match === today ? "today" : "tomorrow";
    return {
      symbol: record.symbol,
      event: `${record.symbol} earnings ${when}`,
      date: match,
      impact: match === today ? "medium" : "medium",
      source: "Yahoo calendarEvents",
    };
  }));
  return checks
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
}

async function buildMacroNewsEvents(now = new Date()) {
  const queries = [
    "stock market Fed CPI jobs report today",
    "stock market major economic events today",
    "Nasdaq market moving news today",
  ];
  const settled = await Promise.allSettled(queries.map((query) => fetchYahooSearchNews(query, 8)));
  const seen = new Set();
  const items = settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .filter((item) => {
      const key = `${item.title}|${item.publishedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return recentNews(items, now)
    .map((item) => ({ ...item, impact: macroNewsImpact(item) }))
    .filter((item) => item.impact)
    .slice(0, 8)
    .map((item) => ({
      symbol: "ALL",
      event: item.title,
      date: item.publishedAt?.slice(0, 10) ?? dateKey(now),
      impact: item.impact,
      source: item.publisher ? `Yahoo news / ${item.publisher}` : "Yahoo news",
      link: item.link,
    }));
}

function combineEventPolicy({ calendarEvents = [], macroNewsEvents = [], earningsEvents = [], now = new Date() }) {
  const events = readEventCalendar();
  const today = dateKey(now);
  const tomorrow = addDaysKey(now, 1);
  const datedEvents = [...events, ...calendarEvents, ...macroNewsEvents].filter((event) => event.date);
  const manualReminders = events.filter((event) => !event.date).slice(0, 8);
  const todayEvents = datedEvents.filter((event) => event.date === today);
  const highToday = todayEvents.filter((event) => event.impact === "high");
  const mediumToday = todayEvents.filter((event) => event.impact === "medium");
  const highTomorrow = datedEvents.filter((event) => event.date === tomorrow && event.impact === "high");
  const earningsToday = earningsEvents.filter((event) => event.date === today);
  const earningsTomorrow = earningsEvents.filter((event) => event.date === tomorrow);

  if (highToday.length) {
    return {
      mode: "auto",
      level: "HIGH",
      tradeAllowed: false,
      headline: `No-trade event day: ${highToday.map((event) => event.event).slice(0, 3).join("; ")}`,
      rule: "Major macro/news risk is active today. Build the watchlist, but do not take new intraday trades unless you intentionally override outside this system after the market digests it.",
      events: [...highToday, ...mediumToday, ...earningsToday],
      manualReminders,
      earningsEvents,
      macroNewsEvents,
    };
  }
  if (mediumToday.length || highTomorrow.length || earningsToday.length || earningsTomorrow.length) {
    const names = [...mediumToday, ...highTomorrow, ...earningsToday, ...earningsTomorrow].map((event) => event.event).slice(0, 5).join("; ");
    return {
      mode: "auto",
      level: "MEDIUM",
      tradeAllowed: true,
      headline: `Caution event day: ${names}`,
      rule: "Trade smaller and demand cleaner confirmation. Symbols with earnings today/tomorrow need extra broker/news confirmation before entry.",
      events: [...mediumToday, ...highTomorrow, ...earningsToday, ...earningsTomorrow],
      manualReminders,
      earningsEvents,
      macroNewsEvents,
    };
  }
  return {
    mode: "auto",
    level: "NORMAL",
    tradeAllowed: true,
    headline: "No major macro or earnings event found",
    rule: "Trade the chart, still verify live headlines and broker liquidity before entry.",
    events: [],
    manualReminders,
    earningsEvents,
    macroNewsEvents,
  };
}

async function buildAutomaticEventRiskPolicy(universe, now = new Date()) {
  try {
    const [macroNewsEvents, earningsEvents] = await Promise.all([
      buildMacroNewsEvents(now),
      buildEarningsEvents(universe, now),
    ]);
    return combineEventPolicy({ macroNewsEvents, earningsEvents, now });
  } catch (error) {
    return {
      mode: "auto",
      level: "MEDIUM",
      tradeAllowed: true,
      headline: "Event scan incomplete - trade with caution",
      rule: `Could not complete live macro/earnings event scan: ${error.message}. Reduce size and manually verify headlines before entry.`,
      events: [],
      earningsEvents: [],
      macroNewsEvents: [],
      error: error.message,
    };
  }
}

function symbolEventRisk(symbol, eventPolicy) {
  const earnings = eventPolicy.earningsEvents?.filter((event) => event.symbol === symbol) ?? [];
  if (!earnings.length) return null;
  return {
    level: "MEDIUM",
    headline: earnings.map((event) => event.event).join("; "),
    rule: "Earnings risk: only trade if the intraday trend is clean, size smaller, and confirm live news/broker liquidity first.",
  };
}

function qualityLabel(score) {
  if (score >= 92) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  return "D";
}

function executionGrade({
  signal,
  confidenceRating,
  rewardRisk,
  mtfAligned,
  volumeRatio,
  chopRisk,
  vwapSlopePct,
  eventLevel,
  marketCheck,
  candleCheck,
  retestCheck,
  timeCheck,
}) {
  const blockers = [];
  const cautions = [];
  if (eventLevel === "HIGH") blockers.push("major event risk");
  if (timeCheck?.blocked) blockers.push(timeCheck.label);
  if (chopRisk === "HIGH") blockers.push("VWAP chop");
  if (!["CALL_TRIGGER", "PUT_TRIGGER"].includes(signal)) blockers.push("not a live trigger");
  if (!Number.isFinite(rewardRisk) || rewardRisk < 1.5) blockers.push("reward/risk below 1.5");
  if (mtfAligned < 1) blockers.push("no timeframe confirmation");
  if (!marketCheck?.confirmed) cautions.push("SPY/QQQ not both aligned");
  if (!candleCheck?.confirmed) cautions.push("5m candle not fully confirmed");
  if (!retestCheck?.passed) cautions.push("entry is not a clean retest");
  if (volumeRatio < 0.75) cautions.push("volume is light");
  if (Math.abs(vwapSlopePct ?? 0) < 0.006) cautions.push("VWAP is fairly flat");

  if (blockers.length) {
    if (signal.startsWith("WATCH")) {
      return {
        executable: false,
        label: confidenceRating >= 68 ? "B WATCH" : "C WATCH",
        grade: confidenceRating >= 68 ? "B" : "C",
        reason: blockers.join("; "),
      };
    }
    return {
      executable: false,
      label: confidenceRating >= 75 ? "B WATCH" : "PASS",
      grade: confidenceRating >= 75 ? "B" : "D",
      reason: blockers.join("; "),
    };
  }
  const cautionText = cautions.length ? ` Caution: ${cautions.join("; ")}.` : "";
  if (confidenceRating >= MIN_A_PLUS_CONFIDENCE && rewardRisk >= 2 && volumeRatio >= 1.05 && marketCheck?.confirmed && candleCheck?.confirmed) {
    return { executable: true, label: "A+ TRADE", grade: "A+", reason: `best-grade VWAP trend setup.${cautionText}` };
  }
  if (confidenceRating >= MIN_A_CONFIDENCE && rewardRisk >= 1.5) {
    return { executable: false, label: "STRONG WATCH", grade: "A", reason: `good idea, but wait for A+ confirmation before spending a trade slot.${cautionText}` };
  }
  if (confidenceRating >= MIN_STARTER_CONFIDENCE && rewardRisk >= 1.1 && volumeRatio >= 0.75) {
    return { executable: false, label: "WATCH FOR TRIGGER", grade: "B", reason: `real but not A+ yet; wait for a cleaner 5-minute trigger.${cautionText}` };
  }
  return { executable: false, label: "B WATCH", grade: "B", reason: "good idea, but not worth spending a trade slot yet" };
}

function nearLevel(price, levels, atrValue) {
  const tolerance = Math.max((atrValue ?? 0) * 0.55, price * 0.0025);
  return levels
    .filter((level) => Number.isFinite(level.value))
    .map((level) => ({ ...level, distance: Math.abs(price - level.value) }))
    .filter((level) => level.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function classifySetup({ direction, latest, previous, vwapNow, range, previousLevels, ema20Now, ema50Now, currentAtr }) {
  const reclaimVwap = direction === "CALL" && previous?.close <= vwapNow && latest.close > vwapNow;
  const rejectVwap = direction === "PUT" && previous?.close >= vwapNow && latest.close < vwapNow;
  const brokePreviousHigh = direction === "CALL" && Number.isFinite(previousLevels.high) && latest.close > previousLevels.high;
  const brokePreviousLow = direction === "PUT" && Number.isFinite(previousLevels.low) && latest.close < previousLevels.low;
  const heldPullback =
    direction === "CALL"
      ? latest.low <= Math.max(vwapNow, ema20Now ?? vwapNow) + currentAtr * 0.25 && latest.close > Math.max(vwapNow, ema20Now ?? vwapNow)
      : latest.high >= Math.min(vwapNow, ema20Now ?? vwapNow) - currentAtr * 0.25 && latest.close < Math.min(vwapNow, ema20Now ?? vwapNow);
  const failedBreakout =
    direction === "PUT"
      ? Number.isFinite(previousLevels.high) && previous?.high > previousLevels.high && latest.close < previousLevels.high
      : Number.isFinite(previousLevels.low) && previous?.low < previousLevels.low && latest.close > previousLevels.low;

  if (reclaimVwap || rejectVwap) return direction === "CALL" ? "VWAP reclaim" : "VWAP rejection";
  if (brokePreviousHigh || brokePreviousLow || latest.close > range.high || latest.close < range.low) return "Breakout / retest";
  if (heldPullback) return "VWAP/EMA pullback continuation";
  if (failedBreakout) return "Failed breakout reversal";
  if (Number.isFinite(ema50Now) && (direction === "CALL" ? latest.close > ema50Now : latest.close < ema50Now)) return "Trend continuation";
  return "No clean setup";
}

function decisionScoreModel({
  direction,
  latest,
  vwapNow,
  aboveVwap,
  belowVwap,
  ema9Now,
  ema20Now,
  ema50Now,
  ema200Now,
  rsiNow,
  macdNow,
  volumeRatio,
  rewardRisk,
  mtfAligned,
  marketCheck,
  keyLevel,
  currentAtr,
}) {
  const long = direction === "CALL";
  const emaTrend =
    long
      ? latest.close > (ema20Now ?? -Infinity) && latest.close > (ema50Now ?? -Infinity) && (!Number.isFinite(ema200Now) || ema50Now >= ema200Now)
      : latest.close < (ema20Now ?? Infinity) && latest.close < (ema50Now ?? Infinity) && (!Number.isFinite(ema200Now) || ema50Now <= ema200Now);
  const momentum =
    long
      ? Number.isFinite(rsiNow) && rsiNow >= 50 && macdNow?.histogram > 0
      : Number.isFinite(rsiNow) && rsiNow <= 50 && macdNow?.histogram < 0;
  const atrOk = Number.isFinite(currentAtr) && currentAtr > 0 && Math.abs(latest.close - vwapNow) <= currentAtr * 5;
  const parts = [
    { name: "Higher timeframe direction agrees", max: 15, score: Math.min(15, mtfAligned * 5 + (marketCheck?.confirmed ? 5 : 0)) },
    { name: "Price is cleanly above/below VWAP", max: 15, score: (long && aboveVwap) || (!long && belowVwap) ? 15 : 0 },
    { name: "Key level nearby", max: 15, score: keyLevel ? 15 : 6 },
    { name: "EMA trend agrees", max: 10, score: emaTrend ? 10 : (long ? latest.close > ema9Now : latest.close < ema9Now) ? 5 : 0 },
    { name: "RSI/MACD momentum agrees", max: 10, score: momentum ? 10 : 4 },
    { name: "Volume confirms", max: 15, score: volumeRatio >= 1.3 ? 15 : volumeRatio >= 1 ? 10 : volumeRatio >= 0.75 ? 6 : 0 },
    { name: "ATR allows proper stop", max: 10, score: atrOk ? 10 : 4 },
    { name: "Reward-to-risk at least 1.5:1", max: 10, score: rewardRisk >= 1.5 ? 10 : rewardRisk >= 1.2 ? 6 : rewardRisk >= 1 ? 3 : 0 },
  ];
  return {
    score: parts.reduce((total, part) => total + part.score, 0),
    parts,
    passed: parts.filter((part) => part.score >= part.max * 0.65).length,
    summary: parts.map((part) => `${part.name}: ${part.score}/${part.max}`).join("; "),
  };
}

function confidenceRating({ score, rewardRisk, volumeRatio, rangePosition, isLong, signal, mtfAligned = 0, chopRisk = "LOW" }) {
  let confidence = score;
  const notes = [];

  if (Number.isFinite(rewardRisk) && rewardRisk >= 1.5) {
    confidence += 6;
    notes.push("reward/risk is healthy");
  } else if (Number.isFinite(rewardRisk) && rewardRisk < 1) {
    confidence -= 12;
    notes.push("reward/risk is thin");
  }

  if (volumeRatio >= 1.3) {
    confidence += 5;
    notes.push("volume confirms move");
  } else if (volumeRatio < 0.7) {
    confidence -= 5;
    notes.push("volume confirmation is weak");
  }

  if (isLong && rangePosition >= 70) {
    confidence += 4;
    notes.push("price is pressing the upper range");
  } else if (!isLong && rangePosition <= 30) {
    confidence += 4;
    notes.push("price is pressing the lower range");
  }

  if (signal === "NO_TRADE") {
    confidence = Math.min(confidence, 55);
    notes.push("no executable trigger yet");
  }
  if (signal.startsWith("WATCH")) {
    confidence = Math.min(confidence, 72);
    notes.push("watch only until trigger confirms");
  }
  if (mtfAligned >= 2) {
    confidence += 8;
    notes.push("5m, 15m, and 30m align");
  } else if (mtfAligned === 1) {
    confidence += 3;
    notes.push("one higher timeframe confirms");
  } else {
    confidence -= 8;
    notes.push("higher timeframes do not confirm");
  }
  if (chopRisk === "HIGH") {
    confidence -= 12;
    notes.push("VWAP chop risk is high");
  } else if (chopRisk === "MEDIUM") {
    confidence -= 5;
    notes.push("some chop risk");
  }

  if (signal === "NO_TRADE") confidence = Math.min(confidence, 55);
  if (signal.startsWith("WATCH")) confidence = Math.min(confidence, 72);

  const rating = Math.max(0, Math.min(100, Math.round(confidence)));
  return {
    rating,
    grade: qualityLabel(rating),
    notes,
  };
}

function optionTicket({ direction, latest, trigger, stop, target, signal, confidenceRating }) {
  const premiumStyle =
    confidenceRating >= 80
      ? "Buy the nearest weekly option with a strike close to the stock price"
      : "Do not chase expensive contracts; wait for a cleaner trigger or use very small size";
  const strikeHint =
    direction === "CALL"
      ? `Look at an at-the-money or slightly out-of-the-money call near ${round(latest.close)}-${round(trigger)}.`
      : `Look at an at-the-money or slightly out-of-the-money put near ${round(latest.close)}-${round(trigger)}.`;
  const optionSide = direction === "CALL" ? "BUY CALL" : "BUY PUT";
  const skip =
    signal.startsWith("NO_TRADE")
      ? "Skip. No clean option trade right now."
      : signal.startsWith("WATCH")
        ? `Watch only. Do not buy yet unless price confirms through ${round(trigger)}.`
        : `Only take it if price is still holding the trigger around ${round(trigger)}.`;
  return {
    optionSide,
    strikeHint,
    contractHint: premiumStyle,
    stockEntryTrigger: round(trigger),
    stockStop: round(stop),
    stockTarget: round(target),
    targetPlan:
      direction === "CALL"
        ? `For calls, sell into strength as the stock approaches ${round(target)}.`
        : `For puts, sell into weakness as the stock approaches ${round(target)}.`,
    stopPlan:
      direction === "CALL"
        ? `For calls, exit if stock loses ${round(stop)}.`
        : `For puts, exit if stock reclaims ${round(stop)}.`,
    skipRule: skip,
  };
}

async function enrichOptionContract(row) {
  if (!["CALL_TRIGGER", "PUT_TRIGGER", "WATCH_CALL", "WATCH_PUT"].includes(row.signal)) return row;
  try {
    const expirations = await fetchOptionExpirations(row.symbol);
    const expirationMeta = chooseIntradayExpiration(expirations);
    if (!expirationMeta) {
      return { ...row, optionQuality: "No weekly expiry found", contractDecision: "Use stock levels only; no contract approved." };
    }
    const chain = await fetchOptionChain(row.symbol, expirationMeta.expiration);
    const contracts = row.direction === "CALL" ? chain?.calls ?? [] : chain?.puts ?? [];
    const contract = chooseIntradayContract(contracts, chain?.underlyingPrice ?? row.close);
    if (!contract) {
      return { ...row, optionQuality: "No liquid contract", contractDecision: "Skip the option unless your broker shows a tight liquid contract." };
    }
    const contractScore = scoreOptionContract(contract, {
      underlying: chain?.underlyingPrice ?? row.close,
      direction: row.direction,
      expirationMeta,
    });
    const mid = midPrice(contract);
    const spread = spreadPct(contract);
    const quality =
      spread <= 0.12 && ((contract.volume ?? 0) >= 100 || (contract.openInterest ?? 0) >= 250)
        ? "Good"
        : spread <= 0.2
          ? "Acceptable"
          : "Poor";
    const contractDecision =
      quality === "Good"
        ? "Contract looks liquid enough for a day-trade attempt."
        : quality === "Acceptable"
          ? "Contract is usable only with limit orders and small size."
          : "Avoid this contract; spread/liquidity is not good enough.";
    return {
      ...row,
      optionExpiration: new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10),
      optionDte: expirationMeta.dte,
      optionContract: contract.contractSymbol,
      optionStrike: contract.strike,
      optionBid: round(contract.bid),
      optionAsk: round(contract.ask),
      optionMid: round(mid),
      optionEstimatedCost: round(mid * 100, 0),
      optionSpreadPct: round(spread * 100, 1),
      optionVolume: contract.volume ?? 0,
      optionOpenInterest: contract.openInterest ?? 0,
      optionMoneynessPct: round(contractScore.moneynessPct, 2),
      optionContractScore: contractScore.score,
      optionContractGrade: contractScore.grade,
      optionContractLabel: contractScore.label,
      optionContractPositives: contractScore.positives,
      optionContractRisks: contractScore.risks,
      optionQuality: `${quality} / ${contractScore.grade}`,
      contractDecision: `${contractScore.action} ${contractDecision}`,
      contractHint: `${row.optionSide} ${contract.strike} ${row.direction.toLowerCase()} exp ${new Date(expirationMeta.expiration * 1000).toISOString().slice(0, 10)} near ${round(mid)} mid. Cost about $${round(mid * 100, 0)} per contract.`,
      contractWhy: [
        `DTE ${expirationMeta.dte}`,
        `strike ${contract.strike} is ${round(contractScore.moneynessPct, 1)}% from stock`,
        `mid ${round(mid)}`,
        `spread ${round(spread * 100, 1)}%`,
        `volume ${contract.volume ?? 0}`,
        `OI ${contract.openInterest ?? 0}`,
      ].join("; "),
    };
  } catch (error) {
    return { ...row, optionQuality: "Contract check failed", contractDecision: error.message };
  }
}

function scoreIntradaySymbol(record, rows, context = {}) {
  const benchmarkRows = context.benchmarkRows ?? [];
  const symbol = record.symbol;
  if (rows.length < 2) {
    const needed = 2 - rows.length;
    const reason = `Only ${rows.length} intraday candle${rows.length === 1 ? "" : "s"} so far; need ${needed} more completed 15-minute candle${needed === 1 ? "" : "s"} before the opening range is usable.`;
    return {
      symbol,
      name: record.name,
      group: record.group,
      signal: "NO_DATA",
      setupSignal: "NO_DATA",
      decisionCode: "NO_TRADE",
      signalTier: "No Trade",
      confidenceScore: 0,
      confidenceRating: 0,
      riskScore: 100,
      tradeGrade: "D",
      tradeCardDirection: "Long / Short",
      bias: "Neutral",
      tradeStatus: "Do Not Trade",
      action: "No trade",
      tradeDecision: "No trade. Opening range is still forming.",
      tradeSlotApproved: false,
      setupType: "Opening range pending",
      whyTradeExists: reason,
      noTradeReason: reason,
      triggerNeeded: "Wait for at least two completed 15-minute candles, then require a 5-minute confirmation trigger.",
      invalidationReason: "No trade thesis exists until the opening range is formed.",
      entryZone: "Wait for opening range",
      stopLoss: null,
      target1: null,
      target2: null,
      riskReward: null,
      maxLossIfWrong: "No position",
      reason,
      score: 0,
      sessionPhase: sessionPhase(rows),
      sessionPhaseLive: context.sessionPolicy?.phase,
      sessionStatus: context.sessionPolicy?.label,
      sessionRule: context.sessionPolicy?.reason,
      eventRiskLevel: context.eventPolicy?.level,
      eventRiskHeadline: context.eventPolicy?.headline,
      eventRiskRule: context.eventPolicy?.rule,
    };
  }

  const closes = rows.map((row) => row.close);
  const indicatorRows = context.indicatorRows?.length ? context.indicatorRows : rows;
  const indicatorCloses = indicatorRows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const benchmarkCloses = benchmarkRows.map((row) => row.close);
  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const ema21 = ema(closes, 21);
  const historyEma50 = ema(indicatorCloses, 50);
  const historyEma200 = indicatorCloses.length >= 80 ? ema(indicatorCloses, 200) : [];
  const rsi14 = rsi(closes, 14);
  const macdValues = macd(closes);
  const atr14 = atr(rows, 14);
  const dmi14 = dmi(rows, 14);
  const stoch14 = stochastic(rows, 14);
  const vwapValues = vwap(rows);
  const range = openingRange(rows, 2);
  const latest = last(rows);
  const previous = rows[rows.length - 2];
  const index = rows.length - 1;
  const avgVolume = average(volumes.slice(Math.max(0, volumes.length - 20)));
  const sessionOpen = rows[0].open;
  const sessionHigh = Math.max(...rows.map((row) => row.high));
  const sessionLow = Math.min(...rows.map((row) => row.low));
  const benchmarkLatest = last(benchmarkRows);
  const benchmarkFirst = benchmarkRows[0];
  const dayReturn = sessionOpen ? latest.close / sessionOpen - 1 : 0;
  const benchmarkReturn = benchmarkLatest && benchmarkFirst ? benchmarkLatest.close / benchmarkFirst.open - 1 : 0;
  const relativeStrength = dayReturn - benchmarkReturn;
  const vwapNow = vwapValues[index];
  const vwapLookbackIndex = Math.max(0, index - 3);
  const vwapSlopePct = Number.isFinite(vwapValues[vwapLookbackIndex]) && vwapValues[vwapLookbackIndex] !== 0
    ? (vwapNow / vwapValues[vwapLookbackIndex] - 1) * 100
    : 0;
  const aboveVwap = latest.close > vwapNow;
  const belowVwap = latest.close < vwapNow;
  const emaBull = ema9[index] > ema21[index] && latest.close > ema9[index];
  const emaBear = ema9[index] < ema21[index] && latest.close < ema9[index];
  const ema20Now = ema20[index];
  const ema50Now = last(historyEma50);
  const ema200Now = last(historyEma200);
  const macdNow = macdValues[index];
  const macdPrev = macdValues[index - 1];
  const adxNow = dmi14.adx[index];
  const plusDiNow = dmi14.plusDi[index];
  const minusDiNow = dmi14.minusDi[index];
  const stochNow = stoch14[index];
  const volumeRatio = avgVolume ? latest.volume / avgVolume : 1;
  const tradeVolumeRatio = volumeRatio > 0 ? volumeRatio : 1;
  const crosses = vwapCrosses(rows, vwapValues);
  const emaCompressionPct = Math.abs(ema9[index] - ema21[index]) / latest.close;
  const chopRisk = crosses >= 3 || emaCompressionPct < 0.0008 ? "HIGH" : crosses >= 2 ? "MEDIUM" : "LOW";
  const brokeOpeningHigh = latest.close > range.high && previous.close <= range.high;
  const brokeOpeningLow = latest.close < range.low && previous.close >= range.low;
  const nearHigh = sessionHigh ? (sessionHigh - latest.close) / latest.close < 0.003 : false;
  const nearLow = sessionLow ? (latest.close - sessionLow) / latest.close < 0.003 : false;
  const rangePosition = sessionHigh === sessionLow ? 50 : ((latest.close - sessionLow) / (sessionHigh - sessionLow)) * 100;
  const previousLevels = sessionLevels(context.previousRows ?? []);

  let longScore = 0;
  let shortScore = 0;
  const longReasons = [];
  const shortReasons = [];

  if (aboveVwap) { longScore += 22; longReasons.push("above VWAP"); }
  if (belowVwap) { shortScore += 22; shortReasons.push("below VWAP"); }
  if (vwapSlopePct > 0.02) { longScore += 10; longReasons.push("VWAP is rising"); }
  if (vwapSlopePct < -0.02) { shortScore += 10; shortReasons.push("VWAP is falling"); }
  if (aboveVwap && vwapSlopePct < -0.03) { longScore -= 10; longReasons.push("VWAP slope disagrees"); }
  if (belowVwap && vwapSlopePct > 0.03) { shortScore -= 10; shortReasons.push("VWAP slope disagrees"); }
  if (emaBull) { longScore += 20; longReasons.push("EMA 9 over EMA 21"); }
  if (emaBear) { shortScore += 20; shortReasons.push("EMA 9 under EMA 21"); }
  if (macdNow.histogram > 0 && macdNow.histogram > macdPrev.histogram) { longScore += 15; longReasons.push("MACD improving"); }
  if (macdNow.histogram < 0 && macdNow.histogram < macdPrev.histogram) { shortScore += 15; shortReasons.push("MACD weakening"); }
  if (Number.isFinite(rsi14[index]) && rsi14[index] >= 52 && rsi14[index] <= 72) { longScore += 15; longReasons.push("RSI bullish but not too hot"); }
  if (Number.isFinite(rsi14[index]) && rsi14[index] <= 48 && rsi14[index] >= 28) { shortScore += 15; shortReasons.push("RSI bearish but not too stretched"); }
  if (Number.isFinite(adxNow) && adxNow >= 18 && plusDiNow > minusDiNow) { longScore += 10; longReasons.push("ADX/DMI confirms bullish trend strength"); }
  if (Number.isFinite(adxNow) && adxNow >= 18 && minusDiNow > plusDiNow) { shortScore += 10; shortReasons.push("ADX/DMI confirms bearish trend strength"); }
  if (Number.isFinite(stochNow) && stochNow >= 35 && stochNow <= 85) { longScore += 4; longReasons.push("stochastic supports continuation"); }
  if (Number.isFinite(stochNow) && stochNow <= 65 && stochNow >= 15) { shortScore += 4; shortReasons.push("stochastic supports downside continuation"); }
  if (brokeOpeningHigh || latest.close > range.high) { longScore += 15; longReasons.push("opening range breakout"); }
  if (brokeOpeningLow || latest.close < range.low) { shortScore += 15; shortReasons.push("opening range breakdown"); }
  if (volumeRatio >= 1.3) { longScore += 10; shortScore += 10; longReasons.push("volume expanding"); shortReasons.push("volume expanding"); }
  if (relativeStrength > 0.002) { longScore += 10; longReasons.push("beating QQQ/SPY today"); }
  if (relativeStrength < -0.002) { shortScore += 10; shortReasons.push("lagging QQQ/SPY today"); }
  if (nearHigh) { longScore += 5; longReasons.push("near day high"); }
  if (nearLow) { shortScore += 5; shortReasons.push("near day low"); }
  if (chopRisk === "HIGH") {
    longScore -= 12;
    shortScore -= 12;
    longReasons.push("choppy VWAP tape");
    shortReasons.push("choppy VWAP tape");
  } else if (chopRisk === "MEDIUM") {
    longScore -= 5;
    shortScore -= 5;
  }

  const isLong = longScore >= shortScore;
  const score = Math.max(longScore, shortScore);
  const direction = isLong ? "CALL" : "PUT";
  const tf5 = timeframeTrend(context.rows5 ?? [], direction);
  const tf15 = timeframeTrend(rows, direction);
  const tf30 = timeframeTrend(context.rows30 ?? [], direction);
  const mtfAligned = [tf5, tf15, tf30].filter((timeframe) => timeframe.aligned).length;
  const marketCheck = marketConfirmation(direction, context.qqqRows ?? [], context.spyRows ?? []);
  const timeCheck = noTradeWindow(latest.datetime);
  const sessionPolicy = context.sessionPolicy ?? marketSessionPolicy();
  const freshness = dataFreshness(latest.datetime, context.now ?? new Date());
  const currentAtr = atr14[index] || (latest.high - latest.low);
  const longStop = Math.max(vwapNow, latest.close - currentAtr * 0.8);
  const shortStop = Math.min(vwapNow, latest.close + currentAtr * 0.8);
  const trigger = isLong ? Math.max(latest.close, range.high) : Math.min(latest.close, range.low);
  const stop = isLong ? longStop : shortStop;
  const longTarget = trigger + currentAtr * 1.6;
  const shortTarget = trigger - currentAtr * 1.6;
  const target = isLong ? longTarget : shortTarget;
  const riskPerShare = Math.abs(trigger - stop);
  const rewardPerShare = Math.abs(target - trigger);
  const rewardRisk = riskPerShare ? rewardPerShare / riskPerShare : null;
  const candleCheck = candleConfirmation(context.rows5 ?? [], direction, trigger);
  const retestCheck = retestQuality(rows, direction, trigger, vwapNow, currentAtr);
  const keyLevel = nearLevel(latest.close, [
    { name: "VWAP", value: vwapNow },
    { name: "Opening high", value: range.high },
    { name: "Opening low", value: range.low },
    { name: "Previous day high", value: previousLevels.high },
    { name: "Previous day low", value: previousLevels.low },
    { name: "Previous day close", value: previousLevels.close },
    { name: "20 EMA", value: ema20Now },
    { name: "50 EMA", value: ema50Now },
  ], currentAtr);
  const setupType = classifySetup({ direction, latest, previous, vwapNow, range, previousLevels, ema20Now, ema50Now, currentAtr });
  const checklist = decisionScoreModel({
    direction,
    latest,
    vwapNow,
    aboveVwap,
    belowVwap,
    ema9Now: ema9[index],
    ema20Now,
    ema50Now,
    ema200Now,
    rsiNow: rsi14[index],
    macdNow,
    volumeRatio: tradeVolumeRatio,
    rewardRisk,
    mtfAligned,
    marketCheck,
    keyLevel,
    currentAtr,
  });

  let signal = "NO_TRADE";
  if (score >= 78 && checklist.score >= 75 && mtfAligned >= 1 && isLong && aboveVwap && vwapSlopePct >= -0.01 && tradeVolumeRatio >= 0.75 && chopRisk !== "HIGH") signal = "CALL_TRIGGER";
  else if (score >= 78 && checklist.score >= 75 && mtfAligned >= 1 && !isLong && belowVwap && vwapSlopePct <= 0.01 && tradeVolumeRatio >= 0.75 && chopRisk !== "HIGH") signal = "PUT_TRIGGER";
  else if ((score >= 64 || checklist.score >= 65) && isLong) signal = "WATCH_CALL";
  else if ((score >= 64 || checklist.score >= 65) && !isLong) signal = "WATCH_PUT";
  const setupSignal = signal;

  let quality = confidenceRating({ score: Math.round(score * 0.55 + checklist.score * 0.45), rewardRisk, volumeRatio: tradeVolumeRatio, rangePosition, isLong, signal, mtfAligned, chopRisk });
  const baseEventPolicy = context.eventPolicy ?? { level: "NORMAL", tradeAllowed: true, headline: "Event scan unavailable", rule: "Manually verify headlines before entry." };
  const symbolRisk = symbolEventRisk(symbol, baseEventPolicy);
  const eventPolicy = symbolRisk
    ? {
      ...baseEventPolicy,
      level: baseEventPolicy.level === "HIGH" ? "HIGH" : "MEDIUM",
      headline: `${baseEventPolicy.headline}; ${symbolRisk.headline}`,
      rule: `${baseEventPolicy.rule} ${symbolRisk.rule}`,
      symbolEventRisk: symbolRisk,
    }
    : baseEventPolicy;
  const eventBlocked = eventPolicy.tradeAllowed === false;
  const sessionBlocked = sessionPolicy.tradeAllowed === false;
  const staleBlocked = sessionPolicy.tradeAllowed === true && !freshness.freshForTrading;
  const safetyBlocked = eventBlocked || sessionBlocked || staleBlocked;
  if (safetyBlocked) {
    signal = eventBlocked ? "NO_TRADE_EVENT_RISK" : "NO_TRADE_SESSION";
    quality = {
      rating: Math.min(quality.rating, 45),
      grade: "D",
      notes: [
        eventBlocked ? "major event/news risk overrides the chart" : sessionBlocked ? sessionPolicy.reason : freshness.reason,
        ...quality.notes,
      ],
    };
  }
  const ticket = optionTicket({ direction, latest, trigger, stop, target, signal, confidenceRating: quality.rating });
  const executable = signal === "CALL_TRIGGER" || signal === "PUT_TRIGGER";
  const execution = executionGrade({
    signal,
    setupSignal,
    confidenceRating: quality.rating,
    rewardRisk,
    mtfAligned,
    volumeRatio: tradeVolumeRatio,
    chopRisk,
    vwapSlopePct,
    eventLevel: eventPolicy.level,
    marketCheck,
    candleCheck,
    retestCheck,
    timeCheck,
  });
  const decisionCode =
    safetyBlocked || signal === "NO_TRADE" || signal === "NO_TRADE_EVENT_RISK" || signal === "NO_TRADE_SESSION"
      ? "NO_TRADE"
      : signal.startsWith("WATCH") || !execution.executable
        ? "WAIT"
        : "TRADE_NOW";
  const tradeDecision =
    eventBlocked
      ? "No trade. Major news/event risk overrides the chart."
      : sessionBlocked
        ? `No live trade. ${sessionPolicy.reason}`
        : staleBlocked
          ? `No live trade. ${freshness.reason}`
      : execution.executable
      ? `${execution.label}. Use one daily trade slot only if entry still holds.`
      : executable && quality.rating >= 70
        ? `Wait. ${execution.reason}.`
        : signal.startsWith("WATCH")
          ? "Watch only; wait for trigger confirmation"
          : chopRisk === "HIGH"
            ? "Pass for now; tape is too choppy"
            : "Pass for now";
  const setupQuality =
    quality.grade === "A+"
      ? "Best setup"
      : quality.grade === "A"
      ? "Clean setup"
      : quality.grade === "B"
        ? "Good setup with some caution"
        : quality.grade === "C"
          ? "Developing setup"
          : "Weak or mixed setup";
  const riskQuality =
    rewardRisk >= 1.5
      ? "Good reward/risk"
      : rewardRisk >= 1
        ? "Acceptable reward/risk"
        : "Poor reward/risk; needs better entry";
  const invalidation =
    isLong
      ? `Invalid if price loses ${round(stop)} or fails to hold above VWAP ${round(vwapNow)}.`
      : `Invalid if price reclaims ${round(stop)} or climbs back above VWAP ${round(vwapNow)}.`;
  const action =
    eventBlocked
      ? "No trade. Major news/event risk overrides the chart"
      : sessionBlocked
        ? `No trade. ${sessionPolicy.label}`
        : staleBlocked
          ? "No trade. Latest candle is stale"
      : signal === "CALL_TRIGGER"
      ? "Buy call only if price holds above VWAP and trigger area"
      : signal === "PUT_TRIGGER"
        ? "Buy put only if price stays below VWAP and trigger area"
        : signal === "WATCH_CALL"
          ? "Watch for a stronger call trigger"
          : signal === "WATCH_PUT"
            ? "Watch for a stronger put trigger"
            : "No trade. Trend is not clean enough";
  const confidence = score >= 85 ? "High" : score >= 75 ? "Good" : score >= 65 ? "Starter" : "Low";
  const reasons = isLong ? longReasons : shortReasons;
  const vwapDistancePct = ((latest.close / vwapNow) - 1) * 100;
  const setupConfidenceScore = quality.rating;
  const readinessScore = executionReadinessScore({
    decisionCode,
    setupConfidence: setupConfidenceScore,
    execution,
    marketCheck,
    candleCheck,
    retestCheck,
    eventLevel: eventPolicy.level,
    mtfAligned,
  });
  const signalTier = signalTierFromScore({
    decisionCode,
    confidenceRating: readinessScore,
    rewardRisk,
    execution,
    signal,
  });
  const riskScore = riskScoreFromRow({
    rewardRisk,
    chopRisk,
    eventLevel: eventPolicy.level,
    volumeRatio: tradeVolumeRatio,
    vwapDistancePct,
  });
  const levelCandidates = [
    previousLevels.high,
    previousLevels.low,
    previousLevels.close,
    range.high,
    range.low,
    sessionHigh,
    sessionLow,
    vwapNow,
    ema20Now,
    ema50Now,
  ].filter(Number.isFinite);
  const supportCandidates = levelCandidates.filter((level) => level <= latest.close).sort((a, b) => b - a);
  const resistanceCandidates = levelCandidates.filter((level) => level >= latest.close).sort((a, b) => a - b);
  const keySupport = supportCandidates[0] ?? null;
  const keyResistance = resistanceCandidates[0] ?? null;
  const target2 = isLong ? trigger + currentAtr * 2.4 : trigger - currentAtr * 2.4;
  const deskEntryZone = entryZone(trigger, currentAtr, direction);
  const deskTriggerNeeded = triggerNeeded({ direction, setupType, trigger, vwapNow });
  const deskNoTradeReason = signalTier === "No Trade"
    ? noTradeReasonFor({
      eventBlocked,
      sessionBlocked,
      staleBlocked,
      sessionPolicy,
      freshness,
      chopRisk,
      rewardRisk,
      volumeRatio: tradeVolumeRatio,
      vwapDistancePct,
      marketCheck,
      signal,
      setupType,
    })
    : "";
  const tradeStatus =
    signalTier === "No Trade"
      ? "Do Not Trade"
      : eventPolicy.level === "HIGH" || eventPolicy.level === "MEDIUM" || signalTier === "Watch for Trigger"
        ? "Trade With Caution"
        : "Trade Normally";
  const tradeCardDirection = direction === "CALL" ? "Long" : "Short";
  const bias =
    signalTier === "No Trade"
      ? "Neutral"
      : direction === "CALL"
        ? "Bullish"
        : "Bearish";
  const maxLossPerShare = Number.isFinite(riskPerShare) ? round(riskPerShare) : null;
  const whyTradeExists = `${setupType}. ${reasons.slice(0, 4).join("; ") || "15-minute structure is mixed"}. ${marketCheck.reason}`;
  const longSetupPlan = isLong
    ? `Long only if the 15-minute setup remains above VWAP ${round(vwapNow)} and a 5-minute trigger confirms near ${round(trigger)}.`
    : `No long plan unless price reclaims VWAP ${round(vwapNow)} and builds a higher low on the 15-minute chart.`;
  const shortSetupPlan = !isLong
    ? `Short only if the 15-minute setup remains below VWAP ${round(vwapNow)} and a 5-minute rejection confirms near ${round(trigger)}.`
    : `No short plan unless price loses VWAP ${round(vwapNow)} and fails a retest on the 15-minute chart.`;
  const noTradeCondition = deskNoTradeReason || "Cancel the idea if price chops around VWAP, volume fades, or reward/risk falls below 1.5:1.";
  const bestTriggerToWaitFor = signalTier === "Watch for Trigger" ? deskTriggerNeeded : candleCheck.reason;

  return {
    symbol,
    name: record.name,
    type: record.type,
    group: record.group,
    signal,
    setupSignal,
    decisionCode,
    signalTier,
    confidenceScore: readinessScore,
    setupConfidenceScore,
    riskScore,
    tradeCardDirection,
    bias,
    tradeStatus,
    action,
    direction,
    confidence,
    confidenceRating: readinessScore,
    tradeGrade: execution.grade || quality.grade,
    rawTradeGrade: quality.grade,
    executionLabel: execution.label,
    executionReason: execution.reason,
    tradeSlotApproved: execution.executable,
    tradeDecision,
    marketConfirmation: marketCheck.label,
    marketConfirmationReason: marketCheck.reason,
    candleConfirmation: candleCheck.label,
    candleConfirmationReason: candleCheck.reason,
    retestEntry: retestCheck.label,
    retestEntryReason: retestCheck.reason,
    timeWindow: timeCheck.label,
    timeWindowReason: timeCheck.reason,
    brokerCheckRequired: "Confirm live bid/ask in broker before buying. Use limit orders only.",
    riskRule: "Max 2 losing trades per day. Stop after 3 total trades.",
    profitRule: "Consider selling partial at +20% to +30%, move stop to breakeven, then let the rest try for target.",
    setupType,
    decisionScore: checklist.score,
    decisionScorePassed: checklist.passed,
    decisionScoreSummary: checklist.summary,
    decisionScoreParts: checklist.parts,
    keyLevel: keyLevel?.name ?? null,
    keyLevelPrice: round(keyLevel?.value),
    keyLevelDistance: round(keyLevel?.distance),
    previousDayHigh: round(previousLevels.high),
    previousDayLow: round(previousLevels.low),
    previousDayClose: round(previousLevels.close),
    premarketHigh: null,
    premarketLow: null,
    premarketVolume: null,
    relativeVolume: round(tradeVolumeRatio, 2),
    volume20DayAverage: round(avgVolume, 0),
    keySupport: round(keySupport),
    keyResistance: round(keyResistance),
    eventRiskLevel: eventPolicy.level,
    eventRiskHeadline: eventPolicy.headline,
    eventRiskRule: eventPolicy.rule,
    sessionPhaseLive: sessionPolicy.phase,
    sessionStatus: sessionPolicy.label,
    sessionRule: sessionPolicy.reason,
    dataFreshness: freshness.label,
    dataFreshnessReason: freshness.reason,
    latestCandleAgeMinutes: freshness.ageMinutes,
    optionSide: ticket.optionSide,
    strikeHint: ticket.strikeHint,
    contractHint: ticket.contractHint,
    stockEntryTrigger: ticket.stockEntryTrigger,
    stockStop: ticket.stockStop,
    stockTarget: ticket.stockTarget,
    targetPlan: ticket.targetPlan,
    stopPlan: ticket.stopPlan,
    skipRule: ticket.skipRule,
    setupQuality,
    riskQuality,
    invalidation,
    whyTradeExists,
    entryZone: deskEntryZone,
    stopLoss: round(stop),
    target1: round(target),
    target2: round(target2),
    riskReward: round(rewardRisk, 2),
    maxLossIfWrong: maxLossPerShare ? `${maxLossPerShare} per share` : "n/a",
    maxLossPerShare,
    invalidationReason: invalidation,
    triggerNeeded: signalTier === "Watch for Trigger" ? deskTriggerNeeded : "",
    noTradeReason: deskNoTradeReason,
    longSetupPlan,
    shortSetupPlan,
    noTradeCondition,
    bestTriggerToWaitFor,
    confidenceNotes: quality.notes.join("; "),
    sessionPhase: sessionPhase(rows),
    chopRisk,
    vwapCrosses: crosses,
    timeframe5: tf5.label,
    timeframe5Reason: tf5.reason,
    timeframe15: tf15.label,
    timeframe15Reason: tf15.reason,
    timeframe30: tf30.label,
    timeframe30Reason: tf30.reason,
    multiTimeframe: `${mtfAligned}/3 timeframes confirm`,
    score,
    time: latest.datetime,
    close: round(latest.close),
    vwap: round(vwapNow),
    vwapDistancePct: round(vwapDistancePct, 2),
    vwapSlopePct: round(vwapSlopePct, 3),
    ema9: round(ema9[index]),
    ema20: round(ema20Now),
    ema21: round(ema21[index]),
    ema50: round(ema50Now),
    ema200: round(ema200Now),
    rsi14: round(rsi14[index], 1),
    macdHistogram: round(macdNow.histogram, 4),
    openingHigh: round(range.high),
    openingLow: round(range.low),
    dayHigh: round(sessionHigh),
    dayLow: round(sessionLow),
    rangePosition: round(rangePosition, 0),
    volumeRatio: round(tradeVolumeRatio, 2),
    relativeStrengthPct: round(relativeStrength * 100, 2),
    trigger: round(trigger),
    stop: round(stop),
    target: round(target),
    rewardRisk: round(rewardRisk, 2),
    beginnerRead: `${direction} idea: ${action}.`,
    traderRead: `${tradeDecision}. ${setupQuality}. ${riskQuality}. ${marketCheck.reason} ${candleCheck.reason} ${retestCheck.reason} ${invalidation}`,
    reason: eventBlocked ? `${eventPolicy.headline}; ${eventPolicy.rule}` : reasons.join("; ") || "mixed intraday tape",
  };
}

function signalTierFromScore({ decisionCode, confidenceRating, rewardRisk, execution, signal }) {
  if (decisionCode === "TRADE_NOW" && confidenceRating >= 85 && rewardRisk >= 2 && execution?.grade === "A+") return "A+ Trade";
  if (confidenceRating >= 70 && signal !== "NO_TRADE") return "Watch for Trigger";
  if (confidenceRating >= 55 && signal !== "NO_TRADE") return "Watch for Trigger";
  return "No Trade";
}

function executionReadinessScore({ decisionCode, setupConfidence, execution, marketCheck, candleCheck, retestCheck, eventLevel, mtfAligned }) {
  if (decisionCode === "TRADE_NOW") return setupConfidence;
  if (decisionCode === "WAIT") {
    let cap = execution?.grade === "A" ? 84 : 74;
    if (!marketCheck?.confirmed) cap -= 8;
    if (!candleCheck?.confirmed) cap -= 8;
    if (!retestCheck?.passed) cap -= 8;
    if (eventLevel === "MEDIUM") cap -= 5;
    if (eventLevel === "HIGH") cap -= 18;
    if (mtfAligned < 1) cap = Math.min(cap, 64);
    return Math.max(50, Math.min(setupConfidence, cap));
  }
  return Math.min(setupConfidence, eventLevel === "HIGH" ? 45 : 54);
}

function riskScoreFromRow({ rewardRisk, chopRisk, eventLevel, volumeRatio, vwapDistancePct }) {
  let risk = 45;
  if (!Number.isFinite(rewardRisk) || rewardRisk < 1.5) risk += 18;
  if (rewardRisk >= 2) risk -= 10;
  if (chopRisk === "HIGH") risk += 20;
  if (chopRisk === "MEDIUM") risk += 8;
  if (eventLevel === "HIGH") risk += 22;
  if (eventLevel === "MEDIUM") risk += 10;
  if (volumeRatio < 0.75) risk += 12;
  if (Math.abs(vwapDistancePct ?? 0) > 1.8) risk += 12;
  return Math.max(0, Math.min(100, Math.round(risk)));
}

function entryZone(trigger, atrValue, direction) {
  if (!Number.isFinite(trigger) || !Number.isFinite(atrValue)) return "Wait for trigger";
  const buffer = Math.max(atrValue * 0.15, trigger * 0.0008);
  return direction === "CALL"
    ? `${round(trigger)}-${round(trigger + buffer)}`
    : `${round(trigger - buffer)}-${round(trigger)}`;
}

function triggerNeeded({ direction, setupType, trigger, vwapNow }) {
  const side = direction === "CALL" ? "bullish" : "bearish";
  if (/VWAP/.test(setupType)) return `Need a 5-minute ${side} candle confirming VWAP ${round(vwapNow)} and holding the trigger ${round(trigger)}.`;
  if (/Breakout/.test(setupType)) return `Need break-and-retest confirmation around ${round(trigger)} with volume expansion.`;
  if (/Failed breakout/.test(setupType)) return `Need failed-breakout confirmation and a 5-minute rejection candle through ${round(trigger)}.`;
  return `Need a completed 5-minute ${side} confirmation candle near ${round(trigger)}.`;
}

function noTradeReasonFor({ eventBlocked, sessionBlocked, staleBlocked, sessionPolicy, freshness, chopRisk, rewardRisk, volumeRatio, vwapDistancePct, marketCheck, signal, setupType }) {
  if (eventBlocked) return "High event risk. Only A+ setups are allowed, and this is not clean enough.";
  if (sessionBlocked) return sessionPolicy.reason;
  if (staleBlocked) return freshness.reason;
  if (chopRisk === "HIGH") return "Market/stock is chopping around VWAP; no clean edge.";
  if (!Number.isFinite(rewardRisk) || rewardRisk < 1.5) return "Risk/reward is below 1.5:1.";
  if (volumeRatio < 0.75) return "Volume/RVOL is too weak.";
  if (Math.abs(vwapDistancePct ?? 0) > 1.8) return "Price is too extended from VWAP; avoid chasing.";
  if (!marketCheck?.confirmed) return "Market/index direction does not confirm the trade.";
  if (setupType === "No clean setup" || signal === "NO_TRADE") return "No clean 15-minute setup.";
  return "Setup is not strong enough for a professional intraday trade.";
}

function signalTierRank(row) {
  if (row.signalTier === "A+ Trade") return 3;
  if (row.signalTier === "Watch for Trigger") return row.confidenceScore >= 70 ? 2 : 1;
  return 0;
}

function normalizedSignalTier(row) {
  return row.signalTier || (row.signal && row.signal !== "NO_DATA" && row.signal !== "NO_TRADE" ? "Watch for Trigger" : "No Trade");
}

function eventRiskLabel(eventPolicy) {
  if (eventPolicy?.level === "HIGH") return "High";
  if (eventPolicy?.level === "MEDIUM") return "Medium";
  return "Low";
}

function marketConditionFrom({ eventPolicy, sessionPolicy, results }) {
  if (["WEEKEND", "CLOSED", "AFTER_HOURS"].includes(sessionPolicy?.phase)) return "Do Not Trade Aggressively";
  if (eventPolicy?.level === "HIGH") return "Do Not Trade Aggressively";
  const aboveVwap = results.filter((row) => Number(row.close) > Number(row.vwap)).length;
  const belowVwap = results.filter((row) => Number(row.close) < Number(row.vwap)).length;
  const choppy = results.filter((row) => row.chopRisk === "HIGH").length;
  if (eventPolicy?.level === "MEDIUM" || choppy > results.length * 0.35) return "Trade With Caution";
  if (aboveVwap && belowVwap && Math.abs(aboveVwap - belowVwap) <= Math.max(2, results.length * 0.12)) return "Trade With Caution";
  return "Trade Normally";
}

function buildEventRiskCalendar(eventPolicy) {
  return [
    ...(eventPolicy?.macroNewsEvents ?? []),
    ...(eventPolicy?.earningsEvents ?? []),
    ...(eventPolicy?.manualReminders ?? []),
    ...(eventPolicy?.events ?? []),
  ]
    .map((event) => ({
      symbol: event.symbol ?? "ALL",
      event: event.event ?? event.headline ?? "Scheduled event",
      risk: event.risk ?? event.level ?? eventPolicy?.level ?? "MEDIUM",
      source: event.source ?? event.type ?? "event scan",
    }))
    .slice(0, 20);
}

function buildSectorStrength(results) {
  const groups = new Map();
  for (const row of results) {
    if (!row.group || row.group === "Index") continue;
    const group = groups.get(row.group) ?? {
      sector: row.group,
      count: 0,
      relativeStrengthTotal: 0,
      volumeTotal: 0,
      aboveVwap: 0,
      bullishBias: 0,
      bearishBias: 0,
    };
    group.count += 1;
    group.relativeStrengthTotal += Number(row.relativeStrengthPct ?? 0);
    group.volumeTotal += Number(row.relativeVolume ?? row.volumeRatio ?? 1);
    if (Number(row.close) > Number(row.vwap)) group.aboveVwap += 1;
    if (row.bias === "Bullish") group.bullishBias += 1;
    if (row.bias === "Bearish") group.bearishBias += 1;
    groups.set(row.group, group);
  }
  return [...groups.values()]
    .map((group) => ({
      sector: group.sector,
      count: group.count,
      relativeStrengthPct: round(group.relativeStrengthTotal / group.count, 2),
      averageRelativeVolume: round(group.volumeTotal / group.count, 2),
      aboveVwap: group.aboveVwap,
      bias: group.bullishBias > group.bearishBias ? "Bullish" : group.bearishBias > group.bullishBias ? "Bearish" : "Neutral",
    }))
    .sort((a, b) => Number(b.relativeStrengthPct ?? 0) - Number(a.relativeStrengthPct ?? 0));
}

function tradeCardView(row) {
  return {
    ticker: row.symbol,
    companyName: row.name,
    direction: row.tradeCardDirection,
    signalTier: normalizedSignalTier(row),
    confidenceScore: row.confidenceScore,
    setupConfidenceScore: row.setupConfidenceScore,
    riskScore: row.riskScore,
    rawTradeGrade: row.rawTradeGrade,
    tradeGrade: row.tradeGrade,
    executionLabel: row.executionLabel,
    executionReason: row.executionReason,
    tradeDecision: row.tradeDecision,
    whyThisTradeExists: row.whyTradeExists,
    entryZone: row.entryZone,
    stopLoss: row.stopLoss,
    target1: row.target1,
    target2: row.target2,
    riskReward: row.riskReward,
    maxLossIfWrong: row.maxLossIfWrong,
    invalidationReason: row.invalidationReason,
    triggerNeeded: row.triggerNeeded,
    noTradeReason: row.noTradeReason,
    tradeStatus: row.tradeStatus,
    bias: row.bias,
    setupType: row.setupType,
    optionSide: row.optionSide,
    optionExpiration: row.optionExpiration,
    optionDte: row.optionDte,
    optionContract: row.optionContract,
    optionStrike: row.optionStrike,
    optionBid: row.optionBid,
    optionAsk: row.optionAsk,
    optionMid: row.optionMid,
    optionEstimatedCost: row.optionEstimatedCost,
    optionSpreadPct: row.optionSpreadPct,
    optionVolume: row.optionVolume,
    optionOpenInterest: row.optionOpenInterest,
    optionContractScore: row.optionContractScore,
    optionContractGrade: row.optionContractGrade,
    optionContractLabel: row.optionContractLabel,
    optionQuality: row.optionQuality,
    contractHint: row.contractHint,
    contractDecision: row.contractDecision,
    contractWhy: row.contractWhy,
    stockEntryTrigger: row.stockEntryTrigger,
    stockStop: row.stockStop,
    stockTarget: row.stockTarget,
    targetPlan: row.targetPlan,
    stopPlan: row.stopPlan,
    skipRule: row.skipRule,
    traderRead: row.traderRead,
    reason: row.reason,
    confidenceNotes: row.confidenceNotes,
    marketConfirmationReason: row.marketConfirmationReason,
    marketConfirmation: row.marketConfirmation,
    candleConfirmation: row.candleConfirmation,
    retestEntry: row.retestEntry,
    timeWindow: row.timeWindow,
    candleConfirmationReason: row.candleConfirmationReason,
    retestEntryReason: row.retestEntryReason,
    eventRiskHeadline: row.eventRiskHeadline,
    eventRiskRule: row.eventRiskRule,
    riskRule: row.riskRule,
    profitRule: row.profitRule,
    brokerCheckRequired: row.brokerCheckRequired,
    optionContractPositives: row.optionContractPositives,
    optionContractRisks: row.optionContractRisks,
    keySupport: row.keySupport,
    keyResistance: row.keyResistance,
    vwap: row.vwap,
    trigger: row.trigger,
  };
}

function buildMorningBrief({ results, eventPolicy, sessionPolicy, now }) {
  const marketClosed = ["WEEKEND", "CLOSED", "AFTER_HOURS"].includes(sessionPolicy?.phase);
  const ranked = [...results].sort((a, b) =>
    signalTierRank(b) - signalTierRank(a) ||
    Number(b.confidenceScore ?? 0) - Number(a.confidenceScore ?? 0) ||
    Number(b.relativeVolume ?? b.volumeRatio ?? 0) - Number(a.relativeVolume ?? a.volumeRatio ?? 0)
  );
  const marketCondition = marketConditionFrom({ eventPolicy, sessionPolicy, results });
  const topTickers = marketClosed ? [] : ranked
    .filter((row) => row.group !== "Index")
    .slice(0, 10)
    .map((row) => ({
      ticker: row.symbol,
      companyName: row.name,
      reason: row.whyTradeExists || row.reason,
      premarketVolume: row.premarketVolume,
      relativeVolume: row.relativeVolume ?? row.volumeRatio,
      premarketHigh: row.premarketHigh,
      premarketLow: row.premarketLow,
      previousDayHigh: row.previousDayHigh,
      previousDayLow: row.previousDayLow,
      previousClose: row.previousDayClose,
      keySupport: row.keySupport,
      keyResistance: row.keyResistance,
      bias: row.bias,
      tradeStatus: row.tradeStatus || "Do Not Trade",
      signalTier: normalizedSignalTier(row),
    }));
  const aPlus = results.filter((row) => normalizedSignalTier(row) === "A+ Trade");
  const watch = results.filter((row) => normalizedSignalTier(row) === "Watch for Trigger");
  const noTrade = results.filter((row) => normalizedSignalTier(row) === "No Trade");
  return {
    generatedAt: now.toISOString(),
    title: "Morning Trading Desk Brief",
    marketCondition,
    eventRisk: eventRiskLabel(eventPolicy),
    marketRead: sessionPolicy?.tradeAllowed === false
      ? `${sessionPolicy.label}: ${sessionPolicy.reason}`
      : eventPolicy?.headline ?? "Trade the chart, verify live headlines.",
    topTickers,
    tradingPlan: {
      longSetupPlan: "Prefer longs only when SPY/QQQ support the move, the 15-minute chart is above VWAP/9/20 EMA, and the 5-minute chart confirms the trigger.",
      shortSetupPlan: "Prefer shorts only when SPY/QQQ are weak, the 15-minute chart is below VWAP/9/20 EMA, and the 5-minute chart confirms a rejection or breakdown.",
      noTradeCondition: "No trade if price is choppy around VWAP, extended from VWAP, volume is weak, event risk is high, or reward/risk is below 1.5:1.",
      bestTriggerToWaitFor: "A 5-minute break-and-retest, VWAP hold/reclaim, higher-low confirmation, or rejection candle with volume expansion.",
    },
    counts: {
      aPlus: aPlus.length,
      watch: watch.length,
      noTrade: noTrade.length,
    },
    activeTradeCards: aPlus.slice(0, 5).map(tradeCardView),
    watchForTriggerCards: watch.slice(0, 10).map(tradeCardView),
    noTradeCards: noTrade.slice(0, 10).map(tradeCardView),
    eventRiskCalendar: buildEventRiskCalendar(eventPolicy),
    sectorStrength: buildSectorStrength(results),
    premarketMovers: marketClosed ? [] : ranked
      .filter((row) => row.group !== "Index")
      .slice(0, 20)
      .map((row) => ({
        ticker: row.symbol,
        companyName: row.name,
        relativeVolume: row.relativeVolume ?? row.volumeRatio,
        bias: row.bias,
        signalTier: row.signalTier,
        reason: row.whyTradeExists || row.reason,
      })),
    technicalScoreTable: ranked.map((row) => ({
      ticker: row.symbol,
      companyName: row.name,
      signalTier: row.signalTier,
      confidenceScore: row.confidenceScore,
      riskScore: row.riskScore,
      close: row.close,
      vwap: row.vwap,
      vwapDistancePct: row.vwapDistancePct,
      relativeVolume: row.relativeVolume ?? row.volumeRatio,
      rewardRisk: row.riskReward ?? row.rewardRisk,
      eventRisk: row.eventRiskLevel,
    })),
  };
}

function paperStats(records) {
  const closed = records.filter((record) => record.outcome && record.outcome !== "Pending");
  const wins = closed.filter((record) => record.outcome === "Target").length;
  const losses = closed.filter((record) => record.outcome === "Stop").length;
  return {
    totalTracked: records.length,
    pending: records.length - closed.length,
    winRate: closed.length ? round((wins / closed.length) * 100, 1) : null,
    averageWin: null,
    averageLoss: null,
    profitFactor: null,
    expectancy: null,
    bestSetup: "Pending enough completed signals",
    worstSetup: "Pending enough completed signals",
    bestTimeOfDay: "Pending enough completed signals",
    worstTimeOfDay: "Pending enough completed signals",
    note: losses || wins ? "Outcome scoring can be expanded with replay/high-low checks." : "Signals are being logged; outcomes are pending until replay tracking is added.",
  };
}

export function updateIntradayPaperLog(scan, reportDir = "local-reports") {
  fs.mkdirSync(reportDir, { recursive: true });
  const filePath = `${reportDir}/intraday_signal_log.json`;
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
  const existingKeys = new Set(existing.map((record) => record.key));
  const today = exchangeDateKey(new Date(scan.summary?.updatedAt ?? Date.now()));
  const rows = (scan.results ?? [])
    .filter((row) => row.symbol && row.signalTier)
    .map((row) => ({
      key: `${today}|${row.symbol}|${row.signalTier}|${row.entryZone}|${row.stopLoss}|${row.target1}`,
      date: today,
      timeSignalAppeared: scan.summary?.updatedAt,
      ticker: row.symbol,
      setupType: row.setupType,
      signalTier: row.signalTier,
      entryTriggerAppeared: row.signalTier === "A+ Trade",
      entryPrice: row.stockEntryTrigger ?? row.trigger,
      stopPrice: row.stopLoss ?? row.stop,
      target1: row.target1 ?? row.target,
      target2: row.target2,
      outcome: "Pending",
      maxFavorableExcursion: null,
      maxAdverseExcursion: null,
      timeOfDay: row.time,
      marketCondition: scan.summary?.morningBrief?.marketCondition,
      eventRiskLevel: scan.summary?.morningBrief?.eventRisk,
      confidenceScore: row.confidenceScore,
      riskScore: row.riskScore,
      direction: row.tradeCardDirection,
    }))
    .filter((record) => !existingKeys.has(record.key));
  const merged = [...existing, ...rows].slice(-1000);
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  const stats = paperStats(merged);
  fs.writeFileSync(`${reportDir}/latest_intraday_paper_results.json`, JSON.stringify(stats, null, 2), "utf8");
  return stats;
}

export async function scanIntraday({
  universePath = "data/universe_intraday_core.csv",
  range = "30d",
  interval = "15m",
  timingInterval = "5m",
} = {}) {
  const now = new Date();
  const universe = loadUniverseRecords(universePath);
  const eventPolicy = await buildAutomaticEventRiskPolicy(universe, now);
  const sessionPolicy = marketSessionPolicy(now);
  const qqqHistory = await fetchHistory("QQQ", range, interval);
  const spyHistory = await fetchHistory("SPY", range, interval);
  const iwmHistory = await fetchHistory("IWM", range, interval);
  const qqqContext = sessionContextRows(qqqHistory);
  const spyContext = sessionContextRows(spyHistory);
  const iwmContext = sessionContextRows(iwmHistory);
  const qqqRows = qqqContext.current;
  const spyRows = spyContext.current;
  const iwmRows = iwmContext.current;
  const qqqRows5 = latestSessionRows(await fetchHistory("QQQ", range, timingInterval));
  const spyRows5 = latestSessionRows(await fetchHistory("SPY", range, timingInterval));
  const qqqRows30 = latestSessionRows(await fetchHistory("QQQ", range, "30m"));
  const spyRows30 = latestSessionRows(await fetchHistory("SPY", range, "30m"));
  const results = [];

  for (const record of universe) {
    try {
      const benchmarkRows = record.group === "Index" || record.symbol === "SPY" ? spyRows : qqqRows;
      const rows =
        record.symbol === "QQQ"
          ? qqqRows
          : record.symbol === "SPY"
            ? spyRows
            : record.symbol === "IWM"
            ? iwmRows
            : latestSessionRows(await fetchHistory(record.symbol, range, interval));
      const symbolHistory =
        record.symbol === "QQQ"
          ? qqqHistory
          : record.symbol === "SPY"
            ? spyHistory
            : record.symbol === "IWM"
              ? iwmHistory
              : await fetchHistory(record.symbol, range, interval);
      const symbolContext = ["QQQ", "SPY", "IWM"].includes(record.symbol)
        ? record.symbol === "QQQ"
          ? qqqContext
          : record.symbol === "SPY"
            ? spyContext
            : iwmContext
        : sessionContextRows(symbolHistory);
      const currentRows = ["QQQ", "SPY", "IWM"].includes(record.symbol) ? rows : symbolContext.current;
      const rows5 =
        record.symbol === "QQQ"
          ? qqqRows5
          : record.symbol === "SPY"
            ? spyRows5
            : latestSessionRows(await fetchHistory(record.symbol, range, timingInterval));
      const rows30 =
        record.symbol === "QQQ"
          ? qqqRows30
          : record.symbol === "SPY"
            ? spyRows30
            : latestSessionRows(await fetchHistory(record.symbol, range, "30m"));
      results.push(scoreIntradaySymbol(record, currentRows, { benchmarkRows, rows5, rows30, qqqRows, spyRows, eventPolicy, sessionPolicy, now, previousRows: symbolContext.previous, indicatorRows: symbolHistory }));
    } catch (error) {
      results.push({
        symbol: record.symbol,
        name: record.name,
        group: record.group,
        signal: "ERROR",
        action: "No trade",
        confidence: "Low",
        score: 0,
        reason: error.message,
      });
    }
  }

  results.sort((a, b) =>
    Number(b.tradeSlotApproved === true) - Number(a.tradeSlotApproved === true) ||
    Number(b.confidenceRating ?? 0) - Number(a.confidenceRating ?? 0) ||
    Number(b.score) - Number(a.score) ||
    a.symbol.localeCompare(b.symbol)
  );
  const slotCandidates = results
    .filter((row) => row.tradeSlotApproved === true)
    .slice(0, PRIMARY_TRADE_LIMIT)
    .map((row, index) => ({
      ...row,
      dailyTradeSlot: index + 1,
      slotPlan: `Trade slot ${index + 1}/${MAX_DAILY_TRADES}. Do not take another trade in the same direction unless this one is closed and rules still align.`,
    }));
  const watchCandidates = results
    .filter((row) => ["CALL_TRIGGER", "PUT_TRIGGER", "WATCH_CALL", "WATCH_PUT"].includes(row.signal) || ["CALL_TRIGGER", "PUT_TRIGGER", "WATCH_CALL", "WATCH_PUT"].includes(row.setupSignal))
    .filter((row) => row.tradeSlotApproved !== true)
    .slice(0, 9);
  const candidateIdeas = [...slotCandidates, ...watchCandidates].slice(0, 12);
  const tradeIdeas = [];
  for (const row of candidateIdeas) {
    tradeIdeas.push(await enrichOptionContract(row));
  }
  const enrichedBySymbol = new Map(tradeIdeas.map((row) => [row.symbol, row]));
  const finalResults = results.map((row) => enrichedBySymbol.get(row.symbol) ?? row);
  const approvedTrades = tradeIdeas.filter((row) => row.tradeSlotApproved === true);
  const hideLiveIdeas = ["WEEKEND", "CLOSED", "AFTER_HOURS"].includes(sessionPolicy.phase);
  const morningBrief = buildMorningBrief({ results: finalResults, eventPolicy, sessionPolicy, now });
  const aPlusSetups = finalResults.filter((row) => row.signalTier === "A+ Trade");
  const watchSetups = finalResults.filter((row) => row.signalTier === "Watch for Trigger");
  const noTradeSetups = finalResults.filter((row) => row.signalTier === "No Trade");
  const summary = {
    updatedAt: new Date().toISOString(),
    range,
    interval,
    timingInterval,
    decisionCadence: "15-minute primary signals; 5-minute only for timing confirmation",
    nextReviewMinutes: 15,
    dailyTradeLimit: MAX_DAILY_TRADES,
    approvedTradeSlots: approvedTrades.length,
    tradeSlotsRemaining: Math.max(0, MAX_DAILY_TRADES - approvedTrades.length),
    disciplineMode: "2-3 trades max. Only A+ setups can use a trade slot. Watch means wait for a trigger; No Trade is a valid professional output.",
    eventPolicy,
    sessionPolicy,
    morningBrief,
    marketCondition: morningBrief.marketCondition,
    eventRisk: morningBrief.eventRisk,
    aPlusSetups: hideLiveIdeas ? [] : aPlusSetups.slice(0, 5),
    watchSetups: hideLiveIdeas ? [] : watchSetups.slice(0, 10),
    noTradeSetups: noTradeSetups.slice(0, 12),
    activeTradeCards: hideLiveIdeas ? [] : morningBrief.activeTradeCards,
    watchForTriggerCards: hideLiveIdeas ? [] : morningBrief.watchForTriggerCards,
    noTradeCards: morningBrief.noTradeCards,
    eventRiskCalendar: morningBrief.eventRiskCalendar,
    sectorStrength: morningBrief.sectorStrength,
    premarketMovers: morningBrief.premarketMovers,
    technicalScoreTable: morningBrief.technicalScoreTable,
    paperResults: {
      totalTracked: 0,
      pending: 0,
      winRate: null,
      profitFactor: null,
      expectancy: null,
      note: "Paper signal stats update after the CLI or dashboard server writes the scan log.",
    },
    dataPolicy: {
      maxLiveCandleAgeMinutes: MAX_LIVE_CANDLE_AGE_MINUTES,
      rule: "TRADE_NOW is allowed only during regular session with same-day fresh candles. Pre-market, after-hours, weekends, and stale candles are review/watchlist only.",
    },
    scanned: results.length,
    tradeIdeas: hideLiveIdeas ? 0 : tradeIdeas.length,
    tradeNow: hideLiveIdeas ? 0 : aPlusSetups.length,
    wait: hideLiveIdeas ? 0 : watchSetups.length,
    noTrade: noTradeSetups.length,
    aPlusCount: hideLiveIdeas ? 0 : aPlusSetups.length,
    watchCount: hideLiveIdeas ? 0 : watchSetups.length,
    noTradeCount: noTradeSetups.length,
    callTriggers: results.filter((row) => row.signal === "CALL_TRIGGER").length,
    putTriggers: results.filter((row) => row.signal === "PUT_TRIGGER").length,
    indexTape: finalResults.filter((row) => ["SPY", "QQQ", "IWM"].includes(row.symbol)),
    bestIdea: hideLiveIdeas ? null : approvedTrades[0] ?? tradeIdeas[0] ?? null,
    approvedTrades: hideLiveIdeas ? [] : approvedTrades,
    watchlist: hideLiveIdeas ? [] : tradeIdeas.filter((row) => row.tradeSlotApproved !== true).slice(0, 6),
    marketBreadth: {
      aboveVwap: finalResults.filter((row) => Number(row.close) > Number(row.vwap)).length,
      belowVwap: finalResults.filter((row) => Number(row.close) < Number(row.vwap)).length,
      callBias: finalResults.filter((row) => String(row.setupSignal || row.signal).includes("CALL")).length,
      putBias: finalResults.filter((row) => String(row.setupSignal || row.signal).includes("PUT")).length,
    },
    rule: "Use this as a 15-minute decision assistant. Do not chase between reviews. If event mode is major, no new trades. Stop after 2 losses or 3 total trades.",
  };

  return { summary, results: finalResults, tradeIdeas };
}
