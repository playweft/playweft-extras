import { PALETTE } from './palette.js';
import {
  MODEL,
  colorLoss,
  colorPenalties,
  hinge,
  bandPenalty,
  saturationSpreadPenalty,
} from './color-loss.js';

export const PALETTE_MIN_DISTANCE = MODEL.palettePair.minimum;
export const NEIGHBOR_DISTANCE_TARGET = MODEL.dynamic.neighbor.target;
function oklab(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function colorDistance(a, b) {
  const first = oklab(a),
    second = oklab(b);
  return Math.hypot(...first.map((value, index) => value - second[index]));
}

const labs = PALETTE.map((color) => oklab(color.hex));
const distances = labs.map((a) =>
  labs.map((b) => Math.hypot(...a.map((v, i) => v - b[i]))),
);
const unary = PALETTE.map(colorLoss);
const gray = PALETTE.map((color) => colorPenalties(color).gray);
const white = PALETTE.map((color) => colorPenalties(color).whiteMark);
const brightness = PALETTE.map((color) => colorPenalties(color).brightness);
const darkness = PALETTE.map((color) => colorPenalties(color).darkness);
const saturationBalance = PALETTE.map(
  (color) => colorPenalties(color).saturationBalance,
);
const adjacent = distances.map((row) =>
  row.map(
    (d) =>
      MODEL.dynamic.neighbor.weight *
      hinge((MODEL.dynamic.neighbor.target - d) / MODEL.dynamic.neighbor.width),
  ),
);
const allColors = (1 << PALETTE.length) - 1;
const compatible = distances.map((row) =>
  row.reduce(
    (mask, d, c) => mask | (d >= NEIGHBOR_DISTANCE_TARGET ? 1 << c : 0),
    0,
  ),
);
const cache = new Map();

function countBits(mask) {
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count++;
  }
  return count;
}

// Find a clear assignment before balancing the board. Forward checking and
// least-constraining colors keep this bounded; failure is not an unsat proof.
function separatedStart(size, edges, degree) {
  const neighbors = Array(size).fill(0),
    assignment = Array(size).fill(-1);
  for (const { a, b } of edges) {
    neighbors[a] |= 1 << b;
    neighbors[b] |= 1 << a;
  }
  let nodes = 0;
  function search(domains, remaining) {
    if (++nodes > 4096) return null;
    if (!remaining) return [...assignment];
    let pick = -1,
      fewest = Infinity;
    for (let r = 0; r < size; r++) {
      if (assignment[r] >= 0) continue;
      const count = countBits(domains[r]);
      if (!count) return null;
      if (count < fewest || (count === fewest && degree[r] > degree[pick])) {
        pick = r;
        fewest = count;
      }
    }
    const options = [];
    for (let c = 0; c < PALETTE.length; c++) {
      if (!(domains[pick] & (1 << c))) continue;
      const next = [...domains];
      let valid = true,
        freedom = 0,
        union = 0,
        neighborUnion = 0,
        neighborCount = 0;
      for (let r = 0; r < size; r++) {
        if (r === pick || assignment[r] >= 0) continue;
        next[r] &= ~(1 << c);
        if (neighbors[pick] & (1 << r)) {
          next[r] &= compatible[c];
          neighborUnion |= next[r];
          neighborCount++;
        }
        if (!next[r]) {
          valid = false;
          break;
        }
        union |= next[r];
        freedom += countBits(next[r]);
      }
      if (
        valid &&
        countBits(union) >= remaining - 1 &&
        countBits(neighborUnion) >= neighborCount
      )
        options.push({ c, next, freedom });
    }
    options.sort((a, b) => b.freedom - a.freedom || a.c - b.c);
    for (const { c, next } of options) {
      assignment[pick] = c;
      const result = search(next, remaining - 1);
      if (result) return result;
      assignment[pick] = -1;
      if (nodes >= 4096) break;
    }
    return null;
  }
  return search(Array(size).fill(allColors), size);
}

function evaluator(regions, size) {
  const area = Array(size).fill(0),
    contacts = new Map();
  regions.forEach((region, index) => {
    area[region] += 1 / regions.length;
    const row = Math.floor(index / size),
      column = index % size;
    for (const [dr, dc] of [
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ]) {
      const r = row + dr,
        c = column + dc;
      if (r >= size || c < 0 || c >= size) continue;
      const other = regions[r * size + c];
      if (other === region) continue;
      const a = Math.min(region, other),
        b = Math.max(region, other),
        key = a * size + b;
      contacts.set(key, (contacts.get(key) || 0) + 1);
    }
  });
  const totalContacts = [...contacts.values()].reduce((a, b) => a + b, 0);
  const edges = [...contacts].map(([key, count]) => ({
    a: Math.floor(key / size),
    b: key % size,
    weight: count / totalContacts,
  }));
  const degree = Array(size).fill(0);
  for (const { a, b, weight } of edges) {
    degree[a] += weight;
    degree[b] += weight;
  }
  const dominance = area.map((a) =>
    PALETTE.map(
      (color) =>
        MODEL.dynamic.dominance.weight *
        a *
        a *
        hinge(
          (color.s - MODEL.dynamic.dominance.saturationHigh) /
            MODEL.dynamic.dominance.width,
        ),
    ),
  );
  function loss(assignment, details = false) {
    let individual = 0,
      large = 0,
      lightness = 0,
      chroma = 0,
      opponentA = 0,
      opponentB = 0,
      worstGray = 0,
      worstBrightness = 0,
      worstDarkness = 0,
      worstSaturation = 0,
      minSaturation = Infinity,
      maxSaturation = -Infinity,
      worstWhite = 0;
    for (let r = 0; r < size; r++) {
      const c = assignment[r],
        color = PALETTE[c];
      individual += area[r] * unary[c];
      large += dominance[r][c];
      lightness += area[r] * color.L;
      chroma += area[r] * color.C;
      opponentA += area[r] * labs[c][1];
      opponentB += area[r] * labs[c][2];
      worstGray = Math.max(worstGray, gray[c]);
      worstBrightness = Math.max(worstBrightness, brightness[c]);
      worstDarkness = Math.max(worstDarkness, darkness[c]);
      worstSaturation = Math.max(worstSaturation, saturationBalance[c]);
      minSaturation = Math.min(minSaturation, color.s);
      maxSaturation = Math.max(maxSaturation, color.s);
      worstWhite = Math.max(worstWhite, white[c]);
    }
    let neighbor = 0,
      neighborPairs = 0,
      worstPair = 0,
      minNeighborDistance = Infinity;
    for (const { a, b, weight } of edges) {
      const penalty = adjacent[assignment[a]][assignment[b]];
      neighbor += weight * penalty;
      neighborPairs += penalty / edges.length;
      worstPair = Math.max(worstPair, penalty);
      minNeighborDistance = Math.min(
        minNeighborDistance,
        distances[assignment[a]][assignment[b]],
      );
    }
    // A short boundary must not hide a confusing pair in the contact average.
    neighborPairs *= MODEL.dynamic.neighbor.pairWeight;
    const worstNeighbor = MODEL.dynamic.neighbor.worstWeight * worstPair;
    const boardLightness =
      MODEL.dynamic.boardLightness.weight *
      bandPenalty(lightness, MODEL.dynamic.boardLightness);
    const boardChroma =
      MODEL.dynamic.boardChroma.weight *
      bandPenalty(chroma, MODEL.dynamic.boardChroma);
    const hueBalance =
      (MODEL.dynamic.hueBalance.weight *
        (Math.abs(opponentA) + Math.abs(opponentB))) /
      MODEL.dynamic.hueBalance.chromaScale;
    const grayRisk = MODEL.gray.worstWeight * worstGray,
      brightnessRisk = MODEL.brightness.worstWeight * worstBrightness,
      darknessRisk = MODEL.darkness.worstWeight * worstDarkness,
      saturationRisk = MODEL.saturationBalance.worstWeight * worstSaturation,
      saturationSpread =
        MODEL.saturationSpread.weight *
        saturationSpreadPenalty(maxSaturation - minSaturation),
      whiteRisk = MODEL.whiteMark.worstWeight * worstWhite;
    const total =
      individual +
      large +
      neighbor +
      neighborPairs +
      worstNeighbor +
      boardLightness +
      boardChroma +
      hueBalance +
      grayRisk +
      brightnessRisk +
      darknessRisk +
      saturationRisk +
      saturationSpread +
      whiteRisk;
    return details
      ? {
          total,
          individual,
          dominance: large,
          neighbor,
          neighborPairs,
          worstNeighbor,
          minNeighborDistance,
          boardLightness,
          boardChroma,
          hueBalance,
          worstGray: grayRisk,
          worstBrightness: brightnessRisk,
          worstDarkness: darknessRisk,
          worstSaturation: saturationRisk,
          saturationSpread,
          worstWhite: whiteRisk,
          meanLightness: lightness,
          meanChroma: chroma,
        }
      : total;
  }
  return { area, edges, degree, dominance, loss };
}

// Exposed for model audits; all inputs are a board and a permutation/subset of
// the same fixed palette. No palette is generated from a particular board.
export function colorAssignmentLoss(regions, size, colors) {
  const indices = colors.map((hex) =>
    PALETTE.findIndex((color) => color.hex === hex),
  );
  if (indices.some((c) => c < 0) || new Set(indices).size !== size)
    throw new Error('Expected distinct colors from the fixed palette');
  return evaluator(regions, size).loss(indices, true);
}

export function regionColors(regions, size) {
  const key = `${size}:${regions.join(',')}`;
  if (cache.has(key)) return [...cache.get(key)];
  const { area, edges, degree, dominance, loss } = evaluator(regions, size);
  const order = Array.from({ length: size }, (_, i) => i).sort(
    (a, b) => degree[b] - degree[a] || area[b] - area[a] || a - b,
  );
  let starts = [Array.from({ length: size }, (_, i) => i)];
  for (let root = 0; root < PALETTE.length; root++) {
    const assigned = Array(size).fill(-1),
      used = new Set([root]);
    assigned[order[0]] = root;
    for (const r of order.slice(1)) {
      let best = -1,
        scoreBest = Infinity;
      for (let c = 0; c < PALETTE.length; c++) {
        if (used.has(c)) continue;
        let score = area[r] * unary[c] + dominance[r][c];
        for (const { a, b, weight } of edges) {
          const other = a === r ? b : b === r ? a : -1;
          if (other >= 0 && assigned[other] >= 0)
            score += weight * adjacent[c][assigned[other]];
        }
        if (score < scoreBest) {
          best = c;
          scoreBest = score;
        }
      }
      assigned[r] = best;
      used.add(best);
    }
    starts.push(assigned);
  }
  const separated = separatedStart(size, edges, degree);
  if (separated) starts.unshift(separated);
  const isSeparated = (assignment) =>
    edges.every(({ a, b }) => compatible[assignment[a]] & (1 << assignment[b]));
  const clearStarts = starts.filter(isSeparated),
    preserveSeparation = clearStarts.length > 0;
  // Once a clear assignment is known, area/brightness improvements cannot buy
  // back a confusing boundary. Dense graphs retain explicit soft penalties.
  if (preserveSeparation) starts = clearStarts;
  let best = starts[0],
    bestScore = loss(best);
  // Deterministic multi-start descent. Every accepted swap/replacement strictly
  // lowers the full dynamic loss; this bounded search is not a global proof.
  for (const start of starts) {
    let current = [...start],
      score = loss(current);
    for (let pass = 0; pass < 20; pass++) {
      let next = current,
        nextScore = score;
      const used = new Set(current);
      for (let a = 0; a < size; a++) {
        for (let b = a + 1; b < size; b++) {
          const trial = [...current];
          [trial[a], trial[b]] = [trial[b], trial[a]];
          if (preserveSeparation && !isSeparated(trial)) continue;
          const value = loss(trial);
          if (value < nextScore - 1e-10) {
            next = trial;
            nextScore = value;
          }
        }
        for (let c = 0; c < PALETTE.length; c++) {
          if (used.has(c)) continue;
          const trial = [...current];
          trial[a] = c;
          if (preserveSeparation && !isSeparated(trial)) continue;
          const value = loss(trial);
          if (value < nextScore - 1e-10) {
            next = trial;
            nextScore = value;
          }
        }
      }
      if (next === current) break;
      current = next;
      score = nextScore;
    }
    if (score < bestScore) {
      best = current;
      bestScore = score;
    }
  }
  const result = best.map((c) => PALETTE[c].hex);
  if (cache.size >= 16) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return [...result];
}
