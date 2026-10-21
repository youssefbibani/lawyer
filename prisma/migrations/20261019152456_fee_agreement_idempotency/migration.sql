-- AlterTable
ALTER TABLE "fee_agreements" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "fee_agreements_organizationId_idempotencyKey_key" ON "fee_agreements"("organizationId", "idempotencyKey");


-- Same key format as payments; NULL means "no key supplied".
ALTER TABLE "fee_agreements" ADD CONSTRAINT "fee_agreements_idempotency_key_check" CHECK ("idempotencyKey" IS NULL OR length("idempotencyKey") BETWEEN 8 AND 200);
