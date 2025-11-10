// features/control.js — hold + swing animation (target khusus dy=2 & dy=5)
const { Vec3 } = require("vec3");

exports.name = "control";

exports.init = async function init(bot, { log }) {
  let isMining = false;
  let onPhys = null;

  // state target & hold
  let currentTarget = null;
  let holding = false; // sudah kirim START & lagi “tahan”
  let primed = false; // aim + equip selesai
  let lastTargetPos = null;

  // setting DY yang diperbolehkan (relatif dari kaki)
  const ALLOWED_DY = [2, 5];

  // throttle ringan untuk satu-kali persiapan
  const LOOK_ON_PRIME = true;
  const LOOK_THROTTLE_MS = 120;
  const EQUIP_TIMEOUT_MS = 2000;
  let lastLookTime = 0;

  // ==== ANIMASI SWING ====
  const SWING_ON_START = true; // ayun sekali saat mulai
  const SWING_INTERVAL_TICKS = 6; // ayun tiap N physicsTick (6 ≈ 4x/detik)
  let swingTick = 0;
  function swingArm() {
    try {
      bot.swingArm("right");
    } catch {}
  }

  // ——— util ———
  function now() {
    return Date.now();
  }

  // Cari blok tepat di atas X/Z pemain hanya pada dy yang diizinkan
  function getAllowedBlockAbove() {
    const base = bot.entity.position.floored();
    for (const dy of ALLOWED_DY) {
      const p = base.offset(0, dy, 0);
      const b = bot.blockAt(p, false);
      if (b && b.name !== "air" && bot.canDigBlock(b)) return b;
    }
    return null;
  }

  // untuk blok di ATAS, face benar = 0 (BOTTOM)
  function faceForBlockAbove() {
    return 0;
  }

  // pilih nama paket yang tersedia (kompat banyak versi)
  const DIG_PKTS = ["player_action", "player_digging", "block_dig"];
  let digPacket = null;
  function pickDigPacket() {
    if (digPacket) return digPacket;
    const keys = bot?._client?._compiledPacketKeys || {};
    for (const n of DIG_PKTS)
      if (n in keys) {
        digPacket = n;
        break;
      }
    if (!digPacket) digPacket = "block_dig";
    return digPacket;
  }

  const DIG_STATUS = { START: 0, ABORT: 1, STOP: 2 };
  const PLAYER_ACTION = {
    START_DESTROY_BLOCK: 0,
    ABORT_DESTROY_BLOCK: 1,
    STOP_DESTROY_BLOCK: 2,
  };

  async function primeTarget(block) {
    if (LOOK_ON_PRIME && now() - lastLookTime > LOOK_THROTTLE_MS) {
      try {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
      } catch {}
      lastLookTime = now();
    }
    try {
      await Promise.race([
        bot.tool.equipForBlock(block, { requireHarvest: false }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("equip timeout")), EQUIP_TIMEOUT_MS)),
      ]);
    } catch {}
    primed = true;
  }

  function sendStartOnce(block) {
    const pkt = pickDigPacket();
    const face = faceForBlockAbove();
    try {
      if (pkt === "player_action") {
        bot._client.write("player_action", {
          action: PLAYER_ACTION.START_DESTROY_BLOCK,
          position: block.position,
          direction: face,
          sequence: 0, // biarkan 0 sesuai gaya kamu
        });
      } else if (pkt === "player_digging") {
        bot._client.write("player_digging", {
          status: DIG_STATUS.START,
          location: block.position,
          face,
        });
      } else {
        bot._client.write("block_dig", {
          status: DIG_STATUS.START,
          location: block.position,
          face,
        });
      }
      if (SWING_ON_START) swingArm();
      swingTick = 0;
      holding = true;
    } catch (e) {
      log("start dig pkt err:", e?.message || e);
      holding = false;
    }
  }

  function abortHold() {
    if (!currentTarget || !holding) {
      holding = false;
      currentTarget = null;
      return;
    }
    const pkt = pickDigPacket();
    const face = faceForBlockAbove();
    try {
      if (pkt === "player_action") {
        bot._client.write("player_action", {
          action: PLAYER_ACTION.ABORT_DESTROY_BLOCK,
          position: currentTarget.position,
          direction: face,
          sequence: 1,
        });
      } else if (pkt === "player_digging") {
        bot._client.write("player_digging", {
          status: DIG_STATUS.ABORT,
          location: currentTarget.position,
          face,
        });
      } else {
        bot._client.write("block_dig", {
          status: DIG_STATUS.ABORT,
          location: currentTarget.position,
          face,
        });
      }
    } catch {}
    holding = false;
    currentTarget = null;
    lastTargetPos = null;
  }

  // kalau blok target pecah, JANGAN kirim stop — reset biar lanjut
  bot.on("blockUpdate", (oldB, newB) => {
    if (!currentTarget || !newB?.position) return;
    if (newB.position.equals(currentTarget.position) && newB.name === "air") {
      holding = false;
      primed = false;
      currentTarget = null;
      lastTargetPos = null;
      swingTick = 0;
    }
  });

  // loop utama
  async function onPhysicsTick() {
    if (!isMining) return;

    // animasi berkala saat holding
    if (holding) {
      if (SWING_INTERVAL_TICKS > 0) {
        swingTick++;
        if (swingTick >= SWING_INTERVAL_TICKS) {
          swingTick = 0;
          swingArm();
        }
      }
      return; // lagi tahan → jangan ganggu
    }

    // Cari target vertikal di dy=2 & dy=5
    const t = getAllowedBlockAbove();
    if (!t) {
      currentTarget = null;
      primed = false;
      lastTargetPos = null;
      return;
    }

    // Target baru → prime sekali
    if (!lastTargetPos || !t.position.equals(lastTargetPos)) {
      currentTarget = t;
      lastTargetPos = t.position.clone();
      primed = false;
      try {
        await primeTarget(t);
      } catch {
        primed = true;
      }
      return; // kasih 1 tick; START di tick berikutnya
    }

    // Siap → kirim START SEKALI lalu “diam”
    if (primed && !holding) {
      sendStartOnce(currentTarget);
    }
  }

  function startLoop() {
    if (onPhys) return;
    onPhys = onPhysicsTick;
    bot.on("physicsTick", onPhys);
  }

  function stopLoop() {
    if (!onPhys) return;
    bot.removeListener("physicsTick", onPhys);
    onPhys = null;
  }

  // command handler
  bot._registerCommandHandler(async (cmd, args) => {
    if (cmd !== "mining") return false;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "start") {
      if (isMining) {
        log("Already mining.");
        return true;
      }
      isMining = true;
      startLoop();
      log("Started mining ⛏️ (hold + swing; target dy=2 & dy=5).");
      return true;
    }

    if (sub === "stop") {
      if (!isMining) {
        log("Not mining.");
        return true;
      }
      isMining = false;
      stopLoop();
      abortHold();
      log("Stopped mining.");
      return true;
    }

    log("Usage: mining start|stop");
    return true;
  });

  // cleanup
  return () => {
    isMining = false;
    stopLoop();
    abortHold();
  };
};
