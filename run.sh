#!/usr/bin/env bash
# ==============================================================================
# VerifyHub - Universal Linux / macOS / WSL Launcher
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/verifyhub-source/verifyhub"

if [ -f "$TARGET_DIR/run-wsl.sh" ]; then
  exec bash "$TARGET_DIR/run-wsl.sh"
else
  echo "Error: Could not locate $TARGET_DIR/run-wsl.sh"
  exit 1
fi
