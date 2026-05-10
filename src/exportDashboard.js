import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDashboardData } from "./dashboardData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "public", "dashboard.json");
const publicReportsDir = path.join(rootDir, "public", "reports");
const reportCopies = [
  "leaps_call_opportunity_desk.html",
  "hidden_multibagger_discovery_scanner.html",
];

const payload = buildDashboardData({
  reportsDir: path.join(rootDir, "reports"),
  dataDir: path.join(rootDir, "data"),
});

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

fs.mkdirSync(publicReportsDir, { recursive: true });
for (const name of reportCopies) {
  const source = path.join(rootDir, "reports", name);
  if (!fs.existsSync(source)) continue;
  const target = path.join(publicReportsDir, name);
  fs.copyFileSync(source, target);
  console.log(`Wrote ${target}`);
}
