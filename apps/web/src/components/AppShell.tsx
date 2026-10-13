import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { type MessageKey, useLocale, useT } from '../lib/i18n';
import { useToasts } from '../stores/lobby';
import { useMatch } from '../stores/match';
import { useSession } from '../stores/session';
import { CoinIcon, TrophyIcon } from './Badges';
import { Flag } from './Flag';
import { Jersey } from './Jersey';
import { QueueSheet } from './QueueSheet';

const NAV: { to: string; key: MessageKey; icon: ReactNode }[] = [
  {
    to: '/',
    key: 'nav.play',
    icon: <path d="M4 3h12v12H4zM4 7h12M4 11h12M8 3v12M12 3v12" />,
  },
  {
    to: '/cup',
    key: 'nav.cup',
    icon: <path d="M3 4h4v4H3zM3 12h4v4H3zM7 6h3v8H7M10 10h3M13 8h4v4h-4z" />,
  },
  {
    to: '/standings',
    key: 'nav.standings',
    icon: <path d="M3 16V9h4v7M8 16V4h4v12M13 16v-5h4v5M2 16h16" />,
  },
  {
    to: '/locker',
    key: 'nav.locker',
    icon: <path d="M6 2l-4 3 2 4 2-1v10h8V8l2 1 2-4-4-3c-.5 1.5-2 2.5-4 2.5S6.5 3.5 6 2z" />,
  },
  {
    to: '/profile',
    key: 'nav.profile',
    icon: <path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 18c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />,
  },
];

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const me = useSession((s) => s.me);
  const connected = useSession((s) => s.connected);
  const { locale, setLocale } = useLocale();
  const phase = useMatch((s) => s.phase);
  const inMatch = phase === 'playing' || phase === 'countdown' || phase === 'found';
  const toasts = useToasts((s) => s.toasts);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2.5" aria-label="Sudoku World Cup">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="font-display font-extrabold text-xl tracking-wide">Sudoku World Cup</span>
          </NavLink>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.slice(0, 4).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 font-semibold text-sm transition-colors ${
                    isActive ? 'bg-white/12 text-card-yellow' : 'text-white/80 hover:text-white'
                  }`
                }
              >
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLocale(locale === 'tr' ? 'en' : 'tr')}
              className="rounded-md px-2 py-1 font-semibold text-white/70 text-xs hover:text-white"
            >
              {t('nav.language')}
            </button>
            {me && (
              <NavLink
                to="/profile"
                className="flex items-center gap-2 rounded-full bg-white/8 py-1 pr-3 pl-1 hover:bg-white/14"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-chalk">
                  <Jersey slug={me.avatar} size={26} />
                </span>
                <span className="hidden flex-col leading-tight sm:flex">
                  <span className="flex items-center gap-1.5 font-semibold text-sm">
                    <Flag code={me.countryCode} size="sm" />
                    {me.username}
                  </span>
                  <span className="flex items-center gap-2 text-white/75 text-xs tabular">
                    <span className="flex items-center gap-0.5 text-card-yellow">
                      <TrophyIcon className="h-3 w-3" />
                      {me.trophies}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <CoinIcon className="h-3 w-3" />
                      {me.coins}
                    </span>
                  </span>
                </span>
              </NavLink>
            )}
          </div>
        </div>
        {!connected && me && (
          <div className="bg-card-red px-4 py-1 text-center font-semibold text-sm text-white" role="status">
            {t('common.offline')}
          </div>
        )}
      </header>

      <main className={`mx-auto w-full max-w-6xl flex-1 px-4 pt-5 ${inMatch ? 'pb-6' : 'pb-24 md:pb-10'}`}>
        {children}
      </main>

      {!inMatch && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-rule border-t bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
          aria-label="Main"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 font-semibold text-[11px] ${isActive ? 'text-turf' : 'text-slate'}`
              }
            >
              <NavIcon>{item.icon}</NavIcon>
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      )}

      <QueueSheet />

      <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              className={`pointer-events-auto rounded-md px-4 py-2 font-semibold text-sm shadow-lg ${
                toast.tone === 'error' ? 'bg-card-red text-white' : 'bg-ink text-white'
              }`}
            >
              {toast.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
