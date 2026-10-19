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
export const LEVEL_TRANSITION_TIMING = {
  fadeOut: COMPLETION_TIMING.fadeOut,
  fadeIn: 240,
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
    transition: null,
  };
  const listeners = new Set();
  let worker,
    generationTimer,
    highlightTimer,
    completionTimer,
    transitionTimer,
    releaseOldBoard,
    pendingGeneration,
    generationId = 0,
    keyboardStroke,
    disposed = false,
    feedback;
  function publish(patch = {}) {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  }
  function save() {
    // Keep the completed save until its replacement exists. A refresh during
    // generation must not resume the cleared old partition as a new puzzle.
    if (
      !state.game ||
      state.generationError ||
      state.transition === 'out' ||
      state.transition === 'waiting'
    )
      return;
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
  function endKeyboardStroke() {
    keyboardStroke = null;
  }
  function cancelInput() {
    endKeyboardStroke();
    gestures.cancel();
  }
  function extendKeyboardStroke(index) {
    const stroke = keyboardStroke;
    if (!stroke) return;
    if (!canEdit() || state.game !== stroke.game) return endKeyboardStroke();
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= stroke.game.cells.length ||
      stroke.visited.has(index)
    )
      return;
    stroke.visited.add(index);
    feedback?.([index]);
    if (markCells(stroke.game, [index], stroke.value, !stroke.changed)) {
      stroke.changed = true;
      commit({ message: DEFAULT_MESSAGE });
    }
  }
  function complete() {
    if (disposed || state.completion) return;
    cancelInput();
    clearHighlights();
    const level = state.level;
    publish({ completion: { phase: 'pups', level }, message: '本关完成。' });
    completionTimer = schedule(() => {
      publish({ completion: { phase: 'enter', level } });
      completionTimer = schedule(() => {
        publish({ completion: { phase: 'hold', level } });
        const nextLevel = prepareLevel();
        completionTimer = schedule(() => {
          publish({ completion: { phase: 'exit', level } });
          void newGame(nextLevel);
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
      !disposed &&
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
    endKeyboardStroke();
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
    onVisit: (indices) => {
      endKeyboardStroke();
      feedback?.(indices);
    },
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
  function settleGeneration(error, puzzle) {
    const pending = pendingGeneration;
    if (!pending) return;
    pendingGeneration = null;
    unschedule(generationTimer);
    generationTimer = null;
    if (error) pending.reject(error);
    else pending.resolve(puzzle);
  }
  function failGeneration(error) {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    settleGeneration(error);
  }
  function generatorWorker() {
    if (worker) return worker;
    const instance = createWorker();
    if (!instance) return null;
    worker = instance;
    instance.onmessage = ({ data }) => {
      if (
        worker !== instance ||
        !pendingGeneration ||
        data.id !== pendingGeneration.id
      )
        return;
      if (data.puzzle) settleGeneration(null, data.puzzle);
      else failGeneration(new Error(data.error || '新题生成失败，请重试。'));
    };
    instance.onerror = () => {
      if (worker === instance) failGeneration(new Error('生成器暂时不可用。'));
    };
    return instance;
  }
  async function prepareLevel() {
    let seed = randomSeed();
    if (seed === state.game?.puzzle.seed) seed = (seed + 1) >>> 0;
    try {
      const puzzle = await new Promise((resolve, reject) => {
        const id = ++generationId;
        pendingGeneration = { id, resolve, reject };
        try {
          const instance = generatorWorker();
          if (!instance) {
            generationTimer = schedule(() => {
              try {
                settleGeneration(null, generateLevel(seed));
              } catch (error) {
                failGeneration(error);
              }
            }, 30);
            return;
          }
          generationTimer = schedule(
            () => failGeneration(new Error('生成超时，请重试。')),
            10000,
          );
          instance.postMessage({ id, seed });
        } catch (error) {
          failGeneration(error);
        }
      });
      return { puzzle };
    } catch (error) {
      // A prefetched failure is displayed only after the old board fades away.
      return { error };
    }
  }
  async function newGame(prepared) {
    if (state.busy || disposed) return;
    cancelInput();
    clearHighlights();
    const previous = state.game,
      fadeOldBoard = !!previous && !state.generationError;
    publish({
      busy: true,
      transition: fadeOldBoard ? 'out' : 'waiting',
      generationError: false,
      message: '正在生成关卡。',
    });
    const oldBoardGone = fadeOldBoard
      ? new Promise((resolve) => {
          releaseOldBoard = resolve;
          transitionTimer = schedule(() => {
            releaseOldBoard = null;
            if (!disposed)
              publish({
                game: createGame(previous.puzzle),
                transition: 'waiting',
              });
            resolve();
          }, LEVEL_TRANSITION_TIMING.fadeOut);
        })
      : Promise.resolve();
    try {
      const [result] = await Promise.all([
        prepared ?? prepareLevel(),
        oldBoardGone,
      ]);
      if (result.error) throw result.error;
      if (!disposed)
        publish({
          game: createGame(result.puzzle),
          level: previous ? state.level + 1 : state.level,
          selected: 0,
          message: DEFAULT_MESSAGE,
        });
    } catch (error) {
      await oldBoardGone;
      if (!disposed)
        publish({
          generationError: true,
          message: error.message || '生成失败，请重试。',
        });
    } finally {
      if (!disposed) {
        publish({ transition: 'in' });
        save();
        transitionTimer = schedule(
          () => commit({ busy: false, transition: null }),
          LEVEL_TRANSITION_TIMING.fadeIn,
        );
      }
    }
  }
  function restart() {
    if (state.busy || state.completion) return;
    cancelInput();
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
    endKeyboardStroke,
    extendKeyboardStroke,
    startKeyboardStroke(index) {
      cancelInput();
      if (!canEdit()) return;
      clearHighlights();
      keyboardStroke = {
        game: state.game,
        value: [1, 3].includes(state.game.cells[index]) ? 0 : 1,
        visited: new Set(),
        changed: false,
      };
      extendKeyboardStroke(index);
    },
    newGame,
    restart,
    select(index) {
      if (state.selected !== index) publish({ selected: index });
    },
    toggleMark(index) {
      cancelInput();
      return marks([index], [1, 3].includes(state.game.cells[index]) ? 0 : 1);
    },
    keyboardAction(index, key) {
      cancelInput();
      if (!canEdit()) return;
      if (key === 'd') return pup(index);
      if (key === 'x')
        return marks([index], [1, 3].includes(state.game.cells[index]) ? 0 : 1);
      clearHighlights();
      move(state.game, index, 'erase');
      commit();
    },
    undo() {
      cancelInput();
      if (canEdit() && undo(state.game)) {
        clearHighlights();
        commit({ message: '已撤销。' });
      }
    },
    hint() {
      cancelInput();
      if (!canEdit()) return;
      const result = hint(state.game);
      if (result) {
        if (result.kind === 'place') placementFeedback();
        highlight(result.index, false, result.step);
        commit({ message: explainHint(result) });
      }
    },
    suspend() {
      cancelInput();
      save();
    },
    dispose() {
      disposed = true;
      cancelInput();
      save();
      unschedule(highlightTimer);
      unschedule(generationTimer);
      unschedule(completionTimer);
      unschedule(transitionTimer);
      releaseOldBoard?.();
      releaseOldBoard = null;
      failGeneration(new Error('Generation cancelled'));
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
