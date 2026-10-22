-- #573: tenants and projects can be archived instead of deleted.
ALTER TABLE "Tenant" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);
