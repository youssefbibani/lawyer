import { useState } from "react";
import { Menu, Scale } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NavList } from "@/components/layout/NavList";
import { ScrollFade } from "@/components/shared/ScrollFade";
import { UserCard } from "@/components/layout/UserCard";
import { DemoModeBadge } from "@/components/layout/DemoModeBadge";
import { NAV_ITEMS, SECONDARY_NAV_ITEMS } from "@/components/layout/nav-items";

interface MoreMenuSheetProps {
  onClose: () => void;
  /** Every section (header menu) or only the secondary ones (bottom bar "المزيد"). */
  scope?: "all" | "secondary";
}

export function MoreMenuSheet({ onClose, scope = "all" }: MoreMenuSheetProps) {
  return (
    <SheetContent side="right">
      <SheetHeader className="flex-row items-center gap-3 border-b border-sidebar-border py-4 pl-14">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] border border-gold/40 bg-gold/10">
          <Scale className="h-5 w-5 text-gold" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <SheetTitle className="text-cream">قصر العدالة</SheetTitle>
          <SheetDescription>{scope === "secondary" ? "أقسام أخرى" : "منصة المحامين"}</SheetDescription>
        </div>
      </SheetHeader>

      <ScrollFade className="sidebar-scroll min-h-0 flex-1 overscroll-contain px-3 py-4">
        <p className="mb-2 px-3 text-xs font-medium text-sidebar-foreground/50">القائمة</p>
        <NavList onNavigate={onClose} items={scope === "secondary" ? SECONDARY_NAV_ITEMS : NAV_ITEMS} />
      </ScrollFade>

      <div className="shrink-0 space-y-3 border-t border-sidebar-border p-4">
        <DemoModeBadge variant="sidebar" />
        <UserCard onLoggedOut={onClose} />
      </div>
    </SheetContent>
  );
}

/** Header menu button, used on full-screen pages where the bottom bar is hidden. */
export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="فتح القائمة" className="shrink-0 lg:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <MoreMenuSheet onClose={() => setOpen(false)} />
    </Sheet>
  );
}
