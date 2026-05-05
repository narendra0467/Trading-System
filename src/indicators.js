const last = (values) => values[values.length - 1];

export function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const window = values.slice(index + 1 - period, index + 1);
    return window.reduce((total, value) => total + value, 0) / period;
  });
}

export function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const output = [];
  let previous = null;
  for (const value of values) {
    previous = previous === null ? value : value * multiplier + previous * (1 - multiplier);
    output.push(previous);
  }
  return output;
}

export function rsi(values, period = 14) {
  const gains = [0];
  const losses = [0];
  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  const avgGain = ema(gains, period);
  const avgLoss = ema(losses, period);
  return values.map((_, index) => {
    if (index < period) return null;
    if (avgLoss[index] === 0) return 100;
    const rs = avgGain[index] / avgLoss[index];
    return 100 - 100 / (1 + rs);
  });
}

export function atr(rows, period = 14) {
  const ranges = rows.map((row, index) => {
    if (index === 0) return row.high - row.low;
    const previousClose = rows[index - 1].close;
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose)
    );
  });
  return ema(ranges, period);
}

export function dmi(rows, period = 14) {
  const plusDm = [0];
  const minusDm = [0];
  const trueRanges = [rows[0]?.high - rows[0]?.low || 0];

  for (let index = 1; index < rows.length; index += 1) {
    const upMove = rows[index].high - rows[index - 1].high;
    const downMove = rows[index - 1].low - rows[index].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(
      Math.max(
        rows[index].high - rows[index].low,
        Math.abs(rows[index].high - rows[index - 1].close),
        Math.abs(rows[index].low - rows[index - 1].close)
      )
    );
  }

  const smoothedTr = ema(trueRanges, period);
  const plusDi = ema(plusDm, period).map((value, index) => (smoothedTr[index] ? (100 * value) / smoothedTr[index] : null));
  const minusDi = ema(minusDm, period).map((value, index) => (smoothedTr[index] ? (100 * value) / smoothedTr[index] : null));
  const dx = plusDi.map((value, index) => {
    const total = value + minusDi[index];
    return total ? (100 * Math.abs(value - minusDi[index])) / total : null;
  });
  const adx = ema(dx.map((value) => value ?? 0), period);
  return { plusDi, minusDi, adx };
}

export function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const line = values.map((_, index) => ema12[index] - ema26[index]);
  const signal = ema(line, 9);
  return line.map((value, index) => ({
    line: value,
    signal: signal[index],
    histogram: value - signal[index],
  }));
}

export function highest(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    return Math.max(...values.slice(index + 1 - period, index + 1));
  });
}

export function lowest(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    return Math.min(...values.slice(index + 1 - period, index + 1));
  });
}

export function standardDeviation(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const window = values.slice(index + 1 - period, index + 1);
    const average = window.reduce((total, value) => total + value, 0) / period;
    const variance = window.reduce((total, value) => total + (value - average) ** 2, 0) / period;
    return Math.sqrt(variance);
  });
}

export function historicalVolatility(values, period = 20) {
  const returns = values.map((value, index) => (index === 0 ? null : Math.log(value / values[index - 1])));
  return returns.map((_, index) => {
    if (index + 1 < period || returns.slice(index + 1 - period, index + 1).some((value) => value === null)) return null;
    const window = returns.slice(index + 1 - period, index + 1);
    const average = window.reduce((total, value) => total + value, 0) / period;
    const variance = window.reduce((total, value) => total + (value - average) ** 2, 0) / (period - 1);
    return Math.sqrt(variance) * Math.sqrt(252);
  });
}

export function stochastic(rows, period = 14) {
  const highs = rows.map((row) => row.high);
  const lows = rows.map((row) => row.low);
  const closes = rows.map((row) => row.close);
  const highPeriod = highest(highs, period);
  const lowPeriod = lowest(lows, period);
  return closes.map((close, index) => {
    if (highPeriod[index] === null || lowPeriod[index] === null || highPeriod[index] === lowPeriod[index]) return null;
    return ((close - lowPeriod[index]) / (highPeriod[index] - lowPeriod[index])) * 100;
  });
}

export function obv(rows) {
  const output = [0];
  for (let index = 1; index < rows.length; index += 1) {
    const direction = rows[index].close > rows[index - 1].close ? 1 : rows[index].close < rows[index - 1].close ? -1 : 0;
    output.push(output[index - 1] + direction * rows[index].volume);
  }
  return output;
}

export function addIndicators(rows, benchmarkRows = []) {
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const benchmarkCloses = benchmarkRows.map((row) => row.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema150 = ema(closes, 150);
  const volume20 = sma(volumes, 20);
  const high55 = highest(closes, 55);
  const low20 = lowest(closes, 20);
  const high20 = highest(closes, 20);
  const std20 = standardDeviation(closes, 20);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(rows, 14);
  const dmi14 = dmi(rows, 14);
  const macdValues = macd(closes);
  const hv20 = historicalVolatility(closes, 20);
  const stoch14 = stochastic(rows, 14);
  const obvValues = obv(rows);
  const obvEma20 = ema(obvValues, 20);

  return rows.map((row, index) => {
    const return60 = index >= 60 ? row.close / closes[index - 60] - 1 : null;
    const benchmarkReturn60 =
      index >= 60 && benchmarkCloses[index] && benchmarkCloses[index - 60]
        ? benchmarkCloses[index] / benchmarkCloses[index - 60] - 1
        : null;
    return {
      ...row,
      ema20: ema20[index],
      ema50: ema50[index],
      ema150: ema150[index],
      ema50Slope20: index >= 20 ? ema50[index] / ema50[index - 20] - 1 : null,
      volume20: volume20[index],
      high55: high55[index],
      high20: high20[index],
      low20: low20[index],
      bollingerUpper20: std20[index] === null ? null : ema20[index] + 2 * std20[index],
      bollingerLower20: std20[index] === null ? null : ema20[index] - 2 * std20[index],
      rsi14: rsi14[index],
      atr14: atr14[index],
      plusDi14: dmi14.plusDi[index],
      minusDi14: dmi14.minusDi[index],
      adx14: dmi14.adx[index],
      macd: macdValues[index],
      hv20: hv20[index],
      stoch14: stoch14[index],
      obv: obvValues[index],
      obvEma20: obvEma20[index],
      relativeStrength60:
        return60 !== null && benchmarkReturn60 !== null ? return60 - benchmarkReturn60 : null,
    };
  });
}

export { last };
