import {
  createGame,
  generateLevel,
  restoreGame,
  move,
  markCells,
  undo,
  hint,
  isComplete,
} from './puzzle.js';
import { BoardGestures } from './gestures.js';

export const STORAGE_KEY = 'playweft:pupdoku:v1';
export const DEFAULT_MESSAGE = '单击或滑动标记 ×，双击放小狗。';
export const COMPLETION_TIMING = {
  pups: 240,
  fadeIn: 360,
  hold: 1000,
  fadeOut: 420,
};

// Game actions are synchronous, so consecutive pointer events see the latest
// position even when Preact batches rendering. Only snapshots reach the view.
export function createPupdokuController({
  storage = globalThis.localStorage,
  vibrate = (duration) => globalThis.navigator?.vibrate?.(duration),
  randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0],
  createWorker = () =>
    typeof Worker === 'undefined'
      ? null
      : new Worker(new URL('./generator-worker.js', import.meta.url), {
          type: 'module',
        }),
  schedule = setTimeout,
  unschedule = clearTimeout,
} = {}) {
  let saved;
  try {
    saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    /* Start fresh when storage is unavailable. */
  }
  const restored = restoreGame(saved?.game);
  let state = {
    game: restored,
    level:
      restored && Number.isSafeInteger(saved.level) && saved.level > 0
        ? saved.level
        : 1,
    busy: false,
    generationError: false,
    selected: 0,
    message: DEFAULT_MESSAGE,
    preview: new Map(),
    highlight: null,
    completion: null,
  };
  const listeners = new Set();
  let worker,
    generationTimer,
    highlightTimer,
    completionTimer,
    disposed = false,
    feedback;
  function publish(patch = {}) {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  }
  function save() {
    if (!state.game) return;
    try {
      storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ game: state.game, level: state.level }),
      );
    } catch {
      /* Play remains available without storage. */
    }
  }
  function commit(patch) {
    publish(patch);
    save();
    if (
      !disposed &&
      !state.busy &&
      !state.generationError &&
      !state.completion &&
      state.game &&
      isComplete(state.game.puzzle, state.game.cells)
    )
      complete();
  }
  function complete() {
    if (disposed || state.completion) return;
    gestures.cancel();
    clearHighlights();
    const level = state.level;
    publish({ completion: { phase: 'pups', level }, message: '本关完成。' });
    completionTimer = schedule(() => {
      publish({ completion: { phase: 'enter', level } });
      completionTimer = schedule(() => {
        publish({ completion: { phase: 'hold', level } });
        completionTimer = schedule(() => {
          // Start work at the fade-out boundary, not after the overlay vanishes.
          publish({ completion: { phase: 'exit', level } });
          void newGame();
          completionTimer = schedule(
            () => publish({ completion: null }),
            COMPLETION_TIMING.fadeOut,
          );
        }, COMPLETION_TIMING.hold);
      }, COMPLETION_TIMING.fadeIn);
    }, COMPLETION_TIMING.pups);
  }
  function canEdit() {
    return (
      state.game &&
      !state.busy &&
      !state.completion &&
      state.game.hearts > 0 &&
      !isComplete(state.game.puzzle, state.game.cells)
    );
  }
  function clearHighlights() {
    unschedule(highlightTimer);
    publish({ highlight: null });
  }
  function highlight(index, error = false, step = null) {
    unschedule(highlightTimer);
    publish({
      highlight: {
        targets: step?.removed ?? [index],
        sources: step?.sources ?? [],
        error,
      },
    });
    highlightTimer = schedule(clearHighlights, error ? 1600 : 6000);
  }
  function marks(indices, value) {
    if (!canEdit()) return;
    clearHighlights();
    const game = state.game,
      cellsBefore = [...game.cells],
      historyBefore = [...game.history];
    const changed = markCells(game, indices, value);
    commit(changed ? { message: DEFAULT_MESSAGE } : {});
    if (changed)
      return () => {
        if (state.game !== game || disposed) return;
        game.cells = cellsBefore;
        game.history = historyBefore;
        commit();
      };
  }
  function placementFeedback() {
    try {
      vibrate(3);
    } catch {
      /* Missing or blocked haptics must not interrupt a move. */
    }
  }
  function pup(index) {
    if (!canEdit()) return;
    clearHighlights();
    const game = state.game,
      result = move(game, index, 'dog');
    if (result.errors) {
      highlight(index, true);
      commit({ message: `位置错误，失去一颗生命，剩余 ${game.hearts} 颗。` });
    } else {
      if (result.changed) placementFeedback();
      commit(
        result.changed
          ? {
              message: isComplete(game.puzzle, game.cells)
                ? '本关完成。'
                : DEFAULT_MESSAGE,
            }
          : {},
      );
    }
  }
  const gestures = new BoardGestures({
    size: () => state.game?.puzzle.size ?? 8,
    getValue: (index) => state.game?.cells[index],
    onMarks: marks,
    onPup: pup,
    onVisit: (indices) => feedback?.(indices),
    onPreview: (indices, value) =>
      publish({
        preview: new Map(
          indices
            .filter((index) => !(value === 1 && state.game?.cells[index] === 3))
            .map((index) => [index, value]),
        ),
      }),
    schedule,
    unschedule,
  });
  async function newGame() {
    if (state.busy || disposed) return;
    gestures.cancel();
    clearHighlights();
    publish({ busy: true, generationError: false, message: '正在生成关卡。' });
    let seed = randomSeed();
    if (seed === state.game?.puzzle.seed) seed = (seed + 1) >>> 0;
    try {
      const puzzle = await new Promise((resolve, reject) => {
        worker = createWorker();
        if (!worker) {
          generationTimer = schedule(() => {
            try {
              resolve(generateLevel(seed));
            } catch (error) {
              reject(error);
            }
          }, 30);
          return;
        }
        generationTimer = schedule(() => {
          worker?.terminate();
          reject(new Error('生成超时，请重试。'));
        }, 10000);
        worker.onmessage = ({ data }) =>
          data.puzzle ? resolve(data.puzzle) : reject(new Error(data.error));
        worker.onerror = () => reject(new Error('生成器暂时不可用。'));
        worker.postMessage({ seed });
      });
      if (!disposed)
        publish({
          game: createGame(puzzle),
          level: state.game ? state.level + 1 : state.level,
          selected: 0,
          message: DEFAULT_MESSAGE,
        });
    } catch (error) {
      publish({
        generationError: true,
        message: error.message || '生成失败，请重试。',
      });
    } finally {
      unschedule(generationTimer);
      worker?.terminate();
      worker = null;
      if (!disposed) commit({ busy: false });
    }
  }
  function restart() {
    if (state.busy || state.completion) return;
    gestures.cancel();
    clearHighlights();
    if (!state.game || state.generationError) return newGame();
    commit({ game: createGame(state.game.puzzle), message: DEFAULT_MESSAGE });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFeedback(handler) {
      feedback = handler;
      return () => {
        if (feedback === handler) feedback = null;
      };
    },
    start() {
      if (!state.game) return newGame();
      if (isComplete(state.game.puzzle, state.game.cells)) complete();
    },
    canEdit,
    gestures,
    newGame,
    restart,
    select(index) {
      if (state.selected !== index) publish({ selected: index });
    },
    toggleMark(index) {
      gestures.cancel();
      return marks([index], [1, 3].includes(state.game.cells[index]) ? 0 : 1);
    },
    keyboardAction(index, key) {
      gestures.cancel();
      if (!canEdit()) return;
      if (key === 'd') return pup(index);
      if (key === 'x')
        return marks([index], [1, 3].includes(state.game.cells[index]) ? 0 : 1);
      clearHighlights();
      move(state.game, index, 'erase');
      commit();
    },
    undo() {
      gestures.cancel();
      if (canEdit() && undo(state.game)) {
        clearHighlights();
        commit({ message: '已撤销。' });
      }
    },
    hint() {
      gestures.cancel();
      if (!canEdit()) return;
      const result = hint(state.game);
      if (result) {
        if (result.kind === 'place') placementFeedback();
        highlight(result.index, false, result.step);
        commit({ message: explainHint(result) });
      }
    },
    suspend() {
      gestures.cancel();
      save();
    },
    dispose() {
      disposed = true;
      gestures.cancel();
      save();
      unschedule(highlightTimer);
      unschedule(generationTimer);
      unschedule(completionTimer);
      worker?.terminate();
      listeners.clear();
      feedback = null;
    },
  };
}

function explainHint(result) {
  if (result.kind === 'remove') return '这只小狗会让后续无解，先帮你移开了。';
  if (result.kind === 'unmark')
    return '这个排除标记挡住了唯一答案，先帮你清除。';
  const { step } = result;
  if (step.type === 'placed')
    return `已放置小狗的同行、同列、同色区域及相邻位置不能再放小狗，已排除 ${step.removed.length} 格。`;
  const names = { row: '行', column: '列', region: '区域' };
  const unit = (family, ids) =>
    family === 'region'
      ? `区域 ${ids.map((id) => id + 1).join('、')}`
      : `第 ${ids.map((id) => id + 1).join('、')} ${names[family]}`;
  if (step.type === 'single')
    return `${unit(step.family, [step.id])}只剩一个候选位置。`;
  if (step.type === 'localPair')
    return `${unit(step.family, step.sourceIds)}各只剩一对相邻候选，两只小狗必须分别占据相同的两${step.orientation === 'vertical' ? '行' : '列'}，因此夹缝外侧标出的 ${step.removed.length} 格必与小狗相邻，可以排除。`;
  if (step.type === 'subset')
    return `${unit(step.sourceFamily, step.sourceIds)}的候选只涉及${unit(step.targetFamily, step.targetIds)}，形成 ${step.sourceIds.length} 对 ${step.sourceIds.length} 锁定，排除 ${step.removed.length} 格。`;
  if (step.type === 'joint')
    return `${unit(step.family, step.sourceIds)}的两只小狗只有 ${step.combinations.length} 种合法搭配，标出的 ${step.removed.length} 格与每种搭配都冲突，可以排除。`;
  if (step.type === 'chain')
    return `沿标出的二选一和冲突关系推导，链条两端至少有一只小狗；标出的 ${step.removed.length} 格与两端都冲突，可以排除。`;
  return `${unit(step.family, [step.id])}必有一只小狗，标出的 ${step.removed.length} 格与它的所有候选都冲突，可以排除。`;
}
