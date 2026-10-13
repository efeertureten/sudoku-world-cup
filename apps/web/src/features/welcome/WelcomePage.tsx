import { usernameSchema } from '@swcup/shared';
import { motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { CountryPicker, guessCountry } from '../../components/CountryPicker';
import { ApiError, api } from '../../lib/api';
import { useLocale, useT } from '../../lib/i18n';
import { useSession } from '../../stores/session';

/** A tiny 4x4 race preview: two boards filling in, the idea of the game at a glance. */
function RacePreview() {
  const left = [0, 5, 2, 7, 9, 12, 14, 3, 11];
  const right = [1, 6, 8, 4, 13, 15, 10];
  const board = (filled: number[], delayBase: number, color: string) => (
    <div className="grid grid-cols-4 gap-1 rounded-md bg-white/10 p-1.5">
      {Array.from({ length: 16 }, (_, i) => (
        <motion.span
          key={i}
          className="block h-6 w-6 rounded-[3px] sm:h-8 sm:w-8"
          initial={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
          animate={{ backgroundColor: filled.includes(i) ? color : 'rgba(255,255,255,0.14)' }}
          transition={{ delay: delayBase + filled.indexOf(i) * 0.35, duration: 0.25 }}
        />
      ))}
    </div>
  );
  return (
    <div className="flex items-center gap-4" aria-hidden="true">
      {board(left, 0.4, '#f6c915')}
      <span className="font-display font-extrabold text-2xl text-white/80">vs</span>
      {board(right, 0.6, '#f4f6f1')}
    </div>
  );
}

export function WelcomePage() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const setMe = useSession((s) => s.setMe);
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState(guessCountry);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const check = usernameSchema.safeParse(username);
    if (!check.success) {
      setError(t('welcome.usernameHint'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setMe(await api.guest({ username: check.data, countryCode: country }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="pitch relative flex flex-col justify-between gap-10 overflow-hidden px-6 py-8 text-white sm:px-12 sm:py-12">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span className="font-display font-extrabold text-xl tracking-wide">Sudoku World Cup</span>
          </span>
          <button
            type="button"
            onClick={() => setLocale(locale === 'tr' ? 'en' : 'tr')}
            className="rounded-md px-2 py-1 font-semibold text-sm text-white/80 hover:text-white"
          >
            {t('nav.language')}
          </button>
        </div>
        <div className="max-w-xl">
          <h1 className="text-[clamp(3.5rem,9vw,7rem)] leading-[0.85]">{t('welcome.title')}</h1>
          <p className="mt-5 max-w-md text-lg text-white/90">{t('welcome.lead')}</p>
          <div className="mt-8">
            <RacePreview />
          </div>
        </div>
        <ul className="grid gap-2 text-sm text-white/85 sm:grid-cols-3">
          {(['welcome.rule1', 'welcome.rule2', 'welcome.rule3'] as const).map((key, i) => (
            <li key={key} className="flex gap-2">
              <span
                aria-hidden="true"
                className={`mt-1 block h-4 w-3 shrink-0 rounded-[2px] ${i === 1 ? 'bg-card-red' : i === 0 ? 'bg-card-yellow' : 'bg-white/70'}`}
              />
              {t(key)}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-center justify-center bg-chalk px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" noValidate>
          <div>
            <label htmlFor="username" className="mb-1.5 block font-semibold">
              {t('welcome.username')}
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="nickname"
              maxLength={20}
              className="w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-lg outline-none focus:border-turf"
              aria-describedby="username-hint"
            />
            <p id="username-hint" className="mt-1 text-slate text-sm">
              {t('welcome.usernameHint')}
            </p>
          </div>
          <div>
            <label htmlFor="country-search" className="mb-1.5 block font-semibold">
              {t('welcome.country')}
            </label>
            <CountryPicker id="country-search" value={country} onChange={setCountry} />
          </div>
          {error && (
            <p className="rounded-md bg-card-red/10 px-3 py-2 font-medium text-card-red text-sm" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-card-yellow py-3.5 font-display font-extrabold text-2xl text-ink transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-60"
          >
            {t('welcome.submit')}
          </button>
          <p className="text-center text-slate text-sm">
            {t('welcome.haveAccount')}{' '}
            <Link to="/login" className="font-semibold text-turf underline-offset-2 hover:underline">
              {t('welcome.login')}
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
