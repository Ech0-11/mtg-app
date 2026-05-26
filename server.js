const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { URL } = require("url");

// ── Load .env file (no external deps) ───────────────────
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const PORT = process.env.PORT || 3001;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";

// ── Rate limiting for suggestions (IP -> timestamp) ─────
const suggestionCooldowns = new Map();

function defaultPlayerMana() {
  return {
    lands: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    available: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  };
}

function defaultState() {
  return {
    players: [
      { id: 0, name: "Player 1", life: 40, poison: 0, commandTax: [0, 0], commanderDamage: [0], mana: defaultPlayerMana() },
      { id: 1, name: "Player 2", life: 40, poison: 0, commandTax: [0, 0], commanderDamage: [0], mana: defaultPlayerMana() },
    ],
    turn: 1,
    activePlayer: 0,
    lastDiceRoll: null,
    log: [],
  };
}

let gameState = defaultState();

// Map cookieId -> playerId (0 or 1)
const cookieMap = {};
const clients = new Set();

// ── Send to Discord webhook ─────────────────────────────
function sendToDiscord(text) {
  if (!DISCORD_WEBHOOK) {
    console.warn("No DISCORD_WEBHOOK_URL set — skipping.");
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      embeds: [{
        title: "💡 New Suggestion",
        description: text,
        color: 0xc9a84c,
        timestamp: new Date().toISOString(),
        footer: { text: "MTG Commander Tracker" },
      }],
    });
    const parsed = new URL(DISCORD_WEBHOOK);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(options, (r) => {
      let data = "";
      r.on("data", (d) => (data += d));
      r.on("end", () => (r.statusCode < 300 ? resolve(data) : reject(new Error(`Discord ${r.statusCode}: ${data}`))));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Save suggestion locally as backup ───────────────────
function saveSuggestionLocally(text, ip) {
  const file = path.join(__dirname, "suggestions.json");
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  list.push({ text, ip, timestamp: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

const server = http.createServer((req, res) => {
  // ── API: Suggestion endpoint ──────────────────────────
  if (req.method === "POST" && req.url === "/api/suggestion") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { suggestion } = JSON.parse(body);
        const text = (suggestion || "").trim();

        if (!text || text.length < 3) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Suggestion is too short." }));
        }
        if (text.length > 1000) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Suggestion is too long (max 1000 chars)." }));
        }

        // Rate limit: 1 suggestion per 60 seconds per IP
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const now = Date.now();
        const last = suggestionCooldowns.get(ip) || 0;
        if (now - last < 60_000) {
          const wait = Math.ceil((60_000 - (now - last)) / 1000);
          res.writeHead(429, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: `Please wait ${wait}s before submitting another suggestion.` }));
        }
        suggestionCooldowns.set(ip, now);

        // Save locally + send to Discord
        saveSuggestionLocally(text, ip);
        await sendToDiscord(text);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error("Suggestion error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to submit suggestion." }));
      }
    });
    return;
  }

  // ── Static files ──────────────────────────────────────
  let filePath = path.join(__dirname, "public", req.url === "/" ? "index.html" : req.url);
  const ext = path.extname(filePath);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function addLog(msg) {
  gameState.log.unshift(`[T${gameState.turn}] ${msg}`);
  if (gameState.log.length > 30) gameState.log = gameState.log.slice(0, 30);
}

wss.on("connection", (ws, req) => {
  clients.add(ws);

  // Parse cookie
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/mtg_client_id=([^;]+)/);
  const clientId = match ? match[1] : null;
  ws.clientId = clientId;

  const assignedPlayer = clientId && cookieMap[clientId] !== undefined ? cookieMap[clientId] : null;

  ws.send(JSON.stringify({ type: "STATE", state: gameState, assignedPlayer }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case "CLAIM_PLAYER": {
          if (msg.clientId) {
            cookieMap[msg.clientId] = msg.playerId;
            ws.clientId = msg.clientId;
          }
          break;
        }
        case "UPDATE_LIFE": {
          gameState.players[msg.playerId].life += msg.delta;
          addLog(`${gameState.players[msg.playerId].name} life → ${gameState.players[msg.playerId].life}`);
          break;
        }
        case "UPDATE_POISON": {
          const p = gameState.players[msg.playerId];
          p.poison = Math.max(0, p.poison + msg.delta);
          addLog(`${p.name} poison → ${p.poison}`);
          break;
        }
        case "UPDATE_COMMANDER_DAMAGE": {
          const target = gameState.players[msg.targetId];
          const source = gameState.players[msg.sourceId];
          if (!target.commanderDamage[msg.sourceId]) target.commanderDamage[msg.sourceId] = 0;
          const newDmg = Math.max(0, target.commanderDamage[msg.sourceId] + msg.delta);
          const actualDelta = newDmg - target.commanderDamage[msg.sourceId];
          target.commanderDamage[msg.sourceId] = newDmg;
          target.life -= actualDelta;
          if (actualDelta !== 0) addLog(`${source.name}'s commander dealt ${actualDelta} to ${target.name} (total: ${newDmg})`);
          break;
        }
        case "UPDATE_COMMAND_TAX": {
          const p = gameState.players[msg.playerId];
          p.commandTax[msg.commanderIdx] = Math.max(0, (p.commandTax[msg.commanderIdx] || 0) + msg.delta);
          addLog(`${p.name} cmd tax → {${p.commandTax[msg.commanderIdx] * 2}}`);
          break;
        }
        case "UPDATE_LANDS": {
          const p = gameState.players[msg.playerId];
          p.mana.lands[msg.color] = Math.max(0, (p.mana.lands[msg.color] || 0) + msg.delta);
          break;
        }
        case "UPDATE_AVAILABLE": {
          const p = gameState.players[msg.playerId];
          p.mana.available[msg.color] = Math.max(0, (p.mana.available[msg.color] || 0) + msg.delta);
          break;
        }
        case "RESET_AVAILABLE": {
          // Reset available mana to match lands for this player
          const p = gameState.players[msg.playerId];
          p.mana.available = { ...p.mana.lands };
          addLog(`${p.name} mana pool reset from lands`);
          break;
        }
        case "NEXT_TURN": {
          gameState.turn += 1;
          gameState.activePlayer = (gameState.activePlayer + 1) % 2;
          // Reset available mana for the player whose turn it now is
          const ap = gameState.players[gameState.activePlayer];
          ap.mana.available = { ...ap.mana.lands };
          addLog(`Turn ${gameState.turn} — ${ap.name}'s turn (mana reset)`);
          break;
        }
        case "SET_NAME": {
          gameState.players[msg.playerId].name = msg.name;
          break;
        }
        case "ROLL_DICE": {
          const result = Math.floor(Math.random() * msg.sides) + 1;
          gameState.lastDiceRoll = { sides: msg.sides, result, roller: msg.playerId };
          addLog(`${gameState.players[msg.playerId].name} rolled d${msg.sides}: ${result}`);
          break;
        }
        case "RESET": {
          gameState = defaultState();
          addLog("Game reset");
          break;
        }
      }

      broadcast({ type: "STATE", state: gameState });
    } catch (e) {
      console.error("Error:", e);
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => console.log(`MTG Tracker running at http://localhost:${PORT}`));
