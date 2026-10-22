-- #595: workflow numbers become per-project settings. The defaults reproduce
-- today's constants. Existing delivery windows are carried over so no project
-- gets a shorter or longer deadline after the migration.
CREATE TABLE "ProjectWorkflow" (
    "projectId" TEXT NOT NULL,
    "confirmationsNeeded" INTEGER NOT NULL DEFAULT 2,
    "verdictsNeeded" INTEGER NOT NULL DEFAULT 2,
    "offerWindowSeconds" INTEGER NOT NULL DEFAULT 60,
    "heartbeatMinutes" INTEGER NOT NULL DEFAULT 15,
    "deliveryMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxActiveClaims" INTEGER NOT NULL DEFAULT 2,
    "volunteerWindowSeconds" INTEGER NOT NULL DEFAULT 120,
    "autoMerge" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflow_pkey" PRIMARY KEY ("projectId"),
    CONSTRAINT "ProjectWorkflow_confirmationsNeeded_check" CHECK ("confirmationsNeeded" BETWEEN 1 AND 5),
    CONSTRAINT "ProjectWorkflow_verdictsNeeded_check" CHECK ("verdictsNeeded" BETWEEN 1 AND 5),
    CONSTRAINT "ProjectWorkflow_offerWindowSeconds_check" CHECK ("offerWindowSeconds" BETWEEN 30 AND 600),
    CONSTRAINT "ProjectWorkflow_heartbeatMinutes_check" CHECK ("heartbeatMinutes" BETWEEN 1 AND 1440),
    CONSTRAINT "ProjectWorkflow_deliveryMinutes_check" CHECK ("deliveryMinutes" > 0),
    CONSTRAINT "ProjectWorkflow_maxActiveClaims_check" CHECK ("maxActiveClaims" BETWEEN 1 AND 20),
    CONSTRAINT "ProjectWorkflow_volunteerWindowSeconds_check" CHECK ("volunteerWindowSeconds" BETWEEN 30 AND 3600)
);

ALTER TABLE "ProjectWorkflow" ADD CONSTRAINT "ProjectWorkflow_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProjectWorkflow" (
    "projectId", "confirmationsNeeded", "verdictsNeeded", "offerWindowSeconds",
    "heartbeatMinutes", "deliveryMinutes", "maxActiveClaims", "volunteerWindowSeconds",
    "autoMerge", "createdAt", "updatedAt"
)
SELECT
    p."id", 2, 2, 60, 15,
    CASE WHEN p."deliveryWindowMinutes" > 0 THEN p."deliveryWindowMinutes" ELSE 15 END,
    2, 120, true, NOW(), NOW()
FROM "Project" AS p;
