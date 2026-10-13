import type {
  ApiErrorBody,
  CosmeticListing,
  CountryStanding,
  GuestRequest,
  LoginRequest,
  MatchDetail,
  MatchHistoryEntry,
  MeProfile,
  MetaPayload,
  PlayerProfile,
  PlayerStanding,
  RegisterRequest,
  TournamentState,
  TournamentSummary,
} from '@swcup/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'internal', err?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  meta: () => request<MetaPayload>('GET', '/meta'),
  me: () => request<MeProfile>('GET', '/auth/me'),
  guest: (input: GuestRequest) => request<MeProfile>('POST', '/auth/guest', input),
  login: (input: LoginRequest) => request<MeProfile>('POST', '/auth/login', input),
  register: (input: RegisterRequest) => request<MeProfile>('POST', '/auth/register', input),
  logout: () => request<void>('POST', '/auth/logout'),
  updateMe: (input: { countryCode?: string }) => request<MeProfile>('PATCH', '/users/me', input),
  profile: (username: string) => request<PlayerProfile>('GET', `/users/${encodeURIComponent(username)}`),
  history: (username: string, before?: string) =>
    request<MatchHistoryEntry[]>(
      'GET',
      `/users/${encodeURIComponent(username)}/matches${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    ),
  match: (id: string) => request<MatchDetail>('GET', `/matches/${id}`),
  countries: (metric: 'total' | 'top50') =>
    request<CountryStanding[]>('GET', `/leaderboards/countries?metric=${metric}`),
  players: (country?: string) =>
    request<PlayerStanding[]>(
      'GET',
      `/leaderboards/players?limit=100${country ? `&country=${country}` : ''}`,
    ),
  tournaments: () =>
    request<{ current: TournamentState | null; recent: TournamentSummary[] }>('GET', '/tournaments'),
  tournament: (id: string) => request<TournamentState>('GET', `/tournaments/${id}`),
  cosmetics: () => request<CosmeticListing[]>('GET', '/cosmetics'),
  purchase: (slug: string) => request<MeProfile>('POST', `/cosmetics/${slug}/purchase`),
  equip: (slug: string) => request<MeProfile>('POST', `/cosmetics/${slug}/equip`),
};
