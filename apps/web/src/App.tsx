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
const PracticePage = lazy(() =>
  import('./features/practice/PracticePage').then((m) => ({ default: m.PracticePage })),
);
const ReplayPage = lazy(() =>
  import('./features/replay/ReplayPage').then((m) => ({ default: m.ReplayPage })),
);
const TournamentPage = lazy(() =>
  import('./features/tournament/TournamentPage').then((m) => ({ default: m.TournamentPage })),
);

/** True for the GitHub Pages build, which ships the client only (see .github/workflows/pages.yml). */
const isStaticBuild = import.meta.env.VITE_STATIC === 'true';

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
          <Route path="/practice" element={<PracticePage />} />
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

/** Replays and solo practice work without an account; this is their slim header. */
function PublicFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const status = useSession((s) => s.status);
  return (
    <div className="min-h-dvh">
      <header className="bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to={status === 'anonymous' ? '/welcome' : '/practice'} className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
            <span className="font-display font-extrabold text-xl tracking-wide">Sudoku World Cup</span>
          </Link>
          {status === 'anonymous' && (
            <Link
              to="/welcome"
              className="rounded-md bg-card-yellow px-3 py-1.5 font-semibold text-ink text-sm"
            >
              {t('welcome.submit')}
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-10">{children}</main>
    </div>
  );
}

/** Solo practice needs no server, so it is reachable while loading, offline and signed out. */
function practiceRoute() {
  return (
    <Route
      path="/practice"
      element={
        <PublicFrame>
          <Suspense fallback={<PageFallback />}>
            <PracticePage />
          </Suspense>
        </PublicFrame>
      }
    />
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
      <Routes>
        {practiceRoute()}
        <Route
          path="*"
          element={
            <div className="pitch grid min-h-dvh place-items-center text-white">
              <p className="font-display font-extrabold text-3xl">{t('common.loading')}</p>
            </div>
          }
        />
      </Routes>
    );
  }
  if (status === 'error') {
    return (
      <Routes>
        {practiceRoute()}
        <Route
          path="*"
          element={
            <div className="pitch grid min-h-dvh place-items-center p-6 text-center text-white">
              <div className="max-w-md">
                <h1 className="text-5xl">Sudoku World Cup</h1>
                <p className="mt-4 text-white/85">
                  {t(isStaticBuild ? 'common.staticDemo' : 'common.serverDown')}
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    to="/practice"
                    className="rounded-lg bg-card-yellow px-6 py-3 font-display font-extrabold text-2xl text-ink"
                  >
                    {t('practice.link')}
                  </Link>
                  {!isStaticBuild && (
                    <button
                      type="button"
                      onClick={() => void bootstrap()}
                      className="rounded-lg px-4 py-3 font-semibold text-white ring-1 ring-white/40 hover:bg-white/10"
                    >
                      {t('common.retry')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          }
        />
      </Routes>
    );
  }
  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/login" element={<LoginPage />} />
        {practiceRoute()}
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
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Gate />
    </BrowserRouter>
  );
}
