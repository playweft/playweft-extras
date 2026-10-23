import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  input,
  stepGame,
  kickBall,
  blastCells,
  COLS, ROWS,
} from "../games/bubble-kick/game.js";
import { createRuntime } from "../scripts/lua-runtime.mjs";
const players = Array.from({ length: 4 }, (_, i) => ({
  id: `p${i}`,
  name: `Player ${i}`,
  bot: false,
}));
function game() {
  const s = createGame({ players, seed: 1234 });
  s.tick = 31;
  s.phase = "playing";
  return s;
}
function ball(x, y, extra = {}) {
  return { x, y, id: 1, fuse: 100, range: 3, dir: -1, ...extra };
}

test("kicks fly eight cells, cross intervening balls and keep the original fuse", () => {
  const s = game(), p = s.players[0];
  Object.assign(p, { x: 2, y: 2, dir: 0 });
  s.balls = [ball(3, 2), ball(4, 2, { id: 2 })];
  assert.equal(kickBall(s, p), true);
  assert.equal(s.balls[0].x, 11);
  assert.equal(s.balls[0].dir, 0);
  assert.equal(s.balls[0].fuse, 100);
  assert.deepEqual(s.balls[0].flight, { distance: 8, x: 3, y: 2, start: 155, end: 175 });
  stepGame(s, 400);
  assert.equal(s.balls[0].x, 11);
  assert.equal(s.balls[0].flight, undefined);
  assert.equal(s.balls[0].dir, -1);
  stepGame(s);
  assert.equal(s.balls[0].x, 11);
});
test("cross explosions chain within the same tick, without diagonal damage", () => {
  const s = game();
  s.players.forEach((p) => (p.immune = 1000));
  s.balls = [
    ball(5, 5, { fuse: 32 }),
    ball(8, 5, { id: 2 }),
    ball(6, 6, { id: 3 }),
  ];
  stepGame(s);
  assert.deepEqual(
    s.balls.map((b) => b.id),
    [3],
  );
  assert.ok(s.blasts.some((b) => b.x === 11 && b.y === 5));
  assert.ok(!s.blasts.some((b) => b.x === 6 && b.y === 6));
  assert.equal(blastCells(ball(0, 0)).length, 6);
});
test("teammate rescues, enemy eliminates, and simultaneous exposure cannot rescue", () => {
  const s = game(),
    p = s.players[0],
    friend = s.players[2];
  p.status = "bubble";
  p.until = 100;
  friend.x = p.x;
  friend.y = p.y;
  const rescuedAt = s.tick;
  stepGame(s);
  assert.equal(p.status, "alive");
  assert.equal(p.immune, rescuedAt + 12);
  p.status = "bubble";
  p.until = 100;
  s.players[1].x = p.x;
  s.players[1].y = p.y;
  stepGame(s);
  assert.equal(p.status, "out");
  const t = game();
  t.players[2].x = t.players[0].x;
  t.players[2].y = t.players[0].y;
  t.balls = [ball(t.players[0].x, t.players[0].y, { fuse: 32 })];
  stepGame(t);
  assert.equal(t.players[0].status, "bubble");
  assert.equal(t.players[2].status, "bubble");
});
test("shield absorbs one blast, rescue immunity prevents repeated immediate exposure", () => {
  const s = game(),
    p = s.players[0];
  p.shield = true;
  s.blasts = [{ x: p.x, y: p.y, until: 40, id: 1 }];
  stepGame(s);
  assert.equal(p.status, "alive");
  assert.equal(p.shield, false);
  stepGame(s);
  assert.equal(p.status, "alive");
});
test("expiry ends the round, simultaneous elimination and timeout draw, ended state is frozen", () => {
  const s = game();
  for (const p of s.players.filter((p) => p.team === 1)) {
    p.status = "bubble";
    p.until = 32;
  }
  stepGame(s);
  assert.equal(s.phase, "ended");
  assert.equal(s.winner, 0);
  assert.equal(s.scores[0], 1);
  const snapshot = JSON.stringify(s);
  stepGame(s);
  assert.equal(JSON.stringify(s), snapshot);
  const t = game();
  t.players.forEach((p) => {
    p.status = "bubble";
    p.until = 32;
  });
  stepGame(t);
  assert.equal(t.winner, -1);
  const u = game();
  u.tick = 2399;
  stepGame(u);
  assert.equal(u.phase, "ended");
  assert.equal(u.winner, -1);
});
test("seeded bots finish a match, remain in bounds and can be replayed deterministically", () => {
  const a = createGame({ seed: 17, humans: 0 }),
    b = createGame({ seed: 17, humans: 0 });
  for (let i = 0; i < 2405; i++) {
    stepGame(a);
    stepGame(b);
    for (const p of a.players)
      assert.ok(p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS);
  }
  assert.deepEqual(a, b);
  assert.equal(a.phase, "ended");
});
const normalize = (v) =>
  Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]))
      : v;
function comparable(s) {
  return {
    tick: s.tick,
    substep: s.substep,
    phase: s.phase,
    winner: s.winner,
    seed: s.seed,
    lastWaveAt: s.lastWaveAt,
    scores: s.scores,
    balls: Array.isArray(s.balls) ? s.balls : [],
    blasts: Array.isArray(s.blasts) ? s.blasts : [],
    drops: Array.isArray(s.drops) ? s.drops : [],
    items: Array.isArray(s.items) ? s.items : [],
    traps: (Array.isArray(s.traps) ? s.traps : []).map(t => ({ ...t, passableBy: Array.isArray(t.passableBy) ? t.passableBy : [] })),
    itemDrops: Array.isArray(s.itemDrops) ? s.itemDrops : [],
    recycled: Array.isArray(s.recycled) ? s.recycled : [],
    itemStock: s.itemStock,
    lastRecycleAt: s.lastRecycleAt,
    players: s.players.map(
      ({ x, y, dir, status, until, immune, shield, moving, inventory, shoes, slowUntil, slideDir }) => ({
        x,
        y,
        dir,
        status,
        until,
        immune,
        shield,
        moving, inventory: Array.isArray(inventory) ? inventory : [], shoes, slowUntil, slideDir,
      }),
    ),
  };
}

test("rescue and enemy contact use a 0.75-cell circle across grid boundaries, identically in Lua", async () => {
  const runtime = await createRuntime("bubble-kick");
  const cases = [
    { origin: [5.49, 5], offset: [0.02, 0], contact: true },
    { origin: [5, 5], offset: [0.75, 0], contact: true },
    { origin: [5, 5], offset: [-0.75, 0], contact: true },
    { origin: [5, 5], offset: [0, 0.75], contact: true },
    { origin: [5, 5], offset: [0, -0.75], contact: true },
    { origin: [5, 5], offset: [0.751, 0], contact: false },
    { origin: [5, 5], offset: [0, -0.751], contact: false },
    { origin: [5, 5], offset: [0.45, 0.6], contact: true },
    { origin: [5, 5], offset: [0.451, 0.6], contact: false },
    { origin: [5, 5], offset: [0.6, 0.6], contact: false },
    { origin: [4.51, 4.51], offset: [0.98, 0.98], contact: false },
  ];
  try {
    for (const actor of [1, 2]) for (const { origin, offset, contact } of cases) {
      const s = game(), p = s.players[0], q = s.players[actor];
      Object.assign(p, { x: origin[0], y: origin[1], status: "bubble", until: 100 });
      Object.assign(q, { x: p.x + offset[0], y: p.y + offset[1] });
      const before = structuredClone(s);
      before.lastStepAt = 10000;
      before.players.forEach(p => { p.lastSeen = 10100; p.ready = true; p.seq = 0; });
      const result = await runtime.call("on_action", before,
        { type: "input", round: 1, seq: 1, dir: -1 },
        { actor: { id: "p0", role: "player" }, actionAt: 10100 });
      stepGame(s);
      const expected = contact ? (actor === 2 ? "alive" : "out") : "bubble";
      assert.equal(p.status, expected, `actor ${actor}, offset ${offset}`);
      assert.equal(result.accepted, true);
      assert.deepEqual(comparable(result.state), comparable(s));
    }
  } finally { runtime.close(); }
});

test("distance contact is checked during movement and enemies take priority over a nearby rescuer", () => {
  for (const actor of [1, 2]) {
    const s = game(), p = s.players[0], q = s.players[actor];
    Object.assign(p, { x: 5, y: 5, status: "bubble", until: 100 });
    Object.assign(q, { x: 6, y: 5, input: 2 });
    stepGame(s, 40);
    assert.equal(p.status, "bubble");
    stepGame(s, 20);
    assert.equal(p.status, actor === 2 ? "alive" : "out");
  }
  const s = game(), p = s.players[0];
  Object.assign(p, { x: 5, y: 5, status: "bubble", until: 100 });
  Object.assign(s.players[1], { x: 5.6, y: 5 });
  Object.assign(s.players[2], { x: 4.4, y: 5 });
  stepGame(s, 20);
  assert.equal(p.status, "out");
});

test("Lua room rules match local human rules across a full seeded match, within runtime fuel limits", async () => {
  const r = await createRuntime("bubble-kick");
  try {
    let s = game();
    s.players.forEach((p) => (p.immune = 10000));
    for (let tick = 32; tick <= 2400; tick++) {
      const before = structuredClone(s),
        now = 10000 + tick * 100;
      before.lastStepAt = now - 100;
      before.players.forEach((p) => {
        p.lastSeen = now;
        p.ready = true;
        p.seq = 0;
      });
      const dir = tick % 31 === 0 ? tick % 4 : -1;
      input(s, 0, dir);
      before.players[0].input = dir;
      const result = await r.call(
        "on_action",
        before,
        { type: "input", round: 1, seq: 1, dir },
        { actor: { id: "p0", role: "player" }, actionAt: now },
      );
      stepGame(s);
      assert.equal(result.accepted, true);
      assert.deepEqual(
        normalize(comparable(result.state)),
        normalize(comparable(s)),
        `tick ${tick}`,
      );
    }
  } finally {
    r.close();
  }
});
test("room validates actor, round, input, sequence; pauses on silence and requires all rematch votes", async () => {
  const r = await createRuntime("bubble-kick");
  try {
    let s = (await r.call("setup", { players, serverTime: 1000 })).state;
    const act = (action, actor = { id: "p0", role: "player" }, now = 1000) =>
      r.call("on_action", s, action, { actor, actionAt: now });
    const a = { type: "input", round: 1, seq: 1, dir: -1, kick: false };
    assert.equal(
      (await act(a, { id: "watch", role: "spectator" })).error.code,
      "SPECTATOR",
    );
    assert.equal((await act({ ...a, round: 0 })).error.code, "STALE_ROUND");
    for (const invalid of [{ dir: 9 }, { dir: 0.2 }, { seq: 0 }, { kick: 1 }])
      assert.equal(
        (await act({ ...a, ...invalid })).error.code,
        "INVALID_INPUT",
      );
    for (let i = 0; i < 4; i++)
      s = (await act(a, { id: `p${i}`, role: "player" })).state;
    assert.equal(s.phase, "countdown");
    assert.equal(s.resumeAt, 4000);
    s = (await act({ ...a, seq: 2 }, { id: "p0", role: "player" }, 6000)).state;
    assert.equal(s.phase, "paused");
    assert.equal(s.tick, 0);
    s.phase = "ended";
    s.lastWaveAt = 12000;
    s.winner = 0;
    s.scores = [1, 0];
    for (let i = 0; i < 3; i++)
      s = (
        await act(
          { type: "rematch", round: 1 },
          { id: `p${i}`, role: "player" },
          6100,
        )
      ).state;
    assert.equal(s.round, 1);
    s = (
      await act(
        { type: "rematch", round: 1 },
        { id: "p3", role: "player" },
        6100,
      )
    ).state;
    assert.equal(s.round, 2);
    assert.equal(s.phase, "waiting");
    assert.equal(s.lastWaveAt, -1);
    assert.deepEqual(s.scores, [1, 0]);
    const departed = await r.call("on_player_left", s, { actor: { id: "p0" } });
    assert.equal(departed.state.phase, "closed");
  } finally {
    r.close();
  }
});
