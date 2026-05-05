import fs from "node:fs";

export function loadEventCalendar(path = "data/event_calendar.csv") {
  if (!fs.existsSync(path)) return [];
  const text = fs.readFileSync(path, "utf8").trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(",").map((item) => item.trim());
  return lines.map((line) => {
    const columns = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, columns[index]?.trim() ?? ""]));
  });
}

export function getEventRisk(symbol, events, lookaheadDays = 10) {
  const today = new Date();
  const upcoming = events
    .filter((event) => event.symbol === symbol || event.symbol === "ALL")
    .filter((event) => event.date)
    .map((event) => ({ ...event, dateObject: new Date(`${event.date}T00:00:00`) }))
    .filter((event) => {
      const days = (event.dateObject - today) / (24 * 60 * 60 * 1000);
      return days >= 0 && days <= lookaheadDays;
    });

  if (upcoming.length === 0) {
    const manual = events.find((event) => (event.symbol === symbol || event.symbol === "ALL") && !event.date);
    return manual ? { level: "MANUAL_CHECK", reason: manual.event } : { level: "CLEAR", reason: "No dated event in window" };
  }

  return {
    level: upcoming.some((event) => event.impact === "high") ? "HIGH" : "MEDIUM",
    reason: upcoming.map((event) => `${event.event} ${event.date}`).join("; "),
  };
}
