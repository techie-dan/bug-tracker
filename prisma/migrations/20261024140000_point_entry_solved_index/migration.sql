-- Index to accelerate points leaderboard solved tasks count and group by queries (#657)
CREATE INDEX "PointEntry_tenantId_role_correctedAt_idx" ON "PointEntry"("tenantId", "role", "correctedAt");
