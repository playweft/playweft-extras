// Native football02: crop columns 1..13 / rows 4..12 from the 15 × 13 map.
// Goal elements 7007/7008 each occupy 1 × 3 cells with GridAttr=(0,0,0).
export const COLS = 13, ROWS = 9;
export const GOALS = Object.freeze([
  { minX: -500, maxX: 500, minY: 2500, maxY: 5500 },
  { minX: 11500, maxX: 12500, minY: 2500, maxY: 5500 },
]);
export function inside(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS &&
    !((x === 0 || x === COLS - 1) && y >= 3 && y <= 5);
}
