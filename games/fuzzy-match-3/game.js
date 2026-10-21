import { SIZE, TYPE_COUNT } from "./constants.js";
import {
  createObjective,
  deliverySpawnCount,
  goalKindForLevel,
  isChallengeLevel,
  isDelivery,
  objectiveProgress,
  validObjective,
} from "./objectives.js";
export { SIZE, TYPE_COUNT } from "./constants.js";
export const MOVE_BONUS = 1500;
const PATTERN_BONUSES = { row: 80, column: 80, color: 200 };
let nextId = 0;
const tile = (type) => ({ id: ++nextId, type, special: null });
const perpendicular = (direction) => (direction === "row" ? "column" : "row");
const ICE_LAYOUTS = [
  [1, 62, 8, 55, 6, 57, 15, 48],
  [9, 54, 14, 49, 17, 46, 22, 41],
  [10, 53, 24, 39, 13, 50, 31, 32],
  [2, 61, 16, 47, 5, 58, 23, 40],
  [11, 52, 25, 38, 12, 51, 30, 33],
  [18, 45, 21, 42, 26, 37, 29, 34],
];

export const iceLayers = (board) =>
  board.reduce((total, piece) => total + (piece?.ice || 0), 0);

export function pendingColorClear(board) {
  let selected = -1;
  for (let i = 0; i < board.length; i++)
    if (
      board[i]?.special === "color" &&
      board[i].pending &&
      !board[i].ice &&
      (selected < 0 || board[i].pending < board[selected].pending)
    )
      selected = i;
  return selected;
}

const neighbors = (index) =>
  [index - SIZE, index + SIZE, index - 1, index + 1].filter((other) =>
    adjacent(index, other),
  );

function reachableCells(board) {
  const reachable = Array(board.length).fill(false);
  for (let i = 0; i < board.length; i++) {
    if (board[i]?.ice) continue;
    const col = i % SIZE;
    reachable[i] =
      i < SIZE ||
      reachable[i - SIZE] ||
      (col > 0 && reachable[i - SIZE - 1]) ||
      (col < SIZE - 1 && reachable[i - SIZE + 1]);
  }
  return reachable;
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function adjacent(a, b) {
  return (
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    a >= 0 &&
    b >= 0 &&
    a < 64 &&
    b < 64 &&
    Math.abs((a % SIZE) - (b % SIZE)) +
      Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) ===
      1
  );
}

export function swap(board, a, b) {
  const next = [...board];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

export function findMatches(board) {
  const lines = [];
  for (const direction of ["row", "column"]) {
    for (let outer = 0; outer < SIZE; outer++) {
      let run = [];
      const finish = () => {
        if (run.length >= 3) lines.push({ indices: run, direction });
      };
      for (let inner = 0; inner < SIZE; inner++) {
        const index =
          direction === "row" ? outer * SIZE + inner : inner * SIZE + outer;
        const piece = board[index];
        if (
          !piece ||
          piece.ice ||
          piece.special === "color" ||
          isDelivery(piece) ||
          (run.length && piece.type !== board[run[0]].type)
        ) {
          finish();
          run = [];
        }
        if (
          piece &&
          !piece.ice &&
          piece.special !== "color" &&
          !isDelivery(piece)
        )
          run.push(index);
      }
      finish();
    }
  }
  return lines;
}

const isStriped = (piece) =>
  piece?.special === "row" || piece?.special === "column";

function exchangeCombo(board, a, b) {
  if (!adjacent(a, b) || !board[a] || !board[b] || board[a].ice || board[b].ice)
    return null;
  if (isDelivery(board[a]) || isDelivery(board[b])) return null;
  if (board[a].special === "color" || board[b].special === "color")
    return isStriped(board[a]) || isStriped(board[b]) ? "colorStripe" : "color";
  return isStriped(board[a]) && isStriped(board[b]) ? "doubleStripe" : null;
}

export function canSwap(board, a, b) {
  if (pendingColorClear(board) >= 0) return false;
  if (!adjacent(a, b) || !board[a] || !board[b] || board[a].ice || board[b].ice)
    return false;
  return (
    !!exchangeCombo(board, a, b) ||
    findMatches(swap(board, a, b)).some(
      (line) => line.indices.includes(a) || line.indices.includes(b),
    )
  );
}

export function findMove(board) {
  for (let a = 0; a < board.length; a++) {
    for (const b of [a + 1, a + SIZE]) if (canSwap(board, a, b)) return [a, b];
  }
  return null;
}

export function createBoard(random = Math.random) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const board = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const allowed = Array.from(
        { length: TYPE_COUNT },
        (_, type) => type,
      ).filter(
        (type) =>
          !(
            i % SIZE >= 2 &&
            board[i - 1].type === type &&
            board[i - 2].type === type
          ) &&
          !(
            i >= SIZE * 2 &&
            board[i - SIZE].type === type &&
            board[i - SIZE * 2].type === type
          ),
      );
      board.push(tile(allowed[Math.floor(random() * allowed.length)]));
    }
    if (findMove(board)) return board;
  }
  throw new Error("Could not generate a playable board");
}

/** Intersecting runs form one shape and produce at most one special. */
function matchGroups(lines) {
  const groups = [];
  for (const line of lines) {
    const indices = new Set(line.indices);
    const connected = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (
        groups[i].some((run) => run.indices.some((index) => indices.has(index)))
      ) {
        const [group] = groups.splice(i, 1);
        connected.push(...group);
        for (const run of group)
          for (const index of run.indices) indices.add(index);
      }
    }
    groups.push([...connected, line]);
  }
  return groups;
}

function matchReward(group) {
  const longest = group.reduce((best, line) =>
    line.indices.length > best.indices.length ? line : best,
  );
  const crossing =
    group.some((line) => line.direction === "row") &&
    group.some((line) => line.direction === "column");
  const special =
    crossing || longest.indices.length >= 5
      ? "color"
      : longest.indices.length === 4
        ? perpendicular(longest.direction)
        : null;
  return { longest, special };
}

function mostCommonType(board) {
  const counts = Array(TYPE_COUNT).fill(0);
  for (const piece of board)
    if (piece && piece.special !== "color" && !isDelivery(piece))
      counts[piece.type]++;
  return counts.indexOf(Math.max(...counts));
}

/** Resolve a match, special exchange, or a batch of end-of-game specials. */
export function resolveWave(
  board,
  {
    preferred = [],
    forced = [],
    exchange = [],
    finale = false,
    chain = 1,
    random = Math.random,
  } = {},
) {
  if (finale && exchange.length) return null;
  const pendingIndex = finale ? -1 : pendingColorClear(board);
  if (pendingIndex >= 0 && exchange.length) return null;
  // Each refill processes exactly one queued color-clear special before natural matches.
  const lines = finale || pendingIndex >= 0 ? [] : findMatches(board);
  const finaleStripes = [],
    finaleColorClears = [],
    finaleFrozen = [];
  if (finale)
    board.forEach((piece, index) => {
      if (!piece?.special) return;
      if (piece.ice) {
        finaleFrozen.push(index);
        return;
      }
      if (isStriped(piece)) finaleStripes.push(index);
      if (piece.special === "color") finaleColorClears.push(index);
    });
  const combo =
    exchange.length === 2 ? exchangeCombo(board, ...exchange) : null;
  if (
    exchange.length &&
    (exchange.length !== 2 ||
      !adjacent(...exchange) ||
      !board[exchange[0]] ||
      !board[exchange[1]] ||
      board[exchange[0]].ice ||
      board[exchange[1]].ice ||
      (!combo &&
        !lines.some((line) =>
          line.indices.some((index) => exchange.includes(index)),
        )))
  )
    return null;
  const doubleColorClear =
    combo === "color" &&
    exchange.every((index) => board[index].special === "color");
  // Exchange coordinates refer to the board after swapping: the first selected
  // piece now occupies exchange[1], and its partner waits at exchange[0].
  const activated =
    pendingIndex >= 0
      ? [pendingIndex]
      : doubleColorClear
        ? [exchange[1]]
        : combo
          ? exchange.filter((index) => board[index]?.special)
          : [];
  const protectedColorClear = (index) =>
    doubleColorClear &&
    board[index]?.special === "color" &&
    index !== exchange[1];
  const transformed = new Map();
  let effectBoard = board;
  if (combo === "colorStripe") {
    const target =
      board[exchange.find((index) => isStriped(board[index]))].type;
    effectBoard = board.map((piece, index) => {
      if (piece?.type !== target || piece.ice) return piece;
      const special = random() < 0.5 ? "row" : "column";
      transformed.set(index, special);
      return { ...piece, special };
    });
  }
  const cleared = new Set(
    [
      ...lines.flatMap((line) => line.indices),
      ...(pendingIndex >= 0 ? [] : forced),
      ...activated,
      ...finaleStripes,
      ...finaleFrozen,
    ].filter((index) => board[index] && !isDelivery(board[index])),
  );
  if (!cleared.size && !finaleColorClears.length) return null;
  const groups = matchGroups(lines);
  const effectGroups = groups.map((group) => {
    const indices = [...new Set(group.flatMap((line) => line.indices))];
    return { sources: indices, indices };
  });
  const colorTargets = new Map();
  if (pendingIndex >= 0) colorTargets.set(pendingIndex, mostCommonType(board));
  if (exchange.length === 2) {
    for (const index of exchange) {
      if (board[index]?.special !== "color") continue;
      const other = board[exchange.find((i) => i !== index)];
      colorTargets.set(index, other?.special === "color" ? "all" : other?.type);
    }
  }
  const creations = new Map();
  const colorClearPartnerIndex =
    !doubleColorClear &&
    exchange.some((index) => board[index]?.special === "color")
      ? exchange.find((index) => board[index]?.special !== "color")
      : undefined;
  // A color-clear combo can also reward the natural pattern made by its partner.
  if (
    (!activated.length || colorClearPartnerIndex !== undefined) &&
    !forced.length
  ) {
    for (const group of groups) {
      const indices = [...new Set(group.flatMap((line) => line.indices))];
      if (activated.length && !indices.includes(colorClearPartnerIndex))
        continue;
      const { longest, special } = matchReward(group);
      if (!special) continue;
      const intersections = indices.filter(
        (index) =>
          group.filter((line) => line.indices.includes(index)).length > 1,
      );
      const eligible = (index) =>
        indices.includes(index) &&
        (!board[index].special || index === colorClearPartnerIndex);
      const index =
        (colorClearPartnerIndex !== undefined &&
        eligible(colorClearPartnerIndex)
          ? colorClearPartnerIndex
          : undefined) ??
        preferred.find(eligible) ??
        intersections.find(eligible) ??
        longest.indices.filter(eligible)[
          Math.floor(longest.indices.filter(eligible).length / 2)
        ];
      if (index !== undefined) creations.set(index, special);
    }
  }
  const armed = new Map();
  let pendingOrder = board.reduce(
    (order, piece) => Math.max(order, piece?.pending || 0),
    0,
  );
  if (doubleColorClear) armed.set(exchange[0], ++pendingOrder);
  for (const index of finaleColorClears)
    if (!board[index].pending) armed.set(index, ++pendingOrder);
  const immediateColorClears = new Set([
    ...activated,
    ...(pendingIndex >= 0 ? [] : forced),
  ]);
  // Directly activated batches fire together; crossing rays cannot override
  // their assigned directions, including the stripes in the finale.
  const stripeDirections = new Map([
    ...transformed,
    ...finaleStripes.map((index) => [index, board[index].special]),
  ]);
  const firedStripes = new Set();
  function stripeHit(index, incomingDirection) {
    const piece = effectBoard[index];
    if (!piece || isDelivery(piece)) return;
    if (
      piece?.special === "color" &&
      !piece.ice &&
      !immediateColorClears.has(index)
    ) {
      if (!protectedColorClear(index) && !piece.pending && !armed.has(index))
        armed.set(index, ++pendingOrder);
      return;
    }
    if (isStriped(piece) && !piece.ice && !stripeDirections.has(index))
      stripeDirections.set(
        index,
        piece.special === incomingDirection
          ? perpendicular(piece.special)
          : piece.special,
      );
    cleared.add(index);
  }
  if (combo === "doubleStripe") {
    // Each exchanged position clears a cross, regardless of stripe direction.
    for (const index of exchange) {
      const row = Math.floor(index / SIZE),
        col = index % SIZE;
      effectGroups.push({
        sources: [index],
        indices: Array.from({ length: SIZE }, (_, i) => [
          row * SIZE + i,
          i * SIZE + col,
        ]).flat(),
      });
      for (let i = 0; i < SIZE; i++) {
        stripeHit(row * SIZE + i, "row");
        stripeHit(i * SIZE + col, "column");
      }
    }
  }
  // Set iteration visits newly added cells, including every converted stripe.
  for (const index of cleared) {
    // Other color-clear specials survive the double-clear wave, including stripe hits.
    if (protectedColorClear(index)) {
      cleared.delete(index);
      continue;
    }
    const special = effectBoard[index]?.special;
    if (!special || effectBoard[index].ice) continue;
    const row = Math.floor(index / SIZE),
      col = index % SIZE;
    if (isStriped(effectBoard[index]) && !firedStripes.has(index)) {
      // Keep combo-assigned directions; otherwise use the first incoming ray.
      // Record it before tracing so self-hits and cycles cannot fire it again.
      const direction = stripeDirections.get(index) ?? special;
      stripeDirections.set(index, direction);
      firedStripes.add(index);
      effectGroups.push({
        // Converted stripes inherit paint from the exchanged pair as one batch.
        sources: transformed.has(index) ? exchange : [index],
        initial: transformed.has(index),
        indices: Array.from({ length: SIZE }, (_, i) =>
          direction === "row" ? row * SIZE + i : i * SIZE + col,
        ),
      });
      for (let i = 0; i < SIZE; i++)
        stripeHit(
          direction === "row" ? row * SIZE + i : i * SIZE + col,
          direction,
        );
    }
    if (special === "color") {
      const target = colorTargets.get(index) ?? mostCommonType(board);
      const affected = [index];
      board.forEach((piece, i) => {
        if (
          piece &&
          !isDelivery(piece) &&
          !protectedColorClear(i) &&
          (target === "all" || piece.type === target)
        ) {
          cleared.add(i);
          affected.push(i);
        }
      });
      effectGroups.push({
        sources: combo === "colorStripe" ? exchange : affected,
        initial: combo === "colorStripe",
        indices: affected,
      });
    }
  }
  if (armed.size)
    effectBoard = effectBoard.map((piece, index) =>
      armed.has(index) ? { ...piece, pending: armed.get(index) } : piece,
    );
  const iceHits = new Map();
  for (const index of cleared) {
    if (board[index]?.ice) iceHits.set(index, board[index].ice - 1);
    // A reward replaces a matched piece, so its cell still chips adjacent ice.
    if (!board[index] || board[index].ice) continue;
    for (const other of neighbors(index))
      if (board[other]?.ice) iceHits.set(other, board[other].ice - 1);
  }
  // Ice absorbs the whole wave; even a final-layer hit keeps its piece alive.
  for (const index of iceHits.keys()) cleared.delete(index);
  for (const index of creations.keys()) cleared.delete(index);
  const collected = Array(TYPE_COUNT).fill(0);
  const next = board.map((piece, index) => {
    if (armed.has(index)) return { ...piece, pending: armed.get(index) };
    if (iceHits.has(index)) {
      const thawed = { ...piece, ice: iceHits.get(index) };
      if (!thawed.ice) delete thawed.feedSide;
      return thawed;
    }
    // Replacing a matched piece with a reward collects the original type too.
    if (
      piece &&
      piece.special !== "color" &&
      (cleared.has(index) || creations.has(index))
    )
      collected[piece.type]++;
    if (creations.has(index)) {
      const special = creations.get(index);
      return {
        ...piece,
        type: special === "color" ? null : piece.type,
        special,
      };
    }
    if (!cleared.has(index)) return piece;
    return null;
  });
  const patternBonus = groups.reduce(
    (total, group) =>
      total + (PATTERN_BONUSES[matchReward(group).special] || 0),
    0,
  );
  // Matched piece converted to rewards earns base points and belongs to the area.
  const areaCount = cleared.size + creations.size;
  const areaProgress = Math.min(
    1,
    Math.max(0, (areaCount - 3) / (SIZE * SIZE - 3)),
  );
  const areaMultiplier = 1 + Math.sqrt(areaProgress);
  const clearScore =
    Math.round((areaCount * 60 * areaMultiplier * Math.min(chain, 5)) / 10) *
    10;
  return {
    board: next,
    cleared: [...cleared],
    collected,
    score: clearScore + patternBonus,
    clearScore,
    areaCount,
    areaMultiplier,
    patternBonus,
    groupCount: groups.length,
    effectGroups,
    creations,
    transformed,
    stripeDirections,
    effectBoard,
    iceHits,
    armed,
    triggeredColorClear: pendingIndex >= 0 ? pendingIndex : null,
    colorClearTarget: pendingIndex >= 0 ? colorTargets.get(pendingIndex) : null,
  };
}

export function refill(board, random = Math.random, onDrop, objective) {
  const next = [...board];
  let deliveries = deliverySpawnCount(board, objective);
  const incoming = () => {
    if (deliveries > 0) {
      deliveries--;
      return { ...tile(null), kind: "delivery" };
    }
    return tile(Math.floor(random() * TYPE_COUNT));
  };
  if (!iceLayers(board)) {
    // Without obstacles, compacting a column is equivalent to entering at its top.
    for (let col = 0; col < SIZE; col++) {
      const remaining = [];
      for (let row = SIZE - 1; row >= 0; row--)
        if (board[row * SIZE + col])
          remaining.push({
            piece: board[row * SIZE + col],
            from: row * SIZE + col,
          });
      for (let row = SIZE - 1; row >= 0; row--) {
        const index = row * SIZE + col;
        const survivor = remaining[SIZE - 1 - row];
        const piece = survivor?.piece ?? incoming();
        next[index] = piece;
        if (survivor) {
          if (survivor.from !== index) onDrop?.(piece, survivor.from, index);
        } else {
          onDrop?.(piece, col - SIZE, col);
          if (index !== col) onDrop?.(piece, col, index);
        }
      }
    }
    return next;
  }
  const reachable = reachableCells(next);
  const barriers = Array(next.length).fill(-1);
  for (let col = 0; col < SIZE; col++) {
    let barrier = -1;
    for (let index = col; index < next.length; index += SIZE) {
      barriers[index] = barrier;
      if (next[index]?.ice) barrier = index;
    }
  }
  for (;;) {
    let moved = false;
    // Settle vertical falls before taking piece from a neighboring column.
    for (let index = next.length - 1; index >= SIZE; index--) {
      if (next[index] || !next[index - SIZE] || next[index - SIZE].ice)
        continue;
      next[index] = next[index - SIZE];
      onDrop?.(next[index], index - SIZE, index);
      next[index - SIZE] = null;
      moved = true;
    }
    if (moved) continue;
    // Wait for any replenishable cell above, including upstream diagonal feeds.
    // Diagonals are a fallback only when that vertical supply is permanently cut.
    for (let index = next.length - 1; index >= SIZE; index--) {
      if (next[index] || reachable[index - SIZE]) continue;
      const col = index % SIZE;
      const sources = [
        col > 0 ? index - SIZE - 1 : -1,
        col < SIZE - 1 ? index - SIZE + 1 : -1,
      ];
      const barrier = barriers[index];
      // The blocking ice keeps its next turn across cascades and saves.
      const preferred = next[barrier].feedSide === "right" ? 1 : 0;
      const canFeed = sources.map(
        (i) => i >= 0 && !next[i]?.ice && (Boolean(next[i]) || reachable[i]),
      );
      const side = canFeed[preferred] ? preferred : 1 - preferred;
      const source = sources[side];
      // An open but temporarily empty preferred source waits for upstream piece.
      if (!canFeed[side] || !next[source]) continue;
      next[index] = next[source];
      onDrop?.(next[index], source, index);
      next[source] = null;
      const feedSide = side === 0 ? "right" : "left";
      if ((next[barrier].feedSide || "left") !== feedSide)
        next[barrier] = { ...next[barrier], feedSide };
      moved = true;
    }
    if (moved) continue;
    // Never create piece below ice: inaccessible pockets remain empty.
    for (let col = 0; col < SIZE; col++) {
      if (next[col]) continue;
      next[col] = incoming();
      onDrop?.(next[col], col - SIZE, col);
      moved = true;
    }
    if (!moved) break;
  }
  return next;
}

export function shuffleBoard(board, random = Math.random) {
  const movable = board.flatMap((piece, index) =>
    piece && !piece.ice && !isDelivery(piece) ? [index] : [],
  );
  if (movable.length < 3 && !findMove(board))
    throw new Error("No room for a legal exchange");
  for (let attempt = 0; attempt < 150; attempt++) {
    const next = [...board];
    for (let i = movable.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const a = movable[i],
        b = movable[j];
      [next[a], next[b]] = [next[b], next[a]];
    }
    if (!findMatches(next).length && findMove(next)) return next;
  }
  // Recolor movable piece if the existing colors cannot produce a stable board.
  for (let attempt = 0; attempt < 100; attempt++) {
    const colors = createBoard(random);
    const next = board.map((piece, i) =>
      !piece || piece.ice || isDelivery(piece) || piece.special === "color"
        ? piece
        : { ...piece, type: colors[i].type },
    );
    if (!findMatches(next).length && findMove(next)) return next;
  }
  throw new Error("Could not reshuffle movable piece");
}

function threeStarTarget(level) {
  // Intro levels ramp to level 4; the later curve continues past its level-1000 anchor.
  const fourthTarget = 28500;
  if (level <= 4) {
    const target = 9800 + ((level - 1) / 3) * (fourthTarget - 9800);
    return Math.round(target / 100) * 100;
  }
  const anchorStage = 996;
  const stage = level - 4;
  const progress = (stage * (anchorStage + 30)) / ((stage + 30) * anchorStage);
  const target = fourthTarget + progress * (35000 - fourthTarget);
  return Math.round(target / 100) * 100;
}

export function levelConfig(level = 1, daily = false) {
  // Anchor the slowing difficulty curve at level 1000 without truncating later levels.
  const anchorStage = 999;
  const stage = level - 1;
  const difficulty =
    (stage * (anchorStage + 30)) / ((stage + 30) * anchorStage);
  const iceCount =
    daily || level < 4 ? 0 : Math.min(8, 2 + Math.floor((level - 4) / 8));
  const doubleIce =
    daily || level < 25 ? 0 : Math.min(3, 1 + Math.floor((level - 25) / 20));
  const ice = iceCount + doubleIce;
  const layout = Math.max(0, Math.floor((level - 4) / 4)) % ICE_LAYOUTS.length;
  const iceCells = ICE_LAYOUTS[layout].slice(0, iceCount);
  const icePairs = iceCells.reduce(
    (total, index) =>
      total +
      iceCells.filter((other) => other > index && adjacent(index, other))
        .length,
    0,
  );
  const moves =
    (daily ? 24 : 28 - Math.round(9 * difficulty)) +
    Math.ceil((ice + icePairs) / 3);
  const scoreBase = daily
    ? 3000
    : Math.round((1800 + 13200 * difficulty) / 100) * 100;
  // Rebase the former 64% completion goal for the 800 → 1500 move bonus.
  const target = Math.ceil((scoreBase * 1.2) / 100) * 100;
  const threeStars = daily ? 11000 : threeStarTarget(level);
  const twoStars = Math.round((target + threeStars) / 2 / 100) * 100;
  const collectionChallenge = isChallengeLevel(level, daily);
  const collectionCount = collectionChallenge
    ? 36
    : Math.min(24, 12 + (level - 1) * 2);
  const goalKind = goalKindForLevel(level, daily);
  // Ease selected goals without reducing the existing opening move allowance.
  let iceConfig = { iceCount, doubleIce, iceCells, icePairs };
  if (goalKind === "spread") {
    iceConfig = { iceCount: 0, doubleIce: 0, iceCells: [], icePairs: 0 };
  } else if (goalKind === "deliver") {
    const cells = iceCells.slice(0, 2);
    iceConfig = {
      iceCount: cells.length,
      doubleIce: 0,
      iceCells: cells,
      icePairs: cells.filter((index, i) => cells.slice(i + 1).some(other => adjacent(index, other))).length,
    };
  }
  return {
    moves,
    goalKind,
    ...iceConfig,
    target,
    targetType: daily ? 1 : (level - 1) % TYPE_COUNT,
    count: daily ? 15 : collectionCount,
    starTargets: [target, twoStars, threeStars],
  };
}

// Keep earned match points separate: deriving the bonus prevents double awards on reload.
export function moveBonus(game) {
  return game.status === "won" ? game.moves * MOVE_BONUS : 0;
}

export function totalScore(game) {
  return game.score + moveBonus(game);
}

export function createGame(
  level = 1,
  daily = false,
  random = Math.random,
  options = {},
) {
  const config = levelConfig(level, daily);
  let board = createBoard(random);
  config.iceCells.forEach((index, order) => {
    board[index] = { ...board[index], ice: order < config.doubleIce ? 2 : 1 };
  });
  const objective = createObjective(options.goalKind ?? config.goalKind, level, daily);
  if (objective.kind === "deliver") {
    if (!daily && !isChallengeLevel(level)) {
      config.iceCells.slice(0, 2).forEach((index, order) => {
        board[index].special = order === 0 ? "row" : "column";
      });
    }
    const columns = [2, 5, 0, 7, 3, 4, 1, 6].filter((col) => !board[col].ice);
    for (const index of columns.slice(
      0,
      deliverySpawnCount(board, objective),
    )) {
      board[index] = { ...tile(null), kind: "delivery" };
    }
  }
  if (!findMove(board)) board = shuffleBoard(board, random);
  return {
    board,
    objective,
    iceGoal: iceLayers(board),
    level,
    moves: config.moves,
    score: 0,
    collected: Array(TYPE_COUNT).fill(0),
    hints: 3,
    shuffles: 2,
    status: "playing",
  };
}

export function gameStatus(
  game,
  daily = false,
  config = levelConfig(game.level, daily),
) {
  if (pendingColorClear(game.board) >= 0) return "playing";
  if (
    game.score >= config.target &&
    iceLayers(game.board) === 0 &&
    objectiveProgress(game, config).complete
  )
    return "won";
  return game.moves <= 0 ? "lost" : "playing";
}

export function validGame(game, { allowDeadBoard = false } = {}) {
  if (
    !game ||
    !Array.isArray(game.board) ||
    game.board.length !== 64 ||
    !Array.from(game.board).every(
      (f) =>
        f === null ||
        (f &&
          Number.isSafeInteger(f.id) &&
          (isDelivery(f)
            ? f.type === null &&
              f.special === null &&
              !f.ice &&
              f.pending === undefined
            : f.kind === undefined &&
              (f.special === "color"
                ? f.type === null
                : Number.isInteger(f.type) &&
                  f.type >= 0 &&
                  f.type < TYPE_COUNT)) &&
          [null, "row", "column", "color"].includes(f.special) &&
          Number.isInteger(f.ice ?? 0) &&
          (f.ice ?? 0) >= 0 &&
          (f.ice ?? 0) <= 2 &&
          (f.feedSide === undefined ||
            (f.ice > 0 && ["left", "right"].includes(f.feedSide))) &&
          (f.pending === undefined ||
            (f.special === "color" &&
              !f.ice &&
              Number.isInteger(f.pending) &&
              f.pending >= 1 &&
              f.pending <= 64))),
    )
  )
    return false;
  const pieces = game.board.filter(Boolean);
  // A settled board may have holes only where top-entering piece cannot reach.
  const reachable = reachableCells(game.board);
  if (game.board.some((piece, i) => !piece && reachable[i])) return false;
  if (
    new Set(pieces.map((f) => f.id)).size !== pieces.length ||
    (pendingColorClear(game.board) < 0 && findMatches(game.board).length) ||
    (!allowDeadBoard &&
      pendingColorClear(game.board) < 0 &&
      !findMove(game.board))
  )
    return false;
  if (
    !Number.isInteger(game.level) ||
    game.level < 1 ||
    game.level > 10000 ||
    !["moves", "score", "hints", "shuffles"].every(
      (key) => Number.isInteger(game[key]) && game[key] >= 0,
    ) ||
    game.moves > 40 ||
    !Number.isInteger(game.iceGoal ?? iceLayers(game.board)) ||
    (game.iceGoal ?? iceLayers(game.board)) < iceLayers(game.board) ||
    (game.iceGoal ?? 0) > 128 ||
    game.hints > 3 ||
    game.shuffles > 2 ||
    !Array.isArray(game.collected) ||
    game.collected.length !== TYPE_COUNT ||
    !game.collected.every((n) => Number.isInteger(n) && n >= 0) ||
    !["playing", "won", "lost"].includes(game.status) ||
    (pendingColorClear(game.board) >= 0 && game.status !== "playing")
  )
    return false;
  if (!validObjective(game)) return false;
  nextId = Math.max(nextId, ...pieces.map((f) => f.id));
  return true;
}

/** Preserve existing progress while upgrading the original five-match special. */
export function restoreGame(saved) {
  if (!saved || !Array.isArray(saved.board)) return null;
  const game = {
    ...saved,
    objective: saved.objective ?? { kind: "collect" },
    iceGoal: saved.iceGoal ?? iceLayers(saved.board),
    board: saved.board.map((piece) =>
      piece?.special === "burst"
        ? { ...piece, type: null, special: "color" }
        : piece,
    ),
  };
  if (!validGame(game, { allowDeadBoard: true })) return null;
  // Previously, a lone stripe falsely made an otherwise stuck save look playable.
  if (pendingColorClear(game.board) < 0 && !findMove(game.board)) {
    try {
      game.board = shuffleBoard(game.board);
    } catch {
      return null;
    }
  }
  return game;
}
