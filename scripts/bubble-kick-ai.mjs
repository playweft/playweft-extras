import { pathToFileURL } from "node:url";
import { createGame, stepGame, LIMIT } from "../games/bubble-kick/game.js";

// Run the ordinary world with one bot and no other actors. Ignore team victory
// only; movement, pickups, kicks, bomb waves and damage all use the real game.
// First capture ends the measurement, even if the bot carries a rescue fork.
export function measureSurvival(seed, seconds = LIMIT / 10, seat = 0) {
  const state = createGame({ seed, humans: 0 });
  state.players = [state.players[seat]];
  const player = state.players[0];
  const frames = Math.round(seconds * 50);
  for (let frame = 0; frame < frames; frame++) {
    if (state.phase === "ended") state.phase = "playing";
    stepGame(state, 20);
    if (player.status !== "alive") return (frame + 1) / 50;
  }
  return seconds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = Number(process.argv[2] || 64), first = Number(process.argv[3] || 1);
  const results = Array.from({ length: count }, (_, i) => {
    const seed = (first + i) * 7919;
    const seat = (first + i - 1) % 4;
    return { seed, seat, seconds: measureSurvival(seed, LIMIT / 10, seat) };
  });
  const sorted = results.map(r => r.seconds).sort((a, b) => a - b);
  console.log(JSON.stringify({ count, target: LIMIT / 10 * .75,
    passed: results.filter(r => r.seconds >= LIMIT / 10 * .75).length,
    minimum: sorted[0], median: sorted[Math.floor(count / 2)],
    failures: results.filter(r => r.seconds < LIMIT / 10 * .75),
  }, null, 2));
}
