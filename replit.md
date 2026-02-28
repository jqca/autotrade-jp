# AutoTrade JP - Japanese Stock Automated Trading App

## Overview
A simulated Japanese stock automated trading platform with all 3,771 TSE-listed domestic stocks. Users can monitor stock prices, create automated trading strategies, view trade history, and manage their portfolio.

## Architecture
- **Frontend**: React + TypeScript with Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: wouter (frontend), Express (backend)
- **State Management**: TanStack React Query
- **Charts**: recharts (price charts, technical indicators)

## Key Features
1. **Dashboard** - Portfolio overview, recent trades, top movers, scheduler/batch status
2. **Watchlist** - Japanese stock monitoring with search/pagination (3,771 stocks), simulated price updates
3. **Stock Detail** - Historical price chart, technical indicators (MACD, RSI, Moving Averages, Bollinger Bands), signal analysis
4. **Signals** - Buy/sell signal overview filtered by technical indicators, search, count summary cards
5. **Backtest** - Configurable backtest simulation with adjustable parameters (target %, indicator count, RSI range, MA filter, sim days), multiple pattern comparison, run history with config metadata
5b. **Risk Alert** - Market crash risk detection comparing classical anomaly detection vs QML (Quantum Machine Learning) with PennyLane
5c. **Quantum Portfolio Optimization** - QAOA-based portfolio optimization comparing classical Markowitz vs quantum QAOA for selecting optimal stock allocation from buy-signal candidates
5d. **Quantum VaR Analysis** - Classical Monte Carlo vs Quantum Monte Carlo (amplitude estimation) Value at Risk comparison with CVaR, percentile distribution, and quantum circuit details
6. **Strategies** - Create/manage automated trading rules (price drop buy, price rise sell, threshold buy/sell)
6. **Trade History** - Complete trade log
7. **Portfolio** - Current holdings with P&L tracking
8. **JPX Import** - Import all TSE-listed domestic stocks from JPX official data
9. **Batch Price Fetch** - Fetch real prices from Yahoo Finance in batches

## Data Models
- `stocks` - Japanese stock data (ticker, name, sector, prices, volume) - 3,771 stocks
- `strategies` - Automated trading rules with conditions
- `trades` - Trade execution history
- `portfolio_positions` - Current holdings
- `technical_indicators` - Pre-computed technical indicators per stock, supports both daily ("1d") and 5-minute ("5m") timeframes via composite unique (ticker, timeframe)
- `backtest_runs` - Backtest run configurations (target %, min indicators, RSI range, MA filter, sim days)
- `backtest_results` - Backtest simulation results (signal date, buy/sell prices, win/loss, indicator trends)
- `intraday_prices` - Stored intraday bar data (ticker, datetime, OHLCV, interval) with unique index on (ticker, datetime, interval), 120-day retention. Intervals: 5m, 10m (aggregated from 5m), 30m (aggregated from 5m)
- `market_risk_assessments` - Risk assessment results from classical and QML methods (risk score, level, sub-scores, details JSON)
- `quantum_benchmark_runs` - Quantum benchmark execution history (risk/portfolio/VaR/kernel results as JSON, data source, summary, execution time, stock count)

## Project Structure
```
client/src/
  pages/         - Dashboard, Watchlist, StockDetail, Signals, Backtest, RiskAlert, PortfolioOptimize, VarAnalysis, Strategies, Trades, Portfolio
  components/    - AppSidebar, ThemeToggle, UI components
server/
  routes.ts      - API endpoints and seed data
  storage.ts     - Database operations (IStorage interface)
  db.ts          - PostgreSQL connection
  yahoo-finance.ts - Yahoo Finance historical data fetcher
  import-stocks.ts - JPX stock list import and batch price fetch
  scheduler.ts   - Nightly batch scheduler (cron, price fetch → indicator calc → intraday fetch)
  technical-batch.ts - Server-side technical indicator batch calculation
  intraday-batch.ts - 5-minute bar data batch fetcher (daily/seed modes, 120-day retention)
  backtest.ts    - Backtest simulation engine (daily/5-min, uses stored intraday data when available)
  risk-classical.ts - Classical market risk anomaly detection engine
  risk-qml.ts    - QML risk detection wrapper (calls Python PennyLane script)
  qml_risk.py    - PennyLane variational quantum circuit for anomaly detection
  portfolio-optimizer.ts - Classical Markowitz + QAOA quantum portfolio optimizer wrapper
  qaoa_portfolio.py - PennyLane QAOA circuit for portfolio selection (QUBO formulation)
  var-calculator.ts - Classical Monte Carlo + Quantum Monte Carlo VaR calculator wrapper
  quantum_mc_var.py - PennyLane quantum amplitude estimation for VaR/CVaR calculation
  quantum_benchmark.py - Multi-domain quantum benchmark (risk/portfolio/VaR/kernel, accepts real data via stdin)
  quantum-benchmark.ts - Benchmark orchestrator (gathers real data from DB/Yahoo, runs Python, saves results)
shared/
  schema.ts      - Drizzle schemas and TypeScript types
```

## API Endpoints
- GET /api/stocks - List stocks with prices (default) or search with ?search=1&q=query&limit=50&offset=0
- PATCH /api/stocks/:ticker/watch - Toggle watchlist
- POST /api/simulate-prices - Simulate price changes (only for stocks with prices)
- GET /api/stocks/:ticker/history?range=6mo - Historical price data from Yahoo Finance
- POST /api/import-stocks - Import all TSE domestic stocks from JPX
- POST /api/fetch-prices - Fetch real prices for batch of tickers (max 50)
- POST /api/fetch-all-prices - Start background fetch of all stock prices → auto-triggers indicator batch
- GET /api/fetch-all-prices/progress - Check progress of background price fetch
- GET /api/indicators/:ticker - Get pre-computed technical indicators for a stock
- GET /api/indicators - Get all pre-computed technical indicators
- POST /api/indicators/batch - Manually start indicator batch calculation
- GET /api/indicators/batch/progress - Check progress of indicator batch
- GET /api/stocks?watched - Get only watched stocks
- GET/POST /api/strategies - List/create strategies
- PATCH /api/strategies/:id - Toggle active status
- DELETE /api/strategies/:id - Remove strategy
- POST /api/strategies/:id/execute - Execute strategy
- GET /api/trades - List all trades
- GET /api/portfolio - List portfolio positions
- POST /api/backtest/run - Start backtest simulation
- GET /api/backtest/progress - Check backtest progress
- GET /api/backtest/runs - List all backtest runs with win/loss summary
- GET /api/backtest/results?runId= - Get backtest results (optionally by run)
- DELETE /api/backtest/runs/:runId - Delete a backtest run
- GET /api/intraday/status - Stats about stored 5-minute bar data (count, tickers, date range)
- GET /api/intraday/progress - Progress of intraday data fetch operation
- POST /api/intraday/fetch - Start intraday data fetch (body: {mode: "daily"|"seed"}), auto-generates 10m/30m from 5m
- POST /api/intraday/aggregate - Generate 10m/30m bars from existing 5m data in DB
- GET /api/risk/latest - Latest risk assessments by both methods
- GET /api/risk/history - Risk assessment history (with ?limit=)
- POST /api/risk/assess - Run risk assessment (body: {method: "classical"|"qml"|"both"})
- GET /api/risk/preview - Live risk preview (no DB save)
- POST /api/portfolio/optimize - Quantum portfolio optimization (body: {budget, riskAversion, maxAssets})
- POST /api/var/calculate - Quantum Monte Carlo VaR analysis (body: {portfolioValue, confidenceLevel, holdingDays, nSimulations, nQubits, tickers?})
- POST /api/benchmark/run - Run quantum benchmark (body: {useRealData: true/false}), saves to DB
- GET /api/benchmark/runs - List benchmark run history
- GET /api/benchmark/runs/:id - Get specific benchmark run detail
- DELETE /api/benchmark/runs/:id - Delete benchmark run

## Data Sources
### J-Quants API (Primary - JPX公式データ)
- JPX公式のJ-Quants V2 APIで株価データを取得
- 認証: APIキー (`x-api-key` ヘッダー)
- エンドポイント: `https://api.jquants.com/v2/equities/bars/daily`
- 銘柄コード: 5桁（4桁コード + 末尾0、例: 72030 = トヨタ）
- 日付形式: YYYYMMDD（リクエスト時）、YYYY-MM-DD（レスポンス）
- 株式分割調整済みデータ（AdjO/AdjH/AdjL/AdjC/AdjVo）を使用
- Yahoo Financeをフォールバックとして使用

### Yahoo Finance (Fallback)
- Real historical stock prices fetched from Yahoo Finance API (no API key needed)
- Ticker format: `{code}.T` (e.g., 7203.T for Toyota on TSE)

## Backtest
- Four timeframe modes: 日足 (daily, 2y data), 5分足 (5m, 60d data), 10分足 (10m, 60d data), 30分足 (30m, 60d data)
- Intraday backtest: uses DB-stored bars (interval-specific), falls back to Yahoo Finance 5m bars with on-the-fly aggregation
- 10m/30m bars are aggregated from 5m bars using standard OHLCV method (both batch storage and live)
- `timeframe` field in `backtest_runs` table (default "1d" for backward compat)
- Intraday indicators computed on closes with minimum 50 bars (vs 80 for daily)
- simDays range: daily=80-400, intraday=10-60

## Historical Price Data
- Supported ranges: 1d, 5d, 60d, 1mo, 3mo, 6mo, 1y, 2y, 5y
- Supported intervals: 1m, 5m, 15m, 1d, 1wk, 1mo
- Stock detail page with interactive area chart, period summary, and price statistics
- Technical indicators computed on frontend from historical data:
  - **MACD** (12, 26, 9) - trend reversal detection with histogram
  - **RSI** (14-day, Wilder smoothing) - overbought/oversold levels (70/30)
  - **Moving Averages** (5/25/75 day SMA) - trend direction and crossovers
  - **Bollinger Bands** (20-day, ±2σ) - volatility and price extremes
  - **Signal Summary** - composite buy/sell/neutral signal from all 4 indicators
- Server-side batch calculation: after nightly price fetch completes, all indicators are auto-computed and stored in `technical_indicators` table
- Manual trigger also available via POST /api/indicators/batch

## Dependencies
- xlsx - For parsing JPX's XLS stock listing file
- recharts - For historical price charts
- pennylane (Python) - Quantum machine learning framework for QML risk detection
- numpy (Python) - Numerical computing for QML feature processing
