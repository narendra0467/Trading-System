function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return sign * y;
}

export function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

export function normalPdf(value) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

export function blackScholesGreeks({ type, underlying, strike, dte, iv, riskFreeRate = 0.04 }) {
  if (![underlying, strike, dte, iv].every(Number.isFinite) || underlying <= 0 || strike <= 0 || dte <= 0 || iv <= 0) {
    return { delta: null, gamma: null, theta: null, vega: null, probabilityItm: null };
  }

  const t = dte / 365;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(underlying / strike) + (riskFreeRate + 0.5 * iv * iv) * t) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const pdfD1 = normalPdf(d1);
  const gamma = pdfD1 / (underlying * iv * sqrtT);
  const vega = (underlying * pdfD1 * sqrtT) / 100;

  if (type === "call") {
    const delta = normalCdf(d1);
    const theta =
      (-(underlying * pdfD1 * iv) / (2 * sqrtT) -
        riskFreeRate * strike * Math.exp(-riskFreeRate * t) * normalCdf(d2)) /
      365;
    return { delta, gamma, theta, vega, probabilityItm: normalCdf(d2) };
  }

  const delta = normalCdf(d1) - 1;
  const theta =
    (-(underlying * pdfD1 * iv) / (2 * sqrtT) +
      riskFreeRate * strike * Math.exp(-riskFreeRate * t) * normalCdf(-d2)) /
    365;
  return { delta, gamma, theta, vega, probabilityItm: normalCdf(-d2) };
}

