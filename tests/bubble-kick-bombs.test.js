import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame, kickBall, blastCells } from "../games/bubble-kick/game.js";
import { inside, COLS, ROWS } from "../games/bubble-kick/arena.js";
import { BOMB, bombRange, kickLanding } from "../games/bubble-kick/bomb-rules.js";
import { createRuntime } from "../scripts/lua-runtime.mjs";

function game(tick = 31) {
  const s = createGame({ humans: 4, seed: 1234 });
  s.tick = tick;
  s.phase = "playing";
  s.players.forEach((p) => { p.immune = 10000; });
  return s;
}
const ball = (id, x, y, kind = "normal", fuse = 100) =>
  ({ id, x, y, kind, range: bombRange(kind), fuse, dir: -1 });

test("eight-cell kicks wrap the native map and shorten toward the source when walls or goals block the target", () => {
  for (const [x, y, dir, target] of [
    [3, 4, 0, [11, 4]], [11, 4, 2, [3, 4]],
    [5, 0, 1, [5, 8]], [5, 8, 3, [5, 0]],
    [12, 2, 0, [5, 2]], [0, 2, 2, [7, 2]],
    [5, 8, 1, [5, 3]], [5, 0, 3, [5, 5]],
    [7, 4, 0, [11, 4]], [5, 4, 2, [1, 4]],
    [0, 1, 1, [0, 8]], [0, 7, 3, [0, 0]],
  ]) assert.deepEqual(kickLanding(x, y, dir), { x: target[0], y: target[1] });
  for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) {
    if (!inside(x, y)) continue;
    for (let dir = 0; dir < 4; dir++) {
      const target = kickLanding(x, y, dir);
      assert.ok(inside(target.x, target.y), `invalid landing from ${x},${y} dir ${dir}`);
      assert.equal(dir % 2 ? target.x : target.y, dir % 2 ? x : y);
    }
  }
});

test("normal and football bubbles have fixed one/four-cell crosses, clipped at field edges", () => {
  for (const [kind, range] of [["normal", 1], ["football", 4]]) {
    const cells = blastCells(ball(1, 6, 4, kind));
    assert.equal(cells.length, 1 + 4 * range);
    assert.ok(cells.every((c) => c.x === 6 || c.y === 4));
    assert.ok(!cells.some((c) => Math.abs(c.x - 6) + Math.abs(c.y - 4) > range));
    assert.equal(blastCells(ball(1, 0, 0, kind)).length, 1 + range + Math.min(range, 2));
  }
});

test("airborne balls ignore lingering foam and defer an overdue natural fuse until landing", () => {
  const s = game(), p = s.players[0];
  Object.assign(p, { x: 2, y: 2, dir: 0 });
  s.balls = [ball(1, 3, 2, "football", 32)];
  kickBall(s, p);
  s.blasts = [{ x: 11, y: 2, until: 34, id: 9 }];
  stepGame(s, 300);
  assert.equal(s.balls.length, 1);
  assert.equal(s.balls[0].fuse, 32);
  assert.ok(s.balls[0].flight);
  assert.ok(!s.blasts.some((b) => b.id === 1));
  stepGame(s, 100);
  assert.equal(s.balls.length, 0);
  assert.ok(s.blasts.some((b) => b.x === 11 && b.y === 2 && b.id === 1));
  assert.ok(!s.blasts.some((b) => b.x === 3 && b.y === 2));
});

test("occupied landing cells form immovable stacks with the union of their blast ranges", () => {
  const s = game(), p = s.players[0];
  Object.assign(p, { x: 2, y: 2, dir: 0 });
  s.balls = [ball(1, 3, 2, "football"), ball(2, 11, 2)];
  assert.equal(kickBall(s, p), true);
  stepGame(s, 400);
  Object.assign(p, { x: 10, y: 2 });
  assert.equal(kickBall(s, p), false);
  assert.equal(s.balls.length, 2);
  s.balls[1].fuse = s.tick + 1;
  stepGame(s);
  assert.equal(s.balls.length, 0);
  const cells = new Set(s.blasts.map((c) => `${c.x},${c.y}`));
  assert.equal(cells.size, blastCells(ball(1, 11, 2, "football")).length);
});

test("falling waves keep occupied targets and land the correct bubble type", () => {
  const s = game();
  s.balls = [ball(1, 5, 5)];
  s.drops = [{ id: 2, x: 5, y: 5, kind: "football", fromX: 2, start: 30, at: 32 }];
  stepGame(s);
  assert.equal(s.balls.length, 2);
  assert.equal(s.balls[1].range, 4);
  assert.equal(s.balls[1].fuse, 32 + BOMB.fuseFrames / 5);

});

test("Lua and local rules agree through flight, occupied landings, stacked drops and chain explosions", async () => {
  const runtime = await createRuntime("bubble-kick");
  try {
    const s = game();
    Object.assign(s.players[0], { x: 2, y: 2, input: 0 });
    s.balls = [ball(1, 3, 2, "football", 42), ball(2, 11, 2)];
    s.drops = [{ id: 3, x: 11, y: 2, kind: "normal", fromX: 2, start: 31, at: 38 }];
    s.nextId = 4;
    for (let i = 0; i < 20; i++) {
      const before = structuredClone(s), now = 10000 + i * 100;
      before.lastStepAt = now - 100;
      before.players.forEach((p) => { p.lastSeen = now; p.ready = true; p.seq = 0; });
      const result = await runtime.call("on_action", before,
        { type: "input", round: 1, seq: 1, dir: 0 },
        { actor: { id: "local-0", role: "player" }, actionAt: now });
      stepGame(s);
      assert.equal(result.accepted, true);
      for (const key of ["balls", "blasts", "drops"]) {
        const actual = result.state[key];
        assert.deepEqual(Array.isArray(actual) ? actual : [], s[key], `step ${i}: ${key}`);
      }
    }
  } finally { runtime.close(); }
});
