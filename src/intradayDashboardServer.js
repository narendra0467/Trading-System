import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanIntraday, updateIntradayPaperLog } from "./intradayScanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const appDir = path.join(rootDir, "local-intraday");
const reportDir = path.join(rootDir, "local-reports");
const port = Number(process.env.INTRADAY_PORT || 6060);
const LOCAL_MARKET_TIME_ZONE = "America/Edmonton";
const AUTO_REFRESH_START_MINUTES = 7 * 60;
const AUTO_REFRESH_END_MINUTES = 14 * 60;
const AUTO_REFRESH_INTERVAL_MINUTES = 15;
let scheduledScanActive = false;
let lastScheduledScanSlot = null;

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? { symbol: "", signal: "", score: "" });
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function readJson(name, fallback) {
  const filePath = path.join(reportDir, name);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function sendStatic(response, requestPath) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.normalize(path.join(appDir, relativePath));
  if (!filePath.startsWith(appDir) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(fs.readFileSync(filePath));
}

async function runAndSaveScan() {
  const scan = await scanIntraday();
  fs.mkdirSync(reportDir, { recursive: true });
  scan.summary.paperResults = updateIntradayPaperLog(scan, reportDir);
  fs.writeFileSync(path.join(reportDir, "latest_intraday_summary.json"), JSON.stringify(scan.summary, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_alerts.json"), JSON.stringify(scan.tradeIdeas, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_results.json"), JSON.stringify(scan.results, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "latest_intraday_scan.csv"), toCsv(scan.results), "utf8");
  return scan;
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_MARKET_TIME_ZONE,
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
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function scheduledScanSlot(date = new Date()) {
  const parts = localParts(date);
  const minutes = parts.hour * 60 + parts.minute;
  const isWeekday = !["Sat", "Sun"].includes(parts.weekday);
  if (!isWeekday || minutes < AUTO_REFRESH_START_MINUTES || minutes > AUTO_REFRESH_END_MINUTES) return null;
  const slot = Math.floor((minutes - AUTO_REFRESH_START_MINUTES) / AUTO_REFRESH_INTERVAL_MINUTES);
  return `${parts.dateKey}|${slot}`;
}

async function runScheduledScan() {
  const slot = scheduledScanSlot();
  if (!slot || slot === lastScheduledScanSlot || scheduledScanActive) return;
  scheduledScanActive = true;
  try {
    lastScheduledScanSlot = slot;
    await runAndSaveScan();
    console.log(`Scheduled intraday scan completed for ${slot}`);
  } catch (error) {
    console.error(`Scheduled intraday scan failed: ${error.message}`);
  } finally {
    scheduledScanActive = false;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/intraday") {
    sendJson(response, {
      summary: readJson("latest_intraday_summary.json", null),
      alerts: readJson("latest_intraday_alerts.json", []),
      results: readJson("latest_intraday_results.json", []),
      paperResults: readJson("latest_intraday_paper_results.json", null),
    });
    return;
  }
  if (url.pathname === "/api/intraday/scan") {
    try {
      sendJson(response, await runAndSaveScan());
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }
  sendStatic(response, url.pathname);
});

server.listen(port, () => {
  console.log(`Local intraday dashboard running at http://127.0.0.1:${port}`);
  runScheduledScan();
  setInterval(runScheduledScan, 60 * 1000);
});
