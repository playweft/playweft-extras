import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PupdokuGamepadInput,
  attachPupdokuGamepad,
} from '../games/pupdoku/gamepad.js';
import { createPupdokuController } from '../games/pupdoku/controller.js';
import { createGame, generatePuzzle } from '../games/pupdoku/puzzle.js';

function pad(index = 0, id = 'DualSense') {
  return {
    id,
    index,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
  };
}

test('connection, reconnect and reset baseline held buttons and directions', () => {
  const input = new PupdokuGamepadInput(),
    p = pad();
  p.buttons[0].pressed = p.buttons[15].pressed = true;
  assert.deepEqual(input.poll([p], 0), []);
  assert.deepEqual(input.poll([p], 1000), []);
  p.buttons[0].pressed = p.buttons[15].pressed = false;
  input.poll([p], 1010);
  p.buttons[0].pressed = true;
  assert.deepEqual(input.poll([p], 1020), [{ type: 'place' }]);
  assert.deepEqual(input.poll([p], 3000), []);
  input.poll([], 3010);
  assert.deepEqual(input.poll([p], 4000), []);
  input.reset();
  assert.deepEqual(input.poll([p], 5000), []);
});

test('D-pad and dominant stick axis move once, then repeat without catch-up or drift', () => {
  const input = new PupdokuGamepadInput(),
    p = pad();
  input.poll([p], 0);
  p.axes = [0.3, -0.4];
  assert.deepEqual(input.poll([p], 10), []);
  p.axes = [0.8, 0.65];
  assert.deepEqual(input.poll([p], 20), [{ type: 'move', direction: 'right' }]);
  assert.deepEqual(input.poll([p], 419), []);
  assert.deepEqual(input.poll([p], 420), [
    { type: 'move', direction: 'right' },
  ]);
  assert.deepEqual(input.poll([p], 10000), [
    { type: 'move', direction: 'right' },
  ]);
  assert.deepEqual(input.poll([p], 10001), []);
  p.buttons[12].pressed = true;
  assert.deepEqual(input.poll([p], 10002), [{ type: 'move', direction: 'up' }]);
  p.buttons[12].pressed = false;
  p.axes = [NaN, Infinity];
  assert.deepEqual(input.poll([p], 10003), []);
});

test('one controller owns the cursor; replacement and unmapped devices cannot replay buttons', () => {
  const input = new PupdokuGamepadInput(),
    first = pad(),
    second = pad(1, 'Xbox');
  input.poll([first, second], 0);
  second.buttons[0].pressed = true;
  assert.deepEqual(input.poll([first, second], 10), []);
  assert.deepEqual(input.poll([second], 20), []);
  second.buttons[0].pressed = false;
  input.poll([second], 30);
  second.buttons[0].pressed = true;
  assert.deepEqual(input.poll([second], 40), [{ type: 'place' }]);
  second.mapping = '';
  assert.deepEqual(input.poll([second], 50), []);
  assert.equal(input.state, null);
});

function fixture(t, savedGame = createGame(generatePuzzle(8, 31))) {
  const document = new EventTarget();
  document.visibilityState = 'visible';
  let focused = true;
  document.hasFocus = () => focused;
  const win = new EventTarget(),
    frames = new Map(),
    timers = new Map();
  let serial = 0,
    now = 0,
    reads = 0,
    active = false;
  const p = pad(),
    pads = [p];
  win.document = document;
  win.navigator = {
    getGamepads() {
      reads++;
      return pads;
    },
  };
  win.requestAnimationFrame = (callback) => {
    const id = ++serial;
    frames.set(id, callback);
    return id;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  const controller = createPupdokuController({
    storage: {
      getItem: () => JSON.stringify({ game: savedGame, level: 20 }),
      setItem() {},
    },
    createWorker: () => null,
    schedule: (fn) => {
      const id = ++serial;
      timers.set(id, fn);
      return id;
    },
    unschedule: (id) => timers.delete(id),
  });
  controller.start();
  const focusedCells = [];
  const detach = attachPupdokuGamepad({
    controller,
    window: win,
    focusCell: (index) => focusedCells.push(index),
    onActive: () => {
      active = true;
    },
    onInactive: () => {
      active = false;
    },
  });
  t.after(() => {
    detach();
    controller.dispose();
  });
  function tick(delta = 16) {
    now += delta;
    const pending = [...frames];
    frames.clear();
    pending.forEach(([, callback]) => callback(now));
  }
  const down = (index) => {
    p.buttons[index].pressed = true;
    tick();
  };
  const up = (index) => {
    p.buttons[index].pressed = false;
    tick();
  };
  const tap = (index) => {
    down(index);
    up(index);
  };
  const focus = (value) => {
    focused = value;
    win.dispatchEvent(new Event(value ? 'focus' : 'blur'));
  };
  tick();
  return {
    win,
    document,
    controller,
    p,
    pads,
    tick,
    down,
    up,
    tap,
    focus,
    frames,
    focusedCells,
    detach,
    state: controller.getSnapshot,
    get active() {
      return active;
    },
    get reads() {
      return reads;
    },
  };
}

test('painting and turning share one Undo; held face buttons never repeat and pups stay locked', (t) => {
  const f = fixture(t);
  f.down(2);
  f.tap(15);
  f.tap(13);
  f.up(2);
  const marked = [0, 1, 9];
  assert.deepEqual(
    marked.map((i) => f.state().game.cells[i]),
    [1, 1, 1],
  );
  assert.equal(f.state().game.history.length, 1);
  f.down(4);
  f.tick(2000);
  assert.ok(f.state().game.cells.every((value) => value === 0));
  f.up(4);
  const index = f.state().game.puzzle.solution[0];
  f.controller.select(index);
  f.down(0);
  assert.equal(f.state().game.cells[index], 2);
  f.tick(2000);
  f.up(0);
  f.tap(1);
  f.tap(2);
  assert.equal(f.state().game.cells[index], 2);
});

test('first confirm reveals the cursor; a wrong placement charges one life per press', (t) => {
  const f = fixture(t);
  const wrong = (f.state().game.puzzle.solution[0] + 1) % 8;
  f.controller.select(wrong);
  f.tap(0);
  assert.equal(f.active, true);
  assert.equal(f.state().game.hearts, 3);
  f.down(0);
  f.tick(2000);
  assert.equal(f.state().game.hearts, 2);
  assert.equal(f.state().game.cells[wrong], 3);
  f.up(0);
  f.tap(1);
  assert.equal(f.state().game.cells[wrong], 0);
  f.tap(0);
  assert.equal(f.state().game.hearts, 1);
});

test('directions clamp at board edges and right shoulder applies only one hint per press', (t) => {
  const f = fixture(t);
  f.down(14);
  f.tick(5000);
  assert.equal(f.state().selected, 0);
  f.up(14);
  f.controller.select(63);
  f.tap(15);
  f.tap(13);
  assert.equal(f.state().selected, 63);
  f.down(5);
  const hints = f.state().game.hints;
  assert.equal(hints, 1);
  f.tick(5000);
  assert.equal(f.state().game.hints, hints);
});

test('Create resets on release; holding a brush across restart cannot mark the fresh board', (t) => {
  const f = fixture(t);
  f.down(2);
  const original = f.state().game;
  f.down(8);
  assert.equal(f.state().game, original);
  f.tick(1000);
  assert.equal(f.state().game, original);
  f.up(8);
  assert.notEqual(f.state().game, original);
  assert.equal(f.state().game.hasMarked, true);
  f.tick();
  f.tap(15);
  assert.ok(f.state().game.cells.every((value) => value === 0));
  f.up(2);
  f.tap(2);
  assert.equal(f.state().game.cells[1], 1);
});

test('Create + Options in either order, Guide, and controls held during a chord cannot reset or play', (t) => {
  const f = fixture(t);
  f.tap(2);
  const original = f.state().game;
  for (const order of [
    [8, 9],
    [9, 8],
    [8, 16],
  ]) {
    f.down(order[0]);
    f.down(order[1]);
    f.down(0);
    f.down(15);
    f.tick(1000);
    f.up(order[0]);
    f.up(order[1]);
    f.tick(1000);
    assert.equal(f.state().game, original);
    assert.equal(f.state().selected, 0);
    assert.equal(f.state().game.hearts, 3);
    assert.equal(f.state().game.cells[0], 1);
    f.up(0);
    f.up(15);
  }
});

test('lost focus, hidden tabs, and disconnect finish strokes and require fresh presses', (t) => {
  const f = fixture(t);
  f.down(2);
  f.focus(false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.active, false);
  f.focus(true);
  f.tick();
  f.tap(15);
  assert.equal(f.state().game.cells[1], 0);
  f.up(2);
  f.down(2);
  f.document.visibilityState = 'hidden';
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.frames.size, 0);
  f.document.visibilityState = 'visible';
  f.document.dispatchEvent(new Event('visibilitychange'));
  f.tick();
  f.tap(15);
  assert.equal(f.state().game.cells[2], 0);
  f.pads.length = 0;
  f.tick();
  assert.equal(f.frames.size, 0);
  const reads = f.reads;
  f.tick(10000);
  assert.equal(f.reads, reads, 'no idle polling without a controller');
  f.pads.push(f.p);
  f.win.dispatchEvent(new Event('gamepadconnected'));
  f.tick();
  f.tap(15);
  assert.equal(f.state().game.cells[3], 0);
  f.up(2);
  f.tap(2);
  assert.equal(f.state().game.cells[3], 1);
});

test('keyboard and pointer interrupt a brush; disposal stops polling and removes listeners', (t) => {
  const f = fixture(t);
  for (const type of ['keydown', 'pointerdown']) {
    f.down(2);
    f.win.dispatchEvent(new Event(type));
    f.tick();
    const next = f.state().selected + 1;
    f.tap(15);
    assert.equal(f.state().game.cells[next], 0);
    f.up(2);
  }
  f.detach();
  assert.equal(f.frames.size, 0);
  f.win.dispatchEvent(new Event('focus'));
  f.win.dispatchEvent(new Event('gamepadconnected'));
  assert.equal(f.frames.size, 0);
});

test('losing all lives requires release and confirm to retry; completion ignores held input', (t) => {
  const f = fixture(t);
  const wrong = (f.state().game.puzzle.solution[0] + 1) % 8;
  f.tap(15);
  f.controller.select(wrong);
  f.tap(0);
  f.tap(0);
  f.down(0);
  assert.equal(f.state().game.hearts, 0);
  f.tick(2000);
  assert.equal(f.state().game.hearts, 0);
  f.up(0);
  f.tap(0);
  assert.equal(f.state().game.hearts, 3);
  f.tick();
  f.state().game.puzzle.solution.forEach((col, row) =>
    f.controller.keyboardAction(row * 8 + col, 'd'),
  );
  assert.ok(f.state().completion);
  f.tap(8);
  assert.ok(
    f.state().completion,
    'Create cannot interrupt the completion transition',
  );
});

test('unsupported or denied Gamepad API does not break other inputs or poll errors every frame', (t) => {
  assert.doesNotThrow(() => attachPupdokuGamepad({ window: {} })());
  const f = fixture(t);
  f.win.navigator.getGamepads = () => {
    throw new DOMException('Denied', 'SecurityError');
  };
  assert.doesNotThrow(() => f.tick());
  assert.equal(f.frames.size, 0);
  assert.doesNotThrow(() => f.controller.toggleMark(0));
  assert.equal(f.state().game.cells[0], 1);
});
