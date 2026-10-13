import type { PublicPlayer } from '@swcup/shared';
import { motion } from 'motion/react';
import { BotBadge, MistakeCards } from '../../components/Badges';
import { Flag } from '../../components/Flag';
import { Jersey } from '../../components/Jersey';
import { formatClock } from '../../lib/format';
import { useT } from '../../lib/i18n';

interface Side {
  player: PublicPlayer;
  filled: number;
  mistakes: number;
  connected?: boolean;
}

/**
 * The broadcast score bug: both players' progress pulls toward the clock in
 * the middle, and mistakes show up as referee cards.
 */
export function ScoreBug({
  you,
  opponent,
  total,
  elapsedMs,
  remainingMs,
  label,
}: {
  you: Side;
  opponent: Side;
  total: number;
  elapsedMs: number | null;
  remainingMs: number | null;
  label: string;
}) {
  const t = useT();
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  const urgent = remainingMs !== null && remainingMs < 60_000;

  const side = (s: Side, align: 'left' | 'right') => (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${align === 'right' ? 'items-end' : ''}`}>
      <div className={`flex min-w-0 items-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-chalk sm:grid">
          <Jersey slug={s.player.avatar} size={30} />
        </span>
        <Flag code={s.player.countryCode} />
        <span className={`truncate font-semibold ${s.connected === false ? 'opacity-50' : ''}`}>
          {s.player.username}
        </span>
        {s.player.isBot && <BotBadge onDark />}
      </div>
      {/* On phones the bar gets its own full-width line; from `sm` up it sits beside the count. */}
      <div
        className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex-nowrap ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        <div className="order-last h-2 basis-full overflow-hidden rounded-full bg-white/15 sm:order-none sm:h-2.5 sm:flex-1 sm:basis-auto">
          <motion.div
            className={`h-full rounded-full ${align === 'left' ? 'bg-card-yellow' : 'ml-auto bg-chalk'}`}
            initial={{ width: '0%' }}
            animate={{ width: `${pct(s.filled)}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>
        <span className="font-display font-bold text-lg leading-none tabular">
          {t('match.progress', { filled: s.filled, total })}
        </span>
        <MistakeCards mistakes={s.mistakes} small />
      </div>
    </div>
  );

  return (
    <div className="flex items-stretch overflow-hidden rounded-xl bg-ink text-white shadow-[0_6px_0_-2px_rgba(16,33,58,0.25)]">
      <div className="flex min-w-0 flex-1 items-center px-3 py-2.5 sm:px-4">{side(you, 'left')}</div>
      <div
        className={`flex w-24 shrink-0 flex-col items-center justify-center px-2 sm:w-32 ${urgent ? 'bg-card-red text-white' : 'bg-chalk text-ink'}`}
      >
        <span className="font-display font-extrabold text-3xl leading-none tabular sm:text-4xl">
          {elapsedMs === null ? '--:--' : formatClock(elapsedMs)}
        </span>
        <span className="mt-1 text-center font-semibold text-[11px] leading-tight opacity-75">
          {urgent && remainingMs !== null ? t('match.remaining', { time: formatClock(remainingMs) }) : label}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center px-3 py-2.5 sm:px-4">{side(opponent, 'right')}</div>
    </div>
  );
}
