import fs from "node:fs";
import path from "node:path";

import { scanIntraday, updateIntradayPaperLog } from "./intradayScanner.js";

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
  const reportDir = getArg("report-dir", "local-reports");
  const universePath = getArg("universe", "data/universe_intraday_core.csv");
  const range = getArg("range", "30d");
  const interval = getArg("interval", "15m");
  const timingInterval = getArg("timing-interval", "5m");
  const scan = await scanIntraday({ universePath, range, interval, timingInterval });
  scan.summary.paperResults = updateIntradayPaperLog(scan, reportDir);

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest_intraday_summary.json"), JSON.stringify(scan.summary, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_alerts.json"), JSON.stringify(scan.tradeIdeas, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_results.json"), JSON.stringify(scan.results, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_scan.csv"), toCsv(scan.results), "utf8");

  console.table(scan.tradeIdeas.slice(0, 12).map(({ symbol, decisionCode, signal, tradeGrade, tradeSlotApproved, dailyTradeSlot, confidenceRating, score, close, vwap, vwapSlopePct, trigger, stop, target, rewardRisk, reason }) => ({
    symbol,
    decisionCode,
    signal,
    tradeGrade,
    tradeSlotApproved,
    dailyTradeSlot,
    confidenceRating,
    score,
    close,
    vwap,
    vwapSlopePct,
    trigger,
    stop,
    target,
    rewardRisk,
    reason,
  })));
  console.log(`Wrote ${path.join(reportDir, "latest_intraday_scan.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
