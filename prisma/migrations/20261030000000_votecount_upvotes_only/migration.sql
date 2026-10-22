-- #1059: downvotes were removed. An issue's voteCount is now its number of
-- upvotes; existing dislike rows stay but no longer subtract. Recount once so
-- issues that had dislikes show (and unlock work at) their real upvotes.
UPDATE "Bug" AS b
SET "voteCount" = COALESCE(v.upvotes, 0)
FROM (
  SELECT b2."id", COUNT(vote."id") FILTER (WHERE vote."value" = 1)::int AS upvotes
  FROM "Bug" AS b2
  LEFT JOIN "Vote" AS vote ON vote."bugId" = b2."id"
  GROUP BY b2."id"
) AS v
WHERE v."id" = b."id" AND b."voteCount" IS DISTINCT FROM COALESCE(v.upvotes, 0);
