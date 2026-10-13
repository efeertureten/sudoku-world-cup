import { COUNTRY_CODES } from '@swcup/shared';
import { useMemo, useState } from 'react';
import { countryName } from '../lib/format';
import { useLocale, useT } from '../lib/i18n';
import { Flag } from './Flag';

export function guessCountry(): string {
  const region = navigator.language.split('-')[1]?.toUpperCase();
  return region && (COUNTRY_CODES as readonly string[]).includes(region) ? region : 'TR';
}

/** Searchable country list; names are localized with Intl.DisplayNames. */
export function CountryPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const collator = new Intl.Collator(locale);
    return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
      collator.compare(a.name, b.name),
    );
  }, [locale]);

  const q = query.trim().toLocaleLowerCase(locale);
  const filtered = q
    ? options.filter((o) => o.name.toLocaleLowerCase(locale).includes(q) || o.code.toLowerCase() === q)
    : options;

  return (
    <div className="rounded-lg border border-rule bg-paper">
      <div className="flex items-center gap-3 border-rule border-b px-3 py-2.5">
        <Flag code={value} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{countryName(value, locale)}</div>
          <input
            id={id}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('welcome.countrySearch')}
            className="w-full bg-transparent text-slate text-sm outline-none placeholder:text-slate/70"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto p-1" role="listbox" aria-label={t('welcome.country')}>
        {filtered.map((o) => (
          <button
            type="button"
            key={o.code}
            role="option"
            aria-selected={o.code === value}
            onClick={() => {
              onChange(o.code);
              setQuery('');
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${
              o.code === value ? 'bg-turf text-white' : 'hover:bg-chalk'
            }`}
          >
            <Flag code={o.code} size="sm" decorative />
            <span className="truncate">{o.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
