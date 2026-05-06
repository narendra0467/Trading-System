import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeStock } from "./stockAnalyzer.js";
import { readCsv, readJson } from "./dashboardData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const reportsDir = path.join(rootDir, "reports");
const publicDir = path.join(rootDir, "public");
const outputPath = path.join(publicDir, "analyzer-cache.json");

const EXTRA_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "VOO",
  "VTI",
  "SHOP.TO",
  "RY.TO",
  "TD.TO",
  "BN.TO",
  "CIFR",
];

function uniqueSymbols(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean))];
}

function collectSymbols() {
  const options = readCsv(dataDir, "universe_options_core.csv").map((row) => row.symbol);
  const highRisk = readCsv(dataDir, "universe_high_risk.csv").map((row) => row.symbol);
  const leaps = readCsv(dataDir, "universe_leaps_budget.csv").map((row) => row.symbol);
  const swingAlerts = readJson(reportsDir, "latest_alerts.json", []).map((row) => row.symbol);
  const highRiskAlerts = readJson(reportsDir, "latest_high_risk_alerts.json", []).map((row) => row.symbol);
  const longTermPack = readJson(dataDir, "long_term_starter_pack.json", null);
  const longTerm = (longTermPack?.holdings ?? []).map((row) => row.symbol);
  return uniqueSymbols([...EXTRA_SYMBOLS, ...options, ...highRisk, ...leaps, ...swingAlerts, ...highRiskAlerts, ...longTerm]);
}

async function run() {
  const symbols = collectSymbols();
  const results = {};
  const failures = {};

  for (const symbol of symbols) {
    try {
      console.log(`Analyzing ${symbol}`);
      results[symbol] = await analyzeStock(symbol);
    } catch (error) {
      console.warn(`Skipping ${symbol}: ${error.message}`);
      failures[symbol] = error.message;
    }
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    count: Object.keys(results).length,
    symbols: Object.keys(results).sort(),
    results,
    failures,
  };
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath} with ${payload.count} analyzer snapshots`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
