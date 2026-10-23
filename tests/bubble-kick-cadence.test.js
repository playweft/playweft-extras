import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame, COLS, ROWS, inside } from "../games/bubble-kick/game.js";
import {
  airborneElapsed, airborneInterval, airborneCounts, simulationFrame,
} from "../games/bubble-kick/bomb-rules.js";
import { createRuntime } from "../scripts/lua-runtime.mjs";

function game() {
  const s = createGame({ humans: 4, seed: 1234 });
  s.tick = 30;
  s.phase = "playing";
  s.players.forEach((p) => { p.immune = 10000; });
  return s;
}

test("native interval is retained while both type counts increase by 50% from opening through the cap", () => {
  for (const [elapsed, interval] of [[0, 9000], [5000, 8375], [16000, 7000], [32000, 5000], [40000, 4000], [180000, 4000]])
    assert.equal(airborneInterval(elapsed), interval);
  for (const [elapsed, normal, football] of [[0, 8, 2], [15999, 8, 2], [16000, 9, 3], [32000, 11, 5], [144000, 21, 15], [160000, 23, 15], [180000, 23, 15], [240000, 23, 15]])
    assert.deepEqual(airborneCounts(elapsed), { normal, football });
});

test("whole-wave timestamps follow the continuously checked threshold, then stay four seconds apart", () => {
  const s = game(), waves = [];
  for (let i = 0; i < 8500; i++) {
    const before = s.lastWaveAt;
    stepGame(s, 20);
    if (before === s.lastWaveAt) continue;
    const batch = s.drops.filter((d) => d.start === simulationFrame(s) / 5);
    const counts = airborneCounts(s.lastWaveAt);
    assert.equal(batch.filter((d) => d.kind === "normal").length, counts.normal);
    assert.equal(batch.filter((d) => d.kind === "football").length, counts.football);
    assert.equal(new Set(batch.map((d) => d.y * COLS + d.x)).size, batch.length);
    assert.ok(batch.every((d) => d.x >= 0 && d.x < COLS && d.y >= 0 && d.y < ROWS));
    waves.push({ at: s.lastWaveAt, count: batch.length });
  }
  assert.deepEqual(waves.slice(0, 12).map((w) => w.at), [
    5000, 12460, 19080, 24960, 30200, 34860, 39000, 43000, 47000, 51000, 55000, 59000,
  ]);
  for (let i = 7; i < waves.length; i++)
    assert.equal(waves[i].at - waves[i - 1].at, 4000);
  assert.equal(waves.at(-1).count, 38);
});

test("scene clock includes Ready/Go, freezes on pause, and is independent of batch size", () => {
  const s = createGame({ humans: 4 });
  s.players.forEach((p) => { p.immune = 10000; });
  stepGame(s, 3000);
  assert.equal(airborneElapsed(s), 3000);
  assert.equal(s.lastWaveAt, -1);
  assert.equal(s.drops.length, 0);
  stepGame(s, 1980);
  s.phase = "paused";
  const frozen = structuredClone(s);
  stepGame(s, 60000);
  assert.deepEqual(s, frozen);
  s.phase = "playing";
  stepGame(s, 20);
  assert.equal(s.lastWaveAt, 5000);
  assert.equal(s.drops.length, 10);
  const batched = structuredClone(s), fine = structuredClone(s);
  for (let i = 0; i < 100; i++) stepGame(batched, 100);
  for (let i = 0; i < 500; i++) stepGame(fine, 20);
  assert.deepEqual(batched, fine);
});

test("Lua dispatches the same whole batches, including waves between logical ticks and capped late waves", async () => {
  const runtime = await createRuntime("bubble-kick");
  try {
    for (const [tick, lastWaveAt, expected] of [
      [49, -1, 5000], [124, 5000, 12460], [429, 39000, 43000], [1629, 159000, 163000],
    ]) {
      const s = game();
      Object.assign(s, { tick, lastWaveAt });
      // A wave may target an existing bubble; occupied cells are not filtered.
      s.balls = Array.from({ length: COLS * ROWS }, (_, i) => ({
        id: i + 1, x: i % COLS, y: Math.floor(i / COLS), kind: "normal", range: 1, fuse: 10000, dir: -1,
      })).filter(b => inside(b.x, b.y));
      s.nextId = COLS * ROWS + 1;
      const before = structuredClone(s);
      before.lastStepAt = 10000;
      before.players.forEach((p) => { p.lastSeen = 10100; p.ready = true; p.seq = 0; });
      const result = await runtime.call("on_action", before,
        { type: "input", dir: -1, seq: 1, round: 1 },
        { actor: { id: "local-0", role: "player" }, actionAt: 10100 });
      stepGame(s);
      assert.equal(result.accepted, true);
      assert.equal(s.lastWaveAt, expected);
      assert.equal(result.state.lastWaveAt, expected);
      assert.deepEqual(result.state.drops, s.drops);
      assert.equal(result.state.seed, s.seed);
      assert.equal(result.state.nextId, s.nextId);
    }
  } finally { runtime.close(); }
});

test("a capped 38-bubble batch can chain-explode during room catch-up within the Lua instruction budget", async () => {
  const runtime = await createRuntime("bubble-kick");
  try {
    const s = game();
    Object.assign(s, { tick: 1700, lastWaveAt: 166000, lastStepAt: 10000, nextId: 39 });
    s.players.forEach((p) => { p.ready = true; p.lastSeen = 10800; p.seq = 0; });
    s.balls = Array.from({ length: 38 }, (_, i) => ({
      id: i + 1, x: 3 + i % 7, y: 1 + Math.floor(i / 7),
      kind: i < 23 ? "normal" : "football", range: i < 23 ? 1 : 4,
      dir: -1, fuse: i === 0 ? 1701 : 1800,
    }));
    const result = await runtime.call("on_action", structuredClone(s),
      { type: "input", dir: -1, seq: 1, round: 1 },
      { actor: { id: "local-0", role: "player" }, actionAt: 10800 });
    stepGame(s, 800);
    assert.equal(result.accepted, true);
    assert.equal(result.state.tick, 1708);
    assert.deepEqual(Array.isArray(result.state.balls) ? result.state.balls : [], s.balls);
    assert.deepEqual(Array.isArray(result.state.blasts) ? result.state.blasts : [], s.blasts);
  } finally { runtime.close(); }
});
