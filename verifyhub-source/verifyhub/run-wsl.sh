#!/usr/bin/env bash
# ==============================================================================
# VerifyHub - WSL Launch Script
# ==============================================================================

set -e

# Ensure node and bun paths are loaded
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/node-v20.18.0-linux-x64/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
    mkdir -p "$HOME/.local"
    if [ ! -f "$HOME/.local/node-v20.18.0-linux-x64/bin/node" ]; then
        echo "⚙️  Setting up Node.js v20.18.0..."
        cd "$HOME/.local"
        curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o node.tar.xz
        tar -xf node.tar.xz
        rm -f node.tar.xz
    fi
    export PATH="$HOME/.local/node-v20.18.0-linux-x64/bin:$PATH"
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Select port: use PORT if specified, or pick 3000 if free, otherwise 3001
if [ -z "$PORT" ]; then
    if ss -tulpn 2>/dev/null | grep -q ':3000 '; then
        export PORT=3001
        echo "ℹ️  Port 3000 is in use by another process. Using port 3001."
    else
        export PORT=3000
    fi
else
    export PORT
fi

echo "=================================================="
echo "🚀 Starting VerifyHub on http://localhost:${PORT}"
echo "   Node: $(node -v)"
echo "   Dir:  $PROJECT_DIR"
echo "=================================================="

# Ensure database exists
if [ ! -f "prisma/dev.db" ] && [ ! -f "dev.db" ]; then
    echo "📦 Initializing database..."
    if command -v bun >/dev/null 2>&1; then
        bun run db:push
    else
        npx prisma db push --accept-data-loss
    fi
fi

node fix-sqlite.js || true

exec npm run dev
