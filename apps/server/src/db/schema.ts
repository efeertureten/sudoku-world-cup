import { DIFFICULTIES, MATCH_END_REASONS, MATCH_TYPES } from '@swcup/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const difficultyEnum = pgEnum('difficulty', DIFFICULTIES);
export const matchTypeEnum = pgEnum('match_type', MATCH_TYPES);
export const matchEndReasonEnum = pgEnum('match_end_reason', MATCH_END_REASONS);
export const matchResultEnum = pgEnum('match_result', ['win', 'loss', 'draw']);
export const tournamentStatusEnum = pgEnum('tournament_status', ['running', 'finished']);
export const cosmeticKindEnum = pgEnum('cosmetic_kind', ['board_theme', 'avatar']);
export const flagStatusEnum = pgEnum('flag_status', ['open', 'cleared', 'confirmed']);

// ---------------------------------------------------------------- reference

export const countries = pgTable('countries', {
  code: char('code', { length: 2 }).primaryKey(),
});

export const leagues = pgTable('leagues', {
  slug: varchar('slug', { length: 16 }).primaryKey(),
  minTrophies: integer('min_trophies').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
});

export const seasons = pgTable('seasons', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
});

// ---------------------------------------------------------------- players

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 20 }).notNull(),
    email: varchar('email', { length: 254 }),
    passwordHash: text('password_hash'),
    isGuest: boolean('is_guest').notNull().default(true),
    isBot: boolean('is_bot').notNull().default(false),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    countryChangedAt: ts('country_changed_at'),
    avatar: varchar('avatar', { length: 48 }).notNull().default('home-white'),
    theme: varchar('theme', { length: 48 }).notNull().default('classic-pitch'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    index('users_country_idx').on(t.countryCode),
  ],
);

/** Hot counters live apart from the identity row so updates stay narrow. */
export const playerStats = pgTable(
  'player_stats',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    trophies: integer('trophies').notNull().default(0),
    league: varchar('league', { length: 16 })
      .notNull()
      .default('bronze')
      .references(() => leagues.slug),
    rating: real('rating').notNull().default(1500),
    ratingDeviation: real('rating_deviation').notNull().default(350),
    volatility: real('volatility').notNull().default(0.06),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    winStreak: integer('win_streak').notNull().default(0),
    bestTimeMs: integer('best_time_ms'),
    tournamentWins: integer('tournament_wins').notNull().default(0),
    coins: integer('coins').notNull().default(100),
  },
  (t) => [
    check('player_stats_coins_non_negative', sql`${t.coins} >= 0`),
    check('player_stats_trophies_non_negative', sql`${t.trophies} >= 0`),
    index('player_stats_trophies_idx').on(t.trophies.desc()),
  ],
);

// ---------------------------------------------------------------- puzzles

export const puzzles = pgTable(
  'puzzles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    difficulty: difficultyEnum('difficulty').notNull(),
    givens: char('givens', { length: 81 }).notNull(),
    solution: char('solution', { length: 81 }).notNull(),
    givensCount: smallint('givens_count').notNull(),
    difficultyScore: real('difficulty_score').notNull(),
    hardestTechnique: varchar('hardest_technique', { length: 32 }).notNull(),
    generatorSeed: bigint('generator_seed', { mode: 'number' }).notNull(),
    generatorVersion: smallint('generator_version').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('puzzles_difficulty_idx').on(t.difficulty), uniqueIndex('puzzles_givens_idx').on(t.givens)],
);

// ---------------------------------------------------------------- tournaments

export const tournaments = pgTable(
  'tournaments',
  {
    id: uuid('id').primaryKey(),
    status: tournamentStatusEnum('status').notNull().default('running'),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    size: smallint('size').notNull(),
    humanPlayers: smallint('human_players').notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    championId: uuid('champion_id').references(() => users.id),
    bracket: jsonb('bracket').notNull(),
  },
  (t) => [index('tournaments_started_idx').on(t.startedAt.desc())],
);

export const tournamentEntries = pgTable(
  'tournament_entries',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    bracketSeed: smallint('bracket_seed').notNull(),
    eliminatedRound: smallint('eliminated_round'),
    finalPlace: smallint('final_place'),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

// ---------------------------------------------------------------- matches

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey(),
    type: matchTypeEnum('type').notNull(),
    difficulty: difficultyEnum('difficulty').notNull(),
    puzzleId: bigint('puzzle_id', { mode: 'number' })
      .notNull()
      .references(() => puzzles.id),
    endReason: matchEndReasonEnum('end_reason').notNull(),
    winnerId: uuid('winner_id').references(() => users.id),
    tournamentId: uuid('tournament_id').references(() => tournaments.id),
    round: smallint('round'),
    bracketSlot: smallint('bracket_slot'),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at').notNull(),
  },
  (t) => [
    index('matches_tournament_idx').on(t.tournamentId),
    index('matches_ended_idx').on(t.endedAt.desc()),
  ],
);

export interface MoveRecord {
  cell: number;
  value: number;
  ok: boolean;
  /** Milliseconds since the match started (server clock). */
  t: number;
}

export const matchParticipants = pgTable(
  'match_participants',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    countryCode: char('country_code', { length: 2 }).notNull(),
    result: matchResultEnum('result').notNull(),
    finishTimeMs: integer('finish_time_ms'),
    mistakes: smallint('mistakes').notNull(),
    cellsFilled: smallint('cells_filled').notNull(),
    trophiesDelta: integer('trophies_delta').notNull().default(0),
    trophiesAfter: integer('trophies_after').notNull(),
    ratingBefore: real('rating_before').notNull(),
    ratingAfter: real('rating_after').notNull(),
    countryPoints: integer('country_points').notNull().default(0),
    coinsEarned: integer('coins_earned').notNull().default(0),
    moves: jsonb('moves').$type<MoveRecord[]>().notNull(),
    cheatScore: real('cheat_score'),
    endedAt: ts('ended_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.userId] }),
    index('match_participants_history_idx').on(t.userId, t.endedAt.desc()),
  ],
);

// ---------------------------------------------------------------- leaderboards & economy

/** Append-only source of truth for country scores. */
export const countryPointsLedger = pgTable(
  'country_points_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    points: integer('points').notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    /** Match or tournament id; with user and reason it makes every award idempotent. */
    refId: varchar('ref_id', { length: 64 }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('country_points_dedupe_idx').on(t.userId, t.reason, t.refId),
    index('country_points_season_idx').on(t.seasonId, t.countryCode),
  ],
);

export const countrySeasonScores = pgTable(
  'country_season_scores',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    points: bigint('points', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.countryCode] })],
);

export const cosmetics = pgTable('cosmetics', {
  slug: varchar('slug', { length: 48 }).primaryKey(),
  kind: cosmeticKindEnum('kind').notNull(),
  rarity: varchar('rarity', { length: 16 }).notNull(),
  unlock: jsonb('unlock').notNull(),
  price: integer('price'),
});

export const userCosmetics = pgTable(
  'user_cosmetics',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 48 })
      .notNull()
      .references(() => cosmetics.slug),
    source: varchar('source', { length: 16 }).notNull(),
    acquiredAt: ts('acquired_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slug] })],
);

export const currencyLedger = pgTable(
  'currency_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    refId: varchar('ref_id', { length: 64 }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('currency_ledger_dedupe_idx').on(t.userId, t.reason, t.refId)],
);

// ---------------------------------------------------------------- anti-cheat

export const anticheatFlags = pgTable(
  'anticheat_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    score: real('score').notNull(),
    signals: jsonb('signals').notNull(),
    /** Country points withheld until a reviewer clears the flag. */
    heldPoints: integer('held_points').notNull().default(0),
    heldSeasonId: integer('held_season_id'),
    heldCountryCode: char('held_country_code', { length: 2 }),
    status: flagStatusEnum('status').notNull().default('open'),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    resolutionNote: text('resolution_note'),
  },
  (t) => [index('anticheat_flags_status_idx').on(t.status, t.createdAt)],
);
