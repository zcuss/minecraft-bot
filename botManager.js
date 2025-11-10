// botManager.js
const EventEmitter = require("events");
const mineflayer = require("mineflayer");
const { plugin: toolPlugin } = require("mineflayer-tool");
const { pathfinder } = require("mineflayer-pathfinder");

const features = [require("./features/login"), require("./features/control"), require("./features/slimefun")];

const events = new EventEmitter();
let bots = [];

function publishUpdate() {
  events.emit(
    "update",
    bots.map((b) => ({ username: b.username, connected: b.connected }))
  );
}

/** Dedup helper (lintas chat/whisper/message) */
function makeDeduper(ttlMs = 1500) {
  const seen = new Map(); // text -> lastTs
  return (text) => {
    if (!text) return true;
    const now = Date.now();
    const last = seen.get(text);
    if (last && now - last < ttlMs) return false;
    seen.set(text, now);
    // optional cleanup untuk map yang membesar:
    if (seen.size > 300) {
      const cutoff = now - ttlMs * 2;
      for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
    }
    return true;
  };
}

function createBot(cfg) {
  // kill duplicate username
  const dup = bots.find((b) => b.username === cfg.username);
  if (dup) {
    try {
      dup.bot.end("Duplicate login");
    } catch {}
    bots = bots.filter((b) => b.username !== cfg.username);
  }

  // --- CORE BOT ---
  const bot = mineflayer.createBot({
    host: cfg.host,
    port: cfg.port || 25565,
    username: cfg.username,
    auth: cfg.auth || "offline",
    // default ke versi modern supaya schema Item Components kebaca
    version: cfg.version ?? "1.21.1",
  });

  bot.loadPlugin(toolPlugin);
  bot.loadPlugin(pathfinder);

  const log = (...a) => events.emit("botLog", `[${cfg.username}] ${a.join(" ")}`);
  const entry = { username: cfg.username, bot, connected: false, ready: false, _featureDisposers: [] };
  bots.push(entry);
  publishUpdate();

  // ------ Command Router (dipakai server -> sendCommand) ------
  const commandHandlers = [];
  bot._registerCommandHandler = (fn) => commandHandlers.push(fn);
  bot._handleGuiCommand = async (_from, raw) => {
    const text = String(raw || "").trim();
    if (!text) return;
    const [cmdRaw, ...args] = text.split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    for (const handler of commandHandlers) {
      let handled = false;
      try {
        handled = await handler(cmd, args);
      } catch {}
      if (handled) return;
    }
    log(`Unknown command: ${cmd}`);
  };

  // ------ Event dasar & housekeeping ------
  bot.once("login", () => {
    const pv = bot._client?.protocolVersion;
    log(`🔎 Logged in (version=${bot.version}, proto=${pv ?? "?"})`);
  });

  bot.once("spawn", async () => {
    entry.connected = true;
    entry.ready = true;
    publishUpdate();
    log("✅ Fully connected and chat-ready");

    // muat semua fitur
    for (const f of features) {
      try {
        const disposer = await f.init(bot, { cfg, log, events });
        if (typeof disposer === "function") entry._featureDisposers.push(disposer);
      } catch (e) {
        log(`⚠️ load feature '${f.name || "unnamed"}' error: ${e?.message || e}`);
      }
    }
  });

  const handleEnd = (reason) => {
    entry.connected = false;
    entry.ready = false;
    try {
      for (const d of entry._featureDisposers) d?.();
    } catch {}
    entry._featureDisposers = [];
    bots = bots.filter((b) => b.username !== cfg.username);
    publishUpdate();
    // stringify reason dengan aman
    let why = "unknown";
    try {
      if (typeof reason === "string") why = reason;
      else if (reason && typeof reason === "object") why = JSON.stringify(reason);
    } catch {}
    log(`❌ Disconnected (${why})`);
  };

  bot.on("kicked", handleEnd);
  bot.on("end", handleEnd);
  bot.on("error", (e) => log("Error:", e?.message || e));

  // ------ Relay chat → GUI (dedup lintas event) ------
  const shouldEmit = makeDeduper(1500);

  bot.on("chat", (user, msg) => {
    if (user === bot.username) return;
    const text = String(msg || "");
    // dedup berdasarkan isi pesan
    if (!shouldEmit(`[CHAT]${user}:${text}`)) return;
    events.emit("chat", { user, msg: text, type: "public" });
  });

  bot.on("whisper", (user, msg) => {
    if (user === bot.username) return;
    const text = `(whisper) ${String(msg || "")}`;
    if (!shouldEmit(`[WHISPER]${user}:${text}`)) return;
    events.emit("chat", { user, msg: text, type: "whisper" });
  });

  bot.on("message", (m) => {
    const text = m?.toString?.().trim?.() || "";
    if (!text) return;
    // beberapa server spam message komponen → dedup ketat
    if (!shouldEmit(`[MSG]${text}`)) return;
    events.emit("chat", { user: "SERVER", msg: text, type: "system" });
  });
}

function stopBot({ username }) {
  const entry = bots.find((b) => b.username === username);
  if (!entry) return;
  try {
    entry.bot.end("Stopped by user");
  } catch {}
  // handleEnd akan merapikan
}

function sendCommand({ username, text }) {
  const entry = bots.find((b) => b.username === username && b.connected);
  if (!entry || !text) return;
  try {
    entry.bot._handleGuiCommand?.("GUI", text);
    events.emit("botLog", `[${username}] cmd: ${text}`);
  } catch (e) {
    events.emit("botLog", `[${username}] cmd error: ${e?.message || e}`);
  }
}

async function sendChat({ usernames, text }) {
  if (!Array.isArray(usernames) || !text) return;
  for (const name of usernames) {
    const entry = bots.find((b) => b.username.toLowerCase() === String(name).toLowerCase());
    if (!entry) {
      events.emit("botLog", `[${name}] ⚠️ Bot not found`);
      continue;
    }
    try {
      entry.bot.chat(text);
      events.emit("botLog", `[${name}] 💬 ${text}`);
    } catch (e) {
      events.emit("botLog", `[${name}] ❌ Chat error: ${e?.message || e}`);
    }
  }
}

function getBots() {
  return bots;
}

module.exports = {
  createBot,
  stopBot,
  sendCommand,
  sendChat,
  getBots,
  events,
};
