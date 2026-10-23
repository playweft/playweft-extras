import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGame, COLS, ROWS } from '../games/bubble-kick/game.js';
import { GOALS } from '../games/bubble-kick/arena.js';
import { movePlayer } from '../games/bubble-kick/movement.js';
import { BOMB, simulationFrame } from '../games/bubble-kick/bomb-rules.js';

// Exercise the real renderer with a recording canvas, without loading bitmaps.
async function renderer() {
  const events = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    translate(x, y) { events.push({ type: 'translate', x, y }); },
    drawImage(...args) { events.push({ type: 'image', args }); },
    strokeRect(x, y, width, height) { events.push({ type: 'pitch', x, y, width, height }); },
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
    measureText() { return { width: 20 }; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const scope = {
    COLS, ROWS, BOMB, simulationFrame, GOALS,
    document: { createElement: () => ({ getContext: () => context }) },
    drawStadium: () => true,
    drawHero(_c, x, y, index, options) {
      events.push({ type: 'hero', x, y, index, options });
      return true;
    },
  };
  const source = (await readFile(new URL('../games/bubble-kick/render.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+\n/gm, '').replace(/export /g, '');
  vm.runInNewContext(source, scope);
  return { events, context, render: scope.render };
}

test('sprites meet their interpolated ground centres and share depth order with balls', async () => {
  const { events, context, render } = await renderer();
  const state = createGame();
  state.phase = 'playing';
  state.players = state.players.slice(0, 2);
  state.players[0].y = 0;
  state.players[1].y = 6;
  state.balls = [{ x: 4, y: 7, fuse: 20, kind: 'normal' }];
  const positions = new Map([[0, { x: 3.25, y: 7.5 }]]);
  render(context, state, 500, { positions });
  const heroes = events.filter(e => e.type === 'hero');
  assert.deepEqual(heroes.map(e => e.index), [1, 0]);
  assert.equal(heroes[1].x, 96 + 3.25 * (768 / (COLS - 1)));
  assert.equal(heroes[1].y, 249 + 7.5 * 60);
  assert.equal(heroes[1].options.shadow, false);
  const ballDraw = events.findLastIndex(e => e.type === 'translate' && e.x === 96 + 4 * (768 / (COLS - 1)) && e.y === 669);
  assert.ok(ballDraw > events.indexOf(heroes[0]));
  assert.ok(ballDraw < events.indexOf(heroes[1]));
});

test('players can reach the lawn above and below both goals, with bubbles and blast tiles aligned', async () => {
  const { events, context, render } = await renderer();
  const metadata = JSON.parse(await readFile(new URL('../public/bubble-kick/art/hero-walk.json', import.meta.url), 'utf8'));
  const halfWidth = Math.max(34, ...metadata.frames.map(f => f.w * 88 / metadata.referenceHeight / 2));
  for (const [startX, dir, edgeX] of [[0.1, 2, 0], [COLS - 1.1, 0, COLS - 1]]) {
    for (const row of [1, ROWS - 2]) {
      const state = createGame({ humans: 4 });
      state.phase = 'playing';
      const p = state.players[0];
      Object.assign(p, { x: startX, y: row });
      movePlayer(state, p, dir);
      assert.equal(p.x, edgeX);
      assert.equal(p.y, row);
      // The same cell stays hazardous; opening the lane must not create a safe strip.
      state.players = [p];
      state.balls = [{ x: edgeX, y: row, fuse: 100, kind: 'normal' }];
      state.blasts = [{ x: edgeX, y: row, until: 100, id: 1 }];
      events.length = 0;
      render(context, state, 0);
      const hero = events.find(e => e.type === 'hero');
      const pitch = events.find(e => e.type === 'pitch');
      const pitchRight = pitch.x + pitch.width;
      assert.ok(dir === 2 ? hero.x < pitch.x : hero.x > pitchRight,
        'the edge column must reach the grass outside the white sideline');
      assert.ok(hero.x - halfWidth >= 60 && hero.x + halfWidth <= 900,
        'every walk frame and the trapped bubble clear the cones, including their full width');
      assert.ok(row === 1 ? hero.y < 225 + 229 * 48 / 52 : hero.y > 225 + 343 * 48 / 52,
        'the reachable cell is above or below the goal');
      assert.ok(events.some(e => e.type === 'translate' && e.x === hero.x && e.y === hero.y),
        'the bubble shares the player ground anchor');
      const foam = events.find(e => e.type === 'image');
      assert.equal(foam.args[1] + foam.args[3] / 2, hero.x);
      assert.equal(foam.args[2] + foam.args[4] / 2, hero.y);
      assert.equal(foam.args[3], 768 / (COLS - 1));
    }
  }
});

test('the sixteen animation crops stay inside the transparent atlas', async () => {
  const metadata = JSON.parse(await readFile(new URL('../public/bubble-kick/art/hero-walk.json', import.meta.url), 'utf8'));
  const png = await readFile(new URL('../public/bubble-kick/art/hero-walk.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), metadata.width);
  assert.equal(png.readUInt32BE(20), metadata.height);
  assert.equal(png[25], 6, 'RGBA transparency is preserved');
  assert.equal(metadata.frames.length, 16);
  for (const f of metadata.frames) {
    assert.ok(f.w > 0 && f.h > 0);
    assert.ok(f.x >= 0 && f.y >= 0);
    assert.ok(f.x + f.w <= metadata.width && f.y + f.h <= metadata.height);
    assert.ok(f.h <= metadata.referenceHeight);
  }
});
