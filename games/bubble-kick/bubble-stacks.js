import { simulationFrame } from "./bomb-rules.js";

const LIFT = 2, DURATION = 100;
const views = new WeakMap();
const cell = b => `${b.x},${b.y}`;
const order = b => b.id ?? 0;
const preferred = (a, b) =>
  (a.kind === "football") !== (b.kind === "football")
    ? a.kind === "football" : order(a) < order(b);
function head(balls) {
  if (balls.length < 2) return null;
  return balls.reduce((a, b) => preferred(b, a) ? b : a);
}
function tween(entry, time) {
  if (!entry) return 0;
  if (entry.flight) return entry.lift;
  const t = Math.max(0, Math.min(1, (time - entry.at) / DURATION));
  return entry.from + (entry.target - entry.from) * (1 - (1 - t) ** 3);
}

// Per-canvas presentation history: no animation fields enter game/room state.
export function bubbleStackDisplay(context, state, time, motionFrame = simulationFrame(state)) {
  const clock = simulationFrame(state);
  let view = views.get(context);
  if (!view || view.round !== state.round || clock < view.clock || time < view.time) {
    view = { round: state.round, entries: new Map() };
    views.set(context, view);
  }
  view.clock = clock; view.time = time;
  const groups = new Map(), heads = new Map();
  for (const b of state.balls) {
    if (b.flight && b.flight.end > motionFrame) continue;
    const key = cell(b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  for (const [key, balls] of groups) heads.set(key, head(balls));
  const next = new Map(), result = new Map();
  for (const [index, b] of state.balls.entries()) {
    const id = b.id ?? `index-${index}`, key = cell(b), previous = view.entries.get(id);
    let entry;
    if (b.flight && b.flight.end > motionFrame) {
      const flight = `${b.flight.start}:${b.flight.end}`;
      const from = previous?.flight === flight ? previous.from : tween(previous, time);
      // Predict the landing stack, including earlier arrivals. The endpoint
      // already includes the lift, so landing must not start another tween.
      const landing = state.balls.filter(other => cell(other) === key &&
        (!other.flight || other.flight.end <= b.flight.end));
      const target = head(landing) === b ? LIFT : 0;
      const p = Math.max(0, Math.min(1, (motionFrame - b.flight.start) / (b.flight.end - b.flight.start)));
      entry = { cell: key, flight, from, lift: from + (target - from) * p };
      result.set(b, { lift: entry.lift, top: false, layer: target ? 2 : 0 });
    } else {
      const top = heads.get(key) === b, target = top ? LIFT : 0;
      if (b.flight || previous?.flight || (previous && previous.cell !== key)) {
        entry = { cell: key, from: target, target, at: time };
      } else if (!top && heads.get(key)) {
        // A new representative takes over immediately; never lift two members
        // of the same stack during a transition.
        entry = { cell: key, from: 0, target: 0, at: time };
      } else if (previous && previous.cell === key && previous.target === target) {
        entry = previous;
      } else {
        entry = { cell: key, from: tween(previous, time), target, at: time };
      }
      result.set(b, { lift: tween(entry, time), top, layer: top ? 1 : 0 });
    }
    next.set(id, entry);
  }
  view.entries = next;
  return result;
}
