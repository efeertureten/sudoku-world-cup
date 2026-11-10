import { DIFFICULTIES, type Difficulty, themeBySlug } from '@swcup/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock } from '../../lib/format';
import { useT } from '../../lib/i18n';
import {
  type BestTimes,
  createGame,
  eraseCell,
  giveHint,
  isGiven,
  loadBestTimes,
  loadGame,
  type MoveResult,
  type PracticeGame,
  placeDigit,
  recordFinish,
  remainingDigits,
  saveGame,
  suggestCell,
  toggleNote,
  undoMove,
} from '../../lib/practice';
import { useSession } from '../../stores/session';
import { Board } from '../match/Board';
import { NumberPad } from '../match/Controls';

/** Time only counts while the tab is visible and the game is not paused. */
function useGameClock(active: boolean, onTick: (deltaMs: number) => void) {
  const tick = useRef(onTick);
  tick.current = onTick;
  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      if (document.visibilityState === 'visible') tick.current(delta);
    }, 250);
    return () => clearInterval(id);
  }, [active]);
}

function startingGame(): PracticeGame {
  return loadGame() ?? createGame('easy');
}

export function PracticePage() {
  const t = useT();
  const me = useSession((s) => s.me);
  const theme = themeBySlug(me?.theme).colors;

  const [game, setGame] = useState<PracticeGame>(startingGame);
  const [selected, setSelected] = useState<number | null>(() => suggestCell(game));
  const [notesMode, setNotesMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wrong, setWrong] = useState<{ cell: number; value: number; at: number } | null>(null);
  const [lastCorrect, setLastCorrect] = useState<{ cell: number; at: number } | null>(null);
  const [best, setBest] = useState<BestTimes>(loadBestTimes);
  const [newBest, setNewBest] = useState(false);
  const [pendingDifficulty, setPendingDifficulty] = useState<Difficulty | null>(null);

  const gameRef = useRef(game);
  gameRef.current = game;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const notesModeRef = useRef(notesMode);
  notesModeRef.current = notesMode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const recordedSeed = useRef<number | null>(null);

  useGameClock(!game.done && !paused, (delta) =>
    setGame((g) => (g.done ? g : { ...g, elapsedMs: g.elapsedMs + delta })),
  );

  // Persist after every change; a finished game is dropped so a reload starts fresh.
  useEffect(() => {
    saveGame(game.done ? null : game);
  }, [game]);

  useEffect(() => {
    if (!game.done || recordedSeed.current === game.seed) return;
    recordedSeed.current = game.seed;
    setNewBest(recordFinish(game));
    setBest(loadBestTimes());
  }, [game]);

  useEffect(() => {
    if (!wrong) return;
    const id = setTimeout(() => setWrong(null), 900);
    return () => clearTimeout(id);
  }, [wrong]);

  // Pause automatically when the player leaves the tab, so the clock never runs unseen.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') setPaused(true);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const startNew = useCallback((difficulty: Difficulty) => {
    const next = createGame(difficulty);
    recordedSeed.current = null;
    setGame(next);
    setSelected(suggestCell(next));
    setNotesMode(false);
    setPaused(false);
    setWrong(null);
    setLastCorrect(null);
    setNewBest(false);
    setPendingDifficulty(null);
  }, []);

  const requestNew = useCallback(
    (difficulty: Difficulty) => {
      const g = gameRef.current;
      if (!g.done && g.undo.length > 0) setPendingDifficulty(difficulty);
      else startNew(difficulty);
    },
    [startNew],
  );

  const afterMove = useCallback((cell: number, result: MoveResult, digit: number) => {
    if (result === 'wrong') setWrong({ cell, value: digit, at: Date.now() });
    else if (result === 'placed') setLastCorrect({ cell, at: Date.now() });
  }, []);

  const input = useCallback(
    (digit: number, forceNotes?: boolean) => {
      const g = gameRef.current;
      const cell = selectedRef.current;
      if (cell === null || pausedRef.current || g.done) return;
      const asNote = forceNotes ?? notesModeRef.current;
      const { game: next, result } = asNote ? toggleNote(g, cell, digit) : placeDigit(g, cell, digit);
      if (result === 'ignored') return;
      setGame(next);
      afterMove(cell, result, digit);
    },
    [afterMove],
  );

  const hint = useCallback(() => {
    const g = gameRef.current;
    if (pausedRef.current || g.done) return;
    // Use the selected cell when it is empty, otherwise the easiest empty cell.
    const sel = selectedRef.current;
    const cell = sel !== null && g.board[sel] === 0 ? sel : suggestCell(g);
    if (cell === null) return;
    const { game: next, result } = giveHint(g, cell);
    if (result === 'ignored') return;
    setGame(next);
    setSelected(cell);
    afterMove(cell, result, 0);
  }, [afterMove]);

  const undo = useCallback(() => {
    if (pausedRef.current) return;
    setGame((g) => undoMove(g));
  }, []);

  const clearNotes = useCallback(() => {
    const cell = selectedRef.current;
    if (cell === null || pausedRef.current) return;
    setGame((g) => eraseCell(g, cell));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey) return;
      const sel = selectedRef.current ?? 0;
      const moves: Record<string, number> = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
      if (e.key in moves) {
        e.preventDefault();
        if (e.key === 'ArrowLeft' && sel % 9 === 0) return;
        if (e.key === 'ArrowRight' && sel % 9 === 8) return;
        const next = sel + moves[e.key]!;
        if (next >= 0 && next < 81) setSelected(next);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        input(Number(e.key), e.shiftKey ? true : undefined);
        return;
      }
      if (e.code.startsWith('Digit') && e.shiftKey) {
        const d = Number(e.code.slice(5));
        if (d >= 1 && d <= 9) input(d, true);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'n') setNotesMode((v) => !v);
      else if (key === 'h') hint();
      else if (e.key === 'Backspace' || e.key === 'Delete') clearNotes();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [input, hint, undo, clearNotes]);

  const remaining = remainingDigits(game.board);
  const bestForLevel = best[game.difficulty];
  const wonTime = formatClock(game.elapsedMs);
  const filledByPlayer = game.board.reduce((n, v, i) => n + (v !== 0 && !isGiven(game, i) ? 1 : 0), 0);
  const emptyTotal = game.givens.split('').filter((c) => c === '0').length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-4xl">{t('practice.title')}</h1>
        <p className="mt-1 max-w-xl text-slate text-sm">{t('practice.lead')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-chalk p-1" role="radiogroup" aria-label={t('practice.title')}>
          {DIFFICULTIES.map((d) => (
            <button
              type="button"
              key={d}
              role="radio"
              aria-checked={game.difficulty === d}
              onClick={() => (game.difficulty === d && !game.done ? undefined : requestNew(d))}
              className={`rounded-md px-3 py-1.5 font-semibold text-sm ${
                game.difficulty === d ? 'bg-ink text-white' : 'text-slate hover:text-ink'
              }`}
            >
              {t(`difficulty.${d}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => requestNew(game.difficulty)}
          className="rounded-lg bg-turf px-4 py-2 font-semibold text-sm text-white hover:bg-turf-deep"
        >
          {t('practice.new')}
        </button>
        <dl className="ml-auto flex items-center gap-5 text-sm tabular">
          <div>
            <dt className="text-slate text-xs">{t('practice.time')}</dt>
            <dd className="font-display font-extrabold text-2xl leading-none">
              {formatClock(game.elapsedMs)}
            </dd>
          </div>
          <div>
            <dt className="text-slate text-xs">{t('practice.mistakes')}</dt>
            <dd className="font-display font-extrabold text-2xl leading-none">{game.mistakes}</dd>
          </div>
          <div className="hidden sm:block">
            <dt className="text-slate text-xs">{t('practice.best')}</dt>
            <dd className="font-display font-bold text-xl leading-none">
              {bestForLevel === undefined ? t('practice.noBest') : formatClock(bestForLevel)}
            </dd>
          </div>
        </dl>
      </div>

      {pendingDifficulty && (
        <div className="rounded-lg bg-paper p-3 ring-1 ring-rule" role="alertdialog">
          <p className="text-sm">{t('practice.confirmNew')}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => startNew(pendingDifficulty)}
              className="rounded-md bg-card-red px-3 py-1.5 font-semibold text-sm text-white"
            >
              {t('practice.confirmYes')}
            </button>
            <button
              type="button"
              onClick={() => setPendingDifficulty(null)}
              className="rounded-md px-3 py-1.5 font-semibold text-sm"
            >
              {t('practice.confirmNo')}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,34rem)_1fr] lg:items-start">
        <div className="relative mx-auto w-full max-w-[34rem]">
          <Board
            givens={game.givens}
            board={game.board}
            notes={game.notes}
            pending={{}}
            selected={game.done || paused ? null : selected}
            wrong={wrong}
            lastCorrect={lastCorrect}
            locked={false}
            theme={theme}
            onSelect={setSelected}
          />

          <AnimatePresence>
            {paused && !game.done && (
              <motion.div
                key="paused"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg bg-ink/95 text-white"
              >
                <p className="font-display font-extrabold text-4xl">{t('practice.paused')}</p>
                <button
                  type="button"
                  onClick={() => setPaused(false)}
                  className="rounded-lg bg-card-yellow px-6 py-2.5 font-display font-extrabold text-2xl text-ink"
                >
                  {t('practice.resume')}
                </button>
              </motion.div>
            )}
            {game.done && (
              <motion.div
                key="won"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-ink/94 px-6 text-center text-white"
                role="status"
              >
                <p className="font-display font-extrabold text-5xl text-card-yellow">
                  {t('practice.wonTitle')}
                </p>
                <p className="text-lg">
                  {t('practice.wonLine', { difficulty: t(`difficulty.${game.difficulty}`), time: wonTime })}
                </p>
                <p className="text-sm text-white/75 tabular">
                  {t('practice.mistakes')}: {game.mistakes} · {t('practice.hints')}: {game.hints}
                </p>
                {newBest && <p className="font-semibold text-card-yellow">{t('practice.newBest')}</p>}
                {game.hints > 0 && <p className="text-white/70 text-xs">{t('practice.hintsNoBest')}</p>}
                <button
                  type="button"
                  onClick={() => startNew(game.difficulty)}
                  className="mt-2 rounded-lg bg-card-yellow px-6 py-2.5 font-display font-extrabold text-2xl text-ink"
                >
                  {t('practice.playAgain')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="space-y-4">
          <NumberPad
            remaining={remaining}
            notesMode={notesMode}
            lockedMs={0}
            disabled={game.done || paused}
            onDigit={(d) => input(d)}
            onToggleNotes={() => setNotesMode((v) => !v)}
            onClearNotes={clearNotes}
          />
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={game.done || paused || game.undo.length === 0}
              className="rounded-lg bg-paper px-3 py-2 font-semibold text-ink text-sm ring-1 ring-rule disabled:opacity-40"
            >
              {t('practice.undo')} <kbd className="ml-1 hidden text-xs opacity-60 sm:inline">⌘Z</kbd>
            </button>
            <button
              type="button"
              onClick={hint}
              disabled={game.done || paused}
              className="rounded-lg bg-paper px-3 py-2 font-semibold text-ink text-sm ring-1 ring-rule disabled:opacity-40"
            >
              {t('practice.hint')} <kbd className="ml-1 hidden text-xs opacity-60 sm:inline">H</kbd>
              {game.hints > 0 && <span className="ml-1 text-slate text-xs">({game.hints})</span>}
            </button>
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              disabled={game.done}
              className="rounded-lg bg-paper px-3 py-2 font-semibold text-ink text-sm ring-1 ring-rule disabled:opacity-40"
            >
              {paused ? t('practice.resume') : t('practice.pause')}
            </button>
          </div>
          <p className="text-slate text-xs tabular">
            {filledByPlayer}/{emptyTotal}
          </p>
          <p className="hidden text-slate text-xs lg:block">{t('practice.keys')}</p>
        </aside>
      </div>
    </div>
  );
}
