import test from "node:test";
import assert from "node:assert/strict";
import { createGame, findMatches, findMove, canSwap, gameStatus, levelConfig, refill, resolveWave, restoreGame, seededRandom, shuffleBoard, swap, validGame } from "../games/fuzzy-match-3/game.js";
import { advanceObjective, collectDeliveries, createObjective, goalKindForLevel, isChallengeLevel, isDelivery, objectiveProgress, validObjective } from "../games/fuzzy-match-3/objectives.js";
import { chooseMove, simulateTurn } from "../scripts/fuzzy-match-3-ai.mjs";
import { audit } from "../scripts/fuzzy-match-3-balance.mjs";

const patterned = () => Array.from({ length: 64 }, (_, index) => ({
  id: index + 100, type: (Math.floor(index / 8) * 2 + index % 8) % 6, special: null,
}));
const hit = (cleared, groups = [cleared], creations = new Map()) => ({
  cleared, creations,
  effectGroups: groups.map(indices => ({ sources: indices, indices })),
});

test("objectives repeat every twenty levels with rotating challenges and no adjacent repeats", () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => goalKindForLevel(i + 1)),
    ["collect", "spread", "reveal", "deliver", "collect"]);
  const blocks = [
    ["spread", "reveal", "deliver", "collect", "spread"],
    ["reveal", "deliver", "collect", "spread", "reveal"],
    ["deliver", "collect", "spread", "reveal", "deliver"],
    ["collect", "spread", "reveal", "deliver", "collect"],
  ];
  blocks.forEach((expected, block) => assert.deepEqual(
    Array.from({ length: 5 }, (_, offset) => goalKindForLevel(6 + block * 5 + offset)), expected));
  for (let level = 1; level <= 10000; level++) {
    const config = levelConfig(level);
    assert.equal(isChallengeLevel(level), level >= 10 && level % 5 === 0);
    assert.equal(isChallengeLevel(level, true), false);
    assert.equal(config.goalKind, goalKindForLevel(level + 20));
    if (level > 1) assert.notEqual(config.goalKind, goalKindForLevel(level - 1));
    if (level >= 10 && level % 5 === 0) {
      const normal = Array.from({ length: 4 }, (_, offset) => goalKindForLevel(level - 4 + offset));
      assert.equal(new Set(normal).size, 4);
      assert.deepEqual(Array.from({ length: 4 }, (_, offset) => goalKindForLevel(level + offset * 5)), normal);
      if (config.goalKind === "collect") assert.equal(config.count, 36);
    }
    assert.equal(goalKindForLevel(level, true), "collect");
  }
  assert.equal(levelConfig(1, true).count, 15);
});

test("reveal challenges use four pictures before level 100 and five later without changing normal goals", () => {
  for (const level of [15, 35, 55, 75, 95, 115, 135, 295, 315, 995]) {
    const count = level < 100 ? 4 : 5;
    const game = createGame(level, false, seededRandom(level));
    assert.equal(game.objective.kind, "reveal");
    assert.deepEqual(game.objective.groups.map(group => group.cells[0]), [9, 28, 49, 14, 54].slice(0, count));
    const cells = game.objective.groups.flatMap(group => group.cells);
    assert.equal(cells.length, count * 4);
    assert.equal(new Set(cells).size, count * 4);
    assert.equal(objectiveProgress(game, levelConfig(level)).total, count);
    assert.ok(validGame(game));
    assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
    assert.equal(createObjective("reveal", level, true).groups.length, level < 20 ? 2 : 3);
  }
  for (const level of [103, 111, 291, 299])
    assert.equal(createGame(level, false, seededRandom(level)).objective.groups.length, 3);
  for (const [level, groups] of [[3, 2], [7, 2], [11, 2], [19, 2], [23, 3], [99, 3]])
    assert.equal(createGame(level, false, seededRandom(level)).objective.groups.length, groups);
});

test("saved reveal challenges keep their original pictures and progress", () => {
  for (const level of [15, 35, 295]) {
    const game = createGame(level, false, seededRandom(42));
    game.objective = createObjective("reveal", level, true);
    game.objective.revealed = [...game.objective.groups[0].cells];
    assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
  }
});

test("all goal families create stable playable boards and survive JSON save/restore", () => {
  for (const level of [1, 2, 3, 4, 11, 12, 13, 22, 23, 24, 101, 102, 103, 999, 1000]) {
    for (let seed = 1; seed <= 20; seed++) {
      const game = createGame(level, false, seededRandom(seed));
      assert.ok(validGame(game), `level ${level}, seed ${seed}`);
      assert.equal(findMatches(game.board).length, 0);
      assert.ok(findMove(game.board));
      assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
    }
  }
});

test("normal spread goals extend each corner while intro and challenge layouts retain eight painted cells", () => {
  for (const level of [2, 10, 22, 30, 102, 110, 290, 298, 302, 1002]) {
    const config = levelConfig(level);
    assert.equal(config.goalKind, "spread");
    assert.deepEqual([config.iceCount, config.doubleIce, config.icePairs], [0, 0, 0]);
    assert.deepEqual(config.iceCells, []);
    const game = createGame(level, false, seededRandom(level));
    assert.equal(game.iceGoal, 0);
    assert.ok(game.board.every(piece => !piece.ice));
    const { cells, painted } = game.objective;
    const first = Math.min(...cells), last = Math.max(...cells);
    const topRight = first - first % 8 + last % 8;
    const bottomLeft = last - last % 8 + first % 8;
    const expected = [27, 28, 35, 36, first, topRight, bottomLeft, last];
    if (level >= 20 && !isChallengeLevel(level))
      expected.push(first + 1, first + 8, topRight - 1, topRight + 8,
        bottomLeft + 1, bottomLeft - 8, last - 1, last - 8);
    assert.deepEqual(painted, expected.sort((a, b) => a - b));
    assert.equal(objectiveProgress(game, config).current, expected.length);
    assert.ok(expected.length < cells.length, "the initial floor must still need painting");
    for (const transform of [
      (row, col) => row * 8 + 7 - col,
      (row, col) => (7 - row) * 8 + col,
      (row, col) => col * 8 + 7 - row,
    ])
      assert.deepEqual(painted.map(index => transform(Math.floor(index / 8), index % 8)).sort((a, b) => a - b),
        painted, "initial paint preserves both mirror axes and 90-degree rotation");
    assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
  }
  assert.deepEqual(createGame(298).objective.painted,
    [0, 1, 6, 7, 8, 15, 27, 28, 35, 36, 48, 55, 56, 57, 62, 63]);
  assert.deepEqual([291, 296, 301, 306].map(level => levelConfig(level).moves), [26, 25, 25, 24]);
});

test("existing spread saves retain their floor progress and frozen pieces", () => {
  const game = createGame(290, false, seededRandom(42));
  // This level used to be a spread goal; resuming it must retain that saved goal.
  game.level = 291;
  assert.equal(goalKindForLevel(game.level), "reveal");
  game.objective.painted = [27, 28, 35, 36, 44];
  game.board[18] = { ...game.board[18], ice: 1 };
  game.iceGoal = 1;
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
});

test("delivery targets spawn only in the first row and preserve every frozen cell", () => {
  for (let level = 1; level <= 1000; level++) {
    const config = levelConfig(level);
    const game = createGame(level, false, seededRandom(level), { goalKind: "deliver" });
    const positions = game.board.flatMap((piece, index) => isDelivery(piece) ? [index] : []);
    assert.equal(positions.length, Math.min(2, game.objective.total), `level ${level}`);
    assert.ok(positions.every(index => index < 8 && !config.iceCells.includes(index)), `level ${level}`);
    config.iceCells.forEach((index, order) => {
      assert.equal(game.board[index].ice, order < config.doubleIce ? 2 : 1);
    });
    assert.equal(findMatches(game.board).length, 0);
    assert.ok(findMove(game.board));
    assert.ok(validGame(game));
  }
});

test("normal delivery games start with two frozen stripes that survive thawing until triggered", () => {
  for (const level of [4, 16, 104, 296, 304, 1004]) {
    const config = levelConfig(level);
    const game = createGame(level, false, seededRandom(level));
    assert.equal(game.objective.kind, "deliver");
    const frozen = config.iceCells.map(index => game.board[index]);
    assert.deepEqual(frozen.map(piece => piece.special), ["row", "column"]);
    assert.ok(frozen.every(piece => piece.ice === 1));
    assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
    const index = config.iceCells[0];
    const thaw = resolveWave(game.board, { forced: [index] });
    assert.equal(thaw.board[index].ice, 0);
    assert.equal(thaw.board[index].special, "row");
    assert.ok(!thaw.cleared.includes(index));
    const blast = resolveWave(thaw.board, { forced: [index] });
    assert.ok(blast.cleared.includes(index));
  }
  for (const level of [20, 40, 100, 300, 1000]) {
    const game = createGame(level, false, seededRandom(level));
    assert.equal(game.objective.kind, "deliver");
    assert.ok(game.board.every(piece => !piece.special));
  }
});

test("existing normal delivery saves keep their frozen ordinary pieces", () => {
  const game = createGame(296, false, seededRandom(42));
  for (const index of levelConfig(296).iceCells) game.board[index].special = null;
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
});

test("restoring delivery progress preserves targets that have already fallen", () => {
  const game = createGame(4, false, seededRandom(42));
  const start = game.board.findIndex(isDelivery);
  game.board = swap(game.board, start, start + 16);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
});

test("delivery reserves and legacy boards with all targets survive save/restore", () => {
  const game = createGame(101, false, seededRandom(42), { goalKind: "deliver" });
  assert.equal(game.objective.total, 3);
  assert.equal(game.board.filter(isDelivery).length, 2);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
  const extra = game.board.findIndex(piece => !piece.ice && !isDelivery(piece));
  game.board[extra] = { ...game.board[extra], type: null, special: null, kind: "delivery" };
  assert.equal(game.board.filter(isDelivery).length, 3);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
});

for (const simultaneous of [false, true])
  test(`delivery arrival replenishes only the remaining reserve (${simultaneous ? "two arrivals" : "one arrival"})`, () => {
    const board = patterned();
    const positions = [56, simultaneous ? 57 : 7];
    for (const index of positions)
      board[index] = { ...board[index], type: null, kind: "delivery" };
    const objective = { kind: "deliver", total: 3, delivered: 0, exits: [0, 1] };
    const original = structuredClone(board);
    const arrival = collectDeliveries({ objective }, board);
    assert.equal(arrival.objective.delivered, simultaneous ? 2 : 1);
    const drops = [];
    const next = refill(arrival.board, seededRandom(8), (piece, from, to) => {
      if (isDelivery(piece)) drops.push({ id: piece.id, from, to });
    }, arrival.objective);
    const spawned = next.filter(piece => isDelivery(piece) && !positions.some(i => board[i].id === piece.id));
    assert.equal(spawned.length, 1);
    assert.equal(next.filter(isDelivery).length, simultaneous ? 1 : 2);
    assert.deepEqual(drops.filter(drop => drop.id === spawned[0].id)[0], {
      id: spawned[0].id, from: -8, to: 0,
    });
    assert.deepEqual(board, original);
    assert.ok(validObjective({ board: next, objective: arrival.objective }));
    const arrived = next.map(piece => isDelivery(piece) ? { ...piece, type: 0, kind: undefined } : piece);
    arrived[0] = null;
    const completed = { ...objective, delivered: 3 };
    assert.equal(refill(arrived, seededRandom(9), undefined, completed).filter(isDelivery).length, 0);
  });

test("delivery reserves wait for a free top entrance without overwriting ice", () => {
  const board = patterned();
  for (let col = 0; col < 8; col++) board[col].ice = 1;
  for (const index of [56, 57])
    board[index] = { ...board[index], type: null, kind: "delivery" };
  const objective = { kind: "deliver", total: 3, delivered: 0, exits: [0, 1] };
  const arrival = collectDeliveries({ objective }, board);
  const blocked = refill(arrival.board, seededRandom(8), undefined, arrival.objective);
  assert.equal(blocked.filter(isDelivery).length, 0);
  for (let col = 0; col < 8; col++) assert.equal(blocked[col], board[col]);
  assert.ok(validObjective({ board: blocked, objective: arrival.objective }));
  blocked[0] = null;
  const opened = refill(blocked, seededRandom(9), undefined, arrival.objective);
  assert.equal(opened.filter(isDelivery).length, 1);
  assert.ok(validObjective({ board: opened, objective: arrival.objective }));
});

test("painting spreads only through affected connected effects, with retained rewards counting", () => {
  const game = { objective: { kind: "spread", cells: [0, 1, 2, 3, 4, 5, 6], painted: [0] } };
  const wave = hit([0, 1, 3, 4, 5], [[0, 1, 2], [3, 4, 5]], new Map([[2, "row"]]));
  assert.deepEqual(advanceObjective(game, wave).painted, [0, 1, 2]);
  assert.deepEqual(game.objective.painted, [0]);
  wave.effectGroups.push({ sources: [2], indices: [2, 3, 4] });
  assert.deepEqual(advanceObjective(game, wave).painted, [0, 1, 2, 3, 4, 5]);
  // The ray touches 6, but its ice absorbed the wave, so it is not painted.
  wave.effectGroups.push({ sources: [0], indices: [0, 6] });
  assert.ok(!advanceObjective(game, wave).painted.includes(6));
});

test("real matches and triggered rays carry paint while independent matches do not", () => {
  const board = patterned();
  for (const i of [24, 25, 26]) board[i].type = 5;
  for (const i of [51, 52, 53]) board[i].type = 4;
  board[25].special = "column";
  const game = { board, objective: { kind: "spread", cells: Array.from({ length: 64 }, (_, i) => i), painted: [24] } };
  const wave = resolveWave(board);
  assert.ok(wave);
  const objective = advanceObjective(game, wave);
  assert.ok(objective.painted.includes(57));
  assert.ok(!objective.painted.includes(51));
  assert.ok(!objective.painted.includes(53));
});

test("a legal stripe exchange off painted floor does not pick paint up along its ray", () => {
  for (const [from, to, direction, partners] of [
    [24, 25, "row", [17, 33]],
    [18, 26, "column", [25, 27]],
  ]) {
    const board = patterned();
    board[from].special = direction;
    for (const index of partners) board[index].type = board[from].type;
    assert.equal(findMatches(board).length, 0);
    assert.ok(canSwap(board, from, to));
    const exchanged = swap(board, from, to);
    const wave = resolveWave(exchanged, { exchange: [from, to] });
    assert.ok(wave.cleared.includes(from)); // The ray crosses the old painted position.
    assert.ok(wave.cleared.includes(to));
    const objective = { kind: "spread", cells: Array.from({ length: 64 }, (_, i) => i), painted: [from] };
    assert.deepEqual(advanceObjective({ board: exchanged, objective }, wave).painted, [from]);
    assert.deepEqual(objective.painted, [from]); // Floor never follows the moved piece.

    const result = advanceObjective({ board: exchanged, objective: { ...objective, painted: [to] } }, wave);
    const line = Array.from({ length: 8 }, (_, i) => direction === "row"
      ? Math.floor(to / 8) * 8 + i : i * 8 + to % 8);
    assert.ok(line.every(index => result.painted.includes(index)));
  }
});

test("chained stripes carry paint forwards from their origin without backflow from crossed cells", () => {
  const board = patterned();
  board[25].special = "row";
  board[27].special = "column";
  const wave = resolveWave(board, { forced: [25] });
  const objective = { kind: "spread", cells: Array.from({ length: 64 }, (_, i) => i), painted: [24, 35] };
  assert.deepEqual(advanceObjective({ board, objective }, wave).painted, [24, 35]);
  const result = advanceObjective({ board, objective: { ...objective, painted: [25] } }, wave);
  assert.ok([24, 27, 31, 3, 59].every(index => result.painted.includes(index)));
});

test("double-stripe crosses also require paint at their activation positions", () => {
  const board = patterned();
  board[24].special = board[25].special = "row";
  const exchanged = swap(board, 24, 25);
  const wave = resolveWave(exchanged, { exchange: [24, 25] });
  const objective = { kind: "spread", cells: Array.from({ length: 64 }, (_, i) => i), painted: [8] };
  assert.ok(wave.cleared.includes(8));
  assert.deepEqual(advanceObjective({ board: exchanged, objective }, wave).painted, [8]);
  const result = advanceObjective({ board: exchanged, objective: { ...objective, painted: [24] } }, wave);
  assert.ok([0, 1, 25, 31, 56, 57].every(index => result.painted.includes(index)));
});

test("color/stripe batches take paint only from the two exchange positions before exploding", () => {
  for (const pair of [[0, 1], [1, 0]]) {
    for (const seed of [1, 7, 42]) {
      const board = patterned();
      board[0] = { ...board[0], type: null, special: "color" };
      board[1].special = "row";
      board[13].ice = 1;
      assert.equal(findMatches(board).length, 0);
      const exchanged = swap(board, ...pair);
      const wave = resolveWave(exchanged, { exchange: pair, random: seededRandom(seed) });
      assert.ok(wave.transformed.has(7));
      assert.ok(!wave.transformed.has(13));
      const objective = { kind: "spread", cells: Array.from({ length: 64 }, (_, i) => i), painted: [7] };
      // A converted stripe already on painted floor must not color its own ray,
      // nor allow the batch to pick that color up through its matching targets.
      assert.deepEqual(advanceObjective({ board: exchanged, objective }, wave).painted, [7]);
      for (const painted of [[0], [1], [0, 1]]) {
        const result = advanceObjective({ board: exchanged, objective: { ...objective, painted } }, wave);
        const expected = [...new Set([...painted, ...wave.cleared, ...wave.creations.keys()])].sort((a, b) => a - b);
        assert.deepEqual(result.painted, expected);
        assert.ok(!result.painted.includes(13)); // Ice absorbs the entire wave.
      }
    }
  }
});

test("paint reaching an exchanged position during the wave does not retroactively color its converted batch", () => {
  const board = patterned();
  board[0] = { ...board[0], type: null, special: "color" };
  board[1].special = "row";
  board[8].type = board[16].type = board[1].type;
  assert.equal(findMatches(board).length, 0);
  const exchanged = swap(board, 0, 1);
  const wave = resolveWave(exchanged, { exchange: [0, 1], random: seededRandom(42) });
  const objective = { kind: "spread", cells: Array.from({ length: 64 }, (_, i) => i), painted: [16] };
  // The ordinary three-match still spreads paint to 0, independently of the combo.
  assert.deepEqual(advanceObjective({ board: exchanged, objective }, wave).painted, [0, 8, 16]);
});

test("uncovering counts complete pictures, deduplicates hits and includes conversion cells", () => {
  const objective = createObjective("reveal", 3);
  const game = { objective, collected: Array(6).fill(0) };
  const cells = objective.groups[0].cells;
  game.objective = advanceObjective(game, hit(cells.slice(0, 3)));
  assert.equal(objectiveProgress(game, levelConfig(3)).current, 0);
  game.objective = advanceObjective(game, hit(cells.slice(0, 3), [], new Map([[cells[3], "color"]])));
  assert.equal(game.objective.revealed.length, 4);
  assert.equal(objectiveProgress(game, levelConfig(3)).current, 1);
  game.objective = advanceObjective(game, hit(objective.groups[1].cells));
  assert.ok(objectiveProgress(game, levelConfig(3)).complete);
});

test("cargo never matches or explodes, and color/cargo exchange is illegal", () => {
  const board = patterned();
  for (const i of [24, 25, 26]) board[i] = { ...board[i], kind: "delivery", type: null };
  assert.equal(findMatches(board).length, 0);
  board[0] = { ...board[0], type: null, special: "color" };
  board[1] = { ...board[1], type: null, special: "color" };
  board[16].special = "column";
  const wave = resolveWave(board, { exchange: [0, 1] });
  for (const i of [24, 25, 26]) {
    assert.equal(wave.board[i], board[i]);
    assert.ok(!wave.cleared.includes(i));
  }
  board[23] = { ...board[23], type: null, special: "color" };
  assert.equal(canSwap(board, 23, 24), false); // row edge
  board[17] = { ...board[17], type: null, special: "color" };
  assert.equal(canSwap(board, 17, 25), false);
  const shuffled = shuffleBoard(board, seededRandom(5));
  for (const i of [24, 25, 26]) assert.equal(shuffled[i], board[i]);
});

function arrivingGame() {
  const game = createGame(4, false, seededRandom(1));
  game.board = patterned();
  game.iceGoal = 0;
  game.objective = { kind: "deliver", total: 1, delivered: 0, exits: [2] };
  for (const i of [48, 49, 58]) game.board[i].type = 5;
  game.board[50] = { ...game.board[50], kind: "delivery", type: null };
  return game;
}

test("a legal cargo exchange delivers only at a matching bottom exit and continues refill", () => {
  const game = arrivingGame();
  assert.ok(validGame(game));
  assert.ok(canSwap(game.board, 50, 58));
  assert.equal(collectDeliveries(game, game.board), null);
  const atBottom = swap(game.board, 50, 58);
  assert.equal(collectDeliveries({ ...game, objective: { ...game.objective, exits: [1] } }, atBottom), null);
  assert.equal(collectDeliveries(game, atBottom).objective.delivered, 1);
  game.score = levelConfig(4).target;
  const next = simulateTurn(game, [50, 58], { random: seededRandom(4) });
  assert.equal(next.objective.delivered, 1);
  assert.equal(next.board.filter(isDelivery).length, 0);
  assert.equal(next.status, "won");
  assert.ok(validGame(next));
  assert.equal(game.objective.delivered, 0);
});

test("AI turns replenish a delivery reserve and the resulting progress resumes unchanged", () => {
  const game = arrivingGame();
  game.objective.total = 3;
  game.board[7] = { ...game.board[7], type: null, kind: "delivery" };
  const snapshot = structuredClone(game);
  const next = simulateTurn(game, [50, 58], { random: seededRandom(4) });
  assert.equal(next.objective.delivered, 1);
  assert.equal(next.board.filter(isDelivery).length, 2);
  assert.equal(next.board[7].id, game.board[7].id);
  assert.ok(next.board.some(piece => isDelivery(piece) && !game.board.some(old => old.id === piece.id)));
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(next))), next);
  assert.deepEqual(game, snapshot);
});

test("cargo falls with ordinary gravity and is not consumed by a stripe", () => {
  const board = patterned();
  board[11] = { ...board[11], kind: "delivery", type: null };
  board[3].special = "column";
  const wave = resolveWave(board, { forced: [3] });
  assert.equal(wave.board[11], board[11]);
  const filled = refill(wave.board, seededRandom(8));
  assert.equal(filled[59].id, board[11].id);
});

test("goal, score and ice all gate completion, independently of animal counts", () => {
  for (const kind of ["spread", "reveal", "deliver"]) {
    const game = createGame(1, false, seededRandom(1), { goalKind: kind });
    game.score = levelConfig(1).target;
    game.collected.fill(1000);
    assert.equal(gameStatus(game), "playing");
    if (kind === "spread") game.objective.painted = [...game.objective.cells];
    if (kind === "reveal") game.objective.revealed = game.objective.groups.flatMap(group => group.cells);
    if (kind === "deliver") {
      game.objective.delivered = game.objective.total;
      game.board = game.board.map(piece => isDelivery(piece) ? { ...piece, type: 0, kind: undefined } : piece);
    }
    assert.equal(gameStatus(game), "won");
    game.score = 0;
    assert.equal(gameStatus(game), "playing");
    game.moves = 0;
    assert.equal(gameStatus(game), "lost");
  }
});

test("legacy games remain collection games and malformed new goal data is rejected", () => {
  const old = createGame(2, false, seededRandom(8), { goalKind: "collect" });
  delete old.objective;
  old.collected[1] = 7;
  const restored = restoreGame(old);
  assert.deepEqual(restored.objective, { kind: "collect" });
  assert.deepEqual(restored.board, old.board);
  assert.equal(restored.collected[1], 7);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(restored))), restored);
  for (const objective of [
    { kind: "unknown" },
    { kind: "spread", cells: [0, 1], painted: [2] },
    { kind: "spread", cells: [0, 0], painted: [0] },
    { kind: "reveal", groups: [{ cells: [0, 1], type: 99 }], revealed: [] },
    { kind: "deliver", total: 2, delivered: 2, exits: [0, 0] },
    { kind: "deliver", total: 2, delivered: 0, exits: [0] },
  ]) assert.equal(restoreGame({ ...old, objective }), null);
});

test("AI ranks and advances all four real goal families without mutating its input", () => {
  for (const level of [1, 2, 3, 4, 101, 102, 103, 104]) {
    const game = createGame(level, false, seededRandom(42));
    const snapshot = structuredClone(game);
    const pair = chooseMove(game, { random: seededRandom(123) });
    assert.ok(canSwap(game.board, ...pair));
    const next = simulateTurn(game, pair, { random: seededRandom(55) });
    assert.ok(validGame(next), `level ${level}`);
    assert.equal(next.moves, game.moves - 1);
    assert.equal(next.objective.kind, game.objective.kind);
    assert.deepEqual(game, snapshot);
  }
});

test("audits diagnose the actual primary goal instead of obsolete collection counts", () => {
  for (const [level, kind] of [[2, "spread"], [3, "reveal"], [4, "deliver"]]) {
    const result = audit({ level, games: 2, seed: 42, strategy: "simple", overrides: { moves: 1, target: 1000000 } });
    assert.equal(result.failureReasons.losses, 2);
    assert.equal(result.failureReasons.unmet.collection, 0);
    assert.equal(result.failureReasons.unmet[kind], 2);
    assert.equal(Object.values(result.failureReasons.combinations).reduce((a, b) => a + b), 2);
  }
});
