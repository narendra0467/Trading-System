import fs from "node:fs";

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

export function loadUniverseRecords(path) {
  const text = fs.readFileSync(path, "utf8").trim();
  if (!text) return [];
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(",").map((item) => item.trim());
  return lines.filter(Boolean).map((line) => {
    const columns = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, columns[index]?.trim() ?? ""]));
  });
}

export function loadUniverse(path) {
  const records = loadUniverseRecords(path);
  if (!records.some((record) => "symbol" in record)) {
    throw new Error("Universe CSV must include a symbol column");
  }

  const seen = new Set();
  return records
    .map((record) => record.symbol?.trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol) => {
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    });
}
