// Raster artwork is loaded once; gameplay has no dependency on asset readiness.
const art = { stadium: null, heroes: [], frames: null, sideHeroes: [], sideFrames: null };
const assetURL = (name) => new URL(`art/${name}`, document.baseURI).href;
const loadImage = (name) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = assetURL(name);
});
function teamAtlas(image, hue) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  c.drawImage(image, 0, 0);
  const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const v = Math.max(r, g, b), low = Math.min(r, g, b), delta = v - low;
    if (delta < 0.12 || v < 0.15) continue;
    let h = v === r ? (g - b) / delta : v === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
    if (h < 165 || h > 250) continue; // Preserve skin, cream trim and eyes.
    const target = (hue + (h - 200) * 0.45 + 360) % 360 / 60;
    const chroma = delta, x = chroma * (1 - Math.abs(target % 2 - 1));
    const rgb = target < 1 ? [chroma,x,0] : target < 2 ? [x,chroma,0] : target < 3 ? [0,chroma,x] : target < 4 ? [0,x,chroma] : target < 5 ? [x,0,chroma] : [chroma,0,x];
    for (let n = 0; n < 3; n++) d[i + n] = Math.round((rgb[n] + low) * 255);
  }
  c.putImageData(pixels, 0, 0);
  return canvas;
}
if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
  loadImage('stadium.png').then(image => { art.stadium = image; }).catch(() => {});
  Promise.all([loadImage('hero-walk.png'), fetch(assetURL('hero-walk.json')).then(r => r.json())])
    .then(([image, metadata]) => {
      art.frames = metadata;
      art.heroes = [image, ...[3, 43, 283].map(h => teamAtlas(image, h))];
      window.dispatchEvent(new Event('bubble-mischief-crew-art-ready'));
    }).catch(() => {});
  Promise.all([loadImage('hero-walk-side.png'), fetch(assetURL('hero-walk-side.json')).then(r => r.json())])
    .then(([image, metadata]) => {
      art.sideFrames = metadata;
      art.sideHeroes = [image, ...[3, 43, 283].map(h => teamAtlas(image, h))];
      window.dispatchEvent(new Event('bubble-mischief-crew-art-ready'));
    }).catch(() => {});
}
export function drawStadium(c) {
  if (!art.stadium) return false;
  const image = art.stadium;
  // Keep the pitch coordinate system exact while fitting the painted terrace.
  c.drawImage(image, 0, 0, image.width, 350, 0, 0, 960, 225);
  c.drawImage(image, 0, 350, image.width, image.height - 350, 0, 225, 960, 575);
  return true;
}
export function drawHero(c, x, y, index, { dir = 1, moving = false, time = 0, height = 88, anchor = "ground" } = {}) {
  const side = (dir === 0 || dir === 2) && art.sideFrames;
  const metadata = side ? art.sideFrames : art.frames;
  if (!metadata) return false;
  const row = side ? (dir === 2 ? 0 : 1) : ([2, 0, 1, 3][dir] ?? 0);
  const column = moving ? Math.floor(time / 115) % 4 : 1;
  const f = metadata.frames[row * 4 + column];
  const scale = height / metadata.referenceHeight;
  // Register the ground point between the two authored foot support centres.
  // Alpha bounds include shoe tips / fringes and are not a ground pivot.
  const [a, b] = f.footCenters;
  const ax = anchor === "bottom" ? f.w / 2 : (a[0] + b[0]) / 2;
  const ay = anchor === "bottom" ? f.h : (a[1] + b[1]) / 2;
  c.drawImage((side ? art.sideHeroes : art.heroes)[index % 4], f.x, f.y, f.w, f.h,
    x - ax * scale, y - ay * scale, f.w * scale, f.h * scale);
  return true;
}
