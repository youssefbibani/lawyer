import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Scale } from "lucide-react";

import { NavList } from "@/components/layout/NavList";
import { UserCard } from "@/components/layout/UserCard";
import { DemoModeBadge } from "@/components/layout/DemoModeBadge";
import { ScrollFade } from "@/components/shared/ScrollFade";

/** Room kept above/below the active link so it never sits under a fade edge. */
const ACTIVE_LINK_MARGIN = 36;

export function Sidebar() {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLDivElement>(null);

  // On short windows the list scrolls; make sure the current section is always in view.
  useEffect(() => {
    const container = navRef.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !active) return;
    const c = container.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.top < c.top + ACTIVE_LINK_MARGIN) container.scrollTop -= c.top + ACTIVE_LINK_MARGIN - a.top;
    else if (a.bottom > c.bottom - ACTIVE_LINK_MARGIN) container.scrollTop += a.bottom - (c.bottom - ACTIVE_LINK_MARGIN);
  }, [pathname]);

  return (
    <aside className="no-print hidden w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh">
      <div className="flex shrink-0 items-center gap-3 border-b border-sidebar-border px-5 py-5 short:py-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-gold/40 bg-gold/10 short:h-9 short:w-9">
          <Scale className="h-5 w-5 text-gold" aria-hidden="true" />
        </div>
        <div>
          <p className="font-heading text-lg leading-tight text-cream">قصر العدالة</p>
          <p className="text-xs text-sidebar-foreground/60">منصة المحامين</p>
        </div>
      </div>

      <ScrollFade ref={navRef} className="sidebar-scroll min-h-0 flex-1 overscroll-contain px-3 py-4 short:py-2">
        <p className="mb-2 px-3 text-xs font-medium text-sidebar-foreground/50 short:hidden">القائمة</p>
        <NavList dense />
      </ScrollFade>

      <div className="shrink-0 space-y-3 border-t border-sidebar-border p-4 short:space-y-2 short:p-3">
        <DemoModeBadge variant="sidebar" />
        <UserCard />
      </div>
    </aside>
  );
}
