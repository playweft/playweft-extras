// Offline audit; timing excludes rendering and display-color assignment.
import { parseArgs } from 'node:util';
import {
  SIZES,
  generatePuzzle,
  analyzeLogic,
  withinChainBudget,
} from '../games/pupdoku/puzzle.js';

function partitionGeometry({ regions, size }) {
  const groups = Array.from({ length: size }, () => new Set());
  regions.forEach((region, index) => groups[region].add(index));
  const shapes = groups.map((cells) => {
    let row = 0,
      column = 0,
      edge = false,
      perimeter = 0;
    const squares = new Set();
    for (const index of cells) {
      const r = Math.floor(index / size),
        c = index % size;
      row += r;
      column += c;
      edge ||= r === 0 || r === size - 1 || c === 0 || c === size - 1;
      perimeter +=
        Number(r === 0 || !cells.has(index - size)) +
        Number(r === size - 1 || !cells.has(index + size)) +
        Number(c === 0 || !cells.has(index - 1)) +
        Number(c === size - 1 || !cells.has(index + 1));
      if (
        r < size - 1 &&
        c < size - 1 &&
        [index + 1, index + size, index + size + 1].every((i) => cells.has(i))
      )
        for (const i of [index, index + 1, index + size, index + size + 1])
          squares.add(i);
    }
    return {
      area: cells.size,
      central:
        Math.abs(row / cells.size - (size - 1) / 2) <= size / 4 &&
        Math.abs(column / cells.size - (size - 1) / 2) <= size / 4,
      edge,
      squareCoverage: squares.size / cells.size,
      compactness: (16 * cells.size) / perimeter ** 2,
    };
  });
  const minArea = Math.min(...shapes.map((s) => s.area)),
    maxArea = Math.max(...shapes.map((s) => s.area)),
    minima = shapes.filter((s) => s.area === minArea),
    maxima = shapes.filter((s) => s.area === maxArea),
    mean = (items, key) =>
      items.reduce((sum, s) => sum + Number(s[key]), 0) / items.length;
  return {
    smallestCentral: mean(minima, 'central'),
    smallestEdge: mean(minima, 'edge'),
    largestSquareCoverage: mean(maxima, 'squareCoverage'),
    // An operational shape metric, not a perceptual or difficulty standard.
    compactLarge: Number(
      shapes.some(
        (s) =>
          s.area >= size * 1.5 &&
          s.squareCoverage >= 0.5 &&
          s.compactness >= 0.35,
      ),
    ),
  };
}

const { values } = parseArgs({
  options: {
    samples: { type: 'string', default: '50' },
    seed: { type: 'string', default: '0' },
  },
});
const samples = Number(values.samples),
  firstSeed = Number(values.seed);
if (
  !Number.isSafeInteger(samples) ||
  samples < 1 ||
  samples > 10000 ||
  !Number.isSafeInteger(firstSeed) ||
  firstSeed < 0
)
  throw new Error('Expected --samples 1..10000 and a nonnegative --seed');

for (const size of SIZES) {
  const durations = [],
    totals = {
      sameColorCommon: 0,
      localPair: 0,
      mixedColorCommon: 0,
      subset: 0,
      joint: 0,
      chain: 0,
      earlySubsets: 0,
      bottlenecks: 0,
      earlyBottlenecks: 0,
      progressPatterns: 0,
      progressSubsets: 0,
      spatialMixed: 0,
      spatialLocks: 0,
      spatialJoint: 0,
    },
    coverage = {
      mixedColor: 0,
      localPair: 0,
      subset: 0,
      joint: 0,
      chain: 0,
      earlyBottlenecks: 0,
      monochromeLines: 0,
      progressPatterns: 0,
      progressSubsets: 0,
      rank3Plus: 0,
      progressRank3Plus: 0,
      spreadSets: 0,
      spatialMixed: 0,
      spatialLocks: 0,
      spatialJoint: 0,
    };
  const largestSetHistogram = Array(Math.floor(size / 2) + 1).fill(0);
  const setSizeHistogram = [...largestSetHistogram];
  let largestSet = 0,
    clustering = 0;
  const chainDifficulty = {
    maxSteps: 0,
    maxLinks: 0,
    threeLinkSteps: 0,
    fiveLinkSteps: 0,
  };
  const geometry = {
    smallestCentral: 0,
    smallestEdge: 0,
    largestSquareCoverage: 0,
    compactLarge: 0,
  };
  for (let offset = 0; offset < samples; offset++) {
    const seed = firstSeed + offset,
      start = performance.now();
    let puzzle;
    try {
      puzzle = generatePuzzle(size, seed);
    } catch (error) {
      throw new Error(`${size}x${size}, seed ${seed}`, { cause: error });
    }
    durations.push(performance.now() - start);
    for (const [key, value] of Object.entries(partitionGeometry(puzzle)))
      geometry[key] += value;
    const analysis = analyzeLogic(puzzle.regions, size);
    clustering += analysis.smallRegionClustering;
    if (
      !analysis.solved ||
      !withinChainBudget(analysis) ||
      analysis.techniques.mixedColorCommon < 2 ||
      analysis.earlyBottlenecks < 2 ||
      analysis.techniques.subset +
        analysis.techniques.joint +
        analysis.techniques.chain <
        1 ||
      analysis.steps.findIndex((step) => step.type !== 'single') >
        Math.floor(size / 4)
    )
      throw new Error(`Invalid logical quality: ${size}x${size}, seed ${seed}`);
    for (const key of [
      'sameColorCommon',
      'localPair',
      'mixedColorCommon',
      'subset',
      'joint',
      'chain',
    ])
      totals[key] += analysis.techniques[key];
    totals.earlySubsets += analysis.earlySubsets;
    totals.bottlenecks += analysis.bottlenecks;
    totals.earlyBottlenecks += analysis.earlyBottlenecks;
    totals.progressPatterns += analysis.progressPatterns;
    totals.progressSubsets += analysis.progressSubsets;
    coverage.mixedColor += analysis.techniques.mixedColorCommon > 0;
    coverage.localPair += analysis.techniques.localPair > 0;
    coverage.subset += analysis.techniques.subset > 0;
    coverage.joint += analysis.techniques.joint > 0;
    coverage.chain += analysis.techniques.chain > 0;
    coverage.earlyBottlenecks += analysis.earlyBottlenecks >= 2;
    coverage.monochromeLines += analysis.monochromeLines > 0;
    coverage.progressPatterns += analysis.progressPatterns > 0;
    coverage.progressSubsets += analysis.progressSubsets > 0;
    coverage.rank3Plus += analysis.techniques.largestSet >= 3;
    coverage.progressRank3Plus += analysis.largestProgressSet >= 3;
    coverage.spreadSets += analysis.spreadSetScore > 0;
    for (const [key, kind] of [
      ['spatialMixed', 'mixedColorCommon'],
      ['spatialLocks', 'subset'],
      ['spatialJoint', 'joint'],
    ]) {
      totals[key] += analysis.spatialSteps[kind];
      coverage[key] += analysis.spatialScores[kind] > 0;
    }
    largestSetHistogram[analysis.techniques.largestSet]++;
    const chains = analysis.steps.filter((step) => step.type === 'chain');
    chainDifficulty.maxSteps = Math.max(
      chainDifficulty.maxSteps,
      chains.length,
    );
    for (const step of chains) {
      chainDifficulty.maxLinks = Math.max(
        chainDifficulty.maxLinks,
        step.links.length,
      );
      chainDifficulty[
        step.links.length === 3 ? 'threeLinkSteps' : 'fiveLinkSteps'
      ]++;
    }
    for (const step of analysis.steps)
      if (step.type === 'subset') setSizeHistogram[step.sourceIds.length]++;
    if (analysis.monochromeLines > 1)
      throw new Error(`Too many pure lines: ${size}x${size}, seed ${seed}`);
    largestSet = Math.max(largestSet, analysis.techniques.largestSet);
  }
  durations.sort((a, b) => a - b);
  const percentile = (p) => durations[Math.ceil(samples * p) - 1];
  console.log(
    JSON.stringify({
      size,
      samples,
      firstSeed,
      coverage,
      meanSteps: Object.fromEntries(
        Object.entries(totals).map(([key, count]) => [key, count / samples]),
      ),
      largestSet,
      chainDifficulty,
      meanSmallRegionClustering: clustering / samples,
      meanGeometry: Object.fromEntries(
        Object.entries(geometry).map(([key, total]) => [key, total / samples]),
      ),
      largestSetHistogram,
      setSizeHistogram,
      generationMs: {
        median: percentile(0.5),
        p95: percentile(0.95),
        max: durations.at(-1),
      },
    }),
  );
}
