import { COLS, ROWS, inside } from "./arena.js";
import { simulationFrame } from "./bomb-rules.js";
import { playerCell, movePlayer, MOTION_STEP } from "./movement.js";
import { playerSpeed } from "./item-rules.js";
import { createBotPlanner } from "./bot-planning.js";

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const at = (objects, x, y) => objects.find(b => b.x === x && b.y === y);
const key = (x, y) => y * COLS + x;

function adjustStoppedFooting(s, p, balls, blastCells, planner, visible, random) {
  if (p.moving && p.botFooting) {
    delete p.botFooting.skippedX;
    delete p.botFooting.skippedY;
  }
  if (p.input >= 0 || (p.slideDir ?? -1) >= 0) {
    if (p.botFooting) p.botFooting.adjusting = false;
    return;
  }
  const cell = playerCell(p), dx = p.x - cell.x, dy = p.y - cell.y;
  let footing = p.botFooting;
  const clearance = .5 - Math.max(Math.abs(dx), Math.abs(dy));
  // A dead band near the cell boundary, not a pull toward the centre.
  if (!footing?.adjusting && clearance >= .08) return;
  if (!footing || footing.round !== s.round) footing = p.botFooting = {
    round: s.round, seed: (s.seed + (s.players.indexOf(p) + 1) * 104729) % 2147483646 + 1,
    adjusting: false,
  };
  if (!footing.adjusting) {
    // One mild preference per stop, not a correction retried until accepted.
    if (footing.skippedX === p.x && footing.skippedY === p.y) return;
    if (random(footing, 5) >= 3) {
      footing.skippedX = p.x; footing.skippedY = p.y;
      return;
    }
    footing.clearance = .10 + random(footing, 5) / 100;
    footing.adjusting = true;
  }
  if (clearance >= footing.clearance) { footing.adjusting = false; return; }
  const now = simulationFrame(s) / 5;
  planner ??= createBotPlanner(s, p, balls, blastCells, visible, false);
  if (visible.has(key(cell.x, cell.y)) || planner.original.prediction.unsafe(cell.x, cell.y, now, now + 2)) {
    footing.adjusting = false; return;
  }
  const penalty = actor => Math.max(0, Math.abs(actor.x - cell.x) - .5 + footing.clearance) +
    Math.max(0, Math.abs(actor.y - cell.y) - .5 + footing.clearance);
  const directions = Math.abs(dx) >= Math.abs(dy)
    ? [dx > 0 ? 2 : 0, dy > 0 ? 3 : 1] : [dy > 0 ? 3 : 1, dx > 0 ? 2 : 0];
  for (const dir of directions) {
    const probe = { ...p }, preview = { ...s, balls: balls.map(b => ({ ...b })) };
    movePlayer(preview, probe, dir, MOTION_STEP, COLS, ROWS, playerSpeed(p, now));
    const next = playerCell(probe);
    if (next.x !== cell.x || next.y !== cell.y || penalty(probe) >= penalty(p) ||
      preview.balls.some((b, i) => b.flight !== balls[i].flight)) continue;
    p.input = dir;
    return;
  }
}

function perceiveKicks(s, p, random) {
  const frame = simulationFrame(s);
  // Keep perception RNG separate from roaming and wave placement. Save it on
  // the actor so cloned/replayed games retain the same pending observations.
  let memory = p.botAwareness;
  if (!memory || memory.round !== s.round) {
    memory = p.botAwareness = {
      round: s.round,
      seed: (s.seed + (s.players.indexOf(p) + 1) * 7919) % 2147483646 + 1,
      balls: {},
    };
  }
  const live = new Set(s.balls.map(b => String(b.id)));
  for (const id of Object.keys(memory.balls)) if (!live.has(id)) delete memory.balls[id];
  let noticed = false;
  const balls = s.balls.filter(b => {
    // A bot knows where it deliberately kicked its own ball.
    if (b.owner != null && b.owner === p.id) { delete memory.balls[b.id]; return true; }
    let observation = memory.balls[b.id];
    if (b.flight) {
      const flight = `${b.flight.start}:${b.flight.end}:${b.x}:${b.y}`;
      if (observation?.flight !== flight) {
        const moving = p.moving || (p.slideDir ?? -1) >= 0;
        const [minMs, maxMs] = moving ? [400, 650] : [250, 400];
        const minFrames = Math.ceil(minMs / MOTION_STEP);
        const maxFrames = Math.floor(maxMs / MOTION_STEP);
        observation = memory.balls[b.id] = {
          flight, readyAt: frame + minFrames + random(memory, maxFrames - minFrames + 1),
          noticed: false,
        };
      }
    }
    // Landing or stopping does not restart or shorten an observation delay.
    if (observation && !observation.noticed) {
      if (frame < observation.readyAt) return false;
      observation.noticed = true;
      noticed = true;
    }
    return true;
  });
  return { balls, noticed };
}

export function botInput(s, p, blastCells, random) {
  if (p.status !== "alive") {
    p.input = -1;
    if (p.botFooting) p.botFooting.adjusting = false;
    return;
  }
  // A short footing adjustment is not a held roaming command.
  if (p.botFooting?.adjusting) p.input = -1;
  const { balls, noticed } = perceiveKicks(s, p, random);
  const now = simulationFrame(s) / 5;
  const visible = new Set(s.blasts.filter(b => b.until > now).map(b => key(b.x, b.y)));
  const cell = playerCell(p), leavingBlast = visible.has(key(cell.x, cell.y));
  let planner;
  // Original local steering: choose among neighbours every 200 ms, with random
  // variation, open exits and nearby rescue/contact opportunities.
  // A newly understood landing can prompt steering on this motion step rather
  // than adding up to another 200 ms after the observation delay.
  if (noticed || ((s.substep || 0) === 0 && s.tick % 2 === 0)) {
    if (p.botFooting) p.botFooting.adjusting = false;
    planner = createBotPlanner(s, p, balls, blastCells, visible, leavingBlast);
    let best = -Infinity, direction = -1;
    for (const d of [-1, 0, 1, 2, 3]) {
      const x = cell.x + (d < 0 ? 0 : DX[d]), y = cell.y + (d < 0 ? 0 : DY[d]);
      if (!inside(x, y)) continue;
      const blocker = at(balls, x, y);
      const plan = blocker ? (d < 0 ? null : planner.kick(blocker, d)) : planner.original;
      if (!plan) continue;
      const danger = plan.danger;
      // Check visibility now, not at the future arrival estimate: the last
      // part of an explosion animation must not invite immediate re-entry.
      if (!leavingBlast && visible.has(key(x, y))) continue;
      let value = random(s, 20) / 20;
      if (danger(x, y, now + 2)) value -= 100;
      if (danger(x, y, now + 8)) value -= 25;
      if (plan.nearby) value += plan.route(x, y);
      value += plan.bonus || 0;
      let exits = 0;
      for (let a = 0; a < 4; a++)
        if (inside(x + DX[a], y + DY[a]) && !at(plan.balls, x + DX[a], y + DY[a]) &&
          !danger(x + DX[a], y + DY[a], now + 4)) exits++;
      value += exits * 2;
      for (const target of s.players.filter(q => q.status === "bubble")) {
        const distance = Math.abs(x - target.x) + Math.abs(y - target.y);
        value += (target.team === p.team ? 10 : 5) / (distance + 1);
      }
      if (d === -1) value -= .4;
      if (value > best) { best = value; direction = d; }
    }
    p.input = direction;
  }
  // An explosion can appear between steering decisions. Guard held movement on
  // every 20 ms step, including a perpendicular edge-assistance displacement.
  // Actors already in foam may leave; banana sliding remains forced by physics.
  if (visible.size && !leavingBlast && p.input >= 0 && (p.slideDir ?? -1) < 0) {
    if (visible.has(key(cell.x + DX[p.input], cell.y + DY[p.input]))) p.input = -1;
    else {
      const probe = { ...p }, world = { ...s, balls: s.balls.map(b => ({ ...b })) };
      movePlayer(world, probe, p.input, MOTION_STEP, COLS, ROWS, playerSpeed(p, now));
      const next = playerCell(probe);
      if (visible.has(key(next.x, next.y))) p.input = -1;
    }
  }
  // Reuse the same perceived hazards, including the incoming-kick delay.
  adjustStoppedFooting(s, p, balls, blastCells, planner, visible, random);
}
