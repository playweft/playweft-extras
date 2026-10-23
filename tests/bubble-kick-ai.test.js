import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame, blastCells, LIMIT } from "../games/bubble-kick/game.js";
import { forecast } from "../games/bubble-kick/bot.js";
import { simulationFrame } from "../games/bubble-kick/bomb-rules.js";
import { measureSurvival } from "../scripts/bubble-kick-ai.mjs";

test("unopposed AI survives at least 75% of a round across seeds and all four starting seats", () => {
  for (let i = 0; i < 64; i++) {
    const seed = (i + 1) * 7919, seat = i % 4;
    assert.ok(measureSurvival(seed, LIMIT / 10 * .75, seat) >= 180,
      `seed ${seed}, seat ${seat}: captured before 180 seconds`);
  }
});

test("AI opens sealed late-wave pockets with kicks, including pockets that need two kicks", () => {
  for (const [seed, seat] of [[82547656, 3], [83101986, 1], [83189095, 0], [85137169, 2]])
    assert.equal(measureSurvival(seed, 180, seat), 180, `seed ${seed}, seat ${seat}`);
});

test("AI does not consume the world's random stream when choosing a move", () => {
  const bots = createGame({ seed: 7919, humans: 0 });
  const humans = createGame({ seed: 7919, humans: 4 });
  for (let i = 0; i < 250; i++) { stepGame(bots, 20); stepGame(humans, 20); }
  assert.deepEqual(bots.drops, humans.drops);
  assert.deepEqual(bots.itemDrops, humans.itemDrops);
  assert.equal(bots.seed, humans.seed);
});

function playing() {
  const s = createGame({ humans: 4 });
  s.phase = "playing"; s.tick = 100; s.lastWaveAt = 10000;
  return s;
}

test("forecast matches real impact frames through shielding, airborne chains and later drops", () => {
  const s = playing(), now = simulationFrame(s);
  s.players.forEach(p => { p.immune = 10000; });
  s.balls = [
    { id: 1, x: 3, y: 3, kind: "football", fuseFrame: now + 10 },
    { id: 2, x: 4, y: 3, kind: "normal", fuseFrame: now + 80,
      flight: { x: 10, y: 3, start: now, end: now + 40 } },
    { id: 3, x: 5, y: 3, kind: "normal", fuseFrame: now + 120 },
    { id: 4, x: 3, y: 8, kind: "football", fuseFrame: now + 100 },
  ];
  s.drops = [{ id: 5, x: 3, y: 5, kind: "normal", at: (now + 20) / 5 }];
  const predicted = forecast(s, blastCells);
  const expected = new Set(predicted.hazards.flatMap((times, cell) => times.map(t => `${cell}:${t}`)));
  const actual = new Set();
  for (let i = 0; i < 200; i++) {
    stepGame(s, 20);
    for (const b of s.blasts) if (b.atFrame === simulationFrame(s))
      actual.add(`${b.y * 13 + b.x}:${b.atFrame}`);
  }
  assert.deepEqual(actual, expected);
  assert.ok(!predicted.hazards[3 * 13 + 7].includes(now + 10), "short bubble blocks the long arm");
  assert.equal(predicted.balls.find(b => b.id === 2).end, now + 10, "chain hits in flight");
  assert.equal(predicted.balls.find(b => b.id === 5).end, now + 100, "falling ball is not hit before landing");
});

test("AI clears a pending landing before a surrounding wave can pin its body", () => {
  const s = playing(), p = s.players[0];
  p.bot = true;
  s.drops = [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]].map(([x, y], i) =>
    ({ id: i + 1, x, y, kind: "football", at: s.tick + 8 }));
  for (let i = 0; i < 40; i++) stepGame(s, 20);
  assert.equal(p.status, "alive");
  assert.ok(s.balls.every(b => Math.abs(p.x - b.x) >= .975 || Math.abs(p.y - b.y) >= .975),
    "body is clear when the wave lands, rather than waiting for the fuse");
  for (let i = 0; i < 160; i++) stepGame(s, 20);
  assert.equal(p.status, "alive");
});

test("AI can sidestep the solid goal corner from a fractional starting position", () => {
  const s = playing(), p = s.players[0];
  Object.assign(p, { bot: true, x: 11, y: 2.04 });
  s.balls = [[10, 2], [10, 2], [11, 1], [11, 1], [11, 3]].map(([x, y], i) =>
    ({ id: i + 1, x, y, kind: i === 4 ? "football" : "normal", fuseFrame: 650 }));
  for (let i = 0; i < 35; i++) stepGame(s, 20);
  assert.ok(p.x > 11.5, `failed to enter the safe upper lane: ${p.x}, ${p.y}`);
  assert.equal(p.status, "alive");
});
