/**
 * API contract shared by the server (server/) and the web client (src/backend/).
 * Types only plus constant value lists — no runtime dependencies, so both builds can import it.
 *
 * Conventions:
 *  - Money is a decimal STRING with 3 decimals ("1500.000"), never a float.
 *  - Calendar dates are "YYYY-MM-DD"; wall-clock times are "HH:mm" in the office time zone.
 *  - Instants are ISO-8601 UTC strings.
 */

export const ROLES = ["admin", "lawyer", "clerk"] as const;
export type Role = (typeof ROLES)[number];

export const CLIENT_TYPES = ["INDIVIDUAL", "COMPANY", "HEIRS", "ADMINISTRATION", "OTHER"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CASE_TYPES = [
  "INHERITANCE",
  "CIVIL",
  "CASSATION",
  "COMMERCIAL",
  "REAL_ESTATE",
  "CRIMINAL",
  "ADMINISTRATIVE",
  "LABOR",
  "FAMILY",
  "OTHER",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = ["ACTIVE", "POSTPONED", "CLOSED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CLIENT_ROLES = ["PRINCIPAL", "CO_CLIENT", "REPRESENTATIVE"] as const;
export type CaseClientRole = (typeof CASE_CLIENT_ROLES)[number];

export const HEARING_STATUSES = ["SCHEDULED", "HELD", "POSTPONED", "CANCELLED"] as const;
export type HearingStatus = (typeof HEARING_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "CHECK", "BANK_TRANSFER", "CARD", "MOBILE", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentStatus = "RECORDED" | "VOIDED";
export type ReceiptStatus = "ISSUED" | "CANCELLED";
export type FeeAgreementStatus = "ACTIVE" | "SETTLED" | "CANCELLED";
/** Derived from amounts: fully paid, partially paid, nothing paid yet. */
export type SettlementStatus = "PAID" | "PARTIAL" | "UNPAID";

export const TASK_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = "OPEN" | "DONE" | "CANCELLED";
export type TaskKind = "TASK" | "REMINDER";
export const TASK_RECURRENCES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];
export type TaskBucket = "today" | "upcoming" | "overdue" | "done";

export type ReminderChannel = "IN_APP" | "EMAIL";
export type ReminderStatus = "PENDING" | "SENT" | "FAILED" | "CANCELLED" | "NOT_CONFIGURED";

export const PERMISSIONS = [
  "client:read",
  "client:write",
  "case:read",
  "case:create",
  "case:update",
  "case:status",
  "case:assign",
  "note:write",
  "hearing:write",
  "hearing:cancel",
  "finance:read",
  "finance:write",
  "payment:record",
  "payment:void",
  "task:write",
  "settings:office",
  "members:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// ——— Errors ———

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NO_ACTIVE_OFFICE"
  | "CSRF_REJECTED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "HEARING_CONFLICT"
  | "TASK_CONFLICT"
  | "OVERPAYMENT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IMMUTABLE_RECORD"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Arabic, safe to show to the user. */
    message: string;
    details?: { path: string; message: string }[];
    /** Extra machine-readable data (e.g. the conflicting hearings). */
    data?: unknown;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ——— Identity ———

export interface PersonRef {
  userId: string;
  name: string;
}

export interface MeDTO {
  user: { id: string; name: string; email: string; twoFactorEnabled: boolean };
  office: { id: string; name: string; timeZone: string; defaultCurrency: string };
  role: Role;
  permissions: Permission[];
  offices: { id: string; name: string; role: Role }[];
  mail: { configured: boolean };
}

export interface SessionDTO {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface MemberDTO {
  userId: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  barNumber: string | null;
  active: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}

// ——— Clients ———

export interface ClientDTO {
  id: string;
  type: ClientType;
  fullName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  nationalId: string | null;
  notes: string | null;
  archivedAt: string | null;
  version: number;
  caseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDetailDTO extends ClientDTO {
  cases: CaseSummaryDTO[];
}

// ——— Cases ———

export interface CaseClientDTO {
  id: string;
  fullName: string;
  role: CaseClientRole;
}

export interface NextHearingDTO {
  id: string;
  startsAt: string;
  date: string;
  time: string;
}

export interface CaseSummaryDTO {
  id: string;
  reference: string;
  type: CaseType;
  status: CaseStatus;
  court: string;
  chamber: string | null;
  openedOn: string;
  closedOn: string | null;
  assignedLawyer: PersonRef;
  clients: CaseClientDTO[];
  nextHearing: NextHearingDTO | null;
  version: number;
  updatedAt: string;
}

export interface CaseDetailDTO extends CaseSummaryDTO {
  description: string | null;
  members: (PersonRef & { role: Role })[];
  createdAt: string;
  /** What the current user may do on this case (computed on the server). */
  can: { update: boolean; changeStatus: boolean; assign: boolean; addNote: boolean; scheduleHearing: boolean; finance: boolean };
}

export interface CaseNoteDTO {
  id: string;
  content: string;
  author: PersonRef;
  createdAt: string;
}

export interface TimelineEntryDTO {
  id: string;
  at: string;
  operation: string;
  resourceType: string;
  summary: string;
  actor: PersonRef | null;
}

// ——— Hearings ———

export interface HearingDTO {
  id: string;
  caseId: string;
  caseReference: string;
  clientName: string;
  assignedLawyer: PersonRef;
  startsAt: string;
  date: string;
  time: string;
  timeZone: string;
  durationMinutes: number;
  court: string;
  chamber: string | null;
  room: string | null;
  type: string;
  status: HearingStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HearingConflictsDTO {
  /** Overlapping hearings of the same lawyer on cases the user may see. */
  hearings: HearingDTO[];
  /** Overlapping hearings on cases the user may NOT see (details withheld). */
  hiddenCount: number;
}

export interface HearingEventDTO {
  id: string;
  kind: "CREATED" | "UPDATED" | "RESCHEDULED" | "STATUS_CHANGED" | "CANCELLED";
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: PersonRef;
  createdAt: string;
}

// ——— Finance ———

export interface FeeAgreementDTO {
  id: string;
  caseId: string;
  caseReference: string;
  client: { id: string; fullName: string } | null;
  title: string | null;
  amount: string;
  currency: string;
  paymentTerms: string | null;
  status: FeeAgreementStatus;
  paid: string;
  remaining: string;
  settlement: SettlementStatus;
  lastPaymentOn: string | null;
  paymentCount: number;
  version: number;
  createdAt: string;
}

export interface PdfStatusDTO {
  available: boolean;
  sha256: string | null;
  generatedAt: string | null;
  /** Set when generation failed; the receipt itself is still validly issued. */
  error: string | null;
}

export interface ReceiptDTO {
  id: string;
  number: string;
  paymentId: string;
  caseId: string;
  caseReference: string;
  clientName: string | null;
  amount: string;
  currency: string;
  issuedOn: string;
  status: ReceiptStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  pdf: PdfStatusDTO;
  createdAt: string;
}

export interface PaymentDTO {
  id: string;
  agreementId: string;
  caseId: string;
  caseReference: string;
  amount: string;
  currency: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentStatus;
  recordedBy: PersonRef;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  receipt: ReceiptDTO | null;
}

export interface FeeAgreementDetailDTO extends FeeAgreementDTO {
  payments: PaymentDTO[];
}

export interface RecordPaymentResultDTO {
  payment: PaymentDTO;
  agreement: FeeAgreementDTO;
  /** True when this response replays an earlier identical request (same Idempotency-Key). */
  replayed: boolean;
}

export interface FinanceTotalsDTO {
  currency: string;
  agreed: string;
  paid: string;
  remaining: string;
  agreementCount: number;
  unsettledCount: number;
}

// ——— Tasks & reminders ———

export interface ReminderDTO {
  id: string;
  channel: ReminderChannel;
  status: ReminderStatus;
  scheduledAt: string;
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  taskId: string | null;
  hearingId: string | null;
  title: string;
  recipient: PersonRef;
}

export interface TaskDTO {
  id: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  case: { id: string; reference: string; clientName: string } | null;
  hearingId: string | null;
  assignee: PersonRef;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  recurrence: TaskRecurrence;
  notifyInApp: boolean;
  notifyEmail: boolean;
  completedAt: string | null;
  createdBy: PersonRef;
  createdAt: string;
  version: number;
  reminders: ReminderDTO[];
}

export interface TaskConflictsDTO {
  tasks: TaskDTO[];
  hearings: HearingDTO[];
}

export interface CompleteTaskResultDTO {
  task: TaskDTO;
  next: TaskDTO | null;
}

// ——— Dashboard ———

export interface DashboardDTO {
  today: string;
  activeCases: number;
  hearingsNext7Days: HearingDTO[];
  todayTasks: TaskDTO[];
  overdueTaskCount: number;
  conflictGroups: HearingDTO[][];
  caseTypeDistribution: { type: CaseType; count: number }[];
  recentCases: CaseSummaryDTO[];
  /** Null when the user has no finance permission. */
  outstanding: { currency: string; amount: string }[] | null;
}

// ——— Settings ———

export interface OfficeSettingsDTO {
  legalName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  taxId: string | null;
  barRegistration: string | null;
  timeZone: string;
  defaultCurrency: string;
  lawyersSeeAllCases: boolean;
  clerksSeeAllCases: boolean;
  clerksCanRecordPayments: boolean;
}

export interface NotificationPreferenceDTO {
  hearingReminders: boolean;
  taskReminders: boolean;
  scheduleConflicts: boolean;
  emailEnabled: boolean;
  defaultReminderMinutes: number;
}

export interface ProfileDTO {
  name: string;
  email: string;
  phone: string | null;
  barNumber: string | null;
}

export interface SettingsDTO {
  office: OfficeSettingsDTO;
  preferences: NotificationPreferenceDTO;
  profile: ProfileDTO;
}

export interface AuditEntryDTO {
  id: string;
  at: string;
  actor: PersonRef | null;
  resourceType: string;
  resourceId: string | null;
  operation: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  summary: string | null;
  requestId: string | null;
}
