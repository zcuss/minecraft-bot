// features/utils/shop-utils.js
// Helper GUI shop (tahan perubahan UI, regex item longgar, logging ke Local Actions)
// Aman dijalankan di Node (TIDAK menyentuh DOM).

function makeLocalLogger({ log, logLocal }) {
  // Semua log "lokal" harus lewat sini.
  // Urutan prioritas:
  // 1) logLocal (jika disediakan oleh host) → langsung ke panel Local Actions.
  // 2) fallback: log() dengan prefix [LOCAL] → dirutekan oleh client ke Local Actions.
  // 3) fallback akhir: console.log
  return (...args) => {
    const msg = args.join(" ");
    if (typeof logLocal === "function") {
      try {
        return logLocal(msg);
      } catch {}
    }
    if (typeof log === "function") return log("[LOCAL] " + msg);
    console.log("[LOCAL]", msg);
  };
}

module.exports = function makeShop(bot, { log, logLocal } = {}) {
  const L = makeLocalLogger({ log, logLocal });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ========== TEXT & ITEM UTILS ==========
  const stripCodes = (s) =>
    String(s || "")
      .replace(/§./g, "")
      .trim();
  const itemLabel = (it) => stripCodes(it?.customName || it?.displayName || it?.name || "").toLowerCase();

  function getLoreLines(it) {
    if (Array.isArray(it?.lore) && it.lore.length) return it.lore.map((x) => stripCodes(String(x)));
    try {
      const loreNbt = it?.nbt?.value?.display?.value?.Lore?.value?.value;
      if (Array.isArray(loreNbt) && loreNbt.length) {
        return loreNbt.map((x) => stripCodes(typeof x === "string" ? x : JSON.stringify(x)));
      }
    } catch {}
    return [];
  }

  function debugItemBrief(it) {
    const name = stripCodes(it?.customName || it?.displayName || it?.name || "");
    const lore = getLoreLines(it);
    return lore[0] ? `${name} | lore: ${lore[0]}` : name;
  }

  // --- DEBUG HELPERS ---
  function getDisplayName(it) {
    return stripCodes(it?.customName || it?.displayName || it?.name || "");
  }
  function getItemId(it) {
    // mineflayer biasanya memberi id pendek (tanpa namespace), contoh "grass_block"
    return (it?.name || "").toLowerCase();
  }

  function dumpWindowSlots(win, { max = 54, onlyInteresting = true } = {}) {
    const slots = win?.slots || [];
    let count = 0;
    for (let i = 0; i < slots.length && count < max; i++) {
      const it = slots[i];
      if (!it) continue;
      const id = getItemId(it);
      const disp = getDisplayName(it);
      // saring ornamen supaya log nggak berisik
      if (onlyInteresting) {
        const n = (it?.name || "").toLowerCase();
        const lbl = itemLabel(it);
        const isDecor =
          /pane|glass_pane|stained.*pane/.test(n) ||
          /barrier|light_weighted_pressure_plate|heavy_weighted_pressure_plate/.test(n) ||
          /decor|ornamen|dekor/.test(lbl);
        if (isDecor) continue;
      }
      L(`   [${i}] ${disp} — id:${id}`);
      count++;
    }
    if (count === 0) L("   (no interesting items)");
  }

  function slotMatches(win, pred) {
    const out = [];
    const slots = win?.slots || [];
    for (let i = 0; i < slots.length; i++) {
      const it = slots[i];
      if (it && pred(it, i)) out.push({ index: i, item: it });
    }
    return out;
  }

  // ===== INVENTORY HELPERS (cek kebeli/nggak) =====
  function countItemInInventory(id) {
    let n = 0;
    for (const it of bot.inventory.items()) {
      if (!it) continue;
      if ((it.name || "").toLowerCase() === String(id).toLowerCase()) n += it.count || 0;
    }
    return n;
  }
  function getStackSize(id) {
    try {
      const item = bot.registry?.itemsByName?.[id];
      const s = item?.stackSize || 64;
      return s > 0 && s <= 64 ? s : 64;
    } catch {
      return 64;
    }
  }

  // ===== BELI INSTAN: klik kiri berulang + delta inventory =====
  async function leftClickBuy(win, slot, clicks = 9) {
    const it = win?.slots?.[slot];
    if (!it) throw new Error("leftClickBuy: slot kosong");
    const disp = getDisplayName(it);
    const id = getItemId(it);

    L(`🛍️ Instant LEFT-BUY target: slot=${slot}, name="${disp}", id=${id}`);

    const before = countItemInInventory(id);
    for (let i = 1; i <= clicks; i++) {
      await bot.clickWindow(slot, 0, 0); // mouse=0 (left), mode=0 normal
      if (i <= 5 || i % 10 === 0) L(`   🔘 left click #${i}`);
      await sleep(140); // jeda kecil biar server kebaca
    }
    const after = countItemInInventory(id);
    const delta = after - before;
    if (delta > 0) {
      const ss = getStackSize(id);
      const approxStacks = (delta / ss).toFixed(2);
      L(`✅ Purchased: +${delta} items (~${approxStacks} stacks, stackSize=${ss})`);
    } else {
      L(`⚠️ Tidak ada penambahan item "${disp}" (id=${id}). Cek saldo/limit atau tipe klik yang benar.`);
    }
    return true;
  }

  // ========== WINDOW / UI FLOW ==========
  async function clickSlot(win, index, mouse = 0, mode = 0) {
    await bot.clickWindow(index, mouse, mode);
    await sleep(150);
  }
  async function waitStableWindow(win, stableMs = 200) {
    await sleep(stableMs);
    return win;
  }
  // Deteksi perubahan UI berikutnya: windowOpen / windowUpdate / setSlot
  async function waitNextUIChange(prevWin, { timeout = 8000, stableMs = 200 } = {}) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const start = Date.now();
      const clean = () => {
        try {
          bot.removeListener("windowOpen", onOpen);
        } catch {}
        try {
          bot.removeListener("windowUpdate", onUpdate);
        } catch {}
        try {
          bot.removeListener("setSlot", onSetSlot);
        } catch {}
      };
      const finish = (w) => {
        if (resolved) return;
        resolved = true;
        clean();
        setTimeout(() => resolve(w), stableMs);
      };
      const onOpen = (w) => finish(w);

      const snapFrom = (w) => (w?.slots || []).map((it) => itemLabel(it)).join("|");
      let snapshot = snapFrom(prevWin || bot.currentWindow);
      const onUpdate = () => {
        const curWin = bot.currentWindow || prevWin;
        const cur = snapFrom(curWin);
        if (cur !== snapshot) {
          snapshot = cur;
          finish(curWin);
        }
      };
      const onSetSlot = onUpdate;

      bot.once("windowOpen", onOpen);
      bot.on("windowUpdate", onUpdate);
      bot.on("setSlot", onSetSlot);

      const poll = setInterval(() => {
        if (resolved) return clearInterval(poll);
        if (Date.now() - start > timeout) {
          clearInterval(poll);
          clean();
          reject(new Error("waitNextUIChange timeout"));
        }
      }, 100);
    });
  }
  function closeWindowSafe() {
    try {
      bot.closeWindow(bot.currentWindow);
    } catch {}
  }

  // ========== PENCARIAN PRODUK (regex longgar) ==========
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function buildLooseItemRegex(query) {
    let q = String(query || "")
      .toLowerCase()
      .trim();
    q = q
      .replace(/^minecraft:/, "")
      .replace(/[_\-\s]+/g, " ")
      .trim();
    if (!q) return /$a/;
    const parts = q.split(" ").filter(Boolean).map(escapeRe);
    const last = parts.pop();
    const head = parts.length ? parts.join("[ _\\-]*") + "[ _\\-]*" : "";
    const core = head + last + "s?";
    return new RegExp(`(?:^|minecraft:)${core}\\b|\\b${core}\\b`, "i");
  }

  // ========== FLOW SHOP (exported) ==========
  async function openShopRoot() {
    bot.chat("/shop");
    const win = await waitNextUIChange(null, { timeout: 8000, stableMs: 200 });
    await waitStableWindow(win);
    return win;
  }

  // Cari produk (banyak server menaruh item di root; paging opsional)
  async function findProductAcrossPages(startWin, productRegex, maxPages = 12) {
    let win = startWin;
    for (let page = 0; page < maxPages; page++) {
      const matches = (win?.slots || []).map((it, i) => ({ item: it, index: i })).filter(({ item }) => item && productRegex.test(itemLabel(item)));
      if (matches.length) {
        const pick = matches[0];
        L(`🔍 Found product @page ${page + 1}, slot ${pick.index}: ${debugItemBrief(pick.item)} (total=${matches.length})`);
        return { win, slot: pick.index };
      }
      // Jika server pakai tombol next/prev, tambahkan deteksi & klik di sini.
      break; // default: asumsi tidak ada paging.
    }
    throw new Error("Produk tidak ditemukan di semua halaman");
  }

  // High-level: beli item
  async function autoBuyFromShop({ name, category /* optional, diabaikan di root-search */ }) {
    const productRegex = buildLooseItemRegex(name);
    try {
      L(`🛒 AutoBuy start: '${name}' (/shop)`);
      // 1) buka shop root
      const win = await openShopRoot();

      // 2) cari produk langsung di root (server kamu menaruh item di root)
      const found = await findProductAcrossPages(win, productRegex, 1);

      // 3) debug sebelum beli
      const it = found.win?.slots?.[found.slot];
      L(`🎯 Click target: slot=${found.slot}, name="${getDisplayName(it)}", id=${getItemId(it)}`);
      L("🧾 Before buy — window contents:");
      dumpWindowSlots(found.win, { max: 54, onlyInteresting: true });

      // 4) beli instan via klik kiri
      await leftClickBuy(found.win, found.slot, 9);

      // 5) debug sesudah beli
      L("🧾 After buy — window contents (may be unchanged):");
      dumpWindowSlots(found.win, { max: 54, onlyInteresting: true });

      L("✅ AutoBuy selesai (instant left-click).");
      return true;
    } catch (e) {
      L(`❌ AutoBuy gagal: ${e?.message || e}`);
      closeWindowSafe();
      return false;
    }
  }

  return {
    // high-level:
    autoBuyFromShop,
    // utils:
    buildLooseItemRegex,
    // (kalau perlu expose tambahan)
    openShopRoot,
    findProductAcrossPages,
  };
};
