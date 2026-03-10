-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH');

-- CreateTable
CREATE TABLE "PhaseDependency" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhaseDependency_predecessorId_successorId_key" ON "PhaseDependency"("predecessorId", "successorId");

-- AddForeignKey
ALTER TABLE "PhaseDependency" ADD CONSTRAINT "PhaseDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseDependency" ADD CONSTRAINT "PhaseDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "Phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
