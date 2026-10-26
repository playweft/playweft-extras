import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame, blastCells, random } from "../games/bubble-mischief-crew/game.js";
import { botInput } from "../games/bubble-mischief-crew/bot.js";
import { playerCell } from "../games/bubble-mischief-crew/movement.js";

function playing() {
  const s = createGame({ humans: 4 });
  s.phase = "playing"; s.tick = 100; s.lastWaveAt = 1e6;
  return s;
}
function foam(s, x, y, until = s.tick + 5) {
  s.blasts = [{ x, y, until, atFrame: s.tick * 5 - 1, id: 1 }];
}

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
  s.balls = [[3, 4], [4, 3], [4, 5]].map(([x, y], i) =>
    ({ id: i + 1, x, y, kind: "normal", fuse: 10000 }));
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
