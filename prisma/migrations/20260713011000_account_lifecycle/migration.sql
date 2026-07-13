-- AlterTable
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "disabledReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;
-- SQLite only accepts a constant default when ALTER TABLE adds a column.
-- Prisma's @updatedAt writes the real timestamp on subsequent updates.
ALTER TABLE "User" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");
