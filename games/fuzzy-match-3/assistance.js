import { TYPE_COUNT } from "./constants.js";

export const RETRY_PROBABILITIES = [1 / TYPE_COUNT, 0.15, 0.135, 0.12, 0.11, 0.1];

export function validHelp(help) {
  return !!help && Number.isInteger(help.failures) && help.failures >= 1 &&
    help.failures < RETRY_PROBABILITIES.length && Number.isInteger(help.type) &&
    help.type >= 0 && help.type < TYPE_COUNT;
}

export const retryKey = (game, daily = false, date = "") =>
  daily ? `daily:${date}` : `level:${game.level}`;

/** Keep small counters, never a separate board for every retried level. */
export function restoreRetries(saved, date) {
  const retries = {};
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return retries;
  for (const [key, value] of Object.entries(saved)) {
    const level = /^level:([1-9]\d*)$/.exec(key)?.[1];
    if (!(level && Number(level) <= 10000) && key !== `daily:${date}`) continue;
    if (validHelp(value)) retries[key] = { failures: value.failures, type: value.type };
  }
  return retries;
}

export function helpForGoal(help, config, kind = config.goalKind, random = Math.random) {
  if (!validHelp(help)) return null;
  let type = help.type;
  if (kind === "collect" && type === config.targetType) {
    const eligible = Array.from({ length: TYPE_COUNT }, (_, i) => i).filter(i => i !== config.targetType);
    type = eligible[Math.floor(random() * eligible.length)];
  }
  return { failures: help.failures, type };
}

export function spentEnough(game) {
  return Number.isInteger(game.initialMoves) &&
    game.initialMoves - game.moves >= Math.max(8, Math.ceil(game.initialMoves * 0.6));
}

/** Count the completed attempt once; a restart of an already recorded loss is free. */
export function recordRetry(retries, key, game, config, { restarting = false, random = Math.random } = {}) {
  if (game.status === "won") {
    const { assistance, retryCounted, ...completed } = game;
    if (!Object.hasOwn(retries, key)) return { retries, game: completed };
    const next = { ...retries };
    delete next[key];
    return { retries: next, game: completed };
  }
  if (game.retryCounted || !((game.status === "lost" && game.moves === 0) ||
    (restarting && spentEnough(game)))) return { retries, game };
  const previous = retries[key];
  const failures = Math.min(RETRY_PROBABILITIES.length - 1, (validHelp(previous) ? previous.failures : 0) + 1);
  const kind = game.objective?.kind ?? config.goalKind;
  let help;
  if (validHelp(previous)) help = helpForGoal({ ...previous, failures }, config, kind, random);
  else {
    const eligible = Array.from({ length: TYPE_COUNT }, (_, i) => i)
      .filter(type => kind !== "collect" || type !== config.targetType);
    help = { failures, type: eligible[Math.floor(random() * eligible.length)] };
  }
  return { retries: { ...retries, [key]: help }, game: { ...game, retryCounted: true } };
}

/** One draw per incoming ordinary piece; the other types share the remaining mass. */
export function assistedType(random, help) {
  const value = random();
  if (!validHelp(help)) return Math.floor(value * TYPE_COUNT);
  const probability = RETRY_PROBABILITIES[help.failures];
  let cumulative = 0;
  for (let type = 0; type < TYPE_COUNT; type++) {
    cumulative += type === help.type ? probability : (1 - probability) / (TYPE_COUNT - 1);
    if (value < cumulative || type === TYPE_COUNT - 1) return type;
  }
}
