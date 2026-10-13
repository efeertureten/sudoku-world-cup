import type { MatchDetail } from '@swcup/shared';

export type Move = MatchDetail['participants'][number]['moves'][number];

/** How long a wrong digit stays visible on the replay board. */
export const WRONG_FLASH_MS = 900;

export interface ReplayFrame {
  values: number[];
  filled: number;
  mistakes: number;
  /** Cell of the latest correct digit, highlighted on the board. */
  last: number | null;
  /** A wrong digit placed within the last WRONG_FLASH_MS. */
  wrong: Move | null;
}

/** Rebuilds one player's board at replay time `at` (ms since kick-off) from the public move log. */
export function boardAt(givens: string, moves: readonly Move[], at: number): ReplayFrame {
  const values = [...givens].map(Number);
  let filled = 0;
  let mistakes = 0;
  let last: number | null = null;
  let wrong: Move | null = null;
  for (const m of moves) {
    if (m.t > at) break;
    if (m.ok) {
      values[m.cell] = m.value;
      filled++;
      last = m.cell;
    } else {
      mistakes++;
      if (at - m.t < WRONG_FLASH_MS) wrong = m;
    }
  }
  return { values, filled, mistakes, last, wrong };
}
