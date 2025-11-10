// =============== TAB SWITCHING ===============
const $tabLogin = document.getElementById("tab-login");
const $tabControl = document.getElementById("tab-control");
const $viewLogin = document.getElementById("view-login");
const $viewControl = document.getElementById("view-control");

function switchTab(tab) {
  const isLogin = tab === "login";
  $tabLogin.classList.toggle("active", isLogin);
  $tabControl.classList.toggle("active", !isLogin);
  $viewLogin.classList.toggle("active", isLogin);
  $viewControl.classList.toggle("hidden", isLogin);
  $viewLogin.classList.toggle("hidden", !isLogin);
  $viewControl.classList.toggle("active", !isLogin);
}
$tabLogin?.addEventListener("click", () => switchTab("login"));
$tabControl?.addEventListener("click", () => switchTab("control"));

// =============== TOAST ===============
const $toast = document.getElementById("toast");
function toast(msg) {
  if (!$toast) return;
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $toast.classList.remove("show"), 1800);
}

// =============== LOGGING ===============
const $logsLocal = document.getElementById("logs-local");
const $logsServer = document.getElementById("logs-server");
const $autoScroll = document.getElementById("autoScroll");

function addLocalLog(line) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  const div = document.createElement("div");
  div.textContent = `[${ts}] ${line}`;
  div.style.color = "#9ddcff"; // biru muda = log GUI
  $logsLocal?.appendChild(div);
  if ($autoScroll?.checked) $logsLocal.scrollTop = $logsLocal.scrollHeight;
}

function addServerLog(line) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  const text = String(line || "");

  // ⛔ Guard: kalau ada [LOCAL], otomatis pindah ke Local Actions
  if (/\[LOCAL\]/.test(text)) {
    const pure = text.replace(/^.*?\[LOCAL\]\s*/, "");
    addLocalLog(pure);
    return;
  }

  const div = document.createElement("div");
  div.textContent = `[${ts}] ${text}`;
  if (text.includes("💬")) div.style.color = "#8eff8e"; // chat = hijau
  if (text.includes("⚠️")) div.style.color = "#ffea8e"; // warning = kuning
  if (text.includes("❌")) div.style.color = "#ff8e8e"; // error = merah
  $logsServer?.appendChild(div);
  if ($autoScroll?.checked) $logsServer.scrollTop = $logsServer.scrollHeight;
}

// Bersihkan & unduh log
document.getElementById("btn-clear-log")?.addEventListener("click", () => {
  if ($logsLocal) $logsLocal.innerHTML = "";
  if ($logsServer) $logsServer.innerHTML = "";
});
document.getElementById("btn-download-log")?.addEventListener("click", () => {
  const local = [...($logsLocal?.children || [])].map((x) => x.textContent);
  const server = [...($logsServer?.children || [])].map((x) => x.textContent);
  const all = [...local, ...server].join("\n");
  const blob = new Blob([all + "\n"], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `multibot-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
});

// =============== SOCKET (AUTO RECONNECT) ===============
// =============== SOCKET (AUTO RECONNECT) ===============
window.socket =
  window.socket ||
  io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });
const socket = window.socket;

const $connDot = document.getElementById("connDot");
const $connText = document.getElementById("connText");

socket.on("connect", () => {
  if ($connDot) $connDot.className = "dot ok";
  if ($connText) $connText.textContent = "Connected";
  addLocalLog("🟢 Connected to server");
});

socket.on("disconnect", () => {
  if ($connDot) $connDot.className = "dot bad";
  if ($connText) $connText.textContent = "Disconnected";
  addLocalLog("🔴 Disconnected");
});

socket.on("reconnect_attempt", () => addLocalLog("🔄 Reconnecting..."));
socket.on("localLog", (msg) => addLocalLog(msg));

socket.on("botLog", (msg) => {
  const text = String(msg || "");
  if (/\[LOCAL\]/.test(text)) {
    const pure = text.replace(/^.*?\[LOCAL\]\s*/, "");
    addLocalLog(pure);
    return; // JANGAN kirim ke Server Logs
  }
  addServerLog(text);
});

// Update daftar bot
socket.on("update", (list) => renderBots(list));

// Chat masuk (public/system/whisper)
socket.on("chat", ({ user, msg, type }) => {
  if (type === "system") addServerLog(`⚙️ <SERVER> ${msg}`);
  else if (type === "whisper") addServerLog(`💬 (whisper) <${user}> ${msg}`);
  else addServerLog(`💬 <${user}> ${msg}`);
});

// =============== UTIL ===============
function parseSpawnMessages(raw) {
  return (raw || "")
    .split(/,+/g) // pisah dengan koma (satu atau lebih)
    .map((s) => s.trim())
    .filter(Boolean);
}

// =============== STATE ===============
let botList = [];
let selectedBots = new Set();
let filterQuery = "";

// =============== RENDER BOT LIST ===============
const $botList = document.getElementById("botList");
const $botCount = document.getElementById("botCount");
const $botFilter = document.getElementById("botFilter");
const $btnSelectAll = document.getElementById("btn-select-all");

function renderBots(list) {
  botList = Array.isArray(list) ? list : [];
  if ($botCount) $botCount.textContent = String(botList.length);
  if (!$botList) return;

  $botList.innerHTML = "";

  if (botList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "bot-item muted";
    empty.textContent = "Belum ada bot";
    $botList.appendChild(empty);
    return;
  }

  // sort by name
  const data = [...botList].sort((a, b) => a.username.localeCompare(b.username));

  for (const bot of data) {
    if (filterQuery && !bot.username.toLowerCase().includes(filterQuery)) continue;

    const item = document.createElement("div");
    item.className = "bot-item";
    if (selectedBots.has(bot.username)) item.classList.add("active");

    const name = document.createElement("div");
    name.className = "bot-name";
    name.textContent = bot.username;

    const status = document.createElement("div");
    status.className = "bot-status";
    status.textContent = bot.connected ? "🟢 Online" : "🔴 Offline";

    item.appendChild(name);
    item.appendChild(status);

    item.addEventListener("click", () => {
      const selected = selectedBots.has(bot.username);
      if (selected) {
        selectedBots.delete(bot.username);
        item.classList.remove("active");
      } else {
        selectedBots.add(bot.username);
        item.classList.add("active");
      }
      toast(`${selectedBots.size} bot dipilih`);
    });

    $botList.appendChild(item);
  }
}

// Filter input
$botFilter?.addEventListener("input", () => {
  filterQuery = ($botFilter.value || "").toLowerCase();
  renderBots(botList);
});

// Pilih semua / batal semua
$btnSelectAll?.addEventListener("click", () => {
  if (!$botList) return;
  const items = [...$botList.querySelectorAll(".bot-item")];
  const anyInactive = items.some((it) => !it.classList.contains("active"));
  // Toggle via click agar logikanya seragam
  items.forEach((it) => {
    const isActive = it.classList.contains("active");
    if (anyInactive && !isActive) it.dispatchEvent(new Event("click", { bubbles: true }));
    if (!anyInactive && isActive) it.dispatchEvent(new Event("click", { bubbles: true }));
  });
});

// =============== CREATE BOT ===============
document.getElementById("btn-create")?.addEventListener("click", () => {
  const username = document.getElementById("username").value.trim();
  const server = document.getElementById("server").value.trim();
  const spawnChat = document.getElementById("spawnChat").value.trim();

  if (!username || !/^[^:]+:\d{2,5}$/.test(server)) {
    toast("⚠️ Format server harus host:port (contoh: mc.server.net:25565)");
    return;
  }

  const [host, port] = server.split(":");
  const spawnMessages = parseSpawnMessages(spawnChat);
  const spawnDelayMs = 5000; // fix 5 detik

  socket.emit("createBot", {
    username,
    host,
    port: parseInt(port, 10),
    // matikan legacy auto-send di sBot
    spawnChat: "",
    // scheduler server
    spawnMessages,
    spawnDelayMs,
  });

  // selectedBots.add(username);
  addLocalLog(`🚀 CreateBot → ${username} @ ${server} (${spawnMessages.length} pesan, delay=${spawnDelayMs}ms)`);
  toast(`🤖 Bot ${username} dibuat & dipilih`);
  switchTab("control");
});

// Enter di halaman login => buat bot
document.addEventListener("keydown", (e) => {
  const onLogin = $viewLogin?.classList.contains("active") && !$viewLogin?.classList.contains("hidden");
  if (!onLogin) return;
  if (e.key === "Enter" && !e.shiftKey) {
    const active = document.activeElement?.id;
    if (["username", "server", "spawnChat"].includes(active)) {
      e.preventDefault();
      document.getElementById("btn-create")?.click();
    }
  }
});

// =============== COMMAND HELPERS ===============
function sendToSelected(cmd) {
  if (selectedBots.size === 0) {
    toast("⚠️ Pilih minimal 1 bot!");
    return;
  }
  for (const username of selectedBots) {
    socket.emit("command", { username, text: cmd });
    addLocalLog(`➡️ ${username}: ${cmd}`);
  }
}

// Buttons
document.getElementById("btn-mining-start")?.addEventListener("click", () => sendToSelected("mining start"));
document.getElementById("btn-mining-stop")?.addEventListener("click", () => sendToSelected("mining stop"));

document.getElementById("btn-ray")?.addEventListener("click", () => {
  const stepsRaw = document.getElementById("raySteps").value;
  const steps = Math.max(1, Math.min(12, parseInt(stepsRaw || "5", 10)));
  sendToSelected(`ray ${steps}`);
});

document.getElementById("btn-stop")?.addEventListener("click", () => {
  if (selectedBots.size === 0) return toast("⚠️ Pilih bot dulu!");
  for (const username of selectedBots) {
    socket.emit("stopBot", { username });
    addLocalLog(`🛑 StopBot → ${username}`);
  }
});

// =============== CHAT (langsung ke in-game) ===============
const $chatMsg = document.getElementById("chatMsg");
document.getElementById("btn-send-chat")?.addEventListener("click", () => {
  const text = ($chatMsg?.value || "").trim();
  if (!text) return;

  if (selectedBots.size === 0) {
    toast("⚠️ Pilih minimal 1 bot!");
    return;
  }

  // log lokal dulu
  for (const u of selectedBots) addLocalLog(`💬 [GUI] ${u}: ${text}`);

  // kirim ke server (biar muncul log dari bot)
  socket.emit("sendChat", { usernames: Array.from(selectedBots), text });

  if ($chatMsg) $chatMsg.value = "";
});

// Shortcut: Ctrl/Cmd + Enter kirim chat
$chatMsg?.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    document.getElementById("btn-send-chat")?.click();
  }
});

// Init
addLocalLog("💫 Dashboard v2.1 ready (minimal, 2-pane, multi-bot).");
