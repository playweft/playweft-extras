import test from "node:test";
import assert from "node:assert/strict";
import {
  adjacent,
  canSwap,
  createBoard,
  createGame as createRotatingGame,
  findMatches,
  findMove,
  gameStatus,
  iceLayers,
  levelConfig,
  MOVE_BONUS,
  moveBonus,
  pendingColorClear,
  totalScore,
  refill,
  restoreGame,
  resolveWave,
  seededRandom,
  shuffleBoard,
  swap,
  validGame,
} from "../games/fuzzy-match-3/game.js";
// These established rule/collection fixtures retain their original objective.
const createGame = (level = 1, daily = false, random = Math.random) =>
  createRotatingGame(level, daily, random, { goalKind: "collect" });

const boardFrom = (rows) =>
  rows.flat().map((type, id) => ({ id: id + 100, type, special: null }));
const patterned = () =>
  boardFrom(
    Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => (row * 2 + col) % 6),
    ),
  );

// Expected unrounded area contribution, rounded only after the cascade factor.
const clearPoints = (count, chain = 1) =>
  Math.round(count * 6 * (1 + Math.sqrt(Math.max(0, count - 3) / 61)) * Math.min(chain, 5)) * 10;

test("fresh boards are full, stable, and playable across 300 seeds", () => {
  for (let seed = 0; seed < 300; seed++) {
    const board = createBoard(seededRandom(seed));
    assert.equal(board.length, 64);
    assert.equal(new Set(board.map((f) => f.id)).size, 64);
    assert.equal(findMatches(board).length, 0);
    const [a, b] = findMove(board);
    assert.ok(adjacent(a, b));
    assert.ok(findMatches(swap(board, a, b)).length);
  }
});

test("daily seeds reproduce piece types without reusing tile ids", () => {
  const a = createBoard(seededRandom(20261018));
  const b = createBoard(seededRandom(20261018));
  assert.deepEqual(
    a.map((f) => f.type),
    b.map((f) => f.type),
  );
  assert.notEqual(a[0].id, b[0].id);
});

test("adjacency never wraps rows or crosses board boundaries", () => {
  assert.equal(adjacent(7, 8), false);
  assert.equal(adjacent(0, -1), false);
  assert.equal(adjacent(63, 64), false);
  assert.equal(adjacent(0, 8), true);
  assert.equal(adjacent(6, 7), true);
  assert.equal(adjacent(0, 9), false);
});

test("horizontal and vertical runs are found, with no diagonals or row wrap", () => {
  const board = patterned();
  [0, 1, 2].forEach((i) => {
    board[i].type = 5;
  });
  [16, 24, 32].forEach((i) => {
    board[i].type = 4;
  });
  const lines = findMatches(board);
  assert.ok(
    lines.some((l) => l.direction === "row" && l.indices.join() === "0,1,2"),
  );
  assert.ok(
    lines.some(
      (l) =>
        l.direction === "column" &&
        l.indices.includes(16) &&
        l.indices.includes(32),
    ),
  );
  assert.equal(findMatches(patterned()).length, 0);
});

test("three in a row clears, scores, and counts only removed piece", () => {
  const board = patterned();
  [0, 1, 2].forEach((i) => {
    board[i].type = 5;
  });
  const wave = resolveWave(board, { chain: 2 });
  assert.deepEqual(wave.cleared, [0, 1, 2]);
  assert.equal(wave.score, 360);
  assert.equal(wave.collected[5], 3);
  assert.equal(wave.board[0], null);
  assert.equal(resolveWave(patterned()), null);
});

test("four or longer matches collect every matched piece and preserve a special at the swapped destination", () => {
  for (const count of [4, 5, 6, 8]) {
    const board = patterned();
    for (let i = 0; i < count; i++) board[i].type = 5;
    board[count].type = 0;
    const wave = resolveWave(board, { preferred: [2] });
    assert.equal(wave.board[2].special, count === 4 ? "column" : "color");
    assert.equal(wave.cleared.length, count - 1);
    assert.equal(wave.collected[5], count);
    assert.equal(wave.score, clearPoints(count) + (count === 4 ? 80 : 200));
  }
  const board = patterned();
  [0, 8, 16, 24].forEach((i) => {
    board[i].type = 5;
  });
  assert.equal(
    resolveWave(board, { preferred: [8] }).board[8].special,
    "row",
  );
});

test("same-direction stripe hits turn perpendicular while perpendicular hits keep their direction", () => {
  for (const [root, direction, target, stored, expected] of [
    [16, "row", 20, "row", "column"],
    [4, "column", 28, "column", "row"],
    [16, "row", 20, "column", "column"],
    [4, "column", 28, "row", "row"],
  ]) {
    const board = patterned();
    board[root].special = direction;
    board[target].special = stored;
    const wave = resolveWave(board, { forced: [root] });
    const cells = new Set(
      Array.from({ length: 64 }, (_, i) => i).filter(
        (i) =>
          (direction === "row"
            ? Math.floor(i / 8) === Math.floor(root / 8)
            : i % 8 === root % 8) ||
          (expected === "row"
            ? Math.floor(i / 8) === Math.floor(target / 8)
            : i % 8 === target % 8),
      ),
    );
    assert.equal(wave.stripeDirections.get(root), direction);
    assert.equal(wave.stripeDirections.get(target), expected);
    assert.deepEqual(new Set(wave.cleared), cells);
    assert.equal(cells.size, 15);
    assert.equal(wave.score, 1300);
    assert.equal(
      board[target].special,
      stored,
      "the source board stays unchanged",
    );
  }
});

test("stripe cycles use the actual incoming direction and fire each piece once", () => {
  const board = patterned();
  for (const [i, direction] of [
    [16, "row"],
    [20, "row"],
    [44, "column"],
    [40, "row"],
  ])
    board[i].special = direction;
  const wave = resolveWave(board, { forced: [16] });
  assert.deepEqual([...wave.stripeDirections], [
    [16, "row"],
    [20, "column"],
    [44, "row"],
    [40, "column"],
  ]);
  assert.deepEqual(
    new Set(wave.cleared),
    new Set(
      Array.from({ length: 64 }, (_, i) => i).filter(
        (i) => [2, 5].includes(Math.floor(i / 8)) || [0, 4].includes(i % 8),
      ),
    ),
  );
  assert.equal(wave.cleared.length, 28);
  assert.equal(wave.score, 2760);
});

test("stripe chains arm hit rainbows and defer their color choice until after refill", () => {
  const board = patterned();
  board[16].special = "row";
  board[20].special = "column";
  board[44] = { ...board[44], type: null, special: "color" };
  const wave = resolveWave(board, { forced: [16] });
  assert.ok(
    Array.from({ length: 8 }, (_, i) => 16 + i).every((i) =>
      wave.cleared.includes(i),
    ),
  );
  assert.ok(
    Array.from({ length: 8 }, (_, i) => i * 8 + 4)
      .filter((i) => i !== 44)
      .every((i) => wave.cleared.includes(i)),
  );
  assert.equal(wave.armed.get(44), 1);
  assert.equal(wave.board[44].id, board[44].id);
  assert.equal(wave.cleared.includes(44), false);
  assert.equal(new Set(wave.cleared).size, wave.cleared.length);
  assert.equal(
    wave.collected.reduce((a, b) => a + b),
    wave.cleared.length,
  );
  assert.equal(
    resolveWave(board, { forced: [16], chain: 20 }).score,
    5980,
  );
  const filled = refill(wave.board, seededRandom(51));
  const counts = Array(6).fill(0);
  for (const piece of filled)
    if (piece.special !== "color") counts[piece.type]++;
  const target = counts.indexOf(Math.max(...counts));
  const queued = resolveWave(filled, { chain: 2 });
  assert.equal(queued.colorClearTarget, target);
  assert.equal(queued.triggeredColorClear, pendingColorClear(filled));
  assert.equal(queued.creations.size, 0);
  assert.equal(queued.cleared.length, counts[target] + 1);
});

test("gravity preserves survivor order and creates fresh ids above them", () => {
  const board = patterned();
  const top = board[0],
    bottom = board[56];
  board[8] = null;
  board[32] = null;
  const next = refill(board, seededRandom(4));
  assert.equal(next[56], bottom);
  assert.equal(next[16], top);
  assert.equal(next.filter(Boolean).length, 64);
  assert.equal(new Set(next.map((f) => f.id)).size, 64);
});

test("shuffle preserves piece inventory and restores a stable playable board", () => {
  const board = createBoard(seededRandom(7));
  board[0] = { ...board[0], type: null, special: "color" };
  const next = shuffleBoard(board, seededRandom(123));
  assert.deepEqual(
    next.map((f) => f.id).sort((a, b) => a - b),
    board.map((f) => f.id).sort((a, b) => a - b),
  );
  assert.equal(findMatches(next).length, 0);
  assert.ok(findMove(next));
});

test("win requires score and piece, with the final move still eligible for a win", () => {
  const game = createGame();
  const config = levelConfig(1);
  game.score = config.target;
  assert.equal(gameStatus(game), "playing");
  game.moves = 0;
  assert.equal(gameStatus(game), "lost");
  game.collected[config.targetType] = config.count;
  assert.equal(gameStatus(game), "won");
  assert.notDeepEqual(levelConfig(1), levelConfig(5));
});

test("saved data rejects incomplete, duplicated, matching and invalid boards; restored ids stay unique", () => {
  const game = createGame();
  assert.ok(validGame(game));
  assert.equal(validGame(null), false);
  assert.equal(validGame({ ...game, moves: -1 }), false);
  assert.equal(validGame({ ...game, collected: [0] }), false);
  assert.equal(
    validGame({ ...game, board: game.board.map(() => game.board[0]) }),
    false,
  );
  const restored = structuredClone(game);
  restored.board.forEach((f, i) => {
    f.id = 100000 + i;
  });
  assert.ok(validGame(restored));
  const next = refill(restored.board.map((f, i) => (i < 8 ? null : f)));
  assert.equal(new Set(next.map((f) => f.id)).size, 64);
  assert.ok(next.slice(0, 8).every((f) => f.id > 100063));
});

test("100 seeded complete games settle cascades without holes or dead ends", () => {
  for (let seed = 0; seed < 100; seed++) {
    const random = seededRandom(seed),
      game = createGame(1, false, random);
    let board = game.board;
    for (let move = 0; move < 28; move++) {
      const [a, b] = findMove(board);
      board = swap(board, a, b);
      let wave,
        chain = 1;
      do {
        wave = resolveWave(board, {
          preferred: chain === 1 ? [b, a] : [],
          exchange: chain === 1 ? [a, b] : [],
          chain,
          random,
        });
        if (wave) board = refill(wave.board, random);
        assert.ok(chain++ < 60, "cascade must terminate");
      } while (wave);
      if (!findMove(board)) board = shuffleBoard(board, random);
      assert.equal(board.filter(Boolean).length, 64);
      assert.equal(findMatches(board).length, 0);
      assert.ok(findMove(board));
    }
  }
});

test("L, T and cross matches generate exactly one neutral rainbow in every orientation", () => {
  const shapes = [
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [2, 1],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 1],
    ],
  ];
  for (const shape of shapes)
    for (let rotation = 0; rotation < 4; rotation++) {
      let cells = shape;
      for (let r = 0; r < rotation; r++)
        cells = cells.map(([row, col]) => [col, 2 - row]);
      const board = patterned();
      // Isolate the shape so background piece cannot extend one of its arms.
      for (let row = 1; row <= 5; row++)
        for (let col = 1; col <= 5; col++)
          if (board[row * 8 + col].type === 5) board[row * 8 + col].type = 0;
      const indices = cells.map(([row, col]) => (row + 2) * 8 + col + 2);
      indices.forEach((i) => {
        board[i].type = 5;
      });
      const wave = resolveWave(board, { preferred: [indices[0]] });
      assert.equal(wave.creations.size, 1);
      const [[position, special]] = wave.creations;
      assert.equal(special, "color");
      assert.ok(indices.includes(position));
      assert.equal(position, indices[0]);
      assert.equal(wave.board[position].type, null);
      assert.equal(wave.board[position].special, "color");
      assert.ok(!wave.cleared.includes(position));
      assert.equal(wave.collected[5], 5);
      assert.equal(wave.patternBonus, 200);
      assert.equal(wave.score, 550);
    }
});

test("crossing four and five runs prefer one rainbow; separate four-runs stay separate stripes", () => {
  const board = patterned();
  [16, 17, 18, 19, 20, 4, 12, 28, 36].forEach((i) => {
    board[i].type = 5;
  });
  board[21].type = 0;
  const wave = resolveWave(board);
  assert.equal(wave.creations.size, 1);
  assert.deepEqual([...wave.creations.values()], ["color"]);
  assert.equal(wave.collected[5], 9, "the crossing cell is collected once");
  const separate = patterned();
  [0, 1, 2, 3, 32, 33, 34, 35].forEach((i) => {
    separate[i].type = 5;
  });
  assert.deepEqual(
    [...resolveWave(separate).creations.values()],
    ["column", "column"],
  );
  assert.equal(resolveWave(separate).collected[5], 8, "both reward cells count toward collection");
});

test("rainbow piece is neutral and cannot make ordinary matches, even beside other rainbows", () => {
  const board = patterned();
  [0, 1, 2, 8, 16].forEach((i) => {
    board[i] = { ...board[i], type: null, special: "color" };
  });
  assert.equal(findMatches(board).length, 0);
  assert.equal(resolveWave(board), null);
  assert.ok(findMove(board));
});

test("rainbow exchanged with piece clears exactly that piece color and the rainbow in either order", () => {
  for (const bombIndex of [0, 1])
    for (let target = 0; target < 6; target++) {
      const board = patterned();
      board[bombIndex] = { ...board[bombIndex], type: null, special: "color" };
      board[1 - bombIndex].type = target;
      const moved = swap(board, 0, 1);
      const wave = resolveWave(moved, { exchange: [0, 1] });
      const expected = moved.flatMap((piece, i) =>
        piece.special === "color" || piece.type === target ? [i] : [],
      );
      assert.deepEqual(
        wave.cleared.sort((a, b) => a - b),
        expected,
      );
      assert.equal(wave.collected[target], expected.length - 1);
      assert.equal(
        wave.collected.reduce((a, b) => a + b),
        expected.length - 1,
      );
      assert.equal(wave.creations.size, 0);
      assert.ok(
        moved.every(
          (piece, i) => expected.includes(i) || wave.board[i] === piece,
        ),
      );
    }
});

test("two exchanged rainbows clear the screen with the first selection and queue the second", () => {
  const board = patterned();
  board[0] = { ...board[0], type: null, special: "color" };
  board[1] = { ...board[1], type: null, special: "color" };
  board[27].special = "column";
  const wave = resolveWave(swap(board, 0, 1), { exchange: [0, 1] });
  assert.equal(wave.cleared.length, 63);
  assert.equal(wave.board.filter(Boolean).length, 1);
  assert.equal(wave.board[0].id, board[1].id);
  assert.equal(wave.board[0].pending, 1);
  assert.ok(wave.cleared.includes(1));
  assert.ok(!wave.cleared.includes(0));
  assert.equal(
    wave.collected.reduce((a, b) => a + b),
    62,
  );
  assert.equal(wave.score, clearPoints(63));
  assert.equal(wave.creations.size, 0);
  assert.equal(refill(wave.board, seededRandom(3)).filter(Boolean).length, 64);
});

test("rainbow color clearing activates matching striped piece", () => {
  const board = patterned();
  board[0] = { ...board[0], type: null, special: "color" };
  board[1].type = 2;
  board[19].type = 2;
  board[19].special = "row";
  const wave = resolveWave(swap(board, 0, 1), { exchange: [0, 1] });
  assert.ok(
    [16, 17, 18, 19, 20, 21, 22, 23].every((i) => wave.cleared.includes(i)),
  );
  assert.ok(wave.board.every((piece, i) => !piece || board[i].type !== 2));
});

test("restoration preserves neutral rainbows and upgrades old burst piece without losing progress", () => {
  const saved = createGame();
  saved.board[0] = { ...saved.board[0], special: "burst" };
  saved.score = 180;
  saved.moves = 27;
  const restored = restoreGame(saved);
  assert.ok(restored);
  assert.equal(restored.score, 180);
  assert.equal(restored.moves, 27);
  assert.equal(restored.board[0].special, "color");
  assert.equal(restored.board[0].type, null);
  assert.equal(
    saved.board[0].special,
    "burst",
    "migration must not mutate the input",
  );
  assert.ok(validGame(restored));
  assert.equal(restoreGame(null), null);
  assert.equal(
    validGame({
      ...restored,
      board: restored.board.map((piece, i) =>
        i ? piece : { ...piece, type: 1 },
      ),
    }),
    false,
  );
});

test("one stripe cannot make a nonmatching exchange legal or masquerade as an available hint", () => {
  const board = patterned();
  board[0].special = "row";
  assert.equal(findMove(board), null);
  assert.equal(canSwap(board, 0, 1), false);
  assert.equal(canSwap(board, 0, 8), false);
  assert.equal(resolveWave(swap(board, 0, 1), { exchange: [0, 1] }), null);
  assert.ok(
    resolveWave(board, { forced: [0] }),
    "stripes hit by other effects still activate",
  );
  assert.equal(canSwap(board, 7, 8), false);
});

function threeMatchBoard() {
  const board = patterned();
  board[0].type = 5;
  board[1].type = 5;
  board[10].type = 5;
  assert.equal(findMatches(board).length, 0);
  return board;
}

test("a stripe exchanged into a legitimate three-match activates its own direction", () => {
  for (const special of ["row", "column"]) {
    const board = threeMatchBoard();
    board[10].special = special;
    assert.ok(canSwap(board, 10, 2));
    const wave = resolveWave(swap(board, 10, 2), { exchange: [10, 2] });
    const expected = new Set([0, 1, 2]);
    for (let i = 0; i < 8; i++) expected.add(special === "row" ? i : i * 8 + 2);
    assert.deepEqual(new Set(wave.cleared), expected);
    assert.equal(
      wave.collected.reduce((a, b) => a + b),
      expected.size,
    );
  }
});

test("a legal exchange that matches only the ordinary piece leaves the unmatched stripe intact", () => {
  const board = threeMatchBoard();
  board[2].special = "column";
  assert.ok(canSwap(board, 10, 2));
  const wave = resolveWave(swap(board, 10, 2), { exchange: [10, 2] });
  assert.deepEqual(wave.cleared, [0, 1, 2]);
  assert.equal(wave.board[10].special, "column");
});

test("any two stripes activate both crossing rows and columns, regardless of orientations or swap direction", () => {
  for (const pair of [
    [27, 28],
    [27, 35],
    [28, 27],
    [35, 27],
  ]) {
    for (const first of ["row", "column"])
      for (const second of ["row", "column"]) {
        const board = patterned();
        board[pair[0]].special = first;
        board[pair[1]].special = second;
        assert.ok(canSwap(board, ...pair));
        const wave = resolveWave(swap(board, ...pair), { exchange: pair });
        const horizontal = Math.abs(pair[0] - pair[1]) === 1;
        const rows = horizontal ? [3] : [3, 4];
        const columns = horizontal ? [3, 4] : [3];
        const expected = new Set(
          Array.from({ length: 64 }, (_, i) => i).filter(
            (i) => rows.includes(Math.floor(i / 8)) || columns.includes(i % 8),
          ),
        );
        assert.equal(expected.size, 22);
        assert.deepEqual(new Set(wave.cleared), expected);
        assert.equal(wave.score, 2060);
        assert.equal(wave.creations.size, 0);
      }
  }
});

test("rainbow plus stripe converts every matching piece before exploding all generated stripes", () => {
  for (const pair of [
    [0, 1],
    [1, 0],
  ])
    for (const originalDirection of ["row", "column"])
      for (const directions of [["row"], ["column"], ["row", "column"]]) {
        const board = patterned();
        board[0] = { ...board[0], type: null, special: "color" };
        board[1].special = originalDirection;
        const moved = swap(board, ...pair);
        const target = 1;
        const targets = moved.flatMap((piece, index) =>
          piece.type === target ? [index] : [],
        );
        let calls = 0;
        const wave = resolveWave(moved, {
          exchange: pair,
          random: () =>
            directions[calls++ % directions.length] === "row" ? 0.25 : 0.75,
        });
        assert.ok(canSwap(board, ...pair));
        assert.equal(calls, targets.length);
        assert.deepEqual([...wave.transformed.keys()], targets);
        const expected = new Set([1]); // The rainbow moved from index 0 to index 1.
        targets.forEach((index, i) => {
          const special = directions[i % directions.length];
          assert.equal(wave.transformed.get(index), special);
          assert.equal(wave.effectBoard[index].special, special);
          assert.equal(wave.effectBoard[index].id, moved[index].id);
          assert.equal(wave.effectBoard[index].type, target);
          assert.equal(
            wave.stripeDirections.get(index),
            special,
            "converted stripes keep their assigned direction even when crossed by a matching ray",
          );
          for (let j = 0; j < 8; j++)
            expected.add(
              special === "row"
                ? Math.floor(index / 8) * 8 + j
                : j * 8 + (index % 8),
            );
        });
        assert.deepEqual(new Set(wave.cleared), expected);
        assert.equal(
          wave.collected.reduce((a, b) => a + b),
          expected.size - 1,
        );
        assert.equal(wave.score, clearPoints(expected.size));
        assert.equal(
          moved[0].special,
          originalDirection,
          "the source board must remain unchanged",
        );
      }
});

test("old saves with a lone stripe and no legal match are reshuffled without losing progress", () => {
  const saved = createGame();
  saved.board = patterned();
  saved.board[0].special = "row";
  saved.score = 720;
  saved.moves = 13;
  assert.equal(findMove(saved.board), null);
  assert.equal(validGame(saved), false);
  const restored = restoreGame(saved);
  assert.ok(restored);
  assert.equal(restored.score, 720);
  assert.equal(restored.moves, 13);
  assert.deepEqual(
    restored.board.map((f) => f.id).sort(),
    saved.board.map((f) => f.id).sort(),
  );
  assert.ok(findMove(restored.board));
  assert.ok(restored.board.some((f) => f.special === "row"));
  assert.equal(
    findMove(saved.board),
    null,
    "restoration must not mutate the saved board",
  );
});

test("remaining moves only become score after winning; they cannot satisfy unfinished goals", () => {
  const game = createGame();
  const config = levelConfig(1);
  game.score = config.target - 60;
  game.collected[config.targetType] = config.count;
  assert.equal(moveBonus(game), 0);
  assert.equal(totalScore(game), game.score);
  assert.equal(
    gameStatus(game),
    "playing",
    "hypothetical move rewards cannot satisfy the score target",
  );
  game.score = 4200;
  game.collected[config.targetType] = 0;
  assert.equal(gameStatus(game), "playing");
  assert.equal(moveBonus(game), 0, "piece goal must also be completed");
  game.status = "lost";
  assert.equal(totalScore(game), 4200);
});

test("completion scoring rewards early finishes, survives serialization, and never modifies match points", () => {
  const game = createGame();
  game.score = 4380;
  game.moves = 20;
  game.status = "won";
  game.collected[0] = 14;
  assert.equal(MOVE_BONUS, 1500);
  assert.equal(moveBonus(game), 30000);
  assert.equal(totalScore(game), 34380);
  assert.equal(
    totalScore(game),
    34380,
    "repeated reads do not add a second reward",
  );
  assert.equal(game.score, 4380);
  const restored = restoreGame(JSON.parse(JSON.stringify(game)));
  assert.equal(restored.score, 4380);
  assert.equal(totalScore(restored), 34380);
  assert.equal(totalScore({ ...game, moves: 0 }), 4380);
  assert.ok(
    totalScore({ ...game, moves: 25 }) > totalScore({ ...game, moves: 5 }),
  );
});

test("level difficulty extends gradually through level 10000 with round, ordered score goals", () => {
  let previousTarget = 0;
  let previousStars = [0, 0, 0];
  for (let level = 1; level <= 10000; level++) {
    const config = levelConfig(level);
    assert.ok(config.moves >= 23 && config.moves <= 32);
    assert.ok(config.target >= previousTarget && config.target <= 14800);
    assert.equal(config.starTargets[0], config.target);
    assert.ok(
      Math.abs(config.starTargets[1] - (config.target + config.starTargets[2]) / 2) <= 50,
      "two stars stay at the midpoint rounded to hundreds",
    );
    if (level >= 10 && level % 5 === 0)
      assert.equal(config.count, 36);
    else assert.equal(config.count, Math.min(24, 12 + (level - 1) * 2));
    assert.ok(
      config.starTargets.every(
        (target) => Number.isSafeInteger(target) && target % 100 === 0,
      ),
    );
    assert.ok(
      config.starTargets[0] < config.starTargets[1] &&
        config.starTargets[1] < config.starTargets[2],
    );
    assert.ok(
      config.starTargets.every((target, i) => target >= previousStars[i]),
      "all star thresholds increase monotonically",
    );
    if (level > 4)
      assert.ok(
        config.starTargets[2] - previousStars[2] <= 200,
        "the second segment has no sudden jump after the intro",
      );
    previousTarget = config.target;
    previousStars = config.starTargets;
  }
  const late = levelConfig(1000);
  assert.equal(late.moves, 23);
  assert.equal(late.count, 36);
  assert.deepEqual(late.starTargets, [14400, 24700, 35000]);
  for (const [level, targets] of [
    [1001, [14400, 24700, 35000]],
    [2000, [14600, 24900, 35100]],
    [5000, [14700, 25000, 35200]],
    [10000, [14800, 25000, 35200]],
  ]) {
    const config = levelConfig(level);
    assert.ok(config.moves >= late.moves && config.moves <= late.moves + 2);
    if (level % 5 === 0) assert.equal(config.count, 36);
    else assert.equal(config.count, 24);
    assert.deepEqual(config.starTargets, targets);
  }
  const daily = levelConfig(1, true);
  assert.deepEqual(levelConfig(1000, true), daily);
});

test("collection challenges retain their higher count within the four-type rotation and stay separate from daily play", () => {
  for (const level of [1, 4, 5, 6, 9, 11, 14, 16, 999, 1001])
    assert.equal(levelConfig(level).count, Math.min(24, 12 + (level - 1) * 2));
  for (const level of [25, 45, 65, 85, 105, 305, 1005, 2005]) {
    const config = levelConfig(level);
    assert.equal(config.goalKind, "collect");
    assert.equal(config.count, 36);
    assert.equal(levelConfig(level, true).count, 15);
    const game = createGame(level, false, seededRandom(42));
    game.board = game.board.map(piece => ({ ...piece, ice: 0 }));
    game.score = config.target;
    game.collected[config.targetType] = config.count - 1;
    assert.equal(gameStatus(game), "playing");
    game.moves = 0;
    assert.equal(gameStatus(game), "lost");
    game.collected[config.targetType]++;
    assert.equal(gameStatus(game), "won", "the last move can meet the higher collection target");
  }
});

test("two-stage star goals allow either strong combos or efficient play", () => {
  assert.deepEqual(levelConfig(1).starTargets, [1800, 5800, 9800]);
  assert.deepEqual(
    [1, 2, 3, 4].map((level) => levelConfig(level).starTargets[2]),
    [9800, 16000, 22300, 28500],
  );
  assert.deepEqual(levelConfig(1, true).starTargets, [2900, 7000, 11000]);
  const game = createGame();
  game.score = 7000;
  const thresholds = levelConfig(game.level).starTargets;
  assert.equal(
    thresholds.filter((target) => totalScore(game) >= target).length,
    2,
    "an ordinary midgame score no longer fills all stars",
  );
  game.moves = 4;
  assert.deepEqual(levelConfig(game.level).starTargets, thresholds);
  game.score = 4380;
  game.moves = 20;
  game.status = "won";
  assert.equal(
    thresholds.filter((target) => totalScore(game) >= target).length,
    3,
    "unused moves can upgrade the final star rating",
  );
  for (const [score, moves] of [
    [9800, 0],
    [1800, 10],
    [4800, 7],
    [7800, 3],
  ]) {
    assert.equal(
      thresholds.filter(
        (target) =>
          totalScore({ ...game, score, moves, status: "won" }) >= target,
      ).length,
      3,
      "high match points, unused moves, and mixed play must all qualify",
    );
  }
  for (const daily of [false, true])
    for (const level of [1, 5, 10, 50]) {
      const targets = levelConfig(level, daily).starTargets;
      assert.ok(targets[0] < targets[1] && targets[1] < targets[2]);
      const requiredMoves = Math.ceil((targets[2] - targets[0]) / MOVE_BONUS);
      for (const [moves, expectedStars] of [
        [requiredMoves - 1, 2],
        [requiredMoves, 3],
      ])
        assert.equal(
          targets.filter(
            (target) =>
              totalScore({
                ...game,
                score: targets[0],
                moves,
                status: "won",
              }) >= target,
          ).length,
          expectedStars,
          "remaining moves can cover the gap between completion and three stars",
        );
    }
});

test("ice blocks natural matches and every exchange, including special combinations", () => {
  const board = patterned();
  [0, 1, 2].forEach((i) => {
    board[i].type = 5;
  });
  board[1].ice = 1;
  assert.equal(findMatches(board).length, 0);
  board[0] = { ...board[0], type: null, special: "color" };
  assert.equal(canSwap(board, 0, 1), false);
  assert.equal(canSwap(board, 1, 0), false);
  assert.equal(resolveWave(swap(board, 0, 1), { exchange: [0, 1] }), null);
});

test("adjacent removals chip ice once per wave, without removing or collecting its piece", () => {
  const board = patterned();
  [0, 1, 2].forEach((i) => {
    board[i].type = 5;
  });
  board[8].ice = 1;
  board[9].ice = 2;
  board[11].ice = 1;
  const wave = resolveWave(board);
  assert.deepEqual(wave.cleared, [0, 1, 2]);
  assert.equal(wave.iceHits.get(8), 0);
  assert.equal(wave.iceHits.get(9), 1);
  assert.equal(
    wave.iceHits.has(11),
    false,
    "diagonal removals do not break ice",
  );
  assert.equal(wave.board[8].id, board[8].id);
  assert.equal(wave.board[9].ice, 1);
  assert.equal(wave.board[11].ice, 1);
  assert.equal(wave.score, 180);
  assert.equal(
    wave.collected.reduce((a, b) => a + b),
    3,
  );
  assert.equal(board[9].ice, 2, "resolution does not mutate its input");
});

test("reward cells chip neighboring ice when an exchange creates stripes or rainbows", () => {
  const shapes = [
    { cells: [24, 25, 26, 27], at: 26, from: 34, frozen: 18, special: "column" },
    { cells: [3, 11, 19, 27], at: 19, from: 20, frozen: 18, special: "row" },
    { cells: [24, 25, 26, 27, 28], at: 26, from: 34, frozen: 18, special: "color" },
    { cells: [3, 11, 19, 27, 35], at: 19, from: 20, frozen: 18, special: "color" },
    { cells: [10, 18, 26, 27, 28], at: 26, from: 34, frozen: 25, special: "color" },
  ];
  for (const { cells, at, from, frozen, special } of shapes)
    for (const ice of [1, 2]) {
      const board = patterned();
      for (const index of [...cells, from]) board[index].type = 5;
      board[at].type = 1;
      board[29].type = 2;
      if (!cells.includes(35)) board[35].type = 2;
      board[frozen].ice = ice;
      assert.equal(findMatches(board).length, 0);
      const exchanged = swap(board, from, at);
      const wave = resolveWave(exchanged, {
        exchange: [from, at],
        preferred: [at, from],
      });
      assert.equal(wave.creations.get(at), special);
      assert.equal(wave.iceHits.get(frozen), ice - 1);
      assert.equal(wave.board[frozen].ice, ice - 1);
      assert.equal(wave.board[frozen].id, board[frozen].id);
      assert.equal(wave.board[at].special, special);
      assert.equal(wave.board[at].id, board[from].id);
      assert.ok(!wave.cleared.includes(at));
      assert.ok(!wave.cleared.includes(frozen));
      assert.equal(wave.score, clearPoints(cells.length) + (special === "color" ? 200 : 80));
      assert.equal(wave.collected.reduce((total, count) => total + count, 0), cells.length);
      assert.equal(board[frozen].ice, ice, "the input board is unchanged");
    }
});

test("ice adjacent to both a reward cell and another match loses only one layer", () => {
  const board = patterned();
  for (const index of [24, 25, 26, 27]) board[index].type = 5;
  for (const index of [8, 9, 10]) board[index].type = 4;
  board[18].ice = 2;
  const wave = resolveWave(board, { preferred: [26] });
  assert.equal(wave.creations.get(26), "column");
  assert.equal(wave.iceHits.get(18), 1);
  assert.equal(wave.board[18].ice, 1);
  assert.equal(wave.board[26].special, "column");
});

test("special effects chip frozen piece without activating it or skipping an ice layer", () => {
  const board = patterned();
  board[24].special = "row";
  board[27] = { ...board[27], ice: 2, special: "column" };
  const wave = resolveWave(board, { forced: [24] });
  assert.equal(wave.iceHits.get(27), 1);
  assert.equal(wave.cleared.length, 7);
  assert.equal(wave.cleared.includes(27), false);
  assert.equal(
    wave.cleared.includes(3),
    false,
    "frozen column stripe cannot activate",
  );
  assert.equal(wave.board[27].special, "column");
  assert.equal(wave.board[27].id, board[27].id);
});

test("rainbow and stripe preserve frozen matching piece while breaking its ice", () => {
  const board = patterned();
  board[0] = { ...board[0], type: null, special: "color" };
  board[1] = { ...board[1], type: 1, special: "row" };
  board[20] = { ...board[20], type: 1, ice: 1 };
  const wave = resolveWave(swap(board, 0, 1), {
    exchange: [0, 1],
    random: seededRandom(12),
  });
  assert.equal(wave.transformed.has(20), false);
  assert.equal(wave.iceHits.get(20), 0);
  assert.equal(wave.board[20].id, board[20].id);
  assert.equal(wave.board[20].special, null);
  assert.equal(wave.cleared.includes(20), false);
});

test("gravity routes existing piece around a frozen anchor without losing any survivors", () => {
  const board = patterned();
  board[24].ice = 1;
  const anchor = board[24];
  for (const index of [8, 40, 56]) board[index] = null;
  const next = refill(board, seededRandom(7));
  assert.equal(next[24].id, anchor.id);
  assert.equal(next[24].ice, anchor.ice);
  for (const piece of board.filter(Boolean))
    assert.ok(next.some(f => f.id === piece.id), "every surviving piece keeps its identity");
  assert.equal(next.filter(Boolean).length, 64);
  assert.equal(new Set(next.map((piece) => piece.id)).size, 64);
});

test("open columns refill vertically even when ice exists elsewhere or further below", () => {
  for (const frozen of [63, 51, 19]) {
    const board = patterned();
    board[frozen].ice = 1;
    for (const i of [3, 11]) board[i] = null;
    const drops = [];
    let spawned = 0;
    const next = refill(
      board,
      () => { spawned++; return 0.25; },
      (piece, from, to) => drops.push({ id: piece.id, from, to }),
    );
    assert.equal(spawned, 2);
    assert.ok(
      drops.every(drop => ((drop.from % 8) + 8) % 8 === drop.to % 8),
      "an open vertical path must never pull neighboring piece diagonally",
    );
    for (let i = 0; i < board.length; i++)
      if (board[i]) assert.equal(next[i], board[i]);
    assert.equal(next[frozen], board[frozen]);
  }
});

test("a vertical supply takes priority over lower diagonal neighbors", () => {
  const board = patterned();
  board[3].ice = 1;
  board[27] = null;
  const drops = [];
  const next = refill(
    board,
    seededRandom(2),
    (piece, from, to) => drops.push({ id: piece.id, from, to }),
  );
  const diagonals = drops.filter(
    drop => drop.from >= 0 && drop.from % 8 !== drop.to % 8,
  );
  assert.deepEqual(diagonals, [{ id: board[2].id, from: 2, to: 11 }]);
  assert.equal(next[27], board[19]);
  assert.equal(next[11], board[2]);
  assert.equal(next[3].id, board[3].id);
  assert.equal(next[3].ice, 1);
  assert.ok(!board.some(piece => piece?.id === next[2].id));
});

test("deeper holes fill through the slot immediately beneath ice, then fall vertically", () => {
  const board = patterned();
  board[19].ice = 1;
  [27, 35, 43].forEach(i => { board[i] = null; });
  const drops = [];
  const next = refill(board, seededRandom(3), (piece, from, to) =>
    drops.push({ id: piece.id, from, to }));
  const diagonals = drops.filter(drop => drop.from >= 0 && drop.from % 8 !== drop.to % 8);
  assert.deepEqual(diagonals.map(drop => drop.to), [27, 27, 27]);
  assert.deepEqual(diagonals.map(drop => drop.from), [18, 20, 18]);
  assert.equal(next[43].id, board[18].id);
  assert.equal(next[35].id, board[20].id);
  assert.equal(next[27].id, board[10].id);
  for (const i of [26, 28, 34, 36]) assert.equal(next[i], board[i]);
});

test("a top-center ice block feeds its entire empty column through the first cell below it", () => {
  const board = patterned();
  board[3].ice = 1;
  for (let i = 11; i < 64; i += 8) board[i] = null;
  const drops = [];
  const next = refill(board, seededRandom(4), (piece, from, to) =>
    drops.push({ id: piece.id, from, to }));
  const diagonalEntries = drops.filter(drop => drop.from >= 0 && drop.from % 8 !== drop.to % 8);
  assert.deepEqual(diagonalEntries.map(drop => drop.to), Array(7).fill(11));
  assert.deepEqual(diagonalEntries.map(drop => drop.from), [2, 4, 2, 4, 2, 4, 2]);
  assert.ok(drops.filter(drop => drop.to % 8 === 3 && drop.to > 11)
    .every(drop => drop.from === drop.to - 8));
  assert.ok(next.every(Boolean));
  assert.equal(next[59].id, board[2].id);
  assert.equal(next[3].id, board[3].id);
  assert.equal(next[3].ice, 1);
});

test("a sealed upper entry uses deeper diagonals only where vertical supply is cut", () => {
  const game = createGame(4, false, seededRandom(7));
  const board = patterned();
  for (const i of [0, 1]) board[i] = { ...board[i], type: null, special: "color" };
  [18, 19, 20].forEach(i => { board[i].ice = 1; });
  [27, 35, 43].forEach(i => { board[i] = null; });
  const drops = [];
  const next = refill(board, seededRandom(4), (piece, from, to) =>
    drops.push({ id: piece.id, from, to }));
  assert.equal(next[27], null);
  assert.equal(next[43].id, board[26].id);
  assert.equal(next[35].id, board[28].id);
  const diagonals = drops.filter(drop => drop.from >= 0 && drop.from % 8 !== drop.to % 8);
  assert.deepEqual(diagonals.filter(drop => drop.to % 8 === 3).map(drop => drop.to), [35, 35]);
  game.board = shuffleBoard(next, seededRandom(5));
  game.iceGoal = 3;
  assert.ok(validGame(game), "the unreachable top of the pocket is valid save data");
  const restored = restoreGame(structuredClone(game));
  assert.equal(restored.board[27], null);
  for (const i of [35, 43]) assert.ok(restored.board[i]);
});

test("a horizontal ice wall leaves a narrowing triangle of unreachable holes", () => {
  for (const width of [3, 5, 7, 8]) {
    const board = patterned();
    const start = Math.floor((8 - width) / 2);
    for (let col = start; col < start + width; col++) board[8 + col].ice = 1;
    for (let i = 16; i < 64; i++) board[i] = null;
    const next = refill(board, seededRandom(width));
    const holes = next.flatMap((piece, i) => piece ? [] : [i]);
    const expected = [];
    for (let depth = 1; depth <= 6; depth++)
      for (let col = start; col < start + width; col++) {
        const fromLeft = start > 0 ? col - start + 1 : Infinity;
        const fromRight = start + width < 8 ? start + width - col : Infinity;
        if (Math.min(fromLeft, fromRight) > depth)
          expected.push((1 + depth) * 8 + col);
      }
    assert.deepEqual(holes, expected);
    for (let col = start; col < start + width; col++) {
      assert.equal(next[8 + col].id, board[8 + col].id);
      assert.equal(next[8 + col].ice, 1);
    }
  }
});

test("an ice-blocked vacancy takes a diagonal survivor before spawning only at the top", () => {
  for (const leftBlocked of [false, true]) {
    const board = patterned();
    board[19].ice = 1;
    if (leftBlocked) board[18].ice = 1;
    board[27] = null;
    const source = leftBlocked ? 20 : 18;
    let spawned = 0;
    const drops = [];
    const next = refill(board, () => { spawned++; return 0.25; },
      (piece, from, to) => drops.push({ id: piece.id, from, to }));
    assert.equal(next[27], board[source]);
    assert.equal(next[source], board[source - 8]);
    assert.equal(next[source - 8], board[source - 16]);
    assert.equal(next[19].id, board[19].id);
    assert.equal(next[19].ice, 1);
    assert.equal(spawned, 1);
    assert.equal(board.some(piece => piece?.id === next[source - 16].id), false);
    assert.equal(board[27], null, "refilling leaves the source board untouched");
    assert.ok(drops.some(drop => drop.id === board[source].id && drop.from === source && drop.to === 27));
    const entering = drops.filter(drop => drop.from < 0);
    assert.equal(entering.length, 1);
    assert.ok(entering.every(drop => drop.to >= 0 && drop.to < 8));
  }
});

test("ice barriers alternate left and right within a refill and across later refills", () => {
  let board = patterned();
  board[19].ice = 1;
  const anchor = board[19];
  [27, 35, 43, 51].forEach(i => { board[i] = null; });
  const sides = [];
  const track = (piece, from, to) => {
    if (to % 8 === 3 && from % 8 !== 3) {
      assert.equal(to, 27, "every diagonal enters immediately below the ice");
      sides.push(from % 8 < 3 ? "left" : "right");
    }
  };
  board = refill(board, seededRandom(3), track);
  assert.deepEqual(sides, ["left", "right", "left", "right"]);
  assert.equal(board[19].feedSide, "left");
  assert.equal(anchor.feedSide, undefined, "the source tile is not mutated");
  for (let round = 0; round < 4; round++) {
    const next = [...board];
    next[27] = null;
    board = refill(next, seededRandom(round), track);
    assert.equal(board[19].id, anchor.id);
    assert.equal(board[19].ice, 1);
  }
  assert.deepEqual(sides, ["left", "right", "left", "right", "left", "right", "left", "right"]);
});

test("separate ice barriers in the same column keep independent turns", () => {
  const board = patterned();
  [19, 43].forEach(i => { board[i].ice = 1; });
  [27, 51].forEach(i => { board[i] = null; });
  const first = refill(board, seededRandom(2));
  assert.equal(first[19].feedSide, "right");
  assert.equal(first[43].feedSide, "right");
  const next = [...first];
  next[27] = null;
  const second = refill(next, seededRandom(3));
  assert.equal(second[19].feedSide, "left");
  assert.equal(second[43].feedSide, "right");
  assert.equal(second[27].id, first[20].id);
});

test("a sealed side or board edge always uses the other diagonal source", () => {
  for (const sealed of [18, 20]) {
    let board = patterned();
    board[19].ice = 1;
    board[sealed].ice = 1;
    const source = sealed === 18 ? 20 : 18;
    for (let round = 0; round < 4; round++) {
      const next = [...board];
      next[27] = null;
      board = refill(next, seededRandom(round));
      assert.equal(board[27].id, next[source].id);
      assert.equal(board[sealed].id, next[sealed].id);
    }
    board = board.map((piece, i) => i === sealed ? { ...piece, ice: 0 } : piece);
    const next = [...board];
    next[27] = null;
    const opened = refill(next, seededRandom(8));
    assert.equal(opened[27].id, next[sealed].id, "the reopened side gets the next turn");
  }
  let board = patterned();
  board[8].ice = 1;
  for (let round = 0; round < 3; round++) {
    const next = [...board];
    next[16] = null;
    board = refill(next, seededRandom(round));
    assert.equal(board[16].id, next[9].id);
  }
});

test("an open but temporarily empty preferred source waits for top-entering piece", () => {
  const board = patterned();
  board[19] = { ...board[19], ice: 1, feedSide: "right" };
  [4, 12, 20, 27].forEach(i => { board[i] = null; });
  const diagonals = [];
  const next = refill(board, seededRandom(4), (piece, from, to) => {
    if (to === 27) diagonals.push(from);
  });
  assert.deepEqual(diagonals, [20]);
  assert.equal(next[18].id, board[18].id);
  assert.equal(next[19].feedSide, "left");
  assert.ok(next.every(Boolean));
});

test("a permanently unreachable preferred source falls back without creating piece in a closed pocket", () => {
  const board = patterned();
  [11, 12, 13, 19].forEach(i => { board[i].ice = 1; });
  board[19].feedSide = "right";
  board[20] = null;
  board[27] = null;
  const next = refill(board, seededRandom(5));
  assert.equal(next[27].id, board[18].id);
  assert.equal(next[20], null);
  assert.equal(next[19].feedSide, "right");
});

test("diagonal alternation survives saves and is cleared when its ice barrier thaws", () => {
  const game = createGame(4, false, seededRandom(7));
  game.board[1] = { ...game.board[1], feedSide: "right" };
  assert.ok(validGame(game));
  const restored = restoreGame(JSON.parse(JSON.stringify(game)));
  assert.equal(restored.board[1].feedSide, "right");
  const invalid = structuredClone(game);
  invalid.board[1].feedSide = "up";
  assert.equal(validGame(invalid), false);
  const wave = resolveWave(game.board, { forced: [1] });
  assert.equal(wave.board[1].ice, 0);
  assert.equal(wave.board[1].feedSide, undefined);
  assert.equal(game.board[1].feedSide, "right");
  assert.ok(validGame({ ...game, board: wave.board }));
});

test("fully blocked pockets stay empty until an upper ice block thaws", () => {
  const board = patterned();
  [18, 19, 20].forEach(i => { board[i].ice = 1; });
  board[27] = null;
  let spawned = 0;
  const next = refill(board, () => { spawned++; return 0.25; });
  assert.deepEqual(next, board);
  assert.equal(spawned, 0, "piece cannot spawn inside an enclosed pocket");
  const thawed = next.map((piece, i) => i === 18 ? { ...piece, ice: 0 } : piece);
  const filled = refill(thawed, () => { spawned++; return 0.25; });
  assert.equal(filled[27].id, board[18].id);
  assert.equal(spawned, 1);
  assert.ok(filled.every(Boolean));
});

test("a frozen horizontal wall blocks new piece even when its lower board has holes", () => {
  const board = patterned();
  for (let i = 8; i < 16; i++) board[i].ice = 1;
  board[0] = null;
  board[27] = null;
  board[60] = null;
  let spawned = 0;
  const next = refill(board, () => { spawned++; return 0.25; });
  assert.equal(spawned, 1, "only the top-row vacancy receives a new piece");
  assert.equal(next.filter(Boolean).length, 62);
  for (const piece of next.slice(16).filter(Boolean))
    assert.ok(board.includes(piece), "nothing was generated under the ice wall");
});

test("special rays do not score empty cells, and blocked holes survive shuffle and reload", () => {
  const game = createGame(4, false, seededRandom(4));
  game.board = patterned();
  [18, 19, 20].forEach(i => { game.board[i].ice = 1; });
  game.board[27] = null;
  game.iceGoal = 3;
  for (const i of [0, 1])
    game.board[i] = { ...game.board[i], type: null, special: "color" };
  game.board[24].special = "row";
  assert.equal(resolveWave(game.board, { forced: [27] }), null);
  const wave = resolveWave(game.board, { forced: [24] });
  assert.equal(wave.cleared.includes(27), false);
  assert.equal(wave.cleared.length, 7);
  assert.equal(wave.score, 530);
  assert.ok(validGame(game));
  assert.equal(restoreGame(structuredClone(game)).board[27], null);
  const next = shuffleBoard(game.board, seededRandom(72));
  assert.equal(next[27], null);
  for (const i of [18, 19, 20]) assert.equal(next[i], game.board[i]);
  assert.ok(findMove(next));
  assert.equal(findMatches(next).length, 0);
});

test("icy levels are stable and playable; shuffling preserves ice anchors and all progress", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = seededRandom(seed);
    const game = createGame(1000 + (seed % 24), false, random);
    const config = levelConfig(game.level);
    assert.equal(iceLayers(game.board), config.iceCount + config.doubleIce);
    assert.equal(game.iceGoal, iceLayers(game.board));
    assert.equal(game.moves, config.moves);
    assert.ok(validGame(game));
    const next = shuffleBoard(game.board, random);
    game.board.forEach((piece, i) => {
      if (piece.ice) assert.equal(next[i], piece);
    });
    assert.deepEqual(
      next.map((piece) => piece.id).sort(),
      game.board.map((piece) => piece.id).sort(),
    );
    assert.equal(findMatches(next).length, 0);
    assert.ok(findMove(next));
  }
  assert.equal(iceLayers(createGame(3).board), 0);
  assert.equal(iceLayers(createGame(4).board), 2);
  assert.equal(
    levelConfig(1004).moves,
    24,
    "adjacent ice earns extra opening moves",
  );
  assert.equal(
    levelConfig(1008).moves,
    25,
    "dense frozen walls receive a larger opening budget",
  );
});

test("ice is a completion goal; old saves remain playable without adding new ice", () => {
  const game = createGame(49, false, seededRandom(8));
  const config = levelConfig(game.level);
  game.score = config.target;
  game.collected[config.targetType] = config.count;
  assert.equal(gameStatus(game), "playing");
  game.moves = 0;
  assert.equal(gameStatus(game), "lost");
  game.board = game.board.map((piece) => ({ ...piece, ice: 0 }));
  assert.equal(gameStatus(game), "won");
  delete game.iceGoal;
  const restored = restoreGame(JSON.parse(JSON.stringify(game)));
  assert.equal(restored.iceGoal, 0);
  assert.equal(iceLayers(restored.board), 0);
  assert.equal(gameStatus(restored), "won");
  for (const ice of [-1, 0.5, 3, "1"]) {
    const broken = structuredClone(game);
    broken.board[0].ice = ice;
    assert.equal(validGame(broken), false);
  }
  const blocked = structuredClone(game);
  blocked.board.forEach((piece) => {
    piece.ice = 2;
  });
  blocked.iceGoal = 128;
  assert.equal(
    restoreGame(blocked),
    null,
    "an impossible frozen save falls back safely",
  );
});

test("area scoring interpolates from one to two, rounds after cascade multiplication, and caps at five cascades", () => {
  for (const [count, first, second, fifth] of [
    [1, 60, 120, 300], [2, 120, 240, 600], [3, 180, 360, 900],
    [4, 270, 540, 1350], [6, 440, 880, 2200], [16, 1400, 2810, 7020],
    [32, 3240, 6490, 16220], [40, 4270, 8540, 21350], [64, 7680, 15360, 38400],
  ]) {
    const board = patterned();
    const forced = Array.from({ length: count }, (_, i) => i);
    for (const [chain, score] of [[1, first], [2, second], [5, fifth], [6, fifth]]) {
      const wave = resolveWave(board, { forced, chain });
      assert.equal(wave.cleared.length, count);
      assert.equal(wave.score, score);
      assert.equal(wave.clearScore, score);
      assert.equal(wave.score % 10, 0);
      assert.ok(wave.areaMultiplier >= 1 && wave.areaMultiplier <= 2);
      if (count <= 3) assert.equal(wave.areaMultiplier, 1);
      if (count === 64) assert.equal(wave.areaMultiplier, 2);
    }
  }
});

test("area multiplier stays above linear interpolation with decreasing gains", () => {
  let previous = 1;
  let previousGain = Infinity;
  for (let count = 4; count <= 64; count++) {
    const wave = resolveWave(patterned(), {
      forced: Array.from({ length: count }, (_, i) => i),
    });
    const gain = wave.areaMultiplier - previous;
    assert.ok(gain > 0);
    assert.ok(gain < previousGain);
    if (count < 64) assert.ok(wave.areaMultiplier > 1 + (count - 3) / 61);
    previous = wave.areaMultiplier;
    previousGain = gain;
  }
  assert.equal(previous, 2);
});

test("area scoring excludes ice and protected rainbows", () => {
  const board = patterned();
  board[0] = { ...board[0], type: null, special: "color" };
  board[1] = { ...board[1], type: null, special: "color" };
  board[18] = { ...board[18], type: null, special: "color" };
  board[27] = { ...board[27], ice: 2 };
  const wave = resolveWave(swap(board, 0, 1), { exchange: [0, 1] });
  assert.equal(wave.cleared.length, 61);
  assert.equal(wave.score, clearPoints(61));
  assert.equal(wave.board[18].special, "color");
  assert.equal(wave.board[27].ice, 1);
  assert.equal(wave.areaMultiplier, 1 + Math.sqrt(58 / 61));
});

test("converted reward cells count toward area, base points and collection", () => {
  for (const [count, first, second] of [[4, 350, 620], [5, 550, 910], [6, 640, 1080], [8, 820, 1430]]) {
    const board = patterned();
    for (let i = 0; i < count; i++) board[i].type = 5;
    board[count].type = 0;
    for (const [chain, score] of [[1, first], [2, second]]) {
      const wave = resolveWave(board, { preferred: [2], chain });
      assert.equal(wave.areaCount, count);
      assert.equal(wave.areaMultiplier, 1 + Math.sqrt((count - 3) / 61));
      assert.equal(wave.cleared.length, count - 1);
      assert.equal(wave.collected[5], count);
      assert.equal(wave.score, score);
      assert.equal(wave.creations.size, 1);
    }
  }
});

test("pattern scoring separates match sizes and awards fixed bonuses again on later cascades", () => {
  for (const vertical of [false, true])
    for (const [count, firstScore, bonus] of [[3, 180, 0], [4, 350, 80], [5, 550, 200], [6, 640, 200], [8, 820, 200]]) {
      const board = patterned();
      for (const piece of board) if (piece.type === 5) piece.type = 0;
      for (let i = 0; i < count; i++) board[vertical ? i * 8 : i].type = 5;
      for (const chain of [1, 2, 5, 6]) {
        const wave = resolveWave(board, { chain, preferred: [0] });
        assert.equal(wave.patternBonus, bonus);

        assert.equal(wave.areaCount, count);
        assert.equal(wave.collected[5], count);
        assert.equal(wave.score, clearPoints(count, chain) + bonus);
        if (chain === 1) assert.equal(wave.score, firstScore);
      }
    }
});

test("independent patterns add only their pattern rewards to area scoring", () => {
  const board = patterned();
  for (const i of [0, 1, 2, 3]) board[i].type = 5;
  for (const i of [40, 41, 42, 43, 44]) board[i].type = 4;
  const first = resolveWave(board, { preferred: [0, 40] });
  assert.equal(first.groupCount, 2);
  assert.equal(first.patternBonus, 280);

  assert.equal(first.cleared.length, 7);
  assert.equal(first.areaCount, 9);
  assert.equal(first.score, 990);
  assert.equal(resolveWave(board, { chain: 2 }).score, 1700);
});

test("intersecting four-matches receive only the highest pattern reward once", () => {
  const board = patterned();
  [10, 18, 25, 26, 27, 28, 34].forEach(i => { board[i].type = 5; });
  board[29].type = 0;
  const wave = resolveWave(board, { preferred: [26] });
  assert.equal(wave.groupCount, 1);
  assert.equal(wave.patternBonus, 200);

  assert.equal(wave.score, 730);
});

test("one ABA/BAB exchange scores simultaneous matches only through area and cascade multipliers", () => {
  for (const pair of [
    [1, 9],
    [9, 1],
  ]) {
    const board = patterned();
    [0, 2, 9].forEach((index) => {
      board[index].type = 5;
    });
    [1, 8, 10].forEach((index) => {
      board[index].type = 4;
    });
    assert.equal(findMatches(board).length, 0);
    assert.ok(canSwap(board, ...pair));
    const swapped = swap(board, ...pair);
    const first = resolveWave(swapped, { exchange: pair });
    assert.equal(first.cleared.length, 6);
    assert.equal(first.groupCount, 2);

    assert.equal(first.score, 440);
    const second = resolveWave(swapped, { exchange: pair, chain: 2 });
    assert.equal(second.score, 880);
    assert.equal(first.score + second.score, 1320);
    assert.equal(resolveWave(swapped, { chain: 5 }).score, 2200);
    assert.equal(resolveWave(swapped, { chain: 6 }).score, 2200);
  }
});

test("three independent matches use combined area; intersections and special blasts retain their group counts", () => {
  const board = patterned();
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) board[row * 8 + col].type = 5 - row;
  const triple = resolveWave(board);
  assert.equal(triple.groupCount, 3);

  assert.equal(triple.score, 710);
  const cross = patterned();
  [9, 10, 11, 2, 18].forEach((index) => {
    cross[index].type = 5;
  });
  const crossing = resolveWave(cross, { preferred: [10] });
  assert.equal(crossing.groupCount, 1);

  assert.equal(crossing.creations.get(10), "color");
  const stripes = patterned();
  stripes[27].special = "row";
  stripes[28].special = "column";
  const blast = resolveWave(swap(stripes, 27, 28), { exchange: [27, 28] });
  assert.equal(blast.groupCount, 0);

  assert.equal(blast.patternBonus, 0);
  assert.equal(blast.score, 2060);
});

test("double rainbows preserve every uninvolved rainbow, even when triggered stripes pass through them", () => {
  for (const pair of [
    [0, 1],
    [1, 0],
  ]) {
    const board = patterned();
    for (const i of [0, 1, 11, 27, 45, 63])
      board[i] = { ...board[i], type: null, special: "color" };
    board[3].special = "column";
    board[40].special = "row";
    board[56].special = "row";
    const protectedIds = [11, 27, 45, 63].map((i) => board[i].id);
    const wave = resolveWave(swap(board, ...pair), { exchange: pair });
    assert.equal(wave.cleared.length, 59);
    assert.equal(wave.score, clearPoints(59));
    assert.equal(
      wave.collected.reduce((a, b) => a + b),
      58,
    );
    assert.ok(wave.cleared.includes(pair[1]));
    assert.ok(!wave.cleared.includes(pair[0]));
    assert.equal(wave.board[pair[0]].id, board[pair[1]].id);
    assert.equal(wave.board[pair[0]].pending, 1);
    for (const i of [11, 27, 45, 63]) {
      assert.equal(wave.cleared.includes(i), false);
      assert.equal(wave.board[i], board[i]);
    }
    assert.equal(wave.board.filter(Boolean).length, 5);
    const refilled = refill(wave.board, seededRandom(42));
    for (const id of protectedIds)
      assert.ok(
        refilled.some((piece) => piece.id === id && piece.special === "color"),
      );
  }
});

function rainbowPattern(shape, special = null, vertical = false) {
  const transpose = (i) => Math.floor(i / 8) + (i % 8) * 8;
  const map = (i) => (vertical ? transpose(i) : i);
  const board = patterned();
  board.forEach((piece) => {
    if (piece.type === 5) piece.type = 0;
  });
  const cells = shape.map(map),
    landing = map(26),
    partner = map(18);
  cells.forEach((i) => {
    board[i].type = 5;
  });
  board[landing] = { ...board[landing], type: null, special: "color" };
  board[partner] = { ...board[partner], type: 5, special };
  return { board, cells, landing, partner };
}

test("rainbow swaps also create rewards from the partner's four, five and intersecting matches", () => {
  for (const [shape, reward] of [
    [[24, 25, 26, 27], "column"],
    [[24, 25, 26, 27, 28], "color"],
    [[26, 27, 28, 34, 42], "color"],
    [[25, 26, 27, 34, 42], "color"],
  ])
    for (const vertical of [false, true])
      for (const special of [null, "row", "column"])
        for (const reverse of [false, true]) {
          const { board, cells, landing, partner } = rainbowPattern(
            shape,
            special,
            vertical,
          );
          assert.equal(
            findMatches(board).length,
            0,
            "the starting board must be stable",
          );
          const pair = reverse ? [partner, landing] : [landing, partner];
          assert.ok(canSwap(board, ...pair));
          const moved = swap(board, ...pair);
          const wave = resolveWave(moved, {
            exchange: pair,
            preferred: [partner],
            random: seededRandom(30),
          });
          const expected = reward === "column" && vertical ? "row" : reward;
          assert.equal(wave.patternBonus, expected === "color" ? 200 : 80);
          assert.deepEqual([...wave.creations], [[landing, expected]]);
          assert.equal(wave.areaCount, wave.cleared.length + 1);
          assert.equal(wave.collected.reduce((sum, count) => sum + count, 0), wave.areaCount - 1);
          assert.equal(wave.board[landing].id, board[partner].id);
          assert.equal(wave.board[landing].special, expected);
          assert.equal(
            wave.board[landing].type,
            expected === "color" ? null : 5,
          );
          assert.equal(
            wave.cleared.includes(landing),
            false,
            "the new reward survives this wave",
          );
          assert.equal(
            wave.cleared.includes(partner),
            true,
            "the exchanged rainbow is consumed",
          );
          assert.equal(
            board[partner].special,
            special,
            "the input remains unchanged",
          );
          if (special) {
            assert.equal(
              wave.transformed.get(landing),
              wave.effectBoard[landing].special,
            );
            assert.equal(wave.transformed.size, cells.length);
            assert.ok(
              wave.cleared.some((i) => !cells.includes(i) && i !== partner),
              "converted stripes still explode",
            );
          } else {
            assert.equal(wave.collected[5], cells.length);
            assert.equal(wave.cleared.length, cells.length);
            assert.equal(wave.score, clearPoints(cells.length + 1) + (expected === "color" ? 200 : 80));
          }
        }
});

test("a rainbow combo does not create rewards for unrelated lines elsewhere on the board", () => {
  const board = patterned();
  board[0] = { ...board[0], type: null, special: "color" };
  board[1].type = 2;
  [32, 33, 34, 35].forEach((i) => {
    board[i].type = 5;
  });
  const wave = resolveWave(swap(board, 0, 1), { exchange: [0, 1] });
  assert.equal(wave.creations.size, 0);
});

test("queued rainbows clear one per refill, recompute the majority and precede ordinary matches", () => {
  const board = patterned();
  board[16].special = "row";
  for (const index of [18, 22])
    board[index] = { ...board[index], type: null, special: "color" };
  const hit = resolveWave(board, { forced: [16] });
  assert.deepEqual(
    [...hit.armed],
    [
      [18, 1],
      [22, 2],
    ],
  );
  assert.equal(hit.cleared.includes(18), false);
  assert.equal(hit.cleared.includes(22), false);
  assert.equal(hit.board[18].pending, 1);
  assert.equal(hit.board[22].pending, 2);
  const screen = refill(hit.board, seededRandom(4));
  screen.forEach((piece, i) => {
    if (piece.special !== "color")
      piece.type = i < 32 ? 0 : (Math.floor(i / 8) * 2 + (i % 8)) % 6;
  });
  [56, 57, 58].forEach((i) => {
    screen[i].type = 1;
  });
  screen[20] = { ...screen[20], type: 0, special: "row" };
  assert.ok(
    findMatches(screen).some((line) =>
      [56, 57, 58].every((i) => line.indices.includes(i)),
    ),
  );
  const firstIndex = pendingColorClear(screen),
    secondId = screen[22].id;
  const first = resolveWave(screen, { chain: 2 });
  assert.equal(first.triggeredColorClear, firstIndex);
  assert.equal(first.colorClearTarget, 0);
  assert.equal(first.groupCount, 0);

  assert.equal(first.creations.size, 0);
  assert.equal(
    first.board[22].pending,
    2,
    "the other rainbow survives even a stripe hit",
  );
  assert.equal(first.cleared.includes(22), false);
  assert.ok(
    [56, 57, 58].every((i) => !first.cleared.includes(i)),
    "ordinary matches wait",
  );
  assert.equal(
    first.cleared.filter((i) => screen[i].special === "color").length,
    1,
  );
  const nextScreen = refill(first.board, () => 0.75);
  assert.ok(
    nextScreen.some((piece) => piece.id === secondId && piece.pending === 2),
  );
  const second = resolveWave(nextScreen, { chain: 3 });
  assert.equal(nextScreen[second.triggeredColorClear].id, secondId);
  assert.equal(
    second.colorClearTarget,
    4,
    "the next refill has a different most-common piece",
  );
  assert.equal(
    second.cleared.filter((i) => nextScreen[i].special === "color").length,
    1,
  );
  assert.equal(pendingColorClear(second.board), -1);
});

test("the finale fires every stripe together in its original direction and queues all rainbows", () => {
  const board = patterned();
  for (const index of [16, 19]) board[index].special = "row";
  for (const index of [8, 32]) board[index].special = "column";
  for (const index of [18, 63])
    board[index] = { ...board[index], type: null, special: "color" };
  const snapshot = structuredClone(board);
  const wave = resolveWave(board, { finale: true });
  const expected = new Set([
    ...Array.from({ length: 8 }, (_, col) => 16 + col),
    ...Array.from({ length: 8 }, (_, row) => row * 8),
  ]);
  expected.delete(18);
  assert.deepEqual(new Set(wave.cleared), expected);
  assert.deepEqual([...wave.stripeDirections], [[8, "column"], [16, "row"], [19, "row"], [32, "column"]]);
  for (const index of [8, 16, 19, 32]) assert.equal(wave.board[index], null);
  assert.deepEqual([...wave.armed], [[18, 1], [63, 2]]);
  for (const [index, order] of wave.armed) {
    assert.equal(wave.board[index].id, board[index].id);
    assert.equal(wave.board[index].pending, order);
    assert.equal(wave.effectBoard[index].pending, order);
  }
  assert.equal(wave.score, clearPoints(expected.size));
  assert.deepEqual(board, snapshot);
});

test("a rainbow-only finale marks without clearing or scoring, then drains one rainbow per refill before matches", () => {
  const board = patterned();
  for (const index of [0, 63])
    board[index] = { ...board[index], type: null, special: "color" };
  const start = resolveWave(board, { finale: true });
  assert.deepEqual(start.cleared, []);
  assert.equal(start.score, 0);
  assert.deepEqual([...start.armed], [[0, 1], [63, 2]]);
  const firstScreen = refill(start.board, seededRandom(4));
  [56, 57, 58].forEach((index) => { firstScreen[index].type = 5; });
  const first = resolveWave(firstScreen);
  assert.equal(first.triggeredColorClear, 0);
  assert.equal(first.groupCount, 0);
  assert.equal(first.board[63].pending, 2);
  assert.equal(first.cleared.filter((index) => firstScreen[index].special === "color").length, 1);
  const nextScreen = refill(first.board, seededRandom(19));
  const second = resolveWave(nextScreen);
  assert.equal(nextScreen[second.triggeredColorClear].id, board[63].id);
  assert.equal(second.groupCount, 0);
  assert.equal(pendingColorClear(second.board), -1);
});

test("a finale leaves frozen specials protected and has no effect on an ordinary board", () => {
  const board = patterned();
  assert.equal(resolveWave(board, { finale: true }), null);
  board[16].special = "row";
  board[19] = { ...board[19], type: null, special: "color", ice: 1 };
  board[20] = { ...board[20], special: "row", ice: 1 };
  const wave = resolveWave(board, { finale: true });
  assert.equal(wave.board[19].ice, 0);
  assert.equal(wave.board[20].ice, 0);
  assert.equal(wave.board[19].pending, undefined);
  assert.equal(wave.stripeDirections.has(20), false);
  assert.equal(wave.cleared.includes(19), false);
  assert.equal(wave.cleared.includes(20), false);
});

test("a frozen special absorbs finale hits one layer at a time and then fires", () => {
  const board = patterned();
  board[16] = { ...board[16], special: "row", ice: 2 };
  const first = resolveWave(board, { finale: true });
  assert.equal(first.board[16].ice, 1);
  assert.equal(first.score, 0);
  const second = resolveWave(first.board, { finale: true });
  assert.equal(second.board[16].ice, 0);
  assert.equal(second.board[16].special, "row");
  const third = resolveWave(second.board, { finale: true });
  assert.deepEqual(new Set(third.cleared), new Set([16, 17, 18, 19, 20, 21, 22, 23]));
  assert.equal(third.stripeDirections.get(16), "row");
});

test("newly armed rainbows join the tail while previously armed rainbows retain priority", () => {
  const board = patterned();
  board[16].special = "row";
  for (const i of [18, 22, 63])
    board[i] = { ...board[i], type: null, special: "color" };
  const hit = resolveWave(board, { forced: [16] });
  const screen = refill(hit.board, seededRandom(4));
  screen.forEach((piece, i) => {
    if (piece.special !== "color")
      piece.type = i < 32 ? 0 : (Math.floor(i / 8) * 2 + (i % 8)) % 6;
  });
  screen[56] = { ...screen[56], type: 0, special: "row" };
  const first = resolveWave(screen);
  assert.equal(first.armed.get(63), 3);
  assert.equal(first.board[22].pending, 2);
  assert.equal(first.board[63].pending, 3);
  const next = refill(first.board, seededRandom(5));
  const pending = pendingColorClear(next);
  assert.equal(next[pending].id, board[22].id);
  const second = resolveWave(next);
  assert.equal(
    second.cleared.some((i) => next[i].id === board[63].id),
    false,
  );
});

test("queued saves can contain matches and zero moves, and finish before win/loss evaluation", () => {
  const game = createGame(1, false, seededRandom(9));
  game.board = patterned();
  [0, 1, 2].forEach((i) => {
    game.board[i].type = 5;
  });
  game.board[63] = {
    ...game.board[63],
    type: null,
    special: "color",
    pending: 1,
  };
  game.moves = 0;
  game.status = "playing";
  game.score = 1200;
  game.collected[0] = 12;
  assert.equal(gameStatus(game), "playing");
  assert.equal(canSwap(game.board, 10, 2), false);
  assert.ok(validGame(game));
  const restored = restoreGame(JSON.parse(JSON.stringify(game)));
  assert.equal(restored.board[63].pending, 1);
  assert.ok(findMatches(restored.board).length);
  const bad = structuredClone(game);
  bad.board[0].pending = 1;
  assert.equal(validGame(bad), false);
});

test("double-rainbow selection order survives swapping and queues exactly the second selected piece", () => {
  for (const pair of [[27, 28], [28, 27], [19, 27], [27, 19]]) {
    const board = patterned();
    for (const i of [...pair, 0, 63]) board[i] = { ...board[i], type: null, special: "color" };
    board[24].special = "row"; // Its ray crosses both exchanged positions.
    const wave = resolveWave(swap(board, ...pair), { exchange: pair });
    assert.ok(wave.cleared.includes(pair[1]), "first selected rainbow fires at its destination");
    assert.equal(wave.board[pair[1]], null);
    assert.equal(wave.board[pair[0]].id, board[pair[1]].id);
    assert.equal(wave.board[pair[0]].pending, 1);
    assert.deepEqual([...wave.armed], [[pair[0], 1]]);
    for (const i of [0, 63]) assert.equal(wave.board[i], board[i]);
    assert.equal(wave.cleared.length, 61);
    assert.equal(wave.areaCount, 61);
    assert.equal(wave.score, clearPoints(61));
  }
});

test("the exchanged partner waits for refill, then clears the new majority before natural matches", () => {
  const game = createGame(1, false, seededRandom(1));
  game.board = patterned();
  for (const i of [0, 1]) game.board[i] = { ...game.board[i], type: null, special: "color" };
  const wave = resolveWave(swap(game.board, 0, 1), { exchange: [0, 1] });
  const screen = refill(wave.board, seededRandom(15));
  const partner = screen.findIndex(piece => piece?.id === game.board[1].id);
  assert.equal(partner, 56);
  screen.forEach((piece, i) => {
    if (piece.special !== "color") piece.type = i < 40 ? 4 : (Math.floor(i / 8) * 2 + i % 8) % 6;
  });
  assert.ok(findMatches(screen).some(line => line.indices.length >= 5));
  const queuedGame = { ...game, board: screen, moves: 0, score: 100000, collected: Array(6).fill(100) };
  assert.equal(gameStatus(queuedGame), "playing", "completion waits for the partner even on the last move");
  assert.ok(validGame(queuedGame));
  const restored = restoreGame(JSON.parse(JSON.stringify(queuedGame)));
  assert.ok(restored);
  const second = resolveWave(restored.board, { chain: 2 });
  const majority = screen.map((piece, i) => piece.type === 4 ? i : -1).filter(i => i >= 0);
  assert.equal(second.triggeredColorClear, partner);
  assert.equal(second.colorClearTarget, 4);
  assert.deepEqual(new Set(second.cleared), new Set([...majority, partner]));
  assert.equal(second.groupCount, 0);
  assert.equal(second.creations.size, 0);
  assert.equal(second.score, clearPoints(majority.length + 1, 2));
  assert.equal(pendingColorClear(second.board), -1);
});
