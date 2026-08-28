/** @deprecated JS safe-area більше не потрібен — env() у CSS, без layout-shift при hydration. */
export function initAppViewport(): () => void {
  return () => {};
}

export function lockAppViewport(): () => void {
  return initAppViewport();
}
