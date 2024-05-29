/*
  Warnings:

  - You are about to drop the `CompanyChat` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CompanyChat";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "CompanySource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    CONSTRAINT "CompanySource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
