# Trading System

Technical trading scanner for stock options, high-risk/high-reward speculation, long-term core holdings, and swing-trade snapshots.

The system scans configurable universes, ranks technical setups, and writes beginner-friendly alerts. It is not financial advice; it is a decision-support tool for disciplined review.

## Institutional Research PDF

Generate the default AMZN buy-side style investment memo with official filing/source validation, peer grouping, valuation, catalysts, risks, technical analysis, and a buying plan:

```powershell
npm run research:pdf
```

Outputs:

- `reports/AMZN_institutional_research_report.html`
- `reports/AMZN_institutional_research_report.pdf`

The current institutional template is intentionally AMZN-specific so peer matching stays clean. It uses Amazon Investor Relations, SEC filings, and local market-data endpoints; missing market fields are labeled instead of filled with guesses.

## What It Checks

- Trend: price above rising moving averages.
- Momentum: RSI and MACD confirmation.
- Breakout: close near or above recent highs.
- Volume: participation above normal volume.
- Relative strength: stock performance versus benchmark.
- Risk: ATR stop and initial target zones.

## Stock Swing Scanner

The stock swing scanner still exists as a backend report generator, but it is no longer a main dashboard tab. The dashboard now emphasizes the high-risk speculative tab instead.

The scanner is designed for bigger 2-8 week moves. Its default universe is `data/universe_swing_core.csv`, a larger liquid list of high-beta growth stocks, AI/semiconductor leaders, software names, crypto proxies, consumer momentum names, and selected MidCap 400 leaders.

It writes:

- `reports/latest_scan.csv`
- `reports/latest_alerts.json`

Run it with:

```powershell
npm run scan
```

The backend report includes:

- `BUY_SETUP`, `WATCH`, `HOLD_TREND`, and `EXIT_WARNING`.
- Buy zone, stop, first target, main target, and risk percent.
- A 2-8 week hold plan for each setup.

## High Risk / High Reward Scanner

The high-risk scanner is for a separate speculative sleeve, such as `$5,000` that the user accepts could be lost. It scans U.S. and Canadian moonshot-style small/mid-cap names across crypto miners, AI software, quantum, fintech, space, biotech, EV, and junior resource themes. Large liquid momentum names such as `MU`, `WDC`, and `SNDK` are kept out of this moonshot universe.

It emphasizes technical analysis:

- 20-day and 60-day momentum.
- Relative strength versus U.S. and Canadian risk indexes.
- 55-day breakout behavior.
- Volume confirmation.
- RSI, MACD, ADX/DMI, ATR, and historical volatility.
- Buy zone, stop loss, target 1, target 2, and 100% moonshot target.
- Manual macro/news risk from `data/event_calendar.csv`, including Fed, CPI, jobs, war/geopolitics, political/tariff events, earnings, and sector-specific shocks.

The raw technical score is kept inside the reports for sorting. The dashboard presents it like a client note instead: conviction, action, setup read, buy zone, stop, targets, and event-risk warning.

Run it with:

```powershell
npm run highrisk:scan
```

It writes:

- `reports/latest_high_risk_scan.csv`
- `reports/latest_high_risk_alerts.json`
- `reports/latest_high_risk_summary.json`

## 15-Year Core Starter Pack

The dashboard also includes a `15-Year Core` tab for a beginner-friendly long-term portfolio. This is separate from trading alerts. It uses fundamental quality, diversification, low-cost ETFs, moat strength, cash generation, balance-sheet durability, and long reinvestment runway to build a sample `$10,000` starter allocation.

The starter-pack data lives in:

- `data/long_term_starter_pack.json`

Current structure:

- 7 total holdings.
- ETFs as the base: S&P 500, Nasdaq 100 growth, and dividend quality.
- Individual stocks as satellites: durable compounders across capital allocation, software/cloud, digital commerce, and AI infrastructure.
- Review rules for when the business quality breaks instead of reacting to normal market drops.

## Long-Term Index Leaders Report

The long-term index report pulls the current top holdings from official iShares ETF holding files, then runs each company through the local stock analyzer as a 5-year hold screen.

Default universe:

- Top 50 holdings from `IVV`, used as the S&P 500 proxy.
- Top 20 holdings from `IWM`, used as the Russell 2000 proxy.

Run it with:

```powershell
npm run longterm:index
```

Override the counts:

```powershell
npm run longterm:index -- --sp500=25 --iwm=10
```

Outputs are written to:

- `reports/latest_long_term_index_report.md`
- `reports/latest_long_term_index_report.csv`
- `reports/latest_long_term_index_report.json`

The Markdown report includes dashboard scores, business-model notes, growth/valuation/risk checks, final labels, and a short thesis for each stock. Treat it as a repeatable research screen, then verify segment details, earnings-release commentary, and annual-report context from official company filings before making a portfolio decision.

## Simple Stock Options Scanner

The options scanner is separate from the mid-cap stock scanner. It is designed for 15-20 high-volume single-stock options names such as `TSLA`, `SNDK`, `MU`, `AMD`, `AAPL`, `NVDA`, `C`, `INTC`, `AMZN`, `GOOGL`, `META`, `MSFT`, `MSTR`, `AVGO`, `ORCL`, `PLTR`, `WDC`, `NFLX`, `TSM`, and `COIN`.

It checks the underlying first, then the option chain:

- Trend regime: EMA 20/50/150 stack, 50 EMA slope, ADX/DMI, price versus short-term highs/lows.
- Momentum: RSI, MACD histogram, stochastic context.
- Participation: volume expansion, OBV versus OBV EMA.
- Volatility bands: Bollinger upper/lower band context.
- Relative strength: 60-day performance versus benchmark.
- Volatility: 20-day historical volatility versus option implied volatility.
- Risk: ATR-based underlying stop and target.
- Options quality: 30-50 DTE by default, bid/ask spread, volume, open interest, estimated delta, and a simple buy-call/buy-put plan with option cost, stop, and target.

Run it with:

```powershell
npm run options:scan
```

Outputs are written to `reports/latest_options_scan.csv` and `reports/latest_options_alerts.json`.

The default options sizing assumes a `$100,000` account and `1%` max risk per trade. Override it:

```powershell
npm run options:scan -- --account-size=50000 --risk-pct=0.0075
```

## SPY / QQQ Swing Options Signal Engine

The local dashboard includes a conservative SPY/QQQ-only signal engine:

```powershell
npm run signals:scan
```

When the dashboard server is running, the same output is available at `GET /api/signals`.

This engine is signal-only. It never sends orders and it deliberately prefers `NO_TRADE` over low-quality ideas. It combines `indicators.js`, `regimeEngine.js`, `timeframeEngine.js`, `setupEngine.js`, `triggerEngine.js`, `optionsFilter.js`, `riskEngine.js`, `eventRiskEngine.js`, `signalEngine.js`, and `signalScanner.js`. The existing `scanner.js` still owns the older stock scanner and re-exports `scanSignals` for compatibility.

Final statuses are `A_PLUS_TRADE`, `WATCH_FOR_TRIGGER`, or `NO_TRADE`. The dashboard card shows symbol, direction, confidence, DTE, selected contract, bid/ask/mid, one-contract cost, spread, trigger, invalidation, targets, reasons, warnings, event risk, last updated time, and next scan time.

The scanner also writes:

- `reports/latest_market_regime.json`
- `reports/trade_journal.json`
- `reports/latest_backtest.csv`
- `reports/latest_backtest_trades.json`

## Quick Start

```powershell
npm run scan
```

Outputs are written to `reports/latest_scan.csv` and `reports/latest_alerts.json`.

Optional arguments:

```powershell
npm run scan -- --universe=data/universe_sp400_seed.csv --benchmark=IJH --range=18mo
npm run scan -- --universe=data/universe_swing_core.csv --benchmark=QQQ --range=18mo
npm run options:scan -- --universe=data/universe_options_core.csv --benchmark=QQQ --range=18mo
npm run highrisk:scan -- --universe=data/universe_high_risk.csv
```

## Local Dashboard

```powershell
npm start
```

Open `http://127.0.0.1:5050`.

## Free Hosting

This project is ready for Render free web-service hosting with `render.yaml`.

Recommended path:

1. Push this folder to a GitHub repository.
2. In Render, create a new web service from that GitHub repo.
3. Use the free plan.
4. Render will use `npm install` and `npm start`.

GitHub Pages is also free, but it only hosts static files. This dashboard currently uses a small Node API, so Render is the cleaner fit.

The repo also includes a GitHub Pages workflow for a shareable static dashboard. Before pushing a static refresh, run:

```powershell
npm run export:static
```

GitHub also has a scheduled refresh workflow in `.github/workflows/refresh-data.yml`. It runs twice on weekdays: about one hour after U.S. market open and about one hour before U.S. market close during daylight saving time. It refreshes high-risk, stock swing, options, backtest, exports `public/dashboard.json`, and commits the refreshed data back to the repo.

For a manual full refresh:

```powershell
npm run refresh:all
```

Intraday every-5-minute updates are intentionally excluded from this public GitHub Pages dashboard. We will build that later as a separate local/live system.

## Notes

- Default stock swing universe is `data/universe_swing_core.csv`.
- `data/universe_sp400_seed.csv` is kept only as the original MidCap 400 top-weight seed list.
- The default stock swing benchmark is `QQQ`; use `IJH` when scanning only MidCap 400 names.
