-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'COMPANY', 'HEIRS', 'ADMINISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('INHERITANCE', 'CIVIL', 'CASSATION', 'COMMERCIAL', 'REAL_ESTATE', 'CRIMINAL', 'ADMINISTRATIVE', 'LABOR', 'FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('ACTIVE', 'POSTPONED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseClientRole" AS ENUM ('PRINCIPAL', 'CO_CLIENT', 'REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "HearingStatus" AS ENUM ('SCHEDULED', 'HELD', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HearingEventKind" AS ENUM ('CREATED', 'UPDATED', 'RESCHEDULED', 'STATUS_CHANGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeeAgreementStatus" AS ENUM ('ACTIVE', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHECK', 'BANK_TRANSFER', 'CARD', 'MOBILE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('TASK', 'REMINDER');

-- CreateEnum
CREATE TYPE "TaskRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "twoFactorEnabled" BOOLEAN DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'clerk',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "phone" TEXT,
    "barNumber" TEXT,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factors" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_settings" (
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "taxId" TEXT,
    "barRegistration" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Tunis',
    "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'TND',
    "lawyersSeeAllCases" BOOLEAN NOT NULL DEFAULT true,
    "clerksSeeAllCases" BOOLEAN NOT NULL DEFAULT false,
    "clerksCanRecordPayments" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hearingReminders" BOOLEAN NOT NULL DEFAULT true,
    "taskReminders" BOOLEAN NOT NULL DEFAULT true,
    "scheduleConflicts" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultReminderMinutes" INTEGER NOT NULL DEFAULT 1440,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "nationalId" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "court" TEXT NOT NULL,
    "chamber" TEXT,
    "description" TEXT,
    "openedOn" DATE NOT NULL,
    "closedOn" DATE,
    "assignedLawyerId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_clients" (
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" "CaseClientRole" NOT NULL DEFAULT 'PRINCIPAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_clients_pkey" PRIMARY KEY ("caseId","clientId")
);

-- CreateTable
CREATE TABLE "case_members" (
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_members_pkey" PRIMARY KEY ("caseId","userId")
);

-- CreateTable
CREATE TABLE "case_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Tunis',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "court" TEXT NOT NULL,
    "chamber" TEXT,
    "room" TEXT,
    "type" TEXT NOT NULL,
    "status" "HearingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hearings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearing_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hearingId" TEXT NOT NULL,
    "kind" "HearingEventKind" NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hearing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_agreements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT,
    "title" TEXT,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TND',
    "paymentTerms" TEXT,
    "status" "FeeAgreementStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "referenceKey" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "paymentId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "issuedOn" DATE NOT NULL,
    "issuedById" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "pdf" BYTEA,
    "pdfSha256" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),
    "pdfError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_counters" (
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("organizationId","year")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL DEFAULT 'TASK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "caseId" TEXT,
    "hearingId" TEXT,
    "recurrence" "TaskRecurrence" NOT NULL DEFAULT 'NONE',
    "spawnedFromId" TEXT,
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "assigneeId" TEXT NOT NULL,
    "dueDate" DATE,
    "dueTime" TEXT,
    "dueAt" TIMESTAMPTZ(3),
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT,
    "hearingId" TEXT,
    "recipientId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "operation" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "members_userId_idx" ON "members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "members_organizationId_userId_key" ON "members"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "invitations_organizationId_idx" ON "invitations"("organizationId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");

-- CreateIndex
CREATE INDEX "two_factors_userId_idx" ON "two_factors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE INDEX "clients_organizationId_fullName_idx" ON "clients"("organizationId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "clients_id_organizationId_key" ON "clients"("id", "organizationId");

-- CreateIndex
CREATE INDEX "cases_organizationId_status_idx" ON "cases"("organizationId", "status");

-- CreateIndex
CREATE INDEX "cases_organizationId_assignedLawyerId_idx" ON "cases"("organizationId", "assignedLawyerId");

-- CreateIndex
CREATE UNIQUE INDEX "cases_organizationId_reference_key" ON "cases"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "cases_id_organizationId_key" ON "cases"("id", "organizationId");

-- CreateIndex
CREATE INDEX "case_clients_organizationId_clientId_idx" ON "case_clients"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "case_members_organizationId_userId_idx" ON "case_members"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "case_notes_caseId_createdAt_idx" ON "case_notes"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "hearings_organizationId_startsAt_idx" ON "hearings"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "hearings_caseId_startsAt_idx" ON "hearings"("caseId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "hearings_id_organizationId_key" ON "hearings"("id", "organizationId");

-- CreateIndex
CREATE INDEX "hearing_events_hearingId_createdAt_idx" ON "hearing_events"("hearingId", "createdAt");

-- CreateIndex
CREATE INDEX "fee_agreements_organizationId_caseId_idx" ON "fee_agreements"("organizationId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_agreements_id_organizationId_key" ON "fee_agreements"("id", "organizationId");

-- CreateIndex
CREATE INDEX "payments_agreementId_idx" ON "payments"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organizationId_idempotencyKey_key" ON "payments"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organizationId_agreementId_method_referenceKey_key" ON "payments"("organizationId", "agreementId", "method", "referenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_organizationId_key" ON "payments"("id", "organizationId");

-- CreateIndex
CREATE INDEX "receipts_organizationId_issuedOn_idx" ON "receipts"("organizationId", "issuedOn");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_paymentId_organizationId_key" ON "receipts"("paymentId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_organizationId_number_key" ON "receipts"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_organizationId_year_sequence_key" ON "receipts"("organizationId", "year", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_spawnedFromId_key" ON "tasks"("spawnedFromId");

-- CreateIndex
CREATE INDEX "tasks_organizationId_status_dueDate_idx" ON "tasks"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_organizationId_assigneeId_idx" ON "tasks"("organizationId", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_organizationId_key" ON "tasks"("id", "organizationId");

-- CreateIndex
CREATE INDEX "reminders_status_scheduledAt_idx" ON "reminders"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "reminders_organizationId_recipientId_scheduledAt_idx" ON "reminders"("organizationId", "recipientId", "scheduledAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_resourceType_resourceId_idx" ON "audit_logs"("organizationId", "resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_settings" ADD CONSTRAINT "office_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "members"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_organizationId_assignedLawyerId_fkey" FOREIGN KEY ("organizationId", "assignedLawyerId") REFERENCES "members"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_clients" ADD CONSTRAINT "case_clients_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_clients" ADD CONSTRAINT "case_clients_clientId_organizationId_fkey" FOREIGN KEY ("clientId", "organizationId") REFERENCES "clients"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_members" ADD CONSTRAINT "case_members_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_members" ADD CONSTRAINT "case_members_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "members"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearings" ADD CONSTRAINT "hearings_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearings" ADD CONSTRAINT "hearings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearings" ADD CONSTRAINT "hearings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_events" ADD CONSTRAINT "hearing_events_hearingId_organizationId_fkey" FOREIGN KEY ("hearingId", "organizationId") REFERENCES "hearings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_events" ADD CONSTRAINT "hearing_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_agreements" ADD CONSTRAINT "fee_agreements_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_agreements" ADD CONSTRAINT "fee_agreements_clientId_organizationId_fkey" FOREIGN KEY ("clientId", "organizationId") REFERENCES "clients"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_agreements" ADD CONSTRAINT "fee_agreements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agreementId_organizationId_fkey" FOREIGN KEY ("agreementId", "organizationId") REFERENCES "fee_agreements"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId", "organizationId") REFERENCES "payments"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_clientId_organizationId_fkey" FOREIGN KEY ("clientId", "organizationId") REFERENCES "clients"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "cases"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_hearingId_organizationId_fkey" FOREIGN KEY ("hearingId", "organizationId") REFERENCES "hearings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_assigneeId_fkey" FOREIGN KEY ("organizationId", "assigneeId") REFERENCES "members"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "tasks"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_hearingId_organizationId_fkey" FOREIGN KEY ("hearingId", "organizationId") REFERENCES "hearings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_organizationId_recipientId_fkey" FOREIGN KEY ("organizationId", "recipientId") REFERENCES "members"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Integrity rules Prisma cannot express. These are defence in depth: the API
-- validates the same rules first, so a violation here indicates a bug or a
-- direct database write, and is rejected rather than silently stored.
-- ═══════════════════════════════════════════════════════════════════════════

-- Office roles and settings
ALTER TABLE "members" ADD CONSTRAINT "members_role_check" CHECK ("role" IN ('admin', 'lawyer', 'clerk'));
ALTER TABLE "office_settings" ADD CONSTRAINT "office_settings_currency_check" CHECK ("defaultCurrency" ~ '^[A-Z]{3}$');
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_minutes_check" CHECK ("defaultReminderMinutes" BETWEEN 0 AND 43200);

-- Clients and cases
ALTER TABLE "clients" ADD CONSTRAINT "clients_full_name_check" CHECK (length(btrim("fullName")) > 0);
ALTER TABLE "cases" ADD CONSTRAINT "cases_reference_check" CHECK (length(btrim("reference")) > 0);
ALTER TABLE "cases" ADD CONSTRAINT "cases_dates_check" CHECK ("closedOn" IS NULL OR "closedOn" >= "openedOn");

-- Hearings
ALTER TABLE "hearings" ADD CONSTRAINT "hearings_duration_check" CHECK ("durationMinutes" BETWEEN 5 AND 1440);

-- Money: strictly positive amounts, ISO-4217 style currency codes
ALTER TABLE "fee_agreements" ADD CONSTRAINT "fee_agreements_amount_check" CHECK ("amount" > 0);
ALTER TABLE "fee_agreements" ADD CONSTRAINT "fee_agreements_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_idempotency_key_check" CHECK (length("idempotencyKey") BETWEEN 8 AND 200);
ALTER TABLE "payments" ADD CONSTRAINT "payments_void_check" CHECK (
  ("status" = 'RECORDED' AND "voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
  OR ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND length(btrim("voidReason")) > 0 AND "referenceKey" IS NULL)
);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_check" CHECK ("amount" > 0);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_sequence_check" CHECK ("sequence" > 0 AND "year" BETWEEN 2000 AND 2999);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancel_check" CHECK (
  ("status" = 'ISSUED' AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND length(btrim("cancelReason")) > 0)
);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_pdf_check" CHECK (("pdf" IS NULL) = ("pdfSha256" IS NULL) AND ("pdf" IS NULL) = ("pdfGeneratedAt" IS NULL));
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_value_check" CHECK ("lastValue" >= 0);

-- Tasks: a due time is only meaningful with a date; the exact instant exists only when a time was given
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_check" CHECK (length(btrim("title")) > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_due_time_check" CHECK ("dueTime" IS NULL OR "dueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_due_consistency_check" CHECK (
  ("dueTime" IS NULL OR "dueDate" IS NOT NULL) AND (("dueTime" IS NULL) = ("dueAt" IS NULL))
);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completion_check" CHECK (("status" = 'DONE') = ("completedAt" IS NOT NULL));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancel_check" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- Reminders: exactly one target, bounded retries
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_target_check" CHECK (num_nonnulls("taskId", "hearingId") = 1);
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10 AND "attempts" <= "maxAttempts");

-- ─── Append-only audit log and hearing history ────────────────────────────
CREATE FUNCTION "forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only table)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_change"();
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_change"();
CREATE TRIGGER "hearing_events_append_only" BEFORE UPDATE OR DELETE ON "hearing_events"
  FOR EACH ROW EXECUTE FUNCTION "forbid_change"();

-- ─── Payments: never deleted; the only permitted change is voiding ────────
CREATE FUNCTION "payments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status', 'voidedAt', 'voidedById', 'voidReason', 'referenceKey'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; void them instead' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'a voided payment cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'recorded payment fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'the only permitted change to a payment is voiding it' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_guard" BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_guard"();

-- ─── Receipts: never deleted; amounts/numbers immutable; PDF write-once ───
CREATE FUNCTION "receipts_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status', 'cancelledAt', 'cancelledById', 'cancelReason', 'pdf', 'pdfSha256', 'pdfGeneratedAt', 'pdfError'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipts cannot be deleted; cancel them instead' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'issued receipt fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."pdf" IS NOT NULL AND (NEW."pdf" IS DISTINCT FROM OLD."pdf" OR NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256"
      OR NEW."pdfGeneratedAt" IS DISTINCT FROM OLD."pdfGeneratedAt") THEN
    RAISE EXCEPTION 'the issued receipt PDF is write-once' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'CANCELLED' AND (NEW."status" <> 'CANCELLED' OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
      OR NEW."cancelledById" IS DISTINCT FROM OLD."cancelledById" OR NEW."cancelReason" IS DISTINCT FROM OLD."cancelReason") THEN
    RAISE EXCEPTION 'a cancelled receipt cannot be reinstated or changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "receipts_guard" BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION "receipts_guard"();

-- ─── Receipt counters only move forward (numbers are never reused) ────────
CREATE FUNCTION "receipt_counters_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."lastValue" < OLD."lastValue" THEN
    RAISE EXCEPTION 'receipt counters cannot be decreased or deleted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "receipt_counters_guard" BEFORE UPDATE OR DELETE ON "receipt_counters"
  FOR EACH ROW EXECUTE FUNCTION "receipt_counters_guard"();
