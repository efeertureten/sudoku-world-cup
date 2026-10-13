import type { MatchDetail } from '@swcup/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { matches, matchParticipants, puzzles, users } from '../../db/schema';
import { AppError } from '../../lib/errors';

/**
 * Finished matches are public, including the solution and generator seed:
 * anyone can regenerate the puzzle with the open-source engine and replay
 * both players' moves to verify the result.
 */
export async function getMatchDetail(db: Db, matchId: string): Promise<MatchDetail> {
  const [row] = await db
    .select({ match: matches, puzzle: puzzles })
    .from(matches)
    .innerJoin(puzzles, eq(puzzles.id, matches.puzzleId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Match not found');
  const participants = await db
    .select({ p: matchParticipants, user: users })
    .from(matchParticipants)
    .innerJoin(users, eq(users.id, matchParticipants.userId))
    .where(eq(matchParticipants.matchId, matchId));
  return {
    matchId,
    type: row.match.type,
    difficulty: row.match.difficulty,
    reason: row.match.endReason,
    winnerId: row.match.winnerId,
    startedAt: row.match.startedAt.toISOString(),
    endedAt: row.match.endedAt.toISOString(),
    givens: row.puzzle.givens,
    solution: row.puzzle.solution,
    puzzleId: row.puzzle.id,
    generatorSeed: row.puzzle.generatorSeed,
    generatorVersion: row.puzzle.generatorVersion,
    participants: participants.map(({ p, user }) => ({
      userId: user.id,
      username: user.username,
      countryCode: p.countryCode,
      avatar: user.avatar,
      isBot: user.isBot,
      result: p.result,
      finishTimeMs: p.finishTimeMs,
      mistakes: p.mistakes,
      filled: p.cellsFilled,
      trophiesDelta: p.trophiesDelta,
      trophiesAfter: p.trophiesAfter,
      countryPoints: p.countryPoints,
      coins: p.coinsEarned,
      unlocks: [],
      moves: p.moves,
    })),
  };
}
