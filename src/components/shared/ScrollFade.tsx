import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Vertical scroll container that fades the top/bottom edge while more content is hidden there,
 * so a clipped list reads as "keep scrolling" rather than "cut off".
 */
export const ScrollFade = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function ScrollFade(
  { className, onScroll, children, ...props },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  // Re-measure when the container (window resize) or its content (items added/removed) changes size.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        measure();
        onScroll?.(e);
      }}
      data-fade-top={edges.top}
      data-fade-bottom={edges.bottom}
      className={cn("scroll-fade overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
});
