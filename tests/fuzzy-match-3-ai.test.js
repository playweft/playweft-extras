import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  canSwap,
  findMove,
  findMatches,
  iceLayers,
  levelConfig,
  seededRandom,
  validGame,
  swap,
  resolveWave,
  refill,
} from "../games/fuzzy-match-3/game.js";
import { chooseMove, simulateTurn } from "../scripts/fuzzy-match-3-ai.mjs";
import { audit } from "../scripts/fuzzy-match-3-balance.mjs";

test("balance audits separate every failed-goal combination and successful games", () => {
  for (const [level, target, count, expected] of [
    [1, 1000000, 0, "score"],
    [1, 0, 1000, "collection"],
    [1, 1000000, 1000, "score+collection"],
    [4, 0, 0, "ice"],
    [4, 1000000, 0, "score+ice"],
    [4, 0, 1000, "collection+ice"],
    [4, 1000000, 1000, "score+collection+ice"],
    [1, 0, 0, null],
  ]) {
    const result = audit({
      level, games: 2, seed: 42, strategy: "simple",
      overrides: { moves: 1, target, count, goalKind: "collect" },
    });
    const reasons = result.failureReasons;
    assert.equal(reasons.losses, expected ? 2 : 0);
    assert.equal(reasons.unmet.score, expected?.includes("score") ? 2 : 0);
    assert.equal(reasons.unmet.collection, expected?.includes("collection") ? 2 : 0);
    assert.equal(reasons.unmet.ice, expected?.includes("ice") ? 2 : 0);
    assert.equal(Object.values(reasons.combinations).reduce((sum, n) => sum + n, 0), reasons.losses);
    if (expected) assert.equal(reasons.combinations[expected], 2);
  }
});

test("strong search chooses legal moves reproducibly without mutating the actual game", () => {
  for (const level of [1, 4, 30, 1000]) {
    const game = createGame(level, false, seededRandom(42));
    const snapshot = structuredClone(game);
    const first = chooseMove(game, { random: seededRandom(123) });
    const second = chooseMove(game, { random: seededRandom(123) });
    assert.deepEqual(first, second);
    assert.ok(canSwap(game.board, ...first));
    assert.deepEqual(game, snapshot);
    const result = simulateTurn(game, first, { random: seededRandom(300) });
    assert.equal(result.moves, game.moves - 1);
    assert.equal(findMatches(result.board).length, 0);
    assert.ok(result.board.every(Boolean));
    assert.ok(iceLayers(result.board) <= iceLayers(game.board));
    assert.deepEqual(game, snapshot);
  }
});

test("strong AI can choose to finish the ice goal instead of an unrelated high-scoring clear", () => {
  const game = createGame(1000, false, seededRandom(9));
  game.board = game.board.map((piece, i) => ({
    ...piece,
    ice: 0,
    type: (Math.floor(i / 8) * 2 + (i % 8)) % 6,
  }));
  [0, 1, 10].forEach((i) => {
    game.board[i].type = 5;
  });
  game.board[8].ice = 1;
  game.iceGoal = 1;
  game.score = levelConfig(1000).target;
  game.collected = Array(6).fill(100);
  game.moves = 1;
  const pair = chooseMove(game, { random: seededRandom(10) });
  const next = simulateTurn(game, pair, { random: seededRandom(1) });
  assert.equal(next.status, "won");
  assert.equal(iceLayers(next.board), 0);
});

test("AI drains already triggered specials on the last move before deciding the outcome", () => {
  const game = createGame(1000, false, seededRandom(2));
  game.moves = 1;
  game.board = game.board.map((piece, i) => ({
    ...piece,
    ice: 0,
    type: (Math.floor(i / 8) * 2 + (i % 8)) % 6,
  }));
  game.iceGoal = 0;
  game.board[16].special = "row";
  game.board[17].special = "column";
  for (const i of [18, 22])
    game.board[i] = { ...game.board[i], type: null, special: "color" };
  const ids = [game.board[18].id, game.board[22].id];
  const snapshot = structuredClone(game);
  const next = simulateTurn(game, [16, 17], { random: seededRandom(13) });
  assert.equal(next.moves, 0);
  assert.notEqual(next.status, "playing");
  assert.ok(next.board.every((piece) => !piece.pending));
  assert.ok(ids.every((id) => !next.board.some((piece) => piece.id === id)));
  assert.equal(findMatches(next.board).length, 0);
  assert.ok(next.score > 20 * 60);
  assert.deepEqual(game, snapshot);
});

test("strong AI handles blocked empty cells and refills them once the surrounding ice thaws", () => {
  const game = createGame(4, false, seededRandom(42), { goalKind: "collect" });
  game.board = game.board.map((piece, i) => ({
    ...piece,
    ice: [18, 19, 20].includes(i) ? 1 : 0,
    type: (Math.floor(i / 8) * 2 + i % 8) % 6,
  }));
  game.board[27] = null;
  game.iceGoal = 3;
  for (const i of [0, 1])
    game.board[i] = { ...game.board[i], type: null, special: "color" };
  const snapshot = structuredClone(game);
  const pair = chooseMove(game, { random: seededRandom(10) });
  assert.ok(canSwap(game.board, ...pair));
  assert.ok(!pair.includes(27));
  const next = simulateTurn(game, [0, 1], { random: seededRandom(50) });
  assert.equal(iceLayers(next.board), 0);
  assert.ok(next.board.every(Boolean));
  assert.ok(validGame(next));
  assert.deepEqual(game, snapshot);
});

test("AI successful last moves drain all specials including newly generated ones, without spending extra moves", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = createGame(1, false, seededRandom(42));
    game.moves = 1;
    game.score = levelConfig(1).target - 180;
    game.collected = Array(6).fill(100);
    for (const index of [20, 21]) game.board[index].special = "row";
    game.board[50] = { ...game.board[50], type: null, special: "color" };
    const snapshot = structuredClone(game);
    const next = simulateTurn(game, findMove(game.board), { random: seededRandom(seed) });
    assert.equal(next.moves, 0);
    assert.equal(next.status, "won");
    assert.ok(next.board.every((tile) => !tile?.special), `seed ${seed} leaves no specials`);
    assert.ok(validGame(next));
    assert.deepEqual(game, snapshot);
  }
});

test("AI does not start a finale on a failed last move, even when remaining specials could rescue it", () => {
  const game = createGame(1, false, seededRandom(42));
  game.board = game.board.map((tile, i) => ({ ...tile, type: (Math.floor(i / 8) * 2 + i % 8) % 6 }));
  for (const index of [0, 1, 10]) game.board[index].type = 5;
  game.board[48].special = "row";
  game.board[63] = { ...game.board[63], type: null, special: "color" };
  game.moves = 1;
  game.score = levelConfig(1).target;
  game.collected[0] = levelConfig(1).count - 1;
  const first = resolveWave(swap(game.board, 10, 2), { exchange: [10, 2] });
  assert.equal(first.collected[0], 0);
  const failed = simulateTurn(game, [10, 2], { random: seededRandom(8) });
  assert.equal(failed.status, "lost");
  assert.equal(failed.moves, 0);
  assert.equal(failed.collected[0], game.collected[0]);
  assert.equal(failed.score, game.score + first.score);
  for (const index of [48, 63]) {
    const original = game.board[index];
    assert.deepEqual(failed.board.find(tile => tile?.id === original.id), original);
  }
  const config = { ...levelConfig(1), count: 1000 };
  const lost = simulateTurn(game, [10, 2], { config, random: seededRandom(8) });
  assert.equal(lost.status, "lost");
  assert.ok(lost.board.some((tile) => tile?.special));
});

test("AI settles both exchanged rainbows across refills on a failed last move without starting a finale", () => {
  for (const pair of [[0, 1], [1, 0]]) {
    const game = createGame(1, false, seededRandom(42));
    game.board = game.board.map((piece, i) => ({ ...piece, type: (Math.floor(i / 8) * 2 + i % 8) % 6 }));
    for (const i of pair) game.board[i] = { ...game.board[i], type: null, special: "color" };
    game.moves = 1;
    const config = { ...levelConfig(1), target: 1000000, count: 1000000 };
    const random = seededRandom(33);
    const first = resolveWave(swap(game.board, ...pair), { exchange: pair });
    const nextScreen = refill(first.board, random);
    const second = resolveWave(nextScreen, { chain: 2 });
    assert.equal(nextScreen[second.triggeredColorClear].id, game.board[pair[1]].id);
    const before = structuredClone(game);
    const next = simulateTurn(game, pair, { random: seededRandom(33), config });
    assert.equal(next.status, "lost");
    assert.equal(next.moves, 0);
    assert.ok(next.score >= first.score + second.score);
    assert.ok(game.board.slice(0, 2).every(piece => !next.board.some(tile => tile?.id === piece.id)));
    assert.ok(!next.board.some(piece => piece?.pending));
    assert.ok(validGame(next));
    assert.deepEqual(game, before);
  }
});
