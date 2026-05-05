import fs from "node:fs";
import path from "node:path";

import { backtestLongSwing } from "./backtest.js";
import { fetchHistory } from "./marketData.js";
import { loadUniverse } from "./universe.js";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? { symbol: "", trades: "" }).filter((header) => header !== "tradeLog");
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => row[header] ?? "").join(",")),
  ].join("\n");
}

async function main() {
  const universePath = getArg("universe", "data/universe_swing_core.csv");
  const benchmark = getArg("benchmark", "QQQ");
  const range = getArg("range", "5y");
  const reportDir = getArg("report-dir", "reports");
  const symbols = loadUniverse(universePath);
  const benchmarkRows = await fetchHistory(benchmark, range);
  const results = [];

  console.log(`Backtesting ${symbols.length} symbols against ${benchmark}...`);
  for (const symbol of symbols) {
    try {
      const rows = await fetchHistory(symbol, range);
      results.push(backtestLongSwing(symbol, rows, benchmarkRows));
    } catch (error) {
      results.push({ symbol, trades: 0, winRate: 0, avgReturnPct: 0, profitFactor: null, error: error.message });
    }
  }

  results.sort((a, b) => (b.profitFactor ?? 0) - (a.profitFactor ?? 0));
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_backtest.csv"), toCsv(results), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_backtest_trades.json"), JSON.stringify(results, null, 2), "utf8");

  console.table(results.map(({ symbol, trades, winRate, avgReturnPct, profitFactor }) => ({
    symbol,
    trades,
    winRate,
    avgReturnPct,
    profitFactor,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_backtest.csv")}`);
  console.log(`Wrote ${path.join(reportDir, "latest_backtest_trades.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
