# Trading System

Technical trading scanner for stock options, high-risk/high-reward speculation, long-term core holdings, and intraday index ETF ideas.

The system scans configurable universes, ranks technical setups, and writes beginner-friendly alerts. It is not financial advice; it is a decision-support tool for disciplined review.

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

The high-risk scanner is for a separate speculative sleeve, such as `$5,000` that the user accepts could be lost. It scans U.S. and Canadian high-beta names across crypto, AI software, quantum, semiconductors, fintech, space, and other volatile themes.

It emphasizes technical analysis:

- 20-day and 60-day momentum.
- Relative strength versus U.S. and Canadian risk indexes.
- 55-day breakout behavior.
- Volume confirmation.
- RSI, MACD, ADX/DMI, ATR, and historical volatility.
- Buy zone, stop loss, target 1, target 2, and 100% moonshot target.

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

## Simple Stock Options Scanner

The options scanner is separate from the mid-cap stock scanner. It is designed for 15-20 high-volume single-stock options names such as `TSLA`, `SNDK`, `MU`, `AMD`, `AAPL`, `NVDA`, `C`, `INTC`, `AMZN`, `GOOGL`, `META`, `MSFT`, `MSTR`, `AVGO`, `ORCL`, `PLTR`, `WDC`, `NFLX`, `TSM`, and `COIN`. Index ETFs are kept out of this long-options watchlist and used for the intraday scanner instead.

It checks the underlying first, then the option chain:

- Trend regime: EMA 20/50/150 stack, 50 EMA slope, ADX/DMI, price versus short-term highs/lows.
- Momentum: RSI, MACD histogram, stochastic context.
- Participation: volume expansion, OBV versus OBV EMA.
- Volatility bands: Bollinger upper/lower band context.
- Relative strength: 60-day performance versus benchmark.
- Volatility: 20-day historical volatility versus option implied volatility.
- Risk: ATR-based underlying stop and target.
- Options quality: 21-60 DTE, bid/ask spread, volume, open interest, estimated delta, and a simple buy-call/buy-put plan with option cost, stop, and target.

Run it with:

```powershell
npm run options:scan
```

Outputs are written to `reports/latest_options_scan.csv` and `reports/latest_options_alerts.json`.

The default options sizing assumes a `$100,000` account and `1%` max risk per trade. Override it:

```powershell
npm run options:scan -- --account-size=50000 --risk-pct=0.0075
```

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
npm run intraday:scan -- --universe=data/universe_intraday_indexes.csv
```

The default intraday universe is `data/universe_intraday_indexes.csv`, currently `SPY`, `QQQ`, `IWM`, `DIA`, `TQQQ`, and `SQQQ`.

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

## Notes

- Default stock swing universe is `data/universe_swing_core.csv`.
- `data/universe_sp400_seed.csv` is kept only as the original MidCap 400 top-weight seed list.
- The default stock swing benchmark is `QQQ`; use `IJH` when scanning only MidCap 400 names.
