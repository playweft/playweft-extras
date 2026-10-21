/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon, Animal, Ice, Delivery, GoalFloor } from "./art.jsx";
import { advanceObjective, collectDeliveries, isDelivery, objectiveProgress } from "./objectives.js";
import { DELIVERY_THEME, TILE_THEME } from "./theme.js";
import { planFalls } from "./falling.js";
import {
  adjacent,
  canSwap,
  createGame,
  findMatches,
  findMove,
  MOVE_BONUS,
  gameStatus,
  levelConfig,
  pendingColorClear,
  iceLayers,
  moveBonus,
  totalScore,
  refill,
  resolveWave,
  seededRandom,
  shuffleBoard,
  swap,
  restoreGame,
} from "./game.js";

const SWAP_MS = 220;
const RESULT_PAUSE_MS = 800;
const STORAGE = "playweft:fuzzy-match-3:v1";
const LEGACY_STORAGE = "playweft:fruit-isle:v1";
const LEVELS_PER_PAGE = 40;
const MAX_LEVEL = 10000;
function earnedStars(game) {
  if (game.status !== "won") return 0;
  return levelConfig(game.level).starTargets.filter(
    (target) => totalScore(game) >= target,
  ).length;
}
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function dailyGame(date) {
  const seed = Number(date.replaceAll("-", ""));
  return createGame(1, true, seededRandom(seed));
}
async function load(storage) {
  let data, parseError;
  for (const key of [STORAGE, LEGACY_STORAGE]) {
    const raw = await storage.getItem(key);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed;
        break;
      }
      parseError = new Error("Invalid saved profile");
    } catch (error) {
      parseError = error;
    }
  }
  if (!data && parseError) throw parseError;
  const date = todayKey();
  const adventure = restoreGame(data?.adventure) ?? createGame();
  const daily =
    (data?.date === date && restoreGame(data?.daily)) || dailyGame(date);
  const levelStars = {};
  for (const [key, stars] of Object.entries(data?.levelStars ?? {})) {
    const level = Number(key);
    if (
      Number.isInteger(level) &&
      level >= 1 &&
      level <= MAX_LEVEL &&
      Number.isInteger(stars) &&
      stars >= 1 &&
      stars <= 3
    )
      levelStars[level] = stars;
  }
  if (adventure.status === "won")
    levelStars[adventure.level] = Math.max(
      levelStars[adventure.level] || 0,
      earnedStars(adventure),
    );
  return {
    adventure,
    daily,
    levelStars,
    date,
    lastDailyWin:
      typeof data?.lastDailyWin === "string" ? data.lastDailyWin : null,
    sound: data?.sound === true,
    stats: {
      wins: Math.max(0, Number(data?.stats?.wins) || 0),
      best: Math.max(
        0,
        Number(data?.stats?.best) || 0,
        totalScore(adventure),
        totalScore(daily),
      ),
      eliminated: Math.max(
        0,
        Number(data?.stats?.eliminated ?? data?.stats?.fruit) || 0,
      ),
      dailyWins: Math.max(0, Number(data?.stats?.dailyWins) || 0),
    },
  };
}
const format = (n) => n.toLocaleString("zh-CN");

function GameButton({
  locked = false,
  disabled = false,
  class: className = "",
  children,
  ...props
}) {
  return (
    <button
      type="button"
      {...props}
      class={`game-button ${className}`.trim()}
      disabled={locked || disabled}
      data-state={disabled ? "unavailable" : locked ? "locked" : undefined}
    >
      {children}
    </button>
  );
}

function StorageGate({ error, retry, saving = false }) {
  const button = useRef();
  useLayoutEffect(() => {
    button.current?.focus();
  }, [error]);
  return (
    <div class="storage-gate">
      {error ? (
        <div
          class="storage-failure"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="storage-title"
          aria-describedby="storage-reason"
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              button.current.focus();
            }
          }}
        >
          <h2 id="storage-title">存档{saving ? "保存" : "读取"}失败</h2>
          <p id="storage-reason">{error.message || String(error)}</p>
          {error.code && <code>{error.code}</code>}
          <button ref={button} type="button" onClick={retry}>
            重试{saving ? "保存" : "读取"}
          </button>
        </div>
      ) : (
        <p role="status">正在读取存档…</p>
      )}
    </div>
  );
}

export function FuzzyMatch3App({ storage }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    load(storage).then(
      (value) => {
        if (active) setProfile(value);
      },
      (reason) => {
        if (active) setError(reason);
      },
    );
    return () => {
      active = false;
    };
  }, [storage, attempt]);
  if (!profile)
    return (
      <StorageGate error={error} retry={() => retry((value) => value + 1)} />
    );
  return <FuzzyGame initialProfile={profile} storage={storage} />;
}

function FuzzyGame({ initialProfile, storage }) {
  const [profile, setProfile] = useState(() => initialProfile);
  const [mode, setMode] = useState("adventure");
  const [scoreTrackKey, setScoreTrackKey] = useState(0);
  const [view, setView] = useState(null);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelPage, setLevelPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [hint, setHint] = useState([]);
  const [clearing, setClearing] = useState([]);
  const [converting, setConverting] = useState([]);
  const [breaking, setBreaking] = useState([]);
  const [falling, setFalling] = useState(null);
  const [exchange, setExchange] = useState(null);
  const [turnProgress, setTurnProgress] = useState(null);
  const [busy, setBusy] = useState(() => pendingColorClear(profile[mode].board) >= 0);
  const [chainLabel, setChainLabel] = useState(null);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const [saveAttempt, retrySave] = useState(0);
  const active = profile[mode];
  const [board, setBoard] = useState(active.board);
  const config = levelConfig(active.level, mode === "daily");
  const lock = useRef(false);
  const generation = useRef(0);
  const timers = useRef(new Map());
  const hintTimer = useRef();
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const boardRef = useRef();
  const dialogRef = useRef();
  const levelsHeadingRef = useRef();
  const audio = useRef(null);
  const live = useRef({ profile, mode, active, board, view });
  live.current = { profile, mode, active, board, view, levelsOpen };

  const delay = (ms, { animation = true } = {}) =>
    new Promise((resolve) => {
      const id = setTimeout(
        () => {
          timers.current.delete(id);
          resolve();
        },
        animation && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? 30
          : ms,
      );
      timers.current.set(id, resolve);
    });
  function tone(chain = 1) {
    if (!live.current.profile.sound) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio.current ??= new Context();
      const context = audio.current;
      context.resume().catch(() => {});
      const osc = context.createOscillator(),
        gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(360 + chain * 95, context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        620 + chain * 90,
        context.currentTime + 0.13,
      );
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      osc.start();
      osc.stop(context.currentTime + 0.21);
    } catch {
      /* Audio is optional. */
    }
  }
  function clearHint() {
    clearTimeout(hintTimer.current);
    setHint([]);
  }
  function updateGame(next) {
    setProfile((p) => ({ ...p, [live.current.mode]: next }));
  }
  function dismiss() {
    const current = live.current;
    if (current.levelsOpen && current.view !== "levels") {
      setView("levels");
    } else {
      setLevelsOpen(false);
      setView(null);
    }
  }

  useEffect(() => {
    let active = true;
    const raw = JSON.stringify(profile);
    setSaved(null);
    // The shared adapter serializes writes; only the latest committed snapshot
    // can change the UI to saved. Cleanup never removes the previous save first.
    Promise.resolve()
      .then(() => storage.setItem(STORAGE, raw))
      .then(() => {
        if (active) {
          setSaved(true);
          setSaveError(null);
        }
        return Promise.resolve()
          .then(() => storage.removeItem(LEGACY_STORAGE))
          .catch(() => {});
      })
      .catch((error) => {
        if (active) {
          setSaved(false);
          setSaveError(error);
        }
      });
    return () => {
      active = false;
    };
  }, [profile, storage, saveAttempt]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setSelected(null);
        clearHint();
        if (live.current.view) dismiss();
        else if (live.current.active.status === "playing") setView("pause");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      generation.current++;
      for (const [id, resolve] of timers.current) {
        clearTimeout(id);
        resolve();
      }
      timers.current.clear();
      clearTimeout(hintTimer.current);
      audio.current?.close().catch(() => {});
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    const current = live.current;
    if (lock.current || pendingColorClear(current.board) < 0) return;
    lock.current = true;
    setBusy(true);
    setView(null);
    setSelected(null);
    clearHint();
    const next = {
      ...current.active,
      collected: [...current.active.collected],
    };
    void settleTurn(
      current.active,
      next,
      current.board,
      current.mode,
      [],
      generation.current,
    );
  }, [mode]);
  const result = active.status !== "playing" && !busy;
  useLayoutEffect(() => {
    if (
      !falling ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animations = [];
    const startTime = document.timeline?.currentTime;
    for (const [id, path] of falling.paths) {
      const cell = boardRef.current?.querySelector(`[data-tile-id="${id}"]`);
      if (!cell?.animate) continue;
      const rect = cell.getBoundingClientRect();
      const end = path.at(-1).index;
      const row = (index) => Math.floor(index / 8);
      const col = (index) => ((index % 8) + 8) % 8;
      const animation = cell.animate(
        path.map(({ index, tick }) => ({
          transform: `translate(${(col(index) - col(end)) * rect.width}px, ${(row(index) - row(end)) * rect.height}px)`,
          offset: tick / falling.steps,
        })),
        { id: "tile-fall", duration: falling.duration, easing: "linear" },
      );
      if (typeof startTime === "number") animation.startTime = startTime;
      animations.push(animation);
    }
    return () => animations.forEach((animation) => animation.cancel());
  }, [falling]);
  useEffect(() => {
    if (!view && !result) return;
    const previous = document.activeElement;
    if (view === "levels") levelsHeadingRef.current?.focus();
    else dialogRef.current?.focus();
    return () => previous?.isConnected && previous.focus();
  }, [view, result]);

  async function attempt(a, b) {
    const {
      active: game,
      board: currentBoard,
      mode: currentMode,
      view: currentView,
    } = live.current;
    if (
      lock.current ||
      currentView ||
      game.status !== "playing" ||
      pendingColorClear(currentBoard) >= 0 ||
      !currentBoard[a] ||
      !currentBoard[b] ||
      currentBoard[a]?.ice ||
      currentBoard[b]?.ice ||
      !adjacent(a, b)
    )
      return;
    lock.current = true;
    setBusy(true);
    setSelected(null);
    clearHint();
    const token = generation.current;
    const origin = boardRef.current
      .querySelector(`[data-index="${a}"]`)
      .getBoundingClientRect();
    const destination = boardRef.current
      .querySelector(`[data-index="${b}"]`)
      .getBoundingClientRect();
    const motion = {
      a,
      b,
      dx: destination.left - origin.left,
      dy: destination.top - origin.top,
      returning: false,
    };
    setExchange(motion);
    await delay(SWAP_MS + 30);
    if (token !== generation.current) return;
    let nextBoard = swap(currentBoard, a, b);
    if (!canSwap(currentBoard, a, b)) {
      setExchange({ ...motion, returning: true });
      await delay(SWAP_MS + 30);
      if (token !== generation.current) return;
      setExchange(null);
      lock.current = false;
      setBusy(false);
      return;
    }
    // Commit at the animated destination, removing the transition in the same render.
    setBoard(nextBoard);
    setExchange(null);
    let next = {
      ...game,
      moves: game.moves - 1,
      collected: [...game.collected],
    };
    await settleTurn(game, next, nextBoard, currentMode, [a, b], token);
  }

  async function settleTurn(
    game,
    next,
    nextBoard,
    currentMode,
    initialExchange,
    token,
  ) {
    let chain = 1;
    let finaleStarted = false;
    for (;;) {
      const initial = !finaleStarted && chain === 1;
      let wave =
        chain <= 60 || pendingColorClear(nextBoard) >= 0
          ? resolveWave(nextBoard, {
              preferred: initial ? [...initialExchange].reverse() : [],
              exchange: initial ? initialExchange : [],
              chain,
            })
          : null;
      if (
        !wave &&
        (finaleStarted ||
          gameStatus({ ...next, board: nextBoard }, currentMode === "daily") === "won")
      ) {
        if (!finaleStarted) chain = 1;
        finaleStarted = true;
        wave = resolveWave(nextBoard, { finale: true, chain });
      }
      if (!wave) break;
      if (wave.transformed.size) {
        setBoard(wave.effectBoard);
        setConverting([...wave.transformed.keys()]);
        await delay(280);
        if (token !== generation.current) return;
        setConverting([]);
      }
      if (wave.armed.size || wave.stripeDirections.size)
        setBoard(
          wave.effectBoard.map((piece, index) =>
            wave.stripeDirections.has(index)
              ? { ...piece, special: wave.stripeDirections.get(index) }
              : piece,
          ),
        );
      setClearing(wave.cleared);
      setBreaking([...wave.iceHits.keys()]);
      setChainLabel(
        wave.score
          ? {
              chain,
              score: wave.score,
              key: `${token}-${chain}-${Date.now()}`,
            }
          : null,
      );
      if (wave.score) tone(chain);
      next.score += wave.score;
      next.collected = next.collected.map(
        (count, i) => count + wave.collected[i],
      );
      next.objective = advanceObjective(next, wave);
      setTurnProgress({
        objective: next.objective,
        score: next.score,
        collected: next.collected,
        remainingIce: iceLayers(wave.board),
      });
      await delay(230);
      if (token !== generation.current) return;
      const drops = [];
      nextBoard = refill(wave.board, Math.random, (piece, from, to) => {
        drops.push({ id: piece.id, from, to });
      }, next.objective);
      const motion = planFalls(drops);
      setBoard(nextBoard);
      setFalling(motion);
      setClearing([]);
      setBreaking([]);
      await delay(motion.duration || 160);
      if (token !== generation.current) return;
      setFalling(null);
      for (let arrival; (arrival = collectDeliveries(next, nextBoard));) {
        next.objective = arrival.objective;
        setClearing(arrival.indices);
        setTurnProgress({ score: next.score, collected: next.collected,
          objective: next.objective, remainingIce: iceLayers(nextBoard) });
        await delay(230);
        if (token !== generation.current) return;
        const deliveryDrops = [];
        nextBoard = refill(arrival.board, Math.random, (piece, from, to) => {
          deliveryDrops.push({ id: piece.id, from, to });
        }, next.objective);
        const deliveryMotion = planFalls(deliveryDrops);
        setBoard(nextBoard);
        setClearing([]);
        setFalling(deliveryMotion);
        await delay(deliveryMotion.duration || 160);
        if (token !== generation.current) return;
        setFalling(null);
      }
      if (wave.cleared.length || wave.iceHits.size) chain++;
    }
    if (findMatches(nextBoard).length || !findMove(nextBoard)) {
      nextBoard = shuffleBoard(nextBoard);
      setBoard(nextBoard);
    }
    next.board = nextBoard;
    next.status = gameStatus(next, currentMode === "daily");
    setProfile((p) => ({
      ...p,
      [currentMode]: next,
      levelStars:
        next.status === "won" && currentMode !== "daily"
          ? {
              ...p.levelStars,
              [next.level]: Math.max(
                p.levelStars[next.level] || 0,
                earnedStars(next),
              ),
            }
          : p.levelStars,
      lastDailyWin:
        next.status === "won" && currentMode === "daily"
          ? p.date
          : p.lastDailyWin,
      stats: {
        ...p.stats,
        best: Math.max(p.stats.best, totalScore(next)),
        eliminated:
          p.stats.eliminated +
          next.collected.reduce((a, b) => a + b, 0) -
          game.collected.reduce((a, b) => a + b, 0),
        wins:
          p.stats.wins +
          (next.status === "won" && currentMode !== "daily" ? 1 : 0),
        dailyWins:
          p.stats.dailyWins +
          (next.status === "won" &&
          currentMode === "daily" &&
          p.lastDailyWin !== p.date
            ? 1
            : 0),
      },
    }));
    setTurnProgress(null);
    setChainLabel(null);
    if (next.status !== "playing") {
      await delay(RESULT_PAUSE_MS, { animation: false });
      if (token !== generation.current) return;
    }
    lock.current = false;
    setBusy(false);
  }

  function clickTile(index) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (
      lock.current ||
      view ||
      active.status !== "playing" ||
      !board[index] ||
      board[index].ice ||
      pendingColorClear(board) >= 0
    )
      return;
    if (selected === index) {
      setSelected(null);
      return;
    }
    if (selected !== null && adjacent(selected, index))
      attempt(selected, index);
    else {
      setSelected(index);
      clearHint();
    }
  }
  function pointerDown(event, index) {
    if (
      lock.current ||
      view ||
      active.status !== "playing" ||
      !board[index] ||
      board[index].ice ||
      pendingColorClear(board) >= 0 ||
      event.button > 0 ||
      event.isPrimary === false ||
      drag.current
    )
      return;
    suppressClick.current = false;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      index,
      id: event.pointerId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) return;
    drag.current = null;
    suppressClick.current = true;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const target =
      start.index +
      (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * 8);
    if (adjacent(start.index, target)) attempt(start.index, target);
  }
  function pointerUp(event) {
    pointerMove(event);
    if (drag.current?.id === event.pointerId) drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyTile(event, index) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const target = index + offsets[event.key];
    if (!adjacent(index, target)) return;
    if (event.shiftKey) attempt(index, target);
    else boardRef.current?.querySelector(`[data-index="${target}"]`)?.focus();
  }
  function useHint() {
    if (
      lock.current ||
      active.status !== "playing" ||
      !active.hints ||
      pendingColorClear(board) >= 0
    )
      return;
    const pair = findMove(board);
    if (!pair) return;
    clearHint();
    setSelected(null);
    setHint(pair);
    updateGame({ ...active, hints: active.hints - 1 });
    hintTimer.current = setTimeout(() => setHint([]), 4500);
  }
  function useShuffle() {
    if (
      lock.current ||
      active.status !== "playing" ||
      !active.shuffles ||
      pendingColorClear(board) >= 0
    )
      return;
    clearHint();
    setSelected(null);
    const nextBoard = shuffleBoard(board);
    setBoard(nextBoard);
    updateGame({ ...active, board: nextBoard, shuffles: active.shuffles - 1 });
  }
  function switchMode(nextMode) {
    if (lock.current) return;
    setScoreTrackKey((key) => key + 1);
    setLevelsOpen(false);
    const date = todayKey();
    let nextProfile = profile;
    if (nextMode === "daily" && date !== profile.date) {
      nextProfile = { ...profile, daily: dailyGame(date), date };
      setProfile(nextProfile);
    }
    setMode(nextMode);
    setBoard(nextProfile[nextMode].board);
    setBusy(pendingColorClear(nextProfile[nextMode].board) >= 0);
    setView(null);
    setSelected(null);
    clearHint();
    setChainLabel(null);
  }
  function newGame(advance = false) {
    if (lock.current) return;
    if (mode !== "daily") {
      openLevel(Math.min(MAX_LEVEL, active.level + (advance ? 1 : 0)), !advance);
      return;
    }
    const next = dailyGame(profile.date);
    setScoreTrackKey((key) => key + 1);
    setBoard(next.board);
    updateGame(next);
    setView(null);
    setSelected(null);
    clearHint();
  }
  const unlockedLevel = Math.min(
    MAX_LEVEL,
    Math.max(
      profile.adventure.level + (profile.adventure.status === "won" ? 1 : 0),
      ...Object.keys(profile.levelStars).map((level) => Number(level) + 1),
    ),
  );
  const levelPageCount = Math.ceil(
    Math.min(MAX_LEVEL, unlockedLevel + 1) / LEVELS_PER_PAGE,
  );
  const firstLevel = levelPage * LEVELS_PER_PAGE + 1;
  const lastLevel = Math.min(MAX_LEVEL, firstLevel + LEVELS_PER_PAGE - 1);
  function showLevels() {
    if (lock.current) return;
    setLevelsOpen(true);
    setLevelPage(Math.floor((unlockedLevel - 1) / LEVELS_PER_PAGE));
    setSelected(null);
    clearHint();
    setView("levels");
  }
  function openLevel(level, restart = false) {
    if (lock.current || level < 1 || level > unlockedLevel) return;
    setScoreTrackKey((key) => key + 1);
    setLevelsOpen(false);
    const latest = profile.adventure;
    const nextMode =
      level < latest.level || (level === latest.level && latest.status === "won")
        ? "replay"
        : "adventure";
    const next =
      level === latest.level && latest.status === "playing" && !restart
        ? latest
        : createGame(level);
    setProfile((p) => ({ ...p, [nextMode]: next }));
    setMode(nextMode);
    setBoard(next.board);
    setBusy(pendingColorClear(next.board) >= 0);
    setView(null);
    setSelected(null);
    clearHint();
    setChainLabel(null);
  }
  const nav = [
    { id: "adventure", icon: "map", title: "闯关", small: "闯关" },
    { id: "daily", icon: "sun", title: "每日挑战", small: "每日" },
    { id: "records", icon: "chart", title: "统计", small: "统计" },
  ];
  const earnedScore = turnProgress?.score ?? active.score;
  const progress = Math.min(100, (earnedScore / config.target) * 100);
  const displayCollected = turnProgress?.collected ?? active.collected;
  const displayObjective = turnProgress?.objective ?? active.objective;
  const goal = objectiveProgress({ ...active, collected: displayCollected, objective: displayObjective }, config);
  const goalLabel = goal.kind === "collect" ? `收集${TILE_THEME[config.targetType].name}`
    : ({ spread: "涂满地板", reveal: "揭开图案", deliver: `护送${DELIVERY_THEME.name}到底部` })[goal.kind];
  const goalArt = () => goal.kind === "collect" ? <Animal type={config.targetType} />
    : goal.kind === "deliver" ? <Delivery />
    : <span class="objective-icon"><Icon name={goal.kind === "spread" ? "paint" : goal.kind} size={27} /></span>;
  const goalDone = goal.complete;
  const remainingGoal = Math.max(0, goal.total - goal.current);
  const remainingIce = turnProgress?.remainingIce ?? iceLayers(board);
  const iceGoal = active.iceGoal || 0;
  const displayScore = earnedScore + moveBonus(active);
  const starMax = config.starTargets[2];
  const nextScoreTarget = config.starTargets.find((target) => displayScore < target) ?? starMax;
  const stars = config.starTargets.map((target) => displayScore >= target);
  const modal = view === "levels" ? null : view || (result ? active.status : null);
  const resultModal = modal === "won" || modal === "lost";
  const navMode = mode === "replay" || levelsOpen ? "adventure" : mode;
  const navItem = (item, mobile = false) => (
    <button
      key={item.id}
      class={`nav-item ${view === "records" ? (item.id === "records" ? "active" : "") : navMode === item.id ? "active" : ""}`}
      aria-current={
        view === "records"
          ? item.id === "records"
            ? "page"
            : undefined
          : navMode === item.id
            ? "page"
            : undefined
      }
      disabled={busy}
      onClick={() =>
        item.id === "records" ? setView("records") : switchMode(item.id)
      }
    >
      <Icon name={item.icon} size={mobile ? 22 : 20} />
      <span>{mobile ? item.small : item.title}</span>
      {!mobile && item.id === "daily" && <i class="nav-dot" />}
    </button>
  );

  return (
    <div class={`app-shell ${levelsOpen ? "has-level-navigation" : "in-level"}`}>
      {levelsOpen && <aside class="sidebar">
        <a href="../" class="brand" aria-label="绒绒消消乐，返回游戏首页">
          <span class="brand-mark">
            <Animal type={0} />
          </span>
          <span>
            <strong>绒绒消消乐</strong>
          </span>
        </a>
        <nav aria-label="主要导航">{nav.map((item) => navItem(item))}</nav>
        <div class="sidebar-bottom">
          <button
            class="sidebar-setting"
            onClick={() => setView("settings")}
            disabled={busy}
          >
            <Icon name="gear" size={19} /> 设置
          </button>
        </div>
      </aside>}

      <main class="main-content">
        <header class="topbar">
          <GameButton
            class="icon-button pause-button"
            aria-label={levelsOpen ? "返回游戏" : "暂停游戏"}
            locked={busy}
            disabled={!!result && !levelsOpen}
            onClick={() => levelsOpen ? dismiss() : setView("pause")}
          >
            <Icon name={levelsOpen ? "back" : "pause"} size={24} />
          </GameButton>
          <a class="topbar-title" href="../">
            绒绒消消乐
          </a>
        </header>
        <section class={`play-area ${levelsOpen ? "level-selection-area" : ""}`}>
          {levelsOpen ? (
            <section class="level-selection" aria-labelledby="levels-title">
              <div class="level-selection-header">
                <h1 id="levels-title" tabIndex={-1} ref={levelsHeadingRef}>关卡选择</h1>
                <div class="level-pagination">
                  <button class="icon-button" aria-label="上一页关卡"
                    disabled={levelPage === 0} onClick={() => setLevelPage((page) => page - 1)}>
                    <Icon name="back" size={20} />
                  </button>
                  <span>{firstLevel}–{lastLevel}</span>
                  <button class="icon-button" aria-label="下一页关卡"
                    disabled={levelPage + 1 >= levelPageCount} onClick={() => setLevelPage((page) => page + 1)}>
                    <Icon name="arrow" size={20} />
                  </button>
                </div>
              </div>
              <div class="level-grid">
                {Array.from({ length: lastLevel - firstLevel + 1 }, (_, index) => {
                  const level = firstLevel + index;
                  const best = profile.levelStars[level] || 0;
                  const locked = level > unlockedLevel;
                  return (
                    <button key={level} data-level={level}
                      class={`level-tile ${level === unlockedLevel ? "current" : ""}`}
                      disabled={locked} aria-current={level === unlockedLevel ? "step" : undefined}
                      aria-label={`第 ${level} 关，${locked ? "未解锁" : best ? `最高 ${best} 星` : "暂无星级记录"}`}
                      onClick={() => openLevel(level)}>
                      <strong>{level}</strong>
                      {locked ? <Icon name="lock" size={16} /> : (
                        <span class="level-stars" aria-hidden="true">
                          {[1, 2, 3].map((star) => <Icon key={star} name="star" size={15} earned={best >= star} class={best >= star ? "earned" : ""} />)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : <div class="game-layout">
            <section class="game-card" aria-label="三消游戏">
              <div class="level-header">
                <div class="level-title">
                  <div>
                    <h1>
                      {mode === "daily"
                        ? "每日挑战"
                        : `第 ${String(active.level).padStart(2, "0")} 关`}
                    </h1>
                    {mode === "daily" && (
                      <time dateTime={profile.date}>{profile.date}</time>
                    )}
                  </div>
                </div>
                <div class="level-goals">
                  <div
                    class={`mini-goal ${goalDone ? "done" : ""}`}
                    data-goal={goal.kind}
                    aria-label={`${goalLabel}：${goal.current} / ${goal.total}`}
                  >
                    {goalArt()}
                    <span class="goal-remaining" aria-hidden="true">{remainingGoal}</span>
                  </div>
                  {iceGoal > 0 && (
                    <div
                      class={`mini-goal ice-goal ${remainingIce === 0 ? "done" : ""}`}
                      aria-label={`解冻冰层：${iceGoal - remainingIce} / ${iceGoal}`}
                    >
                      <Ice />
                      <span class="goal-remaining" aria-hidden="true">{remainingIce}</span>
                    </div>
                  )}
                </div>
              </div>
              <div class="scoreboard">
                <div class="moves-stat">
                  <span>剩余步数</span>
                  <strong class={active.moves <= 5 ? "low-moves" : ""}>
                    {active.moves}
                  </strong>
                </div>
                <div class="score-stat">
                  <div class="score-label">
                    <span>当前得分</span>
                    <strong>
                      {format(displayScore)}
                      <small> / {format(nextScoreTarget)}</small>
                    </strong>
                  </div>
                  <div
                    key={scoreTrackKey}
                    class="score-track"
                    role="progressbar"
                    aria-label="星级得分进度"
                    aria-valuenow={Math.min(displayScore, starMax)}
                    aria-valuemin={0}
                    aria-valuemax={starMax}
                    aria-valuetext={`${format(displayScore)} 分，三星目标 ${format(starMax)} 分`}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, (displayScore / starMax) * 100)}%`,
                      }}
                    />
                    {config.starTargets.map((target, i) => (
                      <Icon
                        key={i}
                        name="star"
                        size={15}
                        earned={displayScore >= target}
                        class={
                          displayScore >= target
                            ? "score-star filled"
                            : "score-star"
                        }
                        style={{ left: `${(target / starMax) * 100}%` }}
                        data-score-target={target}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div class="board-wrap">
                <div
                  class={`board ${busy ? "is-busy" : ""}`}
                  role="group"
                  aria-label="8 行 8 列动物棋盘"
                  aria-busy={busy}
                  ref={boardRef}
                >
                  <GoalFloor objective={displayObjective} />
                  {board.map((piece, index) => piece ? (
                    <button
                      key={piece.id}
                      data-index={index}
                      data-type={piece.type}
                      data-kind={piece.kind}
                      data-special={piece.special || undefined}
                      data-ice={piece.ice || undefined}
                      data-pending-color-clear={piece.pending || undefined}
                      data-tile-id={piece.id}
                      data-swap-phase={
                        exchange &&
                        (index === exchange.a || index === exchange.b)
                          ? exchange.returning
                            ? "return"
                            : "forward"
                          : undefined
                      }
                      style={
                        exchange &&
                        (index === exchange.a || index === exchange.b)
                          ? {
                              transform: exchange.returning
                                ? "translate(0px, 0px)"
                                : `translate(${(index === exchange.a ? 1 : -1) * exchange.dx}px, ${(index === exchange.a ? 1 : -1) * exchange.dy}px)`,
                              "--swap-duration": `${SWAP_MS}ms`,
                            }
                          : undefined
                      }
                      class={`cell ${piece.pending ? "rainbow-armed" : ""} ${piece.ice ? "frozen" : ""} ${breaking.includes(index) ? "ice-breaking" : ""} ${selected === index ? "selected" : ""} ${hint.includes(index) ? "hinted" : ""} ${clearing.includes(index) ? "clearing" : ""} ${converting.includes(index) ? "converting" : ""} ${piece.special ? "special-cell" : ""} ${exchange && (index === exchange.a || index === exchange.b) ? "exchanging" : ""}`}
                      aria-label={`第 ${Math.floor(index / 8) + 1} 行第 ${(index % 8) + 1} 列，${isDelivery(piece) ? DELIVERY_THEME.name : piece.special === "color" ? "彩虹道具" : TILE_THEME[piece.type].name}${piece.special && piece.special !== "color" ? "，条纹棋子" : ""}${piece.ice ? `，${piece.ice} 层冰封` : ""}${piece.pending ? "，待触发" : ""}`}
                      aria-pressed={selected === index}
                      disabled={
                        busy || !!modal || !!piece.ice || !!piece.pending
                      }
                      onClick={() => clickTile(index)}
                      onPointerDown={(e) => pointerDown(e, index)}
                      onPointerMove={pointerMove}
                      onPointerUp={pointerUp}
                      onPointerCancel={(event) => {
                        if (drag.current?.id === event.pointerId)
                          drag.current = null;
                      }}
                      onLostPointerCapture={(event) => {
                        if (drag.current?.id === event.pointerId)
                          drag.current = null;
                      }}
                      onKeyDown={(e) => keyTile(e, index)}
                    >
                      {isDelivery(piece) ? <Delivery /> : <Animal type={piece.type} special={piece.special} />}
                      {piece.ice > 0 && <Ice layers={piece.ice} />}
                    </button>
                  ) : (
                    <div
                      key={`empty-${index}`}
                      class="cell empty-cell"
                      data-index={index}
                      data-empty="true"
                      aria-hidden="true"
                    />
                  ))}
                </div>
                {chainLabel && (
                  <div
                    class="chain-label"
                    key={chainLabel.key}
                    aria-hidden="true"
                  >
                    <span
                      class="chain-count"
                      style={{ fontSize: `${1.75 + Math.min(Math.max(chainLabel.chain - 2, 0), 3) * 0.125}rem` }}
                    >
                      {chainLabel.chain > 1 ? `${chainLabel.chain} 连击` : ""}
                    </span>
                    <span class="chain-score">+{chainLabel.score}</span>
                  </div>
                )}
              </div>
              <div class="tools">
                <GameButton
                  aria-label={`提示，剩余 ${active.hints} 次`}
                  title="提示"
                  onClick={useHint}
                  locked={busy}
                  disabled={!!result || active.hints === 0}
                >
                  <span class="tool-icon">
                    <Icon name="hint" />
                  </span>
                  <b class="tool-badge" aria-hidden="true">{active.hints}</b>
                </GameButton>
                <GameButton
                  aria-label={`重排，剩余 ${active.shuffles} 次`}
                  title="重排"
                  onClick={useShuffle}
                  locked={busy}
                  disabled={!!result || active.shuffles === 0}
                >
                  <span class="tool-icon">
                    <Icon name="shuffle" />
                  </span>
                  <b class="tool-badge" aria-hidden="true">{active.shuffles}</b>
                </GameButton>
              </div>
            </section>
            <aside class="game-details">
              <section class="goal-card">
                <div class="panel-label">
                  <span>
                    <Icon name="trophy" size={17} /> 本关目标
                  </span>
                </div>
                {iceGoal > 0 && (
                  <div
                    class={`goal-item ${remainingIce === 0 ? "completed" : ""}`}
                  >
                    <span class="goal-icon ice-goal-icon">
                      <Ice />
                      <span class="goal-remaining" aria-hidden="true">{remainingIce}</span>
                    </span>
                    <div>
                      <strong>解冻全部冰层</strong>
                      <div class="goal-track">
                        <span
                          style={{
                            width: `${((iceGoal - remainingIce) / iceGoal) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div class={`goal-item ${goalDone ? "completed" : ""}`} data-goal={goal.kind}>
                  <span class="goal-icon">
                    {goalArt()}
                    <span class="goal-remaining" aria-hidden="true">{remainingGoal}</span>
                  </span>
                  <div>
                    <strong>{goalLabel}</strong>
                    <div class="goal-track">
                      <span
                        style={{
                          width: `${Math.min(100, (goal.current / goal.total) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div class={`goal-item ${progress === 100 ? "completed" : ""}`}>
                  <span class="goal-icon star-goal">
                    <Icon name="star" size={27} />
                  </span>
                  <div>
                    <strong>获得 {format(config.target)} 分</strong>
                  </div>
                  <span class="goal-check">
                    <Icon name="check" size={16} />
                  </span>
                </div>
              </section>
            </aside>
          </div>}
        </section>
      </main>
      {levelsOpen && <nav class="mobile-nav" aria-label="移动导航">
        {nav.map((item) => navItem(item, true))}
        <button
          class={`nav-item ${view === "settings" ? "active" : ""}`}
          disabled={busy}
          onClick={() => setView("settings")}
        >
          <Icon name="gear" size={22} />
          <span>设置</span>
        </button>
      </nav>}
      {modal && (
        <div
          class="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !resultModal) dismiss();
          }}
        >
          <section
            class={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            tabIndex={-1}
            ref={dialogRef}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const nodes = [
                ...event.currentTarget.querySelectorAll(
                  "button:not(:disabled), a[href]",
                ),
              ];
              if (!nodes.length) {
                event.preventDefault();
                return;
              }
              const first = nodes[0],
                last = nodes[nodes.length - 1];
              if (
                event.shiftKey &&
                (document.activeElement === first ||
                  document.activeElement === event.currentTarget)
              ) {
                event.preventDefault();
                last.focus();
              } else if (
                !event.shiftKey &&
                (document.activeElement === last ||
                  document.activeElement === event.currentTarget)
              ) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            {!resultModal && (
              <button
                class="icon-button modal-close"
                aria-label="关闭弹窗"
                onClick={dismiss}
              >
                <Icon name="close" />
              </button>
            )}
            {modal === "help" && (
              <>
                <h2 id="dialog-title">玩法说明</h2>
                <div class="help-rules">
                  <div>
                    <span>01</span>
                    <p>
                      <strong>交换棋子</strong>
                      点选两个相邻棋子，或在棋子上滑动。三个及以上同色棋子连成横线或竖线即可消除；无效交换不扣步数。
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>
                      <strong>特殊棋子</strong>
                      横向四连生成纵向条纹，纵向四连生成横向条纹。同向条纹命中时转为垂直方向消除，每颗每轮只触发一次。双条纹交换不分方向，横向交换清除一行两列，纵向交换清除两行一列。
                      五连或交叉消除生成彩虹道具：与普通棋子交换消除同色棋子，与条纹交换将同色棋子全部变成随机方向的条纹并引爆；两个彩虹交换时，先选中的彩虹清除当前屏的其他棋子，另一个保留并加入引爆队列，补盘后优先消除最多的一种棋子；未参与交换的彩虹在全屏消除时保留。彩虹交换若同时形成四连、五连或交叉图案，仍会在换入棋子处生成相应道具，新道具保留到本轮消除结束。
                      条纹扫中的彩虹会标记保留，补充棋盘后自动消除数量最多的棋子，优先于普通三消；每次补充只触发一颗，其余彩虹等待下一次补充。
                    </p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>
                      <strong>冰封格子</strong>
                      冰封棋子不能交换或下落。上下左右消除棋子，或道具直接命中，每个消除波次减少一层冰。解冻全部冰层也是过关目标，开局步数已按冰层数量和布局配置。
                      优先等待正上方补入，只有上方补充通路被封住时才斜落；两侧可用时左右轮流，单侧封住则只用另一侧。封闭处保留空位，新棋子只从顶行进入。
                    </p>
                  </div>
                  <div>
                    <span>04</span>
                    <p>
                      <strong>过关目标</strong>
                      完成本关目标、解冻冰层并达到目标分数即可过关。所有关卡依次轮换收集、涂色、揭图和护送：在已涂色地板上消除可扩散颜色；消除遮挡格揭开整幅图案；蛋从第一排生成，不参与匹配或爆炸，落到底部即完成护送。第 10 关起，每逢 5 的倍数为挑战关，其中收集挑战需收集 36 个目标棋子。每颗棋子基础 60
                      分，连消最高 5 倍。同轮消除 3 格到 64 格，面积倍率先快后慢地从 1 倍提升到 2 倍，消除分四舍五入到十位，生成道具的格子也计入基础分和面积。四连每组额外 +80，五连或交叉图案每组额外 +200，同组只取最高一档。图案奖励每轮均可获得，不乘面积或连消倍率。通关后每剩余一步奖励{" "}
                      {MOVE_BONUS} 分，计入最终星级。 本关二星{" "}
                      {format(config.starTargets[1])} 分，三星 {format(starMax)}{" "}
                      分。
                      达成通关目标后，条纹按原方向同时引爆，彩虹补盘后逐个引爆；新生成的道具继续清场，直到全部用尽，再结算最终得分与星级。
                    </p>
                  </div>
                </div>
                <p class="keyboard-note">
                  方向键移动，回车选择，Shift + 方向键交换。
                </p>
                <button class="primary-button" onClick={dismiss}>
                  {levelsOpen ? "返回选关" : "返回游戏"} <Icon name="arrow" size={18} />
                </button>
              </>
            )}
            {modal === "pause" && (
              <>
                <span class="modal-symbol">
                  <Icon name="pause" size={28} />
                </span>
                <h2 id="dialog-title">已暂停</h2>
                <button class="primary-button" onClick={dismiss}>
                  <Icon name="play" size={22} /> 继续游戏
                </button>
                <div class="modal-actions">
                  <button
                    class="secondary-button"
                    onClick={() => setView("restart")}
                  >
                    <Icon name="restart" size={20} /> 重新开始
                  </button>
                  <button class="secondary-button" onClick={showLevels}>
                    <Icon name="map" size={20} /> 返回选关
                  </button>
                </div>
              </>
            )}
            {modal === "restart" && (
              <>
                <span class="modal-symbol">
                  <Icon name="restart" size={34} />
                </span>
                <h2 id="dialog-title">重新开始？</h2>
                <p class="modal-intro">
                  本关进度将重置。
                  {mode === "daily" && "起始棋盘不变。"}
                </p>
                <button class="primary-button" onClick={() => newGame()}>
                  重新开始
                </button>
                <button class="secondary-button" onClick={dismiss}>
                  取消
                </button>
              </>
            )}
            {modal === "settings" && (
              <>
                <h2 id="dialog-title">设置</h2>
                <div class="settings-row">
                  <div>
                    <strong>消除音效</strong>
                  </div>
                  <button
                    class={`toggle ${profile.sound ? "on" : ""}`}
                    role="switch"
                    aria-label="消除音效"
                    aria-checked={profile.sound}
                    onClick={() =>
                      setProfile((p) => ({ ...p, sound: !p.sound }))
                    }
                  >
                    <span />
                  </button>
                </div>
                <div class="settings-row">
                  <div>
                    <strong>自动保存</strong>
                    <p>
                      {saved === null ? "正在保存当前进度…" : saved
                        ? "仅保存在当前浏览器。"
                        : "浏览器无法保存，关闭页面后进度会丢失。"}
                    </p>
                  </div>
                  <span class="setting-status">
                    {saved === null ? "保存中" : saved ? "已开启" : "不可用"}
                  </span>
                </div>
                <button class="settings-help" onClick={() => setView("help")}>
                  玩法说明
                </button>
              </>
            )}
            {modal === "records" && (
              <>
                <span class="modal-symbol">
                  <Icon name="trophy" size={34} />
                </span>
                <h2 id="dialog-title">统计</h2>
                <div class="records-grid">
                  <div>
                    <strong>{format(profile.stats.wins)}</strong>
                    <span>闯关成功</span>
                  </div>
                  <div>
                    <strong>{format(profile.stats.best)}</strong>
                    <span>最高得分</span>
                  </div>
                  <div>
                    <strong>{format(profile.stats.eliminated)}</strong>
                    <span>累计消除</span>
                  </div>
                  <div>
                    <strong>{format(profile.stats.dailyWins)}</strong>
                    <span>每日挑战成功</span>
                  </div>
                </div>
                <p class="keyboard-note">清除网站数据将重置记录。</p>
              </>
            )}
            {modal === "won" && (
              <>
                <div class="result-animal">
                  <Animal type={config.targetType} />
                  <span><Icon name="sparkles" size={30} /></span>
                  <span><Icon name="sparkle" size={22} /></span>
                </div>
                <h2 id="dialog-title">通关</h2>
                <div class="result-stars">
                  {stars.map((filled, i) => (
                    <Icon
                      key={i}
                      name="star"
                      size={32}
                      earned={filled}
                      class={filled ? "earned" : ""}
                    />
                  ))}
                </div>
                <div class="result-score">
                  <span>最终得分</span>
                  <strong>{format(displayScore)}</strong>
                </div>
                <button
                  class="primary-button"
                  onClick={() =>
                    mode === "daily" ? switchMode("adventure") : newGame(true)
                  }
                >
                  {mode === "daily" ? "返回闯关" : "下一关"}
                  <Icon name="arrow" size={18} />
                </button>
                <div class="modal-actions">
                  <button class="secondary-button" onClick={() => newGame()}>
                    <Icon name="restart" size={20} /> 再玩一次
                  </button>
                  <button class="secondary-button" onClick={showLevels}>
                    <Icon name="map" size={20} /> 返回选关
                  </button>
                </div>
              </>
            )}
            {modal === "lost" && (
              <>
                <span class="modal-symbol">
                  <Icon name="paw" size={36} />
                </span>
                <h2 id="dialog-title">步数用完</h2>
                <div class="result-score">
                  <span>本局得分</span>
                  <strong>{format(active.score)}</strong>
                  <span>目标 {format(config.target)}</span>
                </div>
                <button class="primary-button" onClick={() => newGame()}>
                  重试 <Icon name="restart" size={18} />
                </button>
                <button class="secondary-button" onClick={showLevels}>
                  返回选关
                </button>
                {mode === "daily" && (
                  <button
                    class="secondary-button"
                    onClick={() => switchMode("adventure")}
                  >
                    返回闯关
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {saveError && <StorageGate error={saveError} saving retry={() => retrySave((value) => value + 1)} />}
    </div>
  );
}
