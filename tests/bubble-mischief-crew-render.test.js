import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGame, COLS, ROWS } from '../games/bubble-mischief-crew/game.js';
import { GOALS } from '../games/bubble-mischief-crew/arena.js';
import { movePlayer } from '../games/bubble-mischief-crew/movement.js';
import { BOMB, simulationFrame } from '../games/bubble-mischief-crew/bomb-rules.js';
import { bubbleStackDisplay } from '../games/bubble-mischief-crew/bubble-stacks.js';

// Exercise the real renderer with a recording canvas, without loading bitmaps.
async function renderer() {
  const events = [];
  const gradient = { addColorStop() {} };
  let path;
  let matrix = [1, 1, 0, 0];
  const stack = [];
  const projectedEllipse = (x, y, rx, ry) => [
    matrix[2] + x * matrix[0], matrix[3] + y * matrix[1], rx * matrix[0], ry * matrix[1],
  ];
  const context = new Proxy({
    save() { stack.push([...matrix]); },
    restore() { matrix = stack.pop(); },
    scale(x, y) { matrix[0] *= x; matrix[1] *= y; },
    beginPath() { path = null; },
    translate(x, y) { events.push({ type: 'translate', x, y }); matrix[2] += x * matrix[0]; matrix[3] += y * matrix[1]; },
    drawImage(...args) { events.push({ type: 'image', args }); },
    strokeRect(x, y, width, height) { events.push({ type: 'pitch', x, y, width, height }); },
    roundRect(x, y, width, height) {
      path = { x, y, width, height };
      events.push({ type: 'rounded', ...path });
    },
    stroke() { if (path) events.push({ type: 'outline', ...path, lineWidth: this.lineWidth, color: this.strokeStyle }); },
    ellipse(...args) { events.push({ type: 'ellipse', args, projected: projectedEllipse(...args) }); },
    arc(...args) { events.push({ type: 'arc', args, projected: projectedEllipse(args[0], args[1], args[2], args[2]) }); },
    clip() { events.push({ type: 'clip' }); },
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
    measureText() { return { width: 20 }; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const scope = {
    COLS, ROWS, BOMB, simulationFrame, GOALS, bubbleStackDisplay,
    document: { createElement: () => ({ getContext: () => context }) },
    drawStadium: () => true,
    drawHero(_c, x, y, index, options) {
      events.push({ type: 'hero', x, y, index, options });
      return true;
    },
  };
  const source = (await readFile(new URL('../games/bubble-mischief-crew/render.js', import.meta.url), 'utf8'))
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
  assert.equal(heroes[1].y, 255 + 7.5 * 60);
  assert.equal(heroes[1].options.shadow, false);
  const ballDraw = events.findLastIndex(e => e.type === 'translate' && e.x === 96 + 4 * (768 / (COLS - 1)) && e.y === 675);
  assert.ok(ballDraw > events.indexOf(heroes[0]));
  assert.ok(ballDraw < events.indexOf(heroes[1]));
});

test('both bubble types keep their footprint and shadow on the blast-cell centre, including pulse and drop landing', async () => {
  const { events, context, render } = await renderer();
  const state = createGame();
  state.phase = 'playing'; state.tick = 100; state.players = [];
  state.blasts = [{ x: 6, y: 4, until: 200, id: 2 }];
  for (const [kind, height] of [['normal', 15], ['football', 20]]) {
    for (const fuse of [1000, 105]) {
      state.balls = [{ id: 1, x: 6, y: 4, kind, fuse, dir: -1 }];
      events.length = 0; render(context, state, 100);
      const tile = events.find(e => e.type === 'image');
      const ground = [tile.args[1] + tile.args[3] / 2, tile.args[2] + tile.args[4] / 2];
      const body = events.find(e => e.type === 'ellipse' && e.args[2] === 19 && e.args[3] === height);
      const shadow = events.find(e => e.type === 'arc' && e.args[2] === 19);
      const scale = body.projected[3] / height;
      assert.ok(Math.abs(body.projected[0] - ground[0]) < 1e-8);
      assert.ok(Math.abs(body.projected[1] + (height - 5) * scale - ground[1]) < 1e-8);
      assert.ok(body.projected[1] + body.projected[3] > ground[1], 'the silhouette extends in front of its ground pivot');
      assert.deepEqual(shadow.projected.slice(0, 2), ground);
    }
    state.balls = [];
    state.drops = [{ id: 1, x: 6, y: 4, kind, fromX: 2, start: 99, at: 101 }];
    events.length = 0; render(context, state, 100, { motionFrame: 505 });
    const body = events.find(e => e.type === 'ellipse' && e.args[2] === 19 && e.args[3] === height);
    assert.ok(Math.abs(body.projected[0] - 480) < 1e-8);
    assert.ok(Math.abs(body.projected[1] + height - 5 - 495) < 1e-8, 'falling bubbles meet the same ground pivot at landing');
    state.drops = [];
  }
});

test('a kicked bubble keeps its ground shadow below its elevated footprint', async () => {
  const { events, context, render } = await renderer();
  const state = createGame();
  state.phase = 'playing'; state.tick = 100; state.players = [];
  state.balls = [{ id: 1, x: 11, y: 4, kind: 'football', fuse: 1000, dir: 0,
    flight: { x: 3, y: 4, start: 490, end: 510, distance: 8 } }];
  render(context, state, 100, { motionFrame: 500 });
  const body = events.find(e => e.type === 'ellipse' && e.args[2] === 19 && e.args[3] === 20);
  const shadow = events.find(e => e.type === 'arc' && e.args[2] === 13.5);
  assert.deepEqual(body.projected.slice(0, 2), [544, 380]);
  assert.deepEqual(shadow.projected.slice(0, 2), [544, 495]);
  assert.equal(shadow.projected[1] - (body.projected[1] + 20 - 5), 100);
});

test('stack representatives draw last at their ground depth without raising shadows or covering the next row', async () => {
  const { events, context, render } = await renderer();
  const state = createGame();
  state.phase = 'playing'; state.tick = 100; state.players = [];
  state.balls = [
    { id: 1, x: 6, y: 4, kind: 'football', fuse: 1000 },
    { id: 2, x: 6, y: 4, kind: 'normal', fuse: 1000 },
    { id: 3, x: 6, y: 4, kind: 'football', fuse: 1000 },
    { id: 4, x: 6, y: 5, kind: 'normal', fuse: 1000 },
  ];
  const before = structuredClone(state);
  render(context, state, 0); events.length = 0; render(context, state, 100);
  const bodies = events.filter(e => e.type === 'ellipse' && e.args[2] === 19);
  assert.deepEqual(bodies.map(e => e.projected.slice(0, 2)), [
    [480, 485], [480, 480], [480, 478], [480, 545],
  ]);
  const shadows = events.filter(e => e.type === 'arc' && e.args[2] === 19);
  assert.deepEqual(shadows.slice(0, 4).map(e => e.projected.slice(0, 2)), [[480, 495], [480, 495], [480, 495], [480, 555]]);
  assert.equal(shadows.length, 5);
  assert.deepEqual(shadows[4].projected.slice(0, 2), [480, 495]);
  assert.ok(events.indexOf(shadows[4]) > events.indexOf(bodies[1]));
  assert.ok(events.indexOf(shadows[4]) < events.indexOf(bodies[2]));
  assert.deepEqual(state, before);
  state.balls[0].fuse = 105;
  events.length = 0; render(context, state, 200);
  const raised = events.filter(e => e.type === 'ellipse' && e.args[2] === 19 && e.args[3] === 20).at(-1);
  assert.ok(Math.abs(raised.projected[1] + 15 * raised.projected[3] / 20 - 493) < 1e-8,
    'the lift is exactly two canvas pixels, independent of the fuse pulse scale');
});

test('identical stacks cast one extra shadow between bodies, while single and flying bubbles keep only ground shadows', async () => {
  for (const kind of ['normal', 'football']) {
    const { events, context, render } = await renderer();
    const state = createGame();
    state.phase = 'playing'; state.tick = 100; state.players = [];
    state.balls = [1, 2].map(id => ({ id, x: 6, y: 4, kind, fuse: 1000 }));
    render(context, state, 0); events.length = 0; render(context, state, 100);
    const bodies = events.filter(e => e.type === 'ellipse' && e.args[2] === 19);
    const shadows = events.filter(e => e.type === 'arc' && e.args[2] === 19);
    assert.equal(shadows.length, 3);
    assert.ok(events.indexOf(shadows[2]) > events.indexOf(bodies[0]));
    assert.ok(events.indexOf(shadows[2]) < events.indexOf(bodies[1]));
    state.balls = [state.balls[0]];
    events.length = 0; render(context, state, 200);
    assert.equal(events.filter(e => e.type === 'arc' && e.args[2] === 19).length, 1);
    state.balls.push({ id: 3, x: 6, y: 4, kind, fuse: 1000, dir: 0,
      flight: { x: 2, y: 4, start: 500, end: 520, distance: 4 } });
    events.length = 0; render(context, state, 300, { motionFrame: 510 });
    const airborneBodies = events.filter(e => e.type === 'ellipse' && e.args[2] === 19);
    const airborneShadows = events.filter(e => e.type === 'arc' && e.args[2] >= 13.5);
    assert.equal(airborneShadows.length, 2);
    assert.ok(airborneShadows.every(shadow => events.indexOf(shadow) < events.indexOf(airborneBodies[0])));
  }
});

test('the rendered kick trajectory finishes at the raised stack position without an extra landing animation', async () => {
  const { events, context, render } = await renderer();
  const state = createGame();
  state.phase = 'playing'; state.tick = 40; state.players = [];
  const incoming = { id: 1, x: 6, y: 4, kind: 'football', fuse: 1000, dir: 0,
    flight: { x: 2, y: 4, start: 200, end: 220, distance: 4 } };
  state.balls = [{ id: 10, x: 6, y: 4, kind: 'normal', fuse: 1000 },
    { id: 11, x: 6, y: 4, kind: 'normal', fuse: 1000 }, incoming];
  const football = () => events.find(e => e.type === 'ellipse' && e.args[2] === 19 && e.args[3] === 20);
  render(context, state, 0, { motionFrame: 200 });
  events.length = 0; render(context, state, 200, { motionFrame: 210 });
  assert.deepEqual(football().projected.slice(0, 2), [352, 379]);
  events.length = 0; render(context, state, 400, { motionFrame: 220 });
  assert.deepEqual(football().projected.slice(0, 2), [480, 478]);
  delete incoming.flight;
  events.length = 0; render(context, state, 420, { motionFrame: 221 });
  assert.deepEqual(football().projected.slice(0, 2), [480, 478]);
});

test('the full first-row blast starts at the lawn edge, with all ground anchors and goals on one projection', async () => {
  const { events, context, render } = await renderer();
  const state = createGame({ humans: 4 });
  state.phase = 'playing';
  state.players = [Object.assign(state.players[0], { x: 6, y: 0 })];
  state.balls = [{ x: 6, y: 0, fuse: 100, kind: 'normal' }];
  state.blasts = [{ x: 6, y: 0, until: 100, id: 1 }, { x: 6, y: ROWS - 1, until: 100, id: 2 }];
  render(context, state, 0);
  const tiles = events.filter(e => e.type === 'image');
  assert.deepEqual(tiles.map(e => e.args.slice(1)), [[448,225,64,60],[448,705,64,60]]);
  const hero = events.find(e => e.type === 'hero');
  assert.equal(hero.y, 225 + 60 / 2);
  assert.ok(events.some(e => e.type === 'translate' && e.x === hero.x && e.y === hero.y));
  const pitch = events.find(e => e.type === 'pitch');
  assert.equal(pitch.y, tiles[0].args[2], 'top sideline meets the first blast row');
  assert.equal(pitch.y + pitch.height, tiles[1].args[2] + tiles[1].args[4], 'bottom sideline meets the last blast row');
  assert.ok(events.some(e => e.type === 'ellipse' && e.args[0] === 480 && e.args[1] === 495 && e.args[2] === 96 && e.args[3] === 90),
    'the centre circle uses the same horizontal and vertical cell scale');
  for (const x of [64, 832]) {
    assert.ok(events.some(e => e.type === 'rounded' && e.x === x && e.y === 405 && e.width === 64 && e.height === 180),
      'goal geometry is projected directly, without an inverse legacy row scale');
  }
  assert.ok(!events.some(e => e.type === 'clip'), 'the entire first tile is drawn; no cropping mask hides a bad origin');
});

test('goal frames mirror each other with matching widths and red/green side colours', async () => {
  const { events, context, render } = await renderer();
  const state = createGame();
  state.phase = 'playing';
  render(context, state, 0);
  const frames = events.filter(e => e.type === 'outline' && e.width === 64 && e.height === 180);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map(({ x, y, width, height, lineWidth, color }) => ({ x, y, width, height, lineWidth, color })), [
    { x: 64, y: 405, width: 64, height: 180, lineWidth: 4, color: '#ff432a' },
    { x: 832, y: 405, width: 64, height: 180, lineWidth: 4, color: '#78d956' },
  ]);
  const boxes = events.filter(e => e.type === 'pitch').slice(1);
  assert.deepEqual(boxes.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 128, y: 375, width: 128, height: 240 }, { x: 704, y: 375, width: 128, height: 240 },
    { x: 128, y: 435, width: 64, height: 120 }, { x: 768, y: 435, width: 64, height: 120 },
  ]);
});

test('players can reach the lawn above and below both goals, with bubbles and blast tiles aligned', async () => {
  const { events, context, render } = await renderer();
  const metadata = JSON.parse(await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk.json', import.meta.url), 'utf8'));
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
  const metadata = JSON.parse(await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk.json', import.meta.url), 'utf8'));
  const png = await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), metadata.width);
  assert.equal(png.readUInt32BE(20), metadata.height);
  assert.equal(png[25], 6, 'RGBA transparency is preserved');
  assert.equal(metadata.frames.length, 16);
  for (const f of metadata.frames) {
    assert.ok(f.w > 0 && f.h > 0);
    assert.ok(f.x >= 0 && f.y >= 0);
    assert.ok(f.x + f.w <= metadata.width && f.y + f.h <= metadata.height);
    assert.ok(f.h <= metadata.referenceHeight);
    assert.equal(f.footCenters.length, 2);
    for (const [x, y] of f.footCenters) assert.ok(x >= 0 && x < f.w && y >= 0 && y < f.h);
  }
});

test('real sprite draws register both feet around the same ground point throughout all sixteen frames', async () => {
  const metadata = JSON.parse(await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../games/bubble-mischief-crew/art.js', import.meta.url), 'utf8');
  const calls = [], atlas = {};
  const scope = { metadata, atlas };
  vm.runInNewContext(source.replace(/export /g, '') + '\nart.frames = metadata; art.heroes = [atlas, atlas, atlas, atlas];', scope);
  const context = { drawImage(...args) { calls.push(args); } };
  for (const [row, dir] of [1, 2, 0, 3].entries()) {
    for (let frame = 0; frame < 4; frame++) {
      const f = metadata.frames[row * 4 + frame];
      scope.drawHero(context, 480, 495, row, { dir, moving: true, time: frame * 115 });
      const [image, sx, sy, sw, sh, dx, dy, dw, dh] = calls.at(-1);
      assert.equal(image, atlas);
      assert.deepEqual([sx, sy, sw, sh], [f.x, f.y, f.w, f.h]);
      const feet = f.footCenters.map(([x, y]) => [dx + x * dw / sw, dy + y * dh / sh]);
      assert.ok(Math.abs((feet[0][0] + feet[1][0]) / 2 - 480) < 1e-8);
      assert.ok(Math.abs((feet[0][1] + feet[1][1]) / 2 - 495) < 1e-8);
      assert.ok(dy < 495 && dy + dh > 495, 'the ground point is inside the support footprint, above the lowest shoe pixel');
    }
    scope.drawHero(context, 480, 495, row, { dir });
    assert.deepEqual(calls.at(-1).slice(1), calls.at(-4).slice(1), 'the idle pose uses the registered second frame');
    scope.drawHero(context, 32, 63, row, { dir, height: 62, anchor: 'bottom' });
    const portrait = calls.at(-1);
    assert.ok(Math.abs(portrait[5] + portrait[7] / 2 - 32) < 1e-8);
    assert.ok(Math.abs(portrait[6] + portrait[8] - 63) < 1e-8, 'HUD portraits retain their bottom anchor and fit their canvas');
  }
});

test('replacement side cycles alternate near/far foot contacts and retain the ground pivot for every team', async () => {
  const metadata = JSON.parse(await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk-side.json', import.meta.url), 'utf8'));
  const original = JSON.parse(await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk.json', import.meta.url), 'utf8'));
  const png = await readFile(new URL('../public/bubble-mischief-crew/art/hero-walk-side.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), metadata.width);
  assert.equal(png.readUInt32BE(20), metadata.height);
  assert.equal(png[25], 6);
  assert.equal(metadata.frames.length, 8);
  const source = await readFile(new URL('../games/bubble-mischief-crew/art.js', import.meta.url), 'utf8');
  const calls = [], atlases = [{}, {}, {}, {}], fallback = {};
  const scope = { metadata, original, atlases, fallback };
  vm.runInNewContext(source.replace(/export /g, '') + '\nart.frames = original; art.heroes = [fallback]; art.sideFrames = metadata; art.sideHeroes = atlases;', scope);
  const c = { drawImage(...args) { calls.push(args); } };
  for (const [row, dir, forward] of [[0, 2, -1], [1, 0, 1]]) {
    const contacts = [0, 2].map(column => {
      const [near, far] = metadata.frames[row * 4 + column].footCenters;
      return (near[0] - far[0]) * forward;
    });
    assert.ok(contacts[0] > 0 && contacts[1] < 0, 'opposite feet lead in the two contact poses');
    for (const team of [0, 1, 2, 3]) for (let frame = 0; frame < 4; frame++) {
      const f = metadata.frames[row * 4 + frame];
      assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= metadata.width && f.y + f.h <= metadata.height);
      assert.ok(f.h <= metadata.referenceHeight);
      for (const [x, y] of f.footCenters) assert.ok(x >= 0 && x < f.w && y >= 0 && y < f.h);
      scope.drawHero(c, 480, 495, team, { dir, moving: true, time: frame * 115 });
      const [image, sx, sy, sw, sh, dx, dy, dw, dh] = calls.at(-1);
      assert.equal(image, atlases[team]);
      assert.deepEqual([sx, sy, sw, sh], [f.x, f.y, f.w, f.h]);
      const feet = f.footCenters.map(([x, y]) => [dx + x * dw / sw, dy + y * dh / sh]);
      assert.ok(Math.abs((feet[0][0] + feet[1][0]) / 2 - 480) < 1e-8);
      assert.ok(Math.abs((feet[0][1] + feet[1][1]) / 2 - 495) < 1e-8);
    }
    scope.drawHero(c, 32, 63, 0, { dir, height: 62, anchor: 'bottom' });
    const portrait = calls.at(-1);
    assert.equal(portrait[1], metadata.frames[row * 4 + 1].x, 'idle keeps the passing pose');
    assert.ok(Math.abs(portrait[5] + portrait[7] / 2 - 32) < 1e-8);
    assert.ok(Math.abs(portrait[6] + portrait[8] - 63) < 1e-8);
  }
  for (const dir of [1, 3]) {
    scope.drawHero(c, 480, 495, 0, { dir, moving: true, time: 230 });
    assert.equal(calls.at(-1)[0], fallback, 'front/back keep the original atlas');
  }
});
