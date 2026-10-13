import { findCosmetic, type MatchEndPayload } from '@swcup/shared';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CoinIcon, TrophyIcon } from '../../components/Badges';
import { formatDuration, reasonKey, signed } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';

function CountUp({ to, duration = 900 }: { to: number; duration?: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, duration]);
  return <>{value}</>;
}

/**
 * The one orchestrated moment of the app: the full-time banner drops in,
 * then the rewards count up.
 */
export function ResultPanel({
  result,
  meId,
  onAgain,
  onLobby,
}: {
  result: MatchEndPayload;
  meId: string;
  onAgain(): void;
  onLobby(): void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const mine = result.results.find((r) => r.userId === meId);
  const theirs = result.results.find((r) => r.userId !== meId);
  if (!mine || !theirs) return null;
  const outcome = mine.result;
  const champion = result.tournament?.champion;
  const headline = champion ? t('result.champion') : t(`result.${outcome}`);
  const tone = outcome === 'win' ? 'bg-turf' : outcome === 'loss' ? 'bg-card-red' : 'bg-slate';
  const unlockNames = mine.unlocks.map((slug) => findCosmetic(slug)?.name[locale] ?? slug).join(', ');

  return (
    <motion.div
      className="absolute inset-0 z-20 flex items-center justify-center bg-ink/55 p-3 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.section
        initial={{ y: -40, scale: 0.94, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20, delay: 0.1 }}
        className="w-full max-w-md overflow-hidden rounded-xl bg-chalk shadow-2xl"
        aria-live="assertive"
      >
        <header className={`${tone} px-6 pt-6 pb-5 text-white`}>
          <motion.h2
            className="text-6xl"
            initial={{ letterSpacing: '0.2em', opacity: 0 }}
            animate={{ letterSpacing: '0.01em', opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            {headline}
          </motion.h2>
          <p className="mt-2 text-white/90">{t(reasonKey(result.reason, outcome))}</p>
          {result.tournament && !champion && (
            <p className="mt-1 font-semibold text-sm text-white/90">
              {result.tournament.eliminated ? t('result.eliminated') : t('result.nextRound')}
            </p>
          )}
        </header>

        <dl className="grid grid-cols-3 gap-px bg-rule">
          {[
            {
              label: t('result.time'),
              mine: formatDuration(mine.finishTimeMs),
              theirs: formatDuration(theirs.finishTimeMs),
            },
            { label: t('result.mistakes'), mine: String(mine.mistakes), theirs: String(theirs.mistakes) },
            {
              label: t('result.solved'),
              mine: `${mine.filled}/${result.totalEmpty}`,
              theirs: `${theirs.filled}/${result.totalEmpty}`,
            },
          ].map((row) => (
            <div key={row.label} className="bg-paper px-3 py-3">
              <dt className="font-semibold text-slate text-xs">{row.label}</dt>
              <dd className="font-display font-bold text-2xl tabular">{row.mine}</dd>
              <dd className="text-slate text-xs tabular">
                {theirs.username}: {row.theirs}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
          {result.type === 'ranked' && (
            <span className="flex items-center gap-1.5">
              <TrophyIcon className="h-5 w-5 text-card-yellow-deep" />
              <span
                className={`font-display font-extrabold text-3xl tabular ${mine.trophiesDelta >= 0 ? 'text-turf' : 'text-card-red'}`}
              >
                {mine.trophiesDelta >= 0 ? '+' : '−'}
                <CountUp to={Math.abs(mine.trophiesDelta)} />
              </span>
              <span className="text-slate text-sm">{t('result.trophies')}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CoinIcon className="h-5 w-5" />
            <span className="font-display font-extrabold text-3xl tabular">
              +<CountUp to={mine.coins} />
            </span>
            <span className="text-slate text-sm">{t('result.coins')}</span>
          </span>
          {mine.countryPoints > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="font-display font-extrabold text-3xl text-turf tabular">
                {signed(mine.countryPoints)}
              </span>
              <span className="text-slate text-sm">{t('result.countryPoints')}</span>
            </span>
          )}
        </div>

        {mine.unlocks.length > 0 && (
          <p className="mx-6 mb-4 rounded-md bg-card-yellow/25 px-3 py-2 font-semibold text-sm">
            {t('result.unlocked', { items: unlockNames })}
          </p>
        )}

        <div className="flex gap-2 px-6 pb-6">
          {!result.tournament && (
            <button
              type="button"
              onClick={onAgain}
              className="flex-1 rounded-lg bg-card-yellow py-3 font-semibold text-ink"
            >
              {t('result.again')}
            </button>
          )}
          <button
            type="button"
            onClick={onLobby}
            className="flex-1 rounded-lg bg-ink py-3 font-semibold text-white"
          >
            {result.tournament ? t('result.bracket') : t('result.lobby')}
          </button>
        </div>
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-6 pb-4 text-[11px] text-slate tabular">
          <span>{t('result.verify', { id: result.puzzleId, seed: result.generatorSeed })}</span>
          <Link to={`/m/${result.matchId}`} className="font-semibold text-sm text-turf hover:underline">
            {t('result.watch')} →
          </Link>
        </p>
      </motion.section>
    </motion.div>
  );
}
