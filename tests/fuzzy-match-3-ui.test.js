import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { transformWithOxc } from "vite";
import {
  TYPE_COUNT,
  adjacent,
  canSwap,
  createGame as createRotatingGame,
  findMatches,
  findMove,
  levelConfig,
  pendingColorClear,
  refill,
  resolveWave,
  totalScore,
  seededRandom,
  swap,
} from "../games/fuzzy-match-3/game.js";
// These established rule/collection fixtures retain their original objective.
const createGame = (level = 1, daily = false, random = Math.random) =>
  createRotatingGame(level, daily, random, { goalKind: "collect" });
import { TILE_THEME } from "../games/fuzzy-match-3/theme.js";
import { simulateTurn } from "../scripts/fuzzy-match-3-ai.mjs";

async function compile(name, overrides = {}) {
  const url = new URL(`../games/fuzzy-match-3/${name}`, import.meta.url);
  const transformed = await transformWithOxc(
    await readFile(url, "utf8"),
    url.pathname,
    {
      jsx: { runtime: "automatic", importSource: "preact" },
    },
  );
  const code = transformed.code.replace(
    /(from\s+)(['"])([^'"]+)\2/g,
    (_, prefix, quote, specifier) =>
      prefix +
      quote +
      (overrides[specifier] ??
        (specifier.startsWith(".")
          ? new URL(specifier, url).href
          : import.meta.resolve(specifier))) +
      quote,
  );
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const art = await compile("art.jsx");
const { FuzzyMatch3App } = await import(
  await compile("app.jsx", { "./art.jsx": art })
);
const window = new Window({ url: "http://localhost/fuzzy-match-3/" });
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
window.matchMedia = () => ({ matches: true });
const key = "playweft:fuzzy-match-3:v1";
const legacyKey = "playweft:fruit-isle:v1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 1));
let root;
afterEach(() => {
  if (root) {
    act(() => render(null, root));
    root.remove();
    root = null;
  }
  localStorage.clear();
});
after(() => window.happyDOM.close());
async function mount(profile) {
  if (profile) localStorage.setItem(key, JSON.stringify(profile));
  root = document.createElement("div");
  document.body.append(root);
  const storage = {
    getItem: async (name) => globalThis.localStorage.getItem(name),
    setItem: async (name, value) => globalThis.localStorage.setItem(name, value),
    removeItem: async (name) => globalThis.localStorage.removeItem(name),
  };
  act(() => render(h(FuzzyMatch3App, { storage }), root));
  await act(flush);
  await act(flush);
}
async function click(node) {
  assert.ok(node, "element exists");
  act(() => node.click());
  await act(flush);
}
async function showLevelList() {
  await click(root.querySelector('[aria-label="暂停游戏"]'));
  await click(button("返回选关"));
}
const button = (label) =>
  [...root.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === label,
  );
const piece = (index) => root.querySelector(`[data-index="${index}"]`);
const saved = () => JSON.parse(localStorage.getItem(key));
function assertDisplayedScore(score, config) {
  const track = root.querySelector(".score-track");
  const max = config.starTargets[2];
  const nextTarget = config.starTargets.find(target => score < target) ?? max;
  assert.equal(root.querySelector(".score-label small").textContent,
    ` / ${nextTarget.toLocaleString("zh-CN")}`);
  assert.equal(root.querySelector(".score-label strong").firstChild.textContent,
    score.toLocaleString("zh-CN"));
  assert.equal(track.getAttribute("aria-valuenow"), String(Math.min(score, max)));
  assert.equal(track.getAttribute("aria-valuetext"),
    `${score.toLocaleString("zh-CN")} 分，三星目标 ${max.toLocaleString("zh-CN")} 分`);
  assert.equal(Number.parseFloat(track.firstElementChild.style.width),
    Math.min(100, score / max * 100));
  assert.equal(root.querySelectorAll(".score-star.filled").length,
    config.starTargets.filter(target => score >= target).length);
}

async function settled() {
  for (
    let i = 0;
    i < 250 &&
    root.querySelector(".board").getAttribute("aria-busy") === "true";
    i++
  )
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  assert.equal(root.querySelector(".board").getAttribute("aria-busy"), "false");
  await act(flush);
}

test("legacy saves move to the new key with progress, settings, records and best stars preserved", async () => {
  const adventure = createGame(43, false, seededRandom(42));
  adventure.moves = 11;
  adventure.score = 1200;
  const daily = createGame(1, true, seededRandom(17));
  daily.moves = 13;
  const date = new Date();
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const profile = {
    adventure, daily, date: dateKey, lastDailyWin: dateKey,
    sound: true, levelStars: { 1: 3, 2: 2, 42: 1 },
    stats: { wins: 42, best: 34000, fruit: 1234, dailyWins: 4 },
  };
  localStorage.setItem(legacyKey, JSON.stringify(profile));
  await mount();
  assert.deepEqual(saved(), {
    ...profile,
    stats: { wins: 42, best: 34000, eliminated: 1234, dailyWins: 4 },
  });
  assert.equal(localStorage.getItem(legacyKey), null);
  assert.match(root.querySelector("h1").textContent, /43/);
  assert.deepEqual(boardTypes(), adventure.board.map((tile) => tile.type));
});

test("existing saves migrate the legacy elimination field and keep the new field authoritative", async () => {
  const adventure = createGame(4, false, seededRandom(42));
  await mount({ adventure, stats: { fruit: 57 } });
  assert.equal(saved().stats.eliminated, 57);
  assert.equal(Object.hasOwn(saved().stats, "fruit"), false);
  act(() => render(null, root));
  root.remove();
  root = null;
  await mount({ adventure, stats: { eliminated: 0, fruit: 57 } });
  assert.equal(saved().stats.eliminated, 0);
  assert.equal(Object.hasOwn(saved().stats, "fruit"), false);
  assert.deepEqual(saved().adventure, adventure);
});

test("migration writes only the current format and reopening reads only that save", async () => {
  const adventure = createGame(6, false, seededRandom(42));
  const oldId = adventure.board[0].id;
  adventure.board[0] = { ...adventure.board[0], special: "burst" };
  delete adventure.iceGoal;
  localStorage.setItem(legacyKey, JSON.stringify({
    adventure,
    levelStars: { 1: 3, 4: 2 },
    stats: { fruit: 57 },
  }));
  await mount();
  const migrated = saved();
  assert.equal(localStorage.getItem(legacyKey), null);
  assert.equal(migrated.stats.eliminated, 57);
  assert.equal(Object.hasOwn(migrated.stats, "fruit"), false);
  assert.deepEqual(migrated.adventure.board[0], {
    id: oldId, type: null, special: "color",
  });
  assert.ok(Number.isInteger(migrated.adventure.iceGoal));
  assert.deepEqual(migrated.levelStars, { 1: 3, 4: 2 });
  act(() => render(null, root));
  root.remove();
  root = null;
  const storage = globalThis.localStorage;
  const reads = [];
  globalThis.localStorage = {
    getItem: name => { reads.push(name); return storage.getItem(name); },
    setItem: (name, value) => storage.setItem(name, value),
    removeItem: name => storage.removeItem(name),
  };
  try {
    await mount();
    assert.deepEqual(reads, [key]);
    assert.deepEqual(JSON.parse(storage.getItem(key)), migrated);
  } finally {
    globalThis.localStorage = storage;
  }
});

test("an existing new save takes precedence over the legacy save", async () => {
  localStorage.setItem(legacyKey, JSON.stringify({
    adventure: createGame(1, false, seededRandom(42)), sound: true,
  }));
  const adventure = createGame(4, false, seededRandom(7));
  await mount({ adventure, levelStars: { 1: 2 } });
  assert.deepEqual(saved().adventure, adventure);
  assert.deepEqual(saved().levelStars, { 1: 2 });
  assert.equal(saved().sound, false);
  assert.equal(localStorage.getItem(legacyKey), null);
});

test("a malformed new save falls back to and migrates the legacy save", async () => {
  const adventure = createGame(4, false, seededRandom(42));
  localStorage.setItem(key, "{broken");
  localStorage.setItem(legacyKey, JSON.stringify({ adventure }));
  await mount();
  assert.deepEqual(saved().adventure, adventure);
  assert.equal(localStorage.getItem(legacyKey), null);
});

test("a failed migration write keeps the legacy save and retries on the next progress update", async () => {
  const storage = globalThis.localStorage;
  const adventure = createGame(4, false, seededRandom(42));
  const legacy = JSON.stringify({ adventure, levelStars: { 1: 3 } });
  storage.setItem(legacyKey, legacy);
  globalThis.localStorage = {
    getItem: (name) => storage.getItem(name),
    setItem: () => { throw new Error("Storage is full"); },
    removeItem: (name) => storage.removeItem(name),
  };
  try {
    await mount();
    assert.equal(storage.getItem(legacyKey), legacy);
    assert.equal(storage.getItem(key), null);
    assert.deepEqual(boardTypes(), adventure.board.map((tile) => tile.type));
  } finally {
    globalThis.localStorage = storage;
  }
  await click(root.querySelector(".tools button"));
  assert.equal(saved().adventure.level, 4);
  assert.equal(saved().adventure.hints, adventure.hints - 1);
  assert.deepEqual(saved().levelStars, { 1: 3 });
  assert.equal(storage.getItem(legacyKey), null);
});

test("failure to remove the legacy key does not invalidate a successfully saved new profile", async () => {
  const storage = globalThis.localStorage;
  const adventure = createGame(4, false, seededRandom(42));
  storage.setItem(legacyKey, JSON.stringify({ adventure }));
  globalThis.localStorage = {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => storage.setItem(name, value),
    removeItem: () => { throw new Error("Cleanup is blocked"); },
  };
  try {
    await mount();
    assert.deepEqual(saved().adventure, adventure);
    await showLevelList();
    await click(root.querySelector(".sidebar-setting"));
    assert.match(root.querySelector(".setting-status").textContent, /已开启/);
    assert.notEqual(storage.getItem(legacyKey), null);
  } finally {
    globalThis.localStorage = storage;
  }
});

test("animal tiles and collection goals use the new branding while preserving saved numeric tile types", async () => {
  const adventure = createGame(1, false, seededRandom(42));
  const animals = ["dog", "tiger", "bird", "bear", "bull", "dragon"];
  const names = ["柴犬", "虎", "鸟", "熊", "牛", "龙"];
  assert.equal(TILE_THEME.length, TYPE_COUNT);
  assert.deepEqual(TILE_THEME.map(tile => tile.id), animals);
  assert.deepEqual(TILE_THEME.map(tile => tile.name), names);
  await mount({ adventure });
  assert.equal(root.querySelector(".topbar-title").textContent.trim(), "绒绒消消乐");
  assert.deepEqual(boardTypes(), adventure.board.map(tile => tile.type));
  assert.deepEqual(new Set(adventure.board.map(tile => tile.type)), new Set([0, 1, 2, 3, 4, 5]));
  adventure.board.forEach((tile, index) => {
    assert.equal(piece(index).querySelector("svg[data-animal]").dataset.animal, animals[tile.type]);
    assert.ok(piece(index).getAttribute("aria-label").includes(names[tile.type]));
  });
  assert.match(root.querySelector('.mini-goal[aria-label^="收集"]').getAttribute("aria-label"), /^收集柴犬：/);
  assert.equal(root.querySelector(".level-header .level-icon"), null);
  assert.ok(root.querySelector(".level-header .level-goals .mini-goal"));
  assert.equal(root.querySelector(".scoreboard .mini-goal"), null);
  assert.deepEqual(saved().adventure, adventure);
});

test("invalid exchanges restore exactly the original board without spending a move", async () => {
  await mount();
  const tools = root.querySelector(".tools");
  assert.equal(root.querySelector(".board-wrap").nextElementSibling, tools);
  const original = saved().adventure;
  let invalid;
  for (let a = 0; a < 64 && !invalid; a++)
    for (const b of [a + 1, a + 8])
      if (adjacent(a, b) && !findMatches(swap(original.board, a, b)).length) {
        invalid = [a, b];
        break;
      }
  assert.ok(invalid);
  await click(piece(invalid[0]));
  await click(piece(invalid[1]));
  await settled();
  assert.deepEqual(saved().adventure, original);
  assert.deepEqual(
    boardTypes(),
    original.board.map((f) => f.type),
  );
  assert.doesNotMatch(root.textContent, /无效交换|不扣步数/);
  assert.equal(root.querySelector(".board-wrap").nextElementSibling, tools);
  assert.equal(root.querySelector('[role="status"]'), null);
});

test("pause opens a paged level selector with best stars, locked levels and a way back to the same game", async () => {
  const adventure = createGame(43, false, seededRandom(42));
  await mount({ adventure, levelStars: { 1: 3, 2: 2, 3: 1, 42: 2 } });
  assert.match(root.querySelector("h1").textContent, /43/);
  assert.equal(root.querySelector(".level-selection"), null);
  await click(root.querySelector('[aria-label="暂停游戏"]'));
  await click(button("返回选关"));
  assert.equal(root.querySelector("h1").textContent, "关卡选择");
  assert.equal(root.querySelector('[role="dialog"]'), null);
  assert.equal(root.querySelectorAll(".level-tile").length, 40);
  assert.ok(root.querySelector('[data-level="43"]').hasAttribute("aria-current"));
  assert.equal(root.querySelector('[data-level="44"]').disabled, true);
  await click(root.querySelector('[aria-label="上一页关卡"]'));
  for (const [level, stars] of [[1, 3], [2, 2], [3, 1]]) {
    const tile = root.querySelector(`[data-level="${level}"]`);
    assert.equal(tile.querySelectorAll(".earned").length, stars);
    assert.match(tile.getAttribute("aria-label"), new RegExp(`最高 ${stars} 星`));
  }
  assert.equal(root.querySelector('[aria-label="上一页关卡"]').disabled, true);
  await click(root.querySelector('[aria-label="返回游戏"]'));
  assert.deepEqual(saved().adventure, adventure);
  assert.deepEqual(boardTypes(), adventure.board.map((tile) => tile.type));
});

test("replaying an earlier level leaves the latest game intact and reload opens the latest level", async () => {
  const adventure = createGame(4, false, seededRandom(42));
  adventure.moves = 13;
  adventure.score = 1200;
  await mount({ adventure, levelStars: { 1: 3, 2: 2 } });
  await click(root.querySelector('[aria-label="暂停游戏"]'));
  await click(button("返回选关"));
  await click(root.querySelector('[data-level="2"]'));
  assert.match(root.querySelector("h1").textContent, /02/);
  await click(root.querySelector(".tools button"));
  assert.equal(saved().replay.level, 2);
  assert.equal(saved().replay.hints, 2);
  assert.deepEqual(saved().adventure, adventure);
  const snapshot = saved();
  act(() => render(null, root));
  root.remove();
  root = null;
  await mount(snapshot);
  assert.match(root.querySelector("h1").textContent, /04/);
  assert.equal(root.querySelector(".level-selection"), null);
  assert.deepEqual(saved().adventure, adventure);
  assert.deepEqual(saved().levelStars, { 1: 3, 2: 2 });
});

test("selecting the latest failed level starts a fresh attempt instead of reopening the loss dialog", async () => {
  const adventure = createGame(4, false, seededRandom(42));
  adventure.moves = 0;
  adventure.status = "lost";
  await mount({ adventure, levelStars: { 1: 3 } });
  await click(button("返回选关"));
  await click(root.querySelector('[data-level="4"]'));
  assert.equal(root.querySelector('[role="dialog"]'), null);
  assert.equal(saved().adventure.status, "playing");
  assert.equal(saved().adventure.moves, levelConfig(4).moves);
  assert.equal(saved().adventure.score, 0);
  assert.deepEqual(saved().levelStars, { 1: 3 });
});

test("winning records earned stars and unlocks the next level in the selector", async () => {
  const adventure = createGame(1, false, seededRandom(42));
  adventure.moves = 1;
  adventure.score = 10000;
  adventure.collected = Array(6).fill(100);
  await mount({ adventure });
  const [a, b] = findMove(adventure.board);
  await click(piece(a));
  await click(piece(b));
  await settled();
  assert.equal(saved().levelStars[1], 3);
  await click(button("返回选关"));
  assert.equal(root.querySelector('[data-level="1"]').querySelectorAll(".earned").length, 3);
  assert.equal(root.querySelector('[data-level="2"]').disabled, false);
  assert.equal(root.querySelector('[data-level="3"]').disabled, true);
  await click(root.querySelector('[data-level="2"]'));
  assert.equal(saved().adventure.level, 2);
  assert.equal(saved().adventure.status, "playing");
  assert.equal(saved().levelStars[1], 3);
});

test("a lower-star completion keeps the previous best and legacy completed saves recover their stars", async () => {
  const adventure = createGame(1, false, seededRandom(42));
  adventure.moves = 1;
  adventure.score = 2200;
  adventure.collected = Array(6).fill(100);
  const previousRandom = Math.random;
  Math.random = seededRandom(7);
  try {
    await mount({ adventure, levelStars: { 1: 3, 0: 3, 2: 4, 3: "3" } });
    const [a, b] = findMove(adventure.board);
    await click(piece(a));
    await click(piece(b));
    await settled();
    assert.ok(root.querySelectorAll(".result-stars .earned").length < 3);
    assert.deepEqual(saved().levelStars, { 1: 3 });
  } finally {
    Math.random = previousRandom;
  }
  const completed = saved().adventure;
  act(() => render(null, root));
  root.remove();
  root = null;
  await mount({ adventure: completed });
  const earned = levelConfig(1).starTargets.filter((target) => totalScore(completed) >= target).length;
  assert.equal(saved().levelStars[1], earned);
  await click(button("返回选关"));
  assert.equal(root.querySelector('[data-level="2"]').disabled, false);
});

test("valid exchange settles, saves, and spends one move; mode switching preserves the board", async () => {
  await mount();
  const original = saved().adventure,
    [a, b] = findMove(original.board);
  await click(piece(a));
  await click(piece(b));
  await settled();
  const next = saved().adventure;
  assert.equal(next.moves, original.moves - 1);
  assert.ok(next.score >= 180);
  assert.equal(findMatches(next.board).length, 0);
  await showLevelList();
  await click(button("每日挑战"));
  assert.match(root.querySelector("h1").textContent, /每日挑战/);
  await showLevelList();
  await click(button("闯关"));
  assert.deepEqual(saved().adventure, next);
  assert.deepEqual(
    boardTypes(),
    next.board.map((f) => f.type),
  );
});

test("collection challenge progress displays its higher target and survives reload", async () => {
  const adventure = createGame(10, false, seededRandom(42));
  const config = levelConfig(10);
  assert.equal(config.count, 36);
  adventure.score = config.target;
  adventure.collected[config.targetType] = 24;
  await mount({ adventure });
  const label = root.querySelector('.mini-goal[aria-label^="收集"]');
  assert.match(label.getAttribute("aria-label"), new RegExp(`24 / ${config.count}$`));
  assert.equal(label.querySelector(".goal-remaining").textContent, "12");
  assert.equal(label.querySelector("small"), null);
  assert.equal(root.querySelector('.game-details [data-goal="collect"] .goal-remaining').textContent, "12");
  assert.equal(label.classList.contains("done"), false);
  assert.equal(saved().adventure.status, "playing");
  const snapshot = saved();
  act(() => render(null, root));
  root.remove();
  root = null;
  await mount(snapshot);
  assert.match(root.querySelector('.mini-goal[aria-label^="收集"]').getAttribute("aria-label"), new RegExp(`24 / ${config.count}$`));
  assert.deepEqual(saved().adventure, snapshot.adventure);
});

test("the toolbar only offers hints and shuffle, and restarting requires the pause menu and confirmation", async () => {
  await mount();
  const hintButton = [...root.querySelectorAll(".tools button")][0];
  assert.equal(hintButton.getAttribute("aria-label"), "提示，剩余 3 次");
  assert.equal(hintButton.querySelector(".tool-badge").textContent, "3");
  await click(hintButton);
  assert.equal(root.querySelectorAll(".hinted").length, 2);
  await click(hintButton);
  await click(hintButton);
  assert.equal(saved().adventure.hints, 0);
  assert.equal(hintButton.disabled, true);
  assert.equal(root.querySelectorAll(".tools button").length, 2);
  assert.equal(root.querySelectorAll(".tools .tool-divider").length, 0);
  assert.equal(hintButton.getAttribute("aria-label"), "提示，剩余 0 次");
  assert.equal(hintButton.querySelector(".tool-badge").textContent, "0");
  assert.equal(button("重新开始"), undefined);
  await click(root.querySelector('[aria-label="暂停游戏"]'));
  await click(button("重新开始"));
  assert.equal(
    root.querySelector('[role="dialog"]').getAttribute("aria-labelledby"),
    "dialog-title",
  );
  await click(button("取消"));
  assert.equal(saved().adventure.hints, 0);
  await click(root.querySelector('[aria-label="暂停游戏"]'));
  await click(button("重新开始"));
  await click(root.querySelector(".modal .primary-button"));
  assert.equal(saved().adventure.hints, 3);
  assert.equal(saved().adventure.moves, 28);
});

test("a winning final move opens completion and the next level resets goals and tools", async () => {
  const adventure = createGame();
  adventure.moves = 1;
  adventure.score = 10000;
  adventure.collected = Array(6).fill(100);
  await mount({ adventure });
  const [a, b] = findMove(adventure.board);
  await click(piece(a));
  await click(piece(b));
  await settled();
  assert.equal(saved().adventure.status, "won");
  assert.equal(saved().stats.wins, 1);
  assert.match(root.querySelector("#dialog-title").textContent, /通关/);
  await click(button("下一关"));
  assert.equal(saved().adventure.level, 2);
  assert.equal(saved().adventure.status, "playing");
  assert.equal(saved().adventure.score, 0);
  assert.equal(saved().adventure.hints, 3);
  assert.equal(root.querySelector('[role="dialog"]'), null);
});

test("a failed final move can retry; unmount cancels an in-flight wave without saving holes", async () => {
  const adventure = createGame();
  adventure.moves = 1;
  await mount({ adventure });
  const [a, b] = findMove(adventure.board);
  await click(piece(a));
  await click(piece(b));
  await settled();
  assert.equal(saved().adventure.status, "lost");
  await click(button("重试"));
  assert.equal(saved().adventure.status, "playing");
  const before = saved().adventure;
  const [c, d] = findMove(before.board);
  await click(piece(c));
  await click(piece(d));
  act(() => render(null, root));
  await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
  assert.deepEqual(saved().adventure, before);
  assert.equal(saved().adventure.board.filter(Boolean).length, 64);
});

window.HTMLElement.prototype.getBoundingClientRect = function () {
  const index = Number(this.dataset.index || 0);
  return {
    left: (index % 8) * 40,
    top: Math.floor(index / 8) * 40,
    width: 40,
    height: 40,
  };
};
const boardTypes = () =>
  [...root.querySelectorAll(".cell")].map((node) =>
    node.dataset.special === "color" || node.dataset.empty
      ? null
      : Number(node.dataset.type),
  );
async function until(predicate, attempts = 150) {
  for (let i = 0; i < attempts && !predicate(); i++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)));
  assert.ok(predicate());
}
async function pointer(
  node,
  type,
  { pointerId = 1, pointerType = "touch", x, y } = {},
) {
  act(() =>
    node.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType,
        isPrimary: pointerId === 1,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    ),
  );
  await act(flush);
}

test("invalid exchanges animate forward and back before unlocking without changing tile identities", async () => {
  await mount();
  const original = saved().adventure;
  let pair;
  for (let a = 0; a < 64 && !pair; a++)
    for (const b of [a + 1, a + 8])
      if (adjacent(a, b) && !findMatches(swap(original.board, a, b)).length) {
        pair = [a, b];
        break;
      }
  const [a, b] = pair;
  await click(piece(a));
  await click(piece(b));
  assert.equal(piece(a).dataset.swapPhase, "forward");
  assert.equal(piece(b).dataset.swapPhase, "forward");
  assert.notEqual(piece(a).style.transform, "translate(0px, 0px)");
  assert.equal(Number(piece(a).dataset.tileId), original.board[a].id);
  assert.deepEqual(saved().adventure, original);
  await until(() => piece(a).dataset.swapPhase === "return");
  assert.equal(piece(a).style.transform, "translate(0px, 0px)");
  assert.equal(root.querySelector(".board").getAttribute("aria-busy"), "true");
  await settled();
  assert.equal(root.querySelectorAll(".exchanging").length, 0);
  assert.deepEqual(saved().adventure, original);
});

for (const pointerType of ["mouse", "touch"])
  test(`${pointerType} sliding exchanges on pointermove, before release, and ignores the synthetic click`, async () => {
    await mount();
    const original = saved().adventure,
      [a, b] = findMove(original.board);
    const node = piece(a),
      x = (a % 8) * 40 + 20,
      y = Math.floor(a / 8) * 40 + 20;
    await pointer(node, "pointerdown", { pointerType, x, y });
    for (let distance = 2; distance <= 14; distance += 2) {
      await pointer(node, "pointermove", {
        pointerType,
        x: x + ((b % 8) - (a % 8)) * distance,
        y: y + (Math.floor(b / 8) - Math.floor(a / 8)) * distance,
      });
    }
    assert.equal(
      root.querySelector(".board").getAttribute("aria-busy"),
      "true",
    );
    assert.equal(piece(a).dataset.swapPhase, "forward");
    await pointer(node, "pointerup", { pointerType, x, y });
    await settled();
    await click(node);
    assert.equal(saved().adventure.moves, original.moves - 1);
    assert.equal(root.querySelectorAll(".selected").length, 0);
  });

test("cancelled, second-pointer and outward edge gestures never wrap or spend moves", async () => {
  await mount();
  const original = saved().adventure;
  await pointer(piece(7), "pointerdown", { x: 300, y: 20 });
  await pointer(piece(7), "pointermove", { x: 330, y: 20 });
  assert.equal(root.querySelector(".board").getAttribute("aria-busy"), "false");
  await pointer(piece(0), "pointerdown", { x: 20, y: 20 });
  await pointer(piece(0), "pointermove", { pointerId: 2, x: 50, y: 20 });
  assert.equal(root.querySelector(".board").getAttribute("aria-busy"), "false");
  await pointer(piece(0), "pointercancel", { x: 20, y: 20 });
  await pointer(piece(0), "pointermove", { x: 50, y: 20 });
  assert.deepEqual(saved().adventure, original);
});

test("two rainbow tools clear the current screen then activate the queued partner after refill", async () => {
  const adventure = createGame(50);
  adventure.board = adventure.board.map((piece) => ({ ...piece, ice: 0 }));
  adventure.iceGoal = 0;
  adventure.board[0] = { ...adventure.board[0], type: null, special: "color" };
  adventure.board[1] = { ...adventure.board[1], type: null, special: "color" };
  await mount({ adventure });
  assert.equal(root.querySelectorAll(".rainbow-token").length, 2);
  assert.match(piece(0).getAttribute("aria-label"), /彩虹道具/);
  await click(piece(0));
  await click(piece(1));
  await until(() => root.querySelectorAll(".clearing").length === 63);
  assert.equal(piece(0).dataset.tileId, String(adventure.board[1].id));
  assert.equal(piece(0).dataset.pendingColorClear, "1");
  assert.ok(!piece(0).classList.contains("clearing"));
  assert.equal(piece(1).dataset.tileId, String(adventure.board[0].id));
  assert.equal(saved().adventure.score, 0, "save only after the board settles");
  await until(() => root.querySelector(`.cell.clearing[data-tile-id="${adventure.board[1].id}"]`));
  assert.equal(root.querySelector(`.cell[data-tile-id="${adventure.board[0].id}"]`), null);
  assert.equal(saved().adventure.score, 0, "the next-screen blast also remains transient");
  await settled();
  const next = saved().adventure;
  assert.equal(next.moves, adventure.moves - 1);
  assert.ok(next.score >= 3840);
  assert.ok(next.collected.reduce((a, b) => a + b) >= 62);
  assert.equal(next.board.filter(Boolean).length, 64);
});

test("board and piece retain exclusive touch handling with the real stylesheet, including enabled buttons", async () => {
  await mount();
  const style = document.createElement("style");
  style.textContent = await readFile(
    new URL("../games/fuzzy-match-3/styles.css", import.meta.url),
    "utf8",
  );
  document.head.append(style);
  try {
    const board = root.querySelector(".board"),
      cell = piece(0);
    assert.equal(
      window.getComputedStyle(board).getPropertyValue("touch-action"),
      "none",
    );
    assert.equal(
      window.getComputedStyle(cell).getPropertyValue("touch-action"),
      "none",
    );
    cell.disabled = true;
    assert.equal(
      window.getComputedStyle(cell).getPropertyValue("touch-action"),
      "none",
    );
    assert.equal(
      window
        .getComputedStyle(root.querySelector(".tools button"))
        .getPropertyValue("touch-action"),
      "manipulation",
    );
  } finally {
    style.remove();
  }
});

test("a stripe and unmatched ordinary piece animate back without spending a move; hints stay legal", async () => {
  let adventure;
  for (let seed = 1; seed < 100; seed++) {
    adventure = createGame(50, false, seededRandom(seed));
    if (!canSwap(adventure.board, 0, 1)) break;
  }
  adventure.board[0].special = "row";
  assert.equal(canSwap(adventure.board, 0, 1), false);
  await mount({ adventure });
  await click(piece(0));
  await click(piece(1));
  assert.equal(piece(0).dataset.swapPhase, "forward");
  await until(() => piece(0).dataset.swapPhase === "return");
  await settled();
  assert.deepEqual(saved().adventure, adventure);
  assert.equal(piece(0).dataset.special, "row");
  await click(root.querySelector(".tools button"));
  const hint = [...root.querySelectorAll(".hinted")].map((node) =>
    Number(node.dataset.index),
  );
  assert.equal(hint.length, 2);
  assert.ok(canSwap(adventure.board, ...hint));
});

function patternedGame() {
  const game = createGame(50);
  game.iceGoal = 0;
  game.board = game.board.map((piece, i) => ({
    ...piece,
    ice: 0,
    type: (Math.floor(i / 8) * 2 + (i % 8)) % 6,
  }));
  return game;
}

test("a stripe making a three-match explodes its line and spends exactly one move", async () => {
  const adventure = patternedGame();
  [0, 1, 10].forEach((index) => {
    adventure.board[index].type = 5;
  });
  adventure.board[10].special = "column";
  await mount({ adventure });
  await click(piece(10));
  await click(piece(2));
  await until(() => root.querySelectorAll(".clearing").length === 10);
  for (const index of [0, 1, 2, 10, 18, 26, 34, 42, 50, 58])
    assert.ok(piece(index).classList.contains("clearing"));
  await settled();
  assert.equal(saved().adventure.moves, adventure.moves - 1);
  assert.ok(saved().adventure.score >= 600);
});

for (const { neighbor, direction, lines } of [
  { neighbor: 28, direction: "row", lines: ["one row", "two columns"] },
  { neighbor: 35, direction: "column", lines: ["two rows", "one column"] },
])
  test(`two ${direction} stripes clear ${lines.join(" and ")} when exchanged`, async () => {
    const adventure = patternedGame();
    adventure.board[27].special = direction;
    adventure.board[neighbor].special = direction;
    await mount({ adventure });
    await click(piece(27));
    await click(piece(neighbor));
    await until(() => root.querySelectorAll(".clearing").length === 22);
    for (let i = 0; i < 8; i++)
      for (const index of [
        24 + i,
        i * 8 + 3,
        neighbor === 28 ? i * 8 + 4 : 32 + i,
      ])
        assert.ok(piece(index).classList.contains("clearing"));
    await settled();
    assert.equal(saved().adventure.moves, adventure.moves - 1);
    assert.ok(saved().adventure.score >= 1320);
  });

test("rainbow and stripe show every matching piece converted before any explosion", async () => {
  const adventure = patternedGame();
  adventure.board[0] = { ...adventure.board[0], type: null, special: "color" };
  adventure.board[1].special = "column";
  await mount({ adventure });
  await click(piece(0));
  await click(piece(1));
  await until(() => root.querySelectorAll(".converting").length > 0);
  const converted = [...root.querySelectorAll(".converting")];
  const matches = [...root.querySelectorAll('.cell[data-type="1"]')];
  assert.equal(converted.length, matches.length);
  assert.equal(root.querySelectorAll(".clearing").length, 0);
  assert.deepEqual(
    saved().adventure,
    adventure,
    "conversion must not save an intermediate board",
  );
  for (const node of converted) {
    assert.equal(node.dataset.type, "1");
    assert.ok(["row", "column"].includes(node.dataset.special));
  }
  await until(() => root.querySelectorAll(".clearing").length > 0);
  assert.equal(root.querySelectorAll(".converting").length, 0);
  const expected = new Set([1]);
  for (const node of converted) {
    const index = Number(node.dataset.index);
    for (let i = 0; i < 8; i++)
      expected.add(
        node.dataset.special === "row"
          ? Math.floor(index / 8) * 8 + i
          : i * 8 + (index % 8),
      );
  }
  assert.deepEqual(
    new Set(
      [...root.querySelectorAll(".clearing")].map((node) =>
        Number(node.dataset.index),
      ),
    ),
    expected,
  );
  await settled();
  assert.equal(saved().adventure.moves, adventure.moves - 1);
  assert.ok(saved().adventure.score >= expected.size * 60);
});

function nearlyCompleteGame(daily = false) {
  const game = patternedGame();
  game.level = 1;
  const config = levelConfig(1, daily);
  [0, 1, 10].forEach((index) => {
    game.board[index].type = config.targetType;
  });
  game.collected[config.targetType] = config.count - 1;
  game.score = 4200;
  game.moves = 11;
  return game;
}

function finaleGame({ moves = 11, win = true } = {}) {
  const game = patternedGame();
  game.level = 1;
  for (const index of [0, 1, 10]) game.board[index].type = win ? 0 : 5;
  for (const index of [48, 50]) game.board[index].special = "row";
  for (const index of [40, 56]) game.board[index].special = "column";
  for (const index of [51, 63])
    game.board[index] = { ...game.board[index], type: null, special: "color" };
  game.moves = moves;
  game.score = 2200;
  game.collected[0] = 11;
  return game;
}

test("a winning finale animates all stripes without rotating, queues rainbows, and drains newly created rewards before saving once", async () => {
  const adventure = finaleGame();
  const config = levelConfig(adventure.level);
  const predictionRandom = seededRandom(8);
  const initialWave = resolveWave(swap(adventure.board, 10, 2), {
    exchange: [10, 2], preferred: [2, 10], random: predictionRandom,
  });
  const firstFinale = resolveWave(refill(initialWave.board, predictionRandom), {
    finale: true, chain: 1, random: predictionRandom,
  });
  const previousRandom = Math.random;
  Math.random = seededRandom(8);
  try {
    await mount({ adventure });
    await click(piece(10));
    await click(piece(2));
    await until(() => piece(0).classList.contains("clearing"));
    assertDisplayedScore(adventure.score + initialWave.score, config);
    assert.equal(root.querySelector(".chain-count").textContent, "");
    assert.equal(root.querySelector(".chain-score").textContent, `+${initialWave.score}`);
    await until(() => [40, 48, 50, 56].every((index) => piece(index).classList.contains("clearing")));
    for (const index of [40, 56]) assert.equal(piece(index).dataset.special, "column");
    for (const index of [48, 50]) assert.equal(piece(index).dataset.special, "row");
    for (const index of [51, 63]) {
      assert.equal(piece(index).classList.contains("rainbow-armed"), true);
      assert.equal(piece(index).classList.contains("clearing"), false);
    }
    assert.equal(root.querySelector('[role="dialog"]'), null);
    assert.deepEqual(saved().adventure, adventure, "the finale does not persist a partially cleared board");
    let displayedScore = adventure.score + initialWave.score + firstFinale.score;
    assertDisplayedScore(displayedScore, config);
    const scoreChanges = [displayedScore];
    const chainSizes = new Map();
    await until(() => {
      const count = root.querySelector(".chain-count");
      if (count?.textContent) {
        assert.match(count.textContent, /^\d+ 连击$/);
        chainSizes.set(Number.parseInt(count.textContent), count.style.fontSize);
        assert.match(root.querySelector(".chain-score").textContent, /^\+\d+$/);
      }
      const current = Number(root.querySelector(".score-label strong").firstChild.textContent.replaceAll(",", ""));
      assert.ok(current >= displayedScore, "displayed score never falls between finale waves or at final commit");
      if (current !== displayedScore) scoreChanges.push(current);
      displayedScore = current;
      assertDisplayedScore(current, config);
      if (saved().adventure.status === "playing")
        assert.equal(saved().adventure.score, adventure.score, "animated points are not saved ahead of the board");
      return saved().adventure.status === "won";
    }, 600);
    assert.ok(scoreChanges.length >= 4, "queued specials and later cascades each update the score before settlement");
    assert.equal(chainSizes.get(2), "1.375rem");
    assert.equal(chainSizes.get(5), "1.75rem");
    for (const [chain, size] of chainSizes)
      if (chain > 5) assert.equal(size, "1.75rem");
    assertDisplayedScore(totalScore(saved().adventure), config);
    assert.equal(root.querySelector(".board").getAttribute("aria-busy"), "true");
    assert.equal(root.querySelector(".chain-label"), null);
    assert.equal(root.querySelector('[role="dialog"]'), null);
    assert.equal(root.querySelectorAll(".cell[data-special]").length, 0);
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    assert.equal(root.querySelector('[role="dialog"]'), null, "the completed board remains visible even with reduced motion enabled");
    assert.equal(root.querySelector(".tools button").disabled, true);
    await settled();
    const next = saved().adventure;
    assert.equal(next.status, "won");
    assert.equal(next.moves, 10, "the entire finale spends no extra moves");
    assert.equal(next.score, 28160, "includes the two extra rewards created during the finale");
    assert.ok(next.board.every((tile) => !tile?.special));
    const expected = simulateTurn(adventure, [10, 2], { random: seededRandom(8) });
    assert.equal(next.score, expected.score);
    assert.deepEqual(next.collected, expected.collected);
    assert.deepEqual(next.board.map((tile) => tile?.type), expected.board.map((tile) => tile?.type));
    assert.equal(saved().stats.best, totalScore(next));
    assert.equal(saved().stats.wins, 1);
    assert.equal(saved().levelStars[1], 3);
    const snapshot = saved();
    act(() => render(null, root));
    root.remove();
    root = null;
    await mount(snapshot);
    assert.deepEqual(saved(), snapshot, "reopening never repeats finale points or the completion reward");
  } finally {
    Math.random = previousRandom;
  }
});

test("a failed last move settles its normal clear without detonating idle specials", async () => {
  const adventure = finaleGame({ moves: 1, win: false });
  const previousRandom = Math.random;
  Math.random = seededRandom(8);
  try {
    await mount({ adventure });
    await click(piece(10));
    await click(piece(2));
    await settled();
    const next = saved().adventure;
    assert.equal(next.moves, 0);
    assert.equal(next.status, "lost");
    assert.equal(next.collected[0], adventure.collected[0]);
    assert.equal(next.score, adventure.score + 180);
    for (const index of [40, 48, 50, 51, 56, 63]) {
      const original = adventure.board[index];
      assert.deepEqual(next.board.find(tile => tile?.id === original.id), original);
    }
    assert.equal(root.querySelectorAll(".rainbow-armed").length, 0);
    assert.equal(saved().stats.wins, 0);
    const expected = simulateTurn(adventure, [10, 2], { random: seededRandom(8) });
    assert.equal(next.score, expected.score);
    assert.deepEqual(next.collected, expected.collected);
    assert.deepEqual(
      next.board.map(({ id, ...tile }) => tile),
      expected.board.map(({ id, ...tile }) => tile),
    );
    assert.equal(root.querySelector("#dialog-title").textContent, "步数用完");
  } finally {
    Math.random = previousRandom;
  }
});

test("meeting the goals on the last move still triggers the winning finale without a move bonus", async () => {
  const adventure = finaleGame({ moves: 1 });
  const previousRandom = Math.random;
  Math.random = seededRandom(8);
  try {
    await mount({ adventure });
    await click(piece(10));
    await click(piece(2));
    await settled();
    const next = saved().adventure;
    assert.equal(next.moves, 0);
    assert.equal(next.status, "won");
    assert.equal(next.score, 28160);
    assert.equal(totalScore(next), next.score);
    assert.ok(next.board.every(tile => !tile?.special));
    assert.equal(root.querySelector("#dialog-title").textContent, "通关");
  } finally {
    Math.random = previousRandom;
  }
});

for (const daily of [false, true])
  test(`${daily ? "daily" : "adventure"} completion includes move rewards in score, stars and best record`, async () => {
    const game = nearlyCompleteGame(daily);
    const date = new Date();
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const profile = daily
      ? {
          adventure: createGame(1, false, seededRandom(3)),
          daily: game,
          date: dateKey,
        }
      : { adventure: game };
    const previousRandom = Math.random;
    let draw = 0;
    Math.random = () => [0.25, 0.45, 0.75][draw++] ?? 0.6;
    try {
      await mount(profile);
      if (daily) {
        await showLevelList();
        await click(button("每日挑战"));
      }
      assert.equal(root.querySelectorAll(".score-star.filled").length, 1);
      const thresholds = [...root.querySelectorAll(".score-star")].map((node) =>
        Number(node.dataset.scoreTarget),
      );
      assert.deepEqual(thresholds, levelConfig(1, daily).starTargets);
      assert.equal(root.querySelector(".score-breakdown"), null);
      await click(piece(10));
      await click(piece(2));
      await settled();
      const next = saved()[daily ? "daily" : "adventure"];
      assert.equal(next.status, "won");
      assert.equal(next.score, 4380, "save retains only earned match points");
      assert.equal(next.moves, 10);
      assert.equal(totalScore(next), 19380);
      assert.equal(
        root.querySelector(".result-score strong").textContent,
        "19,380",
      );
      assert.equal(root.querySelector(".score-breakdown"), null);
      assert.doesNotMatch(root.querySelector(".result-score").textContent, /消除得分|步数奖励/);
      assert.equal(root.querySelectorAll(".result-stars .earned").length, 3);
      assert.deepEqual(saved().levelStars, daily ? {} : { 1: 3 });
      assert.equal(saved().stats.best, 19380);
      assert.equal(
        root.querySelector(".score-track").getAttribute("aria-valuemax"),
        String(thresholds[2]),
      );
    } finally {
      Math.random = previousRandom;
    }
  });

test("reopening a completed save displays its bonus once and restores the final best score", async () => {
  const adventure = createGame();
  adventure.status = "won";
  adventure.score = 6000;
  adventure.moves = 18;
  adventure.collected[0] = 12;
  await mount({ adventure, stats: { best: 6000, wins: 1 } });
  assert.equal(
    root.querySelector(".result-score strong").textContent,
    "33,000",
  );
  assert.equal(saved().stats.best, 33000);
  const snapshot = saved();
  act(() => render(null, root));
  root.remove();
  root = null;
  await mount(snapshot);
  assert.equal(
    root.querySelector(".result-score strong").textContent,
    "33,000",
  );
  assert.equal(saved().adventure.score, 6000);
  assert.equal(saved().stats.best, 33000);
  assert.equal(saved().stats.wins, 1);
});

test("an open column refills straight down instead of pulling neighbors when ice exists elsewhere", async () => {
  const adventure = patternedGame();
  [11, 19, 26].forEach((i) => {
    adventure.board[i].type = 5;
  });
  adventure.board[35].type = 0;
  adventure.board[63].ice = 1;
  adventure.iceGoal = 1;
  const moved = swap(adventure.board, 26, 27);
  const wave = resolveWave(moved, { exchange: [26, 27] });
  assert.equal(wave.cleared.length, 3);
  let seed = 1;
  let expected;
  for (; seed <= 100; seed++) {
    expected = refill(wave.board, seededRandom(seed));
    if (!findMatches(expected).length && findMove(expected)) break;
  }
  assert.ok(seed <= 100);
  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    await mount({ adventure });
    await click(piece(26));
    await click(piece(27));
    await settled();
    const next = saved().adventure;
    assert.equal(next.score, wave.score);
    assert.equal(next.moves, adventure.moves - 1);
    assert.deepEqual(
      next.board.map(f => f.type),
      expected.map(f => f.type),
    );
    for (let i = 0; i < next.board.length; i++)
      if (i % 8 !== 3) assert.equal(next.board[i].id, moved[i].id);
    assert.equal(next.board[63].ice, 1);
  } finally {
    Math.random = previousRandom;
  }
});

test("frozen cells cannot be swiped; adjacent clearing animates ice, saves its layers and keeps the tools fixed", async () => {
  const adventure = patternedGame();
  [0, 1, 10].forEach((index) => {
    adventure.board[index].type = 5;
  });
  adventure.board[8].ice = 2;
  adventure.iceGoal = 2;
  const previousRandom = Math.random;
  let draw = 0;
  Math.random = () => [0.25, 0.45, 0.75][draw++] ?? 0.6;
  try {
    await mount({ adventure });
    const anchor = adventure.board[8].id;
    assert.equal(piece(8).disabled, true);
    assert.match(piece(8).getAttribute("aria-label"), /2 层冰封/);
    assert.ok(piece(8).querySelector(".ice-shell"));
    await pointer(piece(8), "pointerdown", { x: 20, y: 60 });
    await pointer(piece(8), "pointermove", { x: 60, y: 60 });
    assert.equal(
      root.querySelector(".board").getAttribute("aria-busy"),
      "false",
    );
    assert.deepEqual(saved().adventure, adventure);
    await click(piece(10));
    await click(piece(2));
    await until(() => root.querySelector(".ice-breaking"));
    assert.equal(root.querySelector(".ice-goal").getAttribute("aria-label"), "解冻冰层：1 / 2");
    assert.equal(
      saved().adventure.board[8].ice,
      2,
      "no partial animation is saved",
    );
    await settled();
    assert.equal(saved().adventure.board[8].ice, 1);
    assert.equal(saved().adventure.board[8].id, anchor);
    assert.equal(saved().adventure.moves, adventure.moves - 1);
    assert.equal(
      root.querySelector(".ice-goal").getAttribute("aria-label"),
      "解冻冰层：1 / 2",
    );
    assert.equal(
      root.querySelector(".board-wrap").nextElementSibling,
      root.querySelector(".tools"),
    );
    assert.equal(root.querySelector('[role="status"]'), null);
    const snapshot = saved();
    act(() => render(null, root));
    root.remove();
    root = null;
    await mount(snapshot);
    assert.equal(piece(8).dataset.ice, "1");
    assert.equal(saved().adventure.moves, adventure.moves - 1);
  } finally {
    Math.random = previousRandom;
  }
});

test("a four-match reward animates adjacent ice breaking and saves both the stripe and reduced ice", async () => {
  const adventure = patternedGame();
  adventure.level = 6;
  for (const index of [24, 25, 27, 34]) adventure.board[index].type = 5;
  adventure.board[26].type = 1;
  adventure.board[18].ice = 2;
  adventure.iceGoal = 2;
  const wave = resolveWave(swap(adventure.board, 34, 26), {
    exchange: [34, 26], preferred: [26, 34],
  });
  let seed = 1;
  for (; seed < 100; seed++) {
    const filled = refill(wave.board, seededRandom(seed));
    if (!findMatches(filled).length && findMove(filled)) break;
  }
  assert.ok(seed < 100);
  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    await mount({ adventure });
    await click(piece(34));
    await click(piece(26));
    await until(() => piece(18).classList.contains("ice-breaking"));
    assert.equal(root.querySelector(".chain-label").textContent, "+350");
    assert.equal(saved().adventure.board[18].ice, 2, "partial animations are not saved");
    assert.equal(saved().adventure.collected[5], 0);
    assert.match(root.querySelector('.mini-goal[aria-label^="收集"]').getAttribute("aria-label"), /4 \/ 22$/);
    assert.equal(root.querySelector(".ice-goal").getAttribute("aria-label"), "解冻冰层：1 / 2");
    assert.equal(root.querySelector('.game-details [data-goal="collect"] .goal-remaining').textContent, "18");
    assert.equal(root.querySelector('.mini-goal[data-goal="collect"] .goal-remaining').textContent, "18");
    await settled();
    const next = saved().adventure;
    assert.equal(next.board[18].ice, 1);
    assert.equal(next.board[18].id, adventure.board[18].id);
    assert.equal(next.board[26].special, "column");
    assert.equal(next.board[26].id, adventure.board[34].id);
    assert.equal(next.moves, adventure.moves - 1);
    assert.equal(next.score, adventure.score + 350);
    assert.equal(next.collected[5], 4);
    assert.equal(saved().stats.eliminated, 4);
    assert.match(root.querySelector('.mini-goal[aria-label^="收集"]').getAttribute("aria-label"), /4 \/ 22$/);
    const snapshot = saved();
    act(() => render(null, root));
    root.remove();
    root = null;
    await mount(snapshot);
    assert.equal(piece(18).dataset.ice, "1");
    assert.equal(piece(26).dataset.special, "column");
    assert.deepEqual(saved().adventure, snapshot.adventure);
    assert.equal(saved().stats.eliminated, 4);
  } finally {
    Math.random = previousRandom;
  }
});

test("a saved ice barrier resumes with its right-hand source and saves the next left turn", async () => {
  const adventure = patternedGame();
  [26, 27, 36].forEach(i => { adventure.board[i].type = 5; });
  adventure.board[29].type = 0;
  adventure.board[19] = { ...adventure.board[19], ice: 2, feedSide: "right" };
  adventure.iceGoal = 2;
  const wave = resolveWave(swap(adventure.board, 36, 28), { exchange: [36, 28] });
  assert.equal(wave.creations.size, 0);
  let seed = 1;
  for (; seed <= 100; seed++) {
    const filled = refill(wave.board, seededRandom(seed));
    if (!findMatches(filled).length && findMove(filled)) break;
  }
  assert.ok(seed <= 100);
  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    await mount({ adventure });
    await click(piece(36));
    await click(piece(28));
    await settled();
    const next = saved().adventure;
    assert.equal(next.board[27].id, adventure.board[12].id);
    assert.equal(next.board[19].ice, 1);
    assert.equal(next.board[19].feedSide, "left");
    assert.equal(next.moves, adventure.moves - 1);
    const snapshot = saved();
    act(() => render(null, root));
    root.remove();
    root = null;
    await mount(snapshot);
    assert.deepEqual(saved().adventure, snapshot.adventure);
  } finally {
    Math.random = previousRandom;
  }
});

test("blocked empty cells preserve the grid, ignore swaps, and survive hints, shuffle and reload", async () => {
  const adventure = patternedGame();
  [18, 19, 20].forEach(i => { adventure.board[i].ice = 1; });
  adventure.board[27] = null;
  adventure.iceGoal = 3;
  for (const i of [0, 1])
    adventure.board[i] = { ...adventure.board[i], type: null, special: "color" };
  await mount({ adventure });
  assert.equal(root.querySelectorAll(".cell").length, 64);
  assert.equal(piece(27).dataset.empty, "true");
  assert.equal(piece(27).querySelector(".tile-art"), null);
  await pointer(piece(26), "pointerdown", { x: 20, y: 20 });
  await pointer(piece(26), "pointermove", { x: 55, y: 20 });
  assert.equal(root.querySelector(".board").getAttribute("aria-busy"), "false");
  assert.deepEqual(saved().adventure, adventure);
  await click(root.querySelectorAll(".tools button")[0]);
  assert.equal(root.querySelectorAll(".hinted").length, 2);
  assert.equal(piece(27).classList.contains("hinted"), false);
  await click(root.querySelectorAll(".tools button")[1]);
  assert.equal(saved().adventure.board[27], null);
  assert.equal(saved().adventure.moves, adventure.moves);
  const snapshot = saved();
  act(() => render(null, root));
  root.remove();
  root = null;
  await mount(snapshot);
  assert.deepEqual(saved().adventure, snapshot.adventure);
  assert.equal(piece(27).dataset.empty, "true");
});

test("the last ice layer can complete a level on the final move", async () => {
  const adventure = patternedGame();
  [0, 1, 10].forEach((index) => {
    adventure.board[index].type = 5;
  });
  adventure.board[8].ice = 1;
  adventure.iceGoal = 1;
  adventure.score = 20000;
  adventure.collected = Array(6).fill(100);
  adventure.moves = 1;
  const previousRandom = Math.random;
  let draw = 0;
  Math.random = () => [0.25, 0.45, 0.75][draw++] ?? 0.6;
  try {
    await mount({ adventure });
    assert.equal(root.querySelector('[role="dialog"]'), null);
    await click(piece(10));
    await click(piece(2));
    await settled();
    assert.equal(saved().adventure.status, "won");
    assert.equal(saved().adventure.moves, 0);
    assert.equal(root.querySelector("#dialog-title").textContent, "通关");
    assert.equal(
      root.querySelector(".ice-goal").getAttribute("aria-label"),
      "解冻冰层：1 / 1",
    );
  } finally {
    Math.random = previousRandom;
  }
});

test("a simultaneous double match displays and saves its area score without inserting a status row", async () => {
  const adventure = patternedGame();
  [0, 2, 9].forEach((index) => {
    adventure.board[index].type = 5;
  });
  [1, 8, 10].forEach((index) => {
    adventure.board[index].type = 4;
  });
  const previousRandom = Math.random;
  let draw = 0;
  Math.random = () => [0.18, 0.01, 0.35, 0.51, 0.68, 0.18][draw++] ?? 0.6;
  try {
    await mount({ adventure });
    await click(piece(1));
    await click(piece(9));
    await until(() => root.querySelectorAll(".clearing").length === 6);
    assert.equal(
      root.querySelector(".chain-label").textContent,
      "+440",
    );
    await settled();
    assert.equal(saved().adventure.score, 440);
    assert.equal(saved().adventure.moves, adventure.moves - 1);
    assert.equal(
      root.querySelector(".board-wrap").nextElementSibling,
      root.querySelector(".tools"),
    );
    assert.equal(root.querySelector('[role="status"]'), null);
  } finally {
    Math.random = previousRandom;
  }
});

test("double rainbow animation and saved refill preserve the other rainbows through stripe explosions", async () => {
  const adventure = patternedGame();
  for (const i of [0, 1, 27, 63])
    adventure.board[i] = {
      ...adventure.board[i],
      type: null,
      special: "color",
    };
  adventure.board[3].special = "column";
  adventure.board[40].special = "row";
  const protectedIds = [adventure.board[27].id, adventure.board[63].id];
  const previousRandom = Math.random;
  Math.random = seededRandom(42);
  try {
    await mount({ adventure });
    await click(piece(0));
    await click(piece(1));
    await until(() => root.querySelectorAll(".clearing").length === 61);
    assert.equal(piece(27).classList.contains("clearing"), false);
    assert.equal(piece(63).classList.contains("clearing"), false);
    assert.equal(root.querySelectorAll(".rainbow-token").length, 4);
    await settled();
    const next = saved().adventure;
    assert.equal(next.moves, adventure.moves - 1);
    assert.ok(next.score > 7380, "the queued partner scores on the following screen");
    assert.equal(
      next.board.filter((piece) => piece.special === "color").length,
      2,
    );
    assert.equal(root.querySelectorAll(".rainbow-token").length, 2);
    for (const id of protectedIds)
      assert.ok(
        next.board.some(
          (piece) => piece.id === id && piece.special === "color",
        ),
      );
    assert.equal(next.board[59].id, protectedIds[0]);
    assert.equal(next.board[63].id, protectedIds[1]);
  } finally {
    Math.random = previousRandom;
  }
});

test("rainbow plus stripe still explodes converted stripes while preserving the rainbow earned by a five-match", async () => {
  const adventure = patternedGame();
  adventure.board.forEach((piece) => {
    if (piece.type === 5) piece.type = 0;
  });
  [24, 25, 26, 27, 28].forEach((i) => {
    adventure.board[i].type = 5;
  });
  adventure.board[26] = {
    ...adventure.board[26],
    type: null,
    special: "color",
  };
  adventure.board[18] = { ...adventure.board[18], type: 5, special: "column" };
  const rewardId = adventure.board[18].id,
    spentId = adventure.board[26].id;
  const draws = Array(5).fill(0.75);
  for (let col = 0; col < 5; col++)
    for (let row = col === 2 ? 6 : 7; row >= 0; row--)
      draws.push((((row * 2 + col) % 6) + 0.1) / 6);
  const previousRandom = Math.random;
  let draw = 0;
  Math.random = () => draws[draw++] ?? 0.6;
  try {
    await mount({ adventure });
    await click(piece(26));
    await click(piece(18));
    await until(() => root.querySelectorAll(".converting").length === 5);
    await until(() => root.querySelectorAll(".clearing").length === 39);
    assert.equal(piece(26).classList.contains("clearing"), false);
    assert.equal(piece(18).classList.contains("clearing"), true);
    await settled();
    const next = saved().adventure;
    assert.equal(next.moves, adventure.moves - 1);
    assert.equal(next.score, 4470);
    assert.equal(next.board[58].id, rewardId);
    assert.equal(next.board[58].special, "color");
    assert.equal(next.board[58].type, null);
    assert.equal(
      next.board.some((piece) => piece.id === spentId),
      false,
    );
    assert.equal(root.querySelectorAll(".rainbow-token").length, 1);
  } finally {
    Math.random = previousRandom;
  }
});

test("a stripe hit by a same-direction stripe visibly turns perpendicular for its explosion", async () => {
  const adventure = patternedGame();
  [16, 17, 26].forEach((i) => {
    adventure.board[i].type = 5;
  });
  adventure.board[16].special = "row";
  adventure.board[20].special = "row";
  const previousRandom = Math.random;
  Math.random = seededRandom(109);
  try {
    await mount({ adventure });
    await click(piece(26));
    await click(piece(18));
    await until(() => root.querySelectorAll(".clearing").length > 0);
    assert.equal(piece(16).dataset.special, "row");
    assert.equal(piece(20).dataset.special, "column");
    assert.equal(piece(20).classList.contains("clearing"), true);
    assert.deepEqual(
      new Set(
        [...root.querySelectorAll(".clearing")].map((node) =>
          Number(node.dataset.index),
        ),
      ),
      new Set(
        Array.from({ length: 64 }, (_, i) => i).filter(
          (i) => Math.floor(i / 8) === 2 || i % 8 === 4,
        ),
      ),
    );
    await settled();
    const expected = simulateTurn(adventure, [26, 18], {
      random: seededRandom(109),
    });
    assert.equal(saved().adventure.score, expected.score);
    assert.equal(saved().adventure.moves, adventure.moves - 1);
  } finally {
    Math.random = previousRandom;
  }
});

test("two stripe-hit rainbows stay marked and explode on two separate refilled screens", async () => {
  const adventure = patternedGame();
  adventure.board[16].special = "row";
  adventure.board[17].special = "row";
  for (const i of [18, 22])
    adventure.board[i] = {
      ...adventure.board[i],
      type: null,
      special: "color",
    };
  const firstId = adventure.board[18].id,
    secondId = adventure.board[22].id;
  const initial = resolveWave(swap(adventure.board, 16, 17), {
    exchange: [16, 17],
  });
  assert.deepEqual(
    [...initial.armed],
    [
      [18, 1],
      [22, 2],
    ],
  );
  const draws = [];
  const screenOne = refill(initial.board, () => {
    draws.push(0.01);
    return 0.01;
  });
  const one = resolveWave(screenOne, { chain: 2 });
  assert.equal(one.colorClearTarget, 0);
  const screenTwo = refill(one.board, () => {
    draws.push(0.75);
    return 0.75;
  });
  const two = resolveWave(screenTwo, { chain: 3 });
  assert.equal(two.colorClearTarget, 4);
  let predictedDraw = 0;
  const predictedRandom = seededRandom(123);
  const expected = simulateTurn(adventure, [16, 17], {
    random: () => draws[predictedDraw++] ?? predictedRandom(),
  });
  const previousRandom = Math.random;
  let draw = 0;
  const remainingRandom = seededRandom(123);
  Math.random = () => draws[draw++] ?? remainingRandom();
  const byId = (id) => root.querySelector(`[data-tile-id="${id}"]`);
  try {
    await mount({ adventure });
    await click(piece(16));
    await click(piece(17));
    await until(() => root.querySelectorAll(".rainbow-armed").length === 2);
    assert.equal(root.querySelectorAll(".rainbow-armed.clearing").length, 0);
    assert.equal(byId(firstId).dataset.pendingColorClear, "1");
    assert.equal(byId(secondId).dataset.pendingColorClear, "2");
    assert.match(byId(secondId).getAttribute("aria-label"), /待触发/);
    const config = levelConfig(adventure.level);
    const displayed = () => root.querySelector('.mini-goal[aria-label^="收集"]').getAttribute("aria-label");
    assert.ok(displayed().endsWith(`${initial.collected[config.targetType]} / ${config.count}`));
    assertDisplayedScore(adventure.score + initial.score, config);
    await until(() => byId(firstId)?.classList.contains("clearing"));
    assert.deepEqual(
      boardTypes(),
      screenOne.map((piece) => piece.type),
    );
    assert.equal(root.querySelectorAll(".rainbow-armed.clearing").length, 1);
    assert.equal(byId(secondId).classList.contains("clearing"), false);
    assert.ok(displayed().endsWith(`${initial.collected[config.targetType] + one.collected[config.targetType]} / ${config.count}`));
    assertDisplayedScore(adventure.score + initial.score + one.score, config);
    assert.equal(saved().adventure.score, adventure.score);
    assert.deepEqual(saved().adventure.collected, adventure.collected);
    await until(() => byId(secondId)?.classList.contains("clearing"));
    assert.equal(byId(firstId), null);
    assert.deepEqual(
      boardTypes(),
      screenTwo.map((piece) => piece.type),
    );
    assert.equal(root.querySelectorAll(".rainbow-armed.clearing").length, 1);
    assert.ok(displayed().endsWith(`${initial.collected[config.targetType] + one.collected[config.targetType] + two.collected[config.targetType]} / ${config.count}`));
    assertDisplayedScore(adventure.score + initial.score + one.score + two.score, config);
    assert.equal(saved().adventure.score, adventure.score);
    await settled();
    const next = saved().adventure;
    assert.equal(next.moves, adventure.moves - 1);
    assert.equal(next.score, expected.score);
    assert.equal(pendingColorClear(next.board), -1);
    assert.equal(root.querySelectorAll(".rainbow-armed").length, 0);
    assert.deepEqual(
      boardTypes(),
      expected.board.map((piece) => piece.type),
    );
    assert.equal(root.querySelector('[role="status"]'), null);
  } finally {
    Math.random = previousRandom;
  }
});

test("a queued save resumes before win/loss, without spending another move or awarding completion twice", async () => {
  const adventure = patternedGame();
  [0, 1, 2].forEach((i) => {
    adventure.board[i].type = 5;
  });
  adventure.board[63] = {
    ...adventure.board[63],
    type: null,
    special: "color",
    pending: 1,
  };
  adventure.moves = 0;
  adventure.score = 20000;
  adventure.collected = Array(6).fill(100);
  const wave = resolveWave(adventure.board);
  const draws = [];
  for (let seed = 1; seed <= 100; seed++) {
    const random = seededRandom(seed),
      trial = [];
    const candidate = refill(wave.board, () => {
      const value = random();
      trial.push(value);
      return value;
    });
    if (!findMatches(candidate).length && findMove(candidate)) {
      draws.push(...trial);
      break;
    }
  }
  assert.ok(draws.length);
  const previousRandom = Math.random;
  let draw = 0;
  Math.random = () => draws[draw++] ?? 0.6;
  try {
    await mount({ adventure });
    await until(
      () => root.querySelector(".board").getAttribute("aria-busy") === "true",
    );
    assert.equal(root.querySelector('[role="dialog"]'), null);
    await settled();
    assert.equal(saved().adventure.moves, 0);
    assert.equal(saved().adventure.score, adventure.score + wave.score);
    assert.equal(saved().adventure.status, "won");
    assert.equal(saved().stats.wins, 1);
    assert.equal(root.querySelector("#dialog-title").textContent, "通关");
    const snapshot = saved();
    act(() => render(null, root));
    root.remove();
    root = null;
    await mount(snapshot);
    assert.equal(saved().stats.wins, 1);
    assert.equal(saved().adventure.score, snapshot.adventure.score);
  } finally {
    Math.random = previousRandom;
  }
});

for (const [level, kind, floorCount] of [[1, "collect", 0], [2, "spread", 16], [3, "reveal", 8], [4, "deliver", 8]])
  test(`${kind} objective renders on its level and persists through reload`, async () => {
    const adventure = createRotatingGame(level, false, seededRandom(42));
    await mount({ adventure });
    assert.equal(root.querySelectorAll(".cell").length, 64);
    assert.equal(root.querySelectorAll(".mini-goal[data-goal]").length, 1);
    assert.equal(root.querySelector(".mini-goal[data-goal]").dataset.goal, kind);
    assert.equal(root.querySelector(".mini-goal[data-goal] .goal-remaining").textContent,
      String(kind === "collect" ? levelConfig(level).count : kind === "spread" ? 12 : 2));
    assert.equal(root.querySelector(".game-details [data-goal]").dataset.goal, kind);
    assert.equal(root.querySelectorAll(kind === "spread" ? ".paint-target" : kind === "reveal" ? ".hidden-picture" : ".delivery-exit").length, floorCount);
    if (kind === "deliver") {
      const targets = [...root.querySelectorAll(".board .delivery-token")];
      assert.equal(targets.length, 2);
      for (const target of targets) {
        assert.ok(Number(target.closest(".cell").dataset.index) < 8);
        assert.ok(target.querySelector('[data-delivery-theme="egg"]'));
        assert.equal(target.querySelector("[data-animal]"), null);
      }
      assert.ok(root.querySelector('.mini-goal [data-delivery-theme="egg"]'));
      assert.ok(root.querySelector('.game-details [data-delivery-theme="egg"]'));
    }
    const snapshot = saved();
    act(() => render(null, root));
    root.remove();
    root = null;
    await mount(snapshot);
    assert.deepEqual(saved().adventure, adventure);
    assert.equal(root.querySelector(".mini-goal[data-goal]").dataset.goal, kind);
  });

test("legacy in-progress collection games migrate once without acquiring the new level objective", async () => {
  const adventure = createGame(2, false, seededRandom(42));
  delete adventure.objective;
  adventure.collected[1] = 6;
  await mount({ adventure });
  assert.equal(root.querySelector(".mini-goal[data-goal]").dataset.goal, "collect");
  assert.deepEqual(saved().adventure.objective, { kind: "collect" });
  assert.equal(saved().adventure.collected[1], 6);
  assert.deepEqual(saved().adventure.board, adventure.board);
});

for (const kind of ["spread", "reveal"])
  test(`${kind} floor updates during a clear, stays fixed, and saves only a settled board`, async () => {
    const adventure = patternedGame();
    adventure.objective = kind === "spread"
      ? { kind, cells: [0, 1, 2], painted: [0] }
      : { kind, groups: [{ cells: [0, 1, 8, 9], type: 3 }], revealed: [] };
    for (const index of [0, 1, 10]) adventure.board[index].type = 5;
    const oldRandom = Math.random;
    Math.random = seededRandom(73);
    try {
      await mount({ adventure });
      await click(piece(10));
      await click(piece(2));
      await until(() => root.querySelectorAll(".clearing").length > 0);
      if (kind === "spread") {
        assert.equal(root.querySelectorAll(".painted").length, 3);
        assert.match(root.querySelector(".mini-goal[data-goal]").getAttribute("aria-label"), /3 \/ 3/);
        assert.equal(root.querySelector(".mini-goal[data-goal] .goal-remaining").textContent, "0");
      } else assert.equal(root.querySelectorAll(".revealed").length, 2);
      assert.deepEqual(saved().adventure, adventure);
      await settled();
      const snapshot = saved();
      assert.notDeepEqual(snapshot.adventure.objective, adventure.objective);
      const floorClasses = [...root.querySelectorAll(".floor-cell")].map(node => node.className);
      await click(root.querySelectorAll(".tools button")[1]);
      assert.deepEqual([...root.querySelectorAll(".floor-cell")].map(node => node.className), floorClasses);
    } finally {
      Math.random = oldRandom;
    }
  });

test("cargo animates its arrival, updates the main goal live, refills and completes normally", async () => {
  const adventure = createRotatingGame(4, false, seededRandom(1));
  const template = patternedGame();
  adventure.board = template.board;
  adventure.iceGoal = 0;
  adventure.objective = { kind: "deliver", total: 1, delivered: 0, exits: [2] };
  for (const i of [48, 49, 58]) adventure.board[i].type = 5;
  adventure.board[50] = { ...adventure.board[50], kind: "delivery", type: null };
  adventure.score = levelConfig(4).target;
  const oldRandom = Math.random;
  Math.random = seededRandom(4);
  try {
    await mount({ adventure });
    await click(piece(50));
    await click(piece(58));
    await until(() => root.querySelector(".cell.clearing .delivery-token"));
    assert.match(root.querySelector(".mini-goal[data-goal]").getAttribute("aria-label"), /1 \/ 1/);
    assert.deepEqual(saved().adventure, adventure);
    await settled();
    assert.equal(saved().adventure.objective.delivered, 1);
    assert.equal(root.querySelectorAll(".board .delivery-token").length, 0);
    assert.equal(saved().adventure.status, "won");
    assert.equal(saved().adventure.moves, adventure.moves - 1);
  } finally {
    Math.random = oldRandom;
  }
});

test("a failed asynchronous read preserves progress and retries instead of creating level one", async () => {
  const native = globalThis.localStorage;
  const profile = { adventure: createGame(43, false, seededRandom(42)) };
  native.setItem(key, JSON.stringify(profile));
  let blocked = true;
  globalThis.localStorage = {
    getItem(name) { if (blocked) throw new Error('Platform read failed'); return native.getItem(name); },
    setItem(name, value) { return native.setItem(name, value); },
    removeItem(name) { return native.removeItem(name); },
  };
  try {
    await mount();
    assert.equal(root.querySelector('.board'), null);
    assert.match(root.querySelector('[role="alertdialog"]').textContent, /Platform read failed/);
    assert.equal(JSON.parse(native.getItem(key)).adventure.level, 43);
    blocked = false;
    await click(button('重试读取'));
    await act(flush);
    assert.match(root.querySelector('h1').textContent, /43/);
    assert.deepEqual(boardTypes(), profile.adventure.board.map(tile => tile.type));
  } finally { globalThis.localStorage = native; }
});

test("gameplay omits both navigation bars, while the level list restores them", async () => {
  await mount({ adventure: createGame(4, false, seededRandom(42)) });
  const original = saved().adventure;
  assert.equal(root.querySelector(".sidebar"), null);
  assert.equal(root.querySelector(".mobile-nav"), null);
  assert.ok(root.querySelector(".app-shell.in-level"));
  await showLevelList();
  assert.ok(root.querySelector(".sidebar"));
  assert.ok(root.querySelector(".mobile-nav"));
  assert.ok(root.querySelector(".app-shell.has-level-navigation"));
  await click(root.querySelector('[data-level="4"]'));
  assert.equal(root.querySelector(".sidebar"), null);
  assert.equal(root.querySelector(".mobile-nav"), null);
  assert.deepEqual(saved().adventure, original);
  await showLevelList();
  await click(root.querySelector('[aria-label="返回游戏"]'));
  assert.equal(root.querySelector(".level-selection"), null);
  assert.equal(root.querySelector(".sidebar"), null);
  assert.equal(root.querySelector(".mobile-nav"), null);
  assert.deepEqual(saved().adventure, original);
});

test("list settings, records and help close back to the list, including after a completed game", async () => {
  const adventure = createGame(4, false, seededRandom(42));
  adventure.status = "won";
  await mount({ adventure });
  await click(button("选择关卡") ?? button("返回选关"));
  assert.ok(root.querySelector(".level-selection"));
  await click(root.querySelector(".sidebar-setting"));
  assert.ok(root.querySelector(".modal-settings"));
  assert.ok(root.querySelector(".level-selection"));
  await click(button("玩法说明"));
  assert.ok(root.querySelector(".modal-help"));
  await click(root.querySelector('[aria-label="关闭弹窗"]'));
  assert.ok(root.querySelector(".level-selection"));
  assert.equal(root.querySelector('[role="dialog"]'), null);
  await click(button("统计"));
  assert.ok(root.querySelector(".modal-records"));
  act(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  await act(flush);
  assert.ok(root.querySelector(".level-selection"));
  assert.equal(root.querySelector('[role="dialog"]'), null);
});
