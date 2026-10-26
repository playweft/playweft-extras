import { BOMB, kickDestination, simulationFrame } from "./bomb-rules.js";
import { GOALS, COLS, ROWS } from "./arena.js";
// Fixed-point collision geometry; public positions remain fractional cell coordinates.
// A cell's centre is its integer coordinate. Logical checks use the closest centre.
export const UNIT = 1000,
  // Native FUN_005b7d1b probes +/-19 pixels on a 40-pixel cell.
  BODY_HALF = 475,
  CLEARANCE = 500 + BODY_HALF,
  BOMB_ENTRY = 75, // Native 005b7f5c tests the first 3 / 40 cell at entry.
  KICK_PROBE = 550; // Native contact point: 22 / 40 cell ahead of the centre.
export const MOVE_SPEED = 5100,
  SLIDE_SPEED = 4000,
  MOTION_STEP = 20;
export const gridCell = (value) => Math.floor(value + 0.5);
export const playerCell = (player) => ({
  x: gridCell(player.x),
  y: gridCell(player.y),
});
const DX = [1, 0, -1, 0],
  DY = [0, 1, 0, -1];

// Sweep along one axis. Contact is permitted; overlapping into a solid is not.
function travel(balls, px, py, dir, distance, width, height) {
  const horizontal = dir % 2 === 0,
    sign = dir < 2 ? 1 : -1;
  const along = horizontal ? px : py,
    across = horizontal ? py : px;
  const entryLimit = -CLEARANCE + BOMB_ENTRY + (sign < 0 ? 1 : 0);
  const limit = ((horizontal ? width : height) - 1) * UNIT;
  let allowed = Math.max(
    0,
    Math.min(distance, sign > 0 ? limit - along : along),
  );
  let blocker = null;
  if (width === COLS && height === ROWS) for (const goal of GOALS) {
    const low = horizontal ? goal.minX : goal.minY,
      high = horizontal ? goal.maxX : goal.maxY,
      crossLow = horizontal ? goal.minY : goal.minX,
      crossHigh = horizontal ? goal.maxY : goal.maxX;
    if (across <= crossLow - BODY_HALF || across >= crossHigh + BODY_HALF) continue;
    const edge = sign > 0 ? low - BODY_HALF : high + BODY_HALF;
    if (sign * (along - (low + high) / 2) >= 0) continue;
    const contact = Math.max(0, sign * (edge - along));
    if (contact < allowed || (contact === allowed && blocker === null)) {
      allowed = contact;
      blocker = { goal };
    }
  }
  for (const ball of balls) {
    if (ball.flight) continue;
    const centre = (horizontal ? ball.x : ball.y) * UNIT;
    const cross = (horizontal ? ball.y : ball.x) * UNIT;
    if (Math.abs(across - cross) >= CLEARANCE) continue;
    const offset = sign * (along - centre);
    let contact;
    if (offset <= -CLEARANCE) contact = -offset - CLEARANCE;
    // A landed ball may already surround the body. Native dynamic collision
    // blocks its entry strip, not movement inside it; let the player walk out
    // in any direction. Approaching from outside still stops at the boundary.
    else if (offset < entryLimit) contact = 0;
    else continue;
    if (
      contact < allowed ||
      (contact === allowed &&
        (blocker === null ||
          (!blocker.goal && ball.y * width + ball.x < blocker.y * width + blocker.x)))
    ) {
      allowed = contact;
      blocker = ball;
    }
  }
  return { distance: allowed, blocker };
}
export function launchBall(state, player, ball, dir, width = COLS, height = ROWS) {
  if (
    ball.flight ||
    state.balls.some(
      (b) => b !== ball && !b.flight && b.x === ball.x && b.y === ball.y,
    )
  )
    return false;
  const target = kickDestination(ball.x, ball.y, dir, width, height);
  if (!target.distance) return false;
  ball.flight = {
    distance: target.distance,
    x: ball.x,
    y: ball.y,
    start: simulationFrame(state),
    end: simulationFrame(state) + BOMB.flightFrames,
  };
  ball.x = target.x;
  ball.y = target.y;
  ball.dir = dir;
  ball.owner = player.id;
  return true;
}
export function movePlayer(
  state,
  player,
  dir,
  milliseconds = MOTION_STEP,
  width = COLS,
  height = ROWS,
  speed = MOVE_SPEED,
  forced = false,
) {
  player.moving = false;
  if (dir < 0 || player.status !== "alive") return;
  let px = Math.round(player.x * UNIT),
    py = Math.round(player.y * UNIT);
  const startX = px,
    startY = py;
  // Native 0060cf49 checks the forward 22-pixel point before movement.
  const frontX = gridCell((px + DX[dir] * KICK_PROBE) / UNIT),
    frontY = gridCell((py + DY[dir] * KICK_PROBE) / UNIT);
  if (frontX !== gridCell(px / UNIT) || frontY !== gridCell(py / UNIT)) {
    const target = state.balls.find(b => !b.flight && b.x === frontX && b.y === frontY);
    if (target) launchBall(state, player, target, dir, width, height);
  }
  let remaining = milliseconds * 1000;
  for (let segment = 0; segment < 5 && remaining > 0; segment++) {
    const wanted = Math.floor((speed * remaining) / 1000000);
    if (wanted <= 0) break;
    const forward = travel(state.balls, px, py, dir, wanted, width, height);
    px += DX[dir] * forward.distance;
    py += DY[dir] * forward.distance;
    remaining -= forward.distance * (1000000 / speed);
    if (forward.distance === wanted || !forward.blocker) break;
    const blocker = forward.blocker,
      horizontal = dir % 2 === 0;
    if (forced) break;
    const across = horizontal ? py : px;
    const centre = blocker.goal ? 0 : (horizontal ? blocker.y : blocker.x) * UNIT;
    const low = blocker.goal ? (horizontal ? blocker.goal.minY : blocker.goal.minX) : centre - 500;
    const high = blocker.goal ? (horizontal ? blocker.goal.maxY : blocker.goal.maxX) : centre + 500;
    const towardLow = across - low + BODY_HALF,
      towardHigh = high + BODY_HALF - across,
      negative = towardLow < towardHigh,
      overlap = Math.min(towardLow, towardHigh);
    // Only a partial edge obstruction gets assistance. Full blocks stay solid.
    if (overlap <= 0 || overlap > BODY_HALF) break;
    const sideDir = horizontal ? (negative ? 3 : 1) : negative ? 2 : 0;
    const sideDistance = Math.min(
      overlap,
      Math.floor((SLIDE_SPEED * remaining) / 1000000),
    );
    const side = travel(
      state.balls,
      px,
      py,
      sideDir,
      sideDistance,
      width,
      height,
    );
    if (!side.distance) break;
    px += DX[sideDir] * side.distance;
    py += DY[sideDir] * side.distance;
    remaining -= side.distance * (1000000 / SLIDE_SPEED);
    if (side.distance < overlap) break;
  }
  player.x = px / UNIT;
  player.y = py / UNIT;
  player.moving = px !== startX || py !== startY;
  return Math.abs(px - startX) + Math.abs(py - startY) < Math.floor(speed * milliseconds / 1000);
}
