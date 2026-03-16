-- AlterTable
ALTER TABLE "ChatSettings" ADD COLUMN "billingPlan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "ChatSettings" ADD COLUMN "billingSubscriptionId" TEXT;
ALTER TABLE "ChatSettings" ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "ChatSettings" ADD COLUMN "billingPeriodStart" TIMESTAMP(3);
ALTER TABLE "ChatSettings" ADD COLUMN "monthlyAiConvoCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatSettings" ADD COLUMN "monthlyConvoResetAt" TIMESTAMP(3);
