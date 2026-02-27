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
5. **Backtest** - Strong buy signal backtest simulation (past 10 trading days), win/loss tracking, run history
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
- `technical_indicators` - Pre-computed technical indicators per stock
- `backtest_results` - Backtest simulation results (signal date, buy/sell prices, win/loss, indicator trends)

## Project Structure
```
client/src/
  pages/         - Dashboard, Watchlist, StockDetail, Signals, Backtest, Strategies, Trades, Portfolio
  components/    - AppSidebar, ThemeToggle, UI components
server/
  routes.ts      - API endpoints and seed data
  storage.ts     - Database operations (IStorage interface)
  db.ts          - PostgreSQL connection
  yahoo-finance.ts - Yahoo Finance historical data fetcher
  import-stocks.ts - JPX stock list import and batch price fetch
  scheduler.ts   - Nightly batch scheduler (cron, price fetch → indicator calc)
  technical-batch.ts - Server-side technical indicator batch calculation
  backtest.ts    - Backtest simulation engine (10-day signal simulation)
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

## Historical Price Data
- Real historical stock prices fetched from Yahoo Finance API (no API key needed)
- Ticker format: `{code}.T` (e.g., 7203.T for Toyota on TSE)
- Supported ranges: 1mo, 3mo, 6mo, 1y, 2y, 5y
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
