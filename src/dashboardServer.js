import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const reportsDir = path.join(rootDir, "reports");
const dataDir = path.join(rootDir, "data");
const port = Number(process.env.PORT || 5050);

function readJson(name, fallback) {
  const filePath = path.join(reportsDir, name);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readDataJson(name, fallback) {
  const filePath = path.join(dataDir, name);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readCsv(name) {
  const filePath = path.join(reportsDir, name);
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

function parseCsvLine(line) {
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

function sendJson(response, payload) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
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
  const contentType = extension === ".css" ? "text/css" : extension === ".js" ? "text/javascript" : "text/html";
  response.writeHead(200, { "Content-Type": contentType });
  response.end(fs.readFileSync(filePath));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (url.pathname === "/api/dashboard") {
    sendJson(response, {
      marketRegime: readJson("latest_market_regime.json", null),
      stockAlerts: readJson("latest_alerts.json", []),
      longTermStarterPack: readDataJson("long_term_starter_pack.json", null),
      optionsAlerts: readJson("latest_options_alerts.json", []),
      intradayAlerts: readJson("latest_intraday_alerts.json", []),
      intradaySummary: readJson("latest_intraday_summary.json", null),
      stockScan: readCsv("latest_scan.csv"),
      optionsScan: readCsv("latest_options_scan.csv"),
      intradayScan: readCsv("latest_intraday_scan.csv"),
      backtest: readCsv("latest_backtest.csv"),
      journal: readJson("trade_journal.json", []),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  serveStatic(response, url.pathname);
});

server.listen(port, () => {
  console.log(`Trading dashboard running at http://127.0.0.1:${port}`);
});
