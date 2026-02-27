# AutoTrade JP - Japanese Stock Automated Trading App

## Overview
A simulated Japanese stock automated trading platform. Users can monitor stock prices, create automated trading strategies, view trade history, and manage their portfolio.

## Architecture
- **Frontend**: React + TypeScript with Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: wouter (frontend), Express (backend)
- **State Management**: TanStack React Query

## Key Features
1. **Dashboard** - Portfolio overview, recent trades, top movers
2. **Watchlist** - Japanese stock monitoring with simulated price updates
3. **Strategies** - Create/manage automated trading rules (price drop buy, price rise sell, threshold buy/sell)
4. **Trade History** - Complete trade log
5. **Portfolio** - Current holdings with P&L tracking

## Data Models
- `stocks` - Japanese stock data (ticker, name, sector, prices, volume)
- `strategies` - Automated trading rules with conditions
- `trades` - Trade execution history
- `portfolio_positions` - Current holdings

## Project Structure
```
client/src/
  pages/         - Dashboard, Watchlist, Strategies, Trades, Portfolio
  components/    - AppSidebar, ThemeToggle, UI components
server/
  routes.ts      - API endpoints and seed data
  storage.ts     - Database operations (IStorage interface)
  db.ts          - PostgreSQL connection
shared/
  schema.ts      - Drizzle schemas and TypeScript types
```

## API Endpoints
- GET /api/stocks - List all stocks
- PATCH /api/stocks/:ticker/watch - Toggle watchlist
- POST /api/simulate-prices - Simulate price changes
- GET/POST /api/strategies - List/create strategies
- PATCH /api/strategies/:id - Toggle active status
- DELETE /api/strategies/:id - Remove strategy
- POST /api/strategies/:id/execute - Execute strategy
- GET /api/trades - List all trades
- GET /api/portfolio - List portfolio positions
- GET /api/stocks/:ticker/history?range=6mo - Historical price data from Yahoo Finance

## Historical Price Data
- Real historical stock prices fetched from Yahoo Finance API (no API key needed)
- Ticker format: `{code}.T` (e.g., 7203.T for Toyota on TSE)
- Supported ranges: 1mo, 3mo, 6mo, 1y, 2y, 5y
- Stock detail page with interactive area chart (recharts), period summary, and price statistics
- Accessible from watchlist cards via "チャートを見る" button
