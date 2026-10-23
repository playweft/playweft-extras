// Pointer capture keeps the joystick active when the thumb leaves its base.
// Distances are read in viewport coordinates, independent of the game scaling.
export function createTouchControls({
  joystick,
  onChange,
  onTouch = () => {},
}) {
  let stickPointer = null,
    dir = -1;
  const emit = (nextDir) => {
    if (dir === nextDir) return;
    dir = nextDir;
    onChange({ dir });
  };
  function releaseCapture(element, pointer) {
    if (pointer !== null && element.hasPointerCapture(pointer))
      element.releasePointerCapture(pointer);
  }
  function resetStick() {
    const pointer = stickPointer;
    stickPointer = null;
    joystick.classList.remove("is-active");
    joystick.style.setProperty("--stick-x", "0px");
    joystick.style.setProperty("--stick-y", "0px");
    emit(-1);
    releaseCapture(joystick, pointer);
  }
  function move(event) {
    const rect = joystick.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      resetStick();
      return;
    }
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
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
  joystick.addEventListener("pointerdown", (event) => {
    if (
      stickPointer !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    if (event.pointerType !== "mouse") onTouch();
    stickPointer = event.pointerId;
    joystick.setPointerCapture(stickPointer);
    joystick.classList.add("is-active");
    move(event);
  });
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
  return {
    reset() {
      resetStick();
    },
  };
}
