import fs from "node:fs";
import path from "node:path";

import { scanLeapsSymbol } from "./leapsScanner.js";
import { loadUniverse } from "./universe.js";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? { symbol: "", decision: "", score: "" });
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

async function main() {
  const universePath = getArg("universe", "data/universe_leaps_budget.csv");
  const reportDir = getArg("report-dir", "reports");
  const symbols = loadUniverse(universePath);
  const results = [];

  console.log(`Scanning ${symbols.length} symbols for LEAPS candidates...`);
  for (const symbol of symbols) {
    try {
      results.push(await scanLeapsSymbol(symbol));
    } catch (error) {
      results.push({ symbol, decision: "ERROR", score: 0, reason: error.message });
    }
  }

  results.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0) || a.symbol.localeCompare(b.symbol));
  const alerts = results.filter((row) => ["LEAPS BUY CANDIDATE", "STARTER / WATCH", "WATCH ONLY"].includes(row.decision)).slice(0, 12);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_leaps_scan.csv"), toCsv(results), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_leaps_alerts.json"), JSON.stringify(alerts, null, 2), "utf8");

  console.table(alerts.map(({ symbol, direction, decision, score, currentPrice, strike, expiration, mid, cost, breakevenMovePct, spreadPct }) => ({
    symbol,
    direction,
    decision,
    score,
    currentPrice,
    strike,
    expiration,
    mid,
    cost,
    breakevenMovePct,
    spreadPct,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_leaps_scan.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
