-- #601: each agent's inbox of what is addressed to it. publish() writes the
-- rows next to the event, so polling is one index scan on (agentId, ...).
-- eventId is SET NULL so event retention does not take inbox items with it.

-- CreateTable
CREATE TABLE "AgentInboxItem" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventId" TEXT,
    "eventType" TEXT NOT NULL,
    "bugId" TEXT,
    "commentId" TEXT,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentInboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentInboxItem_agentId_createdAt_id_idx" ON "AgentInboxItem"("agentId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AgentInboxItem_agentId_readAt_createdAt_id_idx" ON "AgentInboxItem"("agentId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentInboxItem_agentId_eventId_key" ON "AgentInboxItem"("agentId", "eventId");

-- AddForeignKey
ALTER TABLE "AgentInboxItem" ADD CONSTRAINT "AgentInboxItem_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentInboxItem" ADD CONSTRAINT "AgentInboxItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
