import MODEL from './color-model.json' with { type: 'json' };

export { MODEL };
export const hinge = (x) => Math.max(0, x) ** 2;
export const bandPenalty = (x, { low, high, width, highWeight = 1 }) =>
  hinge((low - x) / width) + highWeight * hinge((x - high) / width);
export const grayPenalty = (saturation) =>
  1 / (1 + Math.exp((saturation - MODEL.gray.midpoint) / MODEL.gray.width));
export function colorPenalties({ L, C, h, s, M, contrast }) {
  const delta = Math.abs(h - MODEL.earthyYellow.hue);
  const angle = Math.min(delta, 360 - delta);
  return {
    gray: grayPenalty(s),
    lightness: bandPenalty(L, MODEL.lightness),
    brightness: hinge((L - MODEL.brightness.high) / MODEL.brightness.width),
    darkness: hinge((MODEL.darkness.low - L) / MODEL.darkness.width),
    saturationBalance: bandPenalty(s, MODEL.saturationBalance),
    vivid:
      hinge((s - MODEL.vivid.saturationHigh) / MODEL.vivid.saturationWidth) +
      hinge((M - MODEL.vivid.colorfulnessHigh) / MODEL.vivid.colorfulnessWidth),
    whiteMark: hinge((MODEL.whiteMark.low - contrast) / MODEL.whiteMark.width),
    absoluteChroma: bandPenalty(C, MODEL.absoluteChroma),
    earthyYellow:
      Math.exp(-0.5 * (angle / MODEL.earthyYellow.hueWidth) ** 2) *
      hinge((MODEL.earthyYellow.lightnessLow - L) / MODEL.earthyYellow.width),
  };
}
export const colorLoss = (color) =>
  Object.entries(colorPenalties(color)).reduce(
    (sum, [name, value]) => sum + MODEL[name].weight * value,
    0,
  );
export function palettePairPenalty(distance) {
  const p = MODEL.palettePair;
  return (
    hinge((p.target - distance) / p.width) +
    p.nearWeight * hinge((p.near - distance) / p.nearWidth)
  );
}
export function saturationSpreadPenalty(spread) {
  const x = Math.max(
    0,
    (spread - MODEL.saturationSpread.target) / MODEL.saturationSpread.width,
  );
  const segment = Math.floor(x);
  return segment ** 2 + (2 * segment + 1) * (x - segment);
}
