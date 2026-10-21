/**
 * Bridge to the protected demo modules (smart archive, assistant), which still run on the local
 * in-browser store and were deliberately not migrated in this phase. A backend case is matched to
 * the demo case with the same reference, so the documents tab and the assistant links keep working.
 */
import { useMemo } from "react";

import { useCurrentUser, useDB } from "@/hooks/use-db";
import { caseByRef, documentsForCase } from "@/services/api";

export function useLocalCaseBridge() {
  const db = useDB();
  const user = useCurrentUser();
  return useMemo(
    () => ({
      localCase: (reference: string | undefined) => (reference ? caseByRef(reference, db, user) : undefined),
      documentCount: (reference: string | undefined) => {
        const local = reference ? caseByRef(reference, db, user) : undefined;
        return local ? documentsForCase(local.id, db, user).length : null;
      },
      documents: (reference: string | undefined) => {
        const local = reference ? caseByRef(reference, db, user) : undefined;
        return local ? documentsForCase(local.id, db, user) : [];
      },
    }),
    [db, user],
  );
}
