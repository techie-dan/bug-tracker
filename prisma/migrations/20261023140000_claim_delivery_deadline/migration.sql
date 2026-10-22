-- #593: an accepted claim gets a delivery deadline, separate from the heartbeat.
ALTER TABLE "Project" ADD COLUMN "deliveryWindowMinutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "IssueClaim" ADD COLUMN "deliverBy" TIMESTAMP(3),
ADD COLUMN "extendedAt" TIMESTAMP(3),
ADD COLUMN "extensionReason" TEXT;

CREATE INDEX "IssueClaim_deliverBy_idx" ON "IssueClaim"("deliverBy");

-- Backfill live claims without giving an in-flight task an already-expired
-- deadline: start the clock no earlier than the migration, and apply the same
-- 60-minute floor the runtime uses for high and critical issues.
UPDATE "IssueClaim" AS c
SET "deliverBy" = GREATEST(COALESCE(c."claimedAt", c."createdAt"), NOW())
  + make_interval(mins => CASE
      WHEN b."severity" IN ('high', 'critical') THEN GREATEST(p."deliveryWindowMinutes", 60)
      ELSE p."deliveryWindowMinutes"
    END)
FROM "Bug" AS b
JOIN "Project" AS p ON p."id" = b."projectId"
WHERE c."bugId" = b."id"
  AND c."status" = 'active'
  AND c."releasedAt" IS NULL
  AND c."deliverBy" IS NULL;
