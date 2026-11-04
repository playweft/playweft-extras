const ITEM_BUTTONS = [[0, "glue"], [2, "banana"], [3, "fork"]];
const pressed = (pad, index) => pad.buttons[index]?.pressed === true;

function direction(pad, previous = -1) {
  const x = Number(pressed(pad, 15)) - Number(pressed(pad, 14));
  const y = Number(pressed(pad, 13)) - Number(pressed(pad, 12));
  if (x || y) {
    if ((previous === 0 && x > 0) || (previous === 2 && x < 0) ||
      (previous === 1 && y > 0) || (previous === 3 && y < 0)) return previous;
    return y ? (y > 0 ? 1 : 3) : (x > 0 ? 0 : 2);
  }
  const ax = Number.isFinite(pad.axes[0]) ? pad.axes[0] : 0;
  const ay = Number.isFinite(pad.axes[1]) ? pad.axes[1] : 0;
  // Separate engage/release thresholds and axis hysteresis prevent drift and
  // alternating horizontal/vertical movement around a diagonal.
  if (previous >= 0) {
    const along = previous % 2 ? ay : ax, across = previous % 2 ? ax : ay;
    if (Math.abs(along) >= .22 && Math.sign(along) === (previous < 2 ? 1 : -1) &&
      Math.abs(across) < Math.abs(along) * 1.2) return previous;
  }
  if (Math.max(Math.abs(ax), Math.abs(ay)) < .35) return -1;
  return Math.abs(ay) > Math.abs(ax) ? (ay > 0 ? 1 : 3) : (ax > 0 ? 0 : 2);
}

export class BubbleGamepadInput {
  slots = [];
  capacity = 1;

  reset() {
    for (const slot of this.slots) if (slot) {
      slot.buttons = null;
      slot.dir = -1;
      slot.armed = false;
    }
  }

  poll(pads, now, capacity = 1) {
    if (capacity !== this.capacity) { this.slots = []; this.capacity = capacity; }
    const available = Array.from(pads ?? []).filter(p => p?.connected && p.mapping === "standard")
      .sort((a, b) => a.index - b.index);
    const disconnected = [];
    for (let player = 0; player < capacity; player++) {
      const old = this.slots[player];
      if (old && !available.some(p => p.index === old.index && p.id === old.id)) {
        if (old.used) disconnected.push(player);
        this.slots[player] = null;
      }
    }
    for (const pad of available) {
      if (this.slots.some(s => s?.index === pad.index && s.id === pad.id)) continue;
      const player = Array.from({ length: capacity }, (_, i) => i).find(i => !this.slots[i]);
      if (player === undefined) break;
      this.slots[player] = { index: pad.index, id: pad.id, buttons: null, dir: -1, armed: false, used: false, changedAt: now };
    }
    const actions = [];
    for (const [player, slot] of this.slots.entries()) {
      if (!slot) continue;
      const pad = available.find(p => p.index === slot.index && p.id === slot.id);
      const buttons = Array.from({ length: 17 }, (_, i) => pressed(pad, i));
      const next = direction(pad, slot.dir);
      if (!slot.buttons) {
        slot.buttons = buttons;
        slot.armed = next < 0;
        continue;
      }
      const edge = index => buttons[index] && !slot.buttons[index];
      const reserved = buttons[8] || buttons[16];
      if (reserved) slot.armed = false;
      else {
        if (next < 0) slot.armed = true;
        if (edge(9)) actions.push({ player, type: "menu" });
        else if (edge(4) || edge(5)) actions.push({ player, type: "mode", direction: edge(5) ? 1 : -1 });
        else {
          const item = ITEM_BUTTONS.find(([index]) => edge(index));
          if (item) actions.push({ player, type: "item", kind: item[1] });
        }
      }
      const dir = !reserved && slot.armed ? next : -1;
      if (dir !== slot.dir) slot.changedAt = now;
      slot.dir = dir;
      if (dir >= 0 || actions.some(a => a.player === player)) slot.used = true;
      slot.buttons = buttons;
    }
    return {
      players: Array.from({ length: capacity }, (_, i) => this.slots[i]
        ? { dir: this.slots[i].dir, changedAt: this.slots[i].changedAt, connected: true }
        : { dir: -1, changedAt: -Infinity, connected: false }),
      actions, disconnected,
    };
  }
}
