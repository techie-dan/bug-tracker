export type VoteChange = {
  nextVote: 1 | -1 | 0;
  countDelta: number;
};

/** Validates vote direction: only 1 (like) and -1 (dislike) are supported; out-of-range or malformed values are rejected. */
export function isValidVoteDirection(direction: unknown): direction is 1 | -1 {
  return direction === 1 || direction === -1;
}

/**
 * Pure helper for calculating score changes and next vote state
 * when upvoting (direction = 1) or downvoting (direction = -1).
 */
export function calculateVoteChange(
  currentVote: number | null | undefined,
  direction: 1 | -1,
): VoteChange {
  const current = currentVote === 1 ? 1 : currentVote === -1 ? -1 : 0;

  if (current === direction) {
    // Toggle off existing vote
    return {
      nextVote: 0,
      countDelta: -direction,
    };
  }

  if (current === 0) {
    // Fresh vote from neutral
    return {
      nextVote: direction,
      countDelta: direction,
    };
  }

  // Switching vote (+1 to -1 or -1 to +1)
  return {
    nextVote: direction,
    countDelta: direction * 2,
  };
}

/**
 * The authoritative Bug.voteCount: the number of upvotes (#1059). It used to
 * be SUM(Vote.value), so every old dislike took one away.
 */
export function reconcileVoteCount(
  likeCount: number,
  // #1059: downvotes are gone. Old dislike rows are kept but no longer count
  // against an issue, so the stored count is its upvotes.
  _dislikeCount: number,
): number {
  void _dislikeCount;
  return likeCount;
}

/** #1059: what a downvote attempt is told. */
export const DOWNVOTES_REMOVED_MESSAGE =
  "Downvotes were removed. Upvote issues that matter, or say what's wrong in the conversation.";

