import { useEffect, useSyncExternalStore } from "react";

/**
 * Publishes the on-screen keyboard height as `--keyboard-inset` on <html> so fixed
 * composers and bottom sheets stay above the keyboard (iOS does not resize the layout viewport).
 */
let keyboardInset = 0;
const listeners = new Set<() => void>();

function update() {
  const vv = window.visualViewport;
  const next = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  // Ignore small differences caused by browser chrome collapsing.
  const inset = next > 80 ? next : 0;
  if (inset !== keyboardInset) {
    keyboardInset = inset;
    document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    document.documentElement.toggleAttribute("data-keyboard-open", inset > 0);
    listeners.forEach((l) => l());
  }
}

export function useKeyboardInsetTracker() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}

export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => keyboardInset > 0,
    () => false,
  );
}
