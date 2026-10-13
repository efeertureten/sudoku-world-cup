import type { MeProfile, MetaPayload } from '@swcup/shared';
import { create } from 'zustand';
import { ApiError, api } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

interface SessionState {
  status: 'loading' | 'anonymous' | 'ready' | 'error';
  me: MeProfile | null;
  meta: MetaPayload | null;
  connected: boolean;
  bootstrap(): Promise<void>;
  setMe(me: MeProfile): void;
  refreshMe(): Promise<void>;
  setConnected(connected: boolean): void;
  logout(): Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  me: null,
  meta: null,
  connected: false,

  async bootstrap() {
    try {
      const meta = get().meta ?? (await api.meta());
      set({ meta });
      try {
        const me = await api.me();
        set({ me, status: 'ready' });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) set({ status: 'anonymous', me: null });
        else throw err;
      }
    } catch {
      set({ status: 'error' });
    }
  },

  setMe(me) {
    set({ me, status: 'ready' });
  },

  async refreshMe() {
    try {
      set({ me: await api.me() });
    } catch {
      /* keep the last known profile */
    }
  },

  setConnected(connected) {
    set({ connected });
  },

  async logout() {
    await api.logout().catch(() => undefined);
    disconnectSocket();
    set({ me: null, status: 'anonymous', connected: false });
  },
}));
