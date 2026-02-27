# AutoTrade JP - Japanese Stock Automated Trading App

## Overview
A simulated Japanese stock automated trading platform with all 3,771 TSE-listed domestic stocks. Users can monitor stock prices, create automated trading strategies, view trade history, and manage their portfolio.

## Architecture
- **Frontend**: React + TypeScript with Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: wouter (frontend), Express (backend)
- **State Management**: TanStack React Query
- **Charts**: recharts (area chart for historical prices)

## Key Features
1. **Dashboard** - Portfolio overview, recent trades, top movers
2. **Watchlist** - Japanese stock monitoring with search/pagination (3,771 stocks), simulated price updates
3. **Stock Detail** - Historical price chart from Yahoo Finance, period statistics
4. **Strategies** - Create/manage automated trading rules (price drop buy, price rise sell, threshold buy/sell)
5. **Trade History** - Complete trade log
6. **Portfolio** - Current holdings with P&L tracking
7. **JPX Import** - Import all TSE-listed domestic stocks from JPX official data
8. **Batch Price Fetch** - Fetch real prices from Yahoo Finance in batches

## Data Models
- `stocks` - Japanese stock data (ticker, name, sector, prices, volume) - 3,771 stocks
- `strategies` - Automated trading rules with conditions
- `trades` - Trade execution history
- `portfolio_positions` - Current holdings

## Project Structure
```
client/src/
  pages/         - Dashboard, Watchlist, StockDetail, Strategies, Trades, Portfolio
  components/    - AppSidebar, ThemeToggle, UI components
server/
  routes.ts      - API endpoints and seed data
  storage.ts     - Database operations (IStorage interface)
  db.ts          - PostgreSQL connection
  yahoo-finance.ts - Yahoo Finance historical data fetcher
  import-stocks.ts - JPX stock list import and batch price fetch
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
- POST /api/fetch-all-prices - Start background fetch of all stock prices (concurrent, ~7-8 min)
- GET /api/fetch-all-prices/progress - Check progress of background price fetch
- GET /api/stocks?watched - Get only watched stocks
- GET/POST /api/strategies - List/create strategies
- PATCH /api/strategies/:id - Toggle active status
- DELETE /api/strategies/:id - Remove strategy
- POST /api/strategies/:id/execute - Execute strategy
- GET /api/trades - List all trades
- GET /api/portfolio - List portfolio positions

## Historical Price Data
- Real historical stock prices fetched from Yahoo Finance API (no API key needed)
- Ticker format: `{code}.T` (e.g., 7203.T for Toyota on TSE)
- Supported ranges: 1mo, 3mo, 6mo, 1y, 2y, 5y
- Stock detail page with interactive area chart, period summary, and price statistics

## Dependencies
- xlsx - For parsing JPX's XLS stock listing file
- recharts - For historical price charts
