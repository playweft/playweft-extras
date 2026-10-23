import { COLS, ROWS, inside } from "./arena.js";
import { BOMB, simulationFrame } from "./bomb-rules.js";
import { playerCell, movePlayer, launchBall, MOTION_STEP } from "./movement.js";
import { playerSpeed } from "./item-rules.js";

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const key = (x, y) => y * COLS + x;
const brains = new WeakMap();
const HORIZON = 210; // Cover every visible fuse and the falling interval.

// Only visible balls and falling shadows are known. Predict natural explosions,
// shields along blast arms, and same-frame chains, including airborne balls.
export function forecast(s, blastCells) {
  const now = simulationFrame(s);
  const balls = s.balls.map(b => ({ ...b, land: b.flight?.end ?? now,
    born: now - 1, end: Math.max(b.fuseFrame ?? b.fuse * 5, b.flight?.end ?? now) }));
  for (const d of s.drops) balls.push({ ...d, born: Math.ceil(d.at * 5),
    land: Math.ceil(d.at * 5), end: Math.ceil(d.at * 5) + BOMB.fuseFrames });
  const hazards = Array.from({ length: COLS * ROWS }, () => []);
  let remaining = [...balls];
  while (remaining.length) {
    const frame = Math.min(...remaining.map(b => b.end));
    const active = remaining.filter(b => b.born < frame);
    const seen = new Set();
    function explode(ball) {
      if (seen.has(ball)) return;
      seen.add(ball);
      const cells = blastCells(ball, active);
      ball.end = frame;
      for (const c of cells) hazards[key(c.x, c.y)].push(frame);
      for (const other of active)
        if (!seen.has(other) && cells.some(c => c.x === other.x && c.y === other.y)) explode(other);
    }
    for (const b of active) if (b.end <= frame) explode(b);
    remaining = remaining.filter(b => !seen.has(b));
  }
  return { balls, hazards, now };
}

function route(s, p, prediction) {
  const { now, hazards, balls } = prediction;
  const speed = playerSpeed(p, now / 5) / 1000;
  const framesPerCell = Math.ceil(50 / speed);
  const horizon = HORIZON;
  const start = playerCell(p), queue = [{ ...start, time: 0, parent: -1 }];
  const visited = new Set([key(start.x, start.y)]);
  let best = 0, bestValue = -Infinity, bestSafety = -Infinity;
  const unsafe = (x, y, from, to) => hazards[key(x, y)]
    .some(t => t >= now + from - 5 && t <= now + to + 5);
  const blocked = (x, y, from, to) => balls.some(b => b.x === x && b.y === y &&
    b.land <= now + to && b.end >= now + from);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const { x, y, time } = node;
    if (bestValue >= horizon * 100 && time > queue[best].time + 20) continue;
    const safeUntil = Math.min(horizon, ...hazards[key(x, y)]
      .map(t => t - now - 5),
      ...balls.filter(b => b.x === x && b.y === y && b.land > now)
        .map(b => b.land - now - 5));
    if (safeUntil >= time && !unsafe(x, y, time, time) && !blocked(x, y, time, time)) {
      let exits = 0;
      for (let d = 0; d < 4; d++) if (inside(x + DX[d], y + DY[d]) &&
        !blocked(x + DX[d], y + DY[d], time, time + framesPerCell)) exits++;
      // Stay in a safe refuge, with accessible exits for the next unknown wave.
      let value = safeUntil * 100 + exits * 4 - time * .2;
      for (const q of s.players) if (q !== p && q.status === "bubble")
        value += (q.team === p.team ? 12 : 4) / (1 + Math.abs(x - q.x) + Math.abs(y - q.y));
      for (const item of s.items) if (item.kind === "shoe" || item.kind === "fork")
        value += 2 / (1 + Math.abs(x - item.x) + Math.abs(y - item.y));
      if (value > bestValue) { bestValue = value; bestSafety = safeUntil; best = i; }
    }
    if (time >= horizon) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      const duration = framesPerCell, next = time + duration;
      if (!inside(nx, ny) || next > horizon) continue;
      // A body can be hit on either half of an edge; allow a reaction margin.
      if (unsafe(x, y, time, time + Math.ceil(duration / 2)) ||
        unsafe(nx, ny, time + Math.floor(duration / 2), next)) continue;
      if (blocked(nx, ny, time, next) ||
        balls.some(b => b.x === x && b.y === y && b.land > now + time && b.land <= now + next) ||
        s.traps.some(t => t.x === nx && t.y === ny && !t.passableBy?.includes(p.id))) continue;
      const stamp = key(nx, ny);
      if (visited.has(stamp)) continue;
      visited.add(stamp);
      queue.push({ x: nx, y: ny, time: next, parent: i });
    }
  }
  return { path: trace(queue, best), value: bestValue, safeUntil: bestSafety, nodes: queue };
}

function trace(nodes, end) {
  const path = [];
  for (let index = end; nodes[index].parent >= 0; index = nodes[index].parent) path.unshift(nodes[index]);
  return path;
}

function escape(s, p, blastCells) {
  const prediction = forecast(s, blastCells), plan = route(s, p, prediction);
  if (plan.value >= HORIZON * 100) return plan.path;
  let partial = plan.path, reachable = plan.nodes.length;
  // If grounded bubbles seal every safe exit, test a real contact kick from a
  // reachable cell. Recompute its wrapped landing and the resulting chains;
  // never assume kicking a bubble merely deletes it from the danger map.
  for (let index = 0; index < plan.nodes.length; index++) {
    const node = plan.nodes[index];
    for (let dir = 0; dir < 4; dir++) {
      const ball = s.balls.find(b => !b.flight && b.x === node.x + DX[dir] && b.y === node.y + DY[dir]);
      if (!ball || (ball.fuseFrame ?? ball.fuse * 5) <= prediction.now + node.time + 10) continue;
      const frame = prediction.now + node.time;
      const world = { ...s, tick: Math.floor(frame / 5), substep: frame % 5,
        drops: s.drops.filter(d => d.at * 5 >= frame),
        balls: prediction.balls.filter(b => b.born < frame && b.end > frame).map(b => {
          const copy = { ...b, fuseFrame: b.fuseFrame ??
            (b.fuse === undefined ? b.born + BOMB.fuseFrames : b.fuse * 5) };
          if (copy.flight?.end <= frame) delete copy.flight;
          return copy;
        }) };
      const kicker = { ...p, x: node.x, y: node.y };
      const copy = world.balls.find(b => b.id === ball.id);
      if (!copy) continue;
      if (!launchBall(world, kicker, copy, dir)) continue;
      const afterKick = route(world, kicker, forecast(world, blastCells));
      const path = [...trace(plan.nodes, index), { x: ball.x, y: ball.y }];
      if (afterKick.value >= HORIZON * 100) return path;
      // Some pockets need two kicks. Open more space first, provided the new
      // chain forecast does not bring the best available impact deadline closer.
      if (afterKick.nodes.length > reachable &&
        frame + afterKick.safeUntil >= prediction.now + plan.safeUntil) {
        reachable = afterKick.nodes.length; partial = path;
      }
    }
  }
  return partial;
}

export function botInput(s, p, blastCells) {
  if (p.status !== "alive") { p.input = -1; return; }
  const now = simulationFrame(s);
  let brain = brains.get(p);
  if (!brain || now >= brain.next) {
    brain = { next: now + 10, path: escape(s, p, blastCells) };
    brains.set(p, brain);
  }
  const tolerance = playerSpeed(p, now / 5) / 100000;
  while (brain.path.length && Math.abs(brain.path[0].x - p.x) <= tolerance &&
    Math.abs(brain.path[0].y - p.y) <= tolerance) {
    brain.path.shift();
  }
  const target = brain.path[0] || playerCell(p);
  if (Math.abs(target.x - p.x) <= tolerance && Math.abs(target.y - p.y) <= tolerance) {
    p.input = -1; return;
  }
  const dx = target.x - p.x, dy = target.y - p.y;
  p.input = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
  // Routes use cell centres, but a real body can be slightly off centre. Probe
  // the same sweep as human movement and sidestep a goal corner when necessary.
  const probe = dir => {
    const copy = { ...p }, world = { ...s, balls: s.balls.map(b => ({ ...b })) };
    movePlayer(world, copy, dir, MOTION_STEP, COLS, ROWS, playerSpeed(p, now / 5));
    return copy;
  };
  const ahead = probe(p.input), stride = playerSpeed(p, now / 5) / 50000;
  if (Math.abs(ahead.x - p.x) + Math.abs(ahead.y - p.y) < stride / 2) {
    const sides = [(p.input + 1) % 4, (p.input + 3) % 4].map(dir => ({ dir, p: probe(dir) }))
      .filter(candidate => Math.abs(candidate.p.x - p.x) + Math.abs(candidate.p.y - p.y) >= stride / 2)
      .sort((a, b) => Math.hypot(a.p.x - target.x, a.p.y - target.y) -
        Math.hypot(b.p.x - target.x, b.p.y - target.y));
    if (sides.length) p.input = sides[0].dir;
  }
}
