import fs from "node:fs";
import path from "node:path";

import { fetchHistory } from "./marketData.js";
import { scoreHighRiskIdea, summarizeHighRisk } from "./highRiskScanner.js";
import { loadUniverseRecords } from "./universe.js";
import { getEventRisk, loadEventCalendar } from "./eventRisk.js";

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

async function fetchBenchmarks(range) {
  const symbols = ["SPY", "QQQ", "IWM", "ARKK", "XIU.TO", "XIC.TO"];
  const output = {};
  for (const symbol of symbols) {
    try {
      output[symbol] = await fetchHistory(symbol, range);
    } catch (error) {
      output[symbol] = [];
    }
  }
  return output;
}

function summarizeIndexes(benchmarks) {
  return Object.fromEntries(Object.entries(benchmarks).map(([symbol, rows]) => {
    const latest = rows[rows.length - 1];
    const prev20 = rows[rows.length - 21];
    const prev60 = rows[rows.length - 61];
    return [symbol, {
      close: latest?.close ? Number(latest.close.toFixed(2)) : null,
      return20: latest && prev20 ? Number(((latest.close / prev20.close - 1) * 100).toFixed(2)) : null,
      return60: latest && prev60 ? Number(((latest.close / prev60.close - 1) * 100).toFixed(2)) : null,
    }];
  }));
}

async function main() {
  const universePath = getArg("universe", "data/universe_high_risk.csv");
  const range = getArg("range", "18mo");
  const reportDir = getArg("report-dir", "reports");
  const accountSize = Number(getArg("account-size", "5000"));
  const universe = loadUniverseRecords(universePath);
  const events = loadEventCalendar();
  const benchmarks = await fetchBenchmarks(range);
  const marketContext = summarizeIndexes(benchmarks);
  const results = [];

  console.log(`Scanning ${universe.length} high-risk symbols across U.S. and Canadian risk indexes...`);

  for (const record of universe) {
    try {
      const symbol = record.symbol;
      const primaryBenchmark = symbol.endsWith(".TO") || symbol.endsWith(".V") ? "XIU.TO" : "QQQ";
      const rows = await fetchHistory(symbol, range);
      results.push(scoreHighRiskIdea(symbol, rows, benchmarks[primaryBenchmark] ?? [], {
        ...record,
        eventRisk: getEventRisk(symbol, events),
      }));
    } catch (error) {
      results.push({
        symbol: record.symbol,
        name: record.name,
        market: record.market,
        theme: record.theme,
        signal: "ERROR",
        score: 0,
        reason: error.message,
      });
    }
  }

  results.sort((a, b) => Number(b.score) - Number(a.score) || a.symbol.localeCompare(b.symbol));
  const alerts = results.filter((row) => ["SPEC_BUY", "STARTER_BUY", "WATCHLIST"].includes(row.signal)).slice(0, 15);
  const summary = summarizeHighRisk(results, marketContext, accountSize);

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_high_risk_scan.csv"), toCsv(results), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_high_risk_alerts.json"), JSON.stringify(alerts, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_high_risk_summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.table(alerts.slice(0, 12).map(({ symbol, signal, rating, score, close, stop, target1, target2, doubleTarget, eventRisk, reason }) => ({
    symbol,
    signal,
    rating,
    score,
    close,
    stop,
    target1,
    target2,
    doubleTarget,
    eventRisk,
    reason,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_high_risk_scan.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
