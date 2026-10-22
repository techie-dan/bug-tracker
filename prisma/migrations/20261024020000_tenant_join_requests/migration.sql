CREATE TYPE "TenantJoinRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "Tenant" ADD COLUMN "description" VARCHAR(500),
ADD COLUMN "discoverable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TenantJoinRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "TenantJoinRequestStatus" NOT NULL DEFAULT 'pending',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  CONSTRAINT "TenantJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantJoinRequest_tenantId_userId_key" ON "TenantJoinRequest"("tenantId", "userId");
CREATE INDEX "TenantJoinRequest_tenantId_status_requestedAt_idx" ON "TenantJoinRequest"("tenantId", "status", "requestedAt");
CREATE INDEX "TenantJoinRequest_userId_requestedAt_idx" ON "TenantJoinRequest"("userId", "requestedAt");

ALTER TABLE "TenantJoinRequest" ADD CONSTRAINT "TenantJoinRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantJoinRequest" ADD CONSTRAINT "TenantJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantJoinRequest" ADD CONSTRAINT "TenantJoinRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
