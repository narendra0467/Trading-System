import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDashboardData } from "./dashboardData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const reportsDir = path.join(rootDir, "reports");
const dataDir = path.join(rootDir, "data");
const port = Number(process.env.PORT || 5050);

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

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (url.pathname === "/api/dashboard") {
    sendJson(response, buildDashboardData({ reportsDir, dataDir }));
    return;
  }
  serveStatic(response, url.pathname);
});

server.listen(port, () => {
  console.log(`Trading dashboard running at http://127.0.0.1:${port}`);
});
