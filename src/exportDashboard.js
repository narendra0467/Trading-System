import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDashboardData } from "./dashboardData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "public", "dashboard.json");

const payload = buildDashboardData({
  reportsDir: path.join(rootDir, "reports"),
  dataDir: path.join(rootDir, "data"),
});

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
