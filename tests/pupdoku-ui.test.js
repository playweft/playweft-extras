import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { transformWithOxc } from 'vite';
import * as puzzle from '../games/pupdoku/puzzle.js';
import {
  createPupdokuController,
  COMPLETION_TIMING,
  LEVEL_TRANSITION_TIMING,
} from '../games/pupdoku/controller.js';
import { regionColors } from '../games/pupdoku/colors.js';

// Compile JSX with the same transformer as production, then mount the real
// component and dispatch DOM events through Preact's actual event listeners.
const appUrl = new URL('../games/pupdoku/app.jsx', import.meta.url);
const transformed = await transformWithOxc(
  await readFile(appUrl, 'utf8'),
  appUrl.pathname,
  {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
);
const code = transformed.code.replace(
  /(from\s+)(['"])([^'"]+)\2/g,
  (_, prefix, quote, specifier) =>
    prefix +
    quote +
    (specifier.startsWith('.')
      ? new URL(specifier, appUrl).href
      : import.meta.resolve(specifier)) +
    quote,
);
const { PupdokuApp } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const window = new Window();
const document = window.document;
globalThis.window = window;
globalThis.document = document;
after(() => window.happyDOM.close());
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  width: 480,
  height: 480,
});
const captures = new WeakMap();
window.HTMLElement.prototype.setPointerCapture = function (id) {
  captures.set(this, id);
};
window.HTMLElement.prototype.hasPointerCapture = function (id) {
  return captures.get(this) === id;
};
window.HTMLElement.prototype.releasePointerCapture = function () {
  captures.delete(this);
};
const mounts = [];
afterEach(() => {
  for (const { root, controller } of mounts.splice(0)) {
    act(() => render(null, root));
    controller.dispose();
    root.remove();
  }
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function mount(saved, { vibrate, workerAvailable = true } = {}) {
  const requests = [],
    workers = [],
    timers = new Map();
  const storage = new Map(saved ? [['playweft:pupdoku:v1', saved]] : []);
  let nextTimer = 0,
    now = 0,
    randomCall = 0;
  const randomSeeds = [7, 0, 6, 1, 4];
  const schedule = (fn, delay) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  const unschedule = (id) => timers.delete(id);
  const controller = createPupdokuController({
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    randomSeed: () => randomSeeds[randomCall++] ?? 1000 + randomCall,
    vibrate,
    schedule,
    unschedule,
    createWorker() {
      if (!workerAvailable) return null;
      const worker = {
        postMessage(data) {
          requests.push(data);
        },
        terminate() {
          this.terminated = true;
        },
      };
      workers.push(worker);
      return worker;
    },
  });
  const root = document.createElement('div');
  document.body.append(root);
  mounts.push({ root, controller });
  await act(() => {
    render(h(PupdokuApp, { controller }), root);
    controller.start();
  });
  const el = (id) => root.querySelector('#' + id);
  function dispatch(target, name, fields = {}) {
    act(() => {
      const event = new window.Event(name, { bubbles: true, cancelable: true });
      Object.assign(event, fields);
      target.dispatchEvent(event);
    });
  }
  const click = (id) => dispatch(el(id), 'click', { detail: 0 });
  function advance(ms) {
    act(() => {
      const end = now + ms;
      while (true) {
        const item = [...timers]
          .sort((a, b) => a[1].at - b[1].at)
          .find(([, timer]) => timer.at <= end);
        if (!item) break;
        now = item[1].at;
        timers.delete(item[0]);
        item[1].fn();
      }
      now = end;
    });
  }
  async function finish({ endCompletion = true } = {}) {
    await act(async () => {
      workers.at(-1).onmessage?.({
        data: {
          id: requests.at(-1).id,
          puzzle: puzzle.generateLevel(requests.at(-1).seed),
        },
      });
      await flush();
    });
    if (endCompletion) {
      if (controller.getSnapshot().transition === 'out') {
        advance(LEVEL_TRANSITION_TIMING.fadeOut);
        await act(flush);
      }
      if (controller.getSnapshot().transition === 'in')
        advance(LEVEL_TRANSITION_TIMING.fadeIn);
    }
  }
  function pointer(name, index, pointerId = 1, pointerType = 'mouse') {
    const size = Math.sqrt(el('board').children.length);
    dispatch(el('board'), name, {
      button: 0,
      pointerId,
      pointerType,
      clientX: (((index % size) + 0.5) * 480) / size,
      clientY: ((Math.floor(index / size) + 0.5) * 480) / size,
    });
  }
  function tap(index, type = 'mouse') {
    pointer('pointerdown', index, 1, type);
    pointer('pointerup', index, 1, type);
    dispatch(el('board').children[index], 'click', { detail: 1 });
  }
  const state = () => JSON.parse(storage.get('playweft:pupdoku:v1'));
  return {
    el,
    click,
    requests,
    workers,
    storage,
    finish,
    advance,
    pointer,
    tap,
    state,
    controller,
    dispatch,
  };
}

function complete(ui) {
  for (let i = 0; i < 300 && !ui.controller.getSnapshot().completion; i++)
    ui.click('hint');
  ui.advance(COMPLETION_TIMING.pups);
  assert.ok(ui.el('completion'));
  assert.equal(ui.el('result').hidden, true);
}

test('completion prefetches during hold, fades out the old board, then mounts fresh cells without a spinner', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  for (let row = 0; row < board.size - 1; row++)
    game.cells[row * board.size + board.solution[row]] = 2;
  const cross = board.solution[0] === 0 ? 1 : 0;
  game.cells[cross] = 3;
  const ui = await mount(JSON.stringify({ game, level: 17 }));
  const oldBoard = ui.el('board');
  const last = (board.size - 1) * board.size + board.solution.at(-1);
  ui.tap(last);
  ui.tap(last);
  assert.equal(ui.controller.getSnapshot().completion.phase, 'pups');
  assert.equal(ui.el('completion'), null);
  assert.ok(oldBoard.classList.contains('celebrate'));
  assert.equal(ui.el('restart').disabled, true);
  assert.equal(ui.el('hint').disabled, true);
  ui.click('hint');
  ui.click('restart');
  ui.advance(COMPLETION_TIMING.pups - 1);
  assert.equal(ui.el('completion'), null);
  assert.equal(ui.requests.length, 0);
  ui.advance(1);
  assert.equal(oldBoard.classList.contains('celebrate'), false);
  assert.ok(ui.el('completion').classList.contains('enter'));
  assert.equal(ui.el('completion').querySelector('button'), null);
  ui.advance(COMPLETION_TIMING.fadeIn - 1);
  assert.equal(ui.requests.length, 0);
  ui.advance(1);
  assert.ok(ui.el('completion').classList.contains('hold'));
  assert.equal(
    ui.requests.length,
    1,
    'prefetch starts as soon as the overlay has entered',
  );
  await ui.finish({ endCompletion: false });
  assert.equal(
    ui.state().level,
    17,
    'a prepared puzzle must not replace the visible board',
  );
  assert.equal(ui.el('board'), oldBoard);
  assert.equal(ui.el('loading').dataset.visible, 'false');
  ui.advance(COMPLETION_TIMING.hold - 1);
  assert.ok(ui.el('completion').classList.contains('hold'));
  ui.advance(1);
  assert.ok(ui.el('completion').classList.contains('exit'));
  assert.equal(ui.el('board-wrap').dataset.transition, 'out');
  assert.equal(ui.el('loading').dataset.visible, 'false');
  assert.equal(ui.controller.getSnapshot().game.cells[cross], 3);
  ui.advance(LEVEL_TRANSITION_TIMING.fadeOut - 1);
  assert.equal(ui.el('board'), oldBoard);
  assert.equal(ui.controller.getSnapshot().game.cells[cross], 3);
  const cleared = [];
  const unsubscribe = ui.controller.subscribe((state) => {
    if (state.transition === 'waiting') cleared.push([...state.game.cells]);
  });
  ui.advance(1);
  await act(flush);
  unsubscribe();
  assert.ok(cleared.length);
  assert.ok(cleared.every((cells) => cells.every((value) => value === 0)));
  assert.equal(ui.el('completion'), null);
  assert.equal(ui.state().level, 18);
  assert.equal(ui.el('progress').textContent, '0/8');
  assert.notEqual(
    ui.el('board'),
    oldBoard,
    'new puzzle must not reuse animated old cells',
  );
  for (const cell of ui.el('board').children) {
    assert.equal(cell.querySelector('.dog'), null);
    assert.equal(cell.querySelector('.cross').dataset.visible, 'false');
    assert.equal(cell.querySelector('.cross').dataset.error, 'false');
  }
  assert.equal(ui.el('board-wrap').dataset.transition, 'in');
  assert.equal(ui.el('loading').dataset.visible, 'false');
  assert.equal(ui.el('hint').disabled, true);
  ui.advance(LEVEL_TRANSITION_TIMING.fadeIn - 1);
  assert.equal(ui.el('hint').disabled, true);
  ui.advance(1);
  assert.equal(ui.el('hint').disabled, false);
  assert.equal(ui.requests.length, 1);
});

test('completed saves resume auto-advance, slow generation keeps loading, and disposal cancels celebration timers', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  board.solution.forEach((column, row) => {
    game.cells[row * board.size + column] = 2;
  });
  const saved = JSON.stringify({ game, level: 5 });
  const ui = await mount(saved);
  assert.equal(ui.el('completion'), null);
  assert.ok(ui.el('board').classList.contains('celebrate'));
  ui.advance(
    COMPLETION_TIMING.pups +
      COMPLETION_TIMING.fadeIn +
      COMPLETION_TIMING.hold +
      COMPLETION_TIMING.fadeOut,
  );
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.el('completion'), null);
  assert.equal(ui.el('loading').dataset.visible, 'true');
  assert.ok(
    ui.controller.getSnapshot().game.cells.every((value) => value === 0),
  );
  ui.controller.suspend();
  assert.equal(
    ui.storage.get('playweft:pupdoku:v1'),
    saved,
    'waiting must preserve the completed save, not the cleared old board',
  );
  await ui.finish();
  assert.equal(ui.state().level, 6);
  assert.equal(ui.el('loading').dataset.visible, 'false');
  for (const elapsed of [
    0,
    COMPLETION_TIMING.pups,
    COMPLETION_TIMING.pups + COMPLETION_TIMING.fadeIn,
  ]) {
    const stopped = await mount(saved);
    stopped.advance(elapsed);
    stopped.controller.dispose();
    const stored = stopped.storage.get('playweft:pupdoku:v1');
    stopped.advance(20000);
    await act(flush);
    assert.equal(stopped.storage.get('playweft:pupdoku:v1'), stored);
    assert.ok(stopped.workers.every((worker) => worker.terminated));
    assert.equal(
      stopped.requests.length,
      elapsed >= COMPLETION_TIMING.pups + COMPLETION_TIMING.fadeIn ? 1 : 0,
      'leaving cancels timers and never starts another generation',
    );
  }
});

test('a prefetch failure stays behind the completion sequence and retry advances only once', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  board.solution.forEach((column, row) => {
    game.cells[row * board.size + column] = 2;
  });
  const ui = await mount(JSON.stringify({ game, level: 9 }));
  ui.advance(COMPLETION_TIMING.pups + COMPLETION_TIMING.fadeIn);
  ui.workers.at(-1).onerror();
  await act(flush);
  assert.equal(ui.controller.getSnapshot().generationError, false);
  assert.equal(ui.el('result').hidden, true);
  assert.equal(ui.el('loading').dataset.visible, 'false');
  ui.advance(COMPLETION_TIMING.hold + LEVEL_TRANSITION_TIMING.fadeOut);
  await act(flush);
  ui.advance(LEVEL_TRANSITION_TIMING.fadeIn);
  assert.equal(ui.el('result').hidden, false);
  assert.equal(ui.state().level, 9);
  ui.click('result-action');
  await ui.finish();
  assert.equal(ui.state().level, 10);
  assert.equal(ui.requests.length, 2);
});

test('Preact preserves cell nodes across edits and shows keyboard focus only during keyboard input', async () => {
  const ui = await mount();
  await ui.finish();
  const first = ui.el('board').children[0];
  ui.tap(0);
  assert.equal(
    ui.el('board').children[0],
    first,
    'a state update must preserve the animated cell',
  );
  assert.equal(ui.el('board').classList.contains('keyboard-focus'), false);
  ui.dispatch(first, 'keydown', { key: 'ArrowRight' });
  assert.equal(document.activeElement, ui.el('board').children[1]);
  assert.equal(ui.el('board').classList.contains('keyboard-focus'), true);
  ui.dispatch(document.activeElement, 'keydown', { key: 'x' });
  assert.equal(ui.state().game.cells[1], 1);
  ui.tap(2);
  assert.equal(ui.el('board').classList.contains('keyboard-focus'), false);
});

test('worker timeout can retry and disposal ignores late replies', async () => {
  const ui = await mount();
  const oldWorker = ui.workers[0],
    lateMessage = oldWorker.onmessage,
    lateError = oldWorker.onerror;
  ui.advance(10000);
  await act(flush);
  ui.advance(LEVEL_TRANSITION_TIMING.fadeIn);
  assert.equal(ui.el('loading').dataset.visible, 'false');
  assert.match(ui.el('result-action').getAttribute('aria-label'), /重试/);
  assert.equal(oldWorker.terminated, true);
  ui.click('result-action');
  assert.equal(ui.workers.length, 2);
  await act(async () => {
    lateMessage({
      data: { id: ui.requests[1].id, puzzle: puzzle.generateLevel(0) },
    });
    lateError();
    await flush();
  });
  assert.equal(
    ui.controller.getSnapshot().game,
    null,
    'a terminated worker cannot satisfy a new request even with its id',
  );
  assert.equal(ui.workers[1].terminated, undefined);
  await ui.finish();
  assert.ok(ui.el('board').children.length);
  complete(ui);
  ui.advance(COMPLETION_TIMING.fadeIn + COMPLETION_TIMING.hold);
  const stored = ui.storage.get('playweft:pupdoku:v1');
  ui.controller.dispose();
  assert.equal(ui.workers.at(-1).terminated, true);
  await ui.finish();
  assert.equal(
    ui.storage.get('playweft:pupdoku:v1'),
    stored,
    'late results cannot overwrite saved progress',
  );
});

test('a reused worker ignores old request ids and idle failures are recreated lazily', async () => {
  const ui = await mount();
  await ui.finish();
  const worker = ui.workers[0],
    onmessage = worker.onmessage,
    onerror = worker.onerror;
  complete(ui);
  ui.advance(COMPLETION_TIMING.fadeIn + COMPLETION_TIMING.hold);
  assert.equal(ui.workers.length, 1);
  assert.equal(worker.onmessage, onmessage, 'listeners are installed once');
  const previous = ui.controller.getSnapshot().game.puzzle;
  await act(async () => {
    worker.onmessage({
      data: { id: ui.requests[0].id, puzzle: puzzle.generateLevel(7) },
    });
    worker.onmessage({
      data: { id: ui.requests[0].id, error: 'stale failure' },
    });
    await flush();
  });
  ui.advance(LEVEL_TRANSITION_TIMING.fadeOut);
  await act(flush);
  assert.equal(ui.controller.getSnapshot().transition, 'waiting');
  assert.equal(ui.controller.getSnapshot().game.puzzle, previous);
  assert.equal(worker.terminated, undefined);
  await ui.finish();
  assert.equal(ui.state().level, 2);
  ui.advance(10000);
  assert.equal(
    worker.terminated,
    undefined,
    'successful requests cancel their timeouts',
  );
  onerror();
  assert.equal(worker.terminated, true);
  assert.equal(ui.controller.getSnapshot().generationError, false);
  complete(ui);
  ui.advance(COMPLETION_TIMING.fadeIn + COMPLETION_TIMING.hold);
  assert.equal(ui.workers.length, 2);
  await ui.finish();
  assert.equal(ui.state().level, 3);
});

test('a matching generation error discards the worker and retries with a fresh instance', async () => {
  const ui = await mount();
  const worker = ui.workers[0];
  await act(async () => {
    worker.onmessage({
      data: { id: ui.requests[0].id, error: 'test failure' },
    });
    await flush();
  });
  ui.advance(LEVEL_TRANSITION_TIMING.fadeIn);
  assert.equal(worker.terminated, true);
  assert.equal(ui.controller.getSnapshot().message, 'test failure');
  ui.click('result-action');
  assert.equal(ui.workers.length, 2);
  await ui.finish();
  assert.equal(ui.state().level, 1);
});

test('generation still works without Worker and leaving cancels scheduled fallback work', async () => {
  const ui = await mount(undefined, { workerAvailable: false });
  ui.advance(30);
  await act(flush);
  ui.advance(LEVEL_TRANSITION_TIMING.fadeIn);
  assert.equal(ui.controller.canEdit(), true);
  assert.equal(ui.workers.length, 0);
  const stopped = await mount(undefined, { workerAvailable: false });
  stopped.controller.dispose();
  stopped.advance(10000);
  await act(flush);
  assert.equal(stopped.controller.getSnapshot().game, null);
});

test('random-size worker loading, save restoration and failure retry are wired without a size selector', async () => {
  const ui = await mount();
  assert.deepEqual(Object.keys(ui.requests[0]), ['id', 'seed']);
  assert.equal(ui.el('undo').disabled, true);
  assert.equal(ui.el('hint').disabled, true);
  ui.click('undo');
  await ui.finish();
  assert.equal(ui.el('loading').dataset.visible, 'false');
  assert.equal(ui.el('board').children.length, 64);
  assert.equal(ui.el('progress').textContent, '0/8');
  assert.equal(ui.workers[0].terminated, undefined);
  ui.tap(0);
  ui.advance(280);
  const restored = await mount(ui.storage.get('playweft:pupdoku:v1'));
  assert.equal(restored.requests.length, 0);
  assert.deepEqual(restored.state().game.cells, ui.state().game.cells);
  const colors = regionColors(ui.state().game.puzzle.regions, 8);
  const backgrounds = Array.from(ui.el('board').children, (cell) =>
    cell.style.getPropertyValue('--region-color'),
  );
  assert.deepEqual(
    backgrounds,
    ui.state().game.puzzle.regions.map((region) => colors[region]),
  );
  assert.deepEqual(
    Array.from(restored.el('board').children, (cell) =>
      cell.style.getPropertyValue('--region-color'),
    ),
    backgrounds,
  );
  complete(ui);
  ui.advance(COMPLETION_TIMING.fadeIn + COMPLETION_TIMING.hold);
  assert.equal(ui.requests[1].seed, 0);
  assert.equal(ui.el('hint').disabled, true);
  await ui.finish();
  assert.equal(ui.el('board').children.length, 81);
  assert.equal(ui.el('progress').textContent, '0/9');
  assert.equal(ui.el('level').textContent, 'Level 2');
  complete(ui);
  ui.advance(COMPLETION_TIMING.fadeIn + COMPLETION_TIMING.hold);
  ui.workers.at(-1).onerror();
  await flush();
  ui.advance(COMPLETION_TIMING.fadeOut);
  await act(flush);
  ui.advance(LEVEL_TRANSITION_TIMING.fadeIn);
  assert.equal(ui.el('loading').dataset.visible, 'false');
  assert.equal(ui.el('result').hidden, false);
  assert.match(ui.el('result-action').getAttribute('aria-label'), /重试/);
  ui.click('result-action');
  await ui.finish();
  assert.equal(ui.el('board').children.length, 121);
  assert.equal(ui.el('level').textContent, 'Level 3');
});

test('mouse and touch taps mark; a double tap places exactly one pup without a stray X or history entry', async () => {
  for (const type of ['mouse', 'touch']) {
    const ui = await mount();
    await ui.finish();
    const answer = puzzle.generateLevel(7).solution[0];
    ui.tap(0, type);
    assert.equal(
      ui.state().game.cells[0],
      1,
      'first tap must mark immediately',
    );
    assert.equal(
      ui.el('board').children[0].lastElementChild.className,
      'cross',
    );
    assert.equal(
      ui.el('undo').disabled,
      false,
      'the immediate mark can already be undone',
    );
    ui.advance(280);
    assert.equal(ui.state().game.cells[0], 1);
    ui.tap(0, type);
    assert.equal(ui.state().game.cells[0], 0);
    ui.advance(280);
    const count = ui.state().game.history.length;
    ui.tap(answer, type);
    ui.advance(100);
    ui.tap(answer, type);
    ui.advance(500);
    assert.equal(ui.state().game.cells[answer], 2);
    assert.equal(ui.state().game.history.length, count + 1);
    assert.equal(ui.el('progress').textContent, '1/8');
    ui.click('undo');
    assert.equal(
      ui.state().game.cells[answer],
      0,
      'undo the pup without reviving its temporary X',
    );
    ui.tap(answer, type);
    ui.tap(answer, type);
    ui.tap(answer, type);
    ui.advance(280);
    assert.equal(
      ui.state().game.cells[answer],
      2,
      'a single tap must preserve a pup',
    );
    const placed = ui.state().game;
    ui.tap(answer, type);
    ui.tap(answer, type);
    assert.equal(
      ui.state().game.cells[answer],
      2,
      'double tap must preserve a placed pup',
    );
    for (const key of ['d', 'x', 'Delete', 'Backspace'])
      ui.dispatch(ui.el('board').children[answer], 'keydown', { key });
    assert.deepEqual(
      ui.state().game,
      placed,
      'ignored edits must not change lives, notes or undo history',
    );
    ui.click('undo');
    assert.equal(ui.state().game.cells[answer], 0);
  }
});

test('correct pups give one brief haptic pulse, while marks, mistakes, repeats and undo stay silent', async () => {
  for (const type of ['mouse', 'touch']) {
    const board = puzzle.generateLevel(7),
      game = puzzle.createGame(board),
      answer = board.solution[0],
      wrong = (answer + 1) % board.size,
      pulses = [],
      ui = await mount(JSON.stringify({ game, level: 1 }), {
        vibrate: (duration) => pulses.push(duration),
      });
    ui.tap(answer, type);
    assert.deepEqual(pulses, [], 'the first tap only marks a cross');
    ui.tap(answer, type);
    assert.equal(ui.state().game.cells[answer], 2);
    assert.deepEqual(pulses, [3]);
    ui.tap(answer, type);
    ui.tap(answer, type);
    assert.deepEqual(pulses, [3], 'an existing pup cannot vibrate again');
    ui.tap(wrong, type);
    ui.tap(wrong, type);
    assert.equal(ui.state().game.hearts, 2);
    assert.deepEqual(pulses, [3], 'a wrong pup does not get success feedback');
    ui.click('undo');
    assert.deepEqual(pulses, [3]);
  }
});

test('hint placements vibrate once, restored pups stay silent, and unavailable haptics do not interrupt play', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board),
    pulses = [];
  game.cells.fill(1);
  board.solution.forEach(
    (col, row) => (game.cells[row * board.size + col] = 2),
  );
  const last = (board.size - 1) * board.size + board.solution.at(-1);
  game.cells[last] = 0;
  const ui = await mount(JSON.stringify({ game, level: 1 }), {
    vibrate: (duration) => pulses.push(duration),
  });
  assert.deepEqual(pulses, [], 'restoring placed pups does not vibrate');
  ui.click('hint');
  assert.equal(ui.state().game.cells[last], 2);
  assert.deepEqual(pulses, [3]);
  ui.click('hint');
  assert.deepEqual(pulses, [3], 'completion cannot repeat the pulse');
  const unsupported = await mount(
    JSON.stringify({ game: puzzle.createGame(board), level: 1 }),
    {
      vibrate: () => {
        throw new Error('Unavailable');
      },
    },
  );
  unsupported.tap(board.solution[0]);
  unsupported.tap(board.solution[0]);
  assert.equal(unsupported.state().game.cells[board.solution[0]], 2);
  assert.equal(unsupported.state().game.hearts, 3);
});

test('fast drags fill crossed cells once, use a uniform paint mode and undo as one action', async () => {
  const ui = await mount();
  await ui.finish();
  ui.pointer('pointerdown', 0);
  ui.pointer('pointermove', 7);
  ui.pointer('pointermove', 0);
  assert.ok(
    Array.from(ui.el('board').children)
      .slice(0, 8)
      .every((cell) => cell.getAttribute('aria-label').includes('已排除')),
  );
  ui.pointer('pointerup', 0);
  assert.deepEqual(ui.state().game.cells.slice(0, 8), Array(8).fill(1));
  assert.equal(ui.state().game.history.length, 1);
  assert.equal(ui.state().game.hearts, 3);
  ui.click('undo');
  assert.ok(ui.state().game.cells.every((value) => value === 0));
  ui.tap(0);
  ui.advance(280);
  ui.pointer('pointerdown', 0);
  ui.pointer('pointermove', 7);
  ui.pointer('pointerup', 7);
  assert.deepEqual(
    ui.state().game.cells.slice(0, 8),
    Array(8).fill(0),
    'dragging from X erases uniformly',
  );
});

test('wrong double taps upgrade notes to red without consuming undo history; immediate undo cancels recognition', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  const answer = board.solution[0],
    wrong = (answer + 1) % 8;
  game.cells[wrong] = 1;
  game.history = Array.from({ length: 150 }, (_, index) => {
    const cells = Array(64).fill(0);
    cells[index % 64] = 1;
    return cells;
  });
  const ui = await mount(JSON.stringify({ game, level: 1 }));
  ui.tap(wrong);
  assert.equal(
    ui.state().game.cells[wrong],
    0,
    'an existing X clears immediately',
  );
  ui.tap(wrong);
  assert.equal(ui.state().game.hearts, 2);
  assert.equal(
    ui.state().game.cells[wrong],
    3,
    'a wrong double tap replaces the original note with a red cross',
  );
  assert.deepEqual(
    ui.state().game.history,
    game.history,
    'a rejected pup does not consume undo history',
  );
  ui.tap(answer);
  ui.tap(answer);
  assert.equal(ui.state().game.cells[answer], 2);
  assert.equal(ui.state().game.history.length, 150);
  assert.deepEqual(
    ui.state().game.history.slice(0, -1),
    game.history.slice(1),
    'only the pup advances the history cap',
  );
  ui.click('undo');
  const marked = [...game.cells];
  marked[wrong] = 3;
  assert.deepEqual(ui.state().game.cells, marked);
  ui.tap(answer);
  assert.equal(ui.state().game.cells[answer], 1);
  ui.click('undo');
  ui.advance(300);
  assert.equal(
    ui.state().game.cells[answer],
    0,
    'the double-tap timer cannot restore an undone mark',
  );
});

test('red crosses persist after feedback and reload, and mouse or touch clears them before white marking', async () => {
  for (const type of ['mouse', 'touch']) {
    const board = puzzle.generateLevel(7),
      game = puzzle.createGame(board),
      wrong = (board.solution[0] + 1) % board.size;
    game.cells[wrong] = 1;
    const ui = await mount(JSON.stringify({ game, level: 1 }));
    ui.tap(wrong, type);
    ui.tap(wrong, type);
    const cross = () => ui.el('board').children[wrong].querySelector('.cross');
    assert.equal(ui.state().game.hearts, 2);
    assert.equal(cross().dataset.visible, 'true');
    assert.equal(cross().dataset.error, 'true');
    assert.equal(
      cross().querySelectorAll('path').length,
      2,
      'one outline path behind one complete red cross',
    );
    ui.advance(2000);
    assert.equal(
      ui.el('board').children[wrong].classList.contains('error'),
      false,
    );
    assert.equal(
      cross().dataset.error,
      'true',
      'red note outlives transient feedback',
    );
    const restored = await mount(ui.storage.get('playweft:pupdoku:v1'));
    assert.equal(restored.state().game.cells[wrong], 3);
    assert.equal(
      restored.el('board').children[wrong].querySelector('.cross').dataset
        .error,
      'true',
    );
    const start = (wrong + 1) % board.size;
    ui.pointer('pointerdown', start);
    ui.pointer('pointermove', wrong);
    assert.equal(
      cross().dataset.error,
      'true',
      'white drag previews preserve red notes',
    );
    ui.pointer('pointerup', wrong);
    assert.equal(ui.state().game.cells[wrong], 3);
    ui.tap(wrong, type);
    assert.equal(ui.state().game.cells[wrong], 0);
    assert.equal(cross().dataset.visible, 'false');
    assert.equal(
      cross().dataset.error,
      'true',
      'the outgoing cross retains its red color and outline during fade-out',
    );
    ui.advance(300);
    ui.tap(wrong, type);
    assert.equal(ui.state().game.cells[wrong], 1);
    assert.equal(cross().dataset.error, 'false');
    assert.equal(cross().dataset.visible, 'true');
  }
});

test('a second tap that turns into a drag erases from the newly marked cell', async () => {
  const ui = await mount();
  await ui.finish();
  ui.tap(0);
  ui.pointer('pointerdown', 0);
  ui.pointer('pointermove', 7);
  ui.pointer('pointerup', 7);
  assert.deepEqual(ui.state().game.cells.slice(0, 8), Array(8).fill(0));
  assert.equal(ui.state().game.hearts, 3);
  ui.click('undo');
  assert.equal(
    ui.state().game.cells[0],
    1,
    'the first tap remains a distinct completed action',
  );
});

test('cancelled strokes and pending taps never survive restarting the puzzle', async () => {
  const ui = await mount();
  await ui.finish();
  ui.pointer('pointerdown', 0);
  ui.pointer('pointermove', 7);
  ui.pointer('pointercancel', 7);
  assert.ok(ui.state().game.cells.every((value) => value === 0));
  assert.ok(
    Array.from(ui.el('board').children).every(
      (cell) => !cell.getAttribute('aria-label').includes('已排除'),
    ),
  );
  ui.tap(0);
  ui.click('restart');
  ui.advance(300);
  assert.equal(
    ui.requests.length,
    1,
    'restart keeps the existing puzzle and size',
  );
  assert.ok(ui.state().game.cells.every((value) => value === 0));
});

test('hint corrects a wrong cross, then places a visible single, without mixing operations', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board),
    target = board.size + board.solution[1];
  game.cells[board.solution[0]] = 2;
  for (let col = 0; col < board.size; col++) game.cells[board.size + col] = 1;
  const before = [...game.cells],
    ui = await mount(JSON.stringify({ game, level: 1 }));
  ui.click('hint');
  const corrected = [...before];
  corrected[target] = 0;
  assert.deepEqual(ui.state().game.cells, corrected);
  assert.equal(ui.el('progress').textContent, `1/${board.size}`);
  ui.click('hint');
  assert.deepEqual(
    ui.state().game.cells,
    corrected.map((value, i) => (i === target ? 2 : value)),
  );
  assert.equal(ui.el('progress').textContent, `2/${board.size}`);
  assert.equal(ui.state().game.history.length, 2);
  assert.equal(ui.state().game.hearts, 3);
  ui.click('undo');
  ui.click('undo');
  assert.deepEqual(ui.state().game.cells, before);
});

test('hint marks the empty unit and adjacent peers of a placed pup without placing another pup', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board),
    dog = board.solution[0];
  game.cells[dog] = 2;
  const red = (dog + 1) % board.size;
  game.cells[red] = 3;
  const before = [...game.cells],
    expected = before.flatMap((value, i) =>
      value === 0 &&
      (Math.floor(i / board.size) === 0 ||
        i % board.size === dog ||
        board.regions[i] === board.regions[dog] ||
        (Math.floor(i / board.size) === 1 &&
          Math.abs((i % board.size) - dog) === 1))
        ? [i]
        : [],
    ),
    ui = await mount(JSON.stringify({ game, level: 1 }));
  ui.click('hint');
  assert.deepEqual(
    ui.state().game.cells,
    before.map((value, i) => (expected.includes(i) ? 1 : value)),
  );
  assert.equal(ui.state().game.hearts, 3);
  assert.equal(ui.state().game.history.length, 1);
  assert.equal(ui.el('progress').textContent, `1/${board.size}`);
  assert.ok(ui.el('board').children[dog].classList.contains('source'));
  assert.ok(
    expected.every((i) =>
      ui.el('board').children[i].classList.contains('hinted'),
    ),
  );
  assert.equal(
    ui.el('board').children[red].querySelector('.cross').dataset.error,
    'true',
  );
  assert.match(
    ui.controller.getSnapshot().message,
    /已放置小狗的同行、同列、同色区域及相邻位置/,
  );
  ui.click('undo');
  assert.deepEqual(ui.state().game.cells, before);
});

test('wrong double taps each charge one life, show loss at zero, and restart restores three lives', async () => {
  const ui = await mount();
  await ui.finish();
  const wrong = (puzzle.generateLevel(7).solution[0] + 1) % 8;
  for (let life = 2; life >= 0; life--) {
    ui.tap(wrong);
    ui.tap(wrong);
    ui.advance(300);
    assert.equal(ui.state().game.hearts, life);
    assert.equal(ui.state().game.cells[wrong], 3);
  }
  assert.equal(ui.el('result').hidden, false);
  assert.equal(ui.el('result-symbol').textContent, '↻');
  assert.equal(ui.el('hint').disabled, true);
  ui.click('restart');
  assert.equal(ui.state().game.hearts, 3);
  assert.equal(ui.el('result').hidden, true);
});

test('completing consecutive levels generates fresh random-size boards; restarting never rerolls', async () => {
  const ui = await mount();
  await ui.finish();
  const boards = new Set();
  for (const [index, size] of [8, 9, 10, 11, 12].entries()) {
    assert.equal(ui.el('board').children.length, size ** 2);
    assert.equal(ui.el('level').textContent, `Level ${index + 1}`);
    boards.add(JSON.stringify(ui.state().game.puzzle.regions));
    const before = ui.state().game.puzzle;
    ui.click('restart');
    assert.deepEqual(ui.state().game.puzzle, before);
    assert.equal(ui.el('progress').textContent, `0/${size}`);
    complete(ui);
    assert.equal(ui.el('progress').textContent, `${size}/${size}`);
    assert.equal(ui.el('hint').disabled, true);
    if (size !== 12) {
      ui.advance(COMPLETION_TIMING.fadeIn + COMPLETION_TIMING.hold);
      await ui.finish();
    }
  }
  assert.equal(boards.size, 5);
  assert.equal(
    ui.workers.length,
    1,
    'all consecutive levels reuse the original worker',
  );
  assert.deepEqual(
    ui.requests.map(({ id }) => id),
    [1, 2, 3, 4, 5],
  );
  assert.equal(ui.workers[0].terminated, undefined);
  ui.controller.dispose();
  assert.equal(
    ui.workers[0].terminated,
    true,
    'leaving also terminates an idle worker',
  );
});
