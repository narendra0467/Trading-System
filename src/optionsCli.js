import fs from "node:fs";
import path from "node:path";

import { loadEventCalendar, getEventRisk } from "./eventRisk.js";
import { fetchHistory } from "./marketData.js";
import { buildMarketRegime } from "./marketRegime.js";
import { scanOptionsSymbol } from "./optionsScanner.js";
import { writeTradeJournal } from "./journal.js";
import { applyPortfolioGuards, calculatePositionPlan } from "./risk.js";
import { loadUniverse } from "./universe.js";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function toCsv(rows) {
  const flattenedRows = rows.map((row) => ({
    ...row,
    contracts: row.positionPlan?.contracts,
    maxRiskDollars: row.positionPlan?.maxRiskDollars,
    riskPerContract: row.positionPlan?.riskPerContract,
    riskPerSpread: row.positionPlan?.riskPerSpread,
    plannedCapital: row.positionPlan?.plannedCapital,
  })).map(({ positionPlan, ...row }) => row);
  const headers = Object.keys(flattenedRows[0] ?? { symbol: "", signal: "", strategy: "", score: "" });
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...flattenedRows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

async function main() {
  const universePath = getArg("universe", "data/universe_options_core.csv");
  const benchmark = getArg("benchmark", "QQQ");
  const reportDir = getArg("report-dir", "reports");
  const range = getArg("range", "18mo");
  const accountSize = Number(getArg("account-size", "100000"));
  const riskPct = Number(getArg("risk-pct", "0.01"));
  const symbols = loadUniverse(universePath);
  const benchmarkRows = await fetchHistory(benchmark, range);
  const marketRegime = await buildMarketRegime({ benchmark, range });
  const events = loadEventCalendar();
  const results = [];

  console.log(`Scanning ${symbols.length} options symbols against ${benchmark}...`);
  console.log(`Market regime: ${marketRegime.regime} (${marketRegime.score}) - ${marketRegime.reason}`);
  for (const symbol of symbols) {
    try {
      const eventRisk = getEventRisk(symbol, events);
      const idea = await scanOptionsSymbol(symbol, benchmarkRows, { range, marketRegime, eventRisk });
      results.push({
        ...idea,
        positionPlan: calculatePositionPlan(idea, marketRegime, { accountSize, riskPct }),
      });
    } catch (error) {
      results.push({ symbol, signal: "ERROR", strategy: "NONE", score: 0, reason: error.message });
    }
  }

  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol));
  const guardedResults = applyPortfolioGuards(results);
  const alerts = guardedResults.filter((row) => !["NO_TRADE", "SKIP", "ERROR"].includes(row.signal));

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_options_scan.csv"), toCsv(guardedResults), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_options_alerts.json"), JSON.stringify(alerts, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_market_regime.json"), JSON.stringify(marketRegime, null, 2), "utf8");
  writeTradeJournal(path.join(reportDir, "trade_journal.json"), alerts);

  console.table(guardedResults.map(({ symbol, signal, score, dte, underlying, beginnerStrategy, optionStrike, optionEntry, optionCost, optionStop, optionTarget1, positionPlan }) => ({
    symbol,
    signal,
    trade: beginnerStrategy,
    score,
    dte,
    underlying,
    optionStrike,
    optionEntry,
    optionCost,
    optionStop,
    optionTarget1,
    contracts: positionPlan?.contracts,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_options_scan.csv")}`);
  console.log(`Wrote ${path.join(reportDir, "latest_options_alerts.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
