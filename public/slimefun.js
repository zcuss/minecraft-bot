// ==== Socket ====
const socket = io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 2000 });

// ==== DOM ====
const $connDot = document.getElementById("connDot");
const $connText = document.getElementById("connText");
const $toast = document.getElementById("toast");
const $botList = document.getElementById("botList");
const $botCount = document.getElementById("botCount");
const $botFilter = document.getElementById("botFilter");

// Logs
const $logsLocal = document.getElementById("logs-local");
const $logsServer = document.getElementById("logs-server");
const $autoScroll = document.getElementById("autoScroll");

// Chat
const $chatMsg = document.getElementById("chatMsg");
const $btnSendChat = document.getElementById("btn-send-chat");

// Slimefun Quick
const $sfGuide = document.getElementById("sf-guide");
const $sfResAll = document.getElementById("sf-research-all");
const $sfBackpack = document.getElementById("sf-backpack");

// Search/Wiki
const $sfSearchTerm = document.getElementById("sfSearchTerm");
const $sfSearch = document.getElementById("sf-search");
const $sfWiki = document.getElementById("sf-wiki");

// Panning
const $panItem = document.getElementById("panItem");
const $panCps = document.getElementById("panCps");
const $panRadius = document.getElementById("panRadius");
const $panSlot = document.getElementById("panSlot");
const $panStart = document.getElementById("pan-start");
const $panStop = document.getElementById("pan-stop");
const $panStatus = document.getElementById("pan-status");

// ==== Helpers ====
let botList = [];
let selectedBots = new Set();

function toast(msg) {
  if (!$toast) return;
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $toast.classList.remove("show"), 1600);
}

function addLocalLog(line) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  const div = document.createElement("div");
  div.textContent = `[${ts}] ${line}`;
  div.style.color = "#9ddcff";
  $logsLocal.appendChild(div);
  if ($autoScroll?.checked) $logsLocal.scrollTop = $logsLocal.scrollHeight;
}

function addServerLog(line) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  const div = document.createElement("div");
  div.textContent = `[${ts}] ${line}`;
  if (line.includes("💬")) div.style.color = "#8eff8e";
  if (line.includes("⚠️")) div.style.color = "#ffea8e";
  if (line.includes("❌")) div.style.color = "#ff8e8e";
  $logsServer.appendChild(div);
  if ($autoScroll?.checked) $logsServer.scrollTop = $logsServer.scrollHeight;
}

document.getElementById("btn-clear-log")?.addEventListener("click", () => {
  $logsLocal.innerHTML = "";
  $logsServer.innerHTML = "";
});
document.getElementById("btn-download-log")?.addEventListener("click", () => {
  const all = [...$logsLocal.children, ...$logsServer.children].map((x) => x.textContent).join("\n");
  const blob = new Blob([all + "\n"], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `slimefun-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
});

// ==== Socket events ====
socket.on("connect", () => {
  $connDot.className = "dot ok";
  $connText.textContent = "Connected";
  addLocalLog("🟢 Connected to server");
});
socket.on("disconnect", () => {
  $connDot.className = "dot bad";
  $connText.textContent = "Disconnected";
  addLocalLog("🔴 Disconnected");
});
socket.on("reconnect_attempt", () => addLocalLog("🔄 Reconnecting..."));

socket.on("botLog", (msg) => addServerLog(msg));
socket.on("chat", ({ user, msg, type }) => {
  if (type === "system") addServerLog(`⚙️ <SERVER> ${msg}`);
  else if (type === "whisper") addServerLog(`💬 (whisper) <${user}> ${msg}`);
  else addServerLog(`💬 <${user}> ${msg}`);
});
socket.on("update", (list) => renderBots(list));

// ==== Bot list render/select ====
function renderBots(list) {
  botList = Array.isArray(list) ? list : [];
  if ($botCount) $botCount.textContent = `${botList.length}`;
  $botList.innerHTML = "";

  if (botList.length === 0) {
    $botList.innerHTML = `<div class="bot-item muted">Belum ada bot</div>`;
    return;
  }

  for (const bot of botList) {
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

// Filter & pilih semua
document.getElementById("btn-select-all")?.addEventListener("click", () => {
  const items = [...$botList.querySelectorAll(".bot-item")];
  const allActive = items.every((i) => i.classList.contains("active"));
  items.forEach((it) => {
    const active = it.classList.contains("active");
    if (allActive && active) it.click();
    else if (!allActive && !active) it.click();
  });
});
$botFilter?.addEventListener("input", () => {
  const q = $botFilter.value.toLowerCase();
  for (const item of $botList.children) {
    const name = item.querySelector(".bot-name")?.textContent?.toLowerCase() || "";
    item.style.display = name.includes(q) ? "" : "none";
  }
});

// ==== Command helpers ====
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

// Chat inline (langsung ke server agar log dari bot juga muncul)
$btnSendChat?.addEventListener("click", () => {
  const text = ($chatMsg.value || "").trim();
  if (!text) return;
  if (selectedBots.size === 0) return toast("⚠️ Pilih minimal 1 bot!");
  socket.emit("sendChat", { usernames: Array.from(selectedBots), text });
  for (const u of selectedBots) addLocalLog(`💬 [GUI] ${u}: ${text}`);
  $chatMsg.value = "";
});
$chatMsg?.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    $btnSendChat?.click();
  }
});

// ==== Slimefun quick actions ====
$sfGuide?.addEventListener("click", () => sendToSelected("/sf guide"));
$sfResAll?.addEventListener("click", () => sendToSelected("/sf research all"));
$sfBackpack?.addEventListener("click", () => sendToSelected("/sf backpack"));

$sfSearch?.addEventListener("click", () => {
  const q = ($sfSearchTerm?.value || "").trim();
  if (!q) return;
  sendToSelected(`/sf search ${q}`);
});
$sfWiki?.addEventListener("click", () => {
  const q = ($sfSearchTerm?.value || "").trim();
  if (!q) return;
  sendToSelected(`/sf wiki ${q}`);
});

// ==== Panning machine ====
$panStart?.addEventListener("click", () => {
  const item = ($panItem?.value || "gravel").trim();
  const cps = Math.max(1, Math.min(15, parseInt($panCps?.value || "5", 10)));
  const radius = Math.max(3, Math.min(24, parseInt($panRadius?.value || "12", 10)));
  const slot = Math.max(1, Math.min(9, parseInt($panSlot?.value || "1", 10)));
  sendToSelected(`pan start item=${item} cps=${cps} radius=${radius} slot=${slot}`);
});
$panStop?.addEventListener("click", () => sendToSelected("pan stop"));
$panStatus?.addEventListener("click", () => sendToSelected("pan status"));

// Init
addLocalLog("💫 Slimefun page loaded.");
