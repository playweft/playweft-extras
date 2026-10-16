import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  generatePuzzle,
  generateLevel,
  solve,
  analyzeLogic,
  smallRegionClustering,
  proofQuality,
  lockedSetSpread,
  deductionSpread,
  findDeduction,
  findLocalPair,
  findLockedSet,
  remixRegions,
  seededRandom,
  createGame,
  move,
  markCells,
  undo,
  hint,
  conflicts,
  isComplete,
  restoreGame,
} from '../games/pupdoku/puzzle.js';

// Independent exhaustive permutation enumeration: no region masks and no
// adjacency pruning shared with the production counter.
function enumerate(regions, size) {
  const answers = [];
  function visit(columns, remaining) {
    if (columns.length === size) {
      if (
        columns.some((col, row) => row && Math.abs(col - columns[row - 1]) < 2)
      )
        return;
      if (
        new Set(columns.map((col, row) => regions[row * size + col])).size ===
        size
      )
        answers.push(columns);
      return;
    }
    for (const col of remaining)
      visit(
        [...columns, col],
        remaining.filter((value) => value !== col),
      );
  }
  visit(
    [],
    Array.from({ length: size }, (_, i) => i),
  );
  return answers;
}

function connected(puzzle) {
  const { regions, size } = puzzle;
  // Count rows and columns together, including the two arms of one L region.
  let pureLines = 0;
  for (let unit = 0; unit < size; unit++) {
    if (
      Array.from(
        { length: size },
        (_, col) => regions[unit * size + col],
      ).every((region) => region === regions[unit * size])
    )
      pureLines++;
    if (
      Array.from(
        { length: size },
        (_, row) => regions[row * size + unit],
      ).every((region) => region === regions[unit])
    )
      pureLines++;
  }
  assert.ok(
    pureLines <= 1,
    `found ${pureLines} pure rows/columns in ${size}x${size}, seed ${puzzle.seed}`,
  );
  const areas = Array.from(
    { length: size },
    (_, region) => regions.filter((value) => value === region).length,
  );
  assert.ok(areas.filter((area) => area <= 2).length <= Math.floor(size / 4));
  assert.ok(areas.filter((area) => area === 1).length <= 1);
  for (let region = 0; region < size; region++) {
    const group = regions.flatMap((value, index) =>
      value === region ? [index] : [],
    );
    assert.ok(group.length);
    assert.ok(group.length <= Math.ceil(size ** 2 / 4));
    const visited = new Set([group[0]]);
    for (const index of visited) {
      for (const other of group) {
        const distance =
          Math.abs(Math.floor(index / size) - Math.floor(other / size)) +
          Math.abs((index % size) - (other % size));
        if (distance === 1) visited.add(other);
      }
    }
    assert.equal(visited.size, group.length);
  }
}

const familyId = (index, family, puzzle) =>
  family === 'row'
    ? Math.floor(index / puzzle.size)
    : family === 'column'
      ? index % puzzle.size
      : puzzle.regions[index];
function incompatible(a, b, puzzle) {
  const n = puzzle.size,
    ar = Math.floor(a / n),
    ac = a % n,
    br = Math.floor(b / n),
    bc = b % n;
  return (
    ar === br ||
    ac === bc ||
    puzzle.regions[a] === puzzle.regions[b] ||
    (Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1)
  );
}

function verifyAdvancedStep(step, puzzle, candidates) {
  if (step.type === 'joint' || step.type === 'localPair') {
    const units = step.sourceIds.map((id) =>
      [...candidates].filter((i) => familyId(i, step.family, puzzle) === id),
    );
    assert.equal(units.length, 2);
    assert.notEqual(step.sourceIds[0], step.sourceIds[1]);
    if (step.type === 'localPair')
      assert.deepEqual(new Set(step.sources), new Set(units.flat()));
    else assert.deepEqual(step.sources, units.flat());
    const pairs = units[0].flatMap((a) =>
      units[1].filter((b) => !incompatible(a, b, puzzle)).map((b) => [a, b]),
    );
    assert.ok(pairs.length > 0);
    if (step.type === 'localPair')
      assert.deepEqual(
        step.combinations.map(JSON.stringify).sort(),
        pairs.map(JSON.stringify).sort(),
      );
    else
      assert.deepEqual(
        step.combinations,
        pairs,
        'every legal pair is part of the proof',
      );
    for (const i of step.removed)
      assert.ok(
        pairs.every(
          ([a, b]) =>
            i !== a &&
            i !== b &&
            (incompatible(a, i, puzzle) || incompatible(b, i, puzzle)),
        ),
      );
  } else {
    assert.equal(step.type, 'chain');
    assert.ok([3, 5].includes(step.links.length));
    assert.equal(new Set(step.sources).size, step.sources.length);
    assert.deepEqual(step.endpoints, [step.sources[0], step.sources.at(-1)]);
    for (let i = 0; i < step.links.length; i++) {
      const link = step.links[i];
      assert.equal(link.from, step.sources[i]);
      assert.equal(link.to, step.sources[i + 1]);
      assert.equal(link.kind, i % 2 ? 'weak' : 'strong');
      if (link.kind === 'strong')
        assert.deepEqual(
          new Set(
            [...candidates].filter(
              (c) => familyId(c, link.family, puzzle) === link.id,
            ),
          ),
          new Set([link.from, link.to]),
        );
      else assert.ok(incompatible(link.from, link.to, puzzle));
    }
    // Exhaust truth assignments to the proof vertices independently of BFS.
    for (let mask = 0; mask < 1 << step.sources.length; mask++) {
      const truth = (i) => Boolean(mask & (1 << i));
      if (
        step.links.every((link, i) =>
          link.kind === 'strong'
            ? truth(i) !== truth(i + 1)
            : !(truth(i) && truth(i + 1)),
        )
      )
        assert.ok(truth(0) || truth(step.sources.length - 1));
    }
    for (const i of step.removed)
      assert.ok(
        step.endpoints.every(
          (end) => i !== end && incompatible(end, i, puzzle),
        ),
      );
  }
}

// Exhaustively try smaller combinations with Sets, independently of the
// solver's subset masks and family ordering.
function hasSmallerLock(puzzle, candidates, placed, rank) {
  for (const from of ['row', 'column', 'region']) {
    const occupied = new Set([...placed].map((i) => familyId(i, from, puzzle)));
    const units = Array.from({ length: puzzle.size }, (_, i) => i).filter(
      (i) => !occupied.has(i),
    );
    for (const to of ['row', 'column', 'region']) {
      if (to === from) continue;
      function visit(chosen, start, count) {
        if (chosen.length < count) {
          for (let i = start; i <= units.length - (count - chosen.length); i++)
            if (visit([...chosen, units[i]], i + 1, count)) return true;
          return false;
        }
        const sources = [...candidates].filter((i) =>
          chosen.includes(familyId(i, from, puzzle)),
        );
        const targets = new Set(sources.map((i) => familyId(i, to, puzzle)));
        return (
          targets.size === count &&
          [...candidates].some(
            (i) =>
              !chosen.includes(familyId(i, from, puzzle)) &&
              targets.has(familyId(i, to, puzzle)),
          )
        );
      }
      for (let count = 2; count < rank; count++)
        if (visit([], 0, count)) return true;
    }
  }
  return false;
}

function localPairTargets(puzzle, candidates, placed = new Set()) {
  const n = puzzle.size,
    occupied = new Set([...placed].map((i) => puzzle.regions[i])),
    units = Array.from({ length: n }, (_, color) =>
      occupied.has(color)
        ? []
        : [...candidates].filter((i) => puzzle.regions[i] === color),
    ).filter((cells) => cells.length === 2),
    targets = new Set();
  for (let a = 0; a < units.length; a++)
    for (let b = a + 1; b < units.length; b++) {
      const pairs = [units[a], units[b]],
        vectors = pairs.map(([i, j]) => [
          Math.abs(Math.floor(i / n) - Math.floor(j / n)),
          Math.abs((i % n) - (j % n)),
        ]);
      if (
        vectors.some(([dr, dc]) => dr + dc !== 1) ||
        vectors[0].some((v, i) => v !== vectors[1][i])
      )
        continue;
      const cells = pairs.flat(),
        rows = cells.map((i) => Math.floor(i / n)),
        columns = cells.map((i) => i % n),
        top = Math.min(...rows),
        bottom = Math.max(...rows),
        left = Math.min(...columns),
        right = Math.max(...columns);
      let outside = [];
      if (bottom - top === 1 && right - left === 2)
        outside = [
          [top - 1, left + 1],
          [bottom + 1, left + 1],
        ];
      if (bottom - top === 2 && right - left === 1)
        outside = [
          [top + 1, left - 1],
          [top + 1, right + 1],
        ];
      for (const [r, c] of outside)
        if (r >= 0 && r < n && c >= 0 && c < n && candidates.has(r * n + c))
          targets.add(r * n + c);
    }
  return targets;
}

function verifyProof(puzzle, varied = true) {
  const analysis = analyzeLogic(puzzle.regions, puzzle.size);
  assert.equal(analysis.solved, true);
  assert.ok(analysis.deductions >= 2);
  assert.ok(
    analysis.steps.findIndex((step) => step.type !== 'single') <=
      Math.floor(puzzle.size / 4),
  );
  const answer = new Set(
    puzzle.solution.map((col, row) => row * puzzle.size + col),
  );
  const candidates = new Set(puzzle.regions.map((_, i) => i)),
    placed = new Set();
  let sameColorCommon = 0,
    localPair = 0,
    mixedColorCommon = 0,
    earlySubsets = 0,
    progressSubsets = 0,
    largestProgressSet = 0;
  const bottlenecks = new Set(),
    earlyBottlenecks = new Set(),
    progressPatterns = new Set();
  for (const step of analysis.steps) {
    if (step.type === 'single') {
      const unit = [...candidates].filter(
        (index) => familyId(index, step.family, puzzle) === step.id,
      );
      assert.deepEqual(
        unit,
        [step.index],
        'single must be the entire remaining unit',
      );
      assert.ok(answer.has(step.index));
      placed.add(step.index);
      for (const index of candidates)
        if (incompatible(index, step.index, puzzle)) candidates.delete(index);
    } else {
      const mixedColors =
        step.type === 'common' &&
        step.family !== 'region' &&
        new Set(step.sources.map((index) => puzzle.regions[index])).size > 1;
      if (
        placed.size >= 2 &&
        placed.size <= puzzle.size - 3 &&
        (mixedColors || step.type === 'subset')
      ) {
        progressPatterns.add(placed.size);
        if (step.type === 'subset') {
          progressSubsets++;
          largestProgressSet = Math.max(
            largestProgressSet,
            step.sourceIds.length,
          );
        }
      }
      if (step.type === 'common') {
        if (mixedColors) mixedColorCommon++;
        else sameColorCommon++;
      } else if (
        step.type === 'subset' &&
        placed.size <= Math.floor(puzzle.size / 2)
      )
        earlySubsets++;
      const intermediate =
        mixedColors || (step.type !== 'common' && step.type !== 'localPair');
      if (step.type === 'localPair') localPair++;
      if (intermediate) {
        bottlenecks.add(placed.size);
        if (placed.size <= Math.floor(puzzle.size / 2))
          earlyBottlenecks.add(placed.size);
      }
      // Independent replay: a harder step must occur at a real bottleneck,
      // never just because the solver chose it before an available basic step.
      if (mixedColors || step.type !== 'common') {
        for (const family of ['row', 'column', 'region']) {
          for (let id = 0; id < puzzle.size; id++) {
            if ([...placed].some((i) => familyId(i, family, puzzle) === id))
              continue;
            const sources = [...candidates].filter(
              (i) => familyId(i, family, puzzle) === id,
            );
            assert.ok(
              sources.length > 1,
              'no single before a harder deduction',
            );
            const basic =
              family === 'region' ||
              new Set(sources.map((i) => puzzle.regions[i])).size === 1;
            if (basic || (step.type !== 'common' && step.type !== 'localPair'))
              assert.ok(
                ![...candidates].some(
                  (i) =>
                    !sources.includes(i) &&
                    sources.every((source) => incompatible(source, i, puzzle)),
                ),
                'simpler common exclusions must be exhausted first',
              );
          }
        }
        if (intermediate)
          assert.equal(
            localPairTargets(puzzle, candidates, placed).size,
            0,
            'local adjacent-color pairs must be exhausted before intermediate deductions',
          );
      }
      assert.ok(step.removed.length);
      assert.ok(step.sources.every((index) => candidates.has(index)));
      if (step.type === 'common') {
        assert.deepEqual(
          step.sources,
          [...candidates].filter(
            (index) => familyId(index, step.family, puzzle) === step.id,
          ),
        );
        for (const index of step.removed)
          assert.ok(
            step.sources.every((source) => incompatible(source, index, puzzle)),
          );
      } else if (step.type === 'subset') {
        assert.equal(
          hasSmallerLock(puzzle, candidates, placed, step.sourceIds.length),
          false,
          'all directions must exhaust smaller locks before claiming a high rank',
        );
        assert.ok(
          step.sourceIds.length <= Math.floor((puzzle.size - placed.size) / 2),
          'count the smaller complementary set among remaining units',
        );
        const sources = [...candidates].filter((index) =>
          step.sourceIds.includes(familyId(index, step.sourceFamily, puzzle)),
        );
        assert.deepEqual(new Set(sources), new Set(step.sources));
        const targets = new Set(
          sources.map((index) => familyId(index, step.targetFamily, puzzle)),
        );
        assert.equal(targets.size, step.sourceIds.length);
        assert.deepEqual(targets, new Set(step.targetIds));
        for (const index of step.removed) {
          assert.ok(targets.has(familyId(index, step.targetFamily, puzzle)));
          assert.ok(
            !step.sourceIds.includes(
              familyId(index, step.sourceFamily, puzzle),
            ),
          );
        }
      }
      if (step.type === 'localPair')
        assert.ok(
          step.removed.every((i) =>
            localPairTargets(puzzle, candidates, placed).has(i),
          ),
        );
      if (['joint', 'chain', 'localPair'].includes(step.type))
        verifyAdvancedStep(step, puzzle, candidates);
      for (const index of step.removed) {
        assert.ok(candidates.has(index));
        assert.ok(
          !answer.has(index),
          'a deduction must never remove an answer',
        );
        candidates.delete(index);
      }
    }
  }
  assert.deepEqual(placed, answer);
  assert.equal(analysis.techniques.sameColorCommon, sameColorCommon);
  assert.equal(analysis.techniques.localPair, localPair);
  assert.equal(analysis.techniques.mixedColorCommon, mixedColorCommon);
  assert.equal(analysis.earlySubsets, earlySubsets);
  assert.equal(analysis.bottlenecks, bottlenecks.size);
  assert.equal(analysis.earlyBottlenecks, earlyBottlenecks.size);
  assert.equal(analysis.progressPatterns, progressPatterns.size);
  assert.equal(analysis.progressSubsets, progressSubsets);
  assert.equal(analysis.largestProgressSet, largestProgressSet);
  if (varied) {
    assert.ok(mixedColorCommon >= 2, 'need two mixed-color line deductions');
    assert.ok(
      earlyBottlenecks.size >= 2,
      'need two distinct bottlenecks in the first half',
    );
    assert.ok(
      analysis.techniques.subset +
        analysis.techniques.joint +
        analysis.techniques.chain >=
        1,
    );
  }
}

test('reference Level 668 has one solution and uses the smaller three-color lock', () => {
  // Transcribed from the reference image: A teal, B pink, C lime, D purple,
  // E orange, F blue, G yellow, H dark green, I light blue, J brown.
  const rows = [
    'AAAJJJJJJG',
    'ABJJJJJIIG',
    'CBBCJJJIIG',
    'CCCCJJJIIG',
    'CCCDDJJJGG',
    'CEEDJJJJGG',
    'FEEJJJGJJG',
    'FEEEJJGGGG',
    'FFFFFFGGGH',
    'FFFFFFFGGH',
  ];
  const regions = [...rows.join('')].map((color) => color.charCodeAt(0) - 65);
  const solution = [2, 8, 3, 1, 5, 9, 6, 4, 10, 7].map((column) => column - 1);
  assert.deepEqual(solve(regions, 10), [solution]);
  verifyProof({ regions, size: 10, solution }, false);
  const analysis = analyzeLogic(regions, 10);
  assert.ok(
    analysis.steps.some(
      (step) =>
        step.type === 'subset' &&
        step.sourceFamily === 'region' &&
        step.targetFamily === 'column' &&
        JSON.stringify(step.sourceIds) === JSON.stringify([0, 1, 2]) &&
        JSON.stringify([...step.targetIds].sort((a, b) => a - b)) ===
          JSON.stringify([0, 1, 2]),
    ),
  );
});

test('generation scoring rewards higher effective ranks more than repeating pairs', () => {
  const analysis = {
    solved: true,
    earlyBottlenecks: 2,
    techniques: {
      mixedColorCommon: 2,
      subset: 1,
      joint: 0,
      chain: 0,
      largestSet: 2,
    },
    progressPatterns: 1,
    progressSubsets: 1,
    largestProgressSet: 2,
    monochromeLines: 0,
    smallRegionClustering: 0,
    spreadSetScore: 0,
  };
  const scores = [2, 3, 4, 5, 6].map((rank) =>
    proofQuality({
      ...analysis,
      techniques: { ...analysis.techniques, largestSet: rank },
    }),
  );
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] > scores[i - 1]);
    if (i > 1)
      assert.ok(scores[i] - scores[i - 1] > scores[i - 1] - scores[i - 2]);
  }
  assert.ok(
    scores[1] >
      proofQuality({
        ...analysis,
        progressPatterns: 2,
        progressSubsets: 20,
        spreadSetScore: 2,
        spatialScores: { mixedColorCommon: 1, subset: 1, joint: 1 },
        techniques: { ...analysis.techniques, subset: 20 },
      }),
  );
  assert.ok(
    proofQuality({
      ...analysis,
      largestProgressSet: 3,
      techniques: { ...analysis.techniques, largestSet: 3 },
    }) > scores[1],
  );
  assert.ok(
    proofQuality({
      ...analysis,
      monochromeLines: 1,
      smallRegionClustering: 1,
    }) > proofQuality({ ...analysis, solved: false }),
    'a valid negative score still beats an unsolved candidate',
  );
});

test('spatial bonuses are capped per technique and do not reward repeated eliminations', () => {
  const analysis = analyzeLogic(
    JSON.parse(
      readFileSync(
        new URL('./fixtures/pupdoku-neighbor-regression.json', import.meta.url),
        'utf8',
      ),
    ).regions,
    10,
  );
  const base = proofQuality({ ...analysis, spatialScores: {} });
  assert.equal(
    proofQuality({
      ...analysis,
      spatialScores: { mixedColorCommon: 1, subset: 1, joint: 1 },
    }) - base,
    6,
  );
  assert.equal(
    proofQuality({ ...analysis, spatialScores: {}, spreadSetScore: 1000 }) -
      base,
    0,
  );
});

test('lock spread covers both geometric axes, inverse forms and board symmetries', () => {
  const step = {
    type: 'subset',
    sourceFamily: 'row',
    targetFamily: 'region',
    sourceIds: [1, 2, 3],
    targetIds: [0, 1, 2],
  };
  assert.equal(lockedSetSpread(step), 0);
  const apart = { ...step, sourceIds: [1, 3, 5] },
    spread = lockedSetSpread(apart);
  assert.ok(spread > 0);
  assert.ok(
    lockedSetSpread({ ...step, sourceIds: [1, 2, 5] }) < spread,
    'one large gap should not hide a tightly packed pair',
  );
  assert.ok(lockedSetSpread({ ...step, sourceIds: [0, 3, 6] }) > spread);
  assert.equal(lockedSetSpread({ ...apart, sourceFamily: 'column' }), spread);
  assert.equal(
    lockedSetSpread({
      ...apart,
      sourceFamily: 'region',
      targetFamily: 'column',
      sourceIds: apart.targetIds,
      targetIds: apart.sourceIds,
    }),
    spread,
  );
  assert.equal(
    lockedSetSpread({
      ...apart,
      sourceFamily: 'region',
      targetFamily: 'row',
      sourceIds: apart.targetIds,
      targetIds: [...apart.sourceIds].reverse(),
    }),
    spread,
  );
  assert.equal(
    lockedSetSpread({ ...apart, targetFamily: 'column' }),
    spread / 2,
    'row-column locks include both axes instead of treating color IDs as positions',
  );
  assert.equal(
    lockedSetSpread({ ...apart, targetFamily: 'column', targetIds: [0, 2, 4] }),
    spread,
  );
});

test('spatial credit follows required cells, ignores color numbering and excludes basic rules and bounded chains', () => {
  const size = 8,
    regions = Array(size ** 2).fill(0);
  regions[3] = 1;
  const common = { type: 'common', family: 'row', sources: [0, 3] };
  assert.ok(deductionSpread(common, size, regions) > 0);
  assert.equal(
    deductionSpread({ ...common, sources: [2, 3] }, size, regions),
    0,
  );
  assert.equal(
    deductionSpread({ ...common, sources: [0, 2] }, size, regions),
    0,
  );
  assert.equal(deductionSpread({ type: 'single', index: 0 }, size, regions), 0);
  assert.equal(
    deductionSpread({ type: 'chain', sources: [0, 63] }, size, regions),
    0,
  );
  const joint = {
    type: 'joint',
    family: 'region',
    sourceIds: [0, 7],
    sources: [0, 1, 48, 49],
  };
  assert.ok(deductionSpread(joint, size) > 0);
  assert.equal(
    deductionSpread(joint, size),
    deductionSpread({ ...joint, sourceIds: [2, 3] }, size),
  );
  assert.equal(deductionSpread({ ...joint, sources: [0, 1, 8, 9] }, size), 0);
  const lock = {
    type: 'subset',
    sourceFamily: 'row',
    targetFamily: 'region',
    sourceIds: [0, 1],
    targetIds: [3, 7],
    sources: [0, 3, 8, 11],
  };
  assert.equal(lockedSetSpread(lock), 0);
  assert.ok(
    lockedSetSpread(lock, size) > 0,
    'separated candidate groups still require visual tracking',
  );
});

test('compact same-technique bypasses run first even when they eliminate different cells', () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL('./fixtures/pupdoku-spatial-deductions.json', import.meta.url),
      'utf8',
    ),
  );
  // Independent zero-spread check: contiguous line coordinates and an
  // eight-neighbor flood fill, rather than the production spanning-tree score.
  const contiguous = (values) => {
    const unique = new Set(values);
    return Math.max(...unique) - Math.min(...unique) + 1 === unique.size;
  };
  function compact(step, puzzle) {
    const n = puzzle.size;
    if (step.type === 'common')
      return contiguous(
        step.sources.map((i) =>
          step.family === 'row' ? i % n : Math.floor(i / n),
        ),
      );
    if (step.type === 'subset') {
      if (step.sourceFamily !== 'region' && !contiguous(step.sourceIds))
        return false;
      if (step.targetFamily !== 'region' && !contiguous(step.targetIds))
        return false;
    } else if (step.family !== 'region' && !contiguous(step.sourceIds))
      return false;
    const seen = new Set([step.sources[0]]);
    for (const a of seen)
      for (const b of step.sources)
        if (
          Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1 &&
          Math.abs((a % n) - (b % n)) <= 1
        )
          seen.add(b);
    return seen.size === step.sources.length;
  }
  for (const {
    puzzle,
    candidates,
    placed,
    nonlocalStep,
    compactStep,
  } of fixtures) {
    assert.ok(deductionSpread(nonlocalStep, puzzle.size, puzzle.regions) > 0);
    assert.ok(
      nonlocalStep.removed.every((i) => !compactStep.removed.includes(i)),
      'a bypass need not have the same immediate conclusion',
    );
    for (let symmetry = 0; symmetry < 8; symmetry++) {
      const map = (i) => {
        let r = Math.floor(i / puzzle.size),
          c = i % puzzle.size;
        if (symmetry & 1) [r, c] = [c, r];
        if (symmetry & 2) r = puzzle.size - 1 - r;
        if (symmetry & 4) c = puzzle.size - 1 - c;
        return r * puzzle.size + c;
      };
      const regions = Array(puzzle.regions.length);
      puzzle.regions.forEach((color, i) => {
        regions[map(i)] = (color + 3) % puzzle.size;
      });
      const transformed = { ...puzzle, regions },
        c = new Set(candidates.map(map)),
        p = new Set(placed.map(map)),
        step = findDeduction(regions, puzzle.size, c, p);
      assert.equal(step.type, nonlocalStep.type);
      if (step.type === 'subset')
        assert.equal(step.sourceIds.length, nonlocalStep.sourceIds.length);
      assert.ok(compact(step, transformed));
      assert.equal(deductionSpread(step, puzzle.size, regions), 0);
      if (step.type === 'joint') verifyAdvancedStep(step, transformed, c);
      else if (step.type === 'common') {
        assert.deepEqual(
          step.sources,
          [...c].filter(
            (i) => familyId(i, step.family, transformed) === step.id,
          ),
        );
        assert.ok(
          step.removed.every((i) =>
            step.sources.every((s) => incompatible(s, i, transformed)),
          ),
        );
      } else {
        const sourceSet = new Set(step.sourceIds),
          targets = new Set(step.targetIds);
        const sources = [...c].filter((i) =>
          sourceSet.has(familyId(i, step.sourceFamily, transformed)),
        );
        assert.deepEqual(new Set(sources), new Set(step.sources));
        assert.equal(targets.size, sourceSet.size);
        assert.ok(
          sources.every((i) =>
            targets.has(familyId(i, step.targetFamily, transformed)),
          ),
        );
        assert.ok(
          step.removed.every(
            (i) =>
              !sourceSet.has(familyId(i, step.sourceFamily, transformed)) &&
              targets.has(familyId(i, step.targetFamily, transformed)),
          ),
        );
      }
    }
  }
});

test('small-region clustering prefers dispersed layouts and respects board symmetries', () => {
  const size = 8;
  function layout(origins) {
    const regions = Array(size ** 2).fill(4);
    origins.forEach(([row, column], color) => {
      for (let r = row; r < row + 2; r++)
        for (let c = column; c < column + 2; c++) regions[r * size + c] = color;
    });
    return regions;
  }
  const clustered = layout([
      [0, 0],
      [0, 2],
      [2, 0],
      [2, 2],
    ]),
    spread = layout([
      [0, 0],
      [0, 6],
      [6, 0],
      [6, 6],
    ]),
    penalty = smallRegionClustering(clustered, size);
  assert.ok(penalty > 0 && penalty < 1);
  assert.equal(smallRegionClustering(spread, size), 0);
  for (let seed = 0; seed < 16; seed++)
    assert.ok(
      Math.abs(
        smallRegionClustering(
          remixRegions(clustered, size, seededRandom(seed)),
          size,
        ) - penalty,
      ) < 1e-12,
    );
  const equalAreas = Array.from({ length: size ** 2 }, (_, i) =>
    Math.floor(i / size),
  );
  assert.equal(smallRegionClustering(equalAreas, size), 0);
  const oneSmall = Array(size ** 2).fill(0);
  oneSmall[0] = 1;
  assert.equal(
    smallRegionClustering(oneSmall, size),
    0,
    'one small region is not a cluster',
  );
});

test('generated puzzles have at most one pure row/column, bounded connected regions and a unique no-guess answer', () => {
  let pure = 0,
    higherLocks = 0,
    progress = 0,
    centralMinimum = 0,
    edgeMinimum = 0,
    thickMaximum = 0;
  for (const size of [8, 9, 10, 11, 12]) {
    const distinct = new Set();
    const count = size >= 10 ? 10 : 30;
    for (let seed = 0; seed < count; seed++) {
      const puzzle = generatePuzzle(size, seed);
      connected(puzzle);
      assert.deepEqual(solve(puzzle.regions, size), [puzzle.solution]);
      verifyProof(puzzle);
      const analysis = analyzeLogic(puzzle.regions, size);
      // Board sizes are equally likely in play. Extra small-board proof cases
      // must not overweight them in the distribution regression.
      pure += Number(analysis.monochromeLines > 0) / count;
      higherLocks += Number(analysis.techniques.largestSet >= 3) / count;
      progress += Number(analysis.progressPatterns > 0) / count;
      const groups = Array.from({ length: size }, (_, region) =>
          puzzle.regions.flatMap((value, index) =>
            value === region ? [index] : [],
          ),
        ),
        minimum = Math.min(...groups.map((cells) => cells.length)),
        maximum = Math.max(...groups.map((cells) => cells.length)),
        minima = groups.filter((cells) => cells.length === minimum);
      // Average ties instead of favoring a color ID. These deliberately broad
      // sample guards catch the nested-core bias without forcing every board
      // into a prescribed layout or claiming uniform partition sampling.
      for (const cells of minima) {
        const row =
            cells.reduce((sum, i) => sum + Math.floor(i / size), 0) /
            cells.length,
          column = cells.reduce((sum, i) => sum + (i % size), 0) / cells.length;
        centralMinimum +=
          Number(
            Math.abs(row - (size - 1) / 2) <= size / 4 &&
              Math.abs(column - (size - 1) / 2) <= size / 4,
          ) /
          (minima.length * count);
        edgeMinimum +=
          Number(
            cells.some(
              (i) =>
                Math.floor(i / size) === 0 ||
                Math.floor(i / size) === size - 1 ||
                i % size === 0 ||
                i % size === size - 1,
            ),
          ) /
          (minima.length * count);
      }
      thickMaximum +=
        Number(
          groups.some(
            (cells) =>
              cells.length === maximum &&
              cells.some(
                (i) =>
                  i % size < size - 1 &&
                  Math.floor(i / size) < size - 1 &&
                  [i + 1, i + size, i + size + 1].every((peer) =>
                    cells.includes(peer),
                  ),
              ),
          ),
        ) / count;
      distinct.add(JSON.stringify(puzzle.regions));
      if (size <= 9 && seed < 2)
        assert.deepEqual(enumerate(puzzle.regions, size), [puzzle.solution]);
    }
    assert.equal(
      distinct.size,
      count,
      'normal generation should create new partitions',
    );
  }
  // Distribution regression over fixed seeds, not new per-puzzle requirements.
  assert.ok(
    pure / 5 < 0.7,
    'pure lines must remain occasional rather than dominant',
  );
  assert.ok(
    centralMinimum / 5 > 0.05 && centralMinimum / 5 < 0.6,
    'smallest regions must not concentrate in the central quarter',
  );
  assert.ok(
    edgeMinimum / 5 > 0.2 && edgeMinimum / 5 < 0.9,
    'removing central bias must not force every smallest region onto the edge',
  );
  assert.ok(
    thickMaximum / 5 > 0.8,
    'largest regions should usually contain a complete 2x2 block',
  );
  assert.ok(higherLocks / 5 >= 0.15, 'retain genuine three-or-more-unit locks');
  assert.ok(
    // Local pairs now close some formerly "mixed-color intermediate" steps.
    // Keep a majority guard on genuine intermediate patterns, without counting
    // the newly elementary pattern as an intermediate just to retain the rate.
    progress / 5 >= 0.7,
    'most boards should still need an intermediate pattern during play',
  );
});

test('procedural generation is reproducible and safe symmetries preserve every invariant', () => {
  for (const size of [8, 9, 10, 11, 12]) {
    assert.deepEqual(generatePuzzle(size, 2026), generatePuzzle(size, 2026));
    for (let seed = 0; seed < 16; seed++) {
      const puzzle = generatePuzzle(size, seed);
      assert.ok(puzzle);
      connected(puzzle);
      verifyProof(puzzle);
      const regions = remixRegions(puzzle.regions, size, seededRandom(seed));
      assert.equal(solve(regions, size).length, 1);
      connected({ regions, size });
    }
  }
  assert.throws(() => generatePuzzle(6));
});

test('legacy saved reference boards retain a unique logical proof', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/pupdoku-neighbor-regression.json', import.meta.url),
      'utf8',
    ),
  );
  const solutions = solve(fixture.regions, fixture.size);
  assert.equal(solutions.length, 1);
  verifyProof({ ...fixture, solution: solutions[0] }, false);
});

test('joint pairs and five-link chains have checkable proofs and preserve every exhaustive completion', () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL('./fixtures/pupdoku-advanced-deductions.json', import.meta.url),
      'utf8',
    ),
  );
  for (const {
    puzzle,
    candidates: indices,
    placed: occupied,
    expectedType,
  } of fixtures) {
    const candidates = new Set(indices),
      placed = new Set(occupied);
    const step = findDeduction(puzzle.regions, puzzle.size, candidates, placed);
    assert.equal(
      step.type,
      expectedType,
      'new techniques are reached only after simpler rules stall',
    );
    verifyAdvancedStep(step, puzzle, candidates);
    const completions = enumerate(puzzle.regions, puzzle.size).filter(
      (answer) =>
        answer.every(
          (c, r) =>
            candidates.has(r * puzzle.size + c) ||
            placed.has(r * puzzle.size + c),
        ) &&
        [...placed].every(
          (i) => answer[Math.floor(i / puzzle.size)] === i % puzzle.size,
        ),
    );
    assert.ok(completions.length > 0);
    for (const answer of completions)
      for (const i of step.removed)
        assert.notEqual(answer[Math.floor(i / puzzle.size)], i % puzzle.size);
    assert.deepEqual([...candidates], indices);
    assert.deepEqual([...placed], occupied);
    assert.deepEqual(
      findDeduction(puzzle.regions, puzzle.size, candidates, placed),
      step,
    );
    const game = createGame(puzzle);
    game.cells = puzzle.regions.map((_, i) =>
      placed.has(i) ? 2 : candidates.has(i) ? 0 : 1,
    );
    const before = [...game.cells],
      result = hint(game);
    assert.equal(result.kind, 'exclude');
    assert.deepEqual(result.step, step);
    assert.ok(step.removed.every((i) => game.cells[i] === 1));
    assert.equal(undo(game), true);
    assert.deepEqual(game.cells, before);
  }
});

test('quality filtering handles a long-retry seed without returning an easier puzzle', () => {
  const puzzle = generatePuzzle(8, 32);
  connected(puzzle);
  assert.deepEqual(solve(puzzle.regions, puzzle.size), [puzzle.solution]);
  verifyProof(puzzle);
  assert.deepEqual(generatePuzzle(8, 32), puzzle);
});

test('color order does not encode the answer row', () => {
  const orders = new Set();
  for (let seed = 0; seed < 20; seed++) {
    const p = generatePuzzle(8, seed);
    orders.add(
      p.solution.map((col, row) => p.regions[row * p.size + col]).join(','),
    );
  }
  assert.ok(orders.size > 15);
});

test('adjacent color pairs exclude the two exterior middle cells in every orientation', () => {
  const size = 6,
    regions = Array.from({ length: size ** 2 }, (_, i) => 2 + (i % 4));
  for (const i of [13, 19]) regions[i] = 0;
  for (const i of [15, 21]) regions[i] = 1;
  const solution = [2, 5, 1, 3, 0, 4];
  let color = 2;
  solution.forEach((c, r) => {
    if (r !== 2 && r !== 3) regions[r * size + c] = color++;
  });
  for (let symmetry = 0; symmetry < 8; symmetry++) {
    const map = (i) => {
      let r = Math.floor(i / size),
        c = i % size;
      if (symmetry & 1) [r, c] = [c, r];
      if (symmetry & 2) r = size - 1 - r;
      if (symmetry & 4) c = size - 1 - c;
      return r * size + c;
    };
    const transformed = Array(regions.length);
    regions.forEach((v, i) => {
      transformed[map(i)] = (v + 2) % size;
    });
    const candidates = new Set(regions.map((_, i) => map(i)).reverse()),
      puzzle = { size, regions: transformed },
      step = findLocalPair(transformed, size, candidates);
    assert.equal(step.type, 'localPair');
    assert.deepEqual(new Set(step.removed), new Set([8, 26].map(map)));
    assert.deepEqual(
      new Set(step.removed),
      localPairTargets(puzzle, candidates),
    );
    verifyAdvancedStep(step, puzzle, candidates);
    assert.equal(deductionSpread(step, size, transformed), 0);
    const answers = enumerate(transformed, size);
    assert.ok(answers.length > 0);
    assert.ok(
      answers.every((cols) =>
        step.removed.every((i) => cols[Math.floor(i / size)] !== i % size),
      ),
    );
  }
  const candidates = new Set(regions.map((_, i) => i));
  const extra = [...regions];
  extra[35] = 0;
  assert.equal(
    findLocalPair(extra, size, candidates),
    null,
    'a third color candidate invalidates the exact-two premise',
  );
  const same = regions.map((v) => (v === 1 ? 0 : v));
  assert.equal(findLocalPair(same, size, candidates), null);
  assert.equal(findLocalPair(regions, size, candidates, new Set([13])), null);
  candidates.delete(8);
  assert.deepEqual(findLocalPair(regions, size, candidates).removed, [26]);
  candidates.delete(26);
  assert.equal(findLocalPair(regions, size, candidates), null);
  const edge = Array.from({ length: 36 }, (_, i) => 2 + (i % 4));
  for (const i of [0, 6]) edge[i] = 0;
  for (const i of [2, 8]) edge[i] = 1;
  assert.deepEqual(
    findLocalPair(edge, size, new Set(edge.map((_, i) => i))).removed,
    [13],
  );
  edge[2] = edge[8] = 2;
  edge[3] = edge[9] = 1;
  assert.equal(
    findLocalPair(edge, size, new Set(edge.map((_, i) => i))),
    null,
    'the pairs must be separated by exactly one line',
  );
});

test('local adjacent pairs precede mixed-color deductions and get only a capped diversity bonus', () => {
  const fixture = JSON.parse(
      readFileSync(
        new URL('./fixtures/pupdoku-local-pair.json', import.meta.url),
        'utf8',
      ),
    ),
    { puzzle } = fixture,
    candidates = new Set(fixture.candidates),
    placed = new Set(fixture.placed),
    step = findDeduction(puzzle.regions, puzzle.size, candidates, placed);
  assert.equal(step.type, 'localPair');
  assert.deepEqual(step.removed, fixture.expectedTargets);
  verifyAdvancedStep(step, puzzle, candidates);
  const analysis = analyzeLogic(puzzle.regions, puzzle.size);
  assert.ok(analysis.techniques.localPair > 0);
  assert.equal(
    proofQuality({
      ...analysis,
      techniques: { ...analysis.techniques, localPair: 100 },
    }),
    proofQuality(analysis),
  );
  assert.equal(
    proofQuality(analysis) -
      proofQuality({
        ...analysis,
        techniques: { ...analysis.techniques, localPair: 0 },
      }),
    0.25,
  );
  verifyProof(puzzle, false);
});

test('two rows locked to two colors exclude those colors outside the rows', () => {
  const size = 5;
  const regions = [
    0, 4, 1, 4, 0, 4, 0, 4, 1, 4, 0, 1, 2, 3, 4, 2, 3, 2, 3, 4, 2, 3, 2, 3, 4,
  ];
  const candidates = new Set([
    0,
    2,
    4,
    6,
    8,
    ...Array.from({ length: 15 }, (_, i) => i + 10),
  ]);
  const step = findLockedSet(regions, size, candidates);
  assert.equal(step.sourceFamily, 'row');
  assert.equal(step.targetFamily, 'region');
  assert.deepEqual(step.sourceIds, [0, 1]);
  assert.deepEqual(step.targetIds, [0, 1]);
  assert.deepEqual(step.removed, [10, 11]);
});

test('row-column pairs (X-wing) and complementary hidden color sets are handled', () => {
  const regions = Array.from({ length: 25 }, (_, index) => index % 5);
  const candidates = new Set([
    0,
    1,
    5,
    6,
    ...Array.from({ length: 15 }, (_, i) => i + 10),
  ]);
  const step = findLockedSet(regions, 5, candidates);
  assert.equal(step.sourceFamily, 'row');
  assert.equal(step.targetFamily, 'column');
  assert.deepEqual(step.removed, [10, 11, 15, 16, 20, 21]);
  // Colors 0 and 1 confined to rows 0 and 1 reserve those rows; the inverse
  // complementary row set is equally valid and must remove the other colors.
  const hidden = new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 17, 18, 19, 22, 23, 24,
  ]);
  const reverse = findLockedSet(regions, 5, hidden);
  assert.deepEqual(reverse.removed, [2, 3, 4, 7, 8, 9]);
});

test('public neighbors of all candidates in a row are excluded without a placed dog', () => {
  const regions = Array.from({ length: 25 }, (_, index) => index % 5);
  const candidates = new Set([
    0, 1, 2, 3, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    24,
  ]);
  const step = findDeduction(regions, 5, candidates);
  assert.equal(step.type, 'common');
  assert.deepEqual(step.sources, [6, 8]);
  assert.ok(step.removed.includes(2));
  assert.ok(step.removed.includes(12));
  assert.ok(!step.removed.includes(24));
});

test('same-color common exclusions take priority over an available mixed-color line deduction', () => {
  const regions = Array.from({ length: 25 }, (_, index) => index % 5);
  regions[6] = regions[8] = 0;
  const candidates = new Set([
    0,
    2,
    6,
    8,
    ...Array.from({ length: 15 }, (_, index) => index + 10),
  ]);
  // Row 0 has two colors and can remove 6 through mixed common conflicts.
  // Row 1 has one color and is the simpler explanation, despite coming later.
  assert.ok(
    [0, 2].every((source) => incompatible(source, 6, { regions, size: 5 })),
  );
  const step = findDeduction(regions, 5, candidates);
  assert.equal(step.type, 'common');
  assert.equal(step.family, 'row');
  assert.equal(step.id, 1);
  assert.deepEqual(step.sources, [6, 8]);
  assert.ok(step.removed.includes(0));
});

test('a four-of-six lock is reported as its complementary pair across all directions', () => {
  const size = 8,
    regions = Array.from({ length: size ** 2 }, (_, i) => i % size),
    placed = new Set([50, 62]),
    candidates = new Set();
  for (let row = 0; row < 6; row++) {
    const columns =
      row < 4 ? [0, 1, 3, 4] : row === 4 ? [0, 1, 3, 4, 5, 7] : [0, 4, 5, 7];
    for (const column of columns) candidates.add(row * size + column);
  }
  const step = findLockedSet(regions, size, candidates, placed);
  assert.ok(['column', 'region'].includes(step.sourceFamily));
  assert.equal(step.targetFamily, 'row');
  assert.deepEqual(step.sourceIds, [5, 7]);
  assert.deepEqual(step.targetIds, [4, 5]);
  assert.deepEqual(step.removed, [32, 33, 35, 36, 40, 44]);
  const answer = [1, 3, 0, 4, 7, 5, 2, 6].map((col, row) => row * size + col);
  assert.ok(step.removed.every((i) => !answer.includes(i)));
});

test('locked sets of three through six units work when no smaller pair can be found', () => {
  for (const [size, count] of [
    [8, 3],
    [9, 4],
    [10, 5],
    [12, 6],
  ]) {
    const regions = Array.from(
      { length: size ** 2 },
      (_, index) => index % size,
    );
    const columns = Array.from({ length: count }, (_, i) => i * 2);
    const candidates = new Set(
      regions.flatMap((_, index) =>
        Math.floor(index / size) >= count || columns.includes(index % size)
          ? [index]
          : [],
      ),
    );
    const step = findLockedSet(regions, size, candidates);
    assert.equal(step.sourceFamily, 'row');
    assert.ok(['column', 'region'].includes(step.targetFamily));
    assert.equal(step.sourceIds.length, count);
    assert.deepEqual(step.targetIds, columns);
    assert.equal(step.removed.length, (size - count) * count);
  }
});

test('conflicts distinguish row, column, region and touching; long diagonals are allowed', () => {
  const puzzle = {
    size: 5,
    regions: Array.from({ length: 25 }, (_, index) => index % 5),
  };
  const cells = Array(25).fill(0);
  cells[0] = 2;
  assert.ok(conflicts(puzzle, cells, 3).includes('row'));
  assert.ok(conflicts(puzzle, cells, 15).includes('column'));
  assert.ok(conflicts(puzzle, cells, 6).includes('touch'));
  assert.deepEqual(
    conflicts(puzzle, cells, 12),
    [],
    'not a chess queen: a long diagonal is legal',
  );
  puzzle.regions[12] = 0;
  assert.deepEqual(conflicts(puzzle, cells, 12), ['region']);
});

test('marks, whole strokes, undo and mistakes preserve life accounting', () => {
  const game = createGame(generatePuzzle(8, 42));
  const dog = game.puzzle.solution[0],
    wrong = (dog + 1) % 8;
  assert.equal(move(game, -1, 'dog').changed, false);
  assert.equal(move(game, 0, 'unknown').changed, false);
  move(game, dog, 'mark');
  assert.equal(game.cells[dog], 1);
  move(game, dog, 'mark');
  assert.equal(game.cells[dog], 0);
  undo(game);
  assert.equal(game.cells[dog], 1);
  move(game, dog, 'dog');
  assert.equal(game.cells[dog], 2);
  assert.equal(
    move(game, dog, 'mark').changed,
    false,
    'single marks never replace a pup',
  );
  const placed = structuredClone(game);
  for (const tool of ['dog', 'erase']) {
    assert.deepEqual(move(game, dog, tool), { changed: false });
    assert.deepEqual(game, placed, 'only undo may remove an existing pup');
  }
  const history = game.history.length;
  assert.ok(markCells(game, [dog, wrong, wrong, 8, 9], 1));
  assert.equal(
    game.history.length,
    history + 1,
    'one drag is one history entry',
  );
  assert.equal(game.cells[dog], 2);
  undo(game);
  assert.equal(game.cells[wrong], 0);
  assert.equal(game.cells[dog], 2);
  assert.ok(move(game, wrong, 'dog').errors);
  assert.equal(game.hearts, 2);
  assert.equal(game.cells[wrong], 3);
  undo(game);
  assert.equal(game.hearts, 2, 'undo must not refund mistakes');
  move(game, wrong, 'dog');
  move(game, wrong, 'dog');
  assert.equal(game.hearts, 0);
  assert.equal(move(game, dog, 'erase').changed, false);
  assert.equal(markCells(game, [0, 1], 1), false);
  assert.equal(undo(game), false);
  assert.equal(hint(game), null);
});

test('hints first mark every empty row, column, color and adjacent peer of existing pups as one reversible action', () => {
  const board = generatePuzzle(8, 7),
    game = createGame(board),
    pups = [0, 3].map((row) => row * board.size + board.solution[row]),
    sharesUnit = (i, pup) =>
      Math.floor(i / board.size) === Math.floor(pup / board.size) ||
      i % board.size === pup % board.size ||
      board.regions[i] === board.regions[pup];
  pups.forEach((i) => move(game, i, 'dog'));
  const peers = game.cells.flatMap((value, i) =>
    value === 0 &&
    pups.some(
      (pup) =>
        sharesUnit(i, pup) ||
        (Math.abs(Math.floor(i / board.size) - Math.floor(pup / board.size)) <=
          1 &&
          Math.abs((i % board.size) - (pup % board.size)) <= 1),
    )
      ? [i]
      : [],
  );
  game.cells[peers[0]] = 1;
  game.cells[peers[1]] = 3;
  const before = [...game.cells],
    history = game.history.length,
    expected = peers.filter((i) => before[i] === 0),
    result = hint(game);
  assert.equal(result.kind, 'exclude');
  assert.equal(result.step.type, 'placed');
  assert.deepEqual(result.step.removed, expected);
  assert.deepEqual(result.step.sources, pups);
  assert.deepEqual(
    game.cells,
    before.map((value, i) => (expected.includes(i) ? 1 : value)),
  );
  assert.equal(game.history.length, history + 1);
  assert.equal(game.hints, 1);
  assert.equal(game.hearts, 3);
  assert.equal(game.cells[peers[1]], 3, 'red notes remain red');
  const answer = new Set(
    board.solution.map((col, row) => row * board.size + col),
  );
  assert.ok(expected.every((i) => !answer.has(i)));
  const diagonalOnly = before.flatMap((value, i) =>
    value === 0 &&
    !pups.some((pup) => sharesUnit(i, pup)) &&
    pups.some(
      (pup) =>
        Math.abs(Math.floor(i / board.size) - Math.floor(pup / board.size)) ===
          1 && Math.abs((i % board.size) - (pup % board.size)) === 1,
    )
      ? [i]
      : [],
  );
  assert.ok(diagonalOnly.length > 0, 'fixture has a diagonal-only conflict');
  assert.ok(
    diagonalOnly.every((i) => game.cells[i] === 1),
    'diagonal neighbors must be marked even across color boundaries',
  );
  undo(game);
  assert.deepEqual(game.cells, before);
  assert.equal(game.hearts, 3);
});

test('hint priority is wrong-note correction, visible singles, then peer marks, with one operation per call', () => {
  const board = generatePuzzle(8, 7),
    size = board.size;
  for (const family of ['row', 'column', 'region']) {
    const game = createGame(board),
      region = Array.from({ length: size }, (_, id) => id).find(
        (id) => board.regions.filter((value) => value === id).length === 2,
      ),
      row =
        family === 'region'
          ? board.solution.findIndex(
              (col, r) => board.regions[r * size + col] === region,
            )
          : 1,
      target = row * size + board.solution[row],
      pupRow = row === 0 ? 1 : 0,
      pup = pupRow * size + board.solution[pupRow];
    move(game, pup, 'dog');
    game.cells.forEach((_, i) => {
      if (
        family === 'row'
          ? Math.floor(i / size) === row
          : family === 'column'
            ? i % size === target % size
            : board.regions[i] === region
      )
        game.cells[i] = 1;
    });
    const before = [...game.cells],
      history = game.history.length;
    assert.equal(hint(game).kind, 'unmark');
    const corrected = [...before];
    corrected[target] = 0;
    assert.deepEqual(
      game.cells,
      corrected,
      'correction must not place a pup or fill peers',
    );
    const result = hint(game);
    assert.equal(result.kind, 'place');
    assert.equal(result.index, target);
    assert.equal(result.step.family, family);
    assert.deepEqual(
      game.cells,
      corrected.map((value, i) => (i === target ? 2 : value)),
      'placing a visible single must not also fill exclusion marks',
    );
    assert.equal(game.history.length, history + 2);
    assert.equal(game.hints, 2);
    assert.equal(game.hearts, 3);
    undo(game);
    undo(game);
    assert.deepEqual(game.cells, before);
  }
});

test('hints apply explained logical steps, recover incorrect notes and can be undone', () => {
  const game = createGame(generatePuzzle(9, 2));
  const firstAnswer = game.puzzle.solution[0];
  move(game, firstAnswer, 'mark');
  assert.equal(hint(game).kind, 'unmark');
  assert.equal(game.cells[firstAnswer], 0);
  undo(game);
  assert.equal(game.cells[firstAnswer], 1);
  hint(game);
  let steps = 0,
    explained = false;
  while (!isComplete(game.puzzle, game.cells) && steps++ < 150) {
    const previous = [...game.cells];
    const result = hint(game);
    assert.ok(result?.step);
    explained ||= result.kind === 'exclude';
    if (!isComplete(game.puzzle, game.cells)) {
      assert.equal(undo(game), true);
      assert.deepEqual(game.cells, previous);
      hint(game);
    }
  }
  assert.ok(isComplete(game.puzzle, game.cells));
  assert.ok(explained);
  assert.equal(game.hearts, 3);
  assert.equal(hint(game), null);
  assert.equal(move(game, firstAnswer, 'erase').changed, false);
});

test('even a locally legal wrong pup costs one life and replaces its note with a red cross', () => {
  const game = createGame(generatePuzzle(8, 2));
  const wrong = (game.puzzle.solution[0] + 1) % 8;
  move(game, wrong, 'mark');
  assert.deepEqual(conflicts(game.puzzle, game.cells, wrong), []);
  const history = game.history.length;
  assert.deepEqual(move(game, wrong, 'dog'), {
    changed: true,
    errors: ['wrong'],
  });
  assert.equal(game.hearts, 2);
  assert.equal(game.cells[wrong], 3);
  assert.equal(game.history.length, history);
  undo(game);
  assert.equal(game.cells[wrong], 0);
  assert.equal(game.hearts, 2);
});

test('red crosses survive saves and hints, resist white paint, and clear before becoming white notes', () => {
  const game = createGame(generatePuzzle(8, 2)),
    wrong = (game.puzzle.solution[0] + 1) % 8;
  move(game, wrong, 'dog');
  assert.equal(game.cells[wrong], 3);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
  const history = game.history.length;
  assert.equal(markCells(game, [wrong], 1), false);
  assert.equal(game.history.length, history);
  hint(game);
  assert.equal(game.cells[wrong], 3);
  undo(game);
  assert.equal(game.cells[wrong], 3);
  move(game, wrong, 'mark');
  assert.equal(game.cells[wrong], 0);
  move(game, wrong, 'mark');
  assert.equal(game.cells[wrong], 1);
  undo(game);
  undo(game);
  assert.equal(game.cells[wrong], 3);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(game))), game);
  assert.ok(markCells(game, [wrong], 0));
  assert.equal(game.cells[wrong], 0);
  const invalid = structuredClone(game);
  invalid.cells[game.puzzle.solution[0]] = 3;
  assert.equal(
    restoreGame(invalid),
    null,
    'an answer cannot be a red mistake note',
  );
});

test('restoration recomputes answers and rejects malformed or contradictory saves', () => {
  const game = createGame(generatePuzzle(8, 31));
  move(game, 0, 'mark');
  const saved = JSON.parse(JSON.stringify(game));
  saved.puzzle.solution = Array(8).fill(0);
  saved.puzzle.grade = 'fake';
  const restored = restoreGame(saved);
  assert.deepEqual(restored, game);
  assert.equal(restoreGame(null), null);
  for (const change of [
    (value) => {
      value.puzzle.size = 7;
    },
    (value) => {
      value.puzzle.regions[0] = -1;
    },
    (value) => {
      value.puzzle.regions.fill(0);
    },
    (value) => {
      value.cells[0] = 4;
    },
    (value) => {
      value.cells[0] = value.cells[1] = 2;
    },
    (value) => {
      value.hearts = -1;
    },
  ]) {
    const invalid = structuredClone(game);
    change(invalid);
    assert.equal(restoreGame(invalid), null);
  }
});

test('legacy basic-only puzzles keep pups, notes and life when restored', () => {
  const puzzle = JSON.parse(
    readFileSync(
      new URL('./fixtures/pupdoku-large-region.json', import.meta.url),
      'utf8',
    ),
  );
  const analysis = analyzeLogic(puzzle.regions, puzzle.size);
  assert.equal(analysis.solved, true);
  assert.equal(analysis.techniques.mixedColorCommon, 0);
  assert.equal(analysis.techniques.subset, 0);
  puzzle.seed = 1;
  puzzle.solution = solve(puzzle.regions, puzzle.size)[0];
  const game = createGame(puzzle);
  game.history.push([...game.cells]);
  game.cells[puzzle.solution[0]] = 2;
  game.cells[(puzzle.solution[0] + 1) % puzzle.size] = 1;
  game.hearts = 2;
  const restored = restoreGame(game);
  assert.ok(restored);
  assert.deepEqual(restored.puzzle.regions, puzzle.regions);
  assert.deepEqual(restored.puzzle.solution, puzzle.solution);
  assert.deepEqual(restored.cells, game.cells);
  assert.deepEqual(restored.history, game.history);
  assert.equal(restored.hearts, 2);
});

test('new levels sample all five sizes and generate diverse partitions with occasional small entry regions', () => {
  const sizes = new Set(),
    boards = new Set();
  let small = 0;
  for (let seed = 0; seed < 100; seed++) {
    const puzzle = generateLevel(seed);
    sizes.add(puzzle.size);
    boards.add(JSON.stringify(puzzle.regions));
    connected(puzzle);
    verifyProof(puzzle);
    const areas = Array.from(
      { length: puzzle.size },
      (_, region) => puzzle.regions.filter((value) => value === region).length,
    );
    small += areas.filter((area) => area <= 2).length;
  }
  assert.deepEqual(
    [...sizes].sort((a, b) => a - b),
    [8, 9, 10, 11, 12],
  );
  assert.equal(boards.size, 100);
  assert.ok(small > 0, 'small regions are allowed, rather than banned');
});
