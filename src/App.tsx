import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigationType } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";

import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

// Route-level code splitting keeps the first load light on mobile networks.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Cases = lazy(() => import("@/pages/Cases"));
const Clients = lazy(() => import("@/pages/Clients"));
const CaseDetail = lazy(() => import("@/pages/CaseDetail"));
const ArchiveDashboard = lazy(() => import("@/pages/archive/ArchiveDashboard"));
const BatchCreate = lazy(() => import("@/pages/archive/BatchCreate"));
const BatchWorkspace = lazy(() => import("@/pages/archive/BatchWorkspace"));
const ReviewWorkspace = lazy(() => import("@/pages/archive/ReviewWorkspace"));
const Approvals = lazy(() => import("@/pages/Approvals"));
const ArchiveSearch = lazy(() => import("@/pages/ArchiveSearch"));
const DocumentViewer = lazy(() => import("@/pages/DocumentViewer"));
const Agenda = lazy(() => import("@/pages/Agenda"));
const Payments = lazy(() => import("@/pages/Payments"));
const Settings = lazy(() => import("@/pages/Settings"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Assistant = lazy(() => import("@/pages/Assistant"));
const BriefEditor = lazy(() => import("@/pages/BriefEditor"));

function PageFallback() {
  return (
    <div className="p-4 md:p-6" role="status" aria-label="جارٍ التحميل">
      <SkeletonCards count={3} />
    </div>
  );
}

const page = (element: React.ReactNode) => <Suspense fallback={<PageFallback />}>{element}</Suspense>;

/**
 * A new page opens at the top instead of inheriting the previous page's scroll offset. Back/forward
 * (POP) is left to the browser so returning to a long list restores where the user was.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, navigationType]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <Toaster />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/assistant" element={<Navigate to="/app/assistant" replace />} />
            <Route path="/app" element={<ProtectedLayout />}>
              <Route index element={page(<Dashboard />)} />
              <Route path="assistant" element={page(<Assistant />)} />
              <Route path="assistant/briefs/:id" element={page(<BriefEditor />)} />
              <Route path="cases" element={page(<Cases />)} />
              <Route path="cases/:id" element={page(<CaseDetail />)} />
              <Route path="clients" element={page(<Clients />)} />
              <Route path="tasks" element={page(<Tasks />)} />
              <Route path="archive" element={page(<ArchiveDashboard />)} />
              <Route path="archive/new" element={page(<BatchCreate />)} />
              <Route path="archive/batches/:batchId" element={page(<BatchWorkspace />)} />
              <Route path="archive/batches/:batchId/review/:itemId" element={page(<ReviewWorkspace />)} />
              <Route path="approvals" element={page(<Approvals />)} />
              <Route path="search" element={page(<ArchiveSearch />)} />
              <Route path="document" element={page(<DocumentViewer />)} />
              <Route path="document/:docId" element={page(<DocumentViewer />)} />
              <Route path="agenda" element={page(<Agenda />)} />
              <Route path="payments" element={page(<Payments />)} />
              <Route path="settings" element={page(<Settings />)} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
