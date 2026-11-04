import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Window } from "happy-dom";
import * as rules from "../games/bubble-mischief-crew/game.js";
import { createTouchControls } from "../games/bubble-mischief-crew/touch-controls.js";
import { BubbleGamepadInput } from "../games/bubble-mischief-crew/gamepad.js";
async function mount({ deferred = false, stateFactory = rules.createGame, floating = false, pads = null, playerId = "local-0" } = {}) {
  const window = new Window(),
    document = window.document;
  document.write(
    await readFile(
      new URL("../games/bubble-mischief-crew/index.html", import.meta.url),
      "utf8",
    ),
  );
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
  document.getElementById("joystick").getBoundingClientRect = () => ({
    left: 20,
    top: 500,
    width: 128,
    height: 128,
  });
  if (floating) {
    document.getElementById("pitch").getBoundingClientRect = () => ({ left: 200, top: 0, width: 600, height: 500 });
    document.querySelector(".side-actions").getBoundingClientRect = () => ({ bottom: 400 });
  }
  window.HTMLCanvasElement.prototype.getContext = () => ({ scale() {} });
  let rendered, renderedPoses;
  let bridge,
    frame,
    pulse,
    now = 1000;
  const actions = [],
    replies = [];
  let focused = true;
  if (pads) {
    window.navigator.getGamepads = () => pads;
    document.hasFocus = () => focused;
  }
  class Bridge extends EventTarget {
    context = { playerId };
    constructor() {
      super();
      bridge = this;
    }
    action(a) {
      actions.push(a);
      return deferred
        ? new Promise((resolve) => replies.push(resolve))
        : Promise.resolve({ accepted: true });
    }
  }
  const scope = {
    ...rules,
    createGame: stateFactory,
    createTouchControls,
    BubbleGamepadInput,
    render(_ctx, state, _now, options) {
      rendered = structuredClone(state);
      renderedPoses = new Map(options.positions);
    },
    drawPlayer() {},
    PlayweftBridge: Bridge,
    window,
    document,
    getComputedStyle: window.getComputedStyle.bind(window),
    performance: { now: () => now },
    Date,
    Math,
    setInterval(fn) {
      pulse = fn;
    },
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame(fn) {
      frame = fn;
    },
  };
  const source = (
    await readFile(
      new URL("../games/bubble-mischief-crew/main.js", import.meta.url),
      "utf8",
    )
  ).replace(/^import[^\n]+\n/gm, "");
  vm.runInNewContext(source, scope);
  const dispatch = (type, detail) => {
    const event = new Event(type);
    event.detail = detail;
    bridge.dispatchEvent(event);
  };
  return {
    window,
    document,
    actions,
    replies,
    get state() {
      return rendered;
    },
    get poses() {
      return renderedPoses;
    },
    pulse: () => pulse(),
    frame(ms = 100) {
      now += ms;
      frame(now);
    },
    dispatch,
    focus(value) {
      focused = value;
      window.dispatchEvent(new window.Event(value ? "focus" : "blur"));
    },
    close: () => window.happyDOM.close(),
  };
}
const flush = () => new Promise((r) => setImmediate(r));
function controller(index = 0) {
  return { index, id: `Controller ${index}`, connected: true, mapping: "standard", axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
}

test("gamepad starts, moves while using items, pauses and resumes without replaying held buttons", async () => {
  const p = controller(), pads = [p];
  const stateFactory = options => {
    const s = rules.createGame(options);
    s.players[0].inventory = [{ kind: "glue", count: 3 }, { kind: "banana", count: 2 }];
    return s;
  };
  const ui = await mount({ pads, stateFactory });
  try {
    const $ = id => ui.document.getElementById(id);
    ui.frame();
    assert.equal($("gamepad-status").textContent, "手柄：1P");
    p.buttons[0].pressed = true; ui.frame();
    assert.equal($("overlay").hidden, true);
    for (let i = 0; i < 160; i++) ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count, 3, "held confirm must not place glue after the countdown");
    p.buttons[0].pressed = false; ui.frame(20);
    const before = ui.state.players[0].x;
    p.axes[0] = 1; p.buttons[2].pressed = true; ui.frame(20);
    assert.ok(ui.state.players[0].x > before);
    assert.equal(ui.state.players[0].inventory[1].count, 1);
    ui.frame(20);
    assert.equal(ui.state.players[0].inventory[1].count, 1, "held item buttons must not repeat");
    p.buttons[9].pressed = true; ui.frame(20);
    assert.equal($("overlay").hidden, false);
    const frozen = ui.state.players[0].x;
    p.buttons[9].pressed = false; p.buttons[0].pressed = false; p.axes[0] = 0; ui.frame(20);
    p.buttons[0].pressed = true; ui.frame(20);
    assert.equal($("overlay").hidden, true);
    assert.equal(ui.state.players[0].x, frozen);
    assert.equal(ui.state.players[0].inventory[0].count, 3);
    p.buttons[0].pressed = false; ui.frame(20);
    p.axes[0] = -1; ui.frame(20);
    pads.splice(0); ui.frame(20);
    assert.equal($("overlay").hidden, false, "disconnecting a used controller pauses local play");
  } finally { await ui.close(); }
});

test("two gamepads independently control local players; one gamepad also works alongside player-two keyboard controls", async () => {
  const a = controller(), b = controller(1), pads = [a, b];
  const stateFactory = options => {
    const s = rules.createGame(options);
    s.players.forEach(p => p.inventory = [{ kind: "glue", count: 3 }, { kind: "banana", count: 2 }]);
    return s;
  };
  const ui = await mount({ pads, stateFactory });
  try {
    ui.frame(); a.buttons[5].pressed = true; ui.frame();
    assert.equal(ui.document.querySelector('[data-mode="local"]').classList.contains("selected"), true);
    a.buttons[5].pressed = false; ui.frame();
    ui.document.getElementById("start").click();
    for (let i = 0; i < 160; i++) ui.frame(20);
    const before = ui.state.players.map(p => p.x);
    a.axes[0] = 1; b.axes[0] = -1;
    a.buttons[0].pressed = true; b.buttons[2].pressed = true;
    ui.frame(20);
    assert.ok(ui.state.players[0].x > before[0]);
    assert.ok(ui.state.players[1].x < before[1]);
    assert.equal(ui.state.players[0].inventory[0].count, 2);
    assert.equal(ui.state.players[1].inventory[1].count, 1);
    assert.equal(ui.state.players[0].inventory[1].count, 2);
    assert.equal(ui.state.players[1].inventory[0].count, 3);
    assert.match(ui.document.getElementById("gamepad-status").textContent, /1P \/ 2P/);
    // An unused reconnect is baselined, and a keyboard can take over either seat.
    ui.focus(false); b.connected = false; ui.frame();
    ui.focus(true); a.axes[0] = 0; a.buttons[0].pressed = false; ui.frame();
    ui.document.getElementById("start").click(); ui.frame();
    ui.window.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    a.axes[0] = 1; ui.frame(20);
    assert.equal(ui.state.players[0].input, 0);
    assert.equal(ui.state.players[1].input, 2);
  } finally { await ui.close(); }
});

test("room gamepad controls only its own seat, releases on focus loss, and never controls a spectator", async () => {
  const a = controller(), extra = controller(1), pads = [a, extra];
  const ui = await mount({ pads, playerId: "local-2" });
  try {
    ui.dispatch("initialize", { mode: "room" });
    const state = rules.createGame({ humans: 4 }); state.phase = "playing";
    state.players[2].inventory = [{ kind: "glue", count: 3 }];
    ui.dispatch("state", { state, serverTime: Date.now() }); ui.frame();
    a.axes[0] = 1; a.buttons[0].pressed = true;
    extra.buttons[3].pressed = true; ui.frame(); ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).dir, 0);
    assert.equal(ui.actions.at(-1).itemSlot, 1);
    assert.equal(ui.actions.at(-1).itemSeq, 1);
    ui.focus(false); ui.frame(); await flush(); ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).dir, -1);
    ui.focus(true); ui.frame(); ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).dir, -1, "held stick must be centred after focus returns");
    a.axes[0] = 0; a.buttons[0].pressed = false; ui.frame();
    a.axes[0] = 1; ui.frame(); ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).dir, 0);
    pads.splice(0); ui.frame(); ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).dir, -1);
    a.axes[0] = 0; a.buttons[0].pressed = false; pads.push(a);
    state.phase = "ended"; state.winner = 0;
    ui.dispatch("state", { state, serverTime: Date.now() }); ui.frame();
    a.buttons[0].pressed = true; ui.frame(); ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).type, "rematch");
  } finally { await ui.close(); }
  const viewer = await mount({ pads: [a], playerId: "watch" });
  try {
    enterRoom(viewer);
    a.buttons[0].pressed = a.buttons[9].pressed = true; a.axes[0] = 1;
    viewer.frame(); viewer.pulse(); await flush();
    assert.deepEqual(viewer.actions, []);
    assert.equal(viewer.document.getElementById("gamepad-status").hidden, true);
  } finally { await viewer.close(); }
});

test("a denied Gamepad API leaves keyboard play available", async () => {
  const ui = await mount({ pads: [] });
  try {
    ui.window.navigator.getGamepads = () => { throw new ui.window.DOMException("Blocked", "SecurityError"); };
    ui.frame(); ui.document.getElementById("start").click();
    for (let i = 0; i < 160; i++) ui.frame(20);
    ui.window.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "d" }));
    const x = ui.state.players[0].x;
    ui.frame(20);
    assert.ok(ui.state.players[0].x > x);
    assert.equal(ui.document.getElementById("gamepad-status").hidden, true);
  } finally { await ui.close(); }
});

test("local screen starts, pauses, resumes and switches to independent two-player controls", async () => {
  const ui = await mount();
  try {
    const $ = (id) => ui.document.getElementById(id);
    ui.frame();
    $("start").click();
    ui.frame();
    assert.equal($("overlay").hidden, true);
    assert.equal($("pause").disabled, false);
    $("pause").click();
    assert.equal($("overlay").hidden, false);
    assert.match($("overlay-title").textContent, /暂停/);
    $("start").click();
    assert.equal($("overlay").hidden, true);
    assert.match($("pause").textContent, /暂停/);
    ui.document.querySelector('[data-mode="local"]').click();
    assert.equal($("p2-controls").hidden, false);
    assert.match($("overlay-title").textContent, /泡泡捣蛋团/);
    assert.equal($("pause").disabled, true);
  } finally {
    await ui.close();
  }
});
test("rematch click survives an in-flight heartbeat and stops retrying after authoritative vote", async () => {
  const ui = await mount({ deferred: true });
  try {
    const $ = (id) => ui.document.getElementById(id);
    ui.dispatch("initialize", { mode: "room" });
    let state = rules.createGame({ humans: 4 });
    state.phase = "ended";
    state.winner = 0;
    const snapshot = () =>
      ui.dispatch("state", {
        state: structuredClone(state),
        serverTime: Date.now(),
      });
    snapshot();
    ui.frame();
    ui.pulse();
    assert.equal(ui.actions.at(-1).type, "input");
    $("start").click();
    ui.pulse();
    assert.equal(ui.actions.length, 1);
    ui.replies.shift()({ accepted: true });
    await flush();
    ui.pulse();
    assert.equal(ui.actions.at(-1).type, "rematch");
    ui.replies.shift()({ accepted: true });
    await flush();
    state.players[0].rematch = true;
    snapshot();
    assert.equal($("start").disabled, true);
    ui.pulse();
    assert.equal(ui.actions.at(-1).type, "input");
    ui.replies.shift()({ accepted: true });
    await flush();
    state.round = 2;
    state.phase = "countdown";
    state.players[0].rematch = false;
    snapshot();
    ui.frame();
    assert.equal($("start").disabled, false);
    assert.equal($("overlay").hidden, true);
    assert.equal($("roster-count").textContent, "2 VS 2");
  } finally {
    await ui.close();
  }
});

function pointer(ui, target, type, id, x, y) {
  target.dispatchEvent(
    new ui.window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: id,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}
function enterRoom(ui) {
  ui.dispatch("initialize", { mode: "room" });
  const state = rules.createGame({ humans: 4 });
  state.phase = "playing";
  ui.dispatch("state", { state, serverTime: Date.now() });
  ui.frame();
}
async function sampledInput(ui) {
  ui.pulse();
  await flush();
  const { dir } = ui.actions.at(-1);
  return { dir };
}
test("joystick steers without a kick button, ignores a second pointer, and resets on release outside", async () => {
  const ui = await mount();
  try {
    enterRoom(ui);
    const stick = ui.document.getElementById("joystick");
    assert.equal(ui.document.getElementById("touch-kick"), null);
    pointer(ui, stick, "pointerdown", 7, 84, 564);
    assert.deepEqual(await sampledInput(ui), { dir: -1 });
    assert.equal(stick.hasPointerCapture(7), true);
    pointer(ui, stick, "pointermove", 7, 190, 564);
    assert.deepEqual(await sampledInput(ui), { dir: 0 });
    pointer(ui, stick, "pointerdown", 8, 84, 460);
    pointer(ui, stick, "pointermove", 8, 84, 460);
    pointer(ui, stick, "pointerup", 8, 84, 460);
    assert.deepEqual(await sampledInput(ui), { dir: 0 });
    pointer(ui, stick, "pointermove", 7, 84, 460);
    assert.deepEqual(await sampledInput(ui), { dir: 3 });
    pointer(ui, stick, "pointerup", 7, 900, 800);
    assert.deepEqual(await sampledInput(ui), { dir: -1 });
    assert.equal(stick.style.getPropertyValue("--stick-x"), "0px");
    assert.equal(stick.style.getPropertyValue("--stick-y"), "0px");
  } finally {
    await ui.close();
  }
});
test("cancel, capture loss, focus loss and resize release the joystick without erasing keyboard input", async () => {
  const ui = await mount();
  try {
    enterRoom(ui);
    const stick = ui.document.getElementById("joystick");
    for (const event of ["pointercancel", "lostpointercapture"]) {
      pointer(ui, stick, "pointerdown", 1, 20, 564);
      assert.deepEqual(await sampledInput(ui), { dir: 2 });
      pointer(ui, stick, event, 1, 0, 0);
      assert.deepEqual(await sampledInput(ui), { dir: -1 });
    }
    ui.window.dispatchEvent(
      new ui.window.KeyboardEvent("keydown", { key: "d" }),
    );
    pointer(ui, stick, "pointerdown", 1, 20, 564);
    assert.deepEqual(await sampledInput(ui), { dir: 2 });
    pointer(ui, stick, "pointercancel", 1, 0, 0);
    assert.deepEqual(await sampledInput(ui), { dir: 0 });
    ui.window.dispatchEvent(new ui.window.KeyboardEvent("keyup", { key: "d" }));
    for (const event of ["blur", "resize"]) {
      pointer(ui, stick, "pointerdown", 1, 84, 700);
      assert.deepEqual(await sampledInput(ui), { dir: 1 });
      ui.window.dispatchEvent(new ui.window.Event(event));
      await flush();
      assert.deepEqual(await sampledInput(ui), { dir: -1 });
    }
  } finally {
    await ui.close();
  }
});
test("standalone portrait blocks play, then landscape resumes with continuous linear motion", async () => {
  const ui = await mount();
  try {
    ui.window.innerWidth = 390;
    ui.window.innerHeight = 844;
    ui.window.dispatchEvent(new ui.window.Event("resize"));
    ui.document.getElementById("start").click();
    ui.frame();
    assert.equal(ui.document.getElementById("overlay").hidden, false);
    ui.window.innerWidth = 844;
    ui.window.innerHeight = 390;
    ui.window.dispatchEvent(new ui.window.Event("resize"));
    ui.document.getElementById("start").click();
    for (let i = 0; i < 150; i++) ui.frame(20);
    assert.equal(ui.document.getElementById("timer").textContent, "03:57");
    ui.window.dispatchEvent(
      new ui.window.KeyboardEvent("keydown", { key: "d" }),
    );
    const initial = ui.state.players[0].x;
    for (let i = 1; i <= 4; i++) {
      ui.frame(20);
      assert.ok(Math.abs(ui.state.players[0].x - initial - i * 0.102) < 1e-10);
    }
    const visible = ui.poses.get(0).x;
    ui.frame(10);
    assert.ok(Math.abs(ui.poses.get(0).x - visible - 0.051) < 1e-10);
    ui.window.innerWidth = 390;
    ui.window.innerHeight = 844;
    ui.window.dispatchEvent(new ui.window.Event("resize"));
    const before = ui.state.players[0].x;
    ui.frame(100);
    assert.equal(ui.state.players[0].x, before);
  } finally {
    await ui.close();
  }
});

test('right-hand item buttons and numbered inventory retry across in-flight inputs until acknowledged', async () => {
  const ui=await mount({deferred:true});
  try {
    ui.dispatch('initialize',{mode:'room'});
    const state=rules.createGame({humans:4});state.phase='playing';
    state.players[0].inventory=[{kind:'glue',count:3},{kind:'banana',count:1},{kind:'fork',count:1}];
    const snapshot=()=>{ui.dispatch('state',{state:structuredClone(state),serverTime:Date.now()});ui.frame();};
    snapshot();
    const glue=ui.document.querySelector('[data-item-kind="glue"]');
    const fork=ui.document.querySelector('[data-item-kind="fork"]');
    assert.equal(glue.disabled,false);assert.equal(glue.querySelector('b').textContent,'3');
    assert.equal(fork.disabled,true);
    ui.pulse();glue.click();ui.pulse();assert.equal(ui.actions.length,1);
    ui.replies.shift()({accepted:true});await flush();ui.pulse();
    assert.equal(ui.actions.at(-1).itemSlot,1);assert.equal(ui.actions.at(-1).itemSeq,1);
    ui.replies.shift()({accepted:true});await flush();ui.pulse();
    assert.equal(ui.actions.at(-1).itemSeq,1);
    ui.replies.shift()({accepted:true});await flush();
    state.players[0].itemSeq=1;state.players[0].inventory[0].count=2;snapshot();ui.pulse();
    assert.equal(ui.actions.at(-1).itemSlot,undefined);
    ui.replies.shift()({accepted:true});await flush();
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'2',code:'Digit2'}));
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'2',code:'Digit2',repeat:true}));
    ui.pulse();assert.equal(ui.actions.at(-1).itemSlot,2);assert.equal(ui.actions.at(-1).itemSeq,2);
    ui.replies.shift()({accepted:true});await flush();
    state.players[0].itemSeq=2;state.players[0].status='bubble';snapshot();
    assert.equal(glue.disabled,true);assert.equal(fork.disabled,false);
    fork.click();ui.pulse();assert.equal(ui.actions.at(-1).itemSlot,3);
    ui.replies.shift()({accepted:true});await flush();
  } finally {await ui.close();}
});

test('local numpad item controls operate player two independently and ignore key repeat', async () => {
  const stateFactory=options=>{
    const s=rules.createGame(options);
    s.players.forEach(p=>p.inventory=[{kind:'glue',count:3}]);return s;
  };
  const ui=await mount({stateFactory});
  try {
    ui.document.querySelector('[data-mode="local"]').click();ui.document.getElementById('start').click();
    for(let i=0;i<150;i++)ui.frame(20);
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'1',code:'Numpad1'}));
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'1',code:'Numpad1',repeat:true}));ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,3);
    assert.equal(ui.state.players[1].inventory[0].count,2);
    assert.equal(ui.state.traps[0].owner,ui.state.players[1].id);
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'1',code:'Digit1'}));ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,2);
    assert.equal(ui.state.traps[1].owner,ui.state.players[0].id);
  } finally {await ui.close();}
});

test('held keyboard movement continues while placing an item from a number key or right-hand button', async () => {
  const stateFactory = options => {
    const s = rules.createGame(options);
    s.players[0].inventory = [{kind:'glue',count:3},{kind:'banana',count:1}];
    return s;
  };
  const ui = await mount({stateFactory});
  try {
    ui.document.getElementById('start').click();
    for(let i=0;i<150;i++)ui.frame(20);
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'d',code:'KeyD'}));
    ui.frame(100);
    const x = ui.state.players[0].x;
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'1',code:'Digit1'}));
    ui.frame(100);
    assert.ok(ui.state.players[0].x > x);
    assert.equal(ui.state.players[0].input,0);
    assert.equal(ui.state.players[0].inventory[0].count,2);
    const afterKey = ui.state.players[0].x;
    ui.document.querySelector('[data-item-kind="banana"]').click();
    ui.frame(100);
    assert.ok(ui.state.players[0].x > afterKey);
    assert.equal(ui.state.players[0].inventory[1].count,0);
    assert.equal(ui.state.traps.length,2);
  } finally { await ui.close(); }
});

test('a second finger can place an item while the joystick remains held in a room', async () => {
  const ui = await mount();
  try {
    ui.dispatch('initialize',{mode:'room'});
    const state=rules.createGame({humans:4});state.phase='playing';
    state.players[0].inventory=[{kind:'glue',count:3}];
    ui.dispatch('state',{state,serverTime:Date.now()});ui.frame();
    const stick=ui.document.getElementById('joystick');
    const button=ui.document.querySelector('[data-item-kind="glue"]');
    pointer(ui,stick,'pointerdown',7,190,564);
    pointer(ui,button,'pointerdown',8,900,564);
    ui.pulse();await flush();
    assert.equal(ui.actions.at(-1).dir,0);
    assert.equal(ui.actions.at(-1).itemSlot,1);
    assert.equal(stick.hasPointerCapture(7),true);
    pointer(ui,button,'pointerup',8,900,564);
  } finally { await ui.close(); }
});

test('left-side touch starts neutral at its own origin and can steer while a second finger uses an item', async () => {
  const ui = await mount({ floating: true });
  try {
    ui.dispatch('initialize', { mode: 'room' });
    const state = rules.createGame({ humans: 4 }); state.phase = 'playing';
    state.players[0].inventory = [{ kind: 'glue', count: 3 }];
    ui.dispatch('state', { state, serverTime: Date.now() }); ui.frame();
    const stick = ui.document.getElementById('joystick');
    pointer(ui, ui.document.body, 'pointerdown', 7, 180, 564);
    assert.deepEqual(await sampledInput(ui), { dir: -1 });
    assert.equal(stick.hasPointerCapture(7), true);
    pointer(ui, stick, 'pointermove', 7, 210, 564);
    pointer(ui, ui.document.querySelector('[data-item-kind="glue"]'), 'pointerdown', 8, 900, 564);
    ui.pulse(); await flush();
    assert.equal(ui.actions.at(-1).dir, 0);
    assert.equal(ui.actions.at(-1).itemSlot, 1);
    pointer(ui, stick, 'pointerup', 7, 1000, 800);
    assert.deepEqual(await sampledInput(ui), { dir: -1 });
  } finally { await ui.close(); }
});

test('touch item presses fire immediately during movement and compatibility clicks do not consume twice', async () => {
  const stateFactory=options=>{
    const s=rules.createGame(options);
    s.players[0].inventory=[{kind:'glue',count:3}];return s;
  };
  const ui=await mount({stateFactory});
  try {
    ui.document.getElementById('start').click();
    for(let i=0;i<150;i++)ui.frame(20);
    const stick=ui.document.getElementById('joystick');
    const button=ui.document.querySelector('[data-item-kind="glue"]');
    pointer(ui,stick,'pointerdown',7,190,564);
    ui.frame(100);
    const before=ui.state.players[0].x;
    pointer(ui,button,'pointerdown',8,900,564);
    ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,2,'consume on second-finger down, without any click');
    assert.ok(ui.state.players[0].x>before);
    assert.equal(stick.hasPointerCapture(7),true);
    pointer(ui,button,'pointerup',8,900,564);
    button.dispatchEvent(new ui.window.MouseEvent('click',{bubbles:true,detail:1}));
    ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,2,'ignore the later compatibility click');
    assert.equal(ui.state.traps.length,1);
    const slot=ui.document.querySelector('[data-item-slot="1"]');
    pointer(ui,slot,'pointerdown',9,500,700);
    ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,1,'inventory slots use the same pointer-down input');
    pointer(ui,slot,'pointerup',9,500,700);
    slot.dispatchEvent(new ui.window.MouseEvent('click',{bubbles:true,detail:1}));
    ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,1);
    button.click();ui.frame(20);
    assert.equal(ui.state.players[0].inventory[0].count,0,'keyboard/accessibility click remains supported');
    assert.equal(stick.hasPointerCapture(7),true);
  } finally {await ui.close();}
});
