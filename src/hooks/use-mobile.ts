import { useMediaQuery } from "@/hooks/use-media-query";

const MOBILE_BREAKPOINT = 1024;

/** Below `lg`: the desktop sidebar is replaced by bottom navigation. */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
