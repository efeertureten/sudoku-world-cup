import type { CountryStanding, PlayerStanding } from '@swcup/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { LeagueBadge, TrophyIcon } from '../../components/Badges';
import { Flag } from '../../components/Flag';
import { Jersey } from '../../components/Jersey';
import { api } from '../../lib/api';
import { countryName, formatNumber } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { call, getSocket } from '../../lib/socket';
import { useSession } from '../../stores/session';

type Tab = 'countries' | 'players';

export function LeaderboardPage() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const me = useSession((s) => s.me)!;
  const season = useSession((s) => s.meta?.season);
  const [tab, setTab] = useState<Tab>('countries');
  const [metric, setMetric] = useState<'total' | 'top50'>('total');
  const [scope, setScope] = useState<'world' | 'mine'>('world');
  const [countries, setCountries] = useState<CountryStanding[] | null>(null);
  const [players, setPlayers] = useState<PlayerStanding[] | null>(null);

  useEffect(() => {
    if (tab !== 'countries') return;
    setCountries(null);
    api
      .countries(metric)
      .then(setCountries)
      .catch(() => setCountries([]));
  }, [tab, metric]);

  useEffect(() => {
    if (tab !== 'players') return;
    setPlayers(null);
    api
      .players(scope === 'mine' ? me.countryCode : undefined)
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, [tab, scope, me.countryCode]);

  // Live top-10 pushes while the total ranking is on screen.
  useEffect(() => {
    if (tab !== 'countries' || metric !== 'total') return;
    const socket = getSocket();
    const onTick = ({ countries: top }: { countries: CountryStanding[] }) =>
      setCountries((prev) => (prev ? [...top, ...prev.filter((c) => c.rank > top.length)] : top));
    socket.on('leaderboard:tick', onTick);
    void call('leaderboard:watch', { on: true }).catch(() => undefined);
    return () => {
      socket.off('leaderboard:tick', onTick);
      void call('leaderboard:watch', { on: false }).catch(() => undefined);
    };
  }, [tab, metric]);

  const daysLeft = season
    ? Math.max(0, Math.ceil((Date.parse(season.endsAt) - Date.now()) / 86_400_000))
    : null;
  const max = countries?.[0]?.points ?? 1;

  const pill = (active: boolean) =>
    `rounded-md px-3 py-1.5 font-semibold text-sm ${active ? 'bg-ink text-white' : 'text-slate hover:text-ink'}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-5xl">{t('standings.title')}</h1>
        {season && daysLeft !== null && (
          <p className="text-slate text-sm">{t('standings.seasonEnds', { s: season.number, n: daysLeft })}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex rounded-lg bg-paper p-1 ring-1 ring-rule" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'countries'}
            className={pill(tab === 'countries')}
            onClick={() => setTab('countries')}
          >
            {t('standings.countries')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'players'}
            className={pill(tab === 'players')}
            onClick={() => setTab('players')}
          >
            {t('standings.players')}
          </button>
        </div>
        {tab === 'countries' ? (
          <div className="flex rounded-lg bg-paper p-1 ring-1 ring-rule">
            <button type="button" className={pill(metric === 'total')} onClick={() => setMetric('total')}>
              {t('standings.total')}
            </button>
            <button type="button" className={pill(metric === 'top50')} onClick={() => setMetric('top50')}>
              {t('standings.top50')}
            </button>
          </div>
        ) : (
          <div className="flex rounded-lg bg-paper p-1 ring-1 ring-rule">
            <button type="button" className={pill(scope === 'world')} onClick={() => setScope('world')}>
              {t('standings.everyone')}
            </button>
            <button
              type="button"
              className={`${pill(scope === 'mine')} flex items-center gap-1.5`}
              onClick={() => setScope('mine')}
            >
              <Flag code={me.countryCode} size="sm" decorative />
              {t('standings.myCountry')}
            </button>
          </div>
        )}
      </div>

      {tab === 'countries' && (
        <>
          {metric === 'top50' && <p className="max-w-2xl text-slate text-sm">{t('standings.metricHelp')}</p>}
          {countries === null && <p className="text-slate">{t('common.loading')}</p>}
          {countries?.length === 0 && <p className="text-slate">{t('standings.empty')}</p>}
          <ol className="space-y-1.5">
            {countries?.map((c) => {
              const mine = c.countryCode === me.countryCode;
              return (
                <li
                  key={c.countryCode}
                  className={`grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5 ${mine ? 'bg-card-yellow/30' : 'bg-paper'}`}
                >
                  <span
                    className={`font-display font-extrabold text-2xl tabular ${c.rank <= 3 ? 'text-turf' : 'text-slate'}`}
                  >
                    {c.rank}
                  </span>
                  <Flag code={c.countryCode} size="lg" decorative />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{countryName(c.countryCode, locale)}</span>
                    <span
                      className="mt-1 block h-1.5 rounded-full bg-turf/80"
                      style={{ width: `${Math.max(3, (c.points / max) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right">
                    <span className="block font-display font-extrabold text-2xl tabular">
                      {formatNumber(c.points, locale)}
                    </span>
                    <span className="block text-slate text-xs">
                      {t('standings.contributorsCount', { n: c.players })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {tab === 'players' && (
        <>
          {players === null && <p className="text-slate">{t('common.loading')}</p>}
          <ol className="space-y-1.5">
            {players?.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/u/${encodeURIComponent(p.username)}`}
                  className={`grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2 ${p.id === me.id ? 'bg-card-yellow/30' : 'bg-paper hover:bg-white'}`}
                >
                  <span className="font-display font-extrabold text-2xl text-slate tabular">{p.rank}</span>
                  <Jersey slug={p.avatar} size={34} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate font-semibold">
                      <Flag code={p.countryCode} size="sm" />
                      {p.username}
                    </span>
                    <LeagueBadge league={p.league} />
                  </span>
                  <span className="flex items-center gap-1 font-display font-extrabold text-2xl tabular">
                    <TrophyIcon className="h-4 w-4 text-card-yellow-deep" />
                    {formatNumber(p.trophies, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
