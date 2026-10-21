import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { MoreMenuSheet } from "@/components/layout/MobileNavigation";
import { BOTTOM_NAV_PATHS, NAV_ITEMS, SECONDARY_NAV_ITEMS, isActivePath } from "@/components/layout/nav-items";
import { useKeyboardOpen } from "@/hooks/use-visual-viewport";

const ITEMS = BOTTOM_NAV_PATHS.map((p) => NAV_ITEMS.find((i) => i.path === p)!);

const itemClass =
  "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function BottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const secondaryActive = SECONDARY_NAV_ITEMS.some((i) => isActivePath(i.path, pathname));

  // Hidden while the on-screen keyboard is open so it never floats above the keyboard.
  if (keyboardOpen) return null;

  return (
    <nav
      aria-label="التنقل السريع"
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
        {ITEMS.map((item) => {
          const active = isActivePath(item.path, pathname);
          const isAssistant = item.path === "/app/assistant";
          return (
            <li key={item.path} className="flex min-w-0">
              <NavLink
                to={item.path}
                end={item.path === "/app"}
                className={cn(itemClass, active ? "text-foreground" : "text-muted-foreground")}
              >
                {isAssistant ? (
                  <span
                    className={cn(
                      "-mt-5 flex h-12 w-12 items-center justify-center rounded-full border shadow-gold transition-colors",
                      active ? "border-gold bg-gold text-ink" : "border-gold/50 bg-night text-gold",
                    )}
                  >
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                ) : (
                  <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-gold/15 text-gold-deep")}>
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
                <span className="max-w-full truncate leading-none">{item.shortLabel}</span>
              </NavLink>
            </li>
          );
        })}
        <li className="flex min-w-0">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(itemClass, secondaryActive ? "text-foreground" : "text-muted-foreground")}
            >
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", secondaryActive && "bg-gold/15 text-gold-deep")}>
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="leading-none">المزيد</span>
            </button>
            <MoreMenuSheet onClose={() => setMoreOpen(false)} scope="secondary" />
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
