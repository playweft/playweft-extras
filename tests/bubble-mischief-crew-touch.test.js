import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createTouchControls } from '../games/bubble-mischief-crew/touch-controls.js';

function setup() {
  const window = new Window(), document = window.document;
  document.body.innerHTML = '<div id="mount"><div id="stick"></div></div><button id="item">item</button>';
  const stick = document.getElementById('stick'), mount = stick.parentElement;
  let captured = null;
  stick.setPointerCapture = id => { captured = id; };
  stick.hasPointerCapture = id => captured === id;
  stick.releasePointerCapture = () => { captured = null; };
  stick.getBoundingClientRect = () => ({
    left: parseFloat(mount.style.getPropertyValue('--stick-left')) || 0,
    top: parseFloat(mount.style.getPropertyValue('--stick-top')) || 0,
    width: 100, height: 100,
  });
  const bounds = { left: 16, right: 240, top: 200, bottom: 440, homeX: 140, homeY: 340 };
  const changes = [];
  const controls = createTouchControls({ joystick: stick, activationArea: document,
    getActivationBounds: () => bounds, onChange: value => changes.push(value.dir) });
  const pointer = (target, type, x, y, id = 1, pointerType = 'touch') => {
    const event = new window.PointerEvent(type, { bubbles: true, cancelable: true,
      pointerId: id, pointerType, clientX: x, clientY: y, button: 0 });
    target.dispatchEvent(event); return event;
  };
  return { window, document, stick, mount, bounds, changes, controls, pointer,
    get captured() { return captured; }, close: () => window.happyDOM.close() };
}

test('floating control appears at a new touch origin and stays neutral until the thumb moves', async () => {
  const ui = setup();
  try {
    ui.pointer(ui.document.body, 'pointerdown', 180, 320);
    assert.equal(ui.captured, 1);
    assert.equal(ui.mount.style.getPropertyValue('--stick-left'), '130px');
    assert.equal(ui.mount.style.getPropertyValue('--stick-top'), '270px');
    assert.deepEqual(ui.changes, []);
    ui.pointer(ui.stick, 'pointermove', 183, 320);
    assert.deepEqual(ui.changes, []);
    ui.pointer(ui.stick, 'pointermove', 205, 320);
    assert.deepEqual(ui.changes, [0]);
    ui.pointer(ui.stick, 'pointermove', 155, 320);
    assert.deepEqual(ui.changes, [0, 2]);
  } finally { await ui.close(); }
});

test('clamping the artwork away from screen edges never changes the actual input origin', async () => {
  const ui = setup();
  try {
    ui.pointer(ui.document.body, 'pointerdown', 20, 205);
    assert.equal(ui.mount.style.getPropertyValue('--stick-left'), '16px');
    assert.equal(ui.mount.style.getPropertyValue('--stick-top'), '200px');
    assert.deepEqual(ui.changes, []);
    ui.pointer(ui.stick, 'pointermove', 45, 205);
    assert.deepEqual(ui.changes, [0]);
  } finally { await ui.close(); }
});

test('outside touches, mouse clicks and item buttons do not start a floating touch control', async () => {
  const ui = setup();
  try {
    for (const [x, y] of [[10, 300], [250, 300], [180, 190], [180, 450]]) {
      assert.equal(ui.pointer(ui.document.body, 'pointerdown', x, y).defaultPrevented, false);
    }
    ui.pointer(ui.document.body, 'pointerdown', 180, 320, 1, 'mouse');
    ui.pointer(ui.document.getElementById('item'), 'pointerdown', 180, 320);
    assert.equal(ui.captured, null);
    assert.deepEqual(ui.changes, []);
  } finally { await ui.close(); }
});

test('second fingers cannot replace or release the active thumb, including item touches', async () => {
  const ui = setup();
  try {
    ui.pointer(ui.document.body, 'pointerdown', 180, 320);
    ui.pointer(ui.stick, 'pointermove', 205, 320);
    ui.pointer(ui.document.getElementById('item'), 'pointerdown', 190, 350, 2);
    ui.pointer(ui.stick, 'pointermove', 180, 290, 2);
    ui.pointer(ui.stick, 'pointerup', 180, 290, 2);
    assert.equal(ui.captured, 1);
    assert.deepEqual(ui.changes, [0]);
    ui.pointer(ui.stick, 'pointerup', 1000, 800);
    assert.equal(ui.captured, null);
    assert.deepEqual(ui.changes, [0, -1]);
  } finally { await ui.close(); }
});

test('release, cancellation, capture loss and resize reset the origin and restore the home hint', async () => {
  const ui = setup();
  try {
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'reset']) {
      ui.pointer(ui.document.body, 'pointerdown', 180, 320);
      ui.pointer(ui.stick, 'pointermove', 180, 290);
      if (event === 'reset') { ui.bounds.homeX = 170; ui.controls.reset(); }
      else ui.pointer(ui.stick, event, 1000, 800);
      assert.equal(ui.captured, null);
      assert.equal(ui.changes.at(-1), -1);
      assert.equal(ui.stick.style.getPropertyValue('--stick-x'), '0px');
      assert.equal(ui.stick.style.getPropertyValue('--stick-y'), '0px');
      assert.equal(ui.mount.style.getPropertyValue('--stick-left'), `${ui.bounds.homeX - 50}px`);
      assert.equal(ui.mount.style.getPropertyValue('--stick-top'), '290px');
    }
  } finally { await ui.close(); }
});
