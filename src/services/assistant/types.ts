import type { Brief, Citation, ReminderChannels, TaskPriority, TaskRecurrence } from "@/types";
import type { StatusTone } from "@/lib/status";

export const READ_INTENTS = [
  "search_case",
  "search_archive",
  "summarize_case",
  "prepare_hearing",
  "list_upcoming_hearings",
  "check_hearing_conflicts",
  "query_unpaid_fees",
  "compare_cases",
  "archive_status",
] as const;

export const WRITE_INTENTS = [
  "create_hearing",
  "update_hearing",
  "create_reminder",
  "create_task",
  "draft_payment_reminder",
  "draft_receipt",
] as const;

export type ReadIntent = (typeof READ_INTENTS)[number];
export type WriteIntent = (typeof WRITE_INTENTS)[number];
export type Intent = ReadIntent | WriteIntent | "help" | "unknown";

export function isWriteIntent(intent: Intent): intent is WriteIntent {
  return (WRITE_INTENTS as readonly string[]).includes(intent);
}

export interface AssistantListItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  href?: string;
  badge?: { label: string; tone: StatusTone };
}

export interface ComparisonRow {
  aspect: string;
  current: string;
  previous: string;
  citation?: Citation;
}

export type AssistantBlock =
  | { type: "text"; text: string }
  /** Material retrieved from documents the user may access. */
  | { type: "sources"; title: string; citations: Citation[] }
  /** AI-generated content: always shown as a suggestion that needs lawyer review. */
  | { type: "suggestions"; title: string; items: string[] }
  | { type: "notice"; tone: "info" | "warning" | "danger"; text: string }
  | { type: "list"; title?: string; items: AssistantListItem[]; empty?: string }
  | { type: "comparison"; title: string; currentLabel: string; previousLabel: string; rows: ComparisonRow[] }
  | { type: "brief"; brief: Brief }
  | { type: "action" };

export interface ActionFields {
  caseId?: string;
  hearingId?: string;
  date?: string;
  time?: string;
  court?: string;
  room?: string;
  hearingType?: string;
  title?: string;
  assigneeId?: string;
  priority?: TaskPriority;
  channels?: ReminderChannels;
  recurrence?: TaskRecurrence;
  paymentId?: string;
  amount?: number;
  text?: string;
  receiptNumber?: string;
  offsetDays?: number;
}

export type ActionStatus = "draft" | "executing" | "awaiting_approval" | "done" | "cancelled" | "failed";

export interface PendingAction {
  id: string;
  intent: WriteIntent;
  status: ActionStatus;
  fields: ActionFields;
  /** Human-readable notes about values the engine inferred (month, year, default time…). */
  inferences: string[];
  /** Clarifications the engine could not resolve on its own. */
  ambiguities: string[];
  /** Set when the action was rejected before preview (authorization, unknown case…). */
  blockedReason?: string;
  acknowledgedConflicts?: boolean;
  /** Approval request created when the user confirmed this preview. */
  approvalId?: string;
  result?: { entityId: string; href: string; summary: string };
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  text?: string;
  blocks?: AssistantBlock[];
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
  /** True when produced by the local demo engine rather than a configured model. */
  simulated?: boolean;
  action?: PendingAction;
  via?: "text" | "voice";
}

export interface ConversationMemory {
  lastCaseId?: string;
  lastHearingId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  caseId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  memory: ConversationMemory;
}
