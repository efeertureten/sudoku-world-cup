import { countryName } from '../lib/format';
import { useLocale } from '../lib/i18n';

interface FlagProps {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Decorative when the country name is already written next to it. */
  decorative?: boolean;
}

const SIZES = { sm: 'h-3 w-4', md: 'h-4 w-[1.375rem]', lg: 'h-7 w-10' };

export function Flag({ code, size = 'md', className = '', decorative = false }: FlagProps) {
  const locale = useLocale((s) => s.locale);
  const classes = `fi fi-${code.toLowerCase()} inline-block shrink-0 rounded-[2px] bg-cover shadow-[0_0_0_1px_rgba(16,33,58,0.15)] ${SIZES[size]} ${className}`;
  if (decorative) return <span className={classes} aria-hidden="true" />;
  return <span className={classes} role="img" aria-label={countryName(code, locale)} />;
}
