import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame, blastCells, kickBall, random } from "../games/bubble-mischief-crew/game.js";
import { botInput } from "../games/bubble-mischief-crew/bot.js";
import { playerCell } from "../games/bubble-mischief-crew/movement.js";
import { createBotPlanner } from "../games/bubble-mischief-crew/bot-planning.js";

function playing() {
  const s = createGame({ humans: 4 });
  s.phase = "playing"; s.tick = 100; s.lastWaveAt = 1e6;
  return s;
}
function foam(s, x, y, until = s.tick + 5) {
  s.blasts = [{ x, y, until, atFrame: s.tick * 5 - 1, id: 1 }];
}
function walls(s, cells) {
  for (const [x, y] of cells) for (let copy = 0; copy < 2; copy++)
    s.balls.push({ id: s.nextId++, x, y, kind: "normal", fuse: 10000 });
}

test("short lookahead avoids a corridor whose next turn will explode", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, x: 3, y: 4 });
  walls(s, [[3, 3], [2, 4], [4, 5], [4, 2], [5, 5]]);
  s.balls.push({ id: s.nextId++, x: 6, y: 3, kind: "normal", fuse: 108 });
  botInput(s, p, blastCells, () => 0);
  assert.equal(p.input, 1, "choose the lower escape route instead of the tempting right corridor");
});

test("a boxed-in bot deliberately kicks a single ball to open a safe exit using real physics", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, x: 4, y: 4 });
  walls(s, [[3, 4], [4, 3], [4, 5]]);
  const ball = { id: s.nextId++, x: 5, y: 4, kind: "normal", fuse: 104 };
  s.balls.push(ball);
  const before = structuredClone(s.balls);
  botInput(s, p, blastCells, () => 0);
  assert.equal(p.input, 0);
  assert.deepEqual(s.balls, before, "planning must not move, kick or modify real balls");
  stepGame(s, 20);
  assert.ok(ball.flight, "held movement must actually kick the selected ball");
  assert.equal(ball.x, 11, "use native goal fallback rather than an imaginary landing");
  assert.ok(p.x > 4);
  assert.ok(!blastCells(ball, s.balls).some(c => c.x === 4 && c.y === 4));
});

test("stacked balls remain solid and a bot will not clear its exit by newly endangering a teammate", () => {
  for (const stacked of [true, false]) {
    const s = playing(), p = s.players[0];
    Object.assign(p, { bot: true, x: 4, y: 4 });
    Object.assign(s.players[2], { x: 11, y: 5 });
    walls(s, [[3, 4], [4, 3], [4, 5]]);
    s.balls.push({ id: s.nextId++, x: 5, y: 4, kind: "normal", fuse: 104 });
    if (stacked) s.balls.push({ id: s.nextId++, x: 5, y: 4, kind: "normal", fuse: 104 });
    const before = structuredClone(s.balls);
    botInput(s, p, blastCells, () => 0);
    assert.equal(p.input, -1, stacked ? "stack cannot be kicked" : "landing threatens teammate");
    assert.deepEqual(s.balls, before);
  }
});

test("clearance planning rejects a ball that would explode before the bot could reach its kick probe", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, x: 3.6, y: 4 });
  walls(s, [[3, 4], [4, 3], [4, 5]]);
  s.balls.push({ id: s.nextId++, x: 5, y: 4, kind: "normal", fuse: 100.4, fuseFrame: 502 });
  botInput(s, p, blastCells, () => 0);
  assert.equal(p.input, -1, "do not plan an impossible last-moment kick");
  assert.ok(s.balls.every(b => !b.flight));
});

test("forecast waits for natural flight landing but propagates earlier chain explosions", () => {
  const s = playing(), p = s.players[0];
  const ball = { id: 1, x: 6, y: 4, kind: "football", fuse: 99,
    flight: { x: 1, y: 4, start: 500, end: 520 } };
  s.balls = [ball];
  const plan = () => createBotPlanner(s, p, s.balls, blastCells, new Set(), false).original;
  assert.equal(plan().danger(6, 4, 100), false, "expired airborne fuse is deferred until landing");
  assert.equal(plan().danger(6, 4, 104), true);
  s.balls.push({ id: 2, x: 6, y: 5, kind: "normal", fuse: 101 });
  assert.equal(plan().danger(6, 4, 101), true, "chain can detonate an airborne ball immediately");
});

function incoming(moving = false) {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, x: 4, y: 4, input: 0, moving });
  s.balls = [{ id: 1, x: 7, y: 4, kind: "football", fuse: 108, owner: "local-1",
    flight: { x: 1, y: 4, start: 500, end: 520, distance: 6 } }];
  return { s, p };
}
function observe({ s, p }, elapsed, rng = () => 0) {
  s.tick = 100 + Math.floor(elapsed / 100);
  s.substep = elapsed % 100 / 20;
  for (const b of s.balls) if (b.flight?.end <= s.tick * 5 + s.substep) delete b.flight;
  const seen = new Set();
  botInput(s, p, (b, balls) => {
    seen.add(b.id);
    return blastCells(b, balls);
  }, rng);
  return seen;
}

test("incoming kick awareness takes 260–400 ms at rest and 400–640 ms while moving, without stopping roaming", () => {
  for (const [moving, delay, rng] of [
    [false, 260, () => 0], [false, 400, (_s, n) => n - 1],
    [true, 400, () => 0], [true, 640, (_s, n) => n - 1],
  ]) {
    const fixture = incoming(moving);
    for (let elapsed = 0; elapsed < delay; elapsed += 20) {
      assert.equal(observe(fixture, elapsed, rng).size, 0, `${moving}, ${elapsed}: premature prediction`);
      assert.equal(fixture.p.input, 0, "unnoticed landing must not change the open-field roaming choice");
    }
    assert.ok(observe(fixture, delay, rng).has(1));
    assert.notEqual(fixture.p.input, 0, "react on recognition, even between the 200 ms steering decisions");
  }
});

test("landing and coming to rest do not restart or shorten a moving bot's pending observation", () => {
  const fixture = incoming(true), latest = (_s, n) => n - 1;
  observe(fixture, 0, latest);
  fixture.p.moving = false;
  for (let elapsed = 20; elapsed < 640; elapsed += 20)
    assert.equal(observe(fixture, elapsed, latest).size, 0);
  assert.equal(fixture.s.balls[0].flight, undefined, "ball has already landed");
  assert.ok(observe(fixture, 640, latest).has(1));
  assert.ok(observe(fixture, 800, latest).has(1), "recognized ball stays under observation");
});

test("pending landing is absent from occupancy and blast-blocking predictions as well as danger scoring", () => {
  const fixture = incoming(), { s, p } = fixture;
  Object.assign(s.balls[0], { x: 5, y: 4, fuse: 10000 });
  observe(fixture, 0);
  assert.equal(p.input, 0, "the unknown landing must not block the chosen adjacent cell");
  s.balls.push({ id: 2, x: 7, y: 4, kind: "football", fuse: 108 });
  const blockers = [];
  botInput(s, p, (b, balls) => {
    blockers.push(...balls.map(ball => ball.id));
    return blastCells(b, balls);
  }, () => 0);
  assert.ok(blockers.includes(2));
  assert.ok(!blockers.includes(1), "an unnoticed ball must not secretly alter predicted blast arms");
});

test("each bot notices independently, and only a new kick starts a fresh observation", () => {
  const fixture = incoming(), { s, p } = fixture, q = s.players[2];
  Object.assign(q, { bot: true, x: 4, y: 4, input: 0, moving: true });
  observe(fixture, 0);
  observe({ s, p: q }, 0);
  assert.ok(observe(fixture, 260).has(1));
  assert.equal(observe({ s, p: q }, 260).size, 0);
  assert.ok(observe({ s, p: q }, 400).has(1));
  assert.ok(observe(fixture, 400).has(1));
  s.balls[0].flight = { x: 7, y: 4, start: 522, end: 542, distance: 1 };
  assert.equal(observe(fixture, 440).size, 0);
  assert.equal(observe(fixture, 680).size, 0);
  assert.ok(observe(fixture, 700).has(1));
  assert.equal(p.moving, false);
});

test("self-directed kicks are known immediately, while perception RNG and pending timers survive replay", () => {
  const own = incoming();
  own.s.balls[0].owner = own.p.id;
  assert.ok(observe(own, 0).has(1));
  const fixture = incoming(true), seed = fixture.s.seed;
  // Begin between steering decisions so only perception runs.
  observe(fixture, 20, random);
  assert.equal(fixture.s.seed, seed, "noticing a kick must not consume the world/roaming RNG");
  const copy = structuredClone(fixture.s), cloned = { s: copy, p: copy.players[0] };
  for (let elapsed = 40; elapsed <= 800; elapsed += 20) {
    assert.deepEqual(observe(fixture, elapsed, random), observe(cloned, elapsed, random));
    assert.deepEqual(fixture.s, cloned.s);
  }
});

test("an actual incoming kick leaves moving bot steering unchanged throughout the first 380 ms", () => {
  const s = playing(), p = s.players[0], kicker = s.players[1];
  Object.assign(p, { bot: true, x: 6, y: 4, moving: true, input: 0 });
  Object.assign(kicker, { x: 10, y: 4, dir: 0 });
  const baseline = structuredClone(s);
  s.balls = [{ id: 1, x: 11, y: 4, kind: "football", fuse: 108 }];
  assert.ok(kickBall(s, kicker));
  assert.equal(s.balls[0].x, 4);
  for (let elapsed = 20; elapsed < 400; elapsed += 20) {
    stepGame(s, 20);
    stepGame(baseline, 20);
    const q = baseline.players[0];
    assert.deepEqual({ x: p.x, y: p.y, input: p.input }, { x: q.x, y: q.y, input: q.input });
  }
});

test("bots roam across open space instead of camping at a safe cell", () => {
  for (const seed of [17, 7919, 15838, 23757]) {
    const s = createGame({ seed, humans: 0 });
    s.tick = 100; s.phase = "playing"; s.lastWaveAt = 1e6;
    const visited = s.players.map(() => new Set());
    const moving = s.players.map(() => 0);
    for (let frame = 0; frame < 1000; frame++) {
      stepGame(s, 20);
      s.players.forEach((p, index) => {
        const cell = playerCell(p);
        visited[index].add(`${cell.x},${cell.y}`);
        if (p.moving) moving[index]++;
      });
    }
    for (let index = 0; index < s.players.length; index++) {
      assert.ok(visited[index].size >= 12, `seed ${seed}, bot ${index}: did not explore`);
      assert.ok(moving[index] >= 750, `seed ${seed}, bot ${index}: stood still too much`);
    }
  }
});

test("fresh explosions interrupt held bot movement between steering decisions, at every shoe speed", () => {
  for (const [dir, x, y] of [[0, 4.45, 4], [1, 5, 3.45], [2, 5.55, 4], [3, 5, 4.55]]) {
    for (const shoes of [0, 1, 2, 3]) {
      const s = playing(), p = s.players[0];
      Object.assign(p, { bot: true, input: dir, x, y, shoes });
      foam(s, 5, 4);
      stepGame(s, 20); // No scheduled 200 ms decision occurs on this frame.
      assert.notDeepEqual(playerCell(p), { x: 5, y: 4 });
      assert.equal(p.x, x);
      assert.equal(p.y, y);
    }
  }
});

test("bot steering avoids even the final frames of visible foam, then uses the opening after it clears", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, x: 4, y: 4 });
  // The only open exit is right. Arrival-time-only checks incorrectly enter
  // this animation once less than 200 ms remain.
  // Stacks make these actual walls even with deliberate clearance kicks.
  walls(s, [[3, 4], [4, 3], [4, 5]]);
  foam(s, 5, 4, s.tick + .6);
  botInput(s, p, blastCells, random);
  assert.equal(p.input, -1);
  s.tick += 2; s.blasts = [];
  botInput(s, p, blastCells, random);
  assert.equal(p.input, 0);
});

test("the bot guard also prevents edge assistance from sliding into fresh foam", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, input: 0, x: 2.025, y: 2.5 });
  s.balls = [1, 2].map(id => ({ id, x: 3, y: 3, kind: "normal", fuse: 10000 }));
  foam(s, 2, 2);
  const balls = structuredClone(s.balls);
  stepGame(s, 20);
  assert.equal(p.x, 2.025);
  assert.equal(p.y, 2.5);
  assert.deepEqual(s.balls, balls, "the preview must not kick or mutate real balls");
});

test("bots already inside visible foam can walk out without being pinned by the guard", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, input: 0, x: 5.45, y: 4 });
  foam(s, 5, 4);
  stepGame(s, 20);
  assert.equal(p.status, "alive");
  assert.deepEqual(playerCell(p), { x: 6, y: 4 });
});

test("foam avoidance changes only bot intent, retaining human movement and impact-only damage", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { input: 0, x: 4.45, y: 4 });
  foam(s, 5, 4);
  stepGame(s, 20);
  assert.equal(p.status, "alive");
  assert.deepEqual(playerCell(p), { x: 5, y: 4 });
  assert.equal(s.blasts[0].until, 105);
});
