import { UNIT, MOTION_STEP, movePlayer, playerCell, launchBall } from "./movement.js";
import { inside, COLS, ROWS } from "./arena.js";
import { playerSpeed, ITEM_POOL } from "./item-rules.js";
import { botInput } from "./bot.js";
import { useItem, collectAndTriggerItems, clearBlastedItems, landItems, dispatchWaveItem, dispatchRecycledItems } from "./items.js";
export { useItem } from "./items.js";
export { ITEM_LABELS } from "./item-rules.js";
export { inside, COLS, ROWS } from "./arena.js";
import {
  BOMB, bombRange, airborneElapsed, airborneCounts, waveDue, simulationFrame,
} from "./bomb-rules.js";
export { gridCell, playerCell, movePlayer } from "./movement.js";
// Positions are continuous cell units. A logical tick is 100 ms; motion runs at 20 ms.
export const STEP = MOTION_STEP,
  LIMIT = 2400;
export const CONTACT_RADIUS = 0.75;
export const DX = [1, 0, -1, 0],
  DY = [0, 1, 0, -1];
const at = (a, x, y) => a.find((b) => b.x === x && b.y === y);
function touching(p, q) {
  const dx = Math.round(p.x * UNIT) - Math.round(q.x * UNIT),
    dy = Math.round(p.y * UNIT) - Math.round(q.y * UNIT);
  return dx * dx + dy * dy <= (CONTACT_RADIUS * UNIT) ** 2;
}
export function random(s, n) {
  s.seed = (s.seed * 48271) % 2147483647;
  return s.seed % n;
}
export function createGame({ seed = 17, humans = 1, players } = {}) {
  const names = ["薄荷", "柚子", "桃桃", "蓝莓"];
  return {
    seed: Math.max(1, seed % 2147483647),
    tick: 0,
    substep: 0,
    phase: "countdown",
    winner: -1,
    round: 1,
    scores: [0, 0],
    balls: [],
    blasts: [],
    drops: [],
    items: [],
    traps: [],
    itemDrops: [],
    recycled: [],
    itemStock: ITEM_POOL.map(p => p.stock),
    lastRecycleAt: 0,
    nextId: 1,
    lastWaveAt: -1,
    players: (
      players ||
      names.map((name, i) => ({ name, id: `local-${i}`, bot: i >= humans }))
    ).map((p, i) => ({
      ...p,
      team: i % 2,
      x: i % 2 ? COLS - 3 : 2,
      y: i < 2 ? 2 : ROWS - 3,
      dir: i % 2 ? 2 : 0,
      status: "alive",
      until: 0,
      immune: 0,
      moving: false,
      shield: false,
      input: -1,
      inventory: [],
      shoes: 0,
      slowUntil: 0,
      slideDir: -1,
      itemSeq: 0,
    })),
  };
}
export function blastCells(ball, balls = []) {
  const cells = [{ x: ball.x, y: ball.y }];
  for (let d = 0; d < 4; d++)
    for (let r = 1; r <= (ball.kind ? bombRange(ball.kind) : ball.range); r++) {
      const x = ball.x + DX[d] * r,
        y = ball.y + DY[d] * r;
      if (!inside(x, y)) break;
      cells.push({ x, y });
      if (balls.some(b => b !== ball && b.x === x && b.y === y)) break;
    }
  return cells;
}
export function kickBall(s, p) {
  const cell = playerCell(p);
  const ball =
    at(s.balls.filter((b) => !b.flight), cell.x + DX[p.dir], cell.y + DY[p.dir]) ||
    at(s.balls.filter((b) => !b.flight), cell.x, cell.y);
  return ball ? launchBall(s, p, ball, p.dir, COLS, ROWS) : false;
}
export function input(s, index, dir = -1) {
  const p = s.players[index];
  if (!p || !Number.isInteger(dir) || dir < -1 || dir > 3) return;
  p.input = dir;
}

function explode(s, ball, seen) {
  if (seen.has(ball.id)) return;
  seen.add(ball.id);
  const cells = blastCells(ball, s.balls);
  s.blasts.push(
    ...cells.map((c) => ({ ...c, until: simulationFrame(s) / 5 + 5, atFrame: simulationFrame(s), id: ball.id })),
  );
  for (const b of s.balls)
    if (!seen.has(b.id) && at(cells, b.x, b.y)) explode(s, b, seen);
}
// Default advances one logical tick for tests/server batches; the client calls 20 ms.
export function stepGame(s, milliseconds = 100) {
  if (["ended", "closed", "waiting", "paused"].includes(s.phase)) return;
  for (let elapsed = 0; elapsed < milliseconds; elapsed += MOTION_STEP) {
    s.substep = ((s.substep || 0) + 1) % 5;
    const clocked = s.substep === 0;
    if (clocked) s.tick++;
    if (s.tick < 30) continue;
    s.phase = "playing";
    for (const b of s.balls)
      if (b.flight && b.flight.end <= simulationFrame(s)) {
        delete b.flight;
        b.dir = -1;
      }
    const nowFrame = simulationFrame(s), nowTick = nowFrame / 5;
    s.blasts = s.blasts.filter(b => b.until > nowTick);
    const exploded = new Set();
    for (const b of s.balls)
      if (!b.flight && (b.fuseFrame ?? b.fuse * 5) <= nowFrame) explode(s, b, exploded);
    s.balls = s.balls.filter(b => !exploded.has(b.id));
    // A native blast hits at impact; the remaining foam is visual, not a fire tile.
    const hot = new Set(s.blasts.filter(b => b.atFrame === undefined || b.atFrame === nowFrame)
      .map(b => b.y * COLS + b.x));
    if (hot.size) clearBlastedItems(s, hot);
    landItems(s);
    const previousCells = new Map(s.players.map(p => [p.id, playerCell(p)]));
    for (const p of s.players) {
      if (p.bot && p.status === "bubble") {
        const slot = p.inventory?.findIndex(i => i.kind === "fork" && i.count);
        if (slot >= 0) useItem(s, s.players.indexOf(p), slot + 1);
      }
      if (p.bot) botInput(s, p, blastCells, random);
      const forced = (p.slideDir ?? -1) >= 0, dir = forced ? p.slideDir : p.input;
      if (dir >= 0) p.dir = dir;
      const blocked = movePlayer(s, p, dir, MOTION_STEP, COLS, ROWS, playerSpeed(p, nowTick), forced);
      if (forced && blocked) p.slideDir = -1;
      if (p.bot && clocked && s.tick % 20 === 0 && p.status === "alive") {
        const slot = p.inventory?.findIndex(i => i.count && i.kind !== "fork");
        if (slot >= 0) useItem(s, s.players.indexOf(p), slot + 1);
      }
    }
    // Check nearest centres without changing or snapping a player's physical position.
    for (const p of s.players) {
      const cell = playerCell(p);
      if (
        p.status === "alive" &&
        p.immune <= s.tick &&
        hot.has(cell.y * COLS + cell.x)
      ) {
        if (p.shield) {
          p.shield = false;
          p.immune = s.tick + 10;
        } else {
          p.status = "bubble";
          p.dir = 1; // Native hit recovery faces down.
          p.until = s.tick + 40;
          p.input = -1;
          p.moving = false;
          p.slowUntil = 0;
          p.slideDir = -1;
        }
      }
    }
    for (const p of s.players) {
      if (p.status !== "bubble") continue;
      const touches = s.players.filter(
        (q) =>
          q !== p &&
          q.status === "alive" &&
          touching(p, q),
      );
      if (touches.some((q) => q.team !== p.team) || s.tick >= p.until)
        p.status = "out";
      else if (touches.some((q) => q.team === p.team)) {
        p.status = "alive";
        p.immune = s.tick + 12;
      }
    }
    collectAndTriggerItems(s, previousCells);
    if (s.drops[0]?.at <= nowTick) {
      for (const d of s.drops.filter((d) => d.at <= nowTick)) {
        s.balls.push({
          x: d.x,
          y: d.y,
          id: d.id,
          fuseFrame: nowFrame + BOMB.fuseFrames,
          fuse: (nowFrame + BOMB.fuseFrames) / 5,
          kind: d.kind,
          range: bombRange(d.kind),
          dir: -1,
        });
      }
      s.drops = s.drops.filter((d) => d.at > nowTick);

    }
    // Re-evaluate the shrinking threshold every motion step, rather than fixing
    // the next interval at the previous dispatch or using a modulo timer.
    const elapsedMs = airborneElapsed(s);
    if (waveDue(elapsedMs, s.lastWaveAt ?? -1)) {
      s.lastWaveAt = elapsedMs;
      const counts = airborneCounts(elapsedMs);
      const cells = Array.from({ length: COLS * ROWS }, (_, i) => i)
        .filter(cell => inside(cell % COLS, Math.floor(cell / COLS)));
      const start = simulationFrame(s) / 5;
      for (let i = 0; i < counts.normal + counts.football; i++) {
        // Sample without replacement within this batch. Existing grounded balls
        // remain eligible targets, so later drops / kicks can still form stacks.
        const chosen = i + random(s, cells.length - i);
        [cells[i], cells[chosen]] = [cells[chosen], cells[i]];
        const cell = cells[i];
        s.drops.push({
          id: s.nextId++,
          x: cell % COLS,
          y: Math.floor(cell / COLS),
          kind: i < counts.normal ? "normal" : "football",
          fromX: random(s, COLS),
          start,
          at: start + BOMB.fallTicks,
        });
      }
      dispatchWaveItem(s, cells, counts.normal + counts.football, random);
    }
    dispatchRecycledItems(s, random);
    const alive = [0, 1].map(
      (team) =>
        s.players.filter((p) => p.team === team && p.status !== "out").length,
    );
    if (!alive[0] || !alive[1] || s.tick >= LIMIT) {
      s.phase = "ended";
      s.winner =
        !alive[0] && !alive[1] ? -1 : !alive[0] ? 1 : !alive[1] ? 0 : -1;
      if (s.winner >= 0) s.scores[s.winner]++;
      break;
    }
  }
}
