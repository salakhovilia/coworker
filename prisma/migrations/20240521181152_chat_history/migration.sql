-- CreateTable
CREATE TABLE "CompanyChatHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sender" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    CONSTRAINT "CompanyChatHistory_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CompanySource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyChatHistory_sourceId_key" ON "CompanyChatHistory"("sourceId");
