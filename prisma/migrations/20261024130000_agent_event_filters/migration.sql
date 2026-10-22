-- #602: agents filter GET /api/v1/events by project and issue. The feed is
-- ordered by (txid, id) (#739), so each filter gets an index with that suffix.

ALTER TABLE "AgentEvent" ADD COLUMN "projectId" TEXT;

-- Backfill from the event's issue.
UPDATE "AgentEvent" e
SET "projectId" = b."projectId"
FROM "Bug" b
WHERE e."bugId" = b."id" AND e."projectId" IS NULL;

-- New events take the project of their issue, so every publish() caller is
-- covered without passing projectId itself.
CREATE OR REPLACE FUNCTION "AgentEvent_set_projectId"() RETURNS trigger AS $$
BEGIN
  IF NEW."projectId" IS NULL AND NEW."bugId" IS NOT NULL THEN
    SELECT "projectId" INTO NEW."projectId" FROM "Bug" WHERE "id" = NEW."bugId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentEvent_set_projectId"
BEFORE INSERT ON "AgentEvent"
FOR EACH ROW EXECUTE FUNCTION "AgentEvent_set_projectId"();

CREATE INDEX "AgentEvent_tenantId_projectId_txid_id_idx" ON "AgentEvent"("tenantId", "projectId", "txid", "id");
CREATE INDEX "AgentEvent_tenantId_bugId_txid_id_idx" ON "AgentEvent"("tenantId", "bugId", "txid", "id");

ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
