-- AlterTable: add Telegram EOD fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "endOfDayPrompt" BOOLEAN NOT NULL DEFAULT false;
