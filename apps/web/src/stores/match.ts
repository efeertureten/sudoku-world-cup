import { PEERS } from '@swcup/engine/codec';
import { candidateMask } from '@swcup/engine/rules';
import type {
  Difficulty,
  EmoteId,
  MatchCountdownPayload,
  MatchEndPayload,
  MatchFoundPayload,
  MatchResumePayload,
  MatchStartPayload,
  MatchType,
  OpponentConnectionPayload,
  OpponentProgressPayload,
  PublicPlayer,
  TournamentRef,
} from '@swcup/shared';
import { create } from 'zustand';
import { call } from '../lib/socket';

export type MatchPhase = 'idle' | 'found' | 'countdown' | 'playing' | 'ended';

interface OpponentView {
  filled: number;
  mistakes: number;
  connected: boolean;
  graceEndsAt: number | null;
  solved: number[];
  lockedUntil: number;
}

interface IncomingEmote {
  id: number;
  emoteId: EmoteId;
  mine: boolean;
}

interface MatchState {
  phase: MatchPhase;
  matchId: string | null;
  type: MatchType | null;
  difficulty: Difficulty | null;
  you: PublicPlayer | null;
  opponent: PublicPlayer | null;
  tournament: TournamentRef | null;
  readyDeadline: number | null;
  startsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  givens: string | null;
  /** Givens plus every digit the server confirmed for me. */
  board: number[];
  /** Pencil marks as 9-bit masks; they never leave the browser. */
  notes: number[];
  pending: Record<number, number>;
  lastWrong: { cell: number; value: number; at: number } | null;
  lastCorrect: { cell: number; at: number } | null;
  mistakes: number;
  lockedUntil: number;
  filled: number;
  totalEmpty: number;
  seq: number;
  selected: number | null;
  notesMode: boolean;
  opponentState: OpponentView;
  emotes: IncomingEmote[];
  result: MatchEndPayload | null;

  onFound(p: MatchFoundPayload): void;
  onCountdown(p: MatchCountdownPayload): void;
  onStart(p: MatchStartPayload): void;
  onResume(p: MatchResumePayload): void;
  onOpponentProgress(p: OpponentProgressPayload): void;
  onOpponentConnection(p: OpponentConnectionPayload): void;
  onEmote(emoteId: EmoteId, mine: boolean): void;
  onEnd(p: MatchEndPayload): void;
  select(cell: number | null): void;
  toggleNotesMode(): void;
  input(value: number, asNote?: boolean): void;
  clearNotes(): void;
  reset(): void;
}

const emptyOpponent = (): OpponentView => ({
  filled: 0,
  mistakes: 0,
  connected: true,
  graceEndsAt: null,
  solved: [],
  lockedUntil: 0,
});

const initial = {
  phase: 'idle' as MatchPhase,
  matchId: null,
  type: null,
  difficulty: null,
  you: null,
  opponent: null,
  tournament: null,
  readyDeadline: null,
  startsAt: null,
  startedAt: null,
  endsAt: null,
  givens: null,
  board: Array<number>(81).fill(0),
  notes: Array<number>(81).fill(0),
  pending: {},
  lastWrong: null,
  lastCorrect: null,
  mistakes: 0,
  lockedUntil: 0,
  filled: 0,
  totalEmpty: 0,
  seq: 0,
  selected: null,
  notesMode: false,
  opponentState: emptyOpponent(),
  emotes: [],
  result: null,
};

const toDigits = (s: string) => [...s].map(Number);
let emoteCounter = 0;

export const useMatch = create<MatchState>((set, get) => ({
  ...initial,

  onFound(p) {
    set({
      ...initial,
      board: Array(81).fill(0),
      notes: Array(81).fill(0),
      opponentState: emptyOpponent(),
      phase: 'found',
      matchId: p.matchId,
      type: p.type,
      difficulty: p.difficulty,
      you: p.you,
      opponent: p.opponent,
      tournament: p.tournament ?? null,
      readyDeadline: p.readyDeadline,
    });
    void call('match:ready', { matchId: p.matchId }).catch(() => undefined);
  },

  onCountdown(p) {
    if (p.matchId !== get().matchId) return;
    set({ phase: 'countdown', startsAt: p.startsAt });
  },

  onStart(p) {
    if (p.matchId !== get().matchId) return;
    set({
      phase: 'playing',
      givens: p.givens,
      board: toDigits(p.givens),
      startedAt: p.startedAt,
      endsAt: p.endsAt,
      totalEmpty: p.totalEmpty,
      selected: p.givens.indexOf('0'),
    });
  },

  onResume(p) {
    const same = get().matchId === p.matchId;
    const phase: MatchPhase =
      p.status === 'in_progress' ? 'playing' : p.status === 'countdown' ? 'countdown' : 'found';
    set({
      ...(same ? {} : { ...initial, notes: Array(81).fill(0), emotes: [] }),
      phase,
      matchId: p.matchId,
      type: p.type,
      difficulty: p.difficulty,
      you: p.you,
      opponent: p.opponent,
      tournament: p.tournament ?? null,
      readyDeadline: p.readyDeadline ?? null,
      startsAt: p.startsAt ?? null,
      startedAt: p.startedAt ?? null,
      endsAt: p.endsAt ?? null,
      givens: p.givens ?? null,
      board: p.board ? toDigits(p.board) : Array(81).fill(0),
      pending: {},
      mistakes: p.mistakes,
      lockedUntil: p.lockedUntil,
      filled: p.filled,
      totalEmpty: p.totalEmpty,
      seq: Math.max(get().seq, p.lastSeq),
      result: null,
      opponentState: {
        ...(same ? get().opponentState : emptyOpponent()),
        filled: p.opponentProgress.filled,
        mistakes: p.opponentProgress.mistakes,
        connected: p.opponentProgress.connected,
      },
    });
    if (p.status === 'ready_check') void call('match:ready', { matchId: p.matchId }).catch(() => undefined);
  },

  onOpponentProgress(p) {
    if (p.matchId !== get().matchId) return;
    const prev = get().opponentState;
    set({
      opponentState: {
        ...prev,
        filled: p.filled,
        mistakes: p.mistakes,
        solved: p.cell !== undefined ? [...prev.solved, p.cell] : prev.solved,
        lockedUntil: p.lockedUntil ?? prev.lockedUntil,
      },
    });
  },

  onOpponentConnection(p) {
    if (p.matchId !== get().matchId) return;
    set({
      opponentState: { ...get().opponentState, connected: p.connected, graceEndsAt: p.graceEndsAt ?? null },
    });
  },

  onEmote(emoteId, mine) {
    const id = ++emoteCounter;
    set({ emotes: [...get().emotes.slice(-3), { id, emoteId, mine }] });
    setTimeout(() => set({ emotes: get().emotes.filter((e) => e.id !== id) }), 3_500);
  },

  onEnd(p) {
    if (p.matchId !== get().matchId) return;
    set({ phase: 'ended', result: p, selected: null, pending: {} });
  },

  select(cell) {
    set({ selected: cell });
  },

  toggleNotesMode() {
    set({ notesMode: !get().notesMode });
  },

  clearNotes() {
    const { selected, notes } = get();
    if (selected === null) return;
    const next = [...notes];
    next[selected] = 0;
    set({ notes: next });
  },

  input(value, asNote) {
    const s = get();
    const cell = s.selected;
    if (s.phase !== 'playing' || cell === null || !s.matchId) return;
    if (s.board[cell] !== 0 || s.pending[cell] !== undefined) return;

    if (asNote ?? s.notesMode) {
      const notes = [...s.notes];
      notes[cell]! ^= 1 << (value - 1);
      set({ notes });
      return;
    }
    if (Date.now() < s.lockedUntil) return;

    const seq = s.seq + 1;
    set({ seq, pending: { ...s.pending, [cell]: value } });
    const matchId = s.matchId;
    call('match:move', { matchId, seq, cell, value })
      .then((ack) => {
        const now = get();
        if (now.matchId !== matchId) return;
        const pending = { ...now.pending };
        delete pending[cell];
        if (ack.verdict === 'correct') {
          const board = [...now.board];
          board[cell] = value;
          // Housekeeping only: drop this digit from pencil marks in the same row, column and box.
          const notes = [...now.notes];
          notes[cell] = 0;
          for (const p of PEERS[cell]!) notes[p]! &= ~(1 << (value - 1));
          set({ board, notes, pending, filled: ack.filled, lastCorrect: { cell, at: Date.now() } });
        } else if (ack.verdict === 'wrong') {
          set({
            pending,
            mistakes: ack.mistakes,
            lockedUntil: ack.lockedUntil,
            lastWrong: { cell, value, at: Date.now() },
          });
        } else {
          set({ pending, mistakes: ack.mistakes, lockedUntil: ack.lockedUntil });
        }
      })
      .catch(() => {
        const pending = { ...get().pending };
        delete pending[cell];
        set({ pending });
      });
  },

  reset() {
    set({ ...initial, board: Array(81).fill(0), notes: Array(81).fill(0), opponentState: emptyOpponent() });
  },
}));

/** Remaining placements per digit, for the number pad. */
export function remainingByDigit(board: number[]): number[] {
  const counts = Array(10).fill(9);
  for (const v of board) if (v) counts[v]--;
  return counts;
}

/** Digits still consistent with the filled cells; used only to dim impossible notes in the pad. */
export function possibleDigits(board: number[], cell: number): number {
  return candidateMask(board, cell);
}
