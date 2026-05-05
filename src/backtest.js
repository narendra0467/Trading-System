import { addIndicators } from "./indicators.js";

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function hasLongSetup(row, previous) {
  return (
    row.close > row.ema20 &&
    row.ema20 > row.ema50 &&
    row.ema50 > row.ema150 &&
    row.ema50Slope20 > 0.01 &&
    row.rsi14 >= 50 &&
    row.rsi14 <= 75 &&
    row.macd.histogram > previous.macd.histogram &&
    row.relativeStrength60 > -0.02
  );
}

export function backtestLongSwing(symbol, rows, benchmarkRows, config = {}) {
  const settings = { maxHoldDays: 25, atrStop: 1.5, atrTarget: 3, ...config };
  const enriched = addIndicators(rows, benchmarkRows);
  const trades = [];
  let index = 160;

  while (index < enriched.length - 2) {
    const row = enriched[index];
    const previous = enriched[index - 1];
    if (!hasLongSetup(row, previous)) {
      index += 1;
      continue;
    }

    const entry = enriched[index + 1].open;
    const stop = Math.max(row.ema50, row.close - settings.atrStop * row.atr14);
    const target = row.close + settings.atrTarget * row.atr14;
    let exit = enriched[Math.min(index + settings.maxHoldDays, enriched.length - 1)];
    let exitReason = "time";

    for (let cursor = index + 1; cursor <= Math.min(index + settings.maxHoldDays, enriched.length - 1); cursor += 1) {
      const current = enriched[cursor];
      if (current.low <= stop) {
        exit = { ...current, close: stop };
        exitReason = "stop";
        break;
      }
      if (current.high >= target) {
        exit = { ...current, close: target };
        exitReason = "target";
        break;
      }
      if (current.close < current.ema20 && cursor > index + 5) {
        exit = current;
        exitReason = "trend_loss";
        break;
      }
    }

    trades.push({
      symbol,
      entryDate: enriched[index + 1].date,
      exitDate: exit.date,
      entry: round(entry),
      exit: round(exit.close),
      returnPct: round(((exit.close - entry) / entry) * 100, 2),
      exitReason,
    });
    index += settings.maxHoldDays;
  }

  const winners = trades.filter((trade) => trade.returnPct > 0);
  const grossWin = winners.reduce((total, trade) => total + trade.returnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.returnPct <= 0).reduce((total, trade) => total + trade.returnPct, 0));
  return {
    symbol,
    trades: trades.length,
    winRate: trades.length ? round((winners.length / trades.length) * 100, 1) : 0,
    avgReturnPct: trades.length ? round(trades.reduce((total, trade) => total + trade.returnPct, 0) / trades.length, 2) : 0,
    profitFactor: grossLoss ? round(grossWin / grossLoss, 2) : null,
    tradeLog: trades,
  };
}

