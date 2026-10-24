-- Add confirmed field to Bug model (#528)
ALTER TABLE "Bug" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
