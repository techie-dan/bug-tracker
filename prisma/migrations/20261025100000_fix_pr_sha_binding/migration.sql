-- #489: bind an accepted fix to the exact pull request and head commit that
-- were reviewed, so a different PR — or new commits on the accepted one —
-- cannot merge after the fact.

-- AlterTable
ALTER TABLE "Bug" ADD COLUMN "pullRequestHeadSha" TEXT;

-- AlterTable
ALTER TABLE "TestVerdict" ADD COLUMN "headSha" TEXT;
