import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";

/**
 * True when the backend data layer (React Query) is mounted. Shared shell components rendered
 * by the protected demo pages (assistant, archive, approvals) use it to stay renderable on their
 * own — e.g. in those pages' isolated tests — without a backend connection.
 */
export function useHasBackend(): boolean {
  return !!useContext(QueryClientContext);
}
