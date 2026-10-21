import { Link } from "react-router-dom";
import { FileText } from "lucide-react";

import { citationHref } from "@/services/retrieval";
import type { Citation } from "@/types";

export function CitationLink({ citation, compact = false }: { citation: Citation; compact?: boolean }) {
  return (
    <Link
      to={citationHref(citation)}
      className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-sm border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs text-gold-deep transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
      aria-label={`فتح المصدر: ${citation.title}${citation.page ? `، الصفحة ${citation.page}` : ""}`}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{compact ? citation.title.split(" — ")[0] : citation.title}</span>
      {citation.page && <span className="shrink-0 font-mono">ص {citation.page}</span>}
    </Link>
  );
}
