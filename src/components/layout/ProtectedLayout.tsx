import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ServerCrash, ShieldAlert } from "lucide-react";

import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { ReminderScheduler } from "@/components/layout/ReminderScheduler";
import { ArchiveJobRunner } from "@/components/archive/ArchiveJobRunner";
import { Button } from "@/components/ui/button";
import { useKeyboardInsetTracker } from "@/hooks/use-visual-viewport";
import { useMe } from "@/backend/queries";
import { isApiError, setUnauthenticatedHandler } from "@/backend/http";
import { signOut } from "@/backend/auth";

/** Full-screen conversation and editor views hide the bottom bar on phones. */
export function hidesBottomNav(pathname: string) {
  return pathname.startsWith("/app/assistant") || pathname.startsWith("/app/archive/new") || pathname.startsWith("/app/archive/batches");
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-center">{children}</div>;
}

/**
 * Every /app route requires a server session. Identity, office and role come from /api/v1/me
 * (resolved on the server), never from browser storage.
 */
export function ProtectedLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  useKeyboardInsetTracker();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      queryClient.clear();
      navigate("/", { replace: true, state: { from: pathname, expired: true } });
    });
    return () => setUnauthenticatedHandler(null);
  }, [navigate, pathname, queryClient]);

  if (me.isPending) {
    return (
      <Centered>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          جارٍ التحقق من الجلسة...
        </p>
      </Centered>
    );
  }

  if (me.error) {
    if (isApiError(me.error, "UNAUTHENTICATED")) return <Navigate to="/" replace state={{ from: pathname }} />;
    if (isApiError(me.error, "NO_ACTIVE_OFFICE")) {
      return (
        <Centered>
          <div className="max-w-sm space-y-4">
            <ShieldAlert className="mx-auto h-10 w-10 text-alert" aria-hidden="true" />
            <p className="text-sm">{me.error.message}</p>
            <Button variant="outline" onClick={() => void signOut().finally(() => navigate("/", { replace: true }))}>
              تسجيل الخروج
            </Button>
          </div>
        </Centered>
      );
    }
    return (
      <Centered>
        <div className="max-w-sm space-y-4">
          <ServerCrash className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm">{me.error.message}</p>
          <Button onClick={() => void me.refetch()}>إعادة المحاولة</Button>
        </div>
      </Centered>
    );
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-[60] focus:rounded-sm focus:bg-gold focus:px-4 focus:py-2 focus:text-ink"
      >
        الانتقال إلى المحتوى
      </a>
      <Sidebar />
      <div id="main-content" className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      {!hidesBottomNav(pathname) && <BottomNav />}
      <ReminderScheduler />
      <ArchiveJobRunner />
    </div>
  );
}
