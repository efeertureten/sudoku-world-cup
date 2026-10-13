import { EMOTES, type EmoteId, themeBySlug } from '@swcup/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { BotBadge } from '../../components/Badges';
import { Flag } from '../../components/Flag';
import { Jersey } from '../../components/Jersey';
import { useT } from '../../lib/i18n';
import { call, serverNow } from '../../lib/socket';
import { useQueue, useToasts } from '../../stores/lobby';
import { remainingByDigit, useMatch } from '../../stores/match';
import { useSession } from '../../stores/session';
import { Board } from './Board';
import { EmoteBar, NumberPad, OpponentMap } from './Controls';
import { ResultPanel } from './ResultPanel';
import { ScoreBug } from './ScoreBug';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function MatchPage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useSession((s) => s.me)!;
  const m = useMatch();
  const joinQueue = useQueue((s) => s.join);
  const pushToast = useToasts((s) => s.push);
  const now = useNow(200);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const theme = themeBySlug(me.theme).colors;

  const lockedMs = Math.max(0, m.lockedUntil - serverNow());

  const onKey = useCallback((e: KeyboardEvent) => {
    const s = useMatch.getState();
    if (s.phase !== 'playing' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    const sel = s.selected ?? 0;
    const moves: Record<string, number> = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves) {
      e.preventDefault();
      const next = sel + moves[e.key]!;
      if (e.key === 'ArrowLeft' && sel % 9 === 0) return;
      if (e.key === 'ArrowRight' && sel % 9 === 8) return;
      if (next >= 0 && next < 81) s.select(next);
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      s.input(Number(e.key), e.shiftKey ? true : undefined);
      return;
    }
    if (e.code.startsWith('Digit') && e.shiftKey) {
      const d = Number(e.code.slice(5));
      if (d >= 1 && d <= 9) s.input(d, true);
      return;
    }
    if (e.key === 'n' || e.key === 'N') s.toggleNotesMode();
    if (e.key === 'Backspace' || e.key === 'Delete') s.clearNotes();
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  if (m.phase === 'idle' || !m.you || !m.opponent) return <Navigate to="/" replace />;

  const sendEmote = (emoteId: EmoteId) => {
    if (!m.matchId) return;
    m.onEmote(emoteId, true);
    call('match:emote', { matchId: m.matchId, emoteId }).catch((err) => pushToast(err.message, 'error'));
  };

  const forfeit = async () => {
    setConfirmForfeit(false);
    if (m.matchId) await call('match:forfeit', { matchId: m.matchId }).catch(() => undefined);
  };

  const label = m.tournament
    ? t(`match.round.${m.tournament.round}` as 'match.round.0')
    : m.difficulty
      ? t(`difficulty.${m.difficulty}`)
      : '';
  const elapsed = m.startedAt
    ? Math.max(
        0,
        m.result
          ? (m.result.results.find((r) => r.userId === me.id)?.finishTimeMs ?? now - m.startedAt)
          : now - m.startedAt,
      )
    : null;
  const remaining = m.endsAt && m.phase === 'playing' ? Math.max(0, m.endsAt - now) : null;
  const countdown = m.startsAt ? Math.ceil((m.startsAt - now) / 1000) : null;
  const opp = m.opponentState;
  const graceLeft = opp.graceEndsAt ? Math.max(0, Math.ceil((opp.graceEndsAt - now) / 1000)) : 0;
  const wrongVisible = m.lastWrong && Date.now() - m.lastWrong.at < 900 ? m.lastWrong : null;
  const emptyBoard = '0'.repeat(81);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="relative">
        <ScoreBug
          you={{ player: m.you, filled: m.filled, mistakes: m.mistakes }}
          opponent={{
            player: m.opponent,
            filled: opp.filled,
            mistakes: opp.mistakes,
            connected: opp.connected,
          }}
          total={m.totalEmpty}
          elapsedMs={elapsed}
          remainingMs={remaining}
          label={label}
        />
        <div className="pointer-events-none absolute top-full right-4 z-10 flex flex-col items-end gap-1">
          <AnimatePresence>
            {m.emotes
              .filter((e) => !e.mine)
              .map((e) => (
                <motion.span
                  key={e.id}
                  initial={{ y: -10, opacity: 0, scale: 0.6 }}
                  animate={{ y: 6, opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="rounded-full bg-paper px-3 py-1 text-2xl shadow-lg"
                >
                  {EMOTES.find((x) => x.id === e.emoteId)?.glyph}
                </motion.span>
              ))}
          </AnimatePresence>
        </div>
      </div>

      {!opp.connected && m.phase === 'playing' && (
        <p className="rounded-md bg-card-yellow/30 px-3 py-2 font-semibold text-sm" role="status">
          {t('match.opponentLeft', { s: graceLeft })}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,34rem)_1fr] lg:items-start">
        <div className="relative mx-auto w-full max-w-[34rem]">
          <Board
            givens={m.givens ?? emptyBoard}
            board={m.board}
            notes={m.notes}
            pending={m.pending}
            selected={m.phase === 'playing' ? m.selected : null}
            wrong={wrongVisible}
            lastCorrect={m.lastCorrect}
            locked={lockedMs > 0}
            theme={theme}
            onSelect={(cell) => m.select(cell)}
          />

          <AnimatePresence>
            {(m.phase === 'found' || m.phase === 'countdown') && (
              <motion.div
                key="pre"
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 rounded-lg bg-ink/92 text-white"
                exit={{ opacity: 0, scale: 1.05 }}
              >
                <p className="font-semibold text-card-yellow">{t('match.found')}</p>
                <div className="flex items-center gap-3">
                  <Jersey slug={m.opponent.avatar} size={56} />
                  <div>
                    <p className="text-white/70 text-xs">{t('match.vs')}</p>
                    <p className="flex items-center gap-2 font-display font-extrabold text-3xl">
                      <Flag code={m.opponent.countryCode} />
                      {m.opponent.username}
                      {m.opponent.isBot && <BotBadge onDark />}
                    </p>
                  </div>
                </div>
                {m.phase === 'countdown' && countdown !== null ? (
                  <motion.span
                    key={countdown}
                    initial={{ scale: 1.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="font-display font-extrabold text-8xl text-card-yellow tabular"
                  >
                    {countdown > 0 ? countdown : t('match.kickoff')}
                  </motion.span>
                ) : (
                  <p className="text-sm text-white/70">{t('match.waitingReady')}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {m.phase === 'ended' && m.result && (
            <ResultPanel
              result={m.result}
              meId={me.id}
              // No reset here: leaving /match resets the store (see useSocketBridge). Resetting first
              // would render <Navigate to="/"> and race the navigation below.
              onAgain={() => {
                const mode = m.type === 'ranked' ? 'ranked' : 'casual';
                const difficulty = m.difficulty ?? undefined;
                navigate('/');
                void joinQueue(mode, mode === 'casual' ? difficulty : undefined);
              }}
              onLobby={() => navigate(m.tournament ? '/cup' : '/')}
            />
          )}
        </div>

        <aside className="space-y-5">
          <NumberPad
            remaining={remainingByDigit(m.board)}
            notesMode={m.notesMode}
            lockedMs={lockedMs}
            disabled={m.phase !== 'playing'}
            onDigit={(d) => m.input(d)}
            onToggleNotes={() => m.toggleNotesMode()}
            onClearNotes={() => m.clearNotes()}
          />
          <div className="grid grid-cols-[auto_1fr] items-start gap-5">
            <OpponentMap givens={m.givens} solved={opp.solved} />
            {!m.opponent.isBot && m.phase !== 'ended' && <EmoteBar onSend={sendEmote} />}
          </div>
          {m.phase !== 'ended' && (
            <div>
              {confirmForfeit ? (
                <div className="rounded-lg bg-paper p-3 ring-1 ring-rule">
                  <p className="text-sm">{t('match.forfeitConfirm')}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void forfeit()}
                      className="rounded-md bg-card-red px-3 py-1.5 font-semibold text-sm text-white"
                    >
                      {t('match.forfeitYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmForfeit(false)}
                      className="rounded-md px-3 py-1.5 font-semibold text-sm"
                    >
                      {t('match.forfeitNo')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmForfeit(true)}
                  className="font-semibold text-slate text-sm underline-offset-2 hover:text-card-red hover:underline"
                >
                  {t('match.forfeit')}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
