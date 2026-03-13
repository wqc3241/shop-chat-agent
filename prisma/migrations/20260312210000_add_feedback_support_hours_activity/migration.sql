-- Feature 1: Customer feedback on AI responses
ALTER TABLE "Message" ADD COLUMN "feedback" TEXT;

-- Feature 2: Support hours settings
ALTER TABLE "ChatSettings" ADD COLUMN "supportHoursStart" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChatSettings" ADD COLUMN "supportHoursEnd" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChatSettings" ADD COLUMN "supportTimezone" TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE "ChatSettings" ADD COLUMN "supportDays" TEXT NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri';

-- Feature 3: Customer activity tracking
CREATE TABLE "CustomerActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "currentPageUrl" TEXT NOT NULL DEFAULT '',
    "currentPageTitle" TEXT NOT NULL DEFAULT '',
    "viewingProduct" TEXT NOT NULL DEFAULT '',
    "cartContents" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CustomerActivity_conversationId_key" ON "CustomerActivity"("conversationId");
