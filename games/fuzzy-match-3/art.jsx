/** @jsxImportSource preact */
import { useId } from "preact/hooks";
import { TILE_THEME } from "./theme.js";

import {
  ArrowLeft, ArrowRight, ChartColumnIncreasing, Check, CircleHelp,
  Lightbulb, LockKeyhole, Map, Pause, PawPrint, Play, RotateCcw, Settings, Shuffle,
  Sparkle, Sparkles, Star, Sun, Trophy, Volume2, VolumeX, X,
  PaintBucket, ScanEye, ArrowDownToLine,
} from "lucide-preact";

const ICONS = {
  paint: PaintBucket,
  reveal: ScanEye,
  deliver: ArrowDownToLine,
  play: Play,
  map: Map,
  lock: LockKeyhole,
  sun: Sun,
  chart: ChartColumnIncreasing,
  gear: Settings,
  pause: Pause,
  sound: Volume2,
  mute: VolumeX,
  hint: Lightbulb,
  shuffle: Shuffle,
  restart: RotateCcw,
  arrow: ArrowRight,
  back: ArrowLeft,
  close: X,
  check: Check,
  paw: PawPrint,
  help: CircleHelp,
  trophy: Trophy,
  star: Star,
  sparkle: Sparkle,
  sparkles: Sparkles,
};

export function Icon({ name, size = 22, ...props }) {
  const Component = ICONS[name] || CircleHelp;
  return <Component size={size} strokeWidth={1.7} aria-hidden="true" {...props} />;
}

export function Ice({ layers = 1, className = "" }) {
  return (
    <svg
      class={`ice-shell ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M12 4 47 3 61 17 59 49 47 61 14 59 3 46 4 17Z"
        fill={layers > 1 ? "#b5e0f27a" : "#d3edf45c"}
        stroke="#93cbdacc"
        stroke-width="1.5"
      />
      <path
        d="m12 4 7 11 29-1L47 3M4 17l15-2-5 32L3 46m11 13V47l33 3v11m12-12-12 1 1-36 13 3"
        fill="none"
        stroke="#f5fdffcc"
        stroke-width="2"
      />
      <path
        d={
          layers > 1
            ? "m24 7 8 14-8 12 15 11-5 14M24 33l-13-5m28 16 14-10"
            : "m43 5-9 17 9 7-6 12 15 14"
        }
        fill="none"
        stroke="#85bdce99"
        stroke-width={layers > 1 ? "2" : "1.3"}
      />
      <path
        d="m11 20 4-7 9-1m22 43 7-7"
        fill="none"
        stroke="#fff"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </svg>
  );
}

function Eyes({ y = 35, color = "#493d4c" }) {
  return (
    <g fill={color}>
      <ellipse cx="23" cy={y} rx="2.6" ry="3.4" />
      <ellipse cx="43" cy={y} rx="2.6" ry="3.4" />
      <circle cx="22.3" cy={y - 1} r="0.8" fill="#fffaf1" />
      <circle cx="42.3" cy={y - 1} r="0.8" fill="#fffaf1" />
    </g>
  );
}
function Smile({ y = 51, color = "#71515d" }) {
  return <path d={`M33 ${y - 3}v3m-6 0q3 5 6 0 3 5 6 0`} fill="none" stroke={color} stroke-width="1.6" stroke-linecap="round" />;
}

export function Animal({ type = 0, special = null, className = "" }) {
  const stripeMask = useId();
  if (special === "color")
    return (
      <svg class={`tile-art animal rainbow-token ${className}`} viewBox="0 0 66 72" aria-hidden="true">
        <circle cx="33" cy="38" r="28" fill="#dbc88f" />
        <circle cx="33" cy="36" r="26" fill="#fff3d5" stroke="#f5d78c" stroke-width="1.5" />
        <circle cx="33" cy="15" r="6" fill="#f2d786" />
        <circle cx="51" cy="26" r="6" fill="#ed8350" />
        <circle cx="51" cy="47" r="6" fill="#b39ada" />
        <circle cx="33" cy="57" r="6" fill="#c49772" />
        <circle cx="15" cy="47" r="6" fill="#79b5dd" />
        <circle cx="15" cy="26" r="6" fill="#92c96b" />
        <g fill="#c39a58">
          <ellipse cx="24" cy="32" rx="3.3" ry="4.3" transform="rotate(-24 24 32)" />
          <ellipse cx="32" cy="27" rx="3.3" ry="4.3" />
          <ellipse cx="41" cy="31" rx="3.3" ry="4.3" transform="rotate(24 41 31)" />
          <path d="M23 43c0-5 6-10 10-10s10 5 10 10c0 7-6 3-10 3s-10 4-10-3Z" />
        </g>
      </svg>
    );
  const animals = [
    <>
      <path d="M12 29 10 7q11 1 17 14Zm42 0 2-22q-11 1-17 14Z" fill="#dfb965" />
      <path d="m15 23-1-10 10 10m27 0 1-10-10 10" fill="#f1c3a3" />
      <path d="M12 29c2-11 12-15 21-15s19 4 21 15l4 13c3 12-10 24-25 24S5 54 8 42Z" fill="#f2d786" />
      <path d="M12 39c5 5 10 8 16 5l5-5 5 5c6 3 11 0 16-5l2 10c0 10-10 17-23 17S10 59 10 49Z" fill="#fff5df" />
      <ellipse cx="22" cy="27" rx="4" ry="2.2" fill="#fff0c9" transform="rotate(-12 22 27)" />
      <ellipse cx="44" cy="27" rx="4" ry="2.2" fill="#fff0c9" transform="rotate(12 44 27)" />
      <path d="M18 35q5-5 10 0-5 5-10 0Zm20 0q5-5 10 0-5 5-10 0Z" fill="#5b4738" />
      <circle cx="22" cy="34" r="0.8" fill="#fffaf1" />
      <circle cx="42" cy="34" r="0.8" fill="#fffaf1" />
      <path d="M28 43q5-3 10 0c0 4-3 6-5 6s-5-2-5-6" fill="#6b5142" />
      <path d="M33 49v6m-6-2q6 4 12 0" fill="none" stroke="#795d48" stroke-width="1.6" stroke-linecap="round" />
    </>,
    <>
      <circle cx="15" cy="18" r="10" fill="#c9643e" />
      <circle cx="51" cy="18" r="10" fill="#c9643e" />
      <circle cx="15" cy="18" r="5.5" fill="#ffcb9f" />
      <circle cx="51" cy="18" r="5.5" fill="#ffcb9f" />
      <path d="M10 31c1-13 10-18 23-18s22 5 23 18l4 13-7 1 5 8-9 1c-3 8-9 12-16 12S20 62 17 54l-9-1 5-8-7-1Z" fill="#ed8350" />
      <g fill="#7f4633">
        <path d="m28 15 5 14 5-14Zm-16 9 10 6-12 1Zm43 0-11 6 12 1ZM8 37l12 4-10 4Zm50 0-12 4 10 4Z" />
      </g>
      <path d="M16 49c0-8 10-9 17-6 7-3 17-2 17 6 0 10-10 15-17 15s-17-5-17-15" fill="#ffe9ce" />
      <Eyes y={35} color="#603b2f" />
      <path d="m27 44 6-2 6 2-6 6Z" fill="#a85f4a" />
      <Smile y={54} color="#7f4633" />
      <path d="m17 50-9-1m9 6-8 2m40-7 9-1m-9 6 8 2" stroke="#ac7053" stroke-width="1.5" stroke-linecap="round" />
    </>,
    <>
      <path d="M24 22c-5-6-2-14 3-15l6 11c-1-9 4-13 8-12l-1 14c4-7 9-8 12-4l-8 10Z" fill="#9273bd" />
      <path d="M9 40c0-15 9-24 24-24s24 9 24 24v7c0 13-9 20-24 20S9 60 9 47Z" fill="#b39ada" />
      <path d="M10 39C2 45 5 58 16 60l4-17m36-4c8 6 5 19-6 21l-4-17" fill="#9273bd" />
      <path d="M16 43c0-9 8-14 17-14s17 5 17 14v7c0 9-8 14-17 14s-17-5-17-14Z" fill="#dfcfef" />
      <Eyes y={35} color="#57416f" />
      <path d="m27 44 6-5 6 5-6 9Z" fill="#efb953" />
      <path d="M27 44h12" stroke="#c8903e" stroke-width="1.2" stroke-linecap="round" />
      <path d="m23 56 3 3m7-3v4m10-4-3 3" fill="none" stroke="#b79ccc" stroke-width="1.8" stroke-linecap="round" />
      <path d="M18 26q3-4 8-5" fill="none" stroke="#d5c2ed" stroke-width="3" stroke-linecap="round" />
    </>,
    <>
      <circle cx="14" cy="18" r="11" fill="#a47c59" />
      <circle cx="52" cy="18" r="11" fill="#a47c59" />
      <circle cx="14" cy="18" r="6" fill="#e0bc94" />
      <circle cx="52" cy="18" r="6" fill="#e0bc94" />
      <path d="M7 40c0-17 10-26 26-26s26 9 26 26c0 17-10 26-26 26S7 57 7 40" fill="#c49772" />
      <path d="M18 49c0-10 8-15 15-15s15 5 15 15c0 9-8 14-15 14s-15-5-15-14" fill="#efd5b5" />
      <Eyes y={35} color="#503b30" />
      <path d="M26 44q7-5 14 0c0 5-5 7-7 7s-7-2-7-7" fill="#684a38" />
      <Smile y={55} color="#805c46" />
      <path d="M14 29q3-7 9-8" stroke="#e2bd96" stroke-width="3" fill="none" stroke-linecap="round" />
    </>,
    <>
      <path d="M18 28C5 28 1 19 6 8c1 11 6 12 15 10Zm30 0C61 28 65 19 60 8c-1 11-6 12-15 10Z" fill="#ffe7af" />
      <path d="M19 28C9 20 2 25 3 34c7 4 14 2 19-1m25-5c10-8 17-3 16 6-7 4-14 2-19-1" fill="#4c87b3" />
      <path d="M14 31c0-12 10-17 19-17s19 5 19 17l6 20c1 11-10 16-25 16S7 62 8 51Z" fill="#79b5dd" />
      <path d="m26 17 7 13 7-13Z" fill="#d1e8ef" />
      <Eyes y={35} color="#35546e" />
      <ellipse cx="33" cy="53" rx="23" ry="13" fill="#c6e0ed" />
      <ellipse cx="23" cy="51" rx="2.5" ry="3" fill="#7099b5" />
      <ellipse cx="43" cy="51" rx="2.5" ry="3" fill="#7099b5" />
      <path d="M27 60q6 3 12 0" stroke="#7099b5" stroke-width="1.6" fill="none" stroke-linecap="round" />
    </>,
    <>
      <path d="m17 24-7-14 10 2 3 14m20 0 3-14 10-2-7 14" fill="#f3ca83" />
      <path d="m18 28-15-7 3 17 11 4m31-14 15-7-3 17-11 4" fill="#66a45b" />
      <path d="M16 27c0-9 8-14 17-14s17 5 17 14l9 11-5 5 3 10-11 3c-4 8-22 8-26 0L9 53l3-10-5-5Z" fill="#92c96b" />
      <path d="m25 18 8-13 8 13-8-3Z" fill="#629b50" />
      <path d="m29 24 4 4 4-4m-8 6 4 4 4-4" fill="none" stroke="#6f9f53" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <Eyes y={37} color="#3d633d" />
      <path d="M16 49c0-7 9-10 17-10s17 3 17 10c0 10-8 15-17 15S16 59 16 49" fill="#d1e9ac" />
      <ellipse cx="25" cy="47" rx="2" ry="2.5" fill="#91a955" />
      <ellipse cx="41" cy="47" rx="2" ry="2.5" fill="#91a955" />
      <path d="M26 56q7 5 14 0m-23-7-7 4m39-4 7 4" fill="none" stroke="#91a955" stroke-width="1.6" stroke-linecap="round" />
      <path d="m24 57 2 5 3-4m8 0 3 4 2-5" fill="#fff4d4" />
    </>,
  ];
  // Two 12-unit bands plus a 12-unit gap span about 60% of the widest animal.
  const stripe = special === "row" ? "M10 28h46M10 52h46" : "M21 18v45m24-45v45";
  return (
    <svg class={`tile-art animal ${className}`} viewBox="0 0 66 72" data-animal={TILE_THEME[type].id} aria-hidden="true">
      {animals[type]}
      {(special === "row" || special === "column") && (
        <>
          <defs>
            <mask id={stripeMask} x="0" y="0" width="66" height="72" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }}>
              {animals[type]}
            </mask>
          </defs>
          <path class="animal-stripes" d={stripe} fill="none" stroke="#fff9e8" stroke-width="12" stroke-linecap="round" opacity="0.78" mask={`url(#${stripeMask})`} />
        </>
      )}
    </svg>
  );
}


export function Delivery({ type }) {
  return <span class="delivery-token">
    <Animal type={type} />
    <svg class="delivery-basket" viewBox="0 0 66 72" aria-hidden="true">
      <path d="M8 43h50l-6 23H14Z" fill="#deb97d" stroke="#f9e4b9" stroke-width="2" />
      <path d="M19 46v16m14-16v16m14-16v16M12 53h43" stroke="#a77748" stroke-width="2" />
      <path d="M33 44v13m-5-5 5 5 5-5" fill="none" stroke="#fff5d9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>;
}

export function GoalFloor({ objective }) {
  if (!objective || objective.kind === "collect") return null;
  return <div class="board-ground" aria-hidden="true">
    {Array.from({ length: 64 }, (_, index) => {
      const target = objective.kind === "spread" && objective.cells.includes(index);
      const painted = target && objective.painted.includes(index);
      const group = objective.kind === "reveal" && objective.groups.find(group => group.cells.includes(index));
      const revealed = group && objective.revealed.includes(index);
      const complete = group && group.cells.every(i => objective.revealed.includes(i));
      const exit = objective.kind === "deliver" && index >= 56 && objective.exits.includes(index % 8);
      return <div key={index} class={`floor-cell ${target ? "paint-target" : ""} ${painted ? "painted" : ""} ${group ? "hidden-picture" : ""} ${revealed ? "revealed" : ""} ${complete ? "picture-complete" : ""} ${exit ? "delivery-exit" : ""}`}>
        {revealed && <span class="picture-fragment" style={{ left: `${-(index % 8 - group.cells[0] % 8) * 100}%`, top: `${-Math.floor((index - group.cells[0]) / 8) * 100}%` }}><Animal type={group.type} /></span>}
        {exit && <Icon name="deliver" size={14} />}
      </div>;
    })}
  </div>;
}
