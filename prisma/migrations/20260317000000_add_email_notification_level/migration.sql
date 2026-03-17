-- CreateEnum
CREATE TYPE "EmailNotificationLevel" AS ENUM ('NONE', 'MENTIONS', 'ALL');

-- AlterTable: add new column with default ALL
ALTER TABLE "User" ADD COLUMN "emailNotificationLevel" "EmailNotificationLevel" NOT NULL DEFAULT 'ALL';

-- Migrate existing data: users with emailNotifications=false get NONE, true get ALL (already defaulted)
UPDATE "User" SET "emailNotificationLevel" = 'NONE' WHERE "emailNotifications" = false;

-- Drop old column
ALTER TABLE "User" DROP COLUMN "emailNotifications";
