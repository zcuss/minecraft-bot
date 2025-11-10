// features/slimefun.js
const {
  Movements,
  goals: { GoalNear },
} = require("mineflayer-pathfinder");
const makeShop = require("./utils/shop-utils");

exports.name = "slimefun";

exports.init = async function init(bot, { log }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clampInt = (n, min, max) => Math.max(min, Math.min(max, n | 0));

  // === init shop helpers ===
  const shop = makeShop(bot, {
    log,
    // kirim log lokal (GUI / AutoBuy dll) ke panel Local Actions
    logLocal: (msg) => log(`[LOCAL] ${msg}`),
  });

  // ========== INV HELPERS ==========
  function findItemByName(targetName) {
    if (!targetName) return null;
    const t = String(targetName).toLowerCase();
    const items = bot.inventory.items();
    return (
      items.find((it) => {
        const n = (it?.name || "").toLowerCase();
        return n === t || n.endsWith(":" + t) || n === t.replace(/^minecraft:/, "");
      }) || null
    );
  }

  async function ensureHoldItem(targetName, hotbarIndex = 0) {
    try {
      const tn = String(targetName || "").toLowerCase();
      if (!tn) return false;
      const held = bot.heldItem?.name?.toLowerCase();
      if (held && (held === tn || held.endsWith(":" + tn) || held === tn.replace(/^minecraft:/, ""))) return true;
      const it = findItemByName(tn);
      if (!it) {
        log(`🧺 Item '${tn}' tidak ada di inventory`);
        return false;
      }
      const idx = clampInt(hotbarIndex, 0, 8);
      if (bot.quickBarSlot !== idx) bot.setQuickBarSlot(idx);
      await bot.equip(it, "hand");
      const held2 = bot.heldItem?.name?.toLowerCase();
      return !!(held2 && (held2 === tn || held2.endsWith(":" + tn) || held2 === tn.replace(/^minecraft:/, "")));
    } catch (e) {
      log(`❌ ensureHoldItem: ${e?.message || e}`);
      return false;
    }
  }

  // ====== BLOCK TYPE HELPERS ======
  const nameOf = (b) => (b?.name || "").toLowerCase();
  const isCauldron = (b) => !!b && nameOf(b).includes("cauldron");
  const isOakTrapdoor = (b) => !!b && nameOf(b).includes("trapdoor") && (nameOf(b).includes("oak") || nameOf(b) === "oak_trapdoor");
  const isFence = (b) => !!b && /fence/.test(nameOf(b));
  const isDispenser = (b) => !!b && nameOf(b) === "dispenser";

  // ====== PATHING ======
  async function goTo(pos) {
    try {
      const mc = new Movements(bot);
      bot.pathfinder.setMovements(mc);
      bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 1));
      let t = 0;
      while (t < 12000) {
        await sleep(200);
        if (bot.entity.position.distanceTo(pos) <= 1.6) break;
        t += 200;
      }
    } catch (e) {
      log("Path error:", e?.message || e);
    } finally {
      try {
        bot.pathfinder.setGoal(null);
      } catch {}
    }
  }

  // ====== CLICK helpers ======
  async function faceBlockCenter(b) {
    try {
      await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true);
    } catch {}
  }
  function rightClickBlock(b) {
    try {
      bot.activateBlock(b);
    } catch (e) {
      log("activateBlock:", e?.message || e);
    }
  }

  // ================== MODE 1: Auto Panning ==================
  let pan = (() => {
    let running = false,
      timer = null,
      target = null;
    let cfg = { radius: 12, cps: 5, material: "gravel", hotbarIndex: 0, autobuy: 0, buyname: "" };

    function nearestMachine(radius) {
      const base = bot.entity?.position?.floored();
      if (!base) return null;
      let best = null,
        bestD2 = Infinity;
      for (let y = -2; y <= 2; y++)
        for (let x = -radius; x <= radius; x++)
          for (let z = -radius; z <= radius; z++) {
            const p = base.offset(x, y, z);
            const caul = bot.blockAt(p, false);
            if (!isCauldron(caul)) continue;
            const td = bot.blockAt(p.offset(0, 1, 0), false);
            if (!isOakTrapdoor(td)) continue;
            const d2 = p.distanceTo(base) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = { cauldronPos: p.clone(), trapdoor: td };
            }
          }
      return best;
    }

    function schedule(ms) {
      clearTimeout(timer);
      if (!running) return;
      timer = setTimeout(loop, ms);
    }

    async function loop() {
      try {
        if (!running) return;

        if (!target || !bot.blockAt(target.cauldronPos) || !isOakTrapdoor(target.trapdoor)) {
          target = nearestMachine(cfg.radius);
          if (!target) {
            log(`🧪 AutoPan: mesin tidak ditemukan (r=${cfg.radius})`);
            schedule(1000);
            return;
          }
          log(`🧪 AutoPan: target @ ${target.cauldronPos.x},${target.cauldronPos.y},${target.cauldronPos.z}`);
          await goTo(target.cauldronPos);
        }

        let ok = await ensureHoldItem(cfg.material, cfg.hotbarIndex);
        if (!ok && cfg.autobuy) {
          const want = cfg.buyname || cfg.material;
          const bought = await shop.autoBuyFromShop({ name: want, category: /(blocks?|building\s*blocks|materials|blok)/i });
          if (bought) ok = await ensureHoldItem(cfg.material, cfg.hotbarIndex);
        }
        if (!ok) {
          schedule(1500);
          return;
        }

        await faceBlockCenter(target.trapdoor);
        rightClickBlock(target.trapdoor);
      } catch (e) {
        log("AutoPan loop:", e?.message || e);
      } finally {
        const interval = Math.max(120, Math.floor(1000 / Math.max(1, cfg.cps)));
        schedule(interval);
      }
    }

    function start(flags = {}) {
      if (flags.radius !== undefined) cfg.radius = +flags.radius || cfg.radius;
      if (flags.cps !== undefined) cfg.cps = +flags.cps || cfg.cps;
      if (flags.item || flags.material) cfg.material = String(flags.item || flags.material).toLowerCase();
      if (flags.slot !== undefined) cfg.hotbarIndex = clampInt(+flags.slot - 1, 0, 8);
      if (flags.autobuy !== undefined) cfg.autobuy = +flags.autobuy ? 1 : 0;
      if (flags.buyname !== undefined) cfg.buyname = String(flags.buyname).trim();
      target = null;
      clearTimeout(timer);
      running = true;
      log(
        `✅ AutoPan ON (material='${cfg.material}', slot=${cfg.hotbarIndex + 1}, r=${cfg.radius}, cps=${cfg.cps}, autobuy=${cfg.autobuy}, buyname='${
          cfg.buyname || cfg.material
        }')`
      );
      schedule(10);
    }
    function stop() {
      running = false;
      clearTimeout(timer);
      timer = null;
      target = null;
      try {
        bot.pathfinder.setGoal(null);
      } catch {}
      log("⛔ AutoPan OFF");
    }
    function status() {
      log(
        `ℹ️ AutoPan: ${running ? "ON" : "OFF"} (material='${cfg.material}', slot=${cfg.hotbarIndex + 1}, r=${cfg.radius}, cps=${cfg.cps}, autobuy=${
          cfg.autobuy
        }, buyname='${cfg.buyname || cfg.material}')`
      );
    }
    async function buy(flags = {}) {
      let nm = flags.name ?? flags.item ?? flags.material ?? cfg.buyname ?? cfg.material ?? "";
      nm = String(nm);
      try {
        nm = nm.replace(/\+/g, " ");
        nm = decodeURIComponent(nm);
      } catch {}
      nm = nm.trim();
      if (!nm) return log("Usage: pan buy name=<nama item>");
      log(`🧾 pan.buy → target='${nm}'`);
      await shop.autoBuyFromShop({ name: nm, category: /(blocks?|building\s*blocks|materials|blok)/i });
    }

    return { start, stop, status, buy };
  })();

  // ================== MODE 2: Automatic Ore Washer ==================
  let washer = (() => {
    let running = false,
      timer = null,
      target = null;
    let cfg = { radius: 12, cps: 6, hotbarIndex: 0 };

    function findWasher(radius) {
      const base = bot.entity?.position?.floored();
      if (!base) return null;
      let best = null,
        bestD2 = Infinity;

      const offsetsAround = [
        { x: 0, y: 2, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 0, y: 1, z: -1 },
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 },
      ];

      for (let y = -2; y <= 2; y++)
        for (let x = -radius; x <= radius; x++)
          for (let z = -radius; z <= radius; z++) {
            const p = base.offset(x, y, z);
            const caul = bot.blockAt(p, false);
            if (!isCauldron(caul)) continue;

            const fen = bot.blockAt(p.offset(0, 1, 0), false);
            if (!isFence(fen)) continue;

            let disp = null;
            for (const o of offsetsAround) {
              const b = bot.blockAt(p.offset(o.x, o.y, o.z), false);
              if (isDispenser(b)) {
                disp = b;
                break;
              }
            }
            if (!disp) continue;

            const d2 = p.distanceTo(base) ** 2;
            if (d2 < bestD2) (best = { cauldronPos: p.clone(), fence: fen, dispenser: disp }), (bestD2 = d2);
          }
      return best;
    }

    function schedule(ms) {
      clearTimeout(timer);
      if (!running) return;
      timer = setTimeout(loop, ms);
    }

    async function loop() {
      try {
        if (!running) return;
        if (!target || !bot.blockAt(target.cauldronPos) || !isFence(target.fence) || !isDispenser(target.dispenser)) {
          target = findWasher(cfg.radius);
          if (!target) {
            log(`🧪 Washer: struktur tidak ditemukan (r=${cfg.radius})`);
            schedule(1000);
            return;
          }
          log(`🧪 Washer target @ ${target.cauldronPos.x},${target.cauldronPos.y},${target.cauldronPos.z}`);
          await goTo(target.cauldronPos);
        }
        await faceBlockCenter(target.fence);
        rightClickBlock(target.fence);
      } catch (e) {
        log("Washer loop:", e?.message || e);
      } finally {
        const interval = Math.max(80, Math.floor(1000 / Math.max(1, cfg.cps)));
        schedule(interval);
      }
    }

    function start(flags = {}) {
      if (flags.radius !== undefined) cfg.radius = +flags.radius || cfg.radius;
      if (flags.cps !== undefined) cfg.cps = +flags.cps || cfg.cps;
      if (flags.slot !== undefined) cfg.hotbarIndex = clampInt(+flags.slot - 1, 0, 8);
      target = null;
      clearTimeout(timer);
      running = true;
      log(`✅ Washer ON (r=${cfg.radius}, cps=${cfg.cps ?? 6}, slot=${(cfg.hotbarIndex ?? 0) + 1})`);
      schedule(10);
    }
    function stop() {
      running = false;
      clearTimeout(timer);
      timer = null;
      target = null;
      try {
        bot.pathfinder.setGoal(null);
      } catch {}
      log("⛔ Washer OFF");
    }
    function status() {
      log(`ℹ️ Washer: ${running ? "ON" : "OFF"} (r=${cfg.radius}, cps=${cfg.cps ?? 6})`);
    }
    return { start, stop, status };
  })();

  // ================== ROUTER PERINTAH ==================
  bot._registerCommandHandler?.(async (cmd, args) => {
    if (cmd !== "pan") return false;
    const sub = (args[0] || "").toLowerCase();
    const flags = {};
    for (const t of args.slice(1)) {
      const m = t.match(/^([a-zA-Z]+)=(.+)$/);
      if (m) flags[m[1]] = m[2];
    }
    if (sub === "start") pan.start(flags);
    else if (sub === "stop") pan.stop();
    else if (sub === "status") pan.status();
    else if (sub === "buy") pan.buy(flags);
    else log("Usage: pan start [radius=12 cps=5 item=gravel slot=1 autobuy=1 buyname=gravel] | pan stop | pan status | pan buy name=<item>");
    return true;
  });

  bot._registerCommandHandler?.(async (cmd, args) => {
    if (cmd !== "washer") return false;
    const sub = (args[0] || "").toLowerCase();
    const flags = {};
    for (const t of args.slice(1)) {
      const m = t.match(/^([a-zA-Z]+)=(.+)$/);
      if (m) flags[m[1]] = m[2];
    }
    if (sub === "start") washer.start(flags);
    else if (sub === "stop") washer.stop();
    else if (sub === "status") washer.status();
    else log("Usage: washer start [radius=12 cps=6 slot=1] | washer stop | washer status");
    return true;
  });

  // cleanup
  return () => {
    try {
      bot.pathfinder.setGoal(null);
    } catch {}
    try {
      pan.stop();
    } catch {}
    try {
      washer.stop();
    } catch {}
  };
};
