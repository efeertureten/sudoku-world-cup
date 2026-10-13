import type { LeagueSlug } from '@swcup/shared';
import { useT } from '../lib/i18n';

const LEAGUE_COLORS: Record<LeagueSlug, string> = {
  bronze: '#b87333',
  silver: '#8d99a6',
  gold: '#d4a72c',
  platinum: '#3f9c9c',
  diamond: '#4f6fe0',
  champions: '#7a3fd1',
};

export function LeagueBadge({ league, compact = false }: { league: LeagueSlug; compact?: boolean }) {
  const t = useT();
  const color = LEAGUE_COLORS[league];
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-sm" style={{ color }}>
      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
        <path d="M7 0.5 L13.5 3 V8 C13.5 11.5 10.5 14 7 15.5 C3.5 14 0.5 11.5 0.5 8 V3 Z" fill={color} />
        <path
          d="M7 4 L8.2 6.6 L11 6.9 L8.9 8.8 L9.5 11.5 L7 10.1 L4.5 11.5 L5.1 8.8 L3 6.9 L5.8 6.6 Z"
          fill="#fff"
        />
      </svg>
      {!compact && t(`league.${league}`)}
    </span>
  );
}

export function BotBadge({ onDark = false }: { onDark?: boolean }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center rounded-[4px] px-1.5 py-px font-semibold text-[11px] ${
        onDark ? 'bg-white/18 text-white' : 'bg-ink-soft/10 text-ink-soft'
      }`}
      title={t('match.bot')}
    >
      {t('match.bot')}
    </span>
  );
}

export function TrophyIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M5 2h10v2h3v2.5A3.5 3.5 0 0 1 14.6 10 5 5 0 0 1 11 12.9V15h3v3H6v-3h3v-2.1A5 5 0 0 1 5.4 10 3.5 3.5 0 0 1 2 6.5V4h3Zm-1 4v.5A1.5 1.5 0 0 0 5 8V6Zm11 0v2a1.5 1.5 0 0 0 1-1.5V6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CoinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="#f6c915" stroke="#c99f00" strokeWidth="1.5" />
      <path
        d="M10 5.5v9M7.5 8h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"
        stroke="#8a6d00"
        strokeWidth="1.4"
        fill="none"
      />
    </svg>
  );
}

/** The referee's cards: one slot per allowed mistake, the last one is red. */
export function MistakeCards({
  mistakes,
  max = 3,
  small = false,
}: {
  mistakes: number;
  max?: number;
  small?: boolean;
}) {
  const t = useT();
  return (
    <span className="inline-flex items-end gap-1" role="img" aria-label={t('match.cards', { n: mistakes })}>
      {Array.from({ length: max }, (_, i) => {
        const used = i < mistakes;
        const red = i === max - 1;
        return (
          <span
            key={i}
            className={`block rounded-[2px] transition-all duration-300 ${small ? 'h-3.5 w-2.5' : 'h-5 w-3.5'} ${
              used
                ? red
                  ? 'rotate-6 bg-card-red shadow-[0_1px_0_rgba(0,0,0,0.25)]'
                  : '-rotate-6 bg-card-yellow shadow-[0_1px_0_rgba(0,0,0,0.25)]'
                : 'border border-white/35 border-dashed'
            }`}
          />
        );
      })}
    </span>
  );
}
