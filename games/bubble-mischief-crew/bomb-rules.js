import { inside, COLS, ROWS } from "./arena.js";
// Keep native rule 2's cadence; increase each type's count by 50% (rounded up)
// throughout the round to reduce draws. See README; mirror in game.lua.
export const BOMB = Object.freeze({
  kickDistance: 8,
  flightFrames: 20, // 400 ms at the 20 ms motion step.
  fuseFrames: 151, // Native 3000 ms fuse is due only once remaining time is negative.
  fallTicks: 8, // Visual tuning; not recovered from the original client.
});
export const FIRST_WAVE_MS = 5000;
export const simulationFrame = (s) => s.tick * 5 + (s.substep || 0);
// Native rule timers use the scene clock, including Ready/Go; pauses freeze it.
export const airborneElapsed = (s) => simulationFrame(s) * 20;
export const airborneInterval = (elapsedMs) =>
  Math.max(4000, 9000 - Math.floor(elapsedMs / 8));
export const airborneCounts = (elapsedMs) => ({
  normal: Math.ceil(1.5 * Math.min(15, 5 + Math.floor(elapsedMs / 16000))),
  football: Math.ceil(1.5 * Math.min(10, 1 + Math.floor(elapsedMs / 16000))),
});
export const waveDue = (elapsedMs, lastWaveAt = -1) =>
  lastWaveAt < 0
    ? elapsedMs >= FIRST_WAVE_MS
    : elapsedMs - lastWaveAt >= airborneInterval(elapsedMs);
export const bombRange = (kind) => (kind === "football" ? 4 : 1);

// Count the native 15 × 13 map, including the terrace and boundary objects.
// Football contact producer 0060cf49 probes eight cells, then BACK toward the ball.
export function kickDestination(x, y, dir, width = COLS, height = ROWS) {
  const native = width === COLS && height === ROWS;
  const dx = [1, 0, -1, 0][dir], dy = [0, 1, 0, -1][dir];
  const axis = (value, delta, span, offset) => ((value + offset + delta) % span + span) % span - offset;
  const target = distance => ({
    x: axis(x, dx * distance, width + 2, 1),
    y: axis(y, dy * distance, native ? 13 : height + 2, native ? 4 : 1),
    distance,
  });
  for (let distance = BOMB.kickDistance; distance >= 1; distance--) {
    const cell = target(distance);
    if ((native ? inside(cell.x, cell.y) : cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height) &&
      (cell.x !== x || cell.y !== y)) return cell;
  }
  return { x, y, distance: 0 };
}
export function kickLanding(x, y, dir, width = COLS, height = ROWS) {
  const { x: tx, y: ty } = kickDestination(x, y, dir, width, height);
  return { x: tx, y: ty };
}
