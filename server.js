// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const botManager = require("./botManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ===== Socket per-connection (tidak menambahkan listener global) =====
io.on("connection", (socket) => {
  // kirim state awal ke klien baru
  socket.emit(
    "update",
    botManager.getBots().map((b) => ({ username: b.username, connected: b.connected }))
  );

  // optional: respon untuk fallback getState dari UI
  socket.on("getState", () => {
    socket.emit(
      "update",
      botManager.getBots().map((b) => ({ username: b.username, connected: b.connected }))
    );
  });

  socket.on("createBot", (cfg) => botManager.createBot(cfg));
  socket.on("stopBot", ({ username }) => botManager.stopBot({ username }));
  socket.on("command", ({ username, text }) => botManager.sendCommand({ username, text }));

  // kirim chat raw ke in-game (multi/single)
  socket.on("sendChat", ({ usernames, text }) => {
    try {
      if (Array.isArray(usernames)) {
        botManager.sendChat({ usernames, text });
      } else if (typeof usernames === "string") {
        botManager.sendChat({ usernames: [usernames], text });
      }
    } catch (e) {
      console.error("sendChat error:", e);
    }
  });
});

// ===== Relay GLOBAL: daftar SEKALI (hindari spam/duplikat) =====
botManager.events.on("botLog", (msg) => io.emit("botLog", msg));
botManager.events.on("update", (list) => io.emit("update", list));
botManager.events.on("chat", (data) => {
  // langsung teruskan apa adanya
  io.emit("chat", data);
});

server.listen(3000, () => console.log("🌍 GUI running on http://localhost:3000"));
