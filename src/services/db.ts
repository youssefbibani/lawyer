/**
 * Local demo persistence.
 *
 * There is no backend in this prototype. Every write goes through `commit()`, which
 * serialises the database to localStorage and reads it back to verify the write
 * before the UI is told it succeeded. Replace this module (and `api.ts`) with real
 * server calls when a backend exists — the UI only talks to `api.ts`.
 */
import type {
  ApprovalRequest,
  ArchiveBatch,
  ArchiveItem,
  OfficePolicy,
  ProcessingJob,
  ArchiveDocument,
  AssistantPrefs,
  AuditEntry,
  Brief,
  CaseNote,
  DocumentLink,
  Hearing,
  LegalCase,
  MessageDraft,
  Payment,
  ReceiptRecord,
  Task,
  TimelineEvent,
} from "@/types";
import type { Conversation } from "@/services/assistant/types";
import { sealLegacy } from "@/services/audit";
import {
  caseNotes,
  documents,
  payments,
  seedBatches,
  TENANT_ID,
  seedCases,
  seedHearings,
  seedTasks,
  timelineEvents,
} from "@/data/mock";

export const DB_KEY = "qasr-al-adala:db:v2";
const SESSION_CONVERSATIONS_KEY = "qasr-al-adala:conversations:session";
const DB_VERSION = 3;

export interface DemoDatabase {
  version: number;
  seededAt: string;
  currentUserId: string;
  cases: LegalCase[];
  hearings: Hearing[];
  tasks: Task[];
  notes: CaseNote[];
  timeline: TimelineEvent[];
  documents: ArchiveDocument[];
  payments: Payment[];
  receipts: ReceiptRecord[];
  drafts: MessageDraft[];
  docLinks: DocumentLink[];
  briefs: Brief[];
  conversations: Conversation[];
  audit: AuditEntry[];
  prefs: AssistantPrefs;
  tenantId: string;
  approvals: ApprovalRequest[];
  policy: OfficePolicy;
  batches: ArchiveBatch[];
  archiveItems: ArchiveItem[];
  jobs: ProcessingJob[];
}

export const DEFAULT_PREFS: AssistantPrefs = {
  voiceProvider: "none",
  browserVoiceConsent: false,
  speechPlayback: false,
  retentionDays: 30,
};

export function createSeed(now: Date = new Date()): DemoDatabase {
  return {
    version: DB_VERSION,
    seededAt: now.toISOString(),
    currentUserId: "u1",
    cases: seedCases(now),
    hearings: seedHearings(now),
    tasks: seedTasks(now),
    notes: structuredCloneSafe(caseNotes),
    timeline: structuredCloneSafe(timelineEvents),
    documents: structuredCloneSafe(documents),
    payments: structuredCloneSafe(payments),
    receipts: [],
    drafts: [],
    docLinks: [],
    briefs: [],
    conversations: [],
    audit: [],
    prefs: { ...DEFAULT_PREFS },
    tenantId: TENANT_ID,
    approvals: [],
    policy: { clerkRequiresLawyerApproval: true },
    batches: seedBatches(now),
    archiveItems: [],
    jobs: [],
  };
}

/** Upgrades data saved by earlier versions without losing the user's records. */
function migrate(raw: DemoDatabase): DemoDatabase | null {
  if (raw.version === DB_VERSION) return raw;
  if (raw.version === 2) {
    return {
      ...raw,
      version: DB_VERSION,
      tenantId: TENANT_ID,
      approvals: [],
      policy: { clerkRequiresLawyerApproval: true },
      batches: seedBatches(),
      archiveItems: [],
      jobs: [],
      audit: sealLegacy(raw.audit ?? []),
    };
  }
  return null;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function purgeExpiredConversations(db: DemoDatabase, now = Date.now()): DemoDatabase {
  const days = db.prefs.retentionDays;
  if (!days) return db;
  const cutoff = now - days * 86_400_000;
  return { ...db, conversations: db.conversations.filter((c) => new Date(c.updatedAt).getTime() >= cutoff) };
}

function readSessionConversations(): Conversation[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_CONVERSATIONS_KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

function load(): DemoDatabase {
  try {
    const raw = window.localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = migrate(JSON.parse(raw) as DemoDatabase);
      if (parsed) {
        const withPrefs = { ...parsed, prefs: { ...DEFAULT_PREFS, ...parsed.prefs } };
        if (withPrefs.prefs.retentionDays === 0) withPrefs.conversations = readSessionConversations();
        return purgeExpiredConversations(withPrefs);
      }
    }
  } catch {
    // Corrupted or unavailable storage: fall back to a fresh in-memory seed.
  }
  return createSeed();
}

let state: DemoDatabase = load();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getDB(): DemoDatabase {
  return state;
}

export function subscribeDB(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Persists then verifies. Conversations follow the retention preference:
 * with retention "0" they live in sessionStorage only and vanish with the tab.
 */
function persist(next: DemoDatabase) {
  const keepConversations = next.prefs.retentionDays !== 0;
  const serialisable = keepConversations ? next : { ...next, conversations: [] };
  const json = JSON.stringify(serialisable);
  window.localStorage.setItem(DB_KEY, json);
  if (window.localStorage.getItem(DB_KEY) !== json) {
    throw new Error("verification-failed");
  }
  if (!keepConversations) {
    window.sessionStorage.setItem(SESSION_CONVERSATIONS_KEY, JSON.stringify(next.conversations));
  } else {
    window.sessionStorage.removeItem(SESSION_CONVERSATIONS_KEY);
  }
}

export type CommitResult = { ok: true } | { ok: false; error: string };

export function commit(mutator: (db: DemoDatabase) => DemoDatabase): CommitResult {
  const next = mutator(state);
  try {
    persist(next);
  } catch {
    return { ok: false, error: "تعذّر حفظ البيانات في هذا المتصفح (قد تكون مساحة التخزين ممتلئة أو التخزين معطّلاً). لم يتم حفظ أي تغيير." };
  }
  state = next;
  emit();
  return { ok: true };
}

/** Test & settings helper: restores the original demo data. */
export function resetDB(now: Date = new Date()) {
  state = createSeed(now);
  try {
    window.localStorage.removeItem(DB_KEY);
    window.sessionStorage.removeItem(SESSION_CONVERSATIONS_KEY);
  } catch {
    // ignore
  }
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === DB_KEY) {
      state = load();
      emit();
    }
  });
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
