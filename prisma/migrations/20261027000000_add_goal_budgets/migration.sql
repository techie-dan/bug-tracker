-- #616: Goal budgets — the Goal entity and pool-splitting allocations.
-- Additive only: CREATE / ALTER ... ADD, never a DROP. Generated with
-- `prisma migrate dev --create-only` and sanitized to this ticket's tables so
-- unrelated pre-existing schema drift stays out of the diff.

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "GoalSplitMethod" AS ENUM ('manual', 'proportional', 'milestone', 'even');

-- CreateEnum
CREATE TYPE "GoalAllocationTarget" AS ENUM ('issue', 'goal', 'agent');

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "budgetPool" INTEGER NOT NULL,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalAllocation" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "method" "GoalSplitMethod" NOT NULL,
    "targetType" "GoalAllocationTarget" NOT NULL,
    "targetBugId" TEXT,
    "targetGoalId" TEXT,
    "targetAgentId" TEXT,
    "label" TEXT,
    "amount" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_tenantId_createdAt_idx" ON "Goal"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Goal_projectId_idx" ON "Goal"("projectId");

-- CreateIndex
CREATE INDEX "Goal_tenantId_projectId_idx" ON "Goal"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalAllocation_sourceKey_key" ON "GoalAllocation"("sourceKey");

-- CreateIndex
CREATE INDEX "GoalAllocation_goalId_createdAt_idx" ON "GoalAllocation"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalAllocation_targetBugId_idx" ON "GoalAllocation"("targetBugId");

-- CreateIndex
CREATE INDEX "GoalAllocation_targetGoalId_idx" ON "GoalAllocation"("targetGoalId");

-- CreateIndex
CREATE INDEX "GoalAllocation_targetAgentId_idx" ON "GoalAllocation"("targetAgentId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalAllocation" ADD CONSTRAINT "GoalAllocation_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalAllocation" ADD CONSTRAINT "GoalAllocation_targetBugId_fkey" FOREIGN KEY ("targetBugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalAllocation" ADD CONSTRAINT "GoalAllocation_targetGoalId_fkey" FOREIGN KEY ("targetGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalAllocation" ADD CONSTRAINT "GoalAllocation_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
