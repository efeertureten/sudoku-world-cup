import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useSession } from '../../stores/session';

export function LoginPage() {
  const t = useT();
  const setMe = useSession((s) => s.setMe);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMe(await api.login({ login, password }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pitch flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl bg-chalk p-7 shadow-xl">
        <h1 className="text-4xl">{t('login.title')}</h1>
        <div>
          <label htmlFor="login" className="mb-1 block font-semibold text-sm">
            {t('login.login')}
          </label>
          <input
            id="login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            className="w-full rounded-lg border border-rule bg-paper px-3 py-2.5 outline-none focus:border-turf"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block font-semibold text-sm">
            {t('login.password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-rule bg-paper px-3 py-2.5 outline-none focus:border-turf"
          />
        </div>
        {error && (
          <p className="rounded-md bg-card-red/10 px-3 py-2 font-medium text-card-red text-sm" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !login || !password}
          className="w-full rounded-lg bg-ink py-3 font-semibold text-white disabled:opacity-50"
        >
          {t('login.submit')}
        </button>
        <Link to="/welcome" className="block text-center font-semibold text-sm text-turf hover:underline">
          {t('login.guest')}
        </Link>
      </form>
    </div>
  );
}
