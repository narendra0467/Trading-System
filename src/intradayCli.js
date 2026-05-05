import fs from "node:fs";
import path from "node:path";

import { scanIntradaySymbol, summarizeIntraday } from "./intradayScanner.js";
import { loadUniverse } from "./universe.js";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? { symbol: "", signal: "", score: "" });
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

async function main() {
  const universePath = getArg("universe", "data/universe_intraday_indexes.csv");
  const reportDir = getArg("report-dir", "reports");
  const symbols = loadUniverse(universePath);
  const results = [];

  console.log(`Scanning ${symbols.length} symbols for intraday setups...`);
  for (const symbol of symbols) {
    try {
      results.push(await scanIntradaySymbol(symbol));
    } catch (error) {
      results.push({ symbol, signal: "ERROR", score: 0, reason: error.message });
    }
  }

  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol));
  const alerts = results.filter((row) => row.decision === "TRADE_NOW");
  const summary = summarizeIntraday(results);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_intraday_scan.csv"), toCsv(results), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_alerts.json"), JSON.stringify(alerts, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(`Market bias: ${summary.marketBias} - ${summary.primaryAction}`);
  console.table(results.map(({ symbol, decision, signal, score, price, vwap, openingHigh, openingLow, stop, target, rewardRisk }) => ({
    symbol,
    decision,
    signal,
    score,
    price,
    vwap,
    openingHigh,
    openingLow,
    stop,
    target,
    rewardRisk,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_intraday_scan.csv")}`);
  console.log(`Wrote ${path.join(reportDir, "latest_intraday_alerts.json")}`);
  console.log(`Wrote ${path.join(reportDir, "latest_intraday_summary.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
