#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  MTG Tracker – Quick Start Setup (Debian / systemd)
#
#  What this does:
#   1. Asks if you want the app to auto-start on boot
#   2. If yes, creates:
#      • A systemd SERVICE that runs start.sh on boot
#      • A systemd TIMER  that restarts the service daily at 3 AM
#   3. Enables & starts everything for you
#
#  Run:  sudo bash quickstart.sh
# ─────────────────────────────────────────────────────────
set -euo pipefail

# ── Require root ─────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "⚠  This script must be run as root (sudo)."
  echo "   Usage:  sudo bash quickstart.sh"
  exit 1
fi

# ── Resolve paths ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_SCRIPT="$SCRIPT_DIR/start.sh"
SERVICE_NAME="mtg-tracker"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-restart.timer"
RESTART_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-restart.service"

# Figure out which real user invoked sudo
RUN_USER="${SUDO_USER:-$(whoami)}"
RUN_GROUP="$(id -gn "$RUN_USER")"

# Detect Node.js path so the service can find it
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
GIT_BIN="$(command -v git)"

if [[ -z "$NODE_BIN" ]]; then
  echo "❌  Node.js not found. Please install Node.js first."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        MTG Commander Tracker – Quick Start           ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Repo dir : $SCRIPT_DIR"
echo "║  User     : $RUN_USER"
echo "║  Node     : $NODE_BIN"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Ask the user ─────────────────────────────────────────
read -rp "Do you want the MTG Tracker to start automatically on boot? [Y/n] " ANSWER
ANSWER="${ANSWER:-Y}"

if [[ ! "$ANSWER" =~ ^[Yy]$ ]]; then
  echo "Okay — no services were created. You can start manually with:"
  echo "  bash $START_SCRIPT"
  exit 0
fi

echo ""
echo "──  Setting up systemd service & timer...  ──"

# ── Make start.sh executable ─────────────────────────────
chmod +x "$START_SCRIPT"

# ── Build the PATH the service will use ──────────────────
# Include common binary locations + wherever node/npm live
SERVICE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SERVICE_PATH="$(dirname "$NODE_BIN"):$(dirname "$NPM_BIN"):$(dirname "$GIT_BIN"):$SERVICE_PATH"

# ─────────────────────────────────────────────────────────
#  1.  Main service — runs on boot
# ─────────────────────────────────────────────────────────
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=MTG Commander Tracker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$SCRIPT_DIR
Environment=PATH=$SERVICE_PATH
Environment=NODE_ENV=production
ExecStart=/usr/bin/env bash $START_SCRIPT
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

echo "  ✔  Created $SERVICE_FILE"

# ─────────────────────────────────────────────────────────
#  2.  Restart service — triggered by the timer
# ─────────────────────────────────────────────────────────
cat > "$RESTART_SERVICE_FILE" <<EOF
[Unit]
Description=Restart MTG Tracker (daily refresh)

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart ${SERVICE_NAME}.service
EOF

echo "  ✔  Created $RESTART_SERVICE_FILE"

# ─────────────────────────────────────────────────────────
#  3.  Timer — fires every day at 3:00 AM
# ─────────────────────────────────────────────────────────
cat > "$TIMER_FILE" <<EOF
[Unit]
Description=Restart MTG Tracker daily at 3:00 AM

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

echo "  ✔  Created $TIMER_FILE"

# ── Reload & enable ──────────────────────────────────────
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl enable --now "${SERVICE_NAME}-restart.timer"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✅  All set! Here's what was configured:"
echo ""
echo "  • ${SERVICE_NAME}.service"
echo "      Starts the tracker on every boot."
echo "      On startup it runs git pull + npm install first."
echo ""
echo "  • ${SERVICE_NAME}-restart.timer"
echo "      Restarts the tracker every day at 3:00 AM."
echo "      (This also triggers git pull + npm install.)"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status  ${SERVICE_NAME}"
echo "    sudo journalctl -u ${SERVICE_NAME} -f    # live logs"
echo "    sudo systemctl restart ${SERVICE_NAME}    # manual restart"
echo "    sudo systemctl stop    ${SERVICE_NAME}    # stop"
echo "══════════════════════════════════════════════════════"
