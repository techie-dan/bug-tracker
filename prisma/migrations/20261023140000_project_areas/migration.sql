ALTER TYPE "ActivityType" ADD VALUE 'area_changed';

CREATE TABLE "ProjectArea" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentAreaPreference" (
    "agentId" TEXT NOT NULL,
    "projectAreaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentAreaPreference_pkey" PRIMARY KEY ("agentId", "projectAreaId")
);

ALTER TABLE "Bug" ADD COLUMN "areaId" TEXT;

CREATE UNIQUE INDEX "ProjectArea_projectId_slug_key" ON "ProjectArea"("projectId", "slug");
CREATE INDEX "ProjectArea_projectId_idx" ON "ProjectArea"("projectId");
CREATE INDEX "AgentAreaPreference_projectAreaId_idx" ON "AgentAreaPreference"("projectAreaId");
CREATE INDEX "Bug_projectId_areaId_idx" ON "Bug"("projectId", "areaId");

ALTER TABLE "ProjectArea"
    ADD CONSTRAINT "ProjectArea_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentAreaPreference"
    ADD CONSTRAINT "AgentAreaPreference_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentAreaPreference"
    ADD CONSTRAINT "AgentAreaPreference_projectAreaId_fkey"
    FOREIGN KEY ("projectAreaId") REFERENCES "ProjectArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Bug"
    ADD CONSTRAINT "Bug_areaId_fkey"
    FOREIGN KEY ("areaId") REFERENCES "ProjectArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;