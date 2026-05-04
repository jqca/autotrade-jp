# AutoTrade JP — CLAUDE.md

## プロジェクト概要
TSE（東証）自動取引システム。日本株・米国株のバックテスト・シグナル分析・自動売買・ポートフォリオ管理。量子ML（PennyLane）によるリスク評価・最適化機能も搭載。

## 基本情報
- **本番URL**: https://autotrade-jp-production.up.railway.app
- **ログイン**: ユーザー名 `takano` / パスワード `autotrade2026`
- **GitHub**: jqca/autotrade-jp（ブランチ: `main`、**パブリック**）
- **インフラ**: Railway（Webサービス + PostgreSQL）
- **Railway プロジェクトID**: `1be56691-e0bf-4219-aa1a-62cdc98184d8`
- **Railway 環境ID**: `4a197200-2f06-4de0-81af-6d8b3990e4ae`
- **Railway Webサービス ID**: `60730f09-5889-46b3-b091-842829ab18d3`
- **Railway PostgreSQL サービスID**: `05802a92-449f-42b9-813f-2382a58dc16e`

## デプロイ方法
```bash
git add .
git commit -m "変更内容"
git push origin main
```

**重要**: Railway の `githubRepoDeploy` API は常に新しいサービスを作成する（既存サービスを更新しない）。
コードを変更したら `git push origin main` で push し、Railway API で再デプロイ → 環境変数設定 → 古いサービス削除 → 名前変更 → ドメイン割り当て、という手順が必要。

## 環境変数（Railway）
| 変数 | 値 |
|---|---|
| DATABASE_URL | `postgresql://postgres:autotrade2026secure@autotrade-jp-db.railway.internal:5432/autotrade_jp` |
| SESSION_SECRET | `autotrade-jp-session-secret-2026-railway` |
| NODE_ENV | `production` |
| PORT | `5000` |

## 技術スタック
- **フロントエンド**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **バックエンド**: Express.js (TypeScript) + esbuild でCJSバンドル
- **データベース**: PostgreSQL + Drizzle ORM
- **Python**: NumPy + PennyLane + scikit-learn（量子MLフィーチャー用、`spawn("python3", ...)`で呼び出し）
- **ビルド**: Dockerfile（node:20-slim + python3 + pip）

## ファイル構成
```
autotrade-jp/
├── Dockerfile              # node:20-slim + Python3 + pip
├── railway.json            # builder: dockerfile
├── nixpacks.toml           # 未使用（Dockerfile優先）
├── server/
│   ├── index.ts            # Expressエントリーポイント（trust proxy設定あり）
│   ├── auth.ts             # セッション認証（connect-pg-simple）
│   ├── routes.ts           # 全APIルート
│   ├── db.ts               # Drizzle ORM + pg.Pool
│   ├── storage.ts          # DB操作レイヤー
│   ├── auto-trader.ts      # 自動売買エンジン（AutoTraderクラス）
│   ├── backtest.ts         # バックテストエンジン
│   ├── jquants.ts          # J-Quants API クライアント
│   ├── kabuClient.ts       # auカブコム証券 kabuステーションAPI
│   ├── risk-qml.ts         # 量子MLリスク評価（Python spawn）
│   ├── portfolio-optimizer.ts  # ポートフォリオ最適化
│   ├── var-calculator.ts   # VaR計算
│   ├── scheduler.ts        # 夜間バッチスケジューラー
│   ├── qml_risk.py         # PennyLane量子MLスクリプト
│   ├── qaoa_portfolio.py   # QAOA最適化スクリプト
│   └── quantum_mc_var.py   # 量子モンテカルロVarスクリプト
├── client/                 # React フロントエンド
├── shared/
│   └── schema.ts           # Drizzle スキーマ定義
└── script/
    └── build.ts            # esbuild + vite ビルドスクリプト
```

## データベース（Drizzle スキーマ）
主要テーブル: `stocks`, `strategies`, `trades`, `portfolio_positions`, `technical_indicators`, `backtest_runs`, `backtest_results`, `intraday_prices`, `market_risk_assessments`, `quantum_benchmark_runs`, `energy_logs`, `credit_transactions`, `app_settings`, `kabu_orders`, `auto_trades`, `users`, `session`

DBマイグレーション: 起動時に `npm run db:push`（`drizzle-kit push`）で自動適用。

## ビルド・起動
```bash
# ビルド（フロントエンド + バックエンド）
npm run build

# 起動（DBスキーマ適用後にサーバー起動）
npm run db:push && npm start
# = npm run db:push && NODE_ENV=production node dist/index.cjs
```

## 機能一覧
| 機能 | 説明 |
|------|------|
| ダッシュボード | ポートフォリオ概要・最近の取引・市場サマリー |
| ウォッチリスト | 日本株・米国株の監視・価格更新 |
| シグナル・戦略 | MACD/RSI/MA/BBインジケーターによる売買シグナル |
| バックテスト | 日足・イントラデイ（5/10/30分）・AI・量子モデル対応 |
| 量子リスク評価 | PennyLane QMLによる市場異常検知（Python spawn） |
| 量子ポートフォリオ | Markowitz vs QAOA最適化比較 |
| 量子VaR | 古典モンテカルロ vs 量子振幅推定VaR比較 |
| kabu注文 | auカブコム証券 kabuステーションAPI連携手動注文UI |
| 自動売買エンジン | ペーパー/本番モード、シングルトンAutoTraderクラス |
| エネルギーモニター | 計算タスクの電力・CO₂排出量追跡 |
| クレジット課金 | Stripe連携（Replit専用機能は Railway では一部スキップ） |

## ハマりどころ・修正履歴

### 1. top-level await がCJSビルドで非対応
- **問題**: `server/index.ts` の `await initStripe()` がesbuildのCJS形式で失敗
- **修正**: `initStripe()` を async IIFE の中に移動（top-level await廃止）

### 2. `connect-pg-simple` バンドル時に `table.sql` パスが壊れる
- **問題**: esbuildでバンドルするとモジュールの `__dirname` が `/app/dist/` になり `table.sql` が見つからない → セッションが保存されずログイン不可
- **修正**: `script/build.ts` の allowlist から `connect-pg-simple` を除外（external化）

### 3. Railway リバースプロキシで `secure` Cookie が機能しない
- **問題**: `NODE_ENV=production` で `cookie.secure: true` になるが、Express がプロキシを認識しないためCookieが設定されない
- **修正**: `server/index.ts` に `app.set("trust proxy", 1)` を追加

### 4. Nix環境でのPipインストール失敗
- **問題**: nixpacks.toml で `pip install` が "externally-managed-environment" エラー
- **解決**: Dockerfile（node:20-slim）に切り替え、`apt-get install python3 python3-pip python3-venv` を使用

### 5. Stripe / Replit 依存機能
- `stripe-replit-sync` は Replit 専用。`X-Replit-Token not found` エラーが出るが致命的ではなく起動継続。
- Stripe課金機能は Railway では無効化扱い。

## 外部API（任意設定）
| 変数名 | 用途 |
|---|---|
| `JQUANTS_API_KEY` | J-Quants API（日本株データ取得） |
| `KABU_API_BASE_URL` | kabuステーションAPIベースURL |
| `KABU_API_PASSWORD` | kabuステーションAPIパスワード |
| `KABU_ACCOUNT_PASSWORD` | auカブコム証券アカウントパスワード |
| `STRIPE_SECRET_KEY` | Stripe決済（Railway では未使用） |

## 注意事項
- リポジトリはパブリック（コードのみ、秘密情報は環境変数で管理）
- 量子ML機能はPython3 + PennyLaneが必要（Dockerfileで対応済み）
- `python3` コマンドで直接呼び出し（`server/risk-qml.ts` 等）
- 自動売買のライブトレードはデフォルトでペーパートレードモード（安全）
- 夜間バッチ: 毎日 JST 16:00（UTC 07:00）に実行
