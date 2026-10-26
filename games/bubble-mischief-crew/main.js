import { createGame, input, stepGame, useItem, ITEM_LABELS, STEP, LIMIT, COLS } from "./game.js";
import { render, drawPlayer } from "./render.js";
import { createTouchControls } from "./touch-controls.js";
import { PlayweftBridge } from "../../src/playweft-client.js";
const $ = (id) => document.getElementById(id),
  canvas = $("pitch"),
  ctx = canvas.getContext("2d");
// The HUD fits the landscape viewport; the canvas keeps its game coordinates.
let portraitBlocked = false;
function fitGameWindow() {
  const standalone = window.parent === window;
  document.body.classList.toggle("standalone", standalone);
  portraitBlocked = standalone && window.innerWidth < window.innerHeight;
  document.documentElement.style.setProperty("--viewport-width", `${window.innerWidth}px`);
  document.documentElement.style.setProperty("--viewport-height", `${window.innerHeight}px`);
}
window.addEventListener("resize", fitGameWindow);
fitGameWindow();

const bridge = new PlayweftBridge(),
  keys = new Map(),
  positions = new Map();
let previousPlayers = null;
let roomPoses = [];
let mode = "solo",
  s = createGame(),
  active = false,
  paused = false,
  last = 0,
  acc = 0,
  own = 0,
  room = false,
  inFlight = false,
  seq = 0,
  lastReceived = 0,
  roomLost = false;
let touchInput = { dir: -1 };
let pendingItems = [], itemSequence = 0;
const touchControls = createTouchControls({
  joystick: $("joystick"),
  onChange: (value) => {
    touchInput = value;
  },
  onTouch: () => document.body.classList.add("touch-input"),
  activationArea: document,
  getActivationBounds: () => {
    if (portraitBlocked) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    // The outer map column is decorative; stop the control before the lawn.
    const right = rect.left + rect.width / (COLS + 2) - 8;
    const padding = getComputedStyle($("game-window"));
    return {
      left: Math.max(16, parseFloat(padding.paddingLeft) || 0),
      right,
      top: Math.max(window.innerHeight * .55,
        document.querySelector(".side-actions").getBoundingClientRect().bottom + 12),
      bottom: window.innerHeight - Math.max(24, parseFloat(padding.paddingBottom) || 0) - 8,
      homeX: Math.min(176, Math.max(88, window.innerWidth * .14)),
      homeY: window.innerHeight - Math.min(144, Math.max(84, window.innerHeight * .24)),
    };
  },
});
window.addEventListener("resize", () => {
  keys.clear();
  touchControls.reset();
  previousPlayers = null;
  acc = 0;
});
window.addEventListener(
  "pointerdown",
  (event) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      document.body.classList.add("touch-input");
    }
  },
  { passive: true },
);

let serverOffset = 0,
  rematchRequested = false;
let audio = null,
  sound = false,
  lastBlast = 0,
  lastStatus = "",
  hud = "",
  wasEnded = false;
window.addEventListener("bubble-mischief-crew-art-ready", () => {
  hud = "";
});
function beep(freq = 280, duration = 0.09) {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    audio.resume();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.connect(g);
    g.connect(audio.destination);
    o.type = "sine";
    o.frequency.setValueAtTime(freq, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(
      freq * 0.45,
      audio.currentTime + duration,
    );
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    o.start();
    o.stop(audio.currentTime + duration);
  } catch {}
}
function toast(t) {
  $("toast").textContent = t;
  $("toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("visible"), 2200);
}
function overlay(title, description, button, note = "") {
  touchControls.reset();
  $("overlay-title").textContent = title;
  $("overlay-description").textContent = description;
  $("start").firstChild.textContent = button + " ";
  $("overlay-note").textContent = note;
  $("overlay").hidden = false;
  $("start").hidden = false;
}
function start() {
  if (portraitBlocked) return;
  if (room) {
    if (s.phase === "ended") {
      rematchRequested = true;
      toast("等待其他玩家准备");
    }
    return;
  }
  if (paused) {
    paused = false;
    $("pause").textContent = "Ⅱ 暂停";
    $("overlay").hidden = true;
    last = performance.now();
    return;
  }
  const scores = s.scores,
    round = active ? s.round + 1 : 1;
  s = createGame({
    seed: Math.floor(Math.random() * 2000000000) + 1,
    humans: mode === "local" ? 2 : 1,
  });
  s.scores = scores;
  s.round = round;
  active = true;
  wasEnded = false;
  lastBlast = 0;
  lastStatus = "";
  positions.clear();
  pendingItems = []; itemSequence = 0;
  previousPlayers = null;
  keys.clear();
  touchControls.reset();
  $("pause").textContent = "Ⅱ 暂停";
  acc = 0;
  last = performance.now();
  $("overlay").hidden = true;
  $("pause").disabled = false;
  beep(500);
}
$("start").addEventListener("click", start);
$("sound").addEventListener("click", () => {
  sound = !sound;
  $("sound").textContent = sound ? "♪ 音效开" : "♪ 音效关";
  $("sound").setAttribute("aria-label", sound ? "关闭音效" : "打开音效");
  beep(600);
});
function pause() {
  if (room || !active || s.phase === "ended") return;
  paused = !paused;
  keys.clear();
  if (paused) overlay("暂停", "", "继续游戏");
  else {
    $("overlay").hidden = true;
    last = performance.now();
  }
  $("pause").textContent = paused ? "▶ 继续" : "Ⅱ 暂停";
}
$("pause").addEventListener("click", pause);
for (const b of document.querySelectorAll("[data-mode]"))
  b.addEventListener("click", () => {
    if (room) return;
    mode = b.dataset.mode;
    active = false;
    paused = false;
    s = createGame({ humans: mode === "local" ? 2 : 1 });
    positions.clear();
    document
      .querySelectorAll("[data-mode]")
      .forEach((x) => x.classList.toggle("selected", x === b));
    $("p2-controls").hidden = mode !== "local";
    $("overlay").hidden = false;
    $("pause").disabled = true;
    $("pause").textContent = "Ⅱ 暂停";
    overlay("泡泡捣蛋团", "", "开始游戏");
  });
function controls(index) {
  if (portraitBlocked) return { dir: -1 };
  const map =
    mode === "local" && index === 1
      ? [
          ["ArrowRight", 0],
          ["ArrowDown", 1],
          ["ArrowLeft", 2],
          ["ArrowUp", 3],
        ]
      : [
          ["d", 0],
          ["s", 1],
          ["a", 2],
          ["w", 3],
          ...(mode === "local"
            ? []
            : [
                ["ArrowRight", 0],
                ["ArrowDown", 1],
                ["ArrowLeft", 2],
                ["ArrowUp", 3],
              ]),
        ];
  let dir = -1,
    newest = -1;
  for (const [k, d] of map)
    if (keys.has(k) && keys.get(k) > newest) {
      dir = d;
      newest = keys.get(k);
    }
  if (index === 0 && touchInput.dir >= 0) dir = touchInput.dir;
  return { dir };
}
function requestItem(slot, index = 0) {
  if (portraitBlocked || paused || !active || s.phase !== "playing") return;
  const p = s.players[room ? own : index], item = p?.inventory?.[slot - 1];
  if (!item?.count || (item.kind === "fork" ? p.status !== "bubble" : p.status !== "alive")) return;
  if (room) {
    if (pendingItems.length >= 7) return;
    pendingItems.push({ itemSlot: slot, itemSeq: ++itemSequence });
  } else useItem(s, index, slot);
}
function bindItemButton(button, activate) {
  button.addEventListener("pointerdown", event => {
    if (button.disabled || event.button !== 0) return;
    // Accept non-primary pointers: the primary finger may hold the joystick.
    // Do not wait for a synthetic click, which multi-touch can suppress.
    event.preventDefault();
    activate();
  });
  button.addEventListener("click", event => {
    // Pointer presses already executed on down. Retain keyboard/accessibility
    // activation without consuming twice on the browser's compatibility click.
    if (event.detail === 0 && !event.pointerType) activate();
  });
}
for (const button of document.querySelectorAll("[data-item-slot]"))
  bindItemButton(button, () => requestItem(Number(button.dataset.itemSlot)));
for (const button of document.querySelectorAll("[data-item-kind]"))
  bindItemButton(button, () => {
    const slot = s.players[room ? own : 0]?.inventory?.findIndex(i => i.kind === button.dataset.itemKind);
    if (slot >= 0) requestItem(slot + 1);
  });
window.addEventListener("keydown", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (/^[1-7]$/.test(k)) {
    e.preventDefault();
    if (!e.repeat) requestItem(Number(k), mode === "local" && e.code?.startsWith("Numpad") ? 1 : 0);
    return;
  }
  if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "a",
      "s",
      "d",
    ].includes(k)
  ) {
    e.preventDefault();
    keys.set(k, performance.now());
  }
  if (k === "Escape") pause();
});
window.addEventListener("keyup", (e) =>
  keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key),
);
function release() {
  keys.clear();
  pendingItems = [];
  touchControls.reset();
  if (room && active) send({ type: "input", dir: -1 });
}
window.addEventListener("blur", () => {
  release();
  if (!room && active && !paused && s.phase !== "ended") pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    release();
    if (!room && active && !paused && s.phase !== "ended") pause();
  }
});
async function send(action) {
  if (!room || inFlight || own < 0) return;
  inFlight = true;
  try {
    const result = await bridge.action({
      ...action,
      round: s.round,
      seq: ++seq,
    });
    if (
      result?.accepted === false &&
      !["STALE_ROUND"].includes(result.error?.code)
    )
      toast(result.error?.message || "操作未送达");
  } catch {
    toast("连接恢复中…");
  } finally {
    inFlight = false;
  }
}
bridge.addEventListener("initialize", ({ detail }) => {
  if (detail.mode !== "room") return;
  room = true;
  active = true;
  own = -1;
  $("modes").hidden = true;
  $("room-mode").hidden = false;
  $("pause").hidden = true;
  overlay("等待连接", "", "等待连接");
  $("start").hidden = true;
});
bridge.addEventListener("state", ({ detail }) => {
  if (!room) return;
  const next = detail.state;
  if (!next?.players) return;
  if (next.round !== s.round) {
    positions.clear();
    roomPoses = [];
    keys.clear();
    touchControls.reset();
    wasEnded = false;
    $("start").disabled = false;
    rematchRequested = false;
    pendingItems = []; itemSequence = 0;
  }
  s = {
    ...next,
    balls: Array.isArray(next.balls) ? next.balls : [],
    drops: Array.isArray(next.drops) ? next.drops : [],
    blasts: Array.isArray(next.blasts) ? next.blasts : [],
    items: Array.isArray(next.items) ? next.items : [],
    traps: Array.isArray(next.traps) ? next.traps : [],
    itemDrops: Array.isArray(next.itemDrops) ? next.itemDrops : [],
    players: next.players.map(p => ({ ...p, inventory: Array.isArray(p.inventory) ? p.inventory : [] })),
  };
  own = s.players.findIndex((p) => p.id === bridge.context?.playerId);
  const acceptedItem = s.players[own]?.itemSeq || 0;
  itemSequence = Math.max(itemSequence, acceptedItem);
  pendingItems = s.phase === "playing" ? pendingItems.filter(i => i.itemSeq > acceptedItem) : [];
  if (s.players[own]?.rematch) {
    rematchRequested = false;
    $("start").disabled = true;
  }
  $("roster-count").textContent =
    `${s.players.filter((p) => p.team === 0).length} VS ${s.players.filter((p) => p.team === 1).length}`;
  const poseAt = s.lastStepAt ?? detail.serverTime;
  if (!roomPoses.length || poseAt > roomPoses.at(-1).at) {
    roomPoses.push({
      at: poseAt,
      players: s.players.map((p) => ({ x: p.x, y: p.y })),
    });
    if (roomPoses.length > 24) roomPoses.shift();
  }
  lastReceived = performance.now();
  serverOffset = detail.serverTime - Date.now();
  roomLost = false;
  if (["playing", "countdown"].includes(s.phase)) {
    $("overlay").hidden = true;
    wasEnded = false;
  } else if (["waiting", "paused"].includes(s.phase)) {
    overlay(s.phase === "paused" ? "等待球员重连" : "等待开场", "", "等待连接");
    $("start").hidden = true;
  } else if (s.phase === "closed") {
    overlay(
      "本场比赛已结束",
      "有球员离开了球场，请返回房间开始新比赛。",
      "返回房间",
    );
    $("start").hidden = true;
  }
});
bridge.addEventListener("error", () => {
  if (room) toast("网络连接中断，正在等待恢复…");
});
setInterval(() => {
  if (!room || own < 0 || document.hidden || s.phase === "closed") return;
  if (s.phase === "ended" && rematchRequested) {
    send({ type: "rematch" });
    return;
  }
  const c = controls(0);
  send({ type: "input", ...c, ...pendingItems[0] });
}, 100);
function updateHUD() {
  const avatar = $("own-avatar").getContext("2d");
  if (avatar.clearRect) {
    avatar.clearRect(0, 0, 74, 74);
    avatar.save();
    avatar.scale(1.15, 1.15);
    drawPlayer(avatar, 32, 63, Math.max(0, own), { shadow: false, height: 62, anchor: "bottom" });
    avatar.restore();
  }
  const player = s.players[own];
  const usable = item => active && !paused && !portraitBlocked && s.phase === "playing" &&
    item?.count > 0 && (item.kind === "fork" ? player?.status === "bubble" : player?.status === "alive");
  for (const button of document.querySelectorAll("[data-item-slot]")) {
    const item = player?.inventory?.[Number(button.dataset.itemSlot) - 1], label = ITEM_LABELS[item?.kind];
    button.querySelector(".item-icon").textContent = label?.icon || "";
    button.querySelector(".item-count").textContent = item?.count ? `×${item.count}` : "";
    button.disabled = !usable(item);
    button.classList.toggle("is-ready", !!item?.count);
    button.setAttribute("aria-label", label ? `${button.dataset.itemSlot} ${label.name} ${item.count}个` : `道具格 ${button.dataset.itemSlot} 空`);
  }
  for (const button of document.querySelectorAll("[data-item-kind]")) {
    const item = player?.inventory?.find(i => i.kind === button.dataset.itemKind);
    button.querySelector("b").textContent = String(item?.count || 0);
    button.disabled = !usable(item);
  }
  const left = Math.max(0, LIMIT - s.tick);
  $("timer").textContent =
    `${String(Math.floor(left / 600)).padStart(2, "0")}:${String(Math.floor(left / 10) % 60).padStart(2, "0")}`;
  $("score-mint").textContent = s.scores[0];
  $("score-peach").textContent = s.scores[1];
  $("round-label").textContent =
    `第${String(s.round).padStart(2, "0")}局`;
  const key =
    s.players
      .map((p) => `${p.id}:${p.name}:${p.status}:${p.shield}:${p.shoes}:${p.slideDir}:${Math.max(0, Math.ceil(((p.slowUntil || 0) - s.tick) / 10))}:${JSON.stringify(p.inventory)}`)
      .join("|") +
    own +
    mode;
  if (key !== hud) {
    hud = key;
    $("roster").replaceChildren(
      ...s.players.map((p, i) => {
        const el = document.createElement("div");
        el.className = `player ${p.status} ${p.team === 0 ? "mint" : "peach"}`;
        const avatar = document.createElement("div");
        avatar.className = "avatar";
        const cv = document.createElement("canvas");
        cv.width = 74;
        cv.height = 74;
        cv.style.width = "37px";
        cv.style.height = "37px";
        const ac = cv.getContext("2d");
        ac.scale(0.8, 0.8);
        drawPlayer(ac, 46, 82, i, { shadow: false, height: 62, anchor: "bottom" });
        avatar.append(cv);
        const info = document.createElement("div");
        info.className = "player-info";
        const name = document.createElement("strong");
        name.textContent = p.name;
        if (i === own) {
          const tag = document.createElement("span");
          tag.className = "you-tag";
          tag.textContent = "你";
          name.append(tag);
        }
        const small = document.createElement("small");
        small.textContent = `${p.team === 0 ? "薄荷队" : "蜜桃队"} · ${p.bot ? "电脑" : i === own ? "玩家一" : mode === "local" && i === 1 ? "玩家二" : "球员"}`;
        const itemInfo = document.createElement("small");
        itemInfo.className = "player-items";
        itemInfo.textContent = `👟${p.shoes || 0}/3` +
          (mode === "local" && i === 1 ? " · " + (p.inventory || []).map((item, n) => `${n + 1}${ITEM_LABELS[item.kind]?.icon || ""}×${item.count}`).join(" ") : "");
        small.title = mode === "local" && i === 1 ? "方向键移动，小键盘 1–7 使用道具" : "";
        info.append(name, small);
        info.append(itemInfo);
        const status = document.createElement("span");
        status.className = `player-state ${p.status}`;
        status.textContent =
          p.status === "bubble"
            ? "求救中"
            : p.status === "out"
              ? "已出局"
              : (p.slideDir ?? -1) >= 0
                ? "滑行中"
                : (p.slowUntil || 0) > s.tick
                  ? `减速 ${Math.ceil((p.slowUntil - s.tick) / 10)}s`
              : p.shield
                ? "◇ 护盾"
                : "● 就位";
        el.append(avatar, info, status);
        return el;
      }),
    );
  }
  $("match-status").textContent = !active
    ? "等待开始"
    : paused
      ? "比赛暂停"
      : s.phase === "playing"
        ? "比赛中"
        : s.phase === "countdown"
          ? "准备开球"
          : s.phase === "ended"
            ? "本局结束"
            : s.phase === "closed"
              ? "球员已离开"
              : "等待球员";
  const status = s.players[own]?.status;
  if (status && status !== lastStatus) {
    if (status === "bubble") {
      toast("被困住了");
      beep(200, 0.2);
    } else if (status === "out") toast("已出局");
    else if (lastStatus === "bubble") {
      toast("获救");
      beep(700);
    }
    lastStatus = status;
  }
  const blast = s.blasts.at(-1)?.id || 0;
  if (blast && blast !== lastBlast) {
    beep(120, 0.18);
    lastBlast = blast;
  }
  if (s.phase === "ended" && !wasEnded) {
    wasEnded = true;
    keys.clear();
    const team = s.players[own]?.team;
    overlay(
      s.winner < 0 ? "平局" : s.winner === team ? "胜利" : "失败",
      s.winner < 0
        ? ""
        : `${s.winner === 0 ? "薄荷队" : "蜜桃队"}赢下了这一局。`,
      room ? "准备再来一局" : "再来一局",
      "",
    );
    $("pause").disabled = true;
    beep(s.winner === team ? 700 : 220, 0.25);
  }
}
let hudAt = 0;
function frame(now) {
  const dt = Math.min(200, now - (last || now));
  last = now;
  if (!room && active && !paused && !portraitBlocked) {
    acc += dt;
    while (acc >= STEP) {
      const c = controls(0);
      input(s, 0, c.dir);
      if (mode === "local") {
        const c2 = controls(1);
        input(s, 1, c2.dir);
      }
      previousPlayers = s.players.map((p) => ({ x: p.x, y: p.y }));
      stepGame(s, STEP);
      acc -= STEP;
    }
  }
  if (
    room &&
    lastReceived &&
    now - lastReceived > 2200 &&
    !roomLost &&
    ["playing", "countdown"].includes(s.phase)
  ) {
    roomLost = true;
    overlay("等待连接恢复", "比赛画面已暂停，恢复连接后继续。", "连接恢复中");
    $("start").hidden = true;
  }
  const display =
    room && s.resumeAt
      ? {
          ...s,
          phase: "countdown",
          tick: Math.max(
            0,
            30 - Math.ceil((s.resumeAt - (Date.now() + serverOffset)) / 100),
          ),
        }
      : s;
  positions.clear();
  if (room && s.phase === "playing" && roomPoses.length > 1) {
    const at = Date.now() + serverOffset - 100;
    let a = roomPoses[0],
      b = roomPoses.at(-1);
    for (let i = 1; i < roomPoses.length; i++) {
      if (roomPoses[i].at >= at) {
        a = roomPoses[i - 1];
        b = roomPoses[i];
        break;
      }
      a = roomPoses[i];
    }
    const alpha =
      b.at > a.at ? Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at))) : 1;
    s.players.forEach((p, i) => {
      const from = a.players[i] || p,
        to = b.players[i] || p;
      positions.set(i, {
        x: from.x + (to.x - from.x) * alpha,
        y: from.y + (to.y - from.y) * alpha,
      });
    });
  } else if (
    !room &&
    previousPlayers &&
    !paused &&
    !portraitBlocked &&
    s.phase === "playing"
  ) {
    const alpha = acc / STEP;
    s.players.forEach((p, i) => {
      const from = previousPlayers[i] || p;
      positions.set(i, {
        x: from.x + (p.x - from.x) * alpha,
        y: from.y + (p.y - from.y) * alpha,
      });
    });
  }
  render(ctx, display, now, {
    own, positions,
    motionFrame: s.tick * 5 + (s.substep || 0) +
      (s.phase !== "playing" || paused || portraitBlocked || roomLost ? 0 :
        room ? Math.max(0, Math.min(5,
          (Date.now() + serverOffset - s.lastStepAt) / STEP)) : acc / STEP),
  });
  if (now - hudAt > 90) {
    updateHUD();
    hudAt = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
