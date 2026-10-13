import { lazy, type ReactNode, Suspense, useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { HomePage } from './features/home/HomePage';
import { MatchPage } from './features/match/MatchPage';
import { LoginPage } from './features/welcome/LoginPage';
import { WelcomePage } from './features/welcome/WelcomePage';
import { useT } from './lib/i18n';
import { useSocketBridge } from './lib/useSocketBridge';
import { useSession } from './stores/session';

// The lobby, the board and sign-up load up front; everything else is fetched on first visit.
const LeaderboardPage = lazy(() =>
  import('./features/leaderboard/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })),
);
const LockerPage = lazy(() =>
  import('./features/locker/LockerPage').then((m) => ({ default: m.LockerPage })),
);
const ProfilePage = lazy(() =>
  import('./features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const ReplayPage = lazy(() =>
  import('./features/replay/ReplayPage').then((m) => ({ default: m.ReplayPage })),
);
const TournamentPage = lazy(() =>
  import('./features/tournament/TournamentPage').then((m) => ({ default: m.TournamentPage })),
);

function PageFallback() {
  const t = useT();
  return <p className="py-16 text-center text-slate">{t('common.loading')}</p>;
}

function SignedIn() {
  useSocketBridge();
  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/match" element={<MatchPage />} />
          <Route path="/cup" element={<TournamentPage />} />
          <Route path="/cup/:id" element={<TournamentPage />} />
          <Route path="/standings" element={<LeaderboardPage />} />
          <Route path="/locker" element={<LockerPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/m/:id" element={<ReplayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

/** Replays are public links; signed-out visitors get them with a slim header and a way in. */
function PublicFrame({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-dvh">
      <header className="bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/welcome" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="font-display font-extrabold text-xl tracking-wide">Sudoku World Cup</span>
          </Link>
          <Link
            to="/welcome"
            className="rounded-md bg-card-yellow px-3 py-1.5 font-semibold text-ink text-sm"
          >
            {t('welcome.submit')}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-10">{children}</main>
    </div>
  );
}

function Gate() {
  const t = useT();
  const { status, bootstrap } = useSession();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'loading') {
    return (
      <div className="pitch grid min-h-dvh place-items-center text-white">
        <p className="font-display font-extrabold text-3xl">{t('common.loading')}</p>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">{t('common.error')}</p>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="mt-3 rounded-md bg-ink px-4 py-2 text-white"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }
  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/m/:id"
          element={
            <PublicFrame>
              <Suspense fallback={<PageFallback />}>
                <ReplayPage />
              </Suspense>
            </PublicFrame>
          }
        />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/welcome" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<SignedIn />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Gate />
    </BrowserRouter>
  );
}
