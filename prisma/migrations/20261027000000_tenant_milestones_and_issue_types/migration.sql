-- Milestones and IssueTypes belong to one organization. Rows that predate
-- tenant scoping are assigned to Zedu, the organization the tracker ran for.

-- 1. Add tenantId columns (initially nullable for backfill)
ALTER TABLE "IssueType" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Milestone" ADD COLUMN "tenantId" TEXT;

-- 2. Backfill existing rows with Zedu's tenant ID
UPDATE "IssueType" AS it
SET "tenantId" = t.id
FROM "Tenant" AS t
WHERE it."tenantId" IS NULL
  AND t.slug = 'zedu';

UPDATE "Milestone" AS m
SET "tenantId" = t.id
FROM "Tenant" AS t
WHERE m."tenantId" IS NULL
  AND t.slug = 'zedu';

-- 3. Verify backfill succeeded
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "IssueType" WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'IssueType.tenantId backfill failed: the Zedu organization is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM "Milestone" WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Milestone.tenantId backfill failed: the Zedu organization is missing';
  END IF;
END $$;

-- 4. Set NOT NULL
ALTER TABLE "IssueType" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Milestone" ALTER COLUMN "tenantId" SET NOT NULL;

-- 5. Drop old unique indexes
DROP INDEX IF EXISTS "IssueType_name_key";
DROP INDEX IF EXISTS "IssueType_lower_name_key";
DROP INDEX IF EXISTS "Milestone_title_key";

-- 6. Create tenant-scoped unique indexes and tenantId foreign key indexes
CREATE UNIQUE INDEX "IssueType_tenantId_name_key" ON "IssueType"("tenantId", "name");
CREATE UNIQUE INDEX "IssueType_tenantId_lower_name_key" ON "IssueType"("tenantId", LOWER("name"));
CREATE UNIQUE INDEX "IssueType_id_tenantId_key" ON "IssueType"("id", "tenantId");
CREATE INDEX "IssueType_tenantId_idx" ON "IssueType"("tenantId");

CREATE UNIQUE INDEX "Milestone_tenantId_title_key" ON "Milestone"("tenantId", "title");
CREATE UNIQUE INDEX "Milestone_id_tenantId_key" ON "Milestone"("id", "tenantId");
CREATE INDEX "Milestone_tenantId_idx" ON "Milestone"("tenantId");

-- 7. Add foreign key constraints referencing Tenant
ALTER TABLE "IssueType"
  ADD CONSTRAINT "IssueType_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Milestone"
  ADD CONSTRAINT "Milestone_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
