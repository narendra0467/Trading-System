import fs from "node:fs";
import path from "node:path";

import { fetchHistory } from "./marketData.js";
import { buildMarketRegime } from "./marketRegime.js";
import { scoreStock } from "./scanner.js";
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
  const universePath = getArg("universe", "data/universe_swing_core.csv");
  const benchmark = getArg("benchmark", "QQQ");
  const range = getArg("range", "18mo");
  const reportDir = getArg("report-dir", "reports");
  const symbols = loadUniverse(universePath);

  console.log(`Scanning ${symbols.length} symbols against ${benchmark}...`);
  const benchmarkRows = await fetchHistory(benchmark, range);
  const marketRegime = await buildMarketRegime({ benchmark, range });
  console.log(`Market regime: ${marketRegime.regime} (${marketRegime.score}) - ${marketRegime.reason}`);
  const results = [];

  for (const symbol of symbols) {
    try {
      const rows = await fetchHistory(symbol, range);
      results.push({ ...scoreStock(symbol, rows, benchmarkRows), marketRegime: marketRegime.regime, marketScore: marketRegime.score });
    } catch (error) {
      results.push({ symbol, signal: "ERROR", score: 0, reason: error.message });
    }
  }

  results.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const alerts = results.filter((row) => ["BUY_SETUP", "WATCH", "EXIT_WARNING"].includes(row.signal));
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_scan.csv"), toCsv(results), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_alerts.json"), JSON.stringify(alerts, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_market_regime.json"), JSON.stringify(marketRegime, null, 2), "utf8");

  console.table(results.slice(0, 20).map(({ symbol, signal, score, close, rsi14, stop, target }) => ({
    symbol,
    signal,
    score,
    close,
    rsi14,
    stop,
    target,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_scan.csv")}`);
  console.log(`Wrote ${path.join(reportDir, "latest_alerts.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
