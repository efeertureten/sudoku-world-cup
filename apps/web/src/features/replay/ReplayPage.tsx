import {
  type BoardTheme,
  leagueForTrophies,
  type MatchDetail,
  type PublicPlayer,
  themeBySlug,
} from '@swcup/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BotBadge } from '../../components/Badges';
import { Flag } from '../../components/Flag';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatDuration, reasonKey } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { useSession } from '../../stores/session';
import { ScoreBug } from '../match/ScoreBug';
import { boardAt, type Move, type ReplayFrame } from './frames';

type Participant = MatchDetail['participants'][number];

const SPEEDS = [1, 4, 16] as const;

function toPublic(p: Participant): PublicPlayer {
  return {
    id: p.userId,
    username: p.username,
    countryCode: p.countryCode,
    avatar: p.avatar,
    isBot: p.isBot,
    trophies: p.trophiesAfter,
    league: leagueForTrophies(p.trophiesAfter).slug,
  };
}

/** A read-only board: same box structure and theme as the live one, without any input. */
function ReplayBoard({
  givens,
  state,
  theme,
}: {
  givens: string;
  state: ReplayFrame;
  theme: BoardTheme['colors'];
}) {
  return (
    <div
      className="grid aspect-square w-full grid-cols-3 gap-[3px] rounded-lg p-[3px]"
      style={{ backgroundColor: theme.frame }}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((box) => {
        const r0 = Math.floor(box / 3) * 3;
        const c0 = (box % 3) * 3;
        return (
          <div key={box} className="grid grid-cols-3 gap-px" style={{ backgroundColor: theme.line }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => {
              const i = (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3);
              const given = givens[i] !== '0';
              const value = state.values[i]!;
              const wrong = state.wrong?.cell === i ? state.wrong : null;
              let bg = Math.floor(i / 27) % 2 === Math.floor((i % 9) / 3) % 2 ? theme.cell : theme.cellAlt;
              if (state.last === i) bg = theme.accent;
              return (
                <span
                  key={i}
                  className="grid aspect-square place-items-center font-display text-[clamp(0.85rem,2.6vw,1.45rem)] leading-none"
                  style={{ backgroundColor: bg }}
                >
                  {value !== 0 ? (
                    <span style={{ color: given ? theme.given : theme.input, fontWeight: given ? 800 : 600 }}>
                      {value}
                    </span>
                  ) : wrong ? (
                    <span style={{ color: theme.error, fontWeight: 700 }}>{wrong.value}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** One lane per player: a tick for every move, red for mistakes. */
function Timeline({
  lanes,
  duration,
  at,
}: {
  lanes: { id: string; moves: Move[]; color: string }[];
  duration: number;
  at: number;
}) {
  return (
    <div className="relative space-y-1" aria-hidden="true">
      {lanes.map((lane) => (
        <div key={lane.id} className="relative h-3 overflow-hidden rounded-sm bg-ink/8">
          {lane.moves.map((m, i) => (
            <span
              key={i}
              className="absolute top-0 h-full w-[2px]"
              style={{
                left: `${(m.t / duration) * 100}%`,
                backgroundColor: m.ok ? lane.color : '#d7263d',
                opacity: m.t <= at ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      ))}
      <span
        className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink"
        style={{ left: `${(at / duration) * 100}%` }}
      />
    </div>
  );
}

type Verification = 'idle' | 'running' | 'ok' | 'mismatch' | 'old';

function VerifyCard({ detail }: { detail: MatchDetail }) {
  const t = useT();
  const [status, setStatus] = useState<Verification>('idle');

  const run = async () => {
    setStatus('running');
    // The generator is only needed here, so it stays out of the main bundle.
    const engine = await import('@swcup/engine');
    if (detail.generatorVersion !== engine.GENERATOR_VERSION) {
      setStatus('old');
      return;
    }
    // Let the "Generating…" state paint before the synchronous work starts.
    await new Promise((r) => setTimeout(r, 30));
    const puzzle = engine.generatePuzzle(detail.generatorSeed, detail.difficulty);
    const same =
      engine.serializeGrid(puzzle.givens) === detail.givens &&
      engine.serializeGrid(puzzle.solution) === detail.solution &&
      engine.hasUniqueSolution(puzzle.givens);
    setStatus(same ? 'ok' : 'mismatch');
  };

  return (
    <section className="rounded-xl bg-paper p-5 ring-1 ring-rule">
      <h2 className="text-2xl">{t('replay.verifyTitle')}</h2>
      <p className="mt-1 max-w-2xl text-slate text-sm">{t('replay.verifyDesc')}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm tabular">
        <div>
          <dt className="inline text-slate">puzzle </dt>
          <dd className="inline font-semibold">#{detail.puzzleId}</dd>
        </div>
        <div>
          <dt className="inline text-slate">seed </dt>
          <dd className="inline font-semibold">{detail.generatorSeed}</dd>
        </div>
        <div>
          <dt className="inline text-slate">engine </dt>
          <dd className="inline font-semibold">v{detail.generatorVersion}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={status === 'running'}
          className="rounded-md bg-ink px-4 py-2 font-semibold text-sm text-white hover:bg-ink-soft disabled:opacity-60"
        >
          {status === 'running' ? t('replay.verifying') : t('replay.verify')}
        </button>
        {status === 'ok' && (
          <p className="font-semibold text-sm text-turf" role="status">
            ✓ {t('replay.verified')}
          </p>
        )}
        {status === 'mismatch' && (
          <p className="font-semibold text-card-red text-sm" role="status">
            {t('replay.mismatch')}
          </p>
        )}
        {status === 'old' && (
          <p className="text-slate text-sm" role="status">
            {t('replay.oldVersion', { v: detail.generatorVersion })}
          </p>
        )}
      </div>
    </section>
  );
}

export function ReplayPage() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const me = useSession((s) => s.me);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const frame = useRef(0);

  useEffect(() => {
    setDetail(null);
    setMissing(false);
    api
      .match(id)
      .then((d) => {
        setDetail(d);
        setAt(0);
        setPlaying(true);
      })
      .catch((err) => {
        if (err instanceof ApiError) setMissing(true);
      });
  }, [id]);

  // Viewer first, otherwise the winner on the left.
  const players = useMemo(() => {
    if (!detail) return [];
    const list = [...detail.participants];
    const leftId = list.some((p) => p.userId === me?.id) ? me?.id : detail.winnerId;
    return list.sort((a, b) => (a.userId === leftId ? -1 : b.userId === leftId ? 1 : 0));
  }, [detail, me?.id]);

  const duration = useMemo(() => {
    if (!detail) return 1;
    const lastMove = Math.max(0, ...detail.participants.flatMap((p) => p.moves.map((m) => m.t)));
    const span = Date.parse(detail.endedAt) - Date.parse(detail.startedAt);
    return Math.max(1_000, lastMove > 0 ? lastMove + 800 : span);
  }, [detail]);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const step = (now - previous) * speed;
      previous = now;
      setAt((current) => {
        const next = Math.min(duration, current + step);
        if (next >= duration) setPlaying(false);
        return next;
      });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, speed, duration]);

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">{t('replay.notFound')}</p>
        <Link to="/" className="mt-3 inline-block font-semibold text-sm text-turf hover:underline">
          {t('result.lobby')}
        </Link>
      </div>
    );
  }
  if (!detail || players.length !== 2) {
    return <p className="py-16 text-center text-slate">{t('common.loading')}</p>;
  }

  const theme = themeBySlug(me?.theme).colors;
  const [left, right] = players as [Participant, Participant];
  const leftState = boardAt(detail.givens, left.moves, at);
  const rightState = boardAt(detail.givens, right.moves, at);
  const totalEmpty = [...detail.givens].filter((c) => c === '0').length;
  const ended = at >= duration;

  const togglePlay = () => {
    if (ended) setAt(0);
    setPlaying((p) => !p || ended);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="mb-1 font-semibold text-slate text-sm hover:text-ink"
          >
            ← {t('replay.back')}
          </button>
          <h1 className="text-5xl">{t('replay.title')}</h1>
          <p className="mt-1 text-slate">
            {t(`matchType.${detail.type}`)} · {t(`difficulty.${detail.difficulty}`)} ·{' '}
            {formatDate(detail.endedAt, locale)}
          </p>
        </div>
      </div>

      <ScoreBug
        you={{ player: toPublic(left), filled: leftState.filled, mistakes: leftState.mistakes }}
        opponent={{ player: toPublic(right), filled: rightState.filled, mistakes: rightState.mistakes }}
        total={totalEmpty}
        elapsedMs={at}
        remainingMs={null}
        label={t(`difficulty.${detail.difficulty}`)}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { p: left, state: leftState },
          { p: right, state: rightState },
        ].map(({ p, state }) => (
          <figure key={p.userId} className="space-y-2">
            <figcaption className="flex items-center gap-2 text-sm">
              <Flag code={p.countryCode} size="sm" />
              <span className="font-semibold">{p.username}</span>
              {p.isBot && <BotBadge />}
              <span
                className={`ml-auto rounded px-1.5 py-px font-semibold text-xs text-white ${
                  p.result === 'win' ? 'bg-turf' : p.result === 'loss' ? 'bg-card-red' : 'bg-slate'
                }`}
              >
                {t(`result.short.${p.result}`)}
              </span>
              <span className="text-slate tabular">{formatDuration(p.finishTimeMs)}</span>
            </figcaption>
            <ReplayBoard givens={detail.givens} state={state} theme={theme} />
          </figure>
        ))}
      </div>

      <section className="space-y-3 rounded-xl bg-paper p-4 ring-1 ring-rule">
        <Timeline
          lanes={[
            { id: left.userId, moves: left.moves, color: '#c99f00' },
            { id: right.userId, moves: right.moves, color: '#10213a' },
          ]}
          duration={duration}
          at={at}
        />
        <input
          type="range"
          min={0}
          max={duration}
          step={100}
          value={Math.round(at)}
          onChange={(e) => {
            setPlaying(false);
            setAt(Number(e.target.value));
          }}
          aria-label={t('replay.title')}
          className="w-full accent-turf"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="min-w-24 rounded-md bg-ink px-4 py-2 font-semibold text-sm text-white hover:bg-ink-soft"
          >
            {playing ? t('replay.pause') : ended ? t('replay.restart') : t('replay.play')}
          </button>
          <div className="flex rounded-lg bg-chalk p-1" role="radiogroup" aria-label={t('replay.speed')}>
            {SPEEDS.map((s) => (
              <button
                type="button"
                key={s}
                role="radio"
                aria-checked={speed === s}
                onClick={() => setSpeed(s)}
                className={`rounded-md px-3 py-1 font-semibold text-sm tabular ${speed === s ? 'bg-ink text-white' : 'text-slate hover:text-ink'}`}
              >
                {s}×
              </button>
            ))}
          </div>
          <span className="ml-auto text-slate text-sm tabular">
            {formatDuration(at)} / {formatDuration(duration)}
          </span>
        </div>
        {left.userId === me?.id && (
          <p className="text-slate text-sm">{t(reasonKey(detail.reason, left.result))}</p>
        )}
      </section>

      <VerifyCard detail={detail} />
    </div>
  );
}
