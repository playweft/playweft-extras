// Native football02 pool: Client.exe 005e1aad / 005e18e3 / 005e19fb.
// Coins are intentionally excluded at the user’s request. One pickup per bomb wave.
export const ITEM_POOL = Object.freeze([
  { kind: "shoe", weight: 5, stock: 50 },
  { kind: "banana", weight: 2, stock: 50 },
  { kind: "glue", weight: 2, stock: 50 },
  { kind: "fork", weight: 1, stock: 4 },
]);
export const ITEM_LABELS = Object.freeze({
  shoe: { name: "加速鞋", icon: "👟" },
  banana: { name: "香蕉皮", icon: "🍌" },
  glue: { name: "慢慢胶", icon: "🧴" },
  fork: { name: "叉子", icon: "⑂" },
});
export const SLOW_TICKS = 100, RECYCLE_MS = 30000;
export const SHOE_SPEEDS = [5100, 5800, 6700, 8000];
export function playerSpeed(p, tick) {
  if ((p.slideDir ?? -1) >= 0) return 13000;
  if ((p.slowUntil || 0) > tick) return 1800;
  return SHOE_SPEEDS[p.shoes || 0];
}
export function chooseItem(s, elapsedMs, random) {
  s.itemStock ??= ITEM_POOL.map(p => p.stock);
  const weights = ITEM_POOL.map((p, i) =>
    s.itemStock[i] > 0 ? p.weight : 0);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let roll = random(s, total);
  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) { s.itemStock[i]--; return ITEM_POOL[i].kind; }
    roll -= weights[i];
  }
}
