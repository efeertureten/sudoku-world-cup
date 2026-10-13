import { PEERS } from '@swcup/engine/codec';
import type { BoardTheme } from '@swcup/shared';
import { motion } from 'motion/react';
import { memo } from 'react';

interface BoardProps {
  givens: string;
  board: number[];
  notes: number[];
  pending: Record<number, number>;
  selected: number | null;
  /** Only while the wrong digit should flash. */
  wrong: { cell: number; value: number; at: number } | null;
  lastCorrect: { cell: number; at: number } | null;
  locked: boolean;
  theme: BoardTheme['colors'];
  onSelect(cell: number): void;
}

const ROW_NAMES = 'ABCDEFGHI';

/** Nested 3x3 grids so box borders come from the gap colour, not per-cell borders. */
export const Board = memo(function Board(props: BoardProps) {
  const { givens, board, notes, pending, selected, wrong, lastCorrect, locked, theme, onSelect } = props;
  const selectedValue = selected !== null ? board[selected] : 0;
  const peers = selected !== null ? new Set(PEERS[selected]) : new Set<number>();
  const showWrong = wrong;

  const cell = (i: number) => {
    const isGiven = givens[i] !== '0';
    const value = board[i]!;
    const pendingValue = pending[i];
    const isSelected = selected === i;
    const isWrong = showWrong?.cell === i;
    let bg = Math.floor(i / 27) % 2 === Math.floor((i % 9) / 3) % 2 ? theme.cell : theme.cellAlt;
    if (selectedValue && value === selectedValue) bg = theme.same;
    else if (peers.has(i)) bg = theme.peer;
    if (isSelected) bg = theme.accent;

    const label = `${ROW_NAMES[Math.floor(i / 9)]}${(i % 9) + 1}${value ? `, ${value}` : ''}`;
    return (
      <motion.button
        type="button"
        key={i}
        onClick={() => onSelect(i)}
        aria-label={label}
        aria-pressed={isSelected}
        animate={isWrong ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.35 }}
        className="relative grid aspect-square place-items-center font-display text-[clamp(1.15rem,4.6vw,2rem)] leading-none outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset"
        style={{ backgroundColor: bg }}
      >
        {value !== 0 ? (
          <motion.span
            key={`${i}-${value}`}
            initial={!isGiven && lastCorrect?.cell === i ? { scale: 1.6, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
            style={{ color: isGiven ? theme.given : theme.input, fontWeight: isGiven ? 800 : 600 }}
          >
            {value}
          </motion.span>
        ) : pendingValue !== undefined ? (
          <span className="animate-pulse" style={{ color: theme.input, opacity: 0.5, fontWeight: 600 }}>
            {pendingValue}
          </span>
        ) : isWrong ? (
          <span style={{ color: theme.error, fontWeight: 700 }}>{showWrong.value}</span>
        ) : notes[i] ? (
          <span className="grid h-full w-full grid-cols-3 grid-rows-3 p-[6%] font-sans" aria-hidden="true">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <span
                key={d}
                className="grid place-items-center text-[clamp(0.45rem,1.45vw,0.72rem)] leading-none"
                style={{ color: theme.note, fontWeight: selectedValue === d ? 800 : 500 }}
              >
                {notes[i]! & (1 << (d - 1)) ? d : ''}
              </span>
            ))}
          </span>
        ) : null}
        {isSelected && locked && (
          <span
            className="absolute inset-0 border-2"
            style={{ borderColor: theme.error }}
            aria-hidden="true"
          />
        )}
      </motion.button>
    );
  };

  return (
    <div
      className="grid aspect-square w-full grid-cols-3 gap-[3px] rounded-lg p-[3px] shadow-[0_10px_30px_-12px_rgba(16,33,58,0.45)]"
      style={{ backgroundColor: theme.frame }}
      role="grid"
      aria-label="Sudoku"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((box) => {
        const r0 = Math.floor(box / 3) * 3;
        const c0 = (box % 3) * 3;
        return (
          <div key={box} className="grid grid-cols-3 gap-px" style={{ backgroundColor: theme.line }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => cell((r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)))}
          </div>
        );
      })}
    </div>
  );
});
