import test from "node:test";
import assert from "node:assert/strict";
import { BubbleGamepadInput } from "../games/bubble-mischief-crew/gamepad.js";

function pad(index = 0, id = "Standard controller") {
  return { index, id, connected: true, mapping: "standard", axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
}

test("held controls are baselined on connection and reset; movement requires a neutral release", () => {
  const input = new BubbleGamepadInput(), p = pad();
  p.axes[0] = 1; p.buttons[0].pressed = true;
  assert.equal(input.poll([p], 0).players[0].dir, -1);
  assert.deepEqual(input.poll([p], 1000).actions, []);
  p.axes[0] = 0; p.buttons[0].pressed = false;
  input.poll([p], 1010);
  p.axes[0] = 1; p.buttons[0].pressed = true;
  const active = input.poll([p], 1020);
  assert.equal(active.players[0].dir, 0);
  assert.deepEqual(active.actions, [{ player: 0, type: "item", kind: "glue" }]);
  assert.deepEqual(input.poll([p], 2000).actions, []);
  input.reset();
  assert.equal(input.poll([p], 2010).players[0].dir, -1);
  assert.deepEqual(input.poll([p], 2020).actions, []);
});

test("stick dead zones and axis hysteresis prevent drift and diagonal chatter; D-pad overrides stick", () => {
  const input = new BubbleGamepadInput(), p = pad();
  input.poll([p], 0);
  p.axes = [.2, -.3];
  assert.equal(input.poll([p], 10).players[0].dir, -1);
  p.axes = [.8, .7];
  assert.equal(input.poll([p], 20).players[0].dir, 0);
  p.axes = [.7, .75];
  assert.equal(input.poll([p], 30).players[0].dir, 0);
  p.axes = [.6, .9];
  assert.equal(input.poll([p], 40).players[0].dir, 1);
  p.buttons[12].pressed = true;
  assert.equal(input.poll([p], 50).players[0].dir, 3);
  p.buttons[12].pressed = false; p.axes = [NaN, Infinity];
  assert.equal(input.poll([p], 60).players[0].dir, -1);
});

test("two controllers keep their player assignments across sparse indexes and another controller's disconnect", () => {
  const input = new BubbleGamepadInput(), a = pad(3, "A"), b = pad(8, "B"), extra = pad(10, "C");
  input.poll([null, a, null, b, extra], 0, 2);
  a.buttons[15].pressed = true; b.buttons[12].pressed = true;
  assert.deepEqual(input.poll([b, a, extra], 10, 2).players.map(p => p.dir), [0, 3]);
  const lost = input.poll([b], 20, 2);
  assert.deepEqual(lost.disconnected, [0]);
  assert.deepEqual(lost.players.map(p => p.dir), [-1, 3]);
  a.buttons[15].pressed = false;
  assert.deepEqual(input.poll([a, b], 30, 2).players.map(p => p.dir), [-1, 3]);
});

test("one-seat mode ignores extra controllers and capacity changes baseline held buttons", () => {
  const input = new BubbleGamepadInput(), a = pad(), b = pad(1);
  input.poll([a, b], 0);
  b.buttons[0].pressed = true;
  assert.deepEqual(input.poll([a, b], 10).actions, []);
  assert.deepEqual(input.poll([a, b], 20, 2).actions, []);
  b.buttons[0].pressed = false; input.poll([a, b], 30, 2);
  b.buttons[3].pressed = true;
  assert.deepEqual(input.poll([a, b], 40, 2).actions, [{ player: 1, type: "item", kind: "fork" }]);
});

test("item edges work alongside held movement; menu chords do not spill into item actions", () => {
  const input = new BubbleGamepadInput(), p = pad();
  input.poll([p], 0);
  p.axes[0] = 1; p.buttons[2].pressed = true;
  const moving = input.poll([p], 10);
  assert.equal(moving.players[0].dir, 0);
  assert.deepEqual(moving.actions, [{ player: 0, type: "item", kind: "banana" }]);
  p.buttons[8].pressed = p.buttons[9].pressed = p.buttons[0].pressed = true;
  assert.deepEqual(input.poll([p], 20).actions, []);
  p.buttons[8].pressed = p.buttons[9].pressed = false;
  assert.deepEqual(input.poll([p], 30).actions, []);
  assert.equal(input.poll([p], 40).players[0].dir, -1);
  p.axes[0] = 0; p.buttons[0].pressed = false; input.poll([p], 50);
  p.buttons[9].pressed = true;
  assert.deepEqual(input.poll([p], 60).actions, [{ player: 0, type: "menu" }]);
});

test("unsupported mappings cannot control the game and unused disconnects do not interrupt keyboard play", () => {
  const input = new BubbleGamepadInput(), p = pad();
  p.mapping = "";
  assert.equal(input.poll([p], 0).players[0].connected, false);
  p.mapping = "standard"; input.poll([p], 10);
  assert.deepEqual(input.poll([], 20).disconnected, []);
});
