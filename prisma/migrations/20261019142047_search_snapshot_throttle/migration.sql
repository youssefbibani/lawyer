/*
  Warnings:

  - Added the required column `snapshot` to the `receipts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "caseId" TEXT,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "snapshot" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "login_throttles" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstFailureAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_caseId_createdAt_idx" ON "audit_logs"("organizationId", "caseId", "createdAt");

-- Trigram indexes for substring search on normalised text (pg_trgm ships with PostgreSQL contrib).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "clients_searchText_trgm_idx" ON "clients" USING gin ("searchText" gin_trgm_ops);
CREATE INDEX "cases_searchText_trgm_idx" ON "cases" USING gin ("searchText" gin_trgm_ops);
