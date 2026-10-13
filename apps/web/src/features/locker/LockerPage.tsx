import { AVATARS, BOARD_THEMES, type BoardTheme, type Cosmetic, type CosmeticListing } from '@swcup/shared';
import { useEffect, useState } from 'react';
import { CoinIcon } from '../../components/Badges';
import { Jersey } from '../../components/Jersey';
import { ApiError, api } from '../../lib/api';
import { type MessageKey, useLocale, useT } from '../../lib/i18n';
import { useToasts } from '../../stores/lobby';
import { useSession } from '../../stores/session';

function ThemePreview({ theme }: { theme: BoardTheme }) {
  const c = theme.colors;
  const digits = [5, 0, 3, 0, 7, 0, 9, 0, 1];
  return (
    <div
      className="grid aspect-square w-full grid-cols-3 gap-[2px] rounded-md p-[3px]"
      style={{ backgroundColor: c.frame }}
    >
      {digits.map((d, i) => (
        <span
          key={i}
          className="grid place-items-center font-display font-bold text-xl"
          style={{
            backgroundColor: i === 4 ? c.accent : i % 2 ? c.cellAlt : c.cell,
            color: i === 4 || i === 8 ? c.input : c.given,
          }}
        >
          {d || ''}
        </span>
      ))}
    </div>
  );
}

function requirement(
  item: Cosmetic,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string | null {
  const u = item.unlock;
  if (u.type === 'trophies') return t('locker.req.trophies', { v: u.value });
  if (u.type === 'wins') return t('locker.req.wins', { v: u.value });
  if (u.type === 'tournament_wins') return t('locker.req.tournament_wins');
  return null;
}

export function LockerPage() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const me = useSession((s) => s.me)!;
  const setMe = useSession((s) => s.setMe);
  const push = useToasts((s) => s.push);
  const [listing, setListing] = useState<CosmeticListing[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch ownership after equipping or buying
  useEffect(() => {
    api
      .cosmetics()
      .then(setListing)
      .catch(() => undefined);
  }, [me.theme, me.avatar, me.coins]);

  const act = async (fn: () => Promise<typeof me>) => {
    try {
      setMe(await fn());
    } catch (err) {
      push(err instanceof ApiError ? err.message : t('common.error'), 'error');
    }
  };

  const card = (item: Cosmetic, art: React.ReactNode) => {
    const state = listing.find((l) => l.slug === item.slug);
    const req = requirement(item, t);
    return (
      <li key={item.slug} className="flex flex-col rounded-xl bg-paper p-3 ring-1 ring-rule">
        <div className={state?.owned ? '' : 'opacity-55 grayscale-[35%]'}>{art}</div>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <h3 className="font-sans font-semibold text-base">{item.name[locale]}</h3>
          <span className="text-slate text-xs">{t(`rarity.${item.rarity}`)}</span>
        </div>
        <div className="mt-auto pt-3">
          {state?.equipped ? (
            <span className="block rounded-md bg-turf py-2 text-center font-semibold text-sm text-white">
              {t('locker.equipped')}
            </span>
          ) : state?.owned ? (
            <button
              type="button"
              onClick={() => void act(() => api.equip(item.slug))}
              className="w-full rounded-md bg-ink py-2 font-semibold text-sm text-white hover:bg-ink-soft"
            >
              {t('locker.equip')}
            </button>
          ) : state?.price ? (
            <button
              type="button"
              disabled={me.coins < state.price}
              onClick={() => void act(() => api.purchase(item.slug))}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-card-yellow py-2 font-semibold text-ink text-sm disabled:opacity-50"
            >
              <CoinIcon />
              {t('locker.buy', { price: state.price })}
            </button>
          ) : (
            <span className="block py-2 text-center text-slate text-sm">{req}</span>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-5xl">{t('locker.title')}</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 font-semibold ring-1 ring-rule">
          <CoinIcon />
          {t('locker.coins', { n: me.coins })}
        </span>
      </div>
      <section>
        <h2 className="mb-3 text-3xl">{t('locker.themes')}</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {BOARD_THEMES.map((theme) => card(theme, <ThemePreview theme={theme} />))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-3xl">{t('locker.avatars')}</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {AVATARS.map((avatar) =>
            card(
              avatar,
              <div className="grid place-items-center rounded-md bg-chalk py-3">
                <Jersey slug={avatar.slug} size={88} />
              </div>,
            ),
          )}
        </ul>
      </section>
    </div>
  );
}
