import { useEffect } from "react";

/** Resumes interrupted archive processing once per tab; jobs keep running across pages. */
export function ArchiveJobRunner() {
  useEffect(() => {
    let cancelled = false;
    // Loaded lazily so the archive pipeline does not weigh on the first page load.
    void import("@/services/archive/pipeline").then((m) => {
      if (!cancelled) m.resumeProcessing();
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
