import { describe, expect, it } from 'vitest';
import {
  createGame,
  eraseCell,
  giveHint,
  isGiven,
  isSolved,
  placeDigit,
  remainingDigits,
  suggestCell,
  toggleNote,
  undoMove,
} from '../src/lib/practice';

const emptyCell = (g: ReturnType<typeof createGame>) => g.board.indexOf(0);

describe('practice game', () => {
  it('creates a playable puzzle whose givens match the solution', () => {
    const g = createGame('medium', 12345);
    expect(g.board).toHaveLength(81);
    expect(g.done).toBe(false);
    for (let i = 0; i < 81; i++) {
      if (isGiven(g, i)) expect(g.board[i]).toBe(Number(g.solution[i]));
      else expect(g.board[i]).toBe(0);
    }
  });

  it('is deterministic for a given seed and difficulty', () => {
    expect(createGame('hard', 99).givens).toBe(createGame('hard', 99).givens);
  });

  it('rejects a wrong digit, counts a mistake and leaves the cell empty', () => {
    const g = createGame('easy', 7);
    const cell = emptyCell(g);
    const wrong = (Number(g.solution[cell]) % 9) + 1;
    const { game, result } = placeDigit(g, cell, wrong);
    expect(result).toBe('wrong');
    expect(game.mistakes).toBe(1);
    expect(game.board[cell]).toBe(0);
  });

  it('places the right digit and removes it from peer notes', () => {
    let g = createGame('easy', 7);
    const cell = emptyCell(g);
    const digit = Number(g.solution[cell]);
    const peer = g.board.findIndex((v, i) => v === 0 && i !== cell && i % 9 === cell % 9);
    g = toggleNote(g, peer, digit).game;
    expect(g.notes[peer]! & (1 << (digit - 1))).not.toBe(0);
    const placed = placeDigit(g, cell, digit);
    expect(placed.result).toBe('placed');
    expect(placed.game.board[cell]).toBe(digit);
    expect(placed.game.notes[peer]! & (1 << (digit - 1))).toBe(0);
  });

  it('undo restores both the digit and the peer notes it cleared', () => {
    let g = createGame('easy', 7);
    const cell = emptyCell(g);
    const digit = Number(g.solution[cell]);
    const peer = g.board.findIndex((v, i) => v === 0 && i !== cell && i % 9 === cell % 9);
    g = toggleNote(g, peer, digit).game;
    const before = g;
    const after = undoMove(placeDigit(g, cell, digit).game);
    expect(after.board).toEqual(before.board);
    expect(after.notes).toEqual(before.notes);
  });

  it('toggles notes on and off and erases them', () => {
    let g = createGame('easy', 7);
    const cell = emptyCell(g);
    g = toggleNote(g, cell, 3).game;
    expect(g.notes[cell]).toBe(1 << 2);
    g = toggleNote(g, cell, 3).game;
    expect(g.notes[cell]).toBe(0);
    g = toggleNote(g, cell, 5).game;
    expect(eraseCell(g, cell).notes[cell]).toBe(0);
  });

  it('never changes a given or an already filled cell', () => {
    const g = createGame('easy', 7);
    const given = g.board.findIndex((v) => v !== 0);
    expect(placeDigit(g, given, 1).result).toBe('ignored');
    expect(toggleNote(g, given, 1).result).toBe('ignored');
    expect(giveHint(g, given).result).toBe('ignored');
  });

  it('counts a hint and fills the right digit', () => {
    const g = createGame('easy', 7);
    const cell = emptyCell(g);
    const { game } = giveHint(g, cell);
    expect(game.hints).toBe(1);
    expect(game.board[cell]).toBe(Number(g.solution[cell]));
  });

  it('can be solved to completion and then stops accepting moves', () => {
    let g = createGame('easy', 2024);
    for (let guard = 0; guard < 81 && !g.done; guard++) {
      const cell = suggestCell(g)!;
      g = placeDigit(g, cell, Number(g.solution[cell])).game;
    }
    expect(g.done).toBe(true);
    expect(isSolved(g)).toBe(true);
    expect(g.mistakes).toBe(0);
    expect(placeDigit(g, 0, 1).result).toBe('ignored');
    expect(
      remainingDigits(g.board)
        .slice(1)
        .every((n) => n === 0),
    ).toBe(true);
  });
});
