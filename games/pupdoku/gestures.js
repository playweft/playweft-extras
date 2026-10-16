// Mouse, pen and touch share the same tap/drag recognizer. Native dblclick
// events are not used: mobile browsers do not consistently dispatch them.
export class BoardGestures {
  constructor({
    getValue,
    onMarks,
    onPup,
    onPreview,
    onVisit = () => {},
    size,
    schedule = setTimeout,
    unschedule = clearTimeout,
  }) {
    Object.assign(this, { getValue, onMarks, onPup, onPreview, onVisit, size });
    // Browser timers require the Window receiver (or an unbound call), never
    // the gesture instance. Node's timers are more permissive about `this`.
    this.schedule = (fn, delay) => schedule(fn, delay);
    this.unschedule = (id) => unschedule(id);
    this.active = null;
    this.pending = null;
  }

  start(index, x, y, pointerId) {
    if (this.active) return false;
    const second = this.pending?.index === index ? this.pending : null;
    if (second) {
      this.unschedule(this.pending.timer);
      this.pending = null;
    } else this.flush();
    this.active = {
      index,
      previous: index,
      x,
      y,
      pointerId,
      second,
      dragging: false,
      value: [1, 3].includes(this.getValue(index)) ? 0 : 1,
      path: new Set([index]),
    };
    this.onVisit([index]);
    return true;
  }

  move(index, x, y, pointerId) {
    const active = this.active;
    if (!active || pointerId !== active.pointerId) return;
    if (
      !active.dragging &&
      (index !== active.index || (x - active.x) ** 2 + (y - active.y) ** 2 > 36)
    )
      active.dragging = true;
    if (!active.dragging) return;
    if (index !== null) {
      const line =
        active.previous === null
          ? [index]
          : crossedCells(active.previous, index, this.size());
      line.forEach((cell) => active.path.add(cell));
      this.onVisit(line.filter((cell) => cell !== active.previous));
    }
    active.previous = index;
    this.onPreview(
      [...active.path].filter((cell) => this.getValue(cell) !== 2),
      active.value,
    );
  }

  end(pointerId) {
    const active = this.active;
    if (!active || pointerId !== active.pointerId) return;
    this.active = null;
    if (active.dragging) {
      this.onPreview([], 0);
      this.onMarks([...active.path], active.value);
    } else if (active.second) {
      // Undo only the first tap's edit before replacing the whole double tap
      // with one pup action. A rejected pup replaces the note with a red X.
      active.second.rollback?.();
      this.onPup(active.index);
    } else {
      const pending = {
        index: active.index,
        rollback:
          this.getValue(active.index) === 2
            ? null
            : this.onMarks([active.index], active.value),
      };
      pending.timer = this.schedule(() => {
        if (this.pending === pending) this.flush();
      }, 280);
      this.pending = pending;
    }
  }

  flush() {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    this.unschedule(pending.timer);
  }

  cancel() {
    if (this.pending) this.unschedule(this.pending.timer);
    this.pending = null;
    this.active = null;
    this.onPreview([], 0);
  }
}

// Interpolate fast movements so a sparse pointer stream cannot leave holes.
export function crossedCells(from, to, size) {
  const row = Math.floor(from / size),
    col = from % size;
  const dr = Math.floor(to / size) - row,
    dc = (to % size) - col;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (!steps) return [from];
  return [
    ...new Set(
      Array.from(
        { length: steps + 1 },
        (_, i) =>
          Math.round(row + (dr * i) / steps) * size +
          Math.round(col + (dc * i) / steps),
      ),
    ),
  ];
}
