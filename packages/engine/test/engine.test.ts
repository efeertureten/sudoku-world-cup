import { describe, expect, it } from 'vitest';
import {
  CELLS,
  conflictingCells,
  countGivens,
  countSolutions,
  createRng,
  DIFFICULTIES,
  generatePuzzle,
  generateSolution,
  gradePuzzle,
  isSolvedGrid,
  PEERS,
  parseGrid,
  serializeGrid,
  solve,
  UNITS,
} from '../src';

// A well-known puzzle with a unique solution (singles only).
const EASY = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const EASY_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

describe('codec', () => {
  it('round-trips grids and accepts dots', () => {
    expect(serializeGrid(parseGrid(EASY))).toBe(EASY);
    expect(serializeGrid(parseGrid(EASY.replace(/0/g, '.')))).toBe(EASY);
  });

  it('rejects malformed input', () => {
    expect(() => parseGrid('123')).toThrow();
    expect(() => parseGrid('x'.repeat(81))).toThrow();
  });

  it('builds 27 units and 20 peers per cell', () => {
    expect(UNITS).toHaveLength(27);
    for (const unit of UNITS) expect(new Set(unit).size).toBe(9);
    for (let i = 0; i < CELLS; i++) expect(PEERS[i]).toHaveLength(20);
  });
});

describe('prng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 10 }, () => a.int(1000));
    const sb = Array.from({ length: 10 }, () => b.int(1000));
    const sc = Array.from({ length: 10 }, () => c.int(1000));
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('rejects invalid seeds', () => {
    expect(() => createRng(-1)).toThrow();
    expect(() => createRng(1.5)).toThrow();
    expect(() => createRng(2 ** 32)).toThrow();
  });
});

describe('solver', () => {
  it('solves a known puzzle', () => {
    const solution = solve(parseGrid(EASY));
    expect(solution).not.toBeNull();
    expect(serializeGrid(solution!)).toBe(EASY_SOLUTION);
    expect(isSolvedGrid(solution!)).toBe(true);
  });

  it('counts solutions with an early stop', () => {
    expect(countSolutions(parseGrid(EASY))).toBe(1);
    expect(countSolutions(new Uint8Array(81), 2)).toBe(2);
  });

  it('detects contradictory givens', () => {
    const bad = parseGrid(`55${'0'.repeat(79)}`);
    expect(countSolutions(bad)).toBe(0);
    expect(solve(bad)).toBeNull();
  });

  it('generates valid full grids', () => {
    const rng = createRng(7);
    for (let i = 0; i < 20; i++) expect(isSolvedGrid(generateSolution(rng))).toBe(true);
  });
});

describe('grader', () => {
  it('grades a singles-only puzzle by technique and clue count', () => {
    const grade = gradePuzzle(parseGrid(EASY));
    expect(grade.solvedByLogic).toBe(true);
    expect(['hidden_single', 'naked_single']).toContain(grade.hardest);
    // 30 clues: singles only, but below the 32-clue threshold for "easy".
    expect(grade.difficulty).toBe('medium');
    expect(grade.placementOrder).toHaveLength(81 - countGivens(parseGrid(EASY)));
  });

  it('never places a wrong digit', () => {
    const rng = createRng(99);
    for (let i = 0; i < 15; i++) {
      const p = generatePuzzle(rng.int(2 ** 31), 'hard');
      const grade = gradePuzzle(p.givens);
      for (const cell of grade.placementOrder) expect(grade.values[cell]).toBe(p.solution[cell]);
    }
  });
});

describe('generator', () => {
  it('is deterministic for a seed and difficulty', () => {
    const a = generatePuzzle(123456, 'medium');
    const b = generatePuzzle(123456, 'medium');
    expect(serializeGrid(a.givens)).toBe(serializeGrid(b.givens));
    expect(serializeGrid(a.solution)).toBe(serializeGrid(b.solution));
  });

  it.each(DIFFICULTIES)('produces unique, consistent %s puzzles', (difficulty) => {
    for (const seed of [1, 2, 3]) {
      const p = generatePuzzle(seed * 7919, difficulty);
      expect(p.grade.difficulty).toBe(difficulty);
      expect(countSolutions(p.givens, 2)).toBe(1);
      expect(isSolvedGrid(p.solution)).toBe(true);
      for (let i = 0; i < CELLS; i++) {
        if (p.givens[i] !== 0) expect(p.givens[i]).toBe(p.solution[i]);
      }
    }
  });
});

describe('rules', () => {
  it('flags duplicate digits in a unit', () => {
    const values = parseGrid(EASY);
    expect(conflictingCells(values).size).toBe(0);
    values[2] = 5; // same row as the 5 in cell 0
    const conflicts = conflictingCells(values);
    expect(conflicts.has(0)).toBe(true);
    expect(conflicts.has(2)).toBe(true);
  });
});
