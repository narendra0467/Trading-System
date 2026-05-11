import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildDashboardData } from "./dashboardData.js";
import { fetchYahooSymbolSearch } from "./marketData.js";
import { analyzeStock } from "./stockAnalyzer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const reportsDir = path.join(rootDir, "reports");
const dataDir = path.join(rootDir, "data");
const port = Number(process.env.PORT || 5050);
const host = process.env.HOST || "0.0.0.0";
const hiddenScanTimeZone = process.env.HIDDEN_SCAN_TIMEZONE || "America/Edmonton";
const hiddenScanDay = Number(process.env.HIDDEN_SCAN_DAY || "1");
const hiddenScanHour = Number(process.env.HIDDEN_SCAN_HOUR || "7");
const hiddenScanMinuteWindow = Number(process.env.HIDDEN_SCAN_MINUTE_WINDOW || "10");
const hiddenScanEnabled = !["0", "false", "off"].includes(String(process.env.HIDDEN_SCAN_SCHEDULED || "true").toLowerCase());
const leapsScanTimeZone = process.env.LEAPS_SCAN_TIMEZONE || "America/Edmonton";
const leapsScanEnabled = !["0", "false", "off"].includes(String(process.env.LEAPS_SCAN_SCHEDULED || "true").toLowerCase());
let hiddenScanRunning = false;
let lastHiddenScanKey = "";
let leapsScanRunning = false;
let lastLeapsScanKey = "";
let dashboardRefreshRunning = false;
let dashboardRefreshStatus = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastExitCode: null,
  lastError: null,
};

const weekdayIndex = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function sendJson(response, payload) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, message, status = 500) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify({ error: message }));
}

function serveStatic(response, requestPath) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.normalize(path.join(publicDir, relativePath));
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const extension = path.extname(filePath);
  const contentType =
    extension === ".css"
      ? "text/css"
      : extension === ".js"
        ? "text/javascript"
        : extension === ".json"
          ? "application/json"
          : "text/html";
  response.writeHead(200, { "Content-Type": contentType });
  response.end(fs.readFileSync(filePath));
}

function serveReport(response, requestPath) {
  const relativePath = requestPath.replace(/^\/reports\//, "");
  const filePath = path.normalize(path.join(reportsDir, relativePath));
  if (!filePath.startsWith(reportsDir) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Report not found");
    return;
  }
  const extension = path.extname(filePath);
  const contentType =
    extension === ".html"
      ? "text/html"
      : extension === ".json"
        ? "application/json"
        : extension === ".csv"
          ? "text/csv"
          : "text/plain";
  response.writeHead(200, { "Content-Type": contentType });
  response.end(fs.readFileSync(filePath));
}

function localTimeParts(date = new Date(), timeZone = hiddenScanTimeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    dayIndex: weekdayIndex[parts.weekday] ?? -1,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function runHiddenMultibaggerScan(reason = "manual") {
  if (hiddenScanRunning) {
    console.log("Hidden multibagger scan skipped; previous scan is still running.");
    return;
  }
  hiddenScanRunning = true;
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`Starting hidden multibagger scan (${reason})...`);
  const child = spawn(npmCommand, ["run", "hidden:scan"], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    hiddenScanRunning = false;
    console.log(`Hidden multibagger scan finished with exit code ${code}.`);
  });
  child.on("error", (error) => {
    hiddenScanRunning = false;
    console.error(`Hidden multibagger scan failed to start: ${error.message}`);
  });
}

function runNpmScript(script, label, onDone) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`Starting ${label}...`);
  const child = spawn(npmCommand, ["run", script], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.log(`${label} finished with exit code ${code}.`);
    onDone?.();
  });
  child.on("error", (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    onDone?.();
  });
}

function runDashboardRefresh(reason = "manual") {
  if (dashboardRefreshRunning) {
    return { started: false, running: true, message: "Dashboard refresh is already running." };
  }
  dashboardRefreshRunning = true;
  dashboardRefreshStatus = {
    running: true,
    lastStartedAt: new Date().toISOString(),
    lastFinishedAt: null,
    lastExitCode: null,
    lastError: null,
  };
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`Starting dashboard refresh (${reason})...`);
  const child = spawn(npmCommand, ["run", "refresh:all"], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    dashboardRefreshRunning = false;
    dashboardRefreshStatus = {
      ...dashboardRefreshStatus,
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastExitCode: code,
      lastError: code === 0 ? null : `refresh:all exited with code ${code}`,
    };
    console.log(`Dashboard refresh finished with exit code ${code}.`);
  });
  child.on("error", (error) => {
    dashboardRefreshRunning = false;
    dashboardRefreshStatus = {
      ...dashboardRefreshStatus,
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastExitCode: null,
      lastError: error.message,
    };
    console.error(`Dashboard refresh failed to start: ${error.message}`);
  });
  return { started: true, running: true, message: "Dashboard refresh started. This can take a few minutes." };
}

function runLeapsScan(reason = "manual") {
  if (leapsScanRunning) {
    console.log("LEAPS scan skipped; previous LEAPS scan is still running.");
    return;
  }
  leapsScanRunning = true;
  runNpmScript("leaps:scan", `LEAPS scan (${reason})`, () => {
    leapsScanRunning = false;
  });
}

function scheduledHiddenScanTick(now = new Date()) {
  if (!hiddenScanEnabled) return;
  const parts = localTimeParts(now);
  const inWindow = parts.dayIndex === hiddenScanDay &&
    parts.hour === hiddenScanHour &&
    parts.minute >= 0 &&
    parts.minute < hiddenScanMinuteWindow;
  if (!inWindow || lastHiddenScanKey === parts.dateKey) return;
  lastHiddenScanKey = parts.dateKey;
  runHiddenMultibaggerScan(`weekly Monday 7 AM ${hiddenScanTimeZone}`);
}

function scheduledLeapsScanTick(now = new Date()) {
  if (!leapsScanEnabled) return;
  const parts = localTimeParts(now, leapsScanTimeZone);
  if (parts.dayIndex === 0 || parts.dayIndex === 6) return;
  const slots = [];
  if (parts.hour === 7 && parts.minute < 10) {
    slots.push("daily-7am-risk-check");
  }
  if (parts.hour === 14 && parts.minute >= 10 && parts.minute < 25) {
    slots.push("daily-after-close-health-check");
  }
  if (parts.dayIndex === 5 && parts.hour === 14 && parts.minute >= 30 && parts.minute < 45) {
    slots.push("friday-weekly-deep-review");
  }
  if (parts.dayIndex === 1 && Number(parts.dateKey.slice(-2)) <= 7 && parts.hour === 7 && parts.minute >= 30 && parts.minute < 45) {
    slots.push("monthly-concentration-replacement-review");
  }
  for (const slot of slots) {
    const key = `${parts.dateKey}|${slot}`;
    if (lastLeapsScanKey === key) continue;
    lastLeapsScanKey = key;
    runLeapsScan(`${slot} ${leapsScanTimeZone}`);
    break;
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }
  if (url.pathname === "/api/dashboard") {
    sendJson(response, buildDashboardData({ reportsDir, dataDir }));
    return;
  }
  if (url.pathname === "/api/analyze") {
    const symbol = url.searchParams.get("symbol") ?? "";
    analyzeStock(symbol)
      .then((payload) => sendJson(response, payload))
      .catch((error) => sendError(response, error.message));
    return;
  }
  if (url.pathname === "/api/search-symbols") {
    const query = url.searchParams.get("q") ?? "";
    fetchYahooSymbolSearch(query)
      .then((results) => sendJson(response, { query, results }))
      .catch((error) => sendError(response, error.message));
    return;
  }
  if (url.pathname === "/api/leaps/scan") {
    runLeapsScan("manual API request");
    sendJson(response, { ok: true, message: "LEAPS scan started. Refresh the dashboard in a minute or two." });
    return;
  }
  if (url.pathname === "/api/refresh") {
    sendJson(response, { ok: true, ...runDashboardRefresh("manual API request") });
    return;
  }
  if (url.pathname === "/api/refresh/status") {
    sendJson(response, { ok: true, ...dashboardRefreshStatus });
    return;
  }
  if (url.pathname.startsWith("/reports/")) {
    serveReport(response, url.pathname);
    return;
  }
  serveStatic(response, url.pathname);
});

server.listen(port, host, () => {
  console.log(`Trading dashboard running at http://127.0.0.1:${port}`);
  console.log(`Hidden multibagger weekly refresh: ${hiddenScanEnabled ? `enabled for Monday 7:00 AM ${hiddenScanTimeZone}` : "disabled"}`);
  console.log(`LEAPS scheduled refresh: ${leapsScanEnabled ? `enabled for 7:00 AM, after close, Friday review, and monthly review in ${leapsScanTimeZone}` : "disabled"}`);
  scheduledHiddenScanTick();
  scheduledLeapsScanTick();
  setInterval(scheduledHiddenScanTick, 60 * 1000);
  setInterval(scheduledLeapsScanTick, 60 * 1000);
});
