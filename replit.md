# AutoTrade JP - Stock Automated Trading App

## Overview
AutoTrade JP is a simulated automated trading platform supporting both TSE-listed Japanese stocks (~3,771) and major US stocks (~133). It allows users to monitor stock prices, develop and backtest automated trading strategies, view trade history, and manage their investment portfolio. The project aims to integrate advanced AI and Quantum Machine Learning (QML) techniques for market risk assessment, portfolio optimization, and VaR analysis, providing a competitive edge in stock market analysis and strategy development. The platform also includes an energy monitor to track the environmental impact of computational tasks.

## User Preferences
I want iterative development.
I prefer detailed explanations for complex features like AI/QML.
I want to be asked before major architectural changes or significant feature removals.
I prefer a clear and structured codebase.
I would like comprehensive test coverage for critical components.

## System Architecture
The application features a React + TypeScript frontend built with Vite, styled using Tailwind CSS and shadcn/ui components for a modern UI/UX. The backend is an Express.js server, also in TypeScript, backed by a PostgreSQL database with Drizzle ORM for data persistence.

**Core Features:**
-   **Dashboard:** Provides an overview of portfolio performance, recent trades, and market summaries.
-   **Watchlist & Stock Detail:** Enables monitoring of Japanese stocks with simulated real-time price updates, historical data visualization, and comprehensive technical indicator analysis (MACD, RSI, Moving Averages, Bollinger Bands).
-   **Signals & Strategies:** Users can identify buy/sell signals based on technical indicators and create automated trading rules.
-   **Backtest Engine:** Supports multi-timeframe backtesting (daily, 5m, 10m, 30m) with market selection (JP/US) and extensive configurable parameters. JP stocks use 100-share lots with JPY capital; US stocks use 1-share lots with USD capital. Integrates AI/Quantum models for enhanced analysis. Default minimum volume filter is 100,000 shares. Includes entry confirmation filter (skip trades where price stays below buy price for N bars), breakout confirmation (require high to break recent N-bar high before entry), configurable stop loss (default 0.7%), 15-minute hold limit, and Wednesday 10-12h special filter (skip MA=neutral + RSI≧42). Default trading hours: 9:30-14:00.
-   **Advanced Analytics (AI/QML):**
    -   **Risk Alert:** Detects market anomalies using both classical methods and QML with PennyLane.
    -   **Quantum Portfolio Optimization:** Compares classical Markowitz optimization with QAOA for optimal stock selection.
    -   **Quantum VaR Analysis:** Compares classical Monte Carlo with Quantum Monte Carlo (amplitude estimation) for Value at Risk calculation.
-   **Portfolio & Trade History:** Manages current holdings, tracks profit/loss, and maintains a complete log of all trades.
-   **Data Management:** Includes features for importing JPX official stock data and US stock data, with batch fetching real prices from Yahoo Finance. Stocks table has a `market` column ("JP" or "US").
-   **Energy Monitor:** Tracks and displays power consumption and CO₂ emissions for computational tasks, especially AI/Quantum operations.

**Technical Implementations:**
-   **Authentication:** Session-based authentication using `express-session` and `connect-pg-simple`, with bcrypt for password hashing.
-   **State Management:** TanStack React Query for efficient data fetching and caching on the frontend.
-   **Charting:** `recharts` library is used for interactive data visualization.
-   **Data Models:** Key entities include `stocks`, `strategies`, `trades`, `portfolio_positions`, `technical_indicators`, `backtest_runs`, `backtest_results`, `intraday_prices`, `market_risk_assessments`, and `quantum_benchmark_runs`.
-   **Scheduler:** A nightly batch scheduler handles price fetching, indicator calculation, and intraday data fetching.
-   **Quantum Integration:** Python scripts utilizing PennyLane, NumPy, and scikit-learn are orchestrated from the Node.js backend for QML features and AI benchmarks.
-   **Billing:** Credit-based billing system integrated with Stripe for computation-intensive tasks.
-   **Commission Calculation:** `server/commission.ts` にauカブコム証券手数料体系を実装。現物（5万以下55円〜上限1,013円）・信用（上限198円）・往復ラウンドトリップ計算。自動売買エンジンの買い・売り両方に手数料控除を反映。`auto_trades`テーブルの`commission`カラムで記録。
-   **Backtest現実化コスト対応:** バックテストに3種コストを追加。①手数料（現物/信用/ゼロ/なし）②スリッページ（成行スリッページ0〜0.5%）③信用金利コスト（年利×保有日数）。全6ループ（日足/イントラデイ×通常/AI/量子）に適用。UIで設定可能。
-   **kabu注文発注（手動）:** auカブコム証券 kabuステーション® APIを経由した手動注文発注UI。接続設定・発注フォーム・注文照会・保有株・発注履歴タブを実装。`kabu_orders`テーブルで発注記録を管理。
-   **自動売買エンジン:** `server/auto-trader.ts`にシングルトン`AutoTrader`クラスを実装。kabu注文発注ページの「自動売買」タブから操作。ペーパートレード/本番モード切替、MACD/RSI/MA/BB指標によるシグナル検出、ストップロス・利確目標・日次最大損失管理。`auto_trades`テーブルで全取引履歴を保存。設定はappSettingsテーブルに永続化。

## External Dependencies
-   **J-Quants API:** Primary source for official JPX stock data.
-   **Yahoo Finance:** Fallback and supplementary source for historical stock prices.
-   **Stripe:** Payment gateway for managing credits and transactions.
-   **`xlsx`:** Library for parsing JPX's Excel stock listing files.
-   **`recharts`:** JavaScript charting library for data visualization.
-   **`pennylane` (Python):** Quantum machine learning framework.
-   **`numpy` (Python):** Fundamental package for numerical computation.
-   **`scikit-learn` (Python):** Machine learning library for classical AI models.
-   **`stripe-replit-sync`:** Helper for Stripe integration within Replit.