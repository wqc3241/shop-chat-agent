-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT,
    "orderNumbers" TEXT,
    "customerEmail" TEXT,
    "pageUrl" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'ai',
    "assignedTo" TEXT,
    "handoffAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Conversation" ("createdAt", "customerEmail", "id", "orderNumbers", "pageUrl", "shop", "updatedAt") SELECT "createdAt", "customerEmail", "id", "orderNumbers", "pageUrl", "shop", "updatedAt" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_shop_idx" ON "Conversation"("shop");
CREATE INDEX "Conversation_shop_mode_idx" ON "Conversation"("shop", "mode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
