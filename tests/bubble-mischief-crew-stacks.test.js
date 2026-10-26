import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleStackDisplay } from '../games/bubble-mischief-crew/bubble-stacks.js';

const ball = (id, kind = 'normal', x = 6, y = 4) => ({ id, kind, x, y });
const state = balls => ({ balls, round: 1, tick: 40, substep: 0 });
const topIDs = display => [...display].filter(([, v]) => v.top).map(([b]) => b.id).sort((a, b) => a - b);

test('each stack prefers its earliest football, otherwise its earliest normal, independent of array order', () => {
  const balls = [ball(9, 'football'), ball(1), ball(7, 'football'),
    ball(4, 'normal', 8), ball(2, 'normal', 8), ball(5, 'football', 10)];
  const s = state(balls), before = structuredClone(s), context = {};
  let display = bubbleStackDisplay(context, s, 1000);
  assert.deepEqual(topIDs(display), [2, 7]);
  assert.ok([...display.values()].every(v => v.lift === 0));
  display = bubbleStackDisplay(context, s, 1050);
  assert.equal(display.get(balls[2]).lift, 1.75);
  display = bubbleStackDisplay(context, s, 1100);
  assert.deepEqual([...display].filter(([, v]) => v.lift === 2).map(([b]) => b.id).sort(), [2, 7]);
  assert.equal(display.get(balls[5]).lift, 0, 'a single football is not raised');
  assert.deepEqual(s, before, 'presentation does not change authoritative positions or state');
});

test('a new football replaces a raised normal with only one raised representative', () => {
  const context = {}, a = ball(1), b = ball(2), s = state([a, b]);
  bubbleStackDisplay(context, s, 0);
  assert.equal(bubbleStackDisplay(context, s, 100).get(a).lift, 2);
  const football = ball(3, 'football'); s.balls.push(football);
  let display = bubbleStackDisplay(context, s, 120);
  assert.deepEqual(topIDs(display), [3]);
  assert.equal(display.get(a).lift, 0);
  assert.equal(display.get(football).lift, 0);
  display = bubbleStackDisplay(context, s, 220);
  assert.equal(display.get(football).lift, 2);
  assert.equal(display.get(a).lift, 0);
  assert.equal(display.get(b).lift, 0);
});

test('when the earliest football disappears, the next one gets its own fast rise', () => {
  const context = {}, newer = ball(30, 'football'), oldest = ball(10, 'football');
  const s = state([newer, oldest, ball(1)]);
  bubbleStackDisplay(context, s, 0);
  let display = bubbleStackDisplay(context, s, 100);
  assert.equal(display.get(oldest).lift, 2);
  assert.equal(display.get(newer).lift, 0);
  s.balls = s.balls.filter(b => b !== oldest);
  display = bubbleStackDisplay(context, s, 110);
  assert.equal(display.get(newer).lift, 0);
  assert.equal(bubbleStackDisplay(context, s, 210).get(newer).lift, 2);
});

test('a football kicked into normals flies directly to the raised endpoint and stays there after landing', () => {
  const context = {}, incoming = { ...ball(1, 'football'), flight: { start: 200, end: 220 } };
  const s = state([ball(10), ball(11), incoming]);
  let display = bubbleStackDisplay(context, s, 0, 200);
  assert.deepEqual(topIDs(display), [10]);
  assert.equal(display.get(incoming).lift, 0);
  assert.equal(display.get(incoming).layer, 2, 'the incoming representative draws over the destination stack');
  display = bubbleStackDisplay(context, s, 200, 210);
  assert.equal(display.get(incoming).lift, 1);
  assert.equal(display.get(s.balls[0]).lift, 2);
  display = bubbleStackDisplay(context, s, 399, 219.95);
  assert.ok(Math.abs(display.get(incoming).lift - 1.995) < 1e-8);
  display = bubbleStackDisplay(context, s, 400, 220);
  assert.deepEqual(topIDs(display), [1]);
  assert.equal(display.get(incoming).lift, 2);
  assert.equal(display.get(s.balls[0]).lift, 0);
  delete incoming.flight; s.tick = 44;
  assert.equal(bubbleStackDisplay(context, s, 420, 221).get(incoming).lift, 2, 'no second rise after the flight flag is cleared');
});

test('an existing earlier football stays on top when a newer football is kicked in', () => {
  const context = {}, existing = ball(2, 'football');
  const incoming = { ...ball(3, 'football'), flight: { start: 200, end: 220 } };
  const s = state([incoming, existing, ball(1)]);
  bubbleStackDisplay(context, s, 0, 200);
  let display = bubbleStackDisplay(context, s, 200, 210);
  assert.equal(display.get(incoming).lift, 0);
  assert.equal(display.get(existing).lift, 2);
  display = bubbleStackDisplay(context, s, 400, 220);
  assert.deepEqual(topIDs(display), [2]);
  assert.equal(display.get(incoming).lift, 0);
});

test('normal-only arrivals also use the oldest bubble and independent cells do not share their lift', () => {
  const incoming = { ...ball(1), flight: { start: 200, end: 220 } };
  const laterFootball = { ...ball(5, 'football', 10), flight: { start: 200, end: 230 } };
  const s = state([incoming, ball(2), ball(3, 'normal', 10), laterFootball]);
  const display = bubbleStackDisplay({}, s, 300, 210);
  assert.equal(display.get(incoming).lift, 1);
  assert.equal(display.get(laterFootball).lift, 2 / 3);
  assert.equal(display.get(s.balls[1]).lift, 0);
});

test('unstacking eases back down; removed IDs, fresh rounds, rewound clocks and separate canvases do not retain a stale lift', () => {
  const context = {}, a = ball(1), s = state([a, ball(2)]);
  bubbleStackDisplay(context, s, 0);
  bubbleStackDisplay(context, s, 100);
  s.balls = [a];
  assert.equal(bubbleStackDisplay(context, s, 110).get(a).lift, 2);
  assert.equal(bubbleStackDisplay(context, s, 160).get(a).lift, 0.25);
  assert.equal(bubbleStackDisplay(context, s, 210).get(a).lift, 0);
  s.balls.push(ball(2)); bubbleStackDisplay(context, s, 220);
  assert.equal(bubbleStackDisplay(context, s, 320).get(a).lift, 2);
  assert.equal(bubbleStackDisplay({}, s, 320).get(a).lift, 0);
  s.round++;
  assert.equal(bubbleStackDisplay(context, s, 330).get(a).lift, 0);
  bubbleStackDisplay(context, s, 430); s.tick = 39;
  assert.equal(bubbleStackDisplay(context, s, 440).get(a).lift, 0);
  s.balls = []; bubbleStackDisplay(context, s, 450);
  s.balls = [a, ball(2)];
  assert.equal(bubbleStackDisplay(context, s, 550).get(a).lift, 0);
});
