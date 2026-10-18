import test from "node:test";
import assert from "node:assert/strict";
import { createGame, refill, seededRandom, SIZE } from "../games/fuzzy-match-3/game.js";
import { planFalls } from "../games/fuzzy-match-3/falling.js";

function fixture() {
  return createGame(1, false, seededRandom(42)).board;
}

function motion(board) {
  const drops = [];
  const next = refill(board, seededRandom(7), (piece, from, to) =>
    drops.push({ id: piece.id, from, to }),
  );
  return { next, ...planFalls(drops) };
}

function position(path, tick) {
  const col = (index) => ((index % SIZE) + SIZE) % SIZE;
  const row = (index) => Math.floor(index / SIZE);
  const right = path.findIndex(frame => frame.tick >= tick);
  if (right <= 0) return { row: row(path[0].index), col: col(path[0].index) };
  const a = path[right - 1], b = path[right];
  const progress = (tick - a.tick) / (b.tick - a.tick);
  return {
    row: row(a.index) + (row(b.index) - row(a.index)) * progress,
    col: col(a.index) + (col(b.index) - col(a.index)) * progress,
  };
}

test("an adjacent falling column keeps one-cell spacing including newly entering piece", () => {
  for (const icy of [false, true]) {
    const board = fixture();
    if (icy) board[63].ice = 1;
    [43, 51, 59].forEach(index => { board[index] = null; });
    const { paths, steps } = motion(board);
    assert.equal(steps, 3);
    for (let tick = 0; tick <= steps; tick += 0.125) {
      const visible = [...paths.values()].map(path => position(path, tick))
        .filter(p => p.row > -1).sort((a, b) => a.row - b.row);
      for (let i = 1; i < visible.length; i++) {
        assert.equal(visible[i].col, 3);
        assert.ok(Math.abs(visible[i].row - visible[i - 1].row - 1) < 1e-9);
      }
    }
  }
});

test("a fully refilled column enters the top in order instead of starting overlapped", () => {
  const board = fixture();
  for (let i = 3; i < board.length; i += SIZE) board[i] = null;
  const { paths, steps, duration } = motion(board);
  assert.equal(steps, 8);
  assert.equal(duration, 320);
  const entryTicks = [...paths.values()].map(path =>
    path.find(frame => frame.index === 3).tick,
  );
  assert.deepEqual(entryTicks, [1, 2, 3, 4, 5, 6, 7, 8]);
  for (let tick = 0.25; tick <= steps; tick += 0.25) {
    const rows = [...paths.values()].map(path => position(path, tick).row)
      .filter(row => row > -1).sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++)
      assert.ok(Math.abs(rows[i] - rows[i - 1] - 1) < 1e-9);
  }
});

test("nonadjacent holes close without an upper piece overtaking a lower one", () => {
  const board = fixture();
  [19, 43].forEach(index => { board[index] = null; });
  const { next, paths, steps } = motion(board);
  for (let tick = 0; tick <= steps; tick += 0.125) {
    const rows = next.filter((piece, i) => i % SIZE === 3).map(piece =>
      paths.has(piece.id)
        ? position(paths.get(piece.id), tick).row
        : Math.floor(next.indexOf(piece) / SIZE),
    ).filter(row => row > -1).sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++)
      assert.ok(rows[i] - rows[i - 1] >= 1 - 1e-9);
  }
});

test("diagonal refill retains its route and never enters an occupied or frozen cell", () => {
  const board = fixture();
  board[19].ice = 1;
  [27, 35, 43].forEach(index => { board[index] = null; });
  assertMotion(board);
  const topIce = fixture();
  topIce[3].ice = 1;
  for (let i = 11; i < topIce.length; i += SIZE) topIce[i] = null;
  assertMotion(topIce);
  for (let seed = 1; seed <= 40; seed++) {
    const random = seededRandom(seed);
    const icy = createGame(1000 + seed, false, random).board;
    icy.forEach((piece, i) => {
      if (!piece.ice && random() < 0.35) icy[i] = null;
    });
    assertMotion(icy);
  }
});

function assertMotion(board) {
  const { next, paths, steps } = motion(board);
  const reachable = new Set();
  const queue = Array.from({ length: SIZE }, (_, i) => i).filter(i => !board[i]?.ice);
  for (const index of queue) {
    if (reachable.has(index)) continue;
    reachable.add(index);
    const col = index % SIZE;
    for (const delta of [-1, 0, 1]) {
      const target = index + SIZE + delta;
      if (target < board.length && col + delta >= 0 && col + delta < SIZE && !board[target]?.ice)
        queue.push(target);
    }
  }
  for (const [id, path] of paths) {
    assert.equal(path.at(-1).index, next.findIndex(piece => piece?.id === id));
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const rowDelta = Math.floor(b.index / SIZE) - Math.floor(a.index / SIZE);
      assert.ok(rowDelta === 0 || rowDelta === 1);
      if (rowDelta === 0) assert.equal(a.index, b.index);
      if (a.index >= 0 && a.index % SIZE !== b.index % SIZE)
        assert.ok(!reachable.has(b.index - SIZE), "diagonal paths wait for every replenishable cell above");
    }
  }
  for (let tick = 0; tick <= steps; tick++) {
    const occupied = new Set();
    for (let i = 0; i < next.length; i++) {
      const piece = next[i];
      if (!piece) continue;
      const p = paths.has(piece.id)
        ? position(paths.get(piece.id), tick)
        : { row: Math.floor(i / SIZE), col: i % SIZE };
      if (p.row < 0) continue;
      const index = p.row * SIZE + p.col;
      assert.equal(occupied.has(index), false, `overlap at tick ${tick}`);
      occupied.add(index);
      if (paths.has(piece.id)) assert.ok(!board[index]?.ice);
    }
  }
}
