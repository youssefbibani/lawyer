import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { MobileNavigation } from "@/components/layout/MobileNavigation";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";
import { DemoModeBadge } from "@/components/layout/DemoModeBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Shows a back button (mobile-first deep pages). */
  backTo?: string;
  /** Full-height pages (assistant) manage their own scrolling and hide the bottom bar. */
  fullHeight?: boolean;
  mainClassName?: string;
  /** Workflow pages with their own persistent bottom action bar (bottom navigation hidden). */
  actionBar?: boolean;
}

export function AppShell({ children, title, subtitle, actions, backTo, fullHeight = false, mainClassName, actionBar = false }: AppShellProps) {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [quickQuery, setQuickQuery] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.title = `${title} — قصر العدالة`;
  }, [title]);

  function submitQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = quickQuery.trim();
    navigate(q ? `/app/search?q=${encodeURIComponent(q)}` : "/app/search");
  }

  return (
    // Full-height pages must not flex-grow: `flex-1` sets flex-basis 0%, which overrides `h-dvh` and lets the
    // page grow with its content (the chat then never scrolls inside its panel and the composer leaves the screen).
    <div className={cn("flex min-w-0 flex-col", fullHeight ? "h-dvh flex-none overflow-hidden" : "min-h-dvh flex-1")}>
      <header className="no-print sticky top-0 z-30 shrink-0 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 md:h-16 md:px-6 xl:px-8">
          {(fullHeight || actionBar) && <MobileNavigation />}
          {backTo && (
            <Button variant="ghost" size="icon" aria-label="رجوع" onClick={() => navigate(backTo)} className="shrink-0 lg:hidden">
              <ArrowRight className="h-5 w-5" />
            </Button>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-heading text-lg leading-tight md:text-xl" title={title}>
              {title}
            </h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground md:text-sm">{subtitle}</p>}
          </div>

          <form role="search" onSubmit={submitQuickSearch} className="relative hidden md:block">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="بحث سريع في الأرشيف..."
              aria-label="بحث سريع في الأرشيف"
              className="w-52 pl-14 pr-9 lg:w-64"
            />
            <kbd className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" dir="ltr">
              Ctrl K
            </kbd>
          </form>
          <Button variant="ghost" size="icon" aria-label="البحث في الأرشيف" className="shrink-0 md:hidden" onClick={() => navigate("/app/search")}>
            <Search className="h-5 w-5" />
          </Button>

          <NotificationsMenu />
          <div className="hidden sm:block lg:hidden">
            <DemoModeBadge />
          </div>

          {actions && <div className="hidden items-center gap-2 sm:flex">{actions}</div>}
        </div>
      </header>

      <main
        className={cn(
          "min-w-0 flex-1 animate-fade-in",
          fullHeight
            ? "flex min-h-0 flex-col"
            : actionBar
              ? "p-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] md:p-6 md:pb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:pb-8 xl:p-8"
              : "p-4 pb-bottom-nav md:p-6 md:pb-bottom-nav lg:pb-8 xl:p-8",
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
