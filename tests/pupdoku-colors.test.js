import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTE, PALETTE_CERTIFICATE } from '../games/pupdoku/palette.js';
import {
  MODEL,
  colorPenalties,
  colorLoss,
  grayPenalty,
  bandPenalty,
  palettePairPenalty,
  saturationSpreadPenalty,
} from '../games/pupdoku/color-loss.js';
import {
  regionColors,
  colorDistance,
  colorAssignmentLoss,
  PALETTE_MIN_DISTANCE,
  NEIGHBOR_DISTANCE_TARGET,
} from '../games/pupdoku/colors.js';
import { generatePuzzle } from '../games/pupdoku/puzzle.js';

const report = JSON.parse(
  readFileSync(
    new URL('../games/pupdoku/palette-report.json', import.meta.url),
    'utf8',
  ),
);
const fixed = PALETTE.map((c) => c.hex);
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function verify(regions, size) {
  const original = [...regions],
    colors = regionColors(regions, size);
  assert.equal(colors.length, size);
  assert.equal(new Set(colors).size, size);
  for (const c of colors) assert.ok(fixed.includes(c));
  for (let a = 0; a < size; a++)
    for (let b = a + 1; b < size; b++)
      assert.ok(colorDistance(colors[a], colors[b]) >= PALETTE_MIN_DISTANCE);
  const score = colorAssignmentLoss(regions, size, colors);
  const chosen = colors.map((hex) => PALETTE.find((c) => c.hex === hex));
  const range =
    Math.max(...chosen.map((c) => c.s)) - Math.min(...chosen.map((c) => c.s));
  assert.ok(
    Math.abs(
      score.saturationSpread -
        MODEL.saturationSpread.weight * saturationSpreadPenalty(range),
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      score.worstDarkness -
        MODEL.darkness.worstWeight *
          Math.max(...chosen.map((c) => colorPenalties(c).darkness)),
    ) < 1e-10,
  );
  const baseline = colorAssignmentLoss(regions, size, fixed.slice(0, size));
  assert.ok(Number.isFinite(score.total));
  // A clear assignment takes priority over an unsafe baseline's area score.
  if (!(score.worstNeighbor === 0 && baseline.worstNeighbor > 0))
    assert.ok(score.total <= baseline.total + 1e-9);
  assert.deepEqual(regions, original);
  assert.deepEqual(regionColors(regions, size), colors);
  if (size === 12) assert.deepEqual([...colors].sort(), [...fixed].sort());
}

test('the fixed twelve colors are separated and their numerical optimum is independently reproducible', () => {
  assert.equal(PALETTE.length, 12);
  assert.equal(
    PALETTE_CERTIFICATE.candidateCount,
    MODEL.grid.lightness.length *
      MODEL.grid.gamutFractions.length *
      (MODEL.grid.hues?.length ?? 360 / MODEL.grid.hueStep),
  );
  if (MODEL.grid.hues)
    for (const color of PALETTE)
      assert.ok(
        MODEL.grid.hues.some(
          (h) =>
            Math.min(Math.abs(h - color.h), 360 - Math.abs(h - color.h)) < 1,
        ),
        'the exported palette must use the configured hue identities',
      );
  assert.equal(new Set(fixed).size, 12);
  assert.ok(
    Math.max(...PALETTE.map((c) => c.L)) < 0.655,
    'peak lightness must be reduced, including the cyan and sky-blue entries',
  );
  assert.ok(
    Math.min(...PALETTE.map((c) => c.L)) >= 0.578,
    'dark-tail protection must lift the previously very dark outlier',
  );
  let pairLoss = 0,
    min = Infinity;
  for (let a = 0; a < 12; a++)
    for (let b = a + 1; b < 12; b++) {
      const d = colorDistance(fixed[a], fixed[b]);
      min = Math.min(min, d);
      pairLoss += palettePairPenalty(d) / 66;
    }
  assert.ok(min >= PALETTE_MIN_DISTANCE);
  assert.ok(Math.abs(min - PALETTE_CERTIFICATE.minimumDistance) < 1e-10);
  for (const color of PALETTE) {
    assert.match(color.hex, /^#[0-9a-f]{6}$/);
    const contrast =
      (luminance('#fffdf6') + 0.05) / (luminance(color.hex) + 0.05);
    assert.ok(Math.abs(contrast - color.contrast) < 1e-10);
    assert.ok(
      contrast >= 2.9,
      'fixed white marks must retain practical separation',
    );
  }
  const base = PALETTE.reduce((sum, c) => sum + colorLoss(c) / 12, 0);
  const risk = Object.entries(MODEL).reduce(
    (sum, [name, params]) =>
      sum +
      (params.worstWeight ?? 0) *
        (params.worstWeight
          ? Math.max(...PALETTE.map((c) => colorPenalties(c)[name]))
          : 0),
    0,
  );
  const spread =
    Math.max(...PALETTE.map((c) => c.s)) - Math.min(...PALETTE.map((c) => c.s));
  const total =
    base +
    risk +
    MODEL.palettePair.weight * pairLoss +
    MODEL.saturationSpread.weight * saturationSpreadPenalty(spread);
  assert.ok(Math.abs(total - PALETTE_CERTIFICATE.objective) < 1e-7);
  assert.equal(PALETTE_CERTIFICATE.mipGap, 0);
  assert.equal(PALETTE_CERTIFICATE.optimal, true);
  assert.ok(
    Math.abs(PALETTE_CERTIFICATE.objective - PALETTE_CERTIFICATE.lowerBound) <
      1e-7,
  );
  const { dynamic: unusedCurrent, ...fixedModel } = MODEL;
  const { dynamic: unusedReport, ...certifiedModel } = report.model;
  assert.deepEqual(
    fixedModel,
    certifiedModel,
    'changing fixed-color loss curves requires regenerating the palette',
  );
  assert.equal(report.boardIndependent, true);
});

test('the Level 29 screenshot separates every touching color pair, including short boundaries', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/pupdoku-neighbor-regression.json', import.meta.url),
      'utf8',
    ),
  );
  const { regions, size, previousColors } = fixture;
  verify(regions, size);
  const colors = regionColors(regions, size),
    after = colorAssignmentLoss(regions, size, colors);
  let previousMinDistance = Infinity;
  assert.ok(after.minNeighborDistance >= NEIGHBOR_DISTANCE_TARGET);
  assert.equal(after.worstNeighbor, 0);
  assert.equal(after.neighborPairs, 0);
  // Independent grid walk checks all eight directions, not the scorer's graph.
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++)
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr,
            c = col + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          const a = regions[row * size + col],
            b = regions[r * size + c];
          if (a !== b) {
            previousMinDistance = Math.min(
              previousMinDistance,
              colorDistance(previousColors[a], previousColors[b]),
            );
            assert.ok(
              colorDistance(colors[a], colors[b]) >= NEIGHBOR_DISTANCE_TARGET,
            );
          }
        }
  assert.ok(previousMinDistance < 0.13);
});

test('regions touching only at a corner must also have separated colors', () => {
  const size = 8,
    regions = Array.from(
      { length: size ** 2 },
      (_, i) => (Math.floor(i / size) % 6) + 2,
    );
  regions[0] = 0;
  regions[size + 1] = 1;
  const colors = regionColors(regions, size);
  assert.ok(colorDistance(colors[0], colors[1]) >= NEIGHBOR_DISTANCE_TARGET);
  assert.equal(colorAssignmentLoss(regions, size, colors).worstNeighbor, 0);
});

test('loss curves penalize grayness and excess intensity while leaving an acceptable interval flat', () => {
  const values = [20, 40, 55, 64, 75, 90].map(grayPenalty);
  assert.ok(values.every((value, i) => i === 0 || value < values[i - 1]));
  assert.ok(values[0] > 0.99);
  assert.ok(values.at(-1) < 0.001);
  const p = MODEL.lightness;
  assert.equal(bandPenalty(p.low, p), 0);
  assert.equal(bandPenalty((p.low + p.high) / 2, p), 0);
  assert.equal(bandPenalty(p.high, p), 0);
  assert.ok(bandPenalty(p.low - 0.03, p) > 0);
  assert.ok(bandPenalty(p.high + 0.03, p) > 0);
  assert.ok(
    Math.abs(bandPenalty(p.low - 0.03, p) - (0.03 / p.width) ** 2) < 1e-10,
  );
  assert.ok(
    Math.abs(
      bandPenalty(p.high + 0.03, p) - p.highWeight * (0.03 / p.width) ** 2,
    ) < 1e-10,
  );
  const middle = { L: 0.76, C: 0.16, h: 240, s: 70, M: 50, contrast: 2.4 };
  assert.equal(colorPenalties({ ...middle, L: 0.6 }).darkness, 0);
  assert.ok(
    Math.abs(colorPenalties({ ...middle, L: 0.56 }).darkness - 4) < 1e-10,
  );
  const balance = MODEL.saturationBalance;
  for (const s of [balance.low, (balance.low + balance.high) / 2, balance.high])
    assert.equal(colorPenalties({ ...middle, s }).saturationBalance, 0);
  for (const s of [balance.low - balance.width, balance.high + balance.width])
    assert.equal(colorPenalties({ ...middle, s }).saturationBalance, 1);
  const spread = MODEL.saturationSpread;
  assert.equal(saturationSpreadPenalty(spread.target), 0);
  assert.equal(saturationSpreadPenalty(spread.target - 2), 0);
  assert.equal(saturationSpreadPenalty(spread.target + spread.width), 1);
  assert.equal(
    saturationSpreadPenalty(spread.target + 1.5 * spread.width),
    2.5,
  );
  assert.equal(saturationSpreadPenalty(spread.target + 2 * spread.width), 4);
  assert.equal(
    colorPenalties({ ...middle, L: MODEL.brightness.high }).brightness,
    0,
  );
  assert.ok(
    colorPenalties({ ...middle, L: 0.78 }).brightness >
      colorPenalties(middle).brightness,
  );
  assert.ok(colorLoss({ ...middle, s: 40 }) > colorLoss(middle));
  assert.ok(colorLoss({ ...middle, s: 100, M: 120 }) > colorLoss(middle));
  assert.equal(
    colorPenalties({ ...middle, contrast: 3 }).whiteMark,
    colorPenalties(middle).whiteMark,
  );
});

test('all board sizes only assign the fixed palette and improve the full dynamic score', () => {
  const paletteBefore = JSON.stringify(PALETTE);
  for (const size of [8, 9, 10, 11, 12])
    for (let seed = 0; seed < 10; seed++)
      verify(generatePuzzle(size, seed).regions, size);
  assert.equal(
    JSON.stringify(PALETTE),
    paletteBefore,
    'region geometry must never alter the palette',
  );
});

test('the legacy large-region save and dense contact graphs retain fixed colors and explicit confusion losses', () => {
  const saved = JSON.parse(
    readFileSync(
      new URL('./fixtures/pupdoku-large-region.json', import.meta.url),
      'utf8',
    ),
  );
  verify(saved.regions, saved.size);
  const regions = [];
  for (let a = 0; a < 12; a++)
    for (let b = a + 1; b < 12; b++) regions.push(a, b);
  while (regions.length < 144) regions.push(0);
  verify(regions, 12);
  assert.ok(
    colorAssignmentLoss(regions, 12, regionColors(regions, 12)).neighbor > 0,
    'incompatible color contacts remain an explicit penalty, not a false hard guarantee',
  );
});
