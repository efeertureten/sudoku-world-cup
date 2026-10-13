import { avatarBySlug } from '@swcup/shared';
import { useId } from 'react';

const SHIRT =
  'M21 6 L27 3.5 Q32 8.5 37 3.5 L43 6 L58 14.5 L52.5 27 L46 24 L46 59 L18 59 L18 24 L11.5 27 L6 14.5 Z';

/** Player avatars are football kits drawn from JSON data in /content/avatars. */
export function Jersey({
  slug,
  size = 40,
  className = '',
}: {
  slug: string;
  size?: number;
  className?: string;
}) {
  const { art, name } = avatarBySlug(slug);
  const clip = useId();
  const { primary, secondary, pattern, number } = art;

  let overlay: React.ReactNode = null;
  switch (pattern) {
    case 'stripes':
      overlay = [0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={8 + i * 11} y={0} width={5.5} height={64} fill={secondary} />
      ));
      break;
    case 'pinstripes':
      overlay = Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={6 + i * 4.5} y={0} width={1} height={64} fill={secondary} opacity={0.7} />
      ));
      break;
    case 'hoops':
      overlay = [0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={0} y={14 + i * 10} width={64} height={5} fill={secondary} />
      ));
      break;
    case 'sash':
      overlay = <polygon points="14,4 26,4 52,62 40,62" fill={secondary} />;
      break;
    case 'halves':
      overlay = <rect x={32} y={0} width={32} height={64} fill={secondary} />;
      break;
    case 'checkers':
      overlay = Array.from({ length: 64 }, (_, i) => {
        const x = i % 8;
        const y = Math.floor(i / 8);
        return (x + y) % 2 === 0 ? (
          <rect key={i} x={x * 8} y={y * 8} width={8} height={8} fill={secondary} />
        ) : null;
      });
      break;
    default:
      overlay = null;
  }
  const numberFill = pattern === 'plain' || pattern === 'pinstripes' ? secondary : primary;
  const numberStroke = numberFill === primary ? secondary : primary;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={name.en}>
      <defs>
        <clipPath id={clip}>
          <path d={SHIRT} />
        </clipPath>
      </defs>
      <path d={SHIRT} fill={primary} />
      <g clipPath={`url(#${clip})`}>{overlay}</g>
      <path d="M27 3.5 Q32 8.5 37 3.5 L35 9 Q32 11 29 9 Z" fill={secondary} />
      <text
        x="32"
        y="44"
        textAnchor="middle"
        fontFamily="Big Shoulders Display, sans-serif"
        fontWeight={800}
        fontSize="19"
        fill={numberFill}
        stroke={numberStroke}
        strokeWidth={1.4}
        paintOrder="stroke"
      >
        {number}
      </text>
      <path d={SHIRT} fill="none" stroke="rgba(16,33,58,0.35)" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}
