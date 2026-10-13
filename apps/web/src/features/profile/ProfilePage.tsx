import type { MatchHistoryEntry, PlayerProfile } from '@swcup/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BotBadge, LeagueBadge, TrophyIcon } from '../../components/Badges';
import { CountryPicker } from '../../components/CountryPicker';
import { Flag } from '../../components/Flag';
import { Jersey } from '../../components/Jersey';
import { ApiError, api } from '../../lib/api';
import { countryName, formatDate, formatDuration, reasonKey, signed } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { useToasts } from '../../stores/lobby';
import { useSession } from '../../stores/session';

function History({ items }: { items: MatchHistoryEntry[] }) {
  const t = useT();
  return (
    <ul className="divide-y divide-rule rounded-xl bg-paper ring-1 ring-rule">
      {items.map((m) => (
        <li key={m.matchId}>
          <Link
            to={`/m/${m.matchId}`}
            className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-chalk"
          >
            <span
              className={`h-8 w-1.5 shrink-0 rounded-full ${m.result === 'win' ? 'bg-turf' : m.result === 'loss' ? 'bg-card-red' : 'bg-slate'}`}
              title={t(`result.${m.result}`)}
            >
              <span className="sr-only">{t(`result.${m.result}`)}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate font-semibold">
                <Flag code={m.opponent.countryCode} size="sm" />
                {t('profile.vs', { name: m.opponent.username })}
                {m.opponent.isBot && <BotBadge />}
              </span>
              <span className="text-slate text-xs">
                {t(`difficulty.${m.difficulty}`)}. {t(reasonKey(m.reason, m.result))}
              </span>
            </span>
            <span className="tabular">{formatDuration(m.finishTimeMs)}</span>
            <span
              className={`w-10 text-right font-semibold tabular ${m.trophiesDelta >= 0 ? 'text-turf' : 'text-card-red'}`}
            >
              {m.type === 'ranked' ? signed(m.trophiesDelta) : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AccountForms() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const me = useSession((s) => s.me)!;
  const setMe = useSession((s) => s.setMe);
  const logout = useSession((s) => s.logout);
  const push = useToasts((s) => s.push);
  const navigate = useNavigate();
  const [country, setCountry] = useState(me.countryCode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const run = async (fn: () => Promise<typeof me>) => {
    try {
      setMe(await fn());
    } catch (err) {
      push(err instanceof ApiError ? err.message : t('common.error'), 'error');
    }
  };

  const register = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.register({ email, password }));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl bg-paper p-5 ring-1 ring-rule">
        <h2 className="text-2xl">{t('profile.changeCountry')}</h2>
        <p className="mb-3 text-slate text-sm">
          {me.countryChangeAvailableAt
            ? t('profile.countryCooldown', { date: formatDate(me.countryChangeAvailableAt, locale) })
            : t('profile.countryNote')}
        </p>
        <CountryPicker value={country} onChange={setCountry} />
        <button
          type="button"
          disabled={country === me.countryCode || Boolean(me.countryChangeAvailableAt)}
          onClick={() => void run(() => api.updateMe({ countryCode: country }))}
          className="mt-3 rounded-md bg-ink px-4 py-2 font-semibold text-sm text-white disabled:opacity-40"
        >
          {t('profile.save')} ({countryName(country, locale)})
        </button>
      </section>
      <section className="rounded-xl bg-paper p-5 ring-1 ring-rule">
        {me.isGuest ? (
          <form onSubmit={register} className="space-y-3">
            <h2 className="text-2xl">{t('profile.saveAccount')}</h2>
            <p className="text-slate text-sm">{t('profile.saveAccountDesc')}</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('profile.email')}
              aria-label={t('profile.email')}
              autoComplete="email"
              className="w-full rounded-lg border border-rule px-3 py-2 outline-none focus:border-turf"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('profile.password')}
              aria-label={t('profile.password')}
              autoComplete="new-password"
              className="w-full rounded-lg border border-rule px-3 py-2 outline-none focus:border-turf"
            />
            <button
              type="submit"
              disabled={!email || password.length < 8}
              className="rounded-md bg-turf px-4 py-2 font-semibold text-sm text-white disabled:opacity-40"
            >
              {t('profile.save')}
            </button>
          </form>
        ) : (
          <div>
            <h2 className="text-2xl">{me.email}</h2>
          </div>
        )}
        <button
          type="button"
          onClick={() => void logout().then(() => navigate('/welcome'))}
          className="mt-5 font-semibold text-card-red text-sm hover:underline"
        >
          {t('profile.logout')}
        </button>
      </section>
    </div>
  );
}

export function ProfilePage() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const { username } = useParams();
  const me = useSession((s) => s.me)!;
  const target = username ?? me.username;
  const isMe = target.toLowerCase() === me.username.toLowerCase();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [missing, setMissing] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when my own stats change after a match
  useEffect(() => {
    setProfile(null);
    setMissing(false);
    api
      .profile(target)
      .then(setProfile)
      .catch(() => setMissing(true));
  }, [target, me.trophies, me.countryCode]);

  if (missing) return <p className="text-slate">{t('common.error')}</p>;
  if (!profile) return <p className="text-slate">{t('common.loading')}</p>;

  const stats: [string, string | number][] = [
    [t('profile.wins'), profile.wins],
    [t('profile.losses'), profile.losses],
    [t('profile.streak'), profile.winStreak],
    [t('profile.best'), formatDuration(profile.bestTimeMs)],
    [t('profile.cups'), profile.tournamentWins],
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-5 rounded-xl bg-ink p-6 text-white">
        <span className="grid h-24 w-24 place-items-center rounded-full bg-chalk">
          <Jersey slug={profile.avatar} size={78} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-3 text-5xl">
            {profile.username}
            {profile.isBot && <BotBadge />}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-white/85">
            <span className="flex items-center gap-2">
              <Flag code={profile.countryCode} />
              {countryName(profile.countryCode, locale)}
            </span>
            <span className="rounded-md bg-chalk px-2 py-0.5">
              <LeagueBadge league={profile.league} />
            </span>
            <span className="flex items-center gap-1 font-display font-bold text-2xl text-card-yellow tabular">
              <TrophyIcon className="h-5 w-5" />
              {profile.trophies}
            </span>
          </p>
          <p className="mt-1 text-sm text-white/60">
            {t('profile.member', { date: formatDate(profile.createdAt, locale) })}
          </p>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-rule ring-1 ring-rule sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-paper px-4 py-3">
            <dt className="text-slate text-xs">{label}</dt>
            <dd className="font-display font-extrabold text-3xl tabular">{value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-3 text-2xl">{t('profile.history')}</h2>
        {profile.recentMatches.length === 0 ? (
          <p className="text-slate text-sm">{t('home.noMatches')}</p>
        ) : (
          <History items={profile.recentMatches} />
        )}
      </section>

      {isMe && <AccountForms />}
    </div>
  );
}
