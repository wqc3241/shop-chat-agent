-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "customerEmail" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "orderNumbers" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "pageUrl" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "shop" TEXT;

-- CreateTable
CREATE TABLE "ChatSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "welcomeMessage" TEXT NOT NULL DEFAULT '👋 Hi there! How can I help you today?',
    "promptType" TEXT NOT NULL DEFAULT 'standardAssistant',
    "customInstructions" TEXT NOT NULL DEFAULT '',
    "bubbleColor" TEXT NOT NULL DEFAULT '#5046e4',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatSettings_shop_key" ON "ChatSettings"("shop");

-- CreateIndex
CREATE INDEX "Conversation_shop_idx" ON "Conversation"("shop");
