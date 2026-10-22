import { SIZE, TYPE_COUNT } from "./constants.js";

export const GOAL_KINDS = ["collect", "spread", "reveal", "deliver"];
export const isDelivery = (piece) => piece?.kind === "delivery";
const MAX_ACTIVE_DELIVERIES = 2;

export function deliverySpawnCount(board, goal) {
  if (goal?.kind !== "deliver") return 0;
  const active = board.filter(isDelivery).length;
  return Math.max(0, Math.min(MAX_ACTIVE_DELIVERIES, goal.total - goal.delivered) - active);
}

export function goalKindForLevel(level, daily = false) {
  // Every level advances the rotation; five-level challenge spacing advances it by one too.
  return daily ? "collect" : GOAL_KINDS[(level - 1) % GOAL_KINDS.length];
}

export const isChallengeLevel = (level, daily = false) => !daily && level >= 10 && level % 5 === 0;

export function createObjective(kind, level, daily = false) {
  if (kind === "spread") {
    const side = level < 20 ? 4 : level < 100 ? 6 : SIZE;
    const start = (SIZE - side) / 2;
    const cells = [];
    for (let row = start; row < start + side; row++)
      for (let col = start; col < start + side; col++) cells.push(row * SIZE + col);
    const end = start + side - 1;
    const painted = [
      27, 28, 35, 36,
      start * SIZE + start, start * SIZE + end,
      end * SIZE + start, end * SIZE + end,
    ];
    // Corner L shapes preserve horizontal, vertical and quarter-turn symmetry.
    if (side > 4 && !isChallengeLevel(level, daily))
      painted.push(
        start * SIZE + start + 1, (start + 1) * SIZE + start,
        start * SIZE + end - 1, (start + 1) * SIZE + end,
        end * SIZE + start + 1, (end - 1) * SIZE + start,
        end * SIZE + end - 1, (end - 1) * SIZE + end,
      );
    return { kind, cells, painted: painted.sort((a, b) => a - b) };
  }
  if (kind === "reveal") {
    const anchors = isChallengeLevel(level, daily)
      ? [9, 28, 49, 14, 54].slice(0, level < 100 ? 4 : 5)
      : level < 20 ? [18, 44] : [9, 28, 49];
    return {
      kind,
      groups: anchors.map((index, i) => ({
        cells: [index, index + 1, index + SIZE, index + SIZE + 1],
        type: (level + i) % TYPE_COUNT,
      })),
      revealed: [],
    };
  }
  if (kind === "deliver")
    return { kind, total: level < 100 ? 2 : 3, delivered: 0,
      exits: Array.from({ length: SIZE }, (_, col) => col) };
  return { kind: "collect" };
}

export function objectiveProgress(game, config) {
  const goal = game.objective ?? { kind: "collect" };
  let current, total;
  switch (goal.kind) {
    case "spread":
      current = goal.painted.length;
      total = goal.cells.length;
      break;
    case "reveal": {
      const revealed = new Set(goal.revealed);
      current = goal.groups.filter(group => group.cells.every(index => revealed.has(index))).length;
      total = goal.groups.length;
      break;
    }
    case "deliver":
      current = goal.delivered;
      total = goal.total;
      break;
    default:
      current = game.collected[config.targetType];
      total = config.count;
  }
  return { kind: goal.kind, current: Math.min(current, total), total, complete: current >= total };
}

/** Floor progress is tied to board coordinates, including retained reward cells. */
export function advanceObjective(game, wave) {
  const goal = game.objective ?? { kind: "collect" };
  if (goal.kind !== "spread" && goal.kind !== "reveal") return goal;
  const affected = new Set([...wave.cleared, ...wave.creations.keys()]);
  if (goal.kind === "reveal") {
    const targets = new Set(goal.groups.flatMap(group => group.cells));
    const revealed = new Set(goal.revealed);
    for (const index of affected) if (targets.has(index)) revealed.add(index);
    return { ...goal, revealed: [...revealed].sort((a, b) => a - b) };
  }
  const targets = new Set(goal.cells), initialPainted = new Set(goal.painted);
  const painted = new Set(initialPainted);
  // Match groups share paint, but a stripe carries it only from its origin.
  // Crossing painted floor along a ray cannot send paint back to that origin.
  const groups = wave.effectGroups ?? [];
  for (;;) {
    const previous = painted.size;
    for (const group of groups) {
      // Exchange batches sample the floor before any effects in this wave.
      const sourcePaint = group.initial ? initialPainted : painted;
      if (group.sources.some(index => affected.has(index) && sourcePaint.has(index)))
        for (const index of group.indices)
          if (affected.has(index) && targets.has(index)) painted.add(index);
    }
    if (painted.size === previous) break;
  }
  return { ...goal, painted: [...painted].sort((a, b) => a - b) };
}

/** Arrivals are removed only after their fall; refill and normal cascades then continue. */
export function collectDeliveries(game, board) {
  const goal = game.objective;
  if (goal?.kind !== "deliver") return null;
  const indices = [];
  for (const col of goal.exits) {
    const index = (SIZE - 1) * SIZE + col;
    if (isDelivery(board[index])) indices.push(index);
  }
  if (!indices.length) return null;
  const arrived = new Set(indices);
  return {
    indices,
    board: board.map((piece, index) => arrived.has(index) ? null : piece),
    objective: { ...goal, delivered: goal.delivered + indices.length },
  };
}

const indicesValid = (list, maximum = SIZE * SIZE, allowEmpty = false) =>
  Array.isArray(list) && (allowEmpty || list.length > 0) && list.length <= maximum &&
  Array.from(list).every(index => Number.isInteger(index) && index >= 0 && index < maximum) &&
  new Set(list).size === list.length;

export function validObjective(game) {
  const goal = game.objective ?? { kind: "collect" };
  const deliveries = game.board.filter(isDelivery).length;
  if (!GOAL_KINDS.includes(goal.kind) || (goal.kind !== "deliver" && deliveries)) return false;
  if (goal.kind === "collect") return true;
  if (goal.kind === "spread")
    return indicesValid(goal.cells) && indicesValid(goal.painted, SIZE * SIZE, true) &&
      goal.painted.every(index => goal.cells.includes(index)) && goal.painted.length > 0;
  if (goal.kind === "reveal") {
    if (!Array.isArray(goal.groups) || !goal.groups.length || goal.groups.length > 8 ||
      !Array.from(goal.groups).every(group => group && indicesValid(group.cells) &&
        Number.isInteger(group.type) && group.type >= 0 && group.type < TYPE_COUNT)) return false;
    const cells = goal.groups.flatMap(group => group.cells);
    return indicesValid(cells) && indicesValid(goal.revealed, SIZE * SIZE, true) &&
      goal.revealed.every(index => cells.includes(index));
  }
  return Number.isInteger(goal.total) && goal.total >= 1 && goal.total <= 4 &&
    Number.isInteger(goal.delivered) && goal.delivered >= 0 && goal.delivered <= goal.total &&
    indicesValid(goal.exits, SIZE) &&
    // Unspawned targets stay in reserve; legacy boards may already contain all targets.
    deliveries + goal.delivered >= Math.min(MAX_ACTIVE_DELIVERIES, goal.total) &&
    deliveries + goal.delivered <= goal.total;
}

/** A comparable progress value for move ranking, with partial uncovering and downward travel. */
export function objectiveValue(game, config) {
  const progress = objectiveProgress(game, config), goal = game.objective;
  if (progress.kind === "collect") return progress.current * 90;
  if (progress.kind === "spread") return progress.current * 80;
  if (progress.kind === "reveal") return goal.revealed.length * 140 + progress.current * 250;
  return progress.current * 900 + game.board.reduce((value, piece, index) =>
    value + (isDelivery(piece) ? Math.floor(index / SIZE) * 100 : 0), 0);
}
