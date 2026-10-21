import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";
import { NAV_ITEMS, type NavItem } from "@/components/layout/nav-items";
import { useCurrentUser, useDB } from "@/hooks/use-db";

interface NavListProps {
  onNavigate?: () => void;
  items?: NavItem[];
  label?: string;
  /** Desktop sidebar density: tighter rows (and tighter still on short windows) so the list fits without scrolling. */
  dense?: boolean;
}

export function NavList({ onNavigate, items = NAV_ITEMS, label = "القائمة الرئيسية", dense = false }: NavListProps) {
  const db = useDB();
  const user = useCurrentUser();
  // Lightweight count (the full approval engine is loaded only on the pages that use it).
  const pending = db.approvals.filter((a) => a.status === "pending" && a.approverRoles.includes(user.role)).length;
  return (
    <nav aria-label={label} className={cn("flex flex-col gap-1", dense && "short:gap-0.5")}>
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/app"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "relative flex items-center gap-3 rounded-[var(--radius)] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              dense ? "min-h-10 py-2 short:min-h-[34px] short:py-1.5 coarse:min-h-11 coarse:py-2.5" : "min-h-11 py-2.5",
              isActive
                ? "bg-sidebar-accent text-gold"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute right-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-gold" aria-hidden="true" />
              )}
              <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
              {item.counter === "approvals" && pending > 0 && (
                <span className="rounded-full bg-alert px-1.5 py-0.5 font-mono text-[10px] font-semibold text-alert-foreground" aria-label={`${pending} طلبات بانتظار قرارك`}>
                  {pending}
                </span>
              )}
              {item.badge && (
                <span className="rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                  {item.badge}
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
