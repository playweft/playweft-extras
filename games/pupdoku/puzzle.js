export const SIZES = [8, 9, 10, 11, 12];

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

// Exact counting with minimum-remaining-values across rows, columns AND colors.
// A fixed row order becomes exponentially slow for some 12 x 12 partitions.
export function solve(regions, size, limit = 2) {
  const solutions = [],
    columns = Array(size).fill(-1);
  function search(count, usedColumns, usedRegions) {
    if (solutions.length >= limit) return;
    if (count === size) {
      solutions.push([...columns]);
      return;
    }
    const units = Array.from({ length: size * 3 }, () => []);
    for (let row = 0; row < size; row++) {
      if (columns[row] >= 0) continue;
      for (let col = 0; col < size; col++) {
        const index = row * size + col,
          region = regions[index];
        if (
          usedColumns & (1 << col) ||
          usedRegions & (1 << region) ||
          (row > 0 &&
            columns[row - 1] >= 0 &&
            Math.abs(col - columns[row - 1]) <= 1) ||
          (row + 1 < size &&
            columns[row + 1] >= 0 &&
            Math.abs(col - columns[row + 1]) <= 1)
        )
          continue;
        units[row].push(index);
        units[size + col].push(index);
        units[size * 2 + region].push(index);
      }
    }
    let choice = null;
    for (let unit = 0; unit < units.length; unit++) {
      if (
        unit < size
          ? columns[unit] >= 0
          : unit < size * 2
            ? usedColumns & (1 << (unit - size))
            : usedRegions & (1 << (unit - size * 2))
      )
        continue;
      if (!units[unit].length) return;
      if (!choice || units[unit].length < choice.length) choice = units[unit];
    }
    for (const index of choice) {
      const row = Math.floor(index / size),
        col = index % size;
      columns[row] = col;
      search(
        count + 1,
        usedColumns | (1 << col),
        usedRegions | (1 << regions[index]),
      );
      columns[row] = -1;
      if (solutions.length >= limit) return;
    }
  }
  search(0, 0, 0);
  return solutions;
}

function makeSolution(size, random) {
  const columns = [];
  function search() {
    if (columns.length === size) return true;
    for (const col of shuffle(
      Array.from({ length: size }, (_, i) => i),
      random,
    )) {
      if (
        columns.includes(col) ||
        (columns.length && Math.abs(col - columns.at(-1)) <= 1)
      )
        continue;
      columns.push(col);
      if (search()) return true;
      columns.pop();
    }
    return false;
  }
  search();
  return columns;
}

function neighbors(index, size) {
  const row = Math.floor(index / size),
    col = index % size;
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ]
    .filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size)
    .map(([r, c]) => r * size + c);
}

function growRegions(solution, size, random) {
  const regions = Array(size ** 2).fill(-1),
    frontier = [];
  function paint(index, region) {
    regions[index] = region;
    for (const peer of neighbors(index, size))
      if (regions[peer] < 0) frontier.push([peer, region]);
  }
  solution.forEach((col, row) => {
    regions[row * size + col] = row;
  });
  solution.forEach((col, row) => paint(row * size + col, row));
  while (frontier.length) {
    const pick = Math.floor(random() * frontier.length),
      [index, region] = frontier[pick];
    frontier[pick] = frontier.at(-1);
    frontier.pop();
    if (regions[index] < 0) paint(index, region);
  }
  return regions;
}

// Grow on the FINAL board, then learn from counterexample answers. Each
// boundary edit keeps the planted answer and connectivity, and tries to make
// the other answers repeat a color. No corner, inner seed or enclosing frame
// has a special role. This is a bounded construction heuristic, not a uniform
// sampler of all partitions or a substitute for the human-technique proof.
function makeDirectPartition(size, random) {
  const solution = makeSolution(size, random),
    fixed = new Set(solution.map((col, row) => row * size + col)),
    maxArea = Math.ceil(size ** 2 / 4),
    maxSmall = Math.floor(size / 4);
  let regions, areas, small, single;
  for (let attempt = 0; attempt < 64; attempt++) {
    regions = growRegions(solution, size, random);
    areas = Array(size).fill(0);
    regions.forEach((region) => areas[region]++);
    small = areas.filter((area) => area <= 2).length;
    single = areas.filter((area) => area === 1).length;
    if (small <= maxSmall && single <= 1 && Math.max(...areas) <= maxArea)
      break;
    if (attempt === 63) return null;
  }

  const witnesses = [],
    byCell = Array.from({ length: size ** 2 }, () => []),
    // Reward the first conflict most, while keeping a small margin against
    // resurrecting old answers. Cached color counts make move scoring cheap.
    energy = Array.from({ length: size + 1 }, (_, d) => Math.exp(-1.7 * d));
  let unresolved = 0;
  for (let attempt = 0; attempt < 400; attempt++) {
    if (!unresolved) {
      const alternatives = solve(regions, size, 8).filter((answer) =>
        answer.some((col, row) => col !== solution[row]),
      );
      if (!alternatives.length) return regions;
      for (const answer of alternatives) {
        const counts = new Uint8Array(size),
          id = witnesses.length;
        answer.forEach((col, row) => {
          const index = row * size + col;
          counts[regions[index]]++;
          byCell[index].push(id);
        });
        witnesses.push({ counts, conflicts: 0 });
        unresolved++;
      }
    }

    let best = null,
      bestScore = -Infinity;
    for (let index = 0; index < regions.length; index++) {
      if (fixed.has(index)) continue;
      const from = regions[index];
      if (areas[from] <= 1) continue;
      const targets = new Set(
        neighbors(index, size).map((peer) => regions[peer]),
      );
      for (const to of targets) {
        if (
          to === from ||
          areas[to] >= maxArea ||
          small + (areas[from] === 3) - (areas[to] === 2) > maxSmall ||
          single + (areas[from] === 2) - (areas[to] === 1) > 1
        )
          continue;
        let improvement = 0;
        for (const id of byCell[index]) {
          const witness = witnesses[id],
            conflicts =
              witness.conflicts +
              (witness.counts[to] > 0) -
              (witness.counts[from] > 1);
          improvement += energy[witness.conflicts] - energy[conflicts];
        }
        const score = improvement + (random() - 0.5) * 0.08;
        if (score <= bestScore) continue;
        regions[index] = to;
        const connected = connectedRegion(regions, size, from, areas[from] - 1);
        regions[index] = from;
        if (connected) {
          bestScore = score;
          best = [index, from, to];
        }
      }
    }
    if (!best) return null;
    const [index, from, to] = best;
    regions[index] = to;
    small += (areas[from] === 3) - (areas[to] === 2);
    single += (areas[from] === 2) - (areas[to] === 1);
    areas[from]--;
    areas[to]++;
    for (const id of byCell[index]) {
      const witness = witnesses[id];
      if (!witness.conflicts) unresolved--;
      witness.conflicts +=
        (witness.counts[to] > 0) - (witness.counts[from] > 1);
      witness.counts[to]++;
      witness.counts[from]--;
      if (!witness.conflicts) unresolved++;
    }
  }
  return null;
}

function connectedRegion(regions, size, region, area) {
  const seen = new Set([regions.indexOf(region)]);
  for (const index of seen) {
    for (const peer of neighbors(index, size))
      if (regions[peer] === region) seen.add(peer);
  }
  return seen.size === area;
}

function interestingProof(analysis, size) {
  const firstDeduction = analysis.steps.findIndex(
    (step) => step.type !== 'single',
  );
  // Small regions can provide an entry point, but not an automatic opening
  // cascade. This is a quality guard, not a human difficulty classification.
  return (
    analysis.solved &&
    analysis.deductions >= 2 &&
    firstDeduction >= 0 &&
    firstDeduction <= Math.floor(size / 4)
  );
}

function variedProof(analysis, size) {
  // These are required after exhausting simpler deductions, not patterns that
  // merely happen to be visible. Require distinct intermediate bottlenecks in
  // the first half; consecutive eliminations at one position count only once.
  return (
    interestingProof(analysis, size) &&
    analysis.techniques.mixedColorCommon >= 2 &&
    analysis.techniques.subset +
      analysis.techniques.joint +
      analysis.techniques.chain >=
      1 &&
    analysis.earlyBottlenecks >= 2
  );
}

export function proofQuality(analysis) {
  if (!analysis.solved) return -Infinity;
  const rank = Math.max(0, analysis.techniques.largestSet - 2),
    progressRank = Math.max(0, analysis.largestProgressSet - 2);
  return (
    Math.min(2, analysis.earlyBottlenecks) * 4 +
    Math.min(1, analysis.techniques.localPair ?? 0) * 0.25 +
    Math.min(2, analysis.techniques.mixedColorCommon) * 0.25 +
    Math.min(
      1,
      analysis.techniques.subset +
        analysis.techniques.joint +
        analysis.techniques.chain,
    ) *
      0.5 +
    Math.min(1, analysis.techniques.joint + analysis.techniques.chain) +
    Math.min(2, analysis.progressPatterns) * 5 +
    Math.min(1, analysis.progressSubsets) * 2 +
    // Rank 2/3/4/5/6 earns 0/12/36/72/120; repeated pairs are capped.
    6 * rank * (rank + 1) +
    3 * progressRank * (progressRank + 1) +
    2 * (analysis.spatialScores?.mixedColorCommon ?? 0) +
    3 * (analysis.spatialScores?.subset ?? 0) +
    (analysis.spatialScores?.joint ?? 0) -
    analysis.monochromeLines * 12 -
    analysis.smallRegionClustering * 6
  );
}

// Average the gaps between consecutive lines: no gap earns zero, and wider
// gaps approach one smoothly. A single wide gap cannot hide all tight pairs.
function coordinateSpread(values) {
  const ordered = [...new Set(values)].sort((a, b) => a - b);
  if (ordered.length < 2) return 0;
  let spread = 0;
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i] - ordered[i - 1] - 1;
    spread += gap / (gap + 1);
  }
  return spread / (ordered.length - 1);
}

export function lockedSetSpread(step, size) {
  if (step.type !== 'subset') return 0;
  const axes = [];
  if (step.sourceFamily !== 'region')
    axes.push(coordinateSpread(step.sourceIds));
  if (step.targetFamily !== 'region')
    axes.push(coordinateSpread(step.targetIds));
  const lines = axes.length
    ? axes.reduce((sum, value) => sum + value, 0) / axes.length
    : 0;
  return size && step.sources
    ? Math.max(lines, cellSpread(step.sources, size))
    : lines;
}

// Minimum spanning tree of the required candidate cells, using king-move
// distance. Connected adjacent cells cost zero; color IDs have no geometry.
function cellSpread(indices, size) {
  if (indices.length < 2) return 0;
  const distance = Array(indices.length).fill(Infinity),
    visited = Array(indices.length).fill(false);
  distance[0] = 0;
  let spread = 0;
  for (let count = 0; count < indices.length; count++) {
    let next = -1;
    for (let i = 0; i < indices.length; i++)
      if (!visited[i] && (next < 0 || distance[i] < distance[next])) next = i;
    visited[next] = true;
    if (count) spread += (distance[next] - 1) / distance[next];
    for (let i = 0; i < indices.length; i++) {
      if (visited[i]) continue;
      const d = Math.max(
        Math.abs(
          Math.floor(indices[next] / size) - Math.floor(indices[i] / size),
        ),
        Math.abs((indices[next] % size) - (indices[i] % size)),
      );
      distance[i] = Math.min(distance[i], d);
    }
  }
  return spread / (indices.length - 1);
}

export function deductionSpread(step, size, regions) {
  if (step.type === 'subset') return lockedSetSpread(step, size);
  if (
    step.type === 'common' &&
    regions &&
    mixedColorLine(step.family, step.sources, regions)
  )
    return coordinateSpread(
      step.sources.map((index) =>
        step.family === 'row' ? index % size : Math.floor(index / size),
      ),
    );
  if (step.type === 'joint') {
    const cells = cellSpread(step.sources, size);
    return step.family === 'region'
      ? cells
      : (cells + coordinateSpread(step.sourceIds)) / 2;
  }
  // Singles/basic common exclusions are not rewarded for distance. The bounded
  // chain search cannot certify that a more compact chain was not overlooked.
  return 0;
}

// Repel nearby small regions without forbidding neighboring entry points.
// Mean region area is `size`. Smallness fades continuously to zero at that
// area, and proximity fades to zero at half a board's width. Normalize pairs
// so this measures spatial concentration rather than simply counting regions.
export function smallRegionClustering(regions, size) {
  const areas = new Float64Array(size),
    rows = new Float64Array(size),
    columns = new Float64Array(size);
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index];
    areas[region]++;
    rows[region] += Math.floor(index / size);
    columns[region] += index % size;
  }
  let loss = 0,
    weight = 0;
  for (let a = 0; a < size; a++) {
    if (!areas[a] || areas[a] >= size) continue;
    for (let b = a + 1; b < size; b++) {
      if (!areas[b] || areas[b] >= size) continue;
      const pairWeight = (1 - areas[a] / size) * (1 - areas[b] / size),
        distance = Math.hypot(
          rows[a] / areas[a] - rows[b] / areas[b],
          columns[a] / areas[a] - columns[b] / areas[b],
        ),
        proximity = Math.max(0, 1 - distance / (size / 2));
      loss += pairWeight * proximity ** 2;
      weight += pairWeight;
    }
  }
  return loss / Math.max(1, weight);
}

// Deform random boundaries while preserving every invariant. Adding a cell to
// a neighboring region preserves its connectivity; only the donor needs BFS.
// Each edit keeps a known valid answer. A complete, sound no-guess proof forces
// every pup, so it also proves uniqueness. Independently count the final board.
function reshapeRegions(regions, size, random) {
  const solution = solve(regions, size)[0];
  const fixed = new Set(solution.map((col, row) => row * size + col));
  const areas = Array(size).fill(0),
    maxArea = Math.ceil(size ** 2 / 4);
  regions.forEach((region) => {
    areas[region]++;
  });
  let quality = proofQuality(generationAnalysis(regions, size)),
    bestQuality = quality,
    best = [...regions];
  for (let attempt = 0; attempt < size ** 2 * 3; attempt++) {
    const index = Math.floor(random() * regions.length),
      from = regions[index];
    if (fixed.has(index) || areas[from] <= 1) continue;
    const targets = shuffle(
      [...new Set(neighbors(index, size).map((peer) => regions[peer]))],
      random,
    );
    for (const to of targets) {
      if (
        from === to ||
        areas[to] >= maxArea ||
        (areas[from] <= areas[to] + 1 && random() < 0.8)
      )
        continue;
      regions[index] = to;
      areas[from]--;
      areas[to]++;
      if (
        areas.filter((area) => area <= 2).length <= Math.floor(size / 4) &&
        areas.filter((area) => area === 1).length <= 1 &&
        connectedRegion(regions, size, from, areas[from])
      ) {
        const analysis = generationAnalysis(regions, size),
          nextQuality = proofQuality(analysis);
        if (
          interestingProof(analysis, size) &&
          (nextQuality >= quality || random() < 0.2)
        ) {
          quality = nextQuality;
          if (quality >= bestQuality) {
            bestQuality = quality;
            best = [...regions];
          }
          break;
        }
      }
      regions[index] = from;
      areas[from]++;
      areas[to]--;
    }
  }
  return best;
}

// Regrow two to four connected colors together so multi-color locks can form
// without requiring every intermediate single-cell edit to remain solvable.
// Target any remaining monochrome line as well as random neighboring regions.
function regrowNeighbors(regions, size, random) {
  const answer = solve(regions, size)[0].map((col, row) => row * size + col);
  let quality = proofQuality(generationAnalysis(regions, size)),
    bestQuality = quality,
    best = regions;
  for (let attempt = 0; attempt < size * 4; attempt++) {
    const lines = monochromeLines(regions, size);
    const from =
      lines.length && random() < 0.7
        ? regions[lines[0][0]]
        : regions[Math.floor(random() * regions.length)];
    const group = [from],
      choice = random(),
      count = choice < 0.35 ? 2 : choice < 0.8 ? 3 : 4;
    while (group.length < count) {
      const adjacent = [
        ...new Set(
          regions.flatMap((region, index) =>
            group.includes(region)
              ? neighbors(index, size)
                  .map((peer) => regions[peer])
                  .filter((region) => !group.includes(region))
              : [],
          ),
        ),
      ];
      if (!adjacent.length) break;
      group.push(adjacent[Math.floor(random() * adjacent.length)]);
    }
    const included = new Set(
      regions.flatMap((region, index) =>
        group.includes(region) ? [index] : [],
      ),
    );
    const next = [...regions],
      frontier = [];
    for (const index of included) next[index] = -1;
    const roots = group.map((region) =>
      answer.find((index) => regions[index] === region),
    );
    function paint(index, region) {
      next[index] = region;
      for (const peer of neighbors(index, size))
        if (included.has(peer) && next[peer] < 0) frontier.push([peer, region]);
    }
    roots.forEach((index, i) => {
      next[index] = group[i];
    });
    roots.forEach((index, i) => paint(index, group[i]));
    while (frontier.length) {
      const pick = Math.floor(random() * frontier.length),
        [index, region] = frontier[pick];
      frontier[pick] = frontier.at(-1);
      frontier.pop();
      if (next[index] < 0) paint(index, region);
    }
    const areas = Array(size).fill(0);
    next.forEach((region) => {
      areas[region]++;
    });
    if (
      areas.filter((area) => area <= 2).length > Math.floor(size / 4) ||
      areas.filter((area) => area === 1).length > 1 ||
      Math.max(...areas) > Math.ceil(size ** 2 / 4)
    )
      continue;
    const analysis = generationAnalysis(next, size),
      nextQuality = proofQuality(analysis);
    if (
      interestingProof(analysis, size) &&
      (nextQuality >= quality || random() < 0.2)
    ) {
      regions = next;
      quality = nextQuality;
      if (quality >= bestQuality) {
        best = regions;
        bestQuality = quality;
      }
    }
  }
  return best;
}

function monochromeLines(regions, size) {
  const lines = [];
  for (let unit = 0; unit < size; unit++) {
    let rowPure = true,
      columnPure = true;
    for (let offset = 1; offset < size && (rowPure || columnPure); offset++) {
      rowPure &&= regions[unit * size + offset] === regions[unit * size];
      columnPure &&= regions[offset * size + unit] === regions[unit];
    }
    if (rowPure)
      lines.push(Array.from({ length: size }, (_, col) => unit * size + col));
    if (columnPure)
      lines.push(Array.from({ length: size }, (_, row) => row * size + unit));
  }
  return lines;
}

// Split excess pure lines with connected boundary transfers instead of
// repeatedly discarding otherwise useful partitions.
function breakMonochromeLines(
  regions,
  size,
  random,
  { maximum = 1, optional = false } = {},
) {
  let lines = monochromeLines(regions, size);
  if (lines.length <= maximum) return regions;
  const fixed = new Set(
    solve(regions, size)[0].map((col, row) => row * size + col),
  );
  const areas = Array(size).fill(0);
  regions.forEach((region) => areas[region]++);
  const preserveQuality = variedProof(generationAnalysis(regions, size), size);
  while (lines.length > maximum) {
    let changed = false;
    const candidates = shuffle([...new Set(lines.flat())], random);
    for (const index of candidates) {
      if (fixed.has(index)) continue;
      const from = regions[index];
      const targets = shuffle(
        [...new Set(neighbors(index, size).map((peer) => regions[peer]))],
        random,
      );
      for (const to of targets) {
        if (
          from === to ||
          areas[from] <= 1 ||
          areas[to] >= Math.ceil(size ** 2 / 4)
        )
          continue;
        regions[index] = to;
        areas[from]--;
        areas[to]++;
        const nextLines = monochromeLines(regions, size);
        if (
          nextLines.length < lines.length &&
          areas.filter((area) => area <= 2).length <= Math.floor(size / 4) &&
          areas.filter((area) => area === 1).length <= 1 &&
          connectedRegion(regions, size, from, areas[from]) &&
          (preserveQuality
            ? variedProof(generationAnalysis(regions, size), size)
            : interestingProof(generationAnalysis(regions, size), size))
        ) {
          lines = nextLines;
          changed = true;
          break;
        }
        regions[index] = from;
        areas[from]++;
        areas[to]--;
      }
      if (changed) break;
    }
    // Each accepted edit reduces the line count. Optional cleanup keeps partial
    // progress; the required max-one repair rejects failure.
    if (!changed) return optional ? regions : null;
  }
  return regions;
}

function touches(a, b, size) {
  return (
    Math.abs(Math.floor(a / size) - Math.floor(b / size)) <= 1 &&
    Math.abs((a % size) - (b % size)) <= 1
  );
}

function excludes(a, b, regions, size) {
  return (
    Math.floor(a / size) === Math.floor(b / size) ||
    a % size === b % size ||
    regions[a] === regions[b] ||
    touches(a, b, size)
  );
}

const FAMILIES = ['row', 'column', 'region'];
const geometryCache = new Map();

function geometry(size) {
  if (geometryCache.has(size)) return geometryCache.get(size);
  const cells = size ** 2,
    words = Math.ceil(cells / 32),
    rowIds = new Uint8Array(cells),
    columnIds = new Uint8Array(cells),
    rows = Array.from({ length: size }, () => new Uint32Array(words)),
    columns = Array.from({ length: size }, () => new Uint32Array(words)),
    basePeers = new Uint32Array(cells * words),
    counts = new Uint8Array(1 << size),
    bitIndices = new Uint8Array(1 << size);
  for (let mask = 1; mask < counts.length; mask++) {
    counts[mask] = counts[mask >>> 1] + (mask & 1);
    if (!(mask & (mask - 1))) bitIndices[mask] = 31 - Math.clz32(mask);
  }
  for (let index = 0; index < cells; index++) {
    const row = Math.floor(index / size),
      column = index % size,
      word = index >>> 5,
      bit = 1 << (index & 31);
    rowIds[index] = row;
    columnIds[index] = column;
    rows[row][word] |= bit;
    columns[column][word] |= bit;
  }
  for (let index = 0; index < cells; index++) {
    const row = rowIds[index],
      column = columnIds[index],
      offset = index * words;
    for (let w = 0; w < words; w++)
      basePeers[offset + w] = rows[row][w] | columns[column][w];
    for (let r = Math.max(0, row - 1); r <= Math.min(size - 1, row + 1); r++)
      for (
        let c = Math.max(0, column - 1);
        c <= Math.min(size - 1, column + 1);
        c++
      ) {
        const peer = r * size + c;
        basePeers[offset + (peer >>> 5)] |= 1 << (peer & 31);
      }
  }
  const result = {
    words,
    rowIds,
    columnIds,
    rows,
    columns,
    basePeers,
    counts,
    bitIndices,
    size,
  };
  geometryCache.set(size, result);
  return result;
}

function logicContext(regions, size) {
  const grid = geometry(size),
    colors = Array.from({ length: size }, () => new Uint32Array(grid.words)),
    peers = new Uint32Array(grid.basePeers);
  for (let index = 0; index < regions.length; index++)
    colors[regions[index]][index >>> 5] |= 1 << (index & 31);
  for (let index = 0; index < regions.length; index++)
    for (let w = 0; w < grid.words; w++)
      peers[index * grid.words + w] |= colors[regions[index]][w];
  return {
    ...grid,
    peers,
    allUnits: makeUnitFamilies(size),
    candidateWords: new Uint32Array(grid.words),
    removedWords: new Uint32Array(grid.words),
    unitMasks: { row: grid.rows, column: grid.columns, region: colors },
  };
}

function unitId(index, family, regions, size) {
  return family === 'row'
    ? Math.floor(index / size)
    : family === 'column'
      ? index % size
      : regions[index];
}

function makeUnitFamilies(size) {
  const make = (family) =>
    Array.from({ length: size }, (_, id) => ({ family, id, candidates: [] }));
  return { row: make('row'), column: make('column'), region: make('region') };
}

function unitCandidates(
  regions,
  size,
  candidates,
  placed,
  allUnits = makeUnitFamilies(size),
) {
  const { rowIds, columnIds } = geometry(size),
    families = allUnits;
  for (const family of FAMILIES)
    for (const unit of families[family]) unit.candidates.length = 0;
  for (const index of candidates) {
    families.row[rowIds[index]].candidates.push(index);
    families.column[columnIds[index]].candidates.push(index);
    families.region[regions[index]].candidates.push(index);
  }
  let rows = 0,
    columns = 0,
    colors = 0;
  for (const index of placed) {
    rows |= 1 << rowIds[index];
    columns |= 1 << columnIds[index];
    colors |= 1 << regions[index];
  }
  return {
    row: families.row.filter((unit) => !(rows & (1 << unit.id))),
    column: families.column.filter((unit) => !(columns & (1 << unit.id))),
    region: families.region.filter((unit) => !(colors & (1 << unit.id))),
  };
}

const subsetMasksCache = new Map();
function rankedSubsetMasks(unitCount, counts) {
  if (!subsetMasksCache.has(unitCount)) {
    const ranked = Array.from(
      { length: Math.floor(unitCount / 2) + 1 },
      () => [],
    );
    for (let mask = 1; mask < 1 << unitCount; mask++) {
      const rank = counts[mask];
      if (rank >= 2 && rank < ranked.length) ranked[rank].push(mask);
    }
    subsetMasksCache.set(unitCount, ranked);
  }
  return subsetMasksCache.get(unitCount);
}

function lockedSet(regions, size, candidates, families) {
  // Exhaust all six directions at a lower rank before trying the next rank.
  // Cached combinations avoid traversing 2^m masks once a pair suffices.
  const { counts, bitIndices } = geometry(size),
    ranked = rankedSubsetMasks(families.row.length, counts),
    projections = [];
  for (const from of FAMILIES)
    for (const to of FAMILIES) {
      if (from === to) continue;
      const units = families[from];
      projections.push({
        from,
        to,
        units,
        targets: units.map((unit) =>
          unit.candidates.reduce(
            (mask, index) => mask | (1 << unitId(index, to, regions, size)),
            0,
          ),
        ),
      });
    }
  for (let rank = 2; rank < ranked.length; rank++) {
    let best = null,
      bestSpread = Infinity;
    for (const { from, to, units, targets } of projections) {
      for (const mask of ranked[rank]) {
        let union = 0,
          sourceMask = 0;
        for (let bits = mask; bits; bits &= bits - 1) {
          const index = bitIndices[bits & -bits];
          union |= targets[index];
          if (counts[union] > rank) break;
          sourceMask |= 1 << units[index].id;
        }
        if (counts[union] !== rank) continue;
        const removed = [...candidates].filter(
          (index) =>
            union & (1 << unitId(index, to, regions, size)) &&
            !(sourceMask & (1 << unitId(index, from, regions, size))),
        );
        if (!removed.length) continue;
        const sourceIds = [],
          sources = [];
        for (let bits = mask; bits; bits &= bits - 1) {
          const unit = units[bitIndices[bits & -bits]];
          sourceIds.push(unit.id);
          sources.push(...unit.candidates);
        }
        const step = {
          type: 'subset',
          sourceFamily: from,
          sourceIds,
          targetFamily: to,
          targetIds: Array.from({ length: size }, (_, i) => i).filter(
            (i) => union & (1 << i),
          ),
          sources,
          removed,
        };
        const spread = lockedSetSpread(step, size);
        if (spread < bestSpread) {
          best = step;
          bestSpread = spread;
        }
        // A compact same-rank explanation is a real bypass, even if its
        // immediate elimination differs. Execute it and recompute the position.
        if (spread === 0) return best;
      }
    }
    if (best) return best;
  }
  return null;
}

export function findLockedSet(regions, size, candidates, placed = new Set()) {
  return lockedSet(
    regions,
    size,
    candidates,
    unitCandidates(regions, size, candidates, placed),
  );
}

function mixedColorLine(family, sources, regions) {
  return (
    family !== 'region' &&
    sources.some((index) => regions[index] !== regions[sources[0]])
  );
}

// Two exact-two color pairs on a 2x3 / 3x2 frame must occupy opposite
// rows/columns. The two exterior middle cells touch whichever pup is nearer.
function adjacentPairExclusion(size, candidates, families) {
  const vertical = new Map(),
    horizontal = new Map();
  for (const unit of families.region) {
    if (unit.candidates.length !== 2) continue;
    const a = Math.min(...unit.candidates),
      b = Math.max(...unit.candidates);
    if (b === a + size) vertical.set(a, { unit, a, b });
    else if (b === a + 1 && Math.floor(a / size) === Math.floor(b / size))
      horizontal.set(a, { unit, a, b });
  }
  for (const [orientation, pairs] of [
    ['vertical', vertical],
    ['horizontal', horizontal],
  ]) {
    for (const first of pairs.values()) {
      const row = Math.floor(first.a / size),
        column = first.a % size,
        alongRows = orientation === 'vertical';
      if (alongRows ? column + 2 >= size : row + 2 >= size) continue;
      const second = pairs.get(first.a + (alongRows ? 2 : size * 2));
      if (!second) continue;
      const targets = alongRows
        ? [
            ...(row > 0 ? [first.a - size + 1] : []),
            ...(row + 2 < size ? [first.a + size * 2 + 1] : []),
          ]
        : [
            ...(column > 0 ? [first.a + size - 1] : []),
            ...(column + 2 < size ? [first.a + size + 2] : []),
          ];
      const removed = targets.filter((index) => candidates.has(index));
      if (removed.length)
        return {
          type: 'localPair',
          family: 'region',
          orientation,
          sourceIds: [first.unit.id, second.unit.id],
          sources: [first.a, first.b, second.a, second.b],
          combinations: [
            [first.a, second.b],
            [first.b, second.a],
          ],
          removed,
        };
    }
  }
  return null;
}

export function findLocalPair(regions, size, candidates, placed = new Set()) {
  return adjacentPairExclusion(
    size,
    candidates,
    unitCandidates(regions, size, candidates, placed),
  );
}

// Two distinct units in the same family require two distinct pups. Intersect
// the blocked cells of EVERY compatible pair, including unsupported source
// candidates. Clear each chosen pup itself: a peer mask contains its own bit.
function jointExclusion(candidates, families, context) {
  const { words, peers, candidateWords } = context;
  let best = null,
    bestSpread = Infinity;
  for (const family of FAMILIES) {
    const units = families[family].filter(
      (unit) => unit.candidates.length >= 2 && unit.candidates.length <= 6,
    );
    for (let a = 0; a < units.length; a++)
      for (let b = a + 1; b < units.length; b++) {
        const first = units[a],
          second = units[b],
          pairs = [];
        for (const i of first.candidates)
          for (const j of second.candidates)
            if (!(peers[i * words + (j >>> 5)] & (1 << (j & 31))))
              pairs.push([i, j]);
        // With no interaction, single-unit common exclusions already suffice.
        // Zero pairs is a contradiction, never a vacuous elimination proof.
        if (
          !pairs.length ||
          pairs.length === first.candidates.length * second.candidates.length
        )
          continue;
        const blocked = new Uint32Array(candidateWords);
        for (const [i, j] of pairs)
          for (let w = 0; w < words; w++) {
            let mask = peers[i * words + w] | peers[j * words + w];
            if (w === i >>> 5) mask &= ~(1 << (i & 31));
            if (w === j >>> 5) mask &= ~(1 << (j & 31));
            blocked[w] &= mask;
          }
        const removed = [...candidates].filter(
          (i) => blocked[i >>> 5] & (1 << (i & 31)),
        );
        if (removed.length) {
          const step = {
            type: 'joint',
            family,
            sourceIds: [first.id, second.id],
            sources: [...first.candidates, ...second.candidates],
            combinations: pairs,
            removed,
          };
          const spread = deductionSpread(step, context.size);
          if (spread < bestSpread) {
            best = step;
            bestSpread = spread;
          }
          if (spread === 0) return best;
        }
      }
  }
  return best;
}

// An alternating S-W-S(-W-S) chain proves that at least one endpoint is true:
// not A implies B, B excludes C, not C implies D. No trial solution or recursive
// solving is involved. Strong links retain their exact-one unit as evidence.
function shortChain(candidates, families, context) {
  const { words, peers } = context;
  const strong = new Map();
  for (const family of FAMILIES)
    for (const unit of families[family]) {
      if (unit.candidates.length !== 2) continue;
      const [a, b] = unit.candidates;
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        if (!strong.has(from)) strong.set(from, []);
        strong
          .get(from)
          .push({ kind: 'strong', from, to, family, id: unit.id });
      }
    }
  const linked = [...strong.keys()];
  // Bounds apply to the proof search, never to the validity of a returned step.
  let expansions = 0;
  for (const start of linked) {
    const queue = strong.get(start).map((link) => ({
      end: link.to,
      sources: [start, link.to],
      links: [link],
      depth: 1,
    }));
    const seen = new Set(queue.map((item) => item.end));
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q];
      if (node.depth >= 2) {
        const removed = [...candidates].filter(
          (i) =>
            i !== start &&
            i !== node.end &&
            peers[start * words + (i >>> 5)] & (1 << (i & 31)) &&
            peers[node.end * words + (i >>> 5)] & (1 << (i & 31)),
        );
        if (removed.length)
          return {
            type: 'chain',
            sources: node.sources,
            links: node.links,
            endpoints: [start, node.end],
            removed,
          };
      }
      if (node.depth >= 3) continue;
      if (++expansions > 512) return null;
      for (const middle of linked) {
        if (
          node.sources.includes(middle) ||
          !(peers[node.end * words + (middle >>> 5)] & (1 << (middle & 31)))
        )
          continue;
        for (const link of strong.get(middle)) {
          if (seen.has(link.to) || node.sources.includes(link.to)) continue;
          seen.add(link.to);
          queue.push({
            end: link.to,
            depth: node.depth + 1,
            sources: [...node.sources, middle, link.to],
            links: [
              ...node.links,
              { kind: 'weak', from: node.end, to: middle },
              link,
            ],
          });
        }
      }
    }
  }
  return null;
}

function nextDeduction(regions, size, candidates, placed, context) {
  const families = unitCandidates(
    regions,
    size,
    candidates,
    placed,
    context.allUnits,
  );
  const remaining = FAMILIES.flatMap((family) => families[family]);
  if (remaining.some((unit) => unit.candidates.length === 0)) return null;
  const single = remaining.find((unit) => unit.candidates.length === 1);
  if (single)
    return {
      type: 'single',
      index: single.candidates[0],
      family: single.family,
      id: single.id,
    };
  // Exhaust same-color common conflicts across all families before using a
  // mixed-color row/column. Otherwise traversal order inflates harder counts.
  const { candidateWords, removedWords } = context;
  candidateWords.fill(0);
  for (const index of candidates)
    candidateWords[index >>> 5] |= 1 << (index & 31);
  for (const mixed of [false, true]) {
    if (mixed) {
      const pair = adjacentPairExclusion(size, candidates, families);
      if (pair) return pair;
    }
    let best = null,
      bestSpread = Infinity;
    for (const unit of remaining) {
      const sources = unit.candidates;
      const mixedColors = mixedColorLine(unit.family, sources, regions);
      if (mixedColors !== mixed) continue;
      let any = 0;
      for (let w = 0; w < context.words; w++) {
        let common =
          candidateWords[w] & ~context.unitMasks[unit.family][unit.id][w];
        for (let s = 0; s < sources.length && common; s++)
          common &= context.peers[sources[s] * context.words + w];
        removedWords[w] = common;
        any |= common;
      }
      if (any) {
        const removed = [...candidates].filter(
          (index) => removedWords[index >>> 5] & (1 << (index & 31)),
        );
        const step = {
          type: 'common',
          family: unit.family,
          id: unit.id,
          sources: [...sources],
          removed,
        };
        if (!mixed) return step;
        const spread = deductionSpread(step, size, regions);
        if (spread < bestSpread) {
          best = step;
          bestSpread = spread;
        }
        if (spread === 0) return best;
      }
    }
    if (best) return best;
  }
  return (
    lockedSet(regions, size, candidates, families) ||
    jointExclusion(candidates, families, context) ||
    shortChain(candidates, families, context)
  );
}

export function findDeduction(regions, size, candidates, placed = new Set()) {
  return nextDeduction(
    regions,
    size,
    candidates,
    placed,
    logicContext(regions, size),
  );
}

function logicalPosition(regions, size, cells) {
  const placed = new Set(
    cells.flatMap((value, index) => (value === 2 ? [index] : [])),
  );
  const candidates = new Set(
    cells.flatMap((value, index) =>
      value === 0 &&
      [...placed].every((peer) => !excludes(index, peer, regions, size))
        ? [index]
        : [],
    ),
  );
  return { placed, candidates };
}

// Separate from exact counting: this solver does not read a solution or guess.
// Every returned step records the premise as well as the conclusion for hints.
function analyzePosition(regions, size, openingLimit = Infinity) {
  const placed = new Set(),
    candidates = new Set(regions.map((_, index) => index)),
    context = logicContext(regions, size);
  const steps = [],
    techniques = {
      single: 0,
      common: 0,
      sameColorCommon: 0,
      localPair: 0,
      mixedColorCommon: 0,
      subset: 0,
      joint: 0,
      chain: 0,
      largestSet: 0,
    };
  let earlySubsets = 0;
  let progressSubsets = 0,
    largestProgressSet = 0,
    spreadSetScore = 0;
  const spatialScores = { mixedColorCommon: 0, subset: 0, joint: 0 },
    spatialSteps = { mixedColorCommon: 0, subset: 0, joint: 0 };
  const bottlenecks = new Set(),
    earlyBottlenecks = new Set(),
    progressPatterns = new Set();
  while (placed.size < size) {
    const step = nextDeduction(regions, size, candidates, placed, context);
    if (!step) break;
    techniques[step.type]++;
    if (step.type === 'single') {
      placed.add(step.index);
      for (const peer of candidates)
        if (
          context.peers[step.index * context.words + (peer >>> 5)] &
          (1 << (peer & 31))
        )
          candidates.delete(peer);
    } else {
      const spatialKind =
          step.type === 'common' ? 'mixedColorCommon' : step.type,
        spread = deductionSpread(step, size, regions);
      if (spread > 0) {
        spatialScores[spatialKind] = Math.max(
          spatialScores[spatialKind],
          spread,
        );
        spatialSteps[spatialKind]++;
      }
      if (step.type === 'common') {
        const mixedColors = mixedColorLine(step.family, step.sources, regions);
        techniques[mixedColors ? 'mixedColorCommon' : 'sameColorCommon']++;
      }
      if (step.type === 'subset' && placed.size <= Math.floor(size / 2))
        earlySubsets++;
      if (
        step.type !== 'localPair' &&
        (step.type !== 'common' ||
          mixedColorLine(step.family, step.sources, regions))
      ) {
        bottlenecks.add(placed.size);
        if (placed.size <= Math.floor(size / 2))
          earlyBottlenecks.add(placed.size);
      }
      for (const index of step.removed) candidates.delete(index);
      if (step.type === 'subset') {
        techniques.largestSet = Math.max(
          techniques.largestSet,
          step.sourceIds.length,
        );
        spreadSetScore = Math.max(
          spreadSetScore,
          step.sourceIds.length * lockedSetSpread(step, size),
        );
      }
      // Count meaningful patterns after at least two placements, excluding
      // the last three pups' inevitable cleanup. Opening patterns remain legal.
      if (
        placed.size >= 2 &&
        placed.size <= size - 3 &&
        (step.type === 'subset' ||
          (step.type === 'common' &&
            mixedColorLine(step.family, step.sources, regions)))
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
    }
    steps.push(step);
    // No later deduction can undo an overlong automatic opening. Only the
    // generation filter sets this limit; public analysis always runs in full.
    if (
      techniques.common +
        techniques.localPair +
        techniques.subset +
        techniques.joint +
        techniques.chain ===
        0 &&
      placed.size > openingLimit
    )
      break;
  }
  return {
    solved: placed.size === size,
    steps,
    techniques,
    earlySubsets,
    progressPatterns: progressPatterns.size,
    progressSubsets,
    largestProgressSet,
    spreadSetScore,
    spatialScores,
    spatialSteps,
    monochromeLines: monochromeLines(regions, size).length,
    smallRegionClustering: smallRegionClustering(regions, size),
    bottlenecks: bottlenecks.size,
    earlyBottlenecks: earlyBottlenecks.size,
    deductions:
      techniques.common +
      techniques.localPair +
      techniques.subset +
      techniques.joint +
      techniques.chain,
  };
}

export function analyzeLogic(regions, size) {
  return analyzePosition(regions, size);
}

function generationAnalysis(regions, size) {
  return analyzePosition(regions, size, Math.floor(size / 4));
}

// Only grid symmetries preserve diagonal adjacency. Arbitrarily shuffling rows
// or columns (as in ordinary Sudoku) would silently break this game's rules.
export function remixRegions(regions, size, random) {
  const colors = shuffle(
    Array.from({ length: size }, (_, i) => i),
    random,
  );
  const transpose = random() < 0.5,
    flipRow = random() < 0.5,
    flipCol = random() < 0.5;
  const result = Array(size ** 2);
  regions.forEach((region, index) => {
    let row = Math.floor(index / size),
      col = index % size;
    if (transpose) [row, col] = [col, row];
    if (flipRow) row = size - 1 - row;
    if (flipCol) col = size - 1 - col;
    result[row * size + col] = colors[region];
  });
  return result;
}

function describePuzzle(regions, size, seed, analysis) {
  const solutions = solve(regions, size);
  if (solutions.length !== 1) return null;
  analysis ??= analyzeLogic(regions, size);
  if (!analysis.solved) return null;
  return {
    size,
    regions,
    solution: solutions[0],
    seed,
    deductions: analysis.deductions,
    techniques: analysis.techniques,
  };
}

export function generatePuzzle(size = 8, seed = Date.now()) {
  if (!SIZES.includes(size)) throw new Error('Unsupported board size');
  const random = seededRandom(seed);
  let bestPuzzle = null,
    bestQuality = -Infinity,
    extraAttempts = 0;
  for (let attempt = 0; attempt < 256; attempt++) {
    // A valid pure-line puzzle is a fallback, not a rejection. Spend at most
    // six more candidates seeking a better distribution, then return the best.
    if (bestPuzzle && extraAttempts-- === 0) return bestPuzzle;
    let regions = makeDirectPartition(size, random);
    if (!regions || !interestingProof(generationAnalysis(regions, size), size))
      continue;
    regions = regrowNeighbors(
      reshapeRegions(regions, size, random),
      size,
      random,
    );
    regions = breakMonochromeLines(regions, size, random);
    if (!regions) continue;
    // Prefer no pure line, but keep a valid puzzle when carving would lose its
    // proof or quality. This is a distribution bias, not a per-level rule.
    const carved = breakMonochromeLines([...regions], size, random, {
      maximum: 0,
      optional: true,
    });
    if (
      proofQuality(generationAnalysis(carved, size)) >=
      proofQuality(generationAnalysis(regions, size))
    )
      regions = carved;
    regions = remixRegions(regions, size, random);
    const analysis = generationAnalysis(regions, size);
    if (!variedProof(analysis, size)) continue;
    const puzzle = describePuzzle(regions, size, seed, analysis);
    if (!puzzle) throw new Error('Generated partition failed verification');
    const quality = proofQuality(analysis);
    if (!bestPuzzle) extraAttempts = 6;
    if (quality > bestQuality) {
      bestPuzzle = puzzle;
      bestQuality = quality;
    }
    if (!analysis.monochromeLines) return bestPuzzle;
  }
  if (bestPuzzle) return bestPuzzle;
  throw new Error('Unable to generate a partition with a varied logical proof');
}

export function generateLevel(seed = Date.now()) {
  const random = seededRandom(seed);
  const size = SIZES[Math.floor(random() * SIZES.length)];
  return generatePuzzle(size, seed);
}

export function conflicts(puzzle, cells, index) {
  const { size, regions } = puzzle;
  const row = Math.floor(index / size),
    col = index % size;
  const result = new Set();
  cells.forEach((value, peer) => {
    if (value !== 2 || peer === index) return;
    const r = Math.floor(peer / size),
      c = peer % size;
    if (r === row) result.add('row');
    if (c === col) result.add('column');
    if (regions[peer] === regions[index]) result.add('region');
    if (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1) result.add('touch');
  });
  return [...result];
}

export function isComplete(puzzle, cells) {
  return (
    cells.filter((value) => value === 2).length === puzzle.size &&
    cells.every(
      (value, index) =>
        value !== 2 || conflicts(puzzle, cells, index).length === 0,
    )
  );
}

export function createGame(puzzle) {
  return {
    puzzle,
    // 0 empty, 1 white note, 2 pup, 3 persistent red mistake note.
    cells: Array(puzzle.size ** 2).fill(0),
    history: [],
    hearts: 3,
    hints: 0,
  };
}

export function move(game, index, tool) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= game.cells.length ||
    !['dog', 'mark', 'erase'].includes(tool) ||
    game.cells[index] === 2 ||
    game.hearts === 0 ||
    isComplete(game.puzzle, game.cells)
  )
    return { changed: false };
  const value = tool === 'erase' ? 0 : tool === 'mark' ? 1 : 2;
  const next =
    game.cells[index] === value || (tool === 'mark' && game.cells[index] === 3)
      ? 0
      : value;
  const errors =
    next === 2 &&
    game.puzzle.solution[Math.floor(index / game.puzzle.size)] !==
      index % game.puzzle.size
      ? ['wrong']
      : next === 2
        ? conflicts(game.puzzle, game.cells, index)
        : [];
  if (errors.length) {
    game.hearts--;
    const changed = game.cells[index] !== 3;
    game.cells[index] = 3;
    return { changed, errors };
  }
  if (game.cells[index] === next) return { changed: false };
  game.history.push([...game.cells]);
  if (game.history.length > 150) game.history.shift();
  game.cells[index] = next;
  return { changed: true };
}

// A whole drag is one reversible action. Pups are never overwritten by marks.
export function markCells(game, indices, value) {
  if (
    !game.hearts ||
    isComplete(game.puzzle, game.cells) ||
    ![0, 1].includes(value)
  )
    return false;
  const targets = [...new Set(indices)].filter(
    (index) =>
      Number.isInteger(index) &&
      index >= 0 &&
      index < game.cells.length &&
      game.cells[index] !== 2 &&
      // Painting white notes over a mistake must not downgrade its color.
      !(value === 1 && game.cells[index] === 3) &&
      game.cells[index] !== value,
  );
  if (!targets.length) return false;
  game.history.push([...game.cells]);
  if (game.history.length > 150) game.history.shift();
  targets.forEach((index) => {
    game.cells[index] = value;
  });
  return true;
}

export function undo(game) {
  if (
    !game.hearts ||
    !game.history.length ||
    isComplete(game.puzzle, game.cells)
  )
    return false;
  game.cells = game.history.pop();
  return true;
}

export function hint(game) {
  if (!game.hearts || isComplete(game.puzzle, game.cells)) return null;
  const { size, solution } = game.puzzle;
  let index = game.cells.findIndex(
    (value, i) => value === 2 && solution[Math.floor(i / size)] !== i % size,
  );
  let kind = 'remove',
    step = null;
  if (index < 0) {
    index = solution
      .map((col, row) => row * size + col)
      .find((i) => game.cells[i] === 1);
    kind = 'unmark';
  }
  const pups = game.cells.flatMap((value, i) => (value === 2 ? [i] : []));
  if (index === undefined) {
    // Visible singles use actual marks only. Do not silently remove unmarked
    // peers first: correcting notes, placing pups and filling Xs are separate
    // hint actions, in that priority order.
    const candidates = new Set(
        game.cells.flatMap((value, i) => (value === 0 ? [i] : [])),
      ),
      families = unitCandidates(game.puzzle.regions, size, candidates, pups),
      single = FAMILIES.flatMap((family) => families[family]).find(
        (unit) => unit.candidates.length === 1,
      );
    if (single) {
      index = single.candidates[0];
      kind = 'place';
      step = { type: 'single', index, family: single.family, id: single.id };
    }
  }
  if (index === undefined) {
    const sources = new Set(),
      removed = [];
    for (let i = 0; i < game.cells.length; i++) {
      if (game.cells[i] !== 0) continue;
      let blocked = false;
      for (const pup of pups) {
        if (excludes(i, pup, game.puzzle.regions, size)) {
          blocked = true;
          sources.add(pup);
        }
      }
      if (blocked) removed.push(i);
    }
    if (removed.length) {
      index = removed[0];
      kind = 'exclude';
      step = {
        type: 'placed',
        sources: pups.filter((pup) => sources.has(pup)),
        removed,
      };
    }
  }
  if (index === undefined) {
    const { placed, candidates } = logicalPosition(
      game.puzzle.regions,
      size,
      game.cells,
    );
    step = findDeduction(game.puzzle.regions, size, candidates, placed);
    if (!step) return null;
    index = step.type === 'single' ? step.index : step.removed[0];
    kind = step.type === 'single' ? 'place' : 'exclude';
  }
  game.history.push([...game.cells]);
  if (game.history.length > 150) game.history.shift();
  if (kind === 'exclude')
    step.removed.forEach((i) => {
      game.cells[i] = 1;
    });
  else game.cells[index] = kind === 'place' ? 2 : 0;
  game.hints++;
  return { index, kind, step };
}

// Saved state is untrusted. Recompute the unique answer and validate connectivity.
export function restoreGame(saved) {
  const { size, regions } = saved?.puzzle ?? {};
  if (
    !SIZES.includes(size) ||
    !Array.isArray(regions) ||
    regions.length !== size ** 2 ||
    !regions.every(
      (region) => Number.isInteger(region) && region >= 0 && region < size,
    )
  )
    return null;
  for (let region = 0; region < size; region++) {
    const first = regions.indexOf(region);
    if (first < 0) return null;
    const seen = new Set([first]),
      queue = [first];
    for (const index of queue) {
      const row = Math.floor(index / size),
        col = index % size;
      for (const [r, c] of [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ]) {
        const next = r * size + c;
        if (
          r >= 0 &&
          r < size &&
          c >= 0 &&
          c < size &&
          regions[next] === region &&
          !seen.has(next)
        ) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (seen.size !== regions.filter((value) => value === region).length)
      return null;
  }
  const solutions = solve(regions, size);
  if (solutions.length !== 1) return null;
  const puzzle = describePuzzle([...regions], size, saved.puzzle.seed);
  if (!puzzle) return null;
  const validCells = (cells) =>
    Array.isArray(cells) &&
    cells.length === size ** 2 &&
    cells.every((value) => [0, 1, 2, 3].includes(value)) &&
    cells.every(
      (value, index) =>
        value !== 3 ||
        puzzle.solution[Math.floor(index / size)] !== index % size,
    ) &&
    cells.every(
      (value, index) =>
        value !== 2 ||
        (puzzle.solution[Math.floor(index / size)] === index % size &&
          conflicts(puzzle, cells, index).length === 0),
    );
  if (
    !validCells(saved.cells) ||
    !Number.isInteger(saved.hearts) ||
    saved.hearts < 0 ||
    saved.hearts > 3
  )
    return null;
  return {
    puzzle,
    cells: [...saved.cells],
    hearts: saved.hearts,
    hints:
      Number.isSafeInteger(saved.hints) && saved.hints >= 0 ? saved.hints : 0,
    history: Array.isArray(saved.history)
      ? saved.history
          .filter(validCells)
          .slice(-150)
          .map((cells) => [...cells])
      : [],
  };
}
