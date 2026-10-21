/**
 * Append-only, hash-chained audit log.
 *
 * Entries are stored newest-first; each entry's `hash` covers its content and the hash of the
 * entry recorded just before it. Editing, deleting or reordering any entry breaks the chain,
 * which `verifyAuditChain` detects. (In production the chain must be written server-side to
 * append-only storage; a browser can only make tampering detectable, not impossible.)
 */
import type { AuditEntry } from "@/types";
import { canonicalJson, sha256 } from "@/lib/hash";

export const GENESIS_HASH = "0".repeat(64);

function entryHash(entry: Omit<AuditEntry, "hash">): string {
  const { prevHash, ...content } = entry;
  return sha256(`${prevHash ?? GENESIS_HASH}|${canonicalJson(content)}`);
}

export function sealEntry(entry: Omit<AuditEntry, "hash" | "prevHash">, previous: AuditEntry | undefined): AuditEntry {
  const prevHash = previous?.hash ?? GENESIS_HASH;
  const withPrev = { ...entry, prevHash };
  return { ...withPrev, hash: entryHash(withPrev) };
}

/** Re-seals entries that predate the hash chain (data migrated from older versions). */
export function sealLegacy(newestFirst: AuditEntry[]): AuditEntry[] {
  const chronological = [...newestFirst].reverse();
  const sealed: AuditEntry[] = [];
  for (const e of chronological) {
    const { hash: _h, prevHash: _p, ...rest } = e;
    void _h;
    void _p;
    sealed.push(sealEntry(rest, sealed[sealed.length - 1]));
  }
  return sealed.reverse();
}

export type ChainVerification = { ok: true; length: number } | { ok: false; brokenAt: number; entryId: string };

export function verifyAuditChain(newestFirst: AuditEntry[]): ChainVerification {
  let previousHash = GENESIS_HASH;
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const e = newestFirst[i];
    const { hash, ...rest } = e;
    if (e.prevHash !== previousHash || entryHash(rest) !== hash) {
      return { ok: false, brokenAt: newestFirst.length - 1 - i, entryId: e.id };
    }
    previousHash = hash!;
  }
  return { ok: true, length: newestFirst.length };
}
