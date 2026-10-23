import { playerCell, CLEARANCE, UNIT } from "./movement.js";
import { inside, COLS, ROWS } from "./arena.js";
import { BOMB, simulationFrame, airborneElapsed } from "./bomb-rules.js";
import { chooseItem, SLOW_TICKS, RECYCLE_MS } from "./item-rules.js";

export function useItem(s, index, slot) {
  const p = s.players[index], item = p?.inventory?.[slot - 1];
  if (s.phase !== "playing" || !Number.isInteger(slot) || slot < 1 || slot > 7 || !item?.count) return false;
  if (item.kind === "fork") {
    if (p.status !== "bubble") return false;
    p.status = "alive"; p.immune = s.tick + 12; p.slowUntil = 0; p.slideDir = -1;
  } else {
    if (p.status !== "alive" || !["glue", "banana"].includes(item.kind)) return false;
    const cell = playerCell(p);
    if (!inside(cell.x, cell.y)) return false;
    s.traps ??= [];
    s.traps.push({ ...cell, id: s.nextId++, kind: item.kind, owner: p.id,
      passableBy: s.players.filter(q => q.status === "alive" &&
        Math.abs(q.x - cell.x) * UNIT < CLEARANCE && Math.abs(q.y - cell.y) * UNIT < CLEARANCE).map(q => q.id) });
  }
  item.count--;
  return true;
}
function grant(p, item) {
  if (!item.kind) { p.shield = true; return true; } // Legacy fixture / saved state.
  if (item.kind === "shoe") { p.shoes = Math.min(3, (p.shoes || 0) + 1); return true; }
  p.inventory ??= [];
  let slot = p.inventory.find(i => i.kind === item.kind) || p.inventory.find(i => !i.count);
  if (!slot) {
    if (p.inventory.length >= 7) return false;
    slot = { kind: item.kind, count: 0 }; p.inventory.push(slot);
  }
  slot.kind = item.kind;
  slot.count = Math.min(255, slot.count + (item.kind === "glue" ? 3 : 1));
  return true;
}
export function collectAndTriggerItems(s, previousCells) {
  for (const p of s.players) {
    if (p.status !== "alive") continue;
    const cell = playerCell(p);
    const item = s.items.find(i => i.x === cell.x && i.y === cell.y);
    if (item && grant(p, item)) s.items.splice(s.items.indexOf(item), 1);
  }
  s.traps ??= [];
  for (const trap of [...s.traps]) {
    trap.passableBy = (trap.passableBy || []).filter(id => {
      const p = s.players.find(q => q.id === id);
      return p?.status === "alive" && Math.abs(p.x - trap.x) * UNIT < CLEARANCE &&
        Math.abs(p.y - trap.y) * UNIT < CLEARANCE;
    });
    const p = s.players.find(p => {
      const cell = playerCell(p), prev = previousCells.get(p.id);
      return p.status === "alive" && p.immune <= s.tick && !trap.passableBy.includes(p.id) &&
        cell.x === trap.x && cell.y === trap.y && (cell.x !== prev.x || cell.y !== prev.y);
    });
    if (!p) continue;
    if (trap.kind === "glue") { p.slowUntil = simulationFrame(s) / 5 + SLOW_TICKS; p.slideDir = -1; }
    else { p.slowUntil = 0; p.slideDir = p.dir; }
    s.traps.splice(s.traps.indexOf(trap), 1);
  }
}
export function clearBlastedItems(s, hot) {
  s.recycled ??= [];
  for (const key of ["items", "traps"]) s[key] = (s[key] || []).filter(item => {
    if (!hot.has(item.y * COLS + item.x)) return true;
    if (item.kind) s.recycled.push({ kind: item.kind, placed: key === "traps" });
    return false;
  });
}
export function landItems(s) {
  s.itemDrops ??= []; s.traps ??= [];
  for (const drop of s.itemDrops.filter(d => d.at <= simulationFrame(s) / 5)) {
    const { x, y, id, kind, placed } = drop;
    if (placed) s.traps.push({ x, y, id, kind, owner: "", passableBy: [] });
    else s.items.push({ x, y, id, kind });
  }
  s.itemDrops = s.itemDrops.filter(d => d.at > simulationFrame(s) / 5);
}
function dropItem(s, kind, cell, random, placed = false) {
  const start = simulationFrame(s) / 5;
  s.itemDrops ??= [];
  s.itemDrops.push({ id: s.nextId++, x: cell % COLS, y: Math.floor(cell / COLS),
    kind, placed, fromX: random(s, COLS), start, at: start + BOMB.fallTicks });
}
export function dispatchWaveItem(s, cells, bombCount, random) {
  const kind = chooseItem(s, airborneElapsed(s), random);
  if (kind) dropItem(s, kind, cells[bombCount + random(s, cells.length - bombCount)], random);
}
export function dispatchRecycledItems(s, random) {
  const elapsed = airborneElapsed(s);
  if (!s.recycled?.length || elapsed - (s.lastRecycleAt || 0) < RECYCLE_MS) return;
  s.lastRecycleAt = elapsed;
  const cells = Array.from({ length: COLS * ROWS }, (_, cell) => cell)
    .filter(cell => inside(cell % COLS, Math.floor(cell / COLS)));
  for (const item of s.recycled.splice(0, 64)) {
    dropItem(s, item.kind, cells.splice(random(s, cells.length), 1)[0], random, item.placed);
  }
}
