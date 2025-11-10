// features/login.js
exports.name = "login";

exports.init = async function init(bot, { cfg, log }) {
  // Ambil spawn messages dari GUI (array) atau legacy string dipisah koma
  let messages = Array.isArray(cfg.spawnMessages) ? cfg.spawnMessages : [];
  if (!messages.length && cfg.spawnChat) {
    messages = String(cfg.spawnChat)
      .split(/,+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const delay = Math.max(0, Math.min(60000, Number(cfg.spawnDelayMs ?? 10000)));
  if (!messages.length) return () => {};

  let canceled = false;
  (async () => {
    try {
      log(`⚙️ Kirim ${messages.length} pesan spawn (jeda ${delay} ms)`);
      for (let i = 0; i < messages.length; i++) {
        if (canceled) break;
        bot.chat(messages[i]);
        log(`💬 ${messages[i]}`);
        if (i < messages.length - 1) await new Promise((r) => setTimeout(r, delay));
      }
      if (!canceled) log("✅ Selesai kirim pesan spawn");
    } catch (e) {
      log(`❌ Spawn scheduler error: ${e?.message || e}`);
    }
  })();

  return () => {
    canceled = true;
  };
};
