const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 120;
const STICK_DEADZONE = 0.55;
const BUTTON_ACTIONS = [
  [4, 'undo'],
  [5, 'hint'],
  [0, 'place'],
  [1, 'erase'],
];

function direction(pad) {
  const down = (index) => pad.buttons[index]?.pressed === true;
  const x = Number(down(15)) - Number(down(14));
  const y = Number(down(13)) - Number(down(12));
  if (y) return y < 0 ? 'up' : 'down';
  if (x) return x < 0 ? 'left' : 'right';
  const ax = Number.isFinite(pad.axes[0]) ? pad.axes[0] : 0;
  const ay = Number.isFinite(pad.axes[1]) ? pad.axes[1] : 0;
  if (Math.max(Math.abs(ax), Math.abs(ay)) < STICK_DEADZONE) return null;
  if (Math.abs(ay) >= Math.abs(ax)) return ay < 0 ? 'up' : 'down';
  return ax < 0 ? 'left' : 'right';
}

// Poll snapshots, not live Gamepad objects: browsers may mutate them in place.
export class PupdokuGamepadInput {
  state = null;

  reset() {
    this.state = null;
  }

  poll(pads, now) {
    const available = Array.from(pads ?? []).filter(
      (pad) => pad?.connected && pad.mapping === 'standard',
    );
    // A single cursor has one owner until that controller disconnects.
    const pad =
      available.find(
        (pad) => pad.index === this.state?.index && pad.id === this.state.id,
      ) ?? available[0];
    const actions = [];
    if (!pad) {
      if (this.state?.marking) actions.push({ type: 'markEnd' });
      this.reset();
      return actions;
    }
    const buttons = Array.from(
      { length: 17 },
      (_, i) => pad.buttons[i]?.pressed === true,
    );
    const nextDirection = direction(pad);
    const previous = this.state;
    if (!previous || previous.index !== pad.index || previous.id !== pad.id) {
      if (previous?.marking) actions.push({ type: 'markEnd' });
      this.state = {
        index: pad.index,
        id: pad.id,
        buttons,
        direction: nextDirection,
        repeatAt: Infinity,
        marking: false,
        resetArmed: false,
      };
      return actions;
    }
    const pressed = (index) => buttons[index] && !previous.buttons[index];
    const reserved = buttons[8] || buttons[9] || buttons[16];
    if (previous.marking && (!buttons[2] || reserved)) {
      previous.marking = false;
      actions.push({ type: 'markEnd' });
    }
    const baseline = () => {
      previous.buttons = buttons;
      previous.direction = nextDirection;
      previous.repeatAt = Infinity;
    };
    if (reserved) {
      if (pressed(8)) previous.resetArmed = !buttons[9] && !buttons[16];
      if (buttons[9] || buttons[16]) previous.resetArmed = false;
      baseline();
      return actions;
    }
    if (previous.resetArmed) {
      // Commit a solo Create/Back press on release, after ruling out the menu chord.
      previous.resetArmed = false;
      baseline();
      return [...actions, { type: 'restart' }];
    }
    if (previous.buttons[8] || previous.buttons[9] || previous.buttons[16]) {
      baseline();
      return actions;
    }

    const action = BUTTON_ACTIONS.find(([index]) => pressed(index))?.[1];
    if (action) {
      if (previous.marking) actions.push({ type: 'markEnd' });
      previous.marking = false;
      actions.push({ type: action });
    } else if (pressed(2)) {
      previous.marking = true;
      actions.push({ type: 'markStart' });
    }
    if (nextDirection !== previous.direction) {
      if (nextDirection && !action)
        actions.push({ type: 'move', direction: nextDirection });
      previous.repeatAt = nextDirection ? now + REPEAT_DELAY : Infinity;
    } else if (nextDirection && now >= previous.repeatAt) {
      if (!action) actions.push({ type: 'move', direction: nextDirection });
      previous.repeatAt = now + REPEAT_INTERVAL;
    }
    previous.buttons = buttons;
    previous.direction = nextDirection;
    return actions;
  }
}

export function attachPupdokuGamepad({
  controller,
  focusCell,
  onActive = () => {},
  onInactive = () => {},
  window: win = globalThis.window,
}) {
  if (!win?.navigator?.getGamepads || !win.requestAnimationFrame)
    return () => {};
  const doc = win.document;
  const input = new PupdokuGamepadInput();
  let frame,
    disposed = false,
    ownsStroke = false,
    active = false;
  let previousGame, previousScope;
  const endStroke = () => {
    if (ownsStroke) controller.endKeyboardStroke();
    ownsStroke = false;
  };
  const deactivate = () => {
    endStroke();
    input.reset();
    if (active && !disposed) onInactive();
    active = false;
  };
  const focus = (index) => {
    if (!active) {
      controller.endKeyboardStroke();
      controller.gestures.cancel();
    }
    controller.select(index);
    focusCell(index);
    onActive();
    active = true;
  };
  function tick(now) {
    frame = null;
    if (disposed) return;
    if (doc.visibilityState !== 'visible' || !doc.hasFocus())
      return deactivate();
    frame = win.requestAnimationFrame(tick);
    let pads;
    try {
      pads = win.navigator.getGamepads();
    } catch {
      deactivate();
      win.cancelAnimationFrame(frame);
      frame = null;
      return;
    }
    if (
      !Array.from(pads ?? []).some(
        (pad) => pad?.connected && pad.mapping === 'standard',
      )
    ) {
      deactivate();
      win.cancelAnimationFrame(frame);
      frame = null;
      return;
    }
    const state = controller.getSnapshot();
    const scope =
      state.restoring || state.busy || state.completion
        ? null
        : state.storageError
          ? 'storage'
          : state.generationError
            ? 'generation'
            : state.game?.hearts === 0
              ? 'lost'
              : controller.canEdit()
                ? 'board'
                : null;
    if (previousGame !== state.game || previousScope !== scope) {
      deactivate();
      previousGame = state.game;
      previousScope = scope;
    }
    if (!scope) return deactivate();
    const actions = input.poll(pads, now);
    if (!input.state && active) deactivate();
    for (const action of actions) {
      if (action.type === 'markEnd') {
        endStroke();
        continue;
      }
      if (scope !== 'board') {
        if (action.type === 'place') {
          if (scope === 'storage') void controller.retryRestore();
          else if (scope === 'generation') void controller.newGame();
          else controller.restart();
        } else if (action.type === 'restart' && scope === 'lost')
          controller.restart();
        break;
      }
      const current = controller.getSnapshot();
      if (!controller.canEdit() || current.game !== state.game) break;
      const index = current.selected;
      const wasActive = active;
      focus(index);
      if (action.type === 'move') {
        controller.gestures.cancel();
        const size = current.game.puzzle.size;
        const row = Math.floor(index / size),
          col = index % size;
        const next = {
          up: Math.max(0, row - 1) * size + col,
          down: Math.min(size - 1, row + 1) * size + col,
          left: row * size + Math.max(0, col - 1),
          right: row * size + Math.min(size - 1, col + 1),
        }[action.direction];
        focus(next);
        if (ownsStroke) controller.extendKeyboardStroke(next);
      } else if (action.type === 'markStart') {
        controller.startKeyboardStroke(index);
        ownsStroke = true;
      } else if (action.type === 'place') {
        // The first confirm reveals the cursor instead of risking an unseen move.
        if (wasActive) controller.keyboardAction(index, 'd');
      } else if (action.type === 'erase')
        controller.keyboardAction(index, 'Delete');
      else if (action.type === 'undo') controller.undo();
      else if (action.type === 'hint') controller.hint();
      else if (action.type === 'restart') controller.restart();
    }
  }
  const resume = () => {
    if (
      !disposed &&
      frame == null &&
      doc.visibilityState === 'visible' &&
      doc.hasFocus()
    ) {
      frame = win.requestAnimationFrame(tick);
    }
  };
  const suspend = () => {
    if (frame != null) win.cancelAnimationFrame(frame);
    frame = null;
    deactivate();
  };
  const visibility = () =>
    doc.visibilityState === 'visible' ? resume() : suspend();
  win.addEventListener('focus', resume);
  win.addEventListener('gamepadconnected', resume);
  win.addEventListener('blur', suspend);
  win.addEventListener('keydown', deactivate, true);
  win.addEventListener('pointerdown', deactivate, true);
  doc.addEventListener('visibilitychange', visibility);
  resume();
  return () => {
    disposed = true;
    suspend();
    win.removeEventListener('focus', resume);
    win.removeEventListener('gamepadconnected', resume);
    win.removeEventListener('blur', suspend);
    win.removeEventListener('keydown', deactivate, true);
    win.removeEventListener('pointerdown', deactivate, true);
    doc.removeEventListener('visibilitychange', visibility);
  };
}
