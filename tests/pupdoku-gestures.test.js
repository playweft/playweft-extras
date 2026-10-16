import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardGestures, crossedCells } from '../games/pupdoku/gestures.js';

test('timer adapters are unbound, as required by browser timers', () => {
  let callback,
    marked = false;
  const gestures = new BoardGestures({
    size: () => 8,
    getValue: () => 0,
    onPup() {},
    onPreview() {},
    onMarks(indices, value) {
      assert.deepEqual(indices, [0]);
      assert.equal(value, 1);
      marked = true;
    },
    schedule(fn, delay) {
      assert.equal(this, undefined);
      assert.equal(delay, 280);
      callback = fn;
      return 1;
    },
    unschedule() {
      assert.equal(this, undefined);
    },
  });
  gestures.start(0, 10, 10, 1);
  gestures.end(1);
  assert.equal(marked, true, 'the timer must not delay the first tap');
  marked = false;
  callback();
  assert.equal(marked, false, 'expiration only closes the double-tap window');
  gestures.start(0, 10, 10, 1);
  gestures.end(1);
  assert.equal(marked, true);
});

test('fast vertical and diagonal strokes cover all crossed cells; other pointers are ignored', () => {
  assert.deepEqual(crossedCells(0, 56, 8), [0, 8, 16, 24, 32, 40, 48, 56]);
  assert.deepEqual(crossedCells(0, 63, 8), [0, 9, 18, 27, 36, 45, 54, 63]);
  let marked = [];
  const gestures = new BoardGestures({
    size: () => 8,
    getValue: () => 0,
    onPup() {},
    onPreview() {},
    onMarks(indices) {
      marked = indices;
    },
  });
  gestures.start(0, 10, 10, 1);
  assert.equal(gestures.start(63, 470, 470, 2), false);
  gestures.move(63, 470, 470, 2);
  gestures.end(2);
  gestures.move(7, 470, 10, 1);
  gestures.end(1);
  assert.deepEqual(marked, [0, 1, 2, 3, 4, 5, 6, 7]);
});
