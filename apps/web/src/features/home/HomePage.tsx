import {
  type CountryStanding,
  DIFFICULTIES,
  type Difficulty,
  leagueForTrophies,
  type MatchHistoryEntry,
  nextLeague,
  type TournamentState,
} from '@swcup/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BotBadge, LeagueBadge, TrophyIcon } from '../../components/Badges';
import { Flag } from '../../components/Flag';
import { api } from '../../lib/api';
import { countryName, formatDuration, signed } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { useQueue, useTournament } from '../../stores/lobby';
import { useSession } from '../../stores/session';

function usePolling<T>(load: () => Promise<T>, ms: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () =>
      load()
        .then((d) => alive && setData(d))
        .catch(() => undefined);
    void run();
    const id = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [load, ms]);
  return data;
}

const loadCountries = () => api.countries('total');
const loadCup = () => api.tournaments().then((r) => r.current);

export function HomePage() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const me = useSession((s) => s.me)!;
  const queue = useQueue();
  const joinCup = useTournament((s) => s.join);
  const myCup = useTournament((s) => s.state);
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [history, setHistory] = useState<MatchHistoryEntry[] | null>(null);
  const countries = usePolling<CountryStanding[]>(loadCountries, 15_000);
  const lobby = usePolling<TournamentState | null>(loadCup, 5_000);

  useEffect(() => {
    api
      .history(me.username)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [me.username]);

  const league = leagueForTrophies(me.trophies);
  const upcoming = nextLeague(league.slug);
  const progress = upcoming
    ? (me.trophies - league.minTrophies) / (upcoming.minTrophies - league.minTrophies)
    : 1;
  const searching = queue.mode !== null;
  const cupState = myCup && myCup.status !== 'finished' ? myCup : lobby;
  const seatsTaken = cupState?.status === 'lobby' ? cupState.players.length : 0;
  const runningCup = cupState?.status === 'running' ? cupState : null;
  const liveRound = runningCup
    ? Math.max(
        0,
        runningCup.rounds.findIndex((round) => round.some((m) => m.status !== 'finished')),
      )
    : 0;
  const knockedOut = new Set(
    runningCup?.rounds.flat().flatMap((m) => (m.winner ? [m.winner === m.a ? m.b : m.a] : [])) ?? [],
  );
  const amInRunningCup = runningCup?.players.some((p) => p.userId === me.id) ?? false;
  const leaderPoints = countries?.[0]?.points ?? 1;

  const enterCup = async () => {
    const state = await joinCup();
    if (state) navigate('/cup');
  };

  return (
    <div className="space-y-6">
      <section className="pitch overflow-hidden rounded-xl text-white">
        <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_minmax(0,22rem)] md:items-end">
          <div>
            <h1 className="text-[clamp(2.5rem,6vw,4.5rem)]">{t('home.greeting', { name: me.username })}</h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="rounded-md bg-chalk px-2 py-1">
                <LeagueBadge league={league.slug} />
              </span>
              <span className="flex items-center gap-1.5 font-display font-bold text-2xl text-card-yellow tabular">
                <TrophyIcon className="h-5 w-5" />
                {me.trophies}
              </span>
            </div>
            <div className="mt-4 max-w-sm">
              <div className="h-2 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-card-yellow"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-sm text-white/80">
                {upcoming
                  ? t('home.nextLeague', {
                      n: upcoming.minTrophies - me.trophies,
                      league: t(`league.${upcoming.slug}`),
                    })
                  : t('home.topLeague')}
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-ink/85 p-5 backdrop-blur-sm">
            <h2 className="text-3xl">{t('home.ranked')}</h2>
            <p className="mt-1 text-sm text-white/75">{t('home.rankedDesc')}</p>
            <button
              type="button"
              disabled={searching}
              onClick={() => void queue.join('ranked')}
              className="mt-4 w-full rounded-lg bg-card-yellow py-3 font-display font-extrabold text-2xl text-ink transition-transform hover:-translate-y-px disabled:opacity-50"
            >
              {t('home.findOpponent')}
            </button>
          </div>
        </div>
      </section>

      {queue.error && (
        <p className="rounded-md bg-card-red/10 px-3 py-2 font-medium text-card-red text-sm" role="alert">
          {queue.error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <section className="rounded-xl border border-rule bg-paper p-5">
          <h2 className="text-2xl">{t('home.quick')}</h2>
          <p className="text-slate text-sm">{t('home.quickDesc')}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg bg-chalk p-1" role="radiogroup" aria-label={t('home.quick')}>
              {DIFFICULTIES.map((d) => (
                <button
                  type="button"
                  key={d}
                  role="radio"
                  aria-checked={difficulty === d}
                  onClick={() => setDifficulty(d)}
                  className={`rounded-md px-3 py-1.5 font-semibold text-sm ${
                    difficulty === d ? 'bg-ink text-white' : 'text-slate hover:text-ink'
                  }`}
                >
                  {t(`difficulty.${d}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={searching}
              onClick={() => void queue.join('casual', difficulty)}
              className="rounded-lg bg-turf px-5 py-2 font-semibold text-white hover:bg-turf-deep disabled:opacity-50"
            >
              {t('home.play')}
            </button>
          </div>
        </section>

        <section className="rounded-xl bg-ink p-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl">{t('home.cup')}</h2>
              <p className="max-w-xs text-sm text-white/75">{t('home.cupDesc')}</p>
            </div>
            <button
              type="button"
              disabled={searching}
              onClick={() => void (myCup && myCup.status !== 'finished' ? navigate('/cup') : enterCup())}
              className="rounded-lg bg-card-yellow px-4 py-2 font-semibold text-ink disabled:opacity-50"
            >
              {myCup && myCup.status !== 'finished' ? t('home.openCup') : t('home.joinCup')}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-8 gap-1.5" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => {
              const p = cupState && cupState.status !== 'finished' ? cupState.players[i] : undefined;
              const out = p ? knockedOut.has(p.userId) : false;
              return (
                <span
                  key={i}
                  className={`grid h-8 place-items-center rounded-md transition-opacity ${
                    p
                      ? p.userId === me.id
                        ? 'bg-card-yellow/40'
                        : 'bg-white/15'
                      : 'border border-white/20 border-dashed'
                  } ${out ? 'opacity-30' : ''}`}
                >
                  {p && <Flag code={p.countryCode} size="sm" decorative />}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-white/75">
            {runningCup
              ? t(amInRunningCup ? 'home.cupRunning' : 'home.cupRunningOthers', {
                  round: t(`match.round.${liveRound}` as 'match.round.0'),
                })
              : seatsTaken > 0
                ? t('home.cupLobby', { n: seatsTaken })
                : t('home.cupEmpty')}
          </p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-2xl">{t('home.countries')}</h2>
            <Link to="/standings" className="font-semibold text-sm text-turf hover:underline">
              {t('home.allStandings')}
            </Link>
          </div>
          {countries && countries.length === 0 && (
            <p className="text-slate text-sm">{t('standings.empty')}</p>
          )}
          <ol className="space-y-1.5">
            {countries?.slice(0, 6).map((c) => (
              <li key={c.countryCode} className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2">
                <span className="w-5 font-display font-bold text-lg text-slate tabular">{c.rank}</span>
                <Flag code={c.countryCode} decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{countryName(c.countryCode, locale)}</span>
                  <span
                    className="mt-1 block h-1 rounded-full bg-turf"
                    style={{ width: `${Math.max(4, (c.points / leaderPoints) * 100)}%` }}
                  />
                </span>
                <span className="font-display font-bold text-xl tabular">{c.points}</span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="mb-3 text-2xl">{t('home.recent')}</h2>
          {history && history.length === 0 && <p className="text-slate text-sm">{t('home.noMatches')}</p>}
          <ul className="space-y-1.5">
            {history?.slice(0, 6).map((m) => (
              <li key={m.matchId}>
                <Link
                  to={`/m/${m.matchId}`}
                  className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2 ring-1 ring-transparent transition-shadow hover:ring-rule"
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-md font-display font-extrabold text-white ${
                      m.result === 'win' ? 'bg-turf' : m.result === 'loss' ? 'bg-card-red' : 'bg-slate'
                    }`}
                  >
                    {t(`result.short.${m.result}`)}
                  </span>
                  <Flag code={m.opponent.countryCode} size="sm" decorative />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-semibold">
                    {m.opponent.username}
                    {m.opponent.isBot && <BotBadge />}
                  </span>
                  <span className="hidden text-slate text-sm sm:inline">
                    {t(`difficulty.${m.difficulty}`)}
                  </span>
                  <span className="w-16 text-right text-sm tabular">{formatDuration(m.finishTimeMs)}</span>
                  <span
                    className={`w-10 text-right font-semibold text-sm tabular ${m.trophiesDelta >= 0 ? 'text-turf' : 'text-card-red'}`}
                  >
                    {m.type === 'ranked' ? signed(m.trophiesDelta) : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
