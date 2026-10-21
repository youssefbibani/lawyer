import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { signOut } from "@/backend/auth";
import { useMe } from "@/backend/queries";
import { ROLE_LABELS_AR } from "@/backend/labels";
import { useHasBackend } from "@/backend/optional";

function initials(name: string): string {
  const parts = name.replace(/^(الأستاذة?|الأستاذ)\s+/, "").split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.replace(/^ال/, "")[0]).join(".");
}

export function UserCard(props: { onLoggedOut?: () => void }) {
  return useHasBackend() ? <BackendUserCard {...props} /> : null;
}

function BackendUserCard({ onLoggedOut }: { onLoggedOut?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleLogout() {
    try {
      await signOut();
      toast.success("تم تسجيل الخروج بنجاح");
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    queryClient.clear();
    onLoggedOut?.();
    navigate("/", { replace: true });
  }

  if (!me) return null;

  return (
    <>
      <div className="flex items-center gap-3 rounded-[var(--radius)] bg-sidebar-accent/50 p-3 short:gap-2 short:p-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-semibold text-ink">{initials(me.user.name)}</div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-cream">{me.user.name}</p>
          <p className="line-clamp-2 text-xs leading-snug text-sidebar-foreground/60 short:line-clamp-1" title={`${ROLE_LABELS_AR[me.role]} — ${me.office.name}`}>
            {ROLE_LABELS_AR[me.role]} — {me.office.name}
          </p>
        </div>
        <button
          type="button"
          aria-label="تسجيل الخروج"
          onClick={() => setConfirmOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold short:h-9 short:w-9 coarse:h-11 coarse:w-11"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="تسجيل الخروج"
        description="هل أنت متأكد من رغبتك في تسجيل الخروج من حسابك؟"
        confirmLabel="تسجيل الخروج"
        cancelLabel="إلغاء"
        onConfirm={handleLogout}
      />
    </>
  );
}
