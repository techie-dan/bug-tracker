-- #596: a tenant admin may grant the higher budget for a limited time.
-- Null keeps an enabled grant open-ended. Existing agents keep the standard
-- budget until an admin turns burst on.
ALTER TABLE "Agent" ADD COLUMN "burstUntil" TIMESTAMP(3);
