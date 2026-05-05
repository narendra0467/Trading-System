export function calculatePositionPlan(idea, marketRegime, config = {}) {
  const settings = {
    accountSize: 100000,
    riskPct: 0.005,
    maxPositionPct: 0.05,
    contractMultiplier: 100,
    ...config,
  };
  const directionMultiplier =
    idea.beginnerStrategy === "BUY_PUT" || idea.strategy === "PUT_DEBIT_SPREAD"
      ? marketRegime.bearishSizeMultiplier
      : marketRegime.bullishSizeMultiplier;
  const maxRiskDollars = settings.accountSize * settings.riskPct * directionMultiplier;
  const maxPositionDollars = settings.accountSize * settings.maxPositionPct;
  const riskPerContract = Number.isFinite(idea.optionCost)
    ? idea.optionCost
    : Number.isFinite(idea.optionEntry)
      ? idea.optionEntry * settings.contractMultiplier
      : null;
  const maxContractsByRisk = riskPerContract ? Math.floor(maxRiskDollars / riskPerContract) : 0;
  const maxContractsByPosition = riskPerContract ? Math.floor(maxPositionDollars / riskPerContract) : 0;
  const contracts = Math.max(0, Math.min(maxContractsByRisk, maxContractsByPosition));

  return {
    accountSize: settings.accountSize,
    riskPct: settings.riskPct,
    maxRiskDollars: Number(maxRiskDollars.toFixed(2)),
    riskPerContract: riskPerContract === null ? null : Number(riskPerContract.toFixed(2)),
    riskPerSpread: riskPerContract === null ? null : Number(riskPerContract.toFixed(2)),
    contracts,
    plannedCapital: riskPerContract === null ? null : Number((contracts * riskPerContract).toFixed(2)),
    marketRegime: marketRegime.regime,
    sizeMultiplier: directionMultiplier,
  };
}

export function applyPortfolioGuards(ideas, config = {}) {
  const settings = { maxAlerts: 5, maxSameStrategy: 3, ...config };
  const strategyCounts = new Map();
  return ideas.map((idea) => {
    if (!idea.signal?.includes("SETUP")) return idea;
    const strategy = idea.beginnerStrategy || idea.strategy;
    const current = strategyCounts.get(strategy) ?? 0;
    if (current >= settings.maxSameStrategy) {
      return { ...idea, signal: "WATCH", guardrail: `Max ${strategy} ideas already reached` };
    }
    strategyCounts.set(strategy, current + 1);
    return idea;
  }).map((idea, index) => {
    if (index >= settings.maxAlerts && idea.signal?.includes("SETUP")) {
      return { ...idea, signal: "WATCH", guardrail: "Outside top alert budget" };
    }
    return idea;
  });
}
