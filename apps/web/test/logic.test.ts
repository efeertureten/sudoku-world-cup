import { describe, expect, it } from 'vitest';
import { boardAt } from '../src/features/replay/frames';
import { formatClock, formatDuration, reasonKey, signed } from '../src/lib/format';
import { translate } from '../src/lib/i18n';
import { remainingByDigit } from '../src/stores/match';

describe('formatting', () => {
  it('formats match clocks', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65_400)).toBe('01:05');
    expect(formatDuration(65_400)).toBe('01:05.4');
    expect(formatDuration(null)).toBe('—');
    expect(signed(5)).toBe('+5');
    expect(signed(-3)).toBe('-3');
  });
});

describe('i18n', () => {
  it('interpolates placeholders in both languages', () => {
    expect(translate('tr', 'home.greeting', { name: 'Efe' })).toBe('Hazır mısın, Efe?');
    expect(translate('en', 'home.greeting', { name: 'Efe' })).toBe('Ready, Efe?');
  });

  it('uses singular forms in English only', () => {
    expect(translate('en', 'cup.humans', { n: 1 })).toBe('1 player');
    expect(translate('en', 'cup.humans', { n: 3 })).toBe('3 players');
    expect(translate('tr', 'cup.humans', { n: 1 })).toBe('1 oyuncu');
  });

  it('explains how a match ended from the player side', () => {
    expect(reasonKey('timeout', 'draw')).toBe('result.reason.timeout.draw');
    expect(reasonKey('completed', 'draw')).toBe('result.reason.completed.loss');
    expect(reasonKey('mistakes', 'win')).toBe('result.reason.mistakes.win');
  });
});

describe('replay frames', () => {
  const givens = `12${'0'.repeat(79)}`;
  const moves = [
    { cell: 2, value: 3, ok: true, t: 1_000 },
    { cell: 3, value: 9, ok: false, t: 2_000 },
    { cell: 3, value: 4, ok: true, t: 6_000 },
  ];

  it('replays correct digits up to the requested time', () => {
    const frame = boardAt(givens, moves, 6_000);
    expect(frame.values.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(frame).toMatchObject({ filled: 2, mistakes: 1, last: 3, wrong: null });
  });

  it('flashes a wrong digit briefly and never writes it to the board', () => {
    const frame = boardAt(givens, moves, 2_300);
    expect(frame.wrong?.value).toBe(9);
    expect(frame.values[3]).toBe(0);
    expect(boardAt(givens, moves, 0).filled).toBe(0);
  });
});

describe('number pad', () => {
  it('counts how many of each digit can still be placed', () => {
    const board = Array(81).fill(0);
    board[0] = 5;
    board[10] = 5;
    board[20] = 9;
    const remaining = remainingByDigit(board);
    expect(remaining[5]).toBe(7);
    expect(remaining[9]).toBe(8);
    expect(remaining[1]).toBe(9);
  });
});
