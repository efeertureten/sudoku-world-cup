/**
 * Glicko-2 (Glickman, 2012) applied after every ranked match, treating the
 * match as a one-game rating period. The rating is hidden and used only for
 * matchmaking; players see trophies instead.
 */
export interface GlickoRating {
  rating: number;
  rd: number;
  vol: number;
}

const SCALE = 173.7178;
const TAU = 0.5;
const EPSILON = 0.000001;
const MIN_RD = 30;
const MAX_RD = 350;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

export function expectedScore(player: GlickoRating, opponent: GlickoRating): number {
  const mu = (player.rating - 1500) / SCALE;
  const muJ = (opponent.rating - 1500) / SCALE;
  return 1 / (1 + Math.exp(-g(opponent.rd / SCALE) * (mu - muJ)));
}

/** Returns the player's new rating after one game with score 1 (win), 0.5 (draw) or 0 (loss). */
export function glicko2Update(player: GlickoRating, opponent: GlickoRating, score: number): GlickoRating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const muJ = (opponent.rating - 1500) / SCALE;
  const phiJ = opponent.rd / SCALE;

  const gJ = g(phiJ);
  const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
  const v = 1 / (gJ * gJ * e * (1 - e));
  const delta = v * gJ * (score - e);

  // New volatility via the Illinois variant of regula falsi.
  const a = Math.log(player.vol * player.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const denom = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * denom * denom) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newVol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * gJ * (score - e);

  return {
    rating: Math.round((SCALE * newMu + 1500) * 10) / 10,
    rd: Math.min(MAX_RD, Math.max(MIN_RD, Math.round(SCALE * newPhi * 10) / 10)),
    vol: newVol,
  };
}
