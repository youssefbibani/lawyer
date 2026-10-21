export type CaseStatus = "نشطة" | "مؤجلة" | "منتهية";

export type CaseType =
  | "نزاع ميراث"
  | "قضية مدنية"
  | "طعن تعقيبي"
  | "قضية تجارية"
  | "قضية عقارية";

export type HearingUrgency = "urgent" | "week" | "later";

export type PaymentStatus = "مسدّد" | "جزئي" | "غير مدفوع";

export type SearchRelevance = "قوي" | "متوسط" | "جزئي";

export type Role = "lawyer" | "associate" | "secretary" | "accountant" | "admin";

export interface TeamMember {
  id: string;
  name: string;
  shortName: string;
  role: Role;
  initials: string;
}

export interface LegalCase {
  id: string;
  ref: string;
  client: string;
  type: CaseType;
  status: CaseStatus;
  court: string;
  openingDate: string;
  nextHearing?: string;
  documents: number;
  description: string;
  assignedLawyer: string;
  feesAgreed: number;
  feesPaid: number;
  /** Team members allowed to access this case (per-case access control). */
  team: string[];
}

export interface Hearing {
  id: string;
  caseRef: string;
  client: string;
  court: string;
  room: string;
  type: string;
  date: string;
  time: string;
  /** Kept for backward compatibility; the UI derives urgency from the date. */
  urgency: HearingUrgency;
  caseId?: string;
}

export interface Payment {
  id: string;
  client: string;
  caseRef: string;
  agreed: number;
  paid: number;
  remaining: number;
  status: PaymentStatus;
  lastPaymentDate?: string;
}

export interface DocumentPage {
  number: number;
  text: string;
  lang: "ar" | "fr";
  /** Object URL for captured / uploaded page images (never persisted). */
  imageUrl?: string;
}

export interface ArchiveDocument {
  id: string;
  title: string;
  docType: string;
  caseId?: string;
  caseRef: string;
  client: string;
  date: string;
  size: string;
  source: "case" | "archive" | "upload";
  language: "ar" | "fr" | "mixed";
  /** Seeded demo value only — no real OCR engine runs in this prototype. */
  ocrConfidence?: number;
  pages: DocumentPage[];
  /** Received from an outside party (e.g. opposing counsel): always treated as untrusted. */
  externalOrigin?: boolean;
  keywords?: string[];
  /** Set for documents that went through the verified archive workflow. */
  verified?: { reviewerId: string; approvedBy: string; at: string; batchId: string; itemId: string; sha256?: string };
}

/** Kept for compatibility with earlier UI code. */
export type CaseDocument = ArchiveDocument;

export interface CaseNote {
  id: string;
  caseId: string;
  date: string;
  author: string;
  content: string;
}

export interface TimelineEvent {
  id: string;
  caseId: string;
  date: string;
  title: string;
  description: string;
  icon: "file" | "calendar" | "check" | "message" | "gavel" | "task";
}

export type TaskPriority = "high" | "medium" | "low";
export type TaskRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface ReminderChannels {
  inApp: boolean;
  email: boolean;
  sms: boolean;
}

export interface Task {
  id: string;
  kind: "task" | "reminder";
  title: string;
  description?: string;
  caseId?: string;
  hearingId?: string;
  assigneeId: string;
  dueDate: string;
  dueTime?: string;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string;
  channels: ReminderChannels;
  /** Set when the in-app reminder was actually displayed in this browser. */
  firedAt?: string;
  recurrence: TaskRecurrence;
  createdAt: string;
  createdBy: string;
  source: "manual" | "assistant";
}

export interface Citation {
  /** Overrides the default document-viewer link (e.g. an archive item under review). */
  href?: string;
  documentId: string;
  title: string;
  page?: number;
  caseId?: string;
  excerpt?: string;
  term?: string;
}

export type BriefItemKind = "source" | "generated" | "missing" | "verify" | "lawyer";

export interface BriefItem {
  id: string;
  text: string;
  kind: BriefItemKind;
  citations: Citation[];
  edited?: boolean;
}

export interface BriefSection {
  key: string;
  title: string;
  items: BriefItem[];
}

export interface Brief {
  id: string;
  caseId: string;
  hearingId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  reviewed: boolean;
  reviewedAt?: string;
  sections: BriefSection[];
}

export interface ReceiptRecord {
  id: string;
  receiptNumber: string;
  paymentId: string;
  caseRef: string;
  client: string;
  amount: number;
  date: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
}

export interface Receipt {
  receiptNumber: string;
  date: string;
  amount: number;
  caseRef: string;
  client: string;
  notes?: string;
}

export interface MessageDraft {
  id: string;
  kind: "payment-reminder";
  paymentId: string;
  text: string;
  createdAt: string;
  createdBy: string;
}

export interface DocumentLink {
  id: string;
  documentId: string;
  caseId: string;
  createdAt: string;
  createdBy: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Non-confidential description: references and action names only, never case content. */
  summary: string;
  via: "manual" | "assistant";
  /** Structured, non-confidential details: proposed changes, decision, execution result. */
  details?: { approvalId?: string; changes?: ProposedChange[]; decision?: string; result?: string; paramsHash?: string };
  /** Hash chain: sha256(prevHash + canonical entry). Tampering breaks verification. */
  prevHash?: string;
  hash?: string;
}

export interface NotificationPreference {
  hearingReminders: boolean;
  paymentReminders: boolean;
  newDocuments: boolean;
  scheduleConflicts: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
}

export interface UserSettings {
  fullName: string;
  barNumber: string;
  email: string;
  phone: string;
  officeName: string;
  officeAddress: string;
  fontSize: "small" | "medium" | "large";
  density: "comfortable" | "compact";
  theme: "light" | "dark";
}

export type VoiceProviderId = "none" | "browser" | "server";

export interface AssistantPrefs {
  voiceProvider: VoiceProviderId;
  /** Explicit consent to send audio to the browser vendor's speech service. */
  browserVoiceConsent: boolean;
  speechPlayback: boolean;
  /** 0 = conversations are not kept after the tab closes. */
  retentionDays: 0 | 7 | 30 | 90;
}

// ——— Human-in-the-loop approvals ———

export type OperationType =
  | "hearing.create"
  | "hearing.update"
  | "task.create"
  | "reminder.create"
  | "payment.reminder_draft"
  | "receipt.issue"
  | "document.link"
  | "archive.verify"
  | "archive.finalize";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "stale";

export interface ProposedChange {
  label: string;
  before?: string;
  after: string;
}

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  operation: OperationType;
  params: Record<string, unknown>;
  /** SHA-256 of the canonical params: an approval is valid only for these exact parameters. */
  paramsHash: string;
  title: string;
  caseId?: string;
  details: string;
  changes: ProposedChange[];
  proposedBy: string;
  proposedVia: "assistant" | "manual";
  createdAt: string;
  updatedAt: string;
  /** Roles allowed to decide on this request (computed from the office policy). */
  approverRoles: Role[];
  /** Fingerprints of the records the operation depends on, taken when proposed/revised. */
  bindings: { key: string; fingerprint: string }[];
  status: ApprovalStatus;
  revision: number;
  decision?: { kind: "approved" | "rejected"; by: string; at: string; note?: string; paramsHash: string };
  execution?: { at: string; ok: boolean; summary?: string; href?: string; entityIds?: string[]; error?: string };
  source?: { kind: "assistant"; conversationId?: string } | { kind: "archive"; batchId: string; itemIds: string[] };
}

export interface OfficePolicy {
  /** Clerks may prepare proposals but a lawyer must approve them. */
  clerkRequiresLawyerApproval: boolean;
}

// ——— Smart archive workflow ———

export type ArchiveItemState =
  | "draft"
  | "uploading"
  | "ocr"
  | "review"
  | "needs_correction"
  | "pending_approval"
  | "ready"
  | "archived"
  | "failed";

export type ArchiveCategory =
  | "judgment"
  | "petition"
  | "minutes"
  | "contract"
  | "correspondence"
  | "power_of_attorney"
  | "financial"
  | "other";

export interface ArchiveBatch {
  id: string;
  tenantId: string;
  reference: string;
  name: string;
  location: string;
  responsibleId: string;
  notes?: string;
  expectedCount?: number;
  defaultCaseId?: string;
  status: "draft" | "in_progress" | "completed";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface PageQuality {
  analyzed: boolean;
  blank?: boolean;
  blurry?: boolean;
  lowContrast?: boolean;
  sharpness?: number;
  inkRatio?: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
}

export interface PageOcr {
  engine: string;
  text: string;
  confidence: number;
  lang: "ar" | "fr" | "mixed" | "unknown";
  /** Words below the confidence threshold, for highlighting. */
  uncertain: string[];
  at: string;
}

export interface ArchivePage {
  id: string;
  index: number;
  /** Blob-store key of the immutable original raster for this page. */
  originalKey: string;
  thumbKey?: string;
  rotation: 0 | 90 | 180 | 270;
  width?: number;
  height?: number;
  quality: PageQuality;
  /** Original OCR output — never edited. */
  ocr?: PageOcr;
  /** Human corrections are kept separately from the OCR output. */
  correctedText?: string;
  /** Previous originals of this page (replacements never delete scans). */
  replacedKeys?: string[];
}

export type FieldSource = "ocr" | "rule" | "human" | "assistant";

export interface ExtractedField {
  key: "caseRef" | "date" | "court" | "parties" | "client" | "title";
  label: string;
  value: string;
  confidence: number;
  source: FieldSource;
  evidence?: string;
  page?: number;
}

export interface DuplicateMatch {
  targetType: "item" | "document";
  targetId: string;
  targetLabel: string;
  kind: "exact" | "probable";
  score: number;
  evidence: string[];
  decision?: "not_duplicate" | "duplicate";
}

export interface CaseSuggestion {
  caseId: string;
  score: number;
  evidence: string[];
}

export interface ArchiveItemEvent {
  at: string;
  by: string;
  action: string;
  from?: ArchiveItemState;
  to?: ArchiveItemState;
  note?: string;
  changes?: ProposedChange[];
}

export interface ArchiveItem {
  id: string;
  tenantId: string;
  batchId: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256?: string;
  /** Blob-store key of the untouched uploaded file (PDF or image). */
  originalFileKey?: string;
  pages: ArchivePage[];
  state: ArchiveItemState;
  /** Optimistic-concurrency version, incremented on every change. */
  version: number;
  progress?: { stage: string; done: number; total: number };
  error?: string;
  missingPages?: number[];
  fields: ExtractedField[];
  classification?: { suggested: ArchiveCategory; confidence: number; evidence: string[]; final?: ArchiveCategory; overriddenBy?: string };
  duplicates: DuplicateMatch[];
  excluded?: { reason: string; by: string; at: string };
  caseMatch: {
    suggestions: CaseSuggestion[];
    decision: "pending" | "approved" | "rejected" | "deferred";
    caseId?: string;
    decidedBy?: string;
  };
  review?: { reviewerId: string; at: string; returnReason?: string };
  approvalId?: string;
  archivedDocumentId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  history: ArchiveItemEvent[];
}

export interface ProcessingJob {
  id: string;
  itemId: string;
  stage: "prepare" | "ocr";
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  owner?: string;
  heartbeat?: string;
  error?: string;
  updatedAt: string;
}
