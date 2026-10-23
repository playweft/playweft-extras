import { drawHero, drawStadium } from "./art.js";
import { COLS, ROWS } from "./game.js";
import { BOMB, simulationFrame } from "./bomb-rules.js";
import { GOALS } from "./arena.js";
const X = 90,
  Y = 225,
  C = 52,
  CY = 48;
// Keep the full sprite / trapped bubble inside the cone rows, not just its feet.
// The outer ground centres still reach the grass outside the white sidelines.
const PLAYER_EDGE_X = 96,
  CELL_WIDTH = (960 - PLAYER_EDGE_X * 2) / (COLS - 1),
  CELL_HEIGHT = 480 / (ROWS - 1),
  GROUND_Y = Y + CY / 2,
  PITCH_LEFT = PLAYER_EDGE_X + CELL_WIDTH / 2,
  PITCH_RIGHT = 960 - PITCH_LEFT;
export const PALETTES = [
  ["#46d7fb", "#0c6fb9", "#ffd0a1", "#372b32"],
  ["#ff553b", "#b72b15", "#ffd0a1", "#713322"],
  ["#ffc92b", "#e26e04", "#ffd6a0", "#62341d"],
  ["#c75aff", "#6825bb", "#ffdbb0", "#4e284b"],
];
const round = (c, x, y, w, h, r, fill, stroke) => {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.stroke();
  }
};
function star(c, x, y, r, n, fill, rotation = 0) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2 + rotation,
      rr = i % 2 ? r * 0.48 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}
function groundShadow(c, x, y, width = 19, height = 6, opacity = 0.34) {
  c.save();
  c.translate(x, y);
  c.scale(1, height / width);
  const g = c.createRadialGradient(0, 0, 1, 0, 0, width);
  g.addColorStop(0, `rgba(15, 42, 19, ${opacity})`);
  g.addColorStop(0.6, `rgba(15, 42, 19, ${opacity * 0.6})`);
  g.addColorStop(1, "rgba(15, 42, 19, 0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, width, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function drawVectorPlayer(
  c, x, y, index,
  { bubble = false, out = false, shield = false, dir = 0,
    bounce = 0, stride = 0, shadow = true } = {},
) {
  const [light, dark, skin, hair] = PALETTES[index % 4];
  c.save();
  c.translate(x, y); // The position is the feet's contact point, not the face.
  if (out) c.globalAlpha = 0.25;
  if (shadow) groundShadow(c, 0, 1, bubble ? 23 : 20, 6);
  c.translate(0, -19);
  const boots = c.createLinearGradient(-12, 7, 12, 20);
  boots.addColorStop(0, dark);
  boots.addColorStop(1, "#172e3d");
  for (const [bx, lift] of [[-13, Math.max(0, stride) * 3], [2, Math.max(0, -stride) * 3]]) {
    round(c, bx, 8 - lift, 11, 11, 4, boots);
    round(c, bx + 1, 16 - lift, 10, 3, 1, "#182a35");
    round(c, bx + 2, 10 - lift, 5, 2, 1, "#ffffff65");
  }
  // Only the torso / head bounce; the planted foot and ground shadow stay put.
  c.save();
  c.translate(0, bounce);
  const kit = c.createLinearGradient(-15, -9, 17, 16);
  kit.addColorStop(0, "#e7ffff");
  kit.addColorStop(0.24, light);
  kit.addColorStop(1, dark);
  const flesh = c.createRadialGradient(-9, -22, 2, 4, -16, 27);
  flesh.addColorStop(0, "#fff1d6");
  flesh.addColorStop(0.62, skin);
  flesh.addColorStop(1, "#cc8964");
  round(c, -15, -7, 30, 23, 10, kit, "#153e4755");
  round(c, -21, -4, 9, 14, 4, flesh, "#9f6d4933");
  round(c, 12, -4, 9, 14, 4, flesh, "#9f6d4933");
  round(c, -10, -1, 20, 5, 2, "#fff8df");
  round(c, -11, 12, 22, 4, 2, dark);
  c.fillStyle = "#183f50";
  c.font = "bold 9px sans-serif";
  c.textAlign = "center";
  c.fillText(String(index + 1), 0, 11);
  round(c, -22, -40, 44, 42, 17, hair, "#173e4855");
  round(c, -19, -31, 38, 29, 13, flesh, "#ab77512b");
  const cap = c.createRadialGradient(-13, -43, 1, 5, -30, 38);
  cap.addColorStop(0, "#e7ffff");
  cap.addColorStop(0.3, light);
  cap.addColorStop(1, dark);
  round(c, -23, -44, 14, 19, 6, cap, "#173e4844");
  round(c, 9, -44, 14, 19, 6, cap, "#173e4844");
  round(c, -22, -43, 44, 23, 11, cap, "#173e4855");
  round(c, -19, -23, 38, 5, 2, "#102c4638");
  round(c, -17, -24, 33, 3, 2, light);
  c.fillStyle = dark;
  c.beginPath();
  c.arc(-10, -34, 4, 0, 7);
  c.arc(10, -34, 4, 0, 7);
  c.fill();
  if (dir === 3) {
    // Back view: cap, hair and a small nape, with no front-facing eyes.
    round(c, -18, -24, 36, 21, 9, cap);
    round(c, -16, -8, 32, 6, 3, hair);
    round(c, -5, -3, 10, 4, 2, flesh);
    round(c, -10, -12, 20, 3, 1, "#ffffff45");
  } else {
    const look = dir === 0 ? 4 : dir === 2 ? -4 : 0;
    round(c, -10 + look, -18, 5, 8, 2, "#263238");
    round(c, 5 + look, -18, 5, 8, 2, "#263238");
    round(c, -9 + look, -17, 2, 2, 1, "#fffdf4");
    round(c, 6 + look, -17, 2, 2, 1, "#fffdf4");
    round(c, -15 + look / 2, -10, 6, 3, 2, "#e99c82");
    round(c, 9 + look / 2, -10, 6, 3, 2, "#e99c82");
    if (look) {
      c.fillStyle = flesh;
      c.beginPath();
      c.ellipse(look > 0 ? 18 : -18, -13, 3, 4, 0, 0, 7);
      c.fill();
    }
    c.strokeStyle = "#9f654d";
    c.lineWidth = 1.3;
    c.beginPath();
    c.arc(look / 2, -8, 3, 0, Math.PI);
    c.stroke();
  }
  c.restore();
  if (shield) {
    c.strokeStyle = "#e9ffc49c";
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(0, -14, 27, 34, 0, 0, 7);
    c.stroke();
    star(c, 22, -39, 5, 4, "#faffc5");
  }
  if (bubble) {
    const g = c.createRadialGradient(-10, -29, 1, 0, -14, 35);
    g.addColorStop(0, "#f4ffff0f");
    g.addColorStop(0.7, "#b3e9ff40");
    g.addColorStop(1, "#55a8d8b0");
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, -14, 28, 34, 0, 0, 7);
    c.fill();
    c.strokeStyle = "#dcfaff";
    c.lineWidth = 2;
    c.stroke();
    round(c, -20, -39, 5, 16, 3, "#fff9");
    round(c, 12, 4, 8, 3, 2, "#e3faff80");
  }
  c.restore();
}
export function drawPlayer(c, x, y, index, opts = {}) {
  c.save();
  if (opts.out) c.globalAlpha = 0.25;
  if (opts.shadow !== false) groundShadow(c, x, y + 1, 23, 6, 0.43);
  if (!drawHero(c, x, y, index, opts)) {
    c.restore();
    drawVectorPlayer(c, x, y, index, opts);
    return;
  }
  if (opts.bubble || opts.shield) {
    const g = c.createRadialGradient(x - 14, y - 48, 3, x, y - 35, 45);
    g.addColorStop(0, '#f5ffff08');
    g.addColorStop(0.7, '#8fdfff30');
    g.addColorStop(1, opts.bubble ? '#38a8eaaa' : '#f5ffc966');
    c.fillStyle = g;
    c.strokeStyle = opts.bubble ? '#d7fbff' : '#efffc8bb';
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(x, y - 35, 34, 43, 0, 0, 7); c.fill(); c.stroke();
    round(c, x - 25, y - 62, 5, 17, 3, '#ffffffaa');
  }
  c.restore();
}
function ball(c, x, y, fuse, time, kind) {
  c.save();
  c.translate(x, y);
  const pulse = fuse < 10 ? 1 + Math.sin(time / 65) * 0.08 : 1;
  const football = kind === "football", height = football ? 20 : 15;
  c.scale(pulse, pulse);
  c.translate(0, -height); // Bottom of the bubble meets its ground anchor.
  const g = c.createRadialGradient(-7, -9, 1, 0, 0, 23);
  g.addColorStop(0, football ? "#f6ffb0" : "#fffbc2");
  g.addColorStop(0.55, football ? "#c7ef55" : "#ffdb35");
  g.addColorStop(1, football ? "#397621" : "#bb7105");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, 0, 19, height, 0, 0, 7);
  c.fill();
  if (football) {
    for (const [px, py, radius] of [[0, 0, 7], [-13, -10, 5], [13, 9, 5]]) {
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5 - Math.PI / 2;
        c.lineTo(px + Math.cos(a) * radius, py + Math.sin(a) * radius);
      }
      c.closePath();
      c.fillStyle = "#397a24";
      c.fill();
    }
  }
  c.fillStyle = "#ffffe8b0";
  c.beginPath();
  c.ellipse(-7, -7, 5, 3, -0.5, 0, 7);
  c.fill();
  c.restore();
}
const turfPatterns = new WeakMap();
function grassPattern(context) {
  if (turfPatterns.has(context)) return turfPatterns.get(context);
  const tile = document.createElement("canvas");
  tile.width = tile.height = 128;
  const g = tile.getContext("2d"),
    pixels = g.createImageData(128, 128);
  let seed = 20803;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = ((seed >>> 16) % 53) - 26;
    const blade = ((i / 4) % 128) % 3 === 0 ? 4 : -2;
    // Reference samples cluster near RGB(80, 152, 44); compensate the fine
    // grain for downsampling to preserve its saturated yellow-green appearance.
    pixels.data[i] = 70 + grain + blade;
    pixels.data[i + 1] = 152 + grain + blade;
    pixels.data[i + 2] = 26 + Math.round(grain * 0.55);
    pixels.data[i + 3] = 255;
  }
  g.putImageData(pixels, 0, 0);
  const pattern = context.createPattern(tile, "repeat");
  turfPatterns.set(context, pattern);
  return pattern;
}

let foamTiles;
function drawItem(c, x, y, kind, placed = false) {
  c.save(); c.translate(x, y);
  c.lineWidth = 2; c.lineJoin = "round";
  if (kind === "glue" && placed) {
    c.fillStyle = "#a983e0bb"; c.strokeStyle = "#e5c7ff";
    c.beginPath(); c.ellipse(0, -2, 23, 9, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = "#f5ddff";
    for (const [dx, dy, r] of [[-10, -5, 3], [4, -1, 4], [12, -6, 2]]) {
      c.beginPath(); c.arc(dx, dy, r, 0, 7); c.fill();
    }
  } else if (kind === "glue") {
    round(c, -13, -34, 26, 32, 7, "#b6dbff", "#446bac");
    round(c, -8, -40, 16, 10, 3, "#d294f4", "#654594");
    round(c, -10, -22, 20, 16, 4, "#ad80dc");
    c.fillStyle = "#fff"; c.font = "bold 12px sans-serif"; c.fillText("3", 0, -10);
  } else if (kind === "banana") {
    c.translate(0, placed ? -2 : -12);
    c.fillStyle = "#ffe25c"; c.strokeStyle = "#a97916";
    for (const side of [-1, 1]) {
      c.beginPath(); c.moveTo(0, -14); c.quadraticCurveTo(side * 8, 0, side * 26, 1);
      c.quadraticCurveTo(side * 16, 15, 0, -3); c.closePath(); c.fill(); c.stroke();
    }
    c.beginPath(); c.moveTo(0, -12); c.quadraticCurveTo(14, -10, 9, 12);
    c.quadraticCurveTo(-7, 8, 0, -12); c.fill(); c.stroke();
    round(c, -3, -20, 6, 10, 2, "#8b7026");
  } else if (kind === "shoe") {
    c.fillStyle = "#57c0ee"; c.strokeStyle = "#2a638c";
    c.beginPath(); c.moveTo(-20, -26); c.lineTo(-6, -28); c.lineTo(4, -15);
    c.quadraticCurveTo(25, -16, 25, -5); c.lineTo(-20, -5); c.closePath(); c.fill(); c.stroke();
    round(c, -22, -7, 49, 7, 3, "#fff7dc", "#648da0");
    c.strokeStyle = "#fff";
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-7 + i * 5, -18 + i * 3); c.lineTo(2 + i * 5, -22 + i * 3); c.stroke(); }
  } else if (kind === "fork") {
    c.strokeStyle = "#edf8ff"; c.lineWidth = 5; c.beginPath();
    c.moveTo(0, -2); c.lineTo(0, -29); c.moveTo(-10, -38); c.lineTo(-10, -25);
    c.quadraticCurveTo(0, -17, 10, -25); c.lineTo(10, -38); c.moveTo(0, -38); c.lineTo(0, -25); c.stroke();
  } else {
    round(c, -13, -30, 26, 30, 7, "#e4eda3", "#64882b");
    star(c, 0, -14, 9, 4, "#6c9938");
  }
  c.restore();
}
function drawFoam(c, blasts, time, cx, cy) {
  if (!blasts.length) return;
  if (!foamTiles) foamTiles = Array.from({length:4}, (_, phase) => {
    const tile=document.createElement('canvas'); tile.width=tile.height=C;
    const g=tile.getContext('2d');
    const fill=g.createLinearGradient(0,0,0,C);
    fill.addColorStop(0,'#fff09b'); fill.addColorStop(0.5,'#ffcc33'); fill.addColorStop(1,'#f6aa16');
    g.fillStyle=fill; g.fillRect(0,0,C,C);
    let seed=4927+phase*131;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<105;i++) {
      const x=rand()*C,y=rand()*C,r=1+rand()*5;
      g.lineWidth=0.8+rand()*1.2; g.strokeStyle=i%3?'#fffbd2bb':'#ed991c88';
      g.beginPath();g.arc(x,y,r,rand()*3,Math.PI*(1.2+rand()));g.stroke();
    }
    return tile;
  });
  const cells=new Map(blasts.map(b=>[`${b.x},${b.y}`,b]));
  for(const b of cells.values()) {
    const x=cx(b.x)-CELL_WIDTH/2,y=cy(b.y)-CELL_HEIGHT/2;
    c.drawImage(foamTiles[(Math.floor(time/95)+b.x+b.y)%4],x,y,CELL_WIDTH,CELL_HEIGHT);
    c.strokeStyle='#fff7c8';c.lineWidth=3;c.beginPath();
    for(const [dx,dy,x1,y1,x2,y2] of [[0,-1,0,1,CELL_WIDTH,1],[0,1,0,CELL_HEIGHT-1,CELL_WIDTH,CELL_HEIGHT-1],[-1,0,1,0,1,CELL_HEIGHT],[1,0,CELL_WIDTH-1,0,CELL_WIDTH-1,CELL_HEIGHT]]) {
      if(cells.has(`${b.x+dx},${b.y+dy}`))continue;
      // Soft scalloped foam rims only on exposed edges; adjacent cells merge.
      const dxp=x2-x1,dyp=y2-y1,len=Math.hypot(dxp,dyp);
      c.moveTo(x+x1,y+y1);
      for(let k=1;k<=8;k++) {
        const t=k/8,mid=(k-0.5)/8,bulge=k%2?2.5:-1;
        c.quadraticCurveTo(x+x1+dxp*mid-dyp/len*bulge,y+y1+dyp*mid+dxp/len*bulge,x+x1+dxp*t,y+y1+dyp*t);
      }
    }
    c.stroke();
  }
}

export function render(
  c, s, time,
  { own = 0, positions = new Map(), motionFrame = simulationFrame(s) } = {},
) {
  c.clearRect(0, 0, 960, 800);
  c.fillStyle = "#218c12";
  c.fillRect(0, 0, 960, 800);
  const painted = drawStadium(c);
  if (!painted) {
  // Stadium architecture and a whole crowd of tiny supporters.
  round(c, 0, 0, 960, 104, 0, "#0a659a");
  const colors = [
    "#ffba76",
    "#2ecfff",
    "#f44536",
    "#bc68ed",
    "#ffdc27",
    "#ece9dc",
  ];
  for (let row = 0; row < 4; row++)
    for (let i = 0; i < 43; i++) {
      const x = 24 + i * 22 + (row % 2) * 9,
        y = 14 + row * 23,
        col = colors[(i * 7 + row * 3) % 6];
      c.fillStyle = col;
      c.beginPath();
      c.arc(x, y, 10, 0, 7);
      c.fill();
      round(c, x - 9, y + 7, 18, 11, 3, col);
      c.fillStyle = "#264738";
      c.fillRect(x - 3, y - 1, 1.5, 2);
      c.fillRect(x + 2, y - 1, 1.5, 2);
    }
  // Low advertising barriers and the in-stadium score display.
  round(c, 18, 104, 924, 20, 0, "#c5f2ff", "#1378a9");
  for (let i = 0; i < 15; i++) {
    round(
      c,
      19 + i * 62,
      105,
      59,
      17,
      0,
      ["#2e9ac7", "#f34e21", "#e2ebcd"][i % 3],
      "#267a99",
    );
  }
  round(c, 420, 20, 120, 58, 1, "#134d69", "#efca65");
  round(c, 427, 27, 106, 44, 0, "#172930", "#71afc3");
  c.textAlign = "center";
  c.font = "bold 29px monospace";
  c.fillStyle = "#82e6ff";
  c.fillText(`${s.scores[0]}:${s.scores[1]}`, 480, 59);
  // Fine grass grain remains visible underneath the alternating mowing bands.
  c.fillStyle = grassPattern(c);
  c.fillRect(0, 125, 960, 595);
  c.fillRect(X, Y, COLS * C, ROWS * C);
  }
  // Original football02 alternates one vertical mowing band per lawn column.
  // Tint the grass before markings and actors, keeping its texture and the cones.
  c.save();
  c.globalCompositeOperation = "multiply";
  c.fillStyle = "#1b591c55";
  const turfTop = painted ? Y : 125;
  for (let column = 1; column < COLS; column += 2) {
    c.fillRect(PLAYER_EDGE_X + (column - 0.5) * CELL_WIDTH, turfTop,
      CELL_WIDTH, 800 - turfTop);
  }
  c.restore();
  c.textAlign = "center";
  c.font = "bold 29px monospace";
  c.fillStyle = "#8bd4ed";
  c.fillText(`${s.scores[0]}:${s.scores[1]}`, 480, painted ? 163 : 65);
  c.save();
  c.translate(0, Y);
  c.scale(1, CY / C);
  c.translate(0, -Y);
  c.strokeStyle = "#f0f5c6dd";
  c.lineWidth = 4;
  c.strokeRect(PITCH_LEFT, Y + 9, PITCH_RIGHT - PITCH_LEFT, 11 * C - 18);
  c.beginPath();
  c.moveTo(480, Y + 9);
  c.lineTo(480, Y + 11 * C - 9);
  c.stroke();
  c.beginPath();
  c.arc(480, Y + (11 * C) / 2, 96, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = "#f0f8c6";
  c.beginPath();
  c.arc(480, Y + (11 * C) / 2, 4, 0, 7);
  c.fill();
  c.strokeRect(PITCH_LEFT, Y + 156, 130, 260);
  c.strokeRect(PITCH_RIGHT - 130, Y + 156, 130, 260);
  c.strokeRect(PITCH_LEFT, Y + 220, 52, 132);
  c.strokeRect(PITCH_RIGHT - 52, Y + 220, 52, 132);
  // Join each net to its sideline, leaving space beside the outer cone row.
  for (const goal of GOALS) {
    const gx = PLAYER_EDGE_X + goal.minX / 1000 * CELL_WIDTH,
      gy = Y + (GROUND_Y + goal.minY / 1000 * CELL_HEIGHT - Y) * C / CY,
      gw = (goal.maxX - goal.minX) / 1000 * CELL_WIDTH,
      gh = (goal.maxY - goal.minY) / 1000 * CELL_HEIGHT * C / CY;
    round(c, gx, gy, gw, gh, 4, "#e8ead71c", "#ff432a");
    c.strokeStyle = "#f4ffdcaa";
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      c.beginPath();
      c.moveTo(gx + i * gw / 4, gy);
      c.lineTo(gx + i * gw / 4, gy + gh);
      c.stroke();
    }
    for (let i = 0; i <= 14; i++) {
      c.beginPath();
      c.moveTo(gx, gy + i * gh / 14);
      c.lineTo(gx + gw, gy + i * gh / 14);
      c.stroke();
    }
  }
  c.restore();
  if (!painted) for (let i = 0; i < 12; i++) {
    for (const x of [25, 935]) {
      const y = 143 + i * 49;
      const dark = i % 2 ? "#c53e03" : "#4433b9";
      const bright = i % 2 ? "#ff791d" : "#7d6aff";
      c.fillStyle = dark;
      c.beginPath();
      c.ellipse(x, y + 16, 23, 10, 0, 0, 7);
      c.fill();
      for (let tier = 0; tier < 4; tier++) {
        const radius = 21 - tier * 4,
          ty = y + 12 - tier * 7;
        const gradient = c.createLinearGradient(x - radius, ty, x + radius, ty);
        gradient.addColorStop(0, dark);
        gradient.addColorStop(0.38, bright);
        gradient.addColorStop(0.65, "#ffffff");
        gradient.addColorStop(1, dark);
        c.fillStyle = gradient;
        c.beginPath();
        c.ellipse(x, ty, radius, 7, 0, 0, 7);
        c.fill();
      }
    }
  }
  const cx = (x) => PLAYER_EDGE_X + x * CELL_WIDTH,
    cy = (y) => GROUND_Y + y * CELL_HEIGHT;
  const actors = [];
  const shadows = [];
  for (const [i, p] of s.players.entries()) {
    if (p.status === "out") continue;
    const pose = positions.get(i) || p, x = cx(pose.x), y = cy(pose.y);
    shadows.push({x, y, width: p.status === 'bubble' ? 27 : 23, height: 6, opacity: 0.48});
    actors.push({type: 'player', x, y, depth: y, p, i});
  }
  for (const item of s.items) {
    const x = cx(item.x), y = cy(item.y);
    shadows.push({x, y, width: 16, height: 5, opacity: 0.3});
    actors.push({type:'item',x,y,depth:y,kind:item.kind});
  }
  for (const trap of s.traps || []) {
    const x = cx(trap.x), y = cy(trap.y);
    actors.push({type:'item',x,y,depth:y-1,kind:trap.kind,placed:true});
  }
  for (const d of s.itemDrops || []) {
    const progress = Math.max(0, Math.min(1, (motionFrame / 5 - d.start) / (d.at - d.start)));
    const x = cx(d.fromX) + (cx(d.x) - cx(d.fromX)) * progress;
    const y = Y - 85 + (cy(d.y) - Y + 85) * progress - Math.sin(progress * Math.PI) * 80;
    shadows.push({x:cx(d.x),y:cy(d.y),width:12+progress*6,height:4,opacity:0.2});
    actors.push({type:'item',x,y,depth:cy(d.y),kind:d.kind,placed:d.placed});
  }
  for (const d of s.drops) {
    const progress = Math.max(0, Math.min(1, (motionFrame / 5 - d.start) / (d.at - d.start)));
    const x = cx(d.fromX) + (cx(d.x) - cx(d.fromX)) * progress;
    const y = Y - 85 + (cy(d.y) - Y + 85) * progress - Math.sin(progress * Math.PI) * 80;
    shadows.push({x:cx(d.x),y:cy(d.y),width:12+progress*8,height:4+progress*2,opacity:0.14+progress*0.2});
    actors.push({type:'ball',x,y,depth:cy(d.y),kind:d.kind,fuse:BOMB.fuseTicks});
  }
  for (const b of s.balls) {
    let x = cx(b.x), y = cy(b.y), elevation = 0;
    if (b.flight) {
      const f = b.flight;
      const progress = Math.max(0, Math.min(1, (motionFrame-f.start)/(f.end-f.start)));
      const axis = (from, delta, span, offset, to) => {
        const position = from + offset + delta * (f.distance || BOMB.kickDistance) * progress;
        return progress === 1 ? to : ((position % span)+span) % span-offset;
      };
      x = cx(axis(f.x,[1,0,-1,0][b.dir],15,1,b.x));
      y = cy(axis(f.y,[0,1,0,-1][b.dir],13,4,b.y));
      elevation = Math.sin(progress*Math.PI)*100;
    }
    shadows.push({x,y,width:19-elevation*0.055,height:5,opacity:0.38-elevation*0.002});
    actors.push({type:'ball',x,y:y-elevation,depth:y,kind:b.kind,fuse:b.fuse-s.tick});
  }
  for (const sh of shadows) groundShadow(c, sh.x, sh.y+2, sh.width, sh.height, sh.opacity);
  drawFoam(c, s.blasts, time, cx, cy);
  actors.sort((a,b) => a.depth-b.depth);
  for (const a of actors) {
    if (a.type === 'ball') ball(c,a.x,a.y,a.fuse,time,a.kind);
    else if (a.type === 'item') {
      drawItem(c, a.x, a.y + (a.placed ? 0 : Math.sin(time / 350) * 2), a.kind, a.placed);
    } else {
      const {p,i,x,y} = a;
      drawPlayer(c,x,y,i,{bubble:p.status==='bubble',shield:p.shield||p.immune>s.tick,
        dir:p.dir,moving:p.moving,time,shadow:false,stride:p.moving?Math.sin(time/60):0});
    }
  }
  // Labels belong above the full sprite, not through its face.
  for (const a of actors) if (a.type === 'player') {
    const {p,i,x,y} = a;
    c.textAlign='center'; c.font='bold 11px sans-serif';
    const name=(p.name||'球员').slice(0,8)+(i===own?' · 你':'');
    c.lineWidth=3; c.strokeStyle='#234627cc'; c.strokeText(name,x,y-88);
    c.fillStyle=i===own?'#fff6a0':'#f5ffe4'; c.fillText(name,x,y-88);
    if ((p.slideDir ?? -1) >= 0 || (p.slowUntil || 0) > s.tick) {
      c.fillStyle = (p.slideDir ?? -1) >= 0 ? "#fff0a7" : "#e0bcff";
      c.fillText((p.slideDir ?? -1) >= 0 ? "滑行" : "减速", x, y + 20);
    }
    if (i===own) star(c,x,y+11,5,3,'#fff5bd',Math.PI);
    if (p.status==='bubble') {
      c.font='bold 15px sans-serif'; c.strokeText(Math.ceil((p.until-s.tick)/10),x,y-36);
      c.fillStyle='#fff8e3'; c.fillText(Math.ceil((p.until-s.tick)/10),x,y-36);
    }
  }
  if (s.phase === "countdown") {
    round(c, 420, 310, 120, 120, 30, "#fff8e9ec");
    c.font = "bold 66px sans-serif";
    c.fillStyle = "#315e43";
    c.fillText(String(Math.max(1, 3 - Math.floor(s.tick / 10))), 480, 395);
  }
}
