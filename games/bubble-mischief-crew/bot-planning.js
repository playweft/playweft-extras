import { COLS, ROWS, inside } from "./arena.js";
import { simulationFrame } from "./bomb-rules.js";
import { movePlayer, playerCell, MOTION_STEP } from "./movement.js";
import { playerSpeed } from "./item-rules.js";

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const key = (x, y) => y * COLS + x;

function forecast(s, balls, blastCells) {
  const arms = balls.map(b => blastCells(b, balls));
  const times = balls.map(b => Math.max((b.fuseFrame ?? b.fuse * 5) / 5, (b.flight?.end ?? 0) / 5));
  // A chain can trigger an airborne ball before its natural landing deadline.
  const order = balls.map((_, i) => i), settled = new Set();
  while (settled.size < balls.length) {
    order.sort((a, b) => times[a] - times[b]);
    const index = order.find(i => !settled.has(i));
    settled.add(index);
    const hits = new Set(arms[index].map(c => key(c.x, c.y)));
    balls.forEach((b, i) => { if (hits.has(key(b.x, b.y))) times[i] = Math.min(times[i], times[index]); });
  }
  const hazards = new Map();
  function add(x, y, from, until) {
    const id = key(x, y);
    if (!hazards.has(id)) hazards.set(id, []);
    hazards.get(id).push({ from, until });
  }
  for (const b of s.blasts) add(b.x, b.y, -Infinity, b.until);
  balls.forEach((b, i) => {
    // Retain the bot's short warning margin and avoidance of visible foam.
    for (const c of arms[i]) add(c.x, c.y, times[i] - 3, times[i] + 5);
  });
  return {
    times: new Map(balls.map((b, i) => [b.id, times[i]])),
    unsafe: (x, y, from, until = from) =>
      hazards.get(key(x, y))?.some(h => h.from <= until && h.until > from) ?? false,
  };
}

export function createBotPlanner(s, p, balls, blastCells, visible, leavingBlast) {
  const now = simulationFrame(s) / 5, cell = playerCell(p);
  const travel = 10000 / playerSpeed(p, now); // ticks per cell, including shoes / slow.
  function world(list) {
    const prediction = forecast(s, list, blastCells);
    const occupied = new Set(list.map(b => key(b.x, b.y)));
    const open = (x, y) => inside(x, y) && !occupied.has(key(x, y)) &&
      (leavingBlast || !visible.has(key(x, y)));
    const danger = (x, y, t) => prediction.unsafe(x, y, t);
    function follow(x, y, at, depth, visited, collect) {
      let best = 0;
      if (!depth) return best;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d], id = key(nx, ny);
        if (!open(nx, ny) || visited.has(id) ||
          prediction.unsafe(x, y, at, at + travel / 2) ||
          prediction.unsafe(nx, ny, at + travel / 2, at + travel)) continue;
        visited.add(id);
        collect?.(nx, ny, at + travel);
        best = Math.max(best, 1 + follow(nx, ny, at + travel, depth - 1, visited, collect));
        visited.delete(id);
      }
      return best;
    }
    return {
      balls: list, danger, prediction,
      nearby: list.some(b => prediction.times.get(b.id) <= now + 12 &&
        blastCells(b, list).some(c => Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) <= 3)),
      route(x, y) {
        const arrival = now + (Math.abs(x - p.x) + Math.abs(y - p.y)) * travel;
        if (prediction.unsafe(x, y, (now + arrival) / 2, arrival)) return -12;
        const depth = follow(x, y, arrival, 2, new Set([key(cell.x, cell.y), key(x, y)]));
        return depth === 2 ? 1 : depth === 1 ? -4 : -10;
      },
      space() {
        const safe = new Set();
        const collect = (x, y, at) => {
          if (!danger(x, y, at) && !danger(x, y, Math.max(at, now + 8))) safe.add(key(x, y));
        };
        collect(cell.x, cell.y, now);
        follow(cell.x, cell.y, now, 2, new Set([key(cell.x, cell.y)]), collect);
        return safe.size;
      },
    };
  }
  const original = world(balls);
  const exits = DX.reduce((n, dx, d) => n + Number(inside(cell.x + dx, cell.y + DY[d]) &&
    !balls.some(b => b.x === cell.x + dx && b.y === cell.y + DY[d])), 0);
  const pressure = original.danger(cell.x, cell.y, now + 2) ||
    original.danger(cell.x, cell.y, now + 8) || exits <= 1;
  let originalSpace;
  return {
    original,
    kick(ball, dir) {
      if (!pressure || ball.flight || (p.slideDir ?? -1) >= 0 ||
        balls.filter(b => !b.flight && b.x === ball.x && b.y === ball.y).length !== 1) return null;
      // Use the real contact probe, collisions, goal fallback and kick wrapping.
      // Only perceived balls participate; previews never mutate the real world.
      const preview = { ...s, balls: balls.map(b => ({ ...b })) }, actor = { ...p };
      const target = preview.balls.find(b => b.id === ball.id), start = simulationFrame(s);
      for (let step = 0; step < 20; step++) {
        const frame = start + step;
        preview.tick = Math.floor(frame / 5); preview.substep = frame % 5;
        for (const b of preview.balls) if (b.flight?.end <= frame) delete b.flight;
        movePlayer(preview, actor, dir, MOTION_STEP, COLS, ROWS, playerSpeed(p, frame / 5));
        if (target.flight) {
          if (original.prediction.times.get(ball.id) <= frame / 5) return null;
          const after = world(preview.balls);
          // Do not create a new imminent blast around an exposed teammate.
          if (s.players.some(q => q !== p && q.team === p.team && q.status === "alive" &&
            !original.prediction.unsafe(Math.round(q.x), Math.round(q.y), now, now + 10) &&
            after.prediction.unsafe(Math.round(q.x), Math.round(q.y), now, now + 10))) return null;
          originalSpace ??= original.space();
          const gain = after.space() - originalSpace;
          return gain > 0 ? { ...after, bonus: Math.min(3, gain * .75) - .5 } : null;
        }
        if (!actor.moving) break;
      }
      return null;
    },
  };
}
