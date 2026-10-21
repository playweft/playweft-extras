import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { regionColors } from './colors.js';
import { COMPLETION_TIMING, LEVEL_TRANSITION_TIMING } from './controller.js';

function Icon({ path, viewBox = '0 0 32 32' }) {
  return (
    <svg viewBox={viewBox} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function Status({ game }) {
  const size = game?.puzzle.size ?? 0,
    hearts = game?.hearts ?? 3;
  return (
    <div class="status-row">
      <span class="counter">
        <span aria-hidden="true">🐶</span>
        <strong id="progress">
          {game?.cells.filter((value) => value === 2).length ?? 0}/{size}
        </strong>
      </span>
      <span id="hearts" class="hearts" aria-label={`剩余 ${hearts} 颗生命`}>
        {Array.from({ length: 3 }, (_, index) => (
          <span
            key={index}
            class={index < hearts ? '' : 'empty'}
            aria-hidden="true"
          >
            ♥
          </span>
        ))}
      </span>
    </div>
  );
}

function Cross({ value }) {
  const visible = value === 1 || value === 3,
    error = useRef(value === 3);
  // Keep the outgoing mark's color and outline throughout its fade-out.
  // Only a newly visible mark chooses a new appearance.
  if (visible) error.current = value === 3;
  return (
    <span
      aria-hidden="true"
      class="cross"
      data-visible={String(visible)}
      data-error={String(error.current)}
    >
      <svg class="cross-symbol" viewBox="0 0 100 100">
        <path class="cross-outline" d="M24 24 76 76M76 24 24 76" />
        <path d="M24 24 76 76M76 24 24 76" />
      </svg>
    </span>
  );
}

function Board({ state, controller, keyboardFocus, setKeyboardFocus }) {
  const { game, busy, preview, selected, highlight } = state;
  const boardRef = useRef(null),
    cells = useRef([]),
    animations = useRef(new WeakMap());
  const colors = useMemo(
    () => (game ? regionColors(game.puzzle.regions, game.puzzle.size) : []),
    [game?.puzzle],
  );
  const size = game?.puzzle.size ?? 8;
  const celebrating = state.completion?.phase === 'pups';
  const editable = controller.canEdit();
  function animateCell(index) {
    const cell = cells.current[index];
    if (
      !cell?.animate ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return;
    animations.current.get(cell)?.cancel();
    const animation = cell.animate(
      [
        { scale: '1', offset: 0 },
        { scale: '.92', offset: 0.3 },
        { scale: '1.025', offset: 0.72 },
        { scale: '1', offset: 1 },
      ],
      { duration: 220, easing: 'ease-out' },
    );
    // Re-entering the same cell intentionally cancels its previous animation.
    animation.finished.catch(() => {});
    animations.current.set(cell, animation);
  }
  useLayoutEffect(() => {
    const stopFeedback = controller.setFeedback((indices) =>
      indices.forEach(animateCell),
    );
    return () => {
      stopFeedback();
      cells.current.forEach((cell) => {
        if (cell) animations.current.get(cell)?.cancel();
      });
    };
  }, [controller]);
  useLayoutEffect(() => {
    const release = (event) => {
      if (event.key.toLowerCase() === 'x') controller.endKeyboardStroke();
    };
    const stop = () => controller.endKeyboardStroke();
    window.addEventListener('keyup', release);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
      stop();
    };
  }, [controller]);
  function indexAt(event) {
    const rect = boardRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    return (
      Math.floor((y / rect.height) * size) * size +
      Math.floor((x / rect.width) * size)
    );
  }
  function pointerDown(event) {
    controller.endKeyboardStroke();
    setKeyboardFocus(false);
    if (event.button !== 0 || !controller.canEdit()) return;
    const index = indexAt(event);
    if (
      index === null ||
      !controller.gestures.start(
        index,
        event.clientX,
        event.clientY,
        event.pointerId,
      )
    )
      return;
    event.preventDefault();
    cells.current[index].focus();
    boardRef.current.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (event.pointerId === controller.gestures.active?.pointerId)
      controller.gestures.move(
        indexAt(event),
        event.clientX,
        event.clientY,
        event.pointerId,
      );
  }
  function pointerUp(event) {
    controller.gestures.end(event.pointerId);
    if (boardRef.current.hasPointerCapture(event.pointerId))
      boardRef.current.releasePointerCapture(event.pointerId);
  }
  function pointerCancel(event) {
    if (controller.gestures.active?.pointerId === event.pointerId)
      controller.gestures.cancel();
  }
  function keyDown(event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
      controller.endKeyboardStroke();
      return;
    }
    if (event.key === 'Tab' || event.key === 'Escape')
      controller.endKeyboardStroke();
    if (!controller.canEdit()) return;
    const selected = controller.getSnapshot().selected;
    const row = Math.floor(selected / size),
      column = selected % size;
    const next = {
      ArrowUp: Math.max(0, row - 1) * size + column,
      ArrowDown: Math.min(size - 1, row + 1) * size + column,
      ArrowLeft: row * size + Math.max(0, column - 1),
      ArrowRight: row * size + Math.min(size - 1, column + 1),
      Home: row * size,
      End: row * size + size - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      controller.gestures.cancel();
      if (!event.key.startsWith('Arrow')) controller.endKeyboardStroke();
      cells.current[next].focus();
      if (event.key.startsWith('Arrow')) controller.extendKeyboardStroke(next);
    } else if (key === 'x') {
      event.preventDefault();
      if (!event.repeat) controller.startKeyboardStroke(selected);
    } else if (['d', 'Delete', 'Backspace'].includes(key) && !event.repeat) {
      event.preventDefault();
      animateCell(selected);
      controller.keyboardAction(selected, key);
    }
  }
  return (
    <div
      id="board"
      ref={boardRef}
      class={`board${keyboardFocus ? ' keyboard-focus' : ''}${celebrating ? ' celebrate' : ''}`}
      role="group"
      aria-label={`${size} 行 ${size} 列棋盘，单击或滑动标记，双击放小狗`}
      style={{
        '--size': size,
        '--dog-size': `clamp(16px, ${66 / size}vw, ${Math.round(300 / size)}px)`,
        '--completion-pups': `${COMPLETION_TIMING.pups}ms`,
      }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerCancel}
      onLostPointerCapture={pointerCancel}
      onDblClick={(event) => event.preventDefault()}
      onKeyDown={keyDown}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          controller.endKeyboardStroke();
      }}
    >
      {game?.cells.map((stored, index) => {
        const value = preview.has(index) ? preview.get(index) : stored;
        const target = highlight?.targets.includes(index),
          source = highlight?.sources.includes(index);
        const className = `cell${target ? (highlight.error ? ' error' : ' hinted') : ''}${source ? ' source' : ''}`;
        return (
          <button
            key={index}
            ref={(element) => {
              cells.current[index] = element;
            }}
            class={className}
            type="button"
            style={{ '--region-color': colors[game.puzzle.regions[index]] }}
            disabled={!editable}
            tabIndex={selected === index ? 0 : -1}
            aria-label={`第 ${Math.floor(index / size) + 1} 行，第 ${(index % size) + 1} 列，区域 ${game.puzzle.regions[index] + 1}，${value === 2 ? '小狗' : value === 3 ? '错误位置，已排除' : value === 1 ? '已排除' : '空格'}`}
            onFocus={() => controller.select(index)}
            onClick={(event) => {
              if (event.detail === 0 && controller.canEdit()) {
                animateCell(index);
                controller.toggleMark(index);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (controller.canEdit()) {
                animateCell(index);
                controller.toggleMark(index);
              }
            }}
          >
            <Cross value={value} />
            {value === 2 && (
              <span class="dog" aria-hidden="true">
                🐶
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ActionIcon({ path }) {
  // Closely spaced discs fill the side wall. The face, glyph and depth layers
  // share one perspective camera, including at responsive button sizes.
  return (
    <span class="action-icon" aria-hidden="true">
      <span class="action-disc">
        {Array.from({ length: 12 }, (_, layer) => (
          <span
            key={layer}
            class="action-rim"
            style={{ '--layer': (layer + 1) / 12 }}
          />
        ))}
        <span class="action-face">
          <Icon viewBox="0 0 40 40" path={path} />
        </span>
      </span>
    </span>
  );
}

function Actions({ controller, game }) {
  return (
    <div class="actions">
      <button
        id="undo"
        type="button"
        aria-label="撤销"
        disabled={!controller.canEdit() || !game?.history.length}
        onClick={() => controller.undo()}
      >
        <ActionIcon path="m15 6-9 9 9 9M7 15h18a9 9 0 0 1 0 18H14" />
        <span>Undo</span>
      </button>
      <button
        id="hint"
        type="button"
        aria-label="提示"
        disabled={!controller.canEdit()}
        onClick={() => controller.hint()}
      >
        <ActionIcon path="M16 30c0-4-4-5-4-10a8 8 0 0 1 16 0c0 5-4 6-4 10ZM17 36h6M20 3v4M8 8l3 3m18 0 3-3M3 20h4m26 0h4M8 32l3-3m18 0 3 3" />
        <span>Hint</span>
      </button>
    </div>
  );
}

function StorageError({ error, controller, restoring }) {
  const retry = useRef();
  useLayoutEffect(() => {
    retry.current.focus();
  }, []);
  return (
    <div class="storage-error-overlay">
      <div
        id="storage-error"
        class="storage-error"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="storage-error-title"
        aria-describedby="storage-error-reason storage-error-code"
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            retry.current.focus();
          }
        }}
      >
        <h2 id="storage-error-title">
          存档{error.operation === 'write' ? '保存' : '读取'}失败
        </h2>
        <p id="storage-error-reason">{error.reason}</p>
        <code id="storage-error-code">{error.code}</code>
        <p class="storage-error-note">
          {error.operation === 'write'
            ? '当前进度仍在，请重试保存。'
            : '读取成功前不会覆盖存档。'}
        </p>
        <button
          id="storage-retry"
          ref={retry}
          type="button"
          disabled={restoring}
          onClick={() => controller.retryRestore()}
        >
          重试{error.operation === 'write' ? '保存' : '读取'}
        </button>
      </div>
    </div>
  );
}

export function PupdokuApp({ controller }) {
  const [state, setState] = useState(controller.getSnapshot);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  useLayoutEffect(() => controller.subscribe(setState), [controller]);
  useLayoutEffect(() => {
    const keyboard = () => setKeyboardFocus(true);
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, []);
  const {
    game,
    level,
    busy,
    generationError,
    storageError,
    restoring,
    message,
    completion,
    transition,
  } = state;
  const loadingVisible = restoring || (busy && transition === 'waiting');
  const lost = game?.hearts === 0;
  return (
    <main class="game" aria-label="小狗数独">
      <header class="topbar">
        <a class="round-button" href="../" aria-label="返回游戏列表">
          <Icon path="m20 6-10 10 10 10" />
        </a>
        <div class="level">
          <h1 id="level">Level {level}</h1>
        </div>
        <button
          id="restart"
          class="round-button"
          type="button"
          aria-label="重新开始本关"
          disabled={busy || restoring || !!completion || !!storageError}
          onClick={() => controller.restart()}
        >
          <Icon path="M8 11a11 11 0 1 1-1 12M4 5v9h9" />
        </button>
      </header>
      <Status game={game} />
      <div class="rules" aria-label="规则">
        <div>1 Pup per color</div>
        <div>
          1 Pup per column
          <br />
          and row
        </div>
        <div>Pups cannot touch</div>
      </div>
      <div class="board-space">
        <div
          id="board-wrap"
          class="board-wrap"
          aria-busy={String(busy || restoring)}
          data-transition={transition ?? 'idle'}
          style={{
            '--level-fade': `${transition === 'in' ? LEVEL_TRANSITION_TIMING.fadeIn : LEVEL_TRANSITION_TIMING.fadeOut}ms`,
          }}
        >
          <Board
            key={game ? `${game.puzzle.size}:${game.puzzle.seed}` : 'pending'}
            state={state}
            controller={controller}
            keyboardFocus={keyboardFocus}
            setKeyboardFocus={setKeyboardFocus}
          />
          <div
            id="loading"
            class="loading"
            role="status"
            aria-label="正在生成关卡"
            aria-hidden={String(!loadingVisible)}
            data-visible={String(loadingVisible)}
            data-active={String(busy || restoring)}
          >
            <span class="spinner" />
          </div>
          <div
            id="result"
            class="result"
            hidden={busy || !!completion || (!lost && !generationError)}
          >
            <button
              id="result-action"
              type="button"
              aria-label={generationError ? '重试生成关卡' : '重试本关'}
              onClick={() =>
                generationError ? controller.newGame() : controller.restart()
              }
            >
              <span id="result-symbol" aria-hidden="true">
                ↻
              </span>
            </button>
          </div>
        </div>
      </div>
      <Actions controller={controller} game={game} />
      <p id="message" class="sr-only" aria-live="polite">
        {message}
      </p>
      {completion && completion.phase !== 'pups' && (
        <div
          id="completion"
          class={`completion ${completion.phase}`}
          role="status"
          aria-live="polite"
          style={{
            '--completion-in': `${COMPLETION_TIMING.fadeIn}ms`,
            '--completion-out': `${COMPLETION_TIMING.fadeOut}ms`,
          }}
        >
          <div class="completion-content">
            <span
              class={`completion-pup${completion.perfect ? ' perfect' : ''}`}
              role="img"
              aria-label={
                completion.perfect
                  ? '无失误、无标记、无提示通关的皇冠小狗'
                  : '小狗'
              }
            >
              <span aria-hidden="true">🐶</span>
              {completion.perfect && (
                <>
                  <svg
                    class="completion-crown"
                    viewBox="0 0 64 48"
                    aria-hidden="true"
                  >
                    <path
                      d="m7 12 14 10L32 5l11 17 14-10-5 29H12Z"
                      fill="#ffd45a"
                      stroke="#fff0ad"
                      stroke-width="3"
                      stroke-linejoin="round"
                    />
                    <path d="M13 34h38" stroke="#e99b27" stroke-width="4" />
                    <path d="m32 22 5 6-5 6-5-6Z" fill="#fff9db" />
                  </svg>
                  <svg
                    class="completion-sparkles"
                    viewBox="0 0 160 140"
                    aria-hidden="true"
                  >
                    <path d="m18 40 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" />
                    <path d="m141 75 4 12 12 4-12 4-4 12-4-12-12-4 12-4Z" />
                    <path d="m44 116 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" />
                  </svg>
                </>
              )}
            </span>
            <h2>全部找到啦！</h2>
            <p>第 {completion.level} 关完成</p>
          </div>
        </div>
      )}
      {storageError && (
        <StorageError
          error={storageError}
          controller={controller}
          restoring={restoring}
        />
      )}
    </main>
  );
}
