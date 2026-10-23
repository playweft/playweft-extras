// Pointer capture keeps the joystick active when the thumb leaves its base.
// Distances are read in viewport coordinates, independent of the game scaling.
export function createTouchControls({
  joystick,
  onChange,
  onTouch = () => {},
  activationArea = null,
  getActivationBounds = () => null,
}) {
  let stickPointer = null,
    dir = -1,
    origin = null;
  const emit = (nextDir) => {
    if (dir === nextDir) return;
    dir = nextDir;
    onChange({ dir });
  };
  function releaseCapture(element, pointer) {
    if (pointer !== null && element.hasPointerCapture(pointer))
      element.releasePointerCapture(pointer);
  }
  function place(x, y, bounds) {
    const rect = joystick.getBoundingClientRect();
    if (!rect.width || !rect.height || !bounds) return;
    const halfX = rect.width / 2, halfY = rect.height / 2;
    const clamp = (v, low, high) => Math.max(low, Math.min(Math.max(low, high), v));
    const cx = clamp(x, bounds.left + halfX, bounds.right - halfX);
    const cy = clamp(y, bounds.top + halfY, bounds.bottom - halfY);
    joystick.parentElement.style.setProperty("--stick-left", `${cx - halfX}px`);
    joystick.parentElement.style.setProperty("--stick-top", `${cy - halfY}px`);
  }
  function home() {
    const bounds = getActivationBounds();
    if (bounds) place(bounds.homeX, bounds.homeY, bounds);
  }
  function resetStick() {
    const pointer = stickPointer;
    stickPointer = null;
    origin = null;
    joystick.classList.remove("is-active");
    joystick.style.setProperty("--stick-x", "0px");
    joystick.style.setProperty("--stick-y", "0px");
    emit(-1);
    releaseCapture(joystick, pointer);
    home();
  }
  function move(event) {
    const rect = joystick.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      resetStick();
      return;
    }
    const x = event.clientX - (origin?.x ?? rect.left + rect.width / 2);
    const y = event.clientY - (origin?.y ?? rect.top + rect.height / 2);
    const distance = Math.hypot(x, y),
      radius = Math.min(rect.width, rect.height) * 0.3;
    const clamped = distance ? Math.min(distance, radius) / distance : 0;
    // The element itself is not inside the scaled game viewport.
    joystick.style.setProperty("--stick-x", `${x * clamped}px`);
    joystick.style.setProperty("--stick-y", `${y * clamped}px`);
    emit(
      distance < radius * 0.23
        ? -1
        : Math.abs(x) >= Math.abs(y)
          ? x > 0
            ? 0
            : 2
          : y > 0
            ? 1
            : 3,
    );
  }
  function startStick(event, fromArea = false) {
    if (
      stickPointer !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    const touch = event.pointerType === "touch" || event.pointerType === "pen";
    if (touch) { onTouch(); home(); }
    const bounds = touch ? getActivationBounds() : null;
    if (fromArea && (!touch || !bounds ||
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom ||
      event.target.closest?.("button, a, input, select, textarea, [role=button]"))) return;
    event.preventDefault();
    if (bounds) {
      // Input starts neutral at the actual thumb position. Only the artwork is
      // clamped at the safe area's edges, so a border press never steers itself.
      origin = { x: event.clientX, y: event.clientY };
      place(origin.x, origin.y, bounds);
    }
    stickPointer = event.pointerId;
    joystick.setPointerCapture(stickPointer);
    joystick.classList.add("is-active");
    move(event);
  }
  joystick.addEventListener("pointerdown", (event) => startStick(event));
  activationArea?.addEventListener("pointerdown", (event) => startStick(event, true), { passive: false });
  joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== stickPointer) return;
    event.preventDefault();
    move(event);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    joystick.addEventListener(type, (event) => {
      if (event.pointerId === stickPointer) resetStick();
    });
  }
  home();
  return {
    reset() {
      resetStick();
    },
  };
}
