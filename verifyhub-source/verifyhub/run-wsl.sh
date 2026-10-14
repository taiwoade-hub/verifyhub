#!/usr/bin/env bash
# ==============================================================================
# VerifyHub - WSL Launch Script
# ==============================================================================

set -e

# Ensure node and bun paths are loaded
mkdir -p "$HOME/.local"
if [ ! -f "$HOME/.local/node-v20.18.0-linux-x64/bin/node" ]; then
    echo "⚙️  Setting up Node.js v20.18.0..."
    cd "$HOME/.local"
    curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o node.tar.xz
    tar -xf node.tar.xz
    rm -f node.tar.xz
fi

export PATH="$HOME/.local/node-v20.18.0-linux-x64/bin:$HOME/.bun/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "=================================================="
echo "🚀 Starting VerifyHub on http://localhost:3000"
echo "   Node: $(node -v)"
echo "   Dir:  $PROJECT_DIR"
echo "=================================================="

node fix-sqlite.js || true

exec npm run dev
