import { EMOTES, type EmoteId } from '@swcup/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '../../lib/i18n';

export function NumberPad({
  remaining,
  notesMode,
  lockedMs,
  disabled = false,
  onDigit,
  onToggleNotes,
  onClearNotes,
}: {
  remaining: number[];
  notesMode: boolean;
  lockedMs: number;
  disabled?: boolean;
  onDigit(d: number): void;
  onToggleNotes(): void;
  onClearNotes(): void;
}) {
  const t = useT();
  const locked = lockedMs > 0;
  return (
    <div>
      <div className="relative">
        <div className="grid grid-cols-9 gap-1.5 lg:grid-cols-3 lg:gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
            const left = remaining[d] ?? 0;
            return (
              <button
                type="button"
                key={d}
                disabled={disabled || left === 0 || (locked && !notesMode)}
                onClick={() => onDigit(d)}
                className={`flex aspect-[3/4] flex-col items-center justify-center rounded-lg border-2 font-display font-bold transition-colors lg:aspect-[5/4] ${
                  notesMode
                    ? 'border-ink/25 border-dashed bg-paper text-slate hover:border-ink/50'
                    : 'border-transparent bg-ink text-white hover:bg-ink-soft'
                } disabled:opacity-25`}
                aria-label={`${d}`}
              >
                <span className="text-2xl leading-none lg:text-4xl">{d}</span>
                <span className="mt-0.5 font-sans font-semibold text-[10px] opacity-60 tabular">{left}</span>
              </button>
            );
          })}
        </div>
        <AnimatePresence>
          {locked && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center gap-3 overflow-hidden rounded-lg bg-card-red/92 px-3 text-white lg:flex-col lg:gap-0"
              role="alert"
            >
              <span className="font-display font-extrabold text-4xl leading-none tabular lg:text-7xl">
                {Math.ceil(lockedMs / 1000)}
              </span>
              <p className="font-semibold text-sm leading-tight lg:text-center">
                {t('match.locked', { s: Math.ceil(lockedMs / 1000) })}
              </p>
              <motion.div
                className="absolute inset-x-0 bottom-0 h-1.5 bg-white/70"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                style={{ originX: 0 }}
                transition={{ duration: lockedMs / 1000, ease: 'linear' }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleNotes}
          aria-pressed={notesMode}
          className={`rounded-lg px-3 py-2 font-semibold text-sm ${notesMode ? 'bg-card-yellow text-ink' : 'bg-paper text-ink ring-1 ring-rule'}`}
        >
          {t('match.notes')} <kbd className="ml-1 hidden text-xs opacity-60 sm:inline">N</kbd>
        </button>
        <button
          type="button"
          onClick={onClearNotes}
          className="rounded-lg bg-paper px-3 py-2 font-semibold text-ink text-sm ring-1 ring-rule"
        >
          {t('match.erase')}
        </button>
      </div>
    </div>
  );
}

export function OpponentMap({ givens, solved }: { givens: string | null; solved: number[] }) {
  const t = useT();
  const solvedSet = new Set(solved);
  return (
    <div>
      <h3 className="font-sans font-semibold text-sm">{t('match.opponentBoard')}</h3>
      <p className="mb-2 text-slate text-xs">{t('match.opponentBoardHint')}</p>
      <div
        className="grid w-full max-w-[9.5rem] grid-cols-9 gap-[2px] rounded-md bg-ink/80 p-[3px]"
        aria-hidden="true"
      >
        {Array.from({ length: 81 }, (_, i) => {
          const given = givens ? givens[i] !== '0' : false;
          return (
            <motion.span
              key={i}
              className="block aspect-square rounded-[1px]"
              initial={false}
              animate={{ backgroundColor: given ? '#8d99a6' : solvedSet.has(i) ? '#f4f6f1' : '#24385a' }}
              transition={{ duration: 0.3 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function EmoteBar({ onSend }: { onSend(id: EmoteId): void }) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-2 font-sans font-semibold text-sm">{t('match.emotes')}</h3>
      <div className="flex flex-wrap gap-1.5">
        {EMOTES.map((e) => (
          <button
            type="button"
            key={e.id}
            onClick={() => onSend(e.id)}
            className="grid h-10 w-10 place-items-center rounded-lg bg-paper text-xl ring-1 ring-rule hover:ring-ink/40"
            aria-label={e.id}
          >
            {e.glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
