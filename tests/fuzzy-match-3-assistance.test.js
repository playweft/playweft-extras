import test from "node:test";
import assert from "node:assert/strict";
import { RETRY_PROBABILITIES, assistedType, helpForGoal, recordRetry, restoreRetries, retryKey, spentEnough } from "../games/fuzzy-match-3/assistance.js";
import { createGame, levelConfig, refill, restoreGame, seededRandom } from "../games/fuzzy-match-3/game.js";

const config = { goalKind: "collect", targetType: 2 };

test("effort counts spent moves, rounded up to sixty percent with an eight-move minimum", () => {
  for (const [initialMoves, required] of [[24, 15], [25, 15], [28, 17], [30, 18], [10, 8]]) {
    assert.equal(spentEnough({ initialMoves, moves: initialMoves - required + 1 }), false);
    assert.equal(spentEnough({ initialMoves, moves: initialMoves - required }), true);
  }
  assert.equal(spentEnough({ moves: 0 }), false);
});

test("qualifying retries keep one non-target type, count once per attempt, and cap at ten percent", () => {
  let retries = {};
  let selected;
  for (let i = 1; i <= 8; i++) {
    const attempt = { level: 1, initialMoves: 25, moves: 10, status: "playing", objective: { kind: "collect" } };
    const result = recordRetry(retries, "level:1", attempt, config, { restarting: true, random: () => .4 });
    const help = result.retries["level:1"];
    assert.equal(help.failures, Math.min(5, i));
    assert.notEqual(help.type, config.targetType);
    selected ??= help.type;
    assert.equal(help.type, selected);
    assert.equal(result.game.retryCounted, true);
    assert.equal(attempt.retryCounted, undefined, "the source game is not mutated");
    const duplicate = recordRetry(result.retries, "level:1", { ...result.game, moves: 0, status: "lost" }, config, { restarting: true });
    assert.strictEqual(duplicate.retries, result.retries);
    const quick = recordRetry(result.retries, "level:1", { ...attempt, moves: 25 }, config, { restarting: true });
    assert.strictEqual(quick.retries, result.retries);
    const interrupted = recordRetry(result.retries, "level:1", attempt, config);
    assert.strictEqual(interrupted.retries, result.retries);
    retries = result.retries;
  }
  assert.deepEqual(RETRY_PROBABILITIES, [1 / 6, .15, .135, .12, .11, .1]);
});

test("natural exhaustion counts once, wins clear only their own level, and daily records expire", () => {
  const game = { level: 5, moves: 0, initialMoves: 25, status: "lost" };
  const result = recordRetry({}, retryKey(game), game, config, { random: () => 0 });
  assert.equal(result.retries["level:5"].failures, 1);
  const registry = { ...result.retries, "level:7": { failures: 2, type: 3 } };
  const cleared = recordRetry(registry, "level:5", { ...game, status: "won" }, config);
  assert.deepEqual(cleared.retries, { "level:7": registry["level:7"] });
  assert.equal(retryKey(game, true, "2026-10-22"), "daily:2026-10-22");
  assert.deepEqual(restoreRetries({ ...registry,
    "daily:2026-10-21": { failures: 5, type: 1 },
    "daily:2026-10-22": { failures: 1, type: 1 },
    "level:10001": { failures: 1, type: 1 },
    "level:2": { failures: 6, type: 1 },
  }, "2026-10-22"), { ...registry, "daily:2026-10-22": { failures: 1, type: 1 } });
  assert.notEqual(helpForGoal({ failures: 2, type: 2 }, config, "collect", () => 0).type, 2);
  assert.equal(helpForGoal({ failures: 2, type: 2 }, config, "spread").type, 2);
});

test("weighted draws have the configured absolute probabilities for every reduced type", () => {
  for (let failures = 0; failures <= 5; failures++) for (let type = 0; type < 6; type++) {
    const random = seededRandom(291001), counts = Array(6).fill(0);
    const help = failures ? { failures, type } : undefined;
    const samples = 128000;
    for (let i = 0; i < samples; i++) counts[assistedType(random, help)]++;
    for (let other = 0; other < 6; other++) {
      const expected = other === type ? RETRY_PROBABILITIES[failures] : (1 - RETRY_PROBABILITIES[failures]) / 5;
      assert.ok(Math.abs(counts[other] / samples - expected) < .004);
    }
  }
  const a = seededRandom(42), b = seededRandom(42);
  for (let i = 0; i < 1000; i++) assert.equal(assistedType(a), Math.floor(b() * 6));
});

test("refill weights only ordinary pieces and keeps the delivery reserve separate", () => {
  const empty = Array(64).fill(null), assistance = { failures: 5, type: 2 };
  assert.ok(refill(empty, () => .48).every(piece => piece.type === 2));
  assert.ok(refill(empty, () => .48, undefined, undefined, assistance).every(piece => piece.type === 3));
  const result = refill(empty, () => .48, undefined, { kind: "deliver", total: 3, delivered: 0 }, assistance);
  assert.equal(result.filter(piece => piece.kind === "delivery").length, 2);
  assert.ok(result.filter(piece => !piece.kind).every(piece => piece.type === 3));
});

test("saved effort budgets and active assistance survive restore, and legacy budgets migrate", () => {
  const game = createGame(297, false, seededRandom(42));
  game.initialMoves = 30;
  game.moves = 12;
  game.assistance = { failures: 4, type: 3 };
  const restored = restoreGame(JSON.parse(JSON.stringify(game)));
  assert.deepEqual(restored, game);
  assert.equal(spentEnough(restored), true);
  delete game.initialMoves;
  assert.equal(restoreGame(game).initialMoves, levelConfig(297).moves);
});
