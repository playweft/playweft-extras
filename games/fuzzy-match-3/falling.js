import { SIZE } from "./game.js";

// Schedule the refill's ordered moves on one clock. A follower may enter a
// vacated cell on the same tick, but cannot overtake its previous occupant.
export function planFalls(drops) {
  const paths = new Map();
  const lastMove = new Map();
  const lastEntry = new Map();
  const lastExit = new Map();
  let steps = 0;

  function move(id, from, to) {
    const tick = Math.max(
      1,
      (lastMove.get(id) || 0) + 1,
      (lastEntry.get(to) || 0) + 1,
      lastExit.get(to) || 0,
    );
    if (!paths.has(id)) paths.set(id, [{ index: from, tick: 0 }]);
    const path = paths.get(id);
    if (path.at(-1).tick < tick - 1)
      path.push({ index: from, tick: tick - 1 });
    path.push({ index: to, tick });
    lastMove.set(id, tick);
    lastEntry.set(to, tick);
    lastExit.set(from, tick);
    steps = Math.max(steps, tick);
  }

  for (const { id, from, to } of drops) {
    if (from === to) continue;
    // Unobstructed compaction can report several rows as one straight fall.
    if (Math.floor(to / SIZE) - Math.floor(from / SIZE) > 1) {
      for (let index = from; index < to; index += SIZE)
        move(id, index, index + SIZE);
    } else move(id, from, to);
  }
  for (const path of paths.values())
    if (path.at(-1).tick < steps)
      path.push({ index: path.at(-1).index, tick: steps });
  return {
    paths,
    steps,
    duration: steps ? Math.max(160, Math.min(400, steps * 40)) : 0,
  };
}
