-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_organizationId_date_idx" ON "appointments"("organizationId", "date");

-- CreateIndex
CREATE INDEX "appointments_clientId_idx" ON "appointments"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_id_organizationId_key" ON "appointments"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clientId_organizationId_fkey" FOREIGN KEY ("clientId", "organizationId") REFERENCES "clients"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

