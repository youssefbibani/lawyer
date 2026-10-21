import { useSyncExternalStore } from "react";

import { getDB, subscribeDB, type DemoDatabase } from "@/services/db";
import { currentUser } from "@/services/api";
import type { TeamMember } from "@/types";

/** Subscribes to the local demo database (immutable snapshots). */
export function useDB(): DemoDatabase {
  return useSyncExternalStore(subscribeDB, getDB, getDB);
}

export function useCurrentUser(): TeamMember {
  return currentUser(useDB());
}
