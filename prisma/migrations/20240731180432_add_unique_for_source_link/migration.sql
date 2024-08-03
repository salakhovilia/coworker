/*
  Warnings:

  - A unique constraint covering the columns `[companyId,link]` on the table `CompanySource` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "CompanySource_companyId_link_key" ON "CompanySource"("companyId", "link");
