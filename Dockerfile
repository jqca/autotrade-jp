FROM node:20-slim

# Python + pip をインストール
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python仮想環境を作成してパッケージをインストール
RUN python3 -m venv /app/.venv
RUN /app/.venv/bin/pip install --upgrade pip
RUN /app/.venv/bin/pip install numpy pennylane scikit-learn

# PATHに仮想環境を追加（python3コマンドがvenv版を指すように）
ENV PATH="/app/.venv/bin:$PATH"

# Node.js依存関係
COPY package*.json ./
RUN npm ci

# ソースコードをコピー
COPY . .

# フロントエンド+バックエンドビルド
RUN npm run build

EXPOSE $PORT

# DBマイグレーション後にサーバー起動
CMD npm run db:push && npm start
