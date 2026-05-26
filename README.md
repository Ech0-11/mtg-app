# ⚔ MTG Commander Tracker — Setup Guide

## Requirements
- Node.js (v16+) on your Debian machine
- Both phones on the same WiFi network as your Debian machine

---

## Install & Run

```bash
# 1. Go into the folder
cd mtg-tracker

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

You should see:
```
MTG Commander Tracker running at http://localhost:3000
```

---

## Connect Your Phones

1. Find your Debian machine's local IP:
   ```bash
   ip addr show | grep "inet " | grep -v 127.0.0.1
   ```
   It'll look like `192.168.1.x`

2. On each phone, open the browser and go to:
   ```
   http://192.168.1.x:3000
   ```
   (replace with your actual IP)

3. Each player taps "I AM: PLAYER 1" or "PLAYER 2" to claim their side.
   Both screens update in real time!

---

## Features
- ✅ Life totals (starts at 40 for Commander)
- ✅ Poison/infect counters (auto-marks fallen at 10)
- ✅ Commander damage tracking (auto-deducts from life)
- ✅ Command tax tracker (shows extra mana cost)
- ✅ Mana pool (W/U/B/R/G/Colorless)
- ✅ Lands in play counter
- ✅ Dice roller (d4, d6, d8, d10, d12, d20, d100)
- ✅ Turn tracker
- ✅ Game log

---

## Run on Boot (optional)

```bash
# Install pm2 to keep it running
npm install -g pm2
pm2 start server.js --name mtg-tracker
pm2 save
pm2 startup
```

---

## Change the Port

```bash
PORT=8080 npm start
```
