#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  MTG Tracker – Startup Script
#  Pulls latest code, installs deps, and launches the server.
# ─────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/mtg-tracker.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "===== MTG Tracker starting ====="

# ── Pull latest changes ──────────────────────────────────
log "Pulling latest changes from git..."
if git pull --ff-only 2>&1 | tee -a "$LOG_FILE"; then
  log "Git pull successful."
else
  log "WARNING: Git pull failed (maybe no remote or dirty state). Continuing anyway..."
fi

# ── Install / update dependencies ────────────────────────
log "Installing npm dependencies..."
npm install --production 2>&1 | tee -a "$LOG_FILE"
log "Dependencies installed."

# ── Start the server ─────────────────────────────────────
log "Starting MTG Tracker server..."
exec node server.js 2>&1 | tee -a "$LOG_FILE"
