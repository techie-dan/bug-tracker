-- #606: pause a claim's clock while its agent waits for the owner's answer.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "ownerWaitCapMinutes" INTEGER NOT NULL DEFAULT 240;

-- AlterTable
ALTER TABLE "IssueClaim" ADD COLUMN "waitingOnOwnerSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentQuestion" ADD COLUMN "remindedAt" TIMESTAMP(3);
