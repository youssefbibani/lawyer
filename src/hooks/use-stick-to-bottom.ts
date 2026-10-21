import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Within this distance (px) of the bottom, moving down again resumes following the newest content. */
const FOLLOW_ZONE = 24;
/** Moving up by more than this means the user is reading earlier content: stop following. */
const LEAVE_ZONE = 2;
/** Glide only for short hops; long jumps are instant so they never feel slow. */
const SMOOTH_MAX_SCREENS = 1.5;

export interface StickToBottom {
  /** The element that scrolls. */
  scrollerRef: React.RefObject<HTMLDivElement>;
  /** A wrapper around everything inside the scroller; its height changes are what get followed. */
  contentRef: React.RefObject<HTMLDivElement>;
  /** True while the view follows the newest content. False once the user scrolls up to read. */
  atBottom: boolean;
  /** Content was added or grew while the user was reading higher up. */
  hasNewContent: boolean;
  /** Go to the newest content and follow it again. */
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
}

/**
 * Chat-style scrolling: follows new content (streaming text, expanding cards, a growing composer, the
 * on-screen keyboard) while the user is at the bottom, lets go the moment they scroll up, and offers a way back.
 *
 * Intent is read from the scroll direction, not from a distance threshold, so a small scroll up during
 * streaming is respected instead of being dragged back down. Content growth alone never changes
 * `scrollTop`, so it can never be mistaken for the user scrolling.
 *
 * `resetKey` (for example a conversation id) re-attaches to the bottom whenever it changes.
 */
export function useStickToBottom({ resetKey }: { resetKey?: unknown } = {}): StickToBottom {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const lastContentHeight = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNewContent, setHasNewContent] = useState(false);

  const follow = useCallback((value: boolean) => {
    following.current = value;
    setAtBottom(value);
    if (value) setHasNewContent(false);
  }, []);

  const jump = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, []);

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth" = "auto") => {
      const el = scrollerRef.current;
      if (!el) return;
      follow(true);
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const glide = behavior === "smooth" && !reduceMotion && typeof el.scrollTo === "function" && distance < el.clientHeight * SMOOTH_MAX_SCREENS;
      if (glide) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else jump();
    },
    [follow, jump],
  );

  // Attach to the bottom on mount and whenever the reset key changes (before paint: no flash of the top).
  useLayoutEffect(() => {
    follow(true);
    jump();
  }, [resetKey, follow, jump]);

  // The user's scrolling decides whether to follow.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    lastTop.current = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const distance = el.scrollHeight - top - el.clientHeight;
      const movedUp = top < lastTop.current;
      lastTop.current = top;
      if (movedUp && distance > LEAVE_ZONE) {
        if (following.current) follow(false);
      } else if (!movedUp && distance <= FOLLOW_ZONE) {
        if (!following.current) follow(true);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [follow]);

  // Content or viewport size changes: keep following, or note that there is something new below.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content || typeof ResizeObserver === "undefined") return;
    lastContentHeight.current = content.offsetHeight;
    const observer = new ResizeObserver(() => {
      const height = content.offsetHeight;
      const grew = height > lastContentHeight.current;
      lastContentHeight.current = height;
      if (following.current) jump();
      else if (grew) setHasNewContent(true);
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [jump]);

  return { scrollerRef, contentRef, atBottom, hasNewContent, scrollToBottom };
}
