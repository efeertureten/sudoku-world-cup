import type { BracketMatch, TournamentPlayer, TournamentState, TournamentSummary } from '@swcup/shared';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { BotBadge, TrophyIcon } from '../../components/Badges';
import { Flag } from '../../components/Flag';
import { Jersey } from '../../components/Jersey';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { serverNow } from '../../lib/socket';
import { useTournament } from '../../stores/lobby';
import { useSession } from '../../stores/session';

function PlayerRow({
  player,
  winner,
  me,
}: {
  player: TournamentPlayer | undefined;
  winner: boolean;
  me: boolean;
}) {
  const t = useT();
  if (!player) return <div className="h-8 px-2 text-slate/60 text-sm leading-8">—</div>;
  return (
    <div
      className={`flex h-8 items-center gap-2 px-2 text-sm ${winner ? 'font-bold' : 'text-ink/80'} ${me ? 'bg-card-yellow/35' : ''}`}
    >
      <Flag code={player.countryCode} size="sm" />
      <span className="min-w-0 flex-1 truncate">
        {me ? `${player.username} (${t('cup.you')})` : player.username}
      </span>
      {player.isBot && <BotBadge />}
      {winner && <span className="h-2 w-2 shrink-0 rounded-full bg-turf" aria-hidden="true" />}
    </div>
  );
}

function MatchBox({
  match,
  players,
  meId,
}: {
  match: BracketMatch;
  players: TournamentPlayer[];
  meId: string;
}) {
  const t = useT();
  const find = (id: string | null) => players.find((p) => p.userId === id);
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-paper ring-1 ${match.status === 'live' ? 'ring-2 ring-card-red' : 'ring-rule'}`}
    >
      {match.status === 'live' && (
        <span className="absolute top-0 right-0 flex items-center gap-1 rounded-bl-md bg-card-red px-1.5 font-semibold text-[10px] text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          {t('cup.live')}
        </span>
      )}
      <PlayerRow
        player={find(match.a)}
        winner={match.winner !== null && match.winner === match.a}
        me={match.a === meId}
      />
      <div className="h-px bg-rule" />
      <PlayerRow
        player={find(match.b)}
        winner={match.winner !== null && match.winner === match.b}
        me={match.b === meId}
      />
    </div>
  );
}

/** Four columns, each twice as tall per match as the last, so pairs line up with their next match. */
function Bracket({ state, meId }: { state: TournamentState; meId: string }) {
  const t = useT();
  const champion = state.players.find((p) => p.userId === state.championId);
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[52rem] grid-cols-[repeat(4,minmax(0,1fr))_10rem] gap-4">
        {state.rounds.map((round, r) => (
          <div key={r} className="flex flex-col">
            <h3 className="mb-2 font-sans font-semibold text-slate text-sm">
              {t(`match.round.${r}` as 'match.round.0')}
            </h3>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {round.map((m) => (
                <MatchBox key={m.slot} match={m} players={state.players} meId={meId} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col">
          <h3 className="mb-2 font-sans font-semibold text-slate text-sm">{t('cup.champion')}</h3>
          <div className="flex flex-1 items-center">
            {champion ? (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full rounded-lg bg-ink p-3 text-center text-white"
              >
                <TrophyIcon className="mx-auto h-8 w-8 text-card-yellow" />
                <div className="mt-1 flex items-center justify-center gap-1.5 font-display font-extrabold text-xl">
                  <Flag code={champion.countryCode} size="sm" />
                  {champion.username}
                </div>
              </motion.div>
            ) : (
              <div className="grid h-24 w-full place-items-center rounded-lg border-2 border-rule border-dashed">
                <TrophyIcon className="h-8 w-8 text-rule" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Lobby({ state, meId, onLeave }: { state: TournamentState; meId: string; onLeave(): void }) {
  const t = useT();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, []);
  const left = state.fillAt ? Math.max(0, Math.ceil((state.fillAt - now) / 1000)) : 0;
  const amIn = state.players.some((p) => p.userId === meId);
  return (
    <section className="rounded-xl bg-ink p-5 text-white sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-4xl">{t('cup.lobby')}</h2>
          <p className="mt-1 text-white/80">{t('cup.waiting', { n: state.players.length, s: left })}</p>
        </div>
        {amIn && (
          <button
            type="button"
            onClick={onLeave}
            className="rounded-md border border-white/30 px-4 py-2 font-semibold text-sm hover:bg-white/10"
          >
            {t('cup.leave')}
          </button>
        )}
      </div>
      <ol className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: state.size }, (_, i) => {
          const p = state.players[i];
          return (
            <li
              key={i}
              className={`flex h-12 items-center gap-2 rounded-md px-2.5 ${p ? 'bg-white/10' : 'border border-white/20 border-dashed text-white/45'}`}
            >
              {p ? (
                <>
                  <Jersey slug={p.avatar} size={28} />
                  <Flag code={p.countryCode} size="sm" />
                  <span className="truncate font-semibold text-sm">
                    {p.userId === meId ? t('cup.you') : p.username}
                  </span>
                </>
              ) : (
                <span className="text-sm">{t('cup.emptySeat')}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function TournamentPage() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const { id } = useParams();
  const me = useSession((s) => s.me)!;
  const { state, join, leave, watch, error } = useTournament();
  const [recent, setRecent] = useState<TournamentSummary[]>([]);

  useEffect(() => {
    if (id) void watch(id);
  }, [id, watch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh past cups when the live one finishes
  useEffect(() => {
    api
      .tournaments()
      .then((r) => setRecent(r.recent))
      .catch(() => undefined);
  }, [state?.status]);

  const shown = state && (!id || state.id === id) ? state : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-5xl">{t('cup.title')}</h1>
        {(!shown || shown.status === 'finished') && (
          <button
            type="button"
            onClick={() => void join()}
            className="rounded-lg bg-card-yellow px-5 py-2.5 font-semibold text-ink"
          >
            {t('cup.join')}
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-md bg-card-red/10 px-3 py-2 font-medium text-card-red text-sm" role="alert">
          {error}
        </p>
      )}
      <p className="max-w-2xl text-slate">{t('home.cupDesc')}</p>

      {shown?.status === 'lobby' && <Lobby state={shown} meId={me.id} onLeave={() => void leave()} />}
      {shown && shown.status !== 'lobby' && <Bracket state={shown} meId={me.id} />}

      <section>
        <h2 className="mb-3 text-2xl">{t('cup.recent')}</h2>
        {recent.length === 0 && <p className="text-slate text-sm">{t('cup.none')}</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {recent.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void watch(r.id)}
                className="flex w-full items-center gap-3 rounded-lg bg-paper px-3 py-2.5 text-left ring-1 ring-rule hover:ring-ink/30"
              >
                <TrophyIcon className={`h-5 w-5 ${r.champion ? 'text-card-yellow-deep' : 'text-rule'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate font-semibold">
                    {r.champion ? (
                      <>
                        <Flag code={r.champion.countryCode} size="sm" />
                        {r.champion.username}
                        {r.champion.isBot && <BotBadge />}
                      </>
                    ) : (
                      t('cup.live')
                    )}
                  </span>
                  <span className="text-slate text-xs">
                    {r.startedAt ? formatDate(r.startedAt, locale) : ''}.{' '}
                    {t('cup.humans', { n: r.humanPlayers })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
