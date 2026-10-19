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
async function mount(
  saved,
  { vibrate, workerAvailable = true, storage: storageOverride } = {},
) {
  const requests = [],
    workers = [],
    timers = new Map();
  const storage = new Map(
    saved != null ? [['playweft:pupdoku:v1', saved]] : [],
  );
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
    storage: storageOverride ?? {
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

test('invalid saves show precise errors, preserve the original and retry without resetting progress', async () => {
  const key = 'playweft:pupdoku:v1',
    valid = {
      game: puzzle.createGame(puzzle.generatePuzzle(8, 31)),
      level: 256,
    };
  const cases = [
    ['{broken', 'SAVE_JSON', /JSON/],
    ['', 'SAVE_JSON', /JSON/],
    ['null', 'SAVE_FORMAT', /根节点/],
    [JSON.stringify({ ...valid, level: 0 }), 'SAVE_LEVEL', /关卡编号.*0/],
    [
      JSON.stringify({ ...valid, level: { toString: null } }),
      'SAVE_LEVEL',
      /关卡编号.*toString/,
    ],
    [
      JSON.stringify({ ...valid, game: { ...valid.game, hearts: -1 } }),
      'HEARTS',
      /生命值.*-1/,
    ],
    [
      JSON.stringify({
        ...valid,
        game: { ...valid.game, cells: [4, ...valid.game.cells.slice(1)] },
      }),
      'CELL_VALUE',
      /第 1 行、第 1 列/,
    ],
    [
      JSON.stringify({
        ...valid,
        game: { ...valid.game, puzzle: { ...valid.game.puzzle, size: 7 } },
      }),
      'BOARD_SIZE',
      /棋盘大小.*7/,
    ],
  ];
  for (const [raw, code, reason] of cases) {
    const ui = await mount(raw);
    assert.equal(ui.el('storage-error').getAttribute('role'), 'alertdialog');
    assert.equal(ui.el('storage-error-code').textContent, code);
    assert.match(ui.el('storage-error-reason').textContent, reason);
    assert.equal(document.activeElement, ui.el('storage-retry'));
    ui.dispatch(ui.el('storage-retry'), 'keydown', {
      key: 'Tab',
      shiftKey: true,
    });
    assert.equal(document.activeElement, ui.el('storage-retry'));
    assert.equal(
      ui.requests.length,
      0,
      'failed restoration must not generate Level 1',
    );
    assert.equal(ui.controller.canEdit(), false);
    assert.equal(ui.el('restart').disabled, true);
    ui.controller.start();
    ui.controller.restart();
    await ui.controller.newGame();
    ui.controller.suspend();
    ui.click('storage-retry');
    assert.equal(
      ui.storage.get(key),
      raw,
      'retry and lifecycle events preserve the original',
    );
    assert.equal(ui.requests.length, 0);

    ui.storage.set(key, JSON.stringify(valid));
    ui.click('storage-retry');
    assert.equal(ui.el('storage-error'), null);
    assert.equal(ui.el('level').textContent, 'Level 256');
    assert.deepEqual(ui.controller.getSnapshot().game, valid.game);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.controller.canEdit(), true);
    ui.click('hint');
    assert.equal(
      ui.state().level,
      256,
      'saving resumes after a successful read',
    );
  }
  const ui = await mount('{broken');
  ui.controller.dispose();
  assert.equal(
    ui.storage.get(key),
    '{broken',
    'disposal also preserves the original',
  );
});

test('storage read exceptions display the browser error and remain retryable', async () => {
  const valid = JSON.stringify({
    game: puzzle.createGame(puzzle.generatePuzzle(8, 31)),
    level: 29,
  });
  let blocked = true,
    writes = 0;
  const ui = await mount(null, {
    storage: {
      getItem() {
        if (blocked)
          throw new window.DOMException('Access is denied', 'SecurityError');
        return valid;
      },
      setItem() {
        writes++;
      },
    },
  });
  assert.equal(ui.el('storage-error-code').textContent, 'STORAGE_READ');
  assert.match(
    ui.el('storage-error-reason').textContent,
    /SecurityError: Access is denied/,
  );
  ui.controller.suspend();
  ui.click('storage-retry');
  assert.equal(ui.requests.length, 0);
  assert.equal(writes, 0);
  blocked = false;
  ui.click('storage-retry');
  assert.equal(ui.el('storage-error'), null);
  assert.equal(ui.el('level').textContent, 'Level 29');
  assert.equal(writes, 0, 'a successful read alone does not rewrite the save');
});

test('the standalone controller uses IndexedDB even if native localStorage is inaccessible', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  let controller;
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new window.DOMException('Storage unavailable', 'SecurityError');
      },
    });
    controller = createPupdokuController();
    await controller.start();
    const error = controller.getSnapshot().storageError;
    assert.equal(error.code, 'STORAGE_READ');
    assert.match(error.reason, /IndexedDB is unavailable/);
    assert.equal(controller.getSnapshot().busy, false);
  } finally {
    controller?.dispose();
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

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

test('holding X paints repeated arrows and turns as one reversible stroke without changing pups or red notes', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  const pup = board.solution[0],
    red = (pup + 1) % board.size;
  game.cells[pup] = 2;
  game.cells[red] = 3;
  game.cells[(pup + 2) % board.size] = 1;
  const before = [...game.cells],
    pulses = [];
  const ui = await mount(JSON.stringify({ game, level: 3 }), {
    vibrate: (duration) => pulses.push(duration),
  });
  const focus = (index) => act(() => ui.el('board').children[index].focus());
  const key = (key, repeat = false) =>
    ui.dispatch(document.activeElement, 'keydown', { key, repeat });
  focus(board.size);
  key('X');
  assert.equal(
    ui.state().game.cells[board.size],
    1,
    'the initial mark appears immediately',
  );
  key('X', true);
  assert.equal(
    ui.state().game.cells[board.size],
    1,
    'autorepeat never toggles the starting cell',
  );
  for (let col = 1; col < board.size; col++) key('ArrowRight', true);
  key('ArrowUp');
  for (let col = 1; col < board.size; col++) key('ArrowLeft', true);
  key('ArrowLeft', true);
  key('ArrowRight');
  key('ArrowLeft');
  for (let i = 0; i < board.size * 2; i++)
    assert.equal(ui.state().game.cells[i], i === pup ? 2 : i === red ? 3 : 1);
  assert.equal(ui.state().game.history.length, 1);
  assert.equal(ui.state().game.hearts, 3);
  assert.deepEqual(pulses, []);
  ui.dispatch(window, 'keyup', { key: 'x' });
  key('ArrowDown');
  key('ArrowDown');
  assert.equal(
    ui.state().game.cells[board.size * 2],
    0,
    'arrows stop painting after keyup',
  );
  ui.click('undo');
  assert.deepEqual(ui.state().game.cells, before);
});

test('holding X from a red note erases a whole row with one history entry even at the undo limit', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  const pup = board.solution[0],
    red = (pup + 1) % board.size;
  game.cells.fill(1, 0, board.size);
  game.cells[pup] = 2;
  game.cells[red] = 3;
  game.history = Array.from({ length: 150 }, (_, i) => {
    const cells = Array(board.size ** 2).fill(0);
    cells[i % cells.length] = 1;
    return cells;
  });
  const before = [...game.cells],
    history = [...game.history];
  const ui = await mount(JSON.stringify({ game, level: 1 }));
  act(() => ui.el('board').children[red].focus());
  const key = (key) => ui.dispatch(document.activeElement, 'keydown', { key });
  key('x');
  for (let i = red; i < board.size - 1; i++) key('ArrowRight');
  for (let i = 1; i < board.size; i++) key('ArrowLeft');
  ui.dispatch(window, 'keyup', { key: 'X' });
  assert.deepEqual(
    ui.state().game.cells.slice(0, board.size),
    Array.from({ length: board.size }, (_, i) => (i === pup ? 2 : 0)),
  );
  assert.deepEqual(
    ui.state().game.history,
    [...history.slice(1), before],
    'only the first changed cell consumes a history slot',
  );
  ui.click('undo');
  assert.deepEqual(
    ui.state().game.cells,
    before,
    'Undo also restores the original red cross',
  );
});

test('keyboard strokes end on lost focus, navigation, suspension and other game actions', async () => {
  for (const reason of [
    'window blur',
    'board blur',
    'Tab',
    'Escape',
    'Home',
    'End',
    'visibility',
    'modifier',
    'suspend',
    'restart',
    'undo',
    'hint',
    'pointer',
    'new level',
    'dispose',
  ]) {
    const ui = await mount();
    await ui.finish();
    const focus = (index) => act(() => ui.el('board').children[index].focus());
    const key = (key, fields = {}) =>
      ui.dispatch(document.activeElement, 'keydown', { key, ...fields });
    focus(0);
    key('x');
    key('ArrowRight');
    if (reason === 'window blur') ui.dispatch(window, 'blur');
    else if (reason === 'board blur') act(() => ui.el('hint').focus());
    else if (['Tab', 'Escape', 'Home', 'End'].includes(reason)) key(reason);
    else if (reason === 'visibility') ui.dispatch(document, 'visibilitychange');
    else if (reason === 'modifier') key('ArrowRight', { ctrlKey: true });
    else if (reason === 'suspend') act(() => ui.controller.suspend());
    else if (reason === 'dispose') act(() => ui.controller.dispose());
    else if (reason === 'pointer') ui.tap(4);
    else if (reason === 'new level') {
      act(() => {
        void ui.controller.newGame();
      });
      await ui.finish();
    } else ui.click(reason);
    const size = ui.controller.getSnapshot().game.puzzle.size;
    const target = ui
      .state()
      .game.cells.findIndex((value, i) => value === 0 && i % size > 0);
    assert.ok(target >= 0);
    focus(target - 1);
    // The held key can still repeat after focus returns, but must not re-arm.
    key('x', { repeat: true });
    key('ArrowRight');
    assert.equal(ui.state().game.cells[target], 0, reason);
  }
});

test('a stroke starting on a pup records its first actual edit and later key presses start separate strokes', async () => {
  const board = puzzle.generateLevel(7),
    game = puzzle.createGame(board);
  const pup = board.solution[0];
  game.cells[pup] = 2;
  const ui = await mount(JSON.stringify({ game, level: 1 }));
  act(() => ui.el('board').children[pup].focus());
  const key = (key) => ui.dispatch(document.activeElement, 'keydown', { key });
  key('x');
  assert.equal(ui.state().game.history.length, 0);
  key('ArrowDown');
  assert.equal(ui.state().game.cells[pup + board.size], 1);
  assert.equal(ui.state().game.history.length, 1);
  ui.dispatch(window, 'keyup', { key: 'x' });
  key('x');
  key('ArrowDown');
  assert.equal(ui.state().game.cells[pup + board.size], 0);
  assert.equal(ui.state().game.cells[pup + 2 * board.size], 0);
  ui.dispatch(window, 'keyup', { key: 'x' });
  assert.equal(ui.state().game.history.length, 2);
  ui.click('undo');
  assert.equal(ui.state().game.cells[pup + board.size], 1);
  ui.click('undo');
  assert.equal(ui.state().game.cells[pup + board.size], 0);
  assert.equal(ui.state().game.cells[pup], 2);
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

test('hint highlights the complete covering proof as a single reversible action', async () => {
  const { dominated } = JSON.parse(
    await readFile(
      new URL('./fixtures/pupdoku-hint-dominance.json', import.meta.url),
      'utf8',
    ),
  );
  const fixture = dominated.find((item) => item.cross),
    game = puzzle.createGame(fixture.puzzle),
    candidates = new Set(fixture.candidates),
    placed = new Set(fixture.placed);
  game.cells = game.cells.map((_, i) =>
    placed.has(i) ? 2 : candidates.has(i) ? 0 : 1,
  );
  const before = [...game.cells],
    ui = await mount(JSON.stringify({ game, level: 4 }));
  ui.click('hint');
  const { preferred } = fixture;
  assert.deepEqual(
    ui.state().game.cells,
    before.map((value, i) => (preferred.removed.includes(i) ? 1 : value)),
  );
  assert.equal(ui.state().game.history.length, 1);
  assert.equal(
    ui.el('board').querySelectorAll('.hinted').length,
    preferred.removed.length,
  );
  assert.ok(
    preferred.sources.every((i) =>
      ui.el('board').children[i].classList.contains('source'),
    ),
  );
  assert.ok(
    ui.controller
      .getSnapshot()
      .message.includes(` ${preferred.removed.length} 格`),
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

test('async restoration waits for storage and never starts a replacement puzzle on read failure', async () => {
  let resolveRead, rejectRead, read;
  read = new Promise((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  });
  const raw = JSON.stringify({
    game: puzzle.createGame(puzzle.generatePuzzle(8, 31)),
    level: 256,
  });
  const ui = await mount(null, {
    storage: {
      getItem: () => read,
      setItem: async () => {
        assert.fail('a failed read must not overwrite progress');
      },
    },
  });
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.controller.getSnapshot().restoring, true);
  assert.equal(ui.el('loading').dataset.visible, 'true');
  await act(async () => {
    rejectRead(
      Object.assign(new Error('Platform storage unavailable'), {
        code: 'STORAGE_UNAVAILABLE',
      }),
    );
    await flush();
  });
  assert.equal(ui.el('storage-error-code').textContent, 'STORAGE_UNAVAILABLE');
  assert.equal(ui.requests.length, 0);
  read = Promise.resolve(raw);
  await act(async () => {
    ui.click('storage-retry');
    await flush();
  });
  assert.equal(ui.el('level').textContent, 'Level 256');
  assert.equal(ui.el('storage-error'), null);
  assert.equal(ui.requests.length, 0);
});

test('async saving coalesces pending snapshots in order and a failed commit retries current progress', async () => {
  const initial = JSON.stringify({
    game: puzzle.createGame(puzzle.generatePuzzle(8, 31)),
    level: 256,
  });
  let committed = initial,
    finishWrite,
    shouldFail = false;
  const writes = [];
  const ui = await mount(null, {
    storage: {
      getItem: async () => committed,
      setItem(rawKey, raw) {
        writes.push(raw);
        return new Promise((resolve, reject) => {
          finishWrite = () => {
            if (shouldFail)
              reject(new DOMException('Disk full', 'QuotaExceededError'));
            else {
              committed = raw;
              resolve();
            }
          };
        });
      },
    },
  });
  await act(flush);
  assert.equal(ui.el('level').textContent, 'Level 256');
  ui.click('hint');
  ui.controller.keyboardAction(0, 'x');
  ui.controller.keyboardAction(1, 'x');
  const latest = JSON.stringify({
    game: ui.controller.getSnapshot().game,
    level: 256,
  });
  assert.equal(writes.length, 1);
  assert.equal(committed, initial);
  await act(async () => {
    finishWrite();
    await flush();
  });
  assert.equal(writes.length, 2);
  assert.equal(writes[1], latest);
  shouldFail = true;
  await act(async () => {
    finishWrite();
    await flush();
  });
  assert.match(ui.el('storage-error-title').textContent, /保存失败/);
  assert.match(
    ui.el('storage-error-reason').textContent,
    /QuotaExceededError: Disk full/,
  );
  assert.equal(ui.controller.canEdit(), false);
  assert.notEqual(committed, latest);
  shouldFail = false;
  ui.click('storage-retry');
  await act(async () => {
    finishWrite();
    await flush();
  });
  assert.equal(committed, latest);
  assert.equal(ui.el('storage-error'), null);
  assert.equal(ui.controller.canEdit(), true);
  assert.equal(ui.el('level').textContent, 'Level 256');
});
