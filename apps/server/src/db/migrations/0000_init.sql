CREATE TYPE "public"."cosmetic_kind" AS ENUM('board_theme', 'avatar');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard', 'expert');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'cleared', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."match_end_reason" AS ENUM('completed', 'mistakes', 'timeout', 'forfeit', 'disconnect', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."match_result" AS ENUM('win', 'loss', 'draw');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('ranked', 'casual', 'tournament');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('running', 'finished');--> statement-breakpoint
CREATE TABLE "anticheat_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" real NOT NULL,
	"signals" jsonb NOT NULL,
	"held_points" integer DEFAULT 0 NOT NULL,
	"held_season_id" integer,
	"held_country_code" char(2),
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "cosmetics" (
	"slug" varchar(48) PRIMARY KEY NOT NULL,
	"kind" "cosmetic_kind" NOT NULL,
	"rarity" varchar(16) NOT NULL,
	"unlock" jsonb NOT NULL,
	"price" integer
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" char(2) PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "country_points_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"country_code" char(2) NOT NULL,
	"user_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"ref_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "country_season_scores" (
	"season_id" integer NOT NULL,
	"country_code" char(2) NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "country_season_scores_season_id_country_code_pk" PRIMARY KEY("season_id","country_code")
);
--> statement-breakpoint
CREATE TABLE "currency_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"ref_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"slug" varchar(16) PRIMARY KEY NOT NULL,
	"min_trophies" integer NOT NULL,
	"difficulty" "difficulty" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"result" "match_result" NOT NULL,
	"finish_time_ms" integer,
	"mistakes" smallint NOT NULL,
	"cells_filled" smallint NOT NULL,
	"trophies_delta" integer DEFAULT 0 NOT NULL,
	"trophies_after" integer NOT NULL,
	"rating_before" real NOT NULL,
	"rating_after" real NOT NULL,
	"country_points" integer DEFAULT 0 NOT NULL,
	"coins_earned" integer DEFAULT 0 NOT NULL,
	"moves" jsonb NOT NULL,
	"cheat_score" real,
	"ended_at" timestamp with time zone NOT NULL,
	CONSTRAINT "match_participants_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "match_type" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"puzzle_id" bigint NOT NULL,
	"end_reason" "match_end_reason" NOT NULL,
	"winner_id" uuid,
	"tournament_id" uuid,
	"round" smallint,
	"bracket_slot" smallint,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"trophies" integer DEFAULT 0 NOT NULL,
	"league" varchar(16) DEFAULT 'bronze' NOT NULL,
	"rating" real DEFAULT 1500 NOT NULL,
	"rating_deviation" real DEFAULT 350 NOT NULL,
	"volatility" real DEFAULT 0.06 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"win_streak" integer DEFAULT 0 NOT NULL,
	"best_time_ms" integer,
	"tournament_wins" integer DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 100 NOT NULL,
	CONSTRAINT "player_stats_coins_non_negative" CHECK ("player_stats"."coins" >= 0),
	CONSTRAINT "player_stats_trophies_non_negative" CHECK ("player_stats"."trophies" >= 0)
);
--> statement-breakpoint
CREATE TABLE "puzzles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"givens" char(81) NOT NULL,
	"solution" char(81) NOT NULL,
	"givens_count" smallint NOT NULL,
	"difficulty_score" real NOT NULL,
	"hardest_technique" varchar(32) NOT NULL,
	"generator_seed" bigint NOT NULL,
	"generator_version" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bracket_seed" smallint NOT NULL,
	"eliminated_round" smallint,
	"final_place" smallint,
	CONSTRAINT "tournament_entries_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "tournament_status" DEFAULT 'running' NOT NULL,
	"season_id" integer NOT NULL,
	"size" smallint NOT NULL,
	"human_players" smallint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"champion_id" uuid,
	"bracket" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_cosmetics" (
	"user_id" uuid NOT NULL,
	"slug" varchar(48) NOT NULL,
	"source" varchar(16) NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_cosmetics_user_id_slug_pk" PRIMARY KEY("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(20) NOT NULL,
	"email" varchar(254),
	"password_hash" text,
	"is_guest" boolean DEFAULT true NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"country_code" char(2) NOT NULL,
	"country_changed_at" timestamp with time zone,
	"avatar" varchar(48) DEFAULT 'home-white' NOT NULL,
	"theme" varchar(48) DEFAULT 'classic-pitch' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anticheat_flags" ADD CONSTRAINT "anticheat_flags_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticheat_flags" ADD CONSTRAINT "anticheat_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_points_ledger" ADD CONSTRAINT "country_points_ledger_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_points_ledger" ADD CONSTRAINT "country_points_ledger_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_points_ledger" ADD CONSTRAINT "country_points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_season_scores" ADD CONSTRAINT "country_season_scores_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_season_scores" ADD CONSTRAINT "country_season_scores_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_ledger" ADD CONSTRAINT "currency_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_league_leagues_slug_fk" FOREIGN KEY ("league") REFERENCES "public"."leagues"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_champion_id_users_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_slug_cosmetics_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."cosmetics"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anticheat_flags_status_idx" ON "anticheat_flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "country_points_dedupe_idx" ON "country_points_ledger" USING btree ("user_id","reason","ref_id");--> statement-breakpoint
CREATE INDEX "country_points_season_idx" ON "country_points_ledger" USING btree ("season_id","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "currency_ledger_dedupe_idx" ON "currency_ledger" USING btree ("user_id","reason","ref_id");--> statement-breakpoint
CREATE INDEX "match_participants_history_idx" ON "match_participants" USING btree ("user_id","ended_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_tournament_idx" ON "matches" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "matches_ended_idx" ON "matches" USING btree ("ended_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "player_stats_trophies_idx" ON "player_stats" USING btree ("trophies" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "puzzles_difficulty_idx" ON "puzzles" USING btree ("difficulty");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzles_givens_idx" ON "puzzles" USING btree ("givens");--> statement-breakpoint
CREATE INDEX "tournaments_started_idx" ON "tournaments" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email")) WHERE "users"."email" is not null;--> statement-breakpoint
CREATE INDEX "users_country_idx" ON "users" USING btree ("country_code");