// Whether the latest pointer event moved the pointer. Chrome also sends pointer events when the page
// scrolls under a resting mouse, at the same viewport position; a hover preview should start only when the
// person moved the mouse, or a presenter's scroll starts whichever card lands under it. A capture listener
// on window runs before the element's own handler, so the handler reads the answer for the same event.
let last = { x: Number.NaN, y: Number.NaN };
let moved = false;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointermove",
    (e) => {
      moved = e.clientX !== last.x || e.clientY !== last.y;
      last = { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true },
  );
}

export const pointerMoved = () => moved;

/** Automatic previews are for pointing devices. Explicit controls remain available to every input mode. */
export const canAutoPreview = (pointerType: string, reducedMotion: boolean) => pointerType === "mouse" && !reducedMotion;
