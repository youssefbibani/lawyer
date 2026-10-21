import { useCallback, useSyncExternalStore } from "react";

function getMatch(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => getMatch(query), () => false);
}

/** Phones and small tablets (below Tailwind `md`). Used to swap tables for stacked cards. */
export function useIsCompact(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
