import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame, input, COLS, ROWS, inside } from "../games/bubble-kick/game.js";
import { movePlayer, playerCell } from "../games/bubble-kick/movement.js";
import { createRuntime } from "../scripts/lua-runtime.mjs";
const players = Array.from({ length: 4 }, (_, i) => ({
  id: `p${i}`,
  name: `P${i}`,
  bot: false,
}));
function game() {
  const s = createGame({ players });
  Object.assign(s.players[0], { x: 2, y: 3 });
  s.phase = "playing";
  s.tick = 31;
  s.players.forEach((p) => (p.immune = 10000));
  return s;
}
const ball = (x, y, id = 1) => ({ x, y, id, dir: -1, range: 3, fuse: 10000 });
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("motion covers equal fractional distances per 20 ms, turns immediately and does not snap when released", () => {
  const s = game(),
    p = s.players[0];
  input(s, 0, 0);
  for (let i = 1; i <= 8; i++) {
    stepGame(s, 20);
    close(p.x, 2 + i * 0.102);
    close(p.y, 3);
  }
  input(s, 0, 3);
  stepGame(s, 20);
  close(p.x, 2.816);
  close(p.y, 2.898);
  input(s, 0, -1);
  stepGame(s, 100);
  close(p.x, 2.816);
  close(p.y, 2.898);
  const a = game(),
    b = game();
  input(a, 0, 1);
  input(b, 0, 1);
  stepGame(a, 100);
  for (let i = 0; i < 5; i++) stepGame(b, 20);
  assert.deepEqual(a, b);
});
test("all four headings first slide clear of a shallow edge, then resume forward motion", () => {
  for (const [dir, x, y, sideX, sideY] of [
    [0, 2.025, 2.35, 2.025, 2.27],
    [2, 3.975, 2.35, 3.975, 2.27],
    [1, 2.35, 2.025, 2.27, 2.025],
    [3, 2.35, 3.975, 2.27, 3.975],
  ]) {
    const s = game(),
      p = s.players[0];
    Object.assign(p, { x, y });
    s.balls = [ball(3, 3)];
    movePlayer(s, p, dir, 20);
    close(p.x, sideX);
    close(p.y, sideY);
    for (let i = 0; i < 5; i++) movePlayer(s, p, dir, 20);
    if (dir % 2 === 0) {
      close(p.y, 2.025);
      assert.ok(dir === 0 ? p.x > x : p.x < x);
    } else {
      close(p.x, 2.025);
      assert.ok(dir === 1 ? p.y > y : p.y < y);
    }
    assert.equal(s.balls[0].x, 3);
    assert.equal(s.balls[0].y, 3);
  }
});
test("full obstruction stops; side assistance cannot pass through another obstacle or field boundary", () => {
  const s = game(),
    p = s.players[0];
  Object.assign(p, { x: 2.025, y: 3 });
  s.balls = [ball(3, 3), ball(3, 3, 2)];
  for (let i = 0; i < 20; i++) movePlayer(s, p, 0, 20);
  close(p.x, 2.025);
  close(p.y, 3);
  Object.assign(p, { x: 2.025, y: 2.35 });
  s.balls.push(ball(2, 2, 3));
  movePlayer(s, p, 0, 20);
  close(p.x, 2.025);
  close(p.y, 2.35);
  s.balls = [];
  Object.assign(p, { x: COLS - 1, y: 0 });
  movePlayer(s, p, 0, 20);
  close(p.x, COLS - 1);
  movePlayer(s, p, 3, 20);
  close(p.y, 0);
});
test("ball contact kicks without an action button and does not reset its countdown", () => {
  const s = game(),
    p = s.players[0];
  s.balls = [ball(3, 3)];
  input(s, 0, 0);
  assert.equal(s.balls[0].x, 3);
  stepGame(s, 20);
  close(p.x, 2.102);
  assert.equal(s.balls[0].x, 11);
  assert.ok(s.balls[0].flight);
  assert.equal(s.balls[0].owner, p.id);
  assert.equal(s.balls[0].fuse, 10000);
});
test("explosions and pickups use the closest cell; rescue keeps continuous positions", () => {
  const s = game(),
    p = s.players[0];
  Object.assign(p, { x: 5.49, y: 5.49, immune: 0 });
  s.blasts = [{ x: 5, y: 5, until: 100, id: 1 }];
  stepGame(s, 20);
  assert.equal(p.status, "bubble");
  close(p.x, 5.49);
  close(p.y, 5.49);
  const t = game(),
    q = t.players[0];
  Object.assign(q, { x: 5.51, y: 5.51, immune: 0 });
  t.blasts = s.blasts;
  stepGame(t, 20);
  assert.equal(q.status, "alive");
  assert.deepEqual(playerCell(q), { x: 6, y: 6 });
  Object.assign(q, { x: 4.49, y: 3.49 });
  t.items = [{ x: 4, y: 3 }];
  stepGame(t, 20);
  assert.equal(q.shield, true);
  close(q.x, 4.49);
  Object.assign(q, { x: 2.45, y: 3.45, status: "bubble", until: 100 });
  Object.assign(t.players[2], { x: 1.95, y: 3.1 });
  stepGame(t, 20);
  assert.equal(q.status, "alive");
  close(q.x, 2.45);
  close(q.y, 3.45);
});
test("Lua and local collision geometry agree for edge clearance, full blocks, turning and contact kicks", async () => {
  const runtime = await createRuntime("bubble-kick");
  try {
    for (const [x, y, balls, dir] of [
      [2.025, 2.35, [ball(3, 3)], 0],
      [3.975, 2.35, [ball(3, 3)], 2],
      [2.35, 2.025, [ball(3, 3)], 1],
      [2.35, 3.975, [ball(3, 3)], 3],
      [2.025, 3, [ball(3, 3), ball(4, 3, 2)], 0],
      [2, 3, [ball(3, 3)], 0],
    ]) {
      const s = game();
      Object.assign(s.players[0], { x, y });
      s.balls = balls;
      input(s, 0, dir);
      for (let i = 0; i < 8; i++) {
        const before = structuredClone(s),
          now = 10000 + i * 100;
        before.lastStepAt = now - 100;
        before.players.forEach((p) => {
          p.ready = true;
          p.lastSeen = now;
          p.seq = 0;
        });
        const result = await runtime.call(
          "on_action",
          before,
          { type: "input", round: 1, seq: 1, dir },
          { actor: { id: "p0", role: "player" }, actionAt: now },
        );
        stepGame(s);
        assert.equal(result.accepted, true);
        assert.equal(result.state.players[0].x, s.players[0].x);
        assert.equal(result.state.players[0].y, s.players[0].y);
        assert.equal(result.state.players[0].moving, s.players[0].moving);
        assert.deepEqual(
          Array.isArray(result.state.balls) ? result.state.balls : [],
          s.balls,
        );
      }
    }
  } finally {
    runtime.close();
  }
});

test("room catches up 800 ms with four moving players and twelve balls within the Lua budget", async () => {
  const runtime = await createRuntime("bubble-kick");
  try {
    const s = game();
    s.tick = 1000;
    s.lastStepAt = 10000;
    s.players.forEach((p) => {
      p.input = 0;
      p.ready = true;
      p.lastSeen = 10800;
      p.seq = 0;
    });
    s.balls = Array.from({ length: 12 }, (_, i) =>
      ball((i % 6) * 2, 4 + Math.floor(i / 6) * 3, i + 1),
    );
    const result = await runtime.call(
      "on_action",
      s,
      { type: "input", round: 1, seq: 1, dir: 0 },
      { actor: { id: "p0", role: "player" }, actionAt: 10800 },
    );
    assert.equal(result.accepted, true);
    assert.equal(result.state.tick, 1008);
  } finally {
    runtime.close();
  }
});
test("spatially indexed Lua sweeps match local geometry across fractional offsets and ball layouts", async () => {
  const runtime = await createRuntime("bubble-kick");
  let seed = 20803;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  try {
    for (let sample = 0; sample < 80; sample++) {
      const s = game(),
        dir = rand(4);
      s.players[0].x = rand((COLS - 1) * 1000 + 1) / 1000;
      s.players[0].y = rand((ROWS - 1) * 1000 + 1) / 1000;
      input(s, 0, dir);
      const used = new Set();
      while (s.balls.length < 10) {
        const x = rand(COLS),
          y = rand(ROWS),
          key = y * COLS + x;
        if (inside(x, y) && !used.has(key)) {
          used.add(key);
          s.balls.push(ball(x, y, s.balls.length + 1));
        }
      }
      const before = structuredClone(s);
      before.lastStepAt = 10000;
      before.players.forEach((p) => {
        p.ready = true;
        p.lastSeen = 10100;
        p.seq = 0;
      });
      const result = await runtime.call(
        "on_action",
        before,
        { type: "input", round: 1, seq: 1, dir },
        { actor: { id: "p0", role: "player" }, actionAt: 10100 },
      );
      stepGame(s);
      assert.equal(result.accepted, true);
      assert.equal(
        result.state.players[0].x,
        s.players[0].x,
        `sample ${sample} x`,
      );
      assert.equal(
        result.state.players[0].y,
        s.players[0].y,
        `sample ${sample} y`,
      );
      assert.deepEqual(result.state.balls, s.balls);
    }
  } finally {
    runtime.close();
  }
});
