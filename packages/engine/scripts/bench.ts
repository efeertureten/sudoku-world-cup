/**
 * Measures generation speed and difficulty distribution.
 * Usage: pnpm --filter @swcup/engine bench [countPerDifficulty]
 */
import { DIFFICULTIES, generatePuzzle } from '../src';

const count = Number(process.argv[2] ?? 20);
for (const difficulty of DIFFICULTIES) {
  const started = performance.now();
  const givens: number[] = [];
  let misses = 0;
  for (let i = 0; i < count; i++) {
    const p = generatePuzzle(Math.floor(Math.random() * 2 ** 32), difficulty);
    givens.push(p.givensCount);
    if (p.grade.difficulty !== difficulty) misses++;
  }
  const ms = performance.now() - started;
  const avgGivens = givens.reduce((a, b) => a + b, 0) / givens.length;
  console.log(
    `${difficulty.padEnd(7)} ${(ms / count).toFixed(1).padStart(7)} ms/puzzle  avg givens ${avgGivens.toFixed(1)}  misses ${misses}`,
  );
}
