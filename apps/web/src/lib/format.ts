import type { MatchEndReason } from '@swcup/shared';
import type { Locale, MessageKey } from './i18n';

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const tenths = Math.floor(ms / 100) % 10;
  return `${formatClock(ms)}.${tenths}`;
}

const nameCache = new Map<Locale, Intl.DisplayNames>();

/** Localized country name from an ISO code; no translation tables needed. */
export function countryName(code: string, locale: Locale): string {
  let names = nameCache.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: 'region' });
    nameCache.set(locale, names);
  }
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** i18n key explaining how a match ended, from the player's point of view. */
export function reasonKey(reason: MatchEndReason, result: 'win' | 'loss' | 'draw'): MessageKey {
  // Only a time-out can end level; any other draw is reported as the loss-side wording.
  const side = result === 'draw' ? (reason === 'timeout' ? 'draw' : 'loss') : result;
  return `result.reason.${reason}.${side}` as MessageKey;
}
