import {
  canSwap,
  findMatches,
  findMove,
  gameStatus,
  iceLayers,
  levelConfig,
  pendingColorClear,
  refill,
  resolveWave,
  seededRandom,
  shuffleBoard,
  swap,
  totalScore,
} from "../games/fuzzy-match-3/game.js";

/** One real turn, shared by offline play and independent imagined futures. */
export function simulateTurn(
  game,
  pair,
  {
    random = Math.random,
    daily = false,
    config = levelConfig(game.level, daily),
  } = {},
) {
  if (!canSwap(game.board, ...pair))
    throw new Error("AI selected an illegal exchange");
  const next = {
    ...game,
    moves: game.moves - 1,
    collected: [...game.collected],
  };
  let board = swap(game.board, ...pair);
  let finaleStarted = false;
  let chain = 1;
  for (;;) {
    const initial = !finaleStarted && chain === 1;
    let wave =
      chain <= 60 || pendingColorClear(board) >= 0
        ? resolveWave(board, {
            exchange: initial ? pair : [],
            preferred: initial ? [pair[1], pair[0]] : [],
            chain,
            random,
          })
        : null;
    if (
      !wave &&
      (finaleStarted || gameStatus({ ...next, board }, daily, config) !== "playing")
    ) {
      if (!finaleStarted) chain = 1;
      finaleStarted = true;
      wave = resolveWave(board, { finale: true, chain, random });
    }
    if (!wave) break;
    next.score += wave.score;
    next.collected = next.collected.map(
      (count, i) => count + wave.collected[i],
    );
    board = refill(wave.board, random);
    if (wave.cleared.length || wave.iceHits.size) chain++;
  }
  if (findMatches(board).length || !findMove(board))
    board = shuffleBoard(board, random);
  next.board = board;
  next.status = gameStatus(next, daily, config);
  return next;
}

function rankMoves(game, config, strategy, random) {
  const ranked = [];
  const deficit = Math.max(0, config.count - game.collected[config.targetType]);
  for (let a = 0; a < 64; a++)
    for (const b of [a + 1, a + 8]) {
      if (!canSwap(game.board, a, b)) continue;
      const forward = resolveWave(swap(game.board, a, b), {
        exchange: [a, b],
        preferred: [b, a],
        random: seededRandom(42),
      });
      // Direction changes where a newly created special is placed.
      const pairs =
        forward.creations.size && strategy === "strong"
          ? [
              [a, b],
              [b, a],
            ]
          : [[a, b]];
      for (const pair of pairs) {
        const wave =
          pair[0] === a
            ? forward
            : resolveWave(swap(game.board, ...pair), {
                exchange: pair,
                preferred: [pair[1], pair[0]],
                random: seededRandom(42),
              });
        let merit = wave.score;
        if (strategy !== "simple") {
          merit =
            Math.min(deficit, wave.collected[config.targetType]) * 200 +
            wave.score * 0.1;
          for (const layers of wave.iceHits.values())
            merit += layers === 0 ? 350 : 200;
          for (const special of wave.creations.values())
            merit += special === "color" ? 250 : 80;
          merit += wave.armed.size * 400;
        }
        ranked.push({ pair, merit: merit + random() * 0.001 });
      }
    }
  ranked.sort((a, b) => b.merit - a.merit);
  if (!ranked.length) throw new Error("No legal exchange on a settled board");
  return ranked;
}

function positionValue(game, config) {
  if (game.status === "lost") return -10000;
  let value =
    Math.min(game.score, config.target) * 0.08 +
    Math.max(0, game.score - config.target) * 0.04 +
    Math.min(game.collected[config.targetType], config.count) * 90 -
    iceLayers(game.board) * 140;
  game.board.forEach((piece, i) => {
    if (!piece || piece.ice || !piece.special) return;
    value += piece.special === "color" ? 180 : 45;
    for (const j of [i + 1, i + 8]) {
      if (j >= 64 || (j === i + 1 && j % 8 === 0)) continue;
      const other = game.board[j];
      if (other && !other.ice && other.special)
        value +=
          piece.special === "color" || other.special === "color" ? 150 : 50;
    }
  });
  if (game.status === "won") {
    const score = totalScore(game);
    value += 4000 + score * 0.06;
    if (score >= config.starTargets[2]) value += 800;
    else if (score >= config.starTargets[1]) value += 250;
  }
  return value;
}

/** Strong policy: four candidates, three sampled futures each, two turns deep.
 * Prediction randomness is separate from the actual game's random stream. */
export function chooseMove(
  game,
  {
    config = levelConfig(game.level),
    daily = false,
    strategy = "strong",
    random = Math.random,
  } = {},
) {
  if (!["simple", "medium", "strong"].includes(strategy))
    throw new Error("Unknown AI strategy");
  const ranked = rankMoves(game, config, strategy, random);
  if (strategy !== "strong" || ranked.length === 1) return ranked[0].pair;
  const seeds = Array.from({ length: 3 }, () => Math.floor(random() * 2 ** 32));
  let best = -Infinity,
    choice = ranked[0].pair;
  for (const candidate of ranked.slice(0, 4)) {
    let merit = 0;
    for (const seed of seeds) {
      const prediction = seededRandom(seed);
      const next = simulateTurn(game, candidate.pair, {
        random: prediction,
        daily,
        config,
      });
      const immediate = positionValue(next, config);
      if (next.status !== "playing") {
        merit += immediate;
        continue;
      }
      const following = rankMoves(next, config, "medium", prediction)[0].pair;
      const future = simulateTurn(next, following, {
        random: prediction,
        daily,
        config,
      });
      merit += immediate * 0.35 + positionValue(future, config) * 0.65;
    }
    merit = merit / seeds.length + candidate.merit * 0.00001;
    if (merit > best) {
      best = merit;
      choice = candidate.pair;
    }
  }
  return choice;
}
