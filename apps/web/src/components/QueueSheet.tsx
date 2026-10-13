import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { formatClock } from '../lib/format';
import { useT } from '../lib/i18n';
import { useQueue } from '../stores/lobby';
import { useSession } from '../stores/session';

/** Bottom sheet shown while matchmaking: elapsed time, widening range, bot countdown. */
export function QueueSheet() {
  const t = useT();
  const { mode, queuedAt, status, leave } = useQueue();
  const fallbackMs = useSession((s) => s.meta?.tunables.botFallbackMs ?? 5000);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!queuedAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [queuedAt]);

  const elapsed = queuedAt ? Math.max(0, now - queuedAt) : 0;
  const botIn = Math.max(0, Math.ceil((fallbackMs - elapsed) / 1000));
  const range = status?.searchRange ?? 50;

  return (
    <AnimatePresence>
      {mode && queuedAt && (
        <motion.section
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          className="fixed inset-x-0 bottom-0 z-40 border-card-yellow border-t-4 bg-ink px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-3xl items-center gap-5">
            <div className="relative h-12 w-12 shrink-0" aria-hidden="true">
              <span className="absolute inset-0 animate-ping rounded-full bg-card-yellow/30" />
              <span className="absolute inset-2 rounded-full bg-card-yellow" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl">{t('queue.searching')}</h2>
                <span className="font-display font-bold text-2xl text-card-yellow tabular">
                  {formatClock(elapsed)}
                </span>
              </div>
              <p className="text-sm text-white/75">
                {t('queue.range', { range })}.{' '}
                {botIn > 0 ? t('queue.botSoon', { s: botIn }) : t('queue.botNow')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void leave()}
              className="shrink-0 rounded-md border border-white/30 px-4 py-2 font-semibold text-sm hover:bg-white/10"
            >
              {t('queue.cancel')}
            </button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
