import test from "node:test";
import assert from "node:assert/strict";
import { createGame, findMatches, findMove, canSwap, gameStatus, levelConfig, refill, resolveWave, restoreGame, seededRandom, shuffleBoard, swap, validGame } from "../games/fuzzy-match-3/game.js";
import { GOAL_KINDS, advanceObjective, collectDeliveries, createObjective, goalKindForLevel, isDelivery, objectiveProgress } from "../games/fuzzy-match-3/objectives.js";
import { chooseMove, simulateTurn } from "../scripts/fuzzy-match-3-ai.mjs";
import { audit } from "../scripts/fuzzy-match-3-balance.mjs";

const patterned = () => Array.from({ length: 64 }, (_, index) => ({
  id: index + 100, type: (Math.floor(index / 8) * 2 + index % 8) % 6, special: null,
}));
const hit = (cleared, effectGroups = [cleared], creations = new Map()) => ({ cleared, effectGroups, creations });

test("four normal objectives rotate without challenge levels consuming a slot", () => {
  let normal = 0;
  for (let level = 1; level <= 1000; level++) {
    const config = levelConfig(level);
    if (level >= 10 && level % 5 === 0) {
      assert.equal(config.goalKind, "collect");
      assert.equal(config.count, 36);
    } else assert.equal(config.goalKind, GOAL_KINDS[normal++ % 4]);
    assert.equal(goalKindForLevel(level, true), "collect");
  }
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => goalKindForLevel(i + 1)),
    ["collect", "spread", "reveal", "deliver", "collect", "spread", "reveal", "deliver", "collect", "collect", "spread", "reveal"]);
  assert.equal(levelConfig(1, true).count, 15);
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

test("painting spreads only through affected connected effects, with retained rewards counting", () => {
  const game = { objective: { kind: "spread", cells: [0, 1, 2, 3, 4, 5, 6], painted: [0] } };
  const wave = hit([0, 1, 3, 4, 5], [[0, 1, 2], [3, 4, 5]], new Map([[2, "row"]]));
  assert.deepEqual(advanceObjective(game, wave).painted, [0, 1, 2]);
  assert.deepEqual(game.objective.painted, [0]);
  wave.effectGroups.push([2, 3, 4]);
  assert.deepEqual(advanceObjective(game, wave).painted, [0, 1, 2, 3, 4, 5]);
  // The ray touches 6, but its ice absorbed the wave, so it is not painted.
  wave.effectGroups.push([0, 6]);
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
  for (const level of [1, 2, 3, 4, 101, 102, 103]) {
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
