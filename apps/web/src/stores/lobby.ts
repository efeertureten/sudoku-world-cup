import type { Difficulty, QueueMode, QueueStatusPayload, TournamentState } from '@swcup/shared';
import { create } from 'zustand';
import { call } from '../lib/socket';

interface QueueState {
  mode: QueueMode | null;
  difficulty: Difficulty | null;
  queuedAt: number | null;
  status: QueueStatusPayload | null;
  error: string | null;
  join(mode: QueueMode, difficulty?: Difficulty): Promise<void>;
  leave(): Promise<void>;
  onStatus(p: QueueStatusPayload): void;
  clear(): void;
}

export const useQueue = create<QueueState>((set) => ({
  mode: null,
  difficulty: null,
  queuedAt: null,
  status: null,
  error: null,
  async join(mode, difficulty) {
    set({ error: null });
    try {
      const { queuedAt } = await call('queue:join', difficulty ? { mode, difficulty } : { mode });
      set({ mode, difficulty: difficulty ?? null, queuedAt, status: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
  async leave() {
    set({ mode: null, queuedAt: null, status: null });
    await call('queue:leave', {}).catch(() => undefined);
  },
  onStatus(status) {
    set({ status });
  },
  clear() {
    set({ mode: null, queuedAt: null, status: null });
  },
}));

interface TournamentStore {
  state: TournamentState | null;
  error: string | null;
  set(state: TournamentState): void;
  join(): Promise<TournamentState | null>;
  leave(): Promise<void>;
  watch(id: string): Promise<void>;
}

export const useTournament = create<TournamentStore>((set) => ({
  state: null,
  error: null,
  set(state) {
    set({ state });
  },
  async join() {
    set({ error: null });
    try {
      const state = await call('tournament:join', {});
      set({ state });
      return state;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },
  async leave() {
    await call('tournament:leave', {}).catch((err) => set({ error: (err as Error).message }));
    set({ state: null });
  },
  async watch(id) {
    try {
      set({ state: await call('tournament:watch', { tournamentId: id }) });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

let toastId = 0;
export const useToasts = create<{ toasts: Toast[]; push(text: string, tone?: Toast['tone']): void }>(
  (set, get) => ({
    toasts: [],
    push(text, tone = 'info') {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, text, tone }] });
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4_500);
    },
  }),
);
