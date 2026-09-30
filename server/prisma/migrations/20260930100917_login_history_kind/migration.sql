-- AlterTable
ALTER TABLE "LoginHistory" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'login';

-- CreateIndex
CREATE INDEX "LoginHistory_emailAttempted_createdAt_idx" ON "LoginHistory"("emailAttempted", "createdAt");
