import fs from "node:fs";
import path from "node:path";

export function parseCsvLine(line) {
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

export function readJson(dir, name, fallback) {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readCsv(dir, name) {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.filter(Boolean).map((line) => {
    const columns = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [
      header,
      columns[index] ?? "",
    ]));
  });
}

export function buildDashboardData({ reportsDir, dataDir, updatedAt = new Date().toISOString() }) {
  return {
    marketRegime: readJson(reportsDir, "latest_market_regime.json", null),
    stockAlerts: readJson(reportsDir, "latest_alerts.json", []),
    longTermStarterPack: readJson(dataDir, "long_term_starter_pack.json", null),
    optionsAlerts: readJson(reportsDir, "latest_options_alerts.json", []),
    intradayAlerts: readJson(reportsDir, "latest_intraday_alerts.json", []),
    intradaySummary: readJson(reportsDir, "latest_intraday_summary.json", null),
    highRiskAlerts: readJson(reportsDir, "latest_high_risk_alerts.json", []),
    highRiskSummary: readJson(reportsDir, "latest_high_risk_summary.json", null),
    stockScan: readCsv(reportsDir, "latest_scan.csv"),
    highRiskScan: readCsv(reportsDir, "latest_high_risk_scan.csv"),
    optionsScan: readCsv(reportsDir, "latest_options_scan.csv"),
    intradayScan: readCsv(reportsDir, "latest_intraday_scan.csv"),
    backtest: readCsv(reportsDir, "latest_backtest.csv"),
    journal: readJson(reportsDir, "trade_journal.json", []),
    updatedAt,
  };
}
