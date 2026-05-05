import fs from "node:fs";

export function writeTradeJournal(path, ideas) {
  const existing = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
  const byId = new Map(existing.map((item) => [item.id, item]));
  const now = new Date().toISOString();

  for (const idea of ideas) {
    if (!idea.signal?.includes("SETUP")) continue;
    const id = `${idea.symbol}-${idea.strategy}-${idea.expiration}-${idea.longStrike}-${idea.shortStrike}`;
    byId.set(id, {
      ...byId.get(id),
      id,
      status: byId.get(id)?.status ?? "WATCHING",
      createdAt: byId.get(id)?.createdAt ?? now,
      updatedAt: now,
      latestIdea: idea,
    });
  }

  const next = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  fs.writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
  return next;
}

