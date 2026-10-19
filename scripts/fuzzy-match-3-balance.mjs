import { objectiveProgress } from "../games/fuzzy-match-3/objectives.js";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  createGame,
  iceLayers,
  levelConfig,
  seededRandom,
  totalScore,
} from "../games/fuzzy-match-3/game.js";
import { chooseMove, simulateTurn } from "./fuzzy-match-3-ai.mjs";

function configuration(level, daily, overrides) {
  const config = { ...levelConfig(level, daily), ...overrides };
  if (overrides?.target !== undefined && !overrides.starTargets)
    config.starTargets = [config.target, ...config.starTargets.slice(1)];
  return config;
}

function play({ seed, level, daily, strategy, overrides }) {
  const random = seededRandom(seed);
  const decisions = seededRandom(seed ^ 0xabc123);
  const config = configuration(level, daily, overrides);
  const game = createGame(level, daily, random, { goalKind: config.goalKind });
  game.moves = config.moves;
  let earlyThree = false;
  while (game.moves > 0) {
    const pair = chooseMove(game, {
      config,
      daily,
      strategy,
      random: decisions,
    });
    const next = simulateTurn(game, pair, { config, daily, random });
    Object.assign(game, next);
    if (
      game.moves >= Math.ceil(config.moves / 2) &&
      game.score >= config.starTargets[2]
    )
      earlyThree = true;
    if (game.status !== "playing") break;
  }
  const goal = objectiveProgress(game, config);
  return {
    won: game.status === "won",
    three: game.status === "won" && totalScore(game) >= config.starTargets[2],
    score: game.score,
    totalScore: totalScore(game),
    left: game.moves,
    earlyThree,
    unmetGoals: [
      ...(game.score < config.target ? ["score"] : []),
      ...(!goal.complete ? [goal.kind === "collect" ? "collection" : goal.kind] : []),
      ...(iceLayers(game.board) > 0 ? ["ice"] : []),
    ],
  };
}

export function audit({
  level = 1000,
  daily = false,
  games = 1000,
  seed = 10001,
  strategy = "strong",
  overrides,
} = {}) {
  if (
    ![level, games, seed].every(Number.isSafeInteger) ||
    level < 1 ||
    level > 10000 ||
    games < 1 ||
    !["simple", "medium", "strong"].includes(strategy)
  )
    throw new Error(
      "Expected level 1–10000, positive game count, integer seed, and simple/medium/strong strategy",
    );
  const results = Array.from({ length: games }, (_, i) =>
    play({ seed: seed + i, level, daily, strategy, overrides }),
  );
  const won = results.filter((game) => game.won);
  const lost = results.filter((game) => !game.won);
  const failureReasons = {
    losses: lost.length,
    unmet: Object.fromEntries(["score", "collection", "spread", "reveal", "deliver", "ice"].map((goal) => [
      goal, lost.filter((game) => game.unmetGoals.includes(goal)).length,
    ])),
    combinations: Object.fromEntries([
      "score", "ice", "score+ice",
      ...["collection", "spread", "reveal", "deliver"].flatMap(kind => [kind, `score+${kind}`, `${kind}+ice`, `score+${kind}+ice`]),
    ].map((combination) => [
      combination, lost.filter((game) => game.unmetGoals.join("+") === combination).length,
    ])),
  };
  const threes = results.filter((game) => game.three).length;
  const median = (key) =>
    won.map((game) => game[key]).sort((a, b) => a - b)[
      Math.floor(won.length / 2)
    ] ?? null;
  const rate = threes / games;
  const totals = won.map((game) => game.totalScore).sort((a, b) => a - b);
  const winTotalScoreQuantiles = Object.fromEntries(
    [5, 25, 50, 60, 75, 95].map((percent) => [
      `p${percent}`,
      totals[Math.floor(((totals.length - 1) * percent) / 100)] ?? null,
    ]),
  );
  // Wilson 95% interval for the all-game three-star rate.
  const z2 = 1.96 ** 2;
  const center = (rate + z2 / (2 * games)) / (1 + z2 / games);
  const margin =
    (1.96 * Math.sqrt((rate * (1 - rate)) / games + z2 / (4 * games ** 2))) /
    (1 + z2 / games);
  return {
    level,
    daily,
    strategy,
    games,
    seed,
    config: configuration(level, daily, overrides),
    wins: won.length,
    threes,
    winRate: won.length / games,
    threeRate: rate,
    threeAmongWins: won.length ? threes / won.length : null,
    threeRate95: [center - margin, center + margin],
    medianWinScore: median("score"),
    winTotalScoreQuantiles,
    medianMovesLeft: median("left"),
    earlyThreeRate: results.filter((game) => game.earlyThree).length / games,
    failureReasons,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      level: { type: "string", default: "1000" },
      games: { type: "string", default: "1000" },
      seed: { type: "string", default: "10001" },
      strategy: { type: "string", default: "strong" },
      daily: { type: "boolean", default: false },
    },
  });
  console.log(
    JSON.stringify(
      audit({
        level: Number(values.level),
        games: Number(values.games),
        seed: Number(values.seed),
        strategy: values.strategy,
        daily: values.daily,
      }),
      null,
      2,
    ),
  );
}
