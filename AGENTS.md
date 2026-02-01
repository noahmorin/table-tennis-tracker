# Table Tennis Tracker App - Codex Agent Plan

Last updated: 2026-02-01

This file is the single, authoritative context pack for in-repo Codex/VSCode agents.
Use it as the default reference for code, schema, and UI decisions.

---

## 1. Purpose (one sentence)
A lightweight, mobile-first web app for tracking competitive table tennis matches inside one office, optimized for simplicity, correctness, auditability, and free-tier hosting.

---

## 2. Goals
- Track ranked matches among trusted office users (approx 8-25 players)
- Display: leaderboard, player profiles, Elo ratings (client-side)
- Low-friction match submission and correction
- Complete, auditable match records (no hard deletes)
- No custom backend servers; frontend talks directly to Supabase
- Operate entirely on free tiers (GitHub Pages + Supabase free tier)

## 3. Non-goals (explicit)
- No anti-cheat
- No real-time scoring
- No offline support
- No scheduling / fixtures / future matches
- No heavy backend logic
- No optimization for large scale

---

## 4. Tech stack
Frontend:
- Vue 3, TypeScript, Vite
- Mobile-first layout
- Hosted on GitHub Pages

Backend:
- Supabase (PostgreSQL + Supabase Auth username/password)
- No custom servers (no NestJS)
- Frontend uses Supabase SDK directly

---

## 5. Trust and security model
- Users are trusted
- Auth exists for identity attribution
- Data errors are acceptable and correctable
- Minimal RLS
- No rate limiting, moderation, or anti-cheat flows

Implication: prioritize clarity and auditability over adversarial security.

---

## 6. Core domain model
Fundamental rule:
- A match is a single record shared by both players.
- Games belong to that match.
- All stats and Elo are derived from match records.

Source of truth:
- Raw game scores (`games`) are authoritative.
- `matches` contains cached/derived fields for fast reads, recomputed on create/edit.
- No stored aggregates or stored Elo.

---

## 7. Deterministic computation rules (non-negotiable)
Processing order for Elo and derived stats:
1. `match_date`
2. `created_at`
3. `match_id`

Filtering rule:
- Apply filters (all-time / last 30/60/90 / custom range) BEFORE computation.

---

## 8. Stats surfaces boundary
There are two distinct stats experiences.

### 8.1 My Stats (personal dashboard)
Purpose: factual self-analysis for the logged-in user.

Rules:
- No league-relative comparisons (no percentiles, league averages)
- No subjective/interpretive metrics
- No coaching/motivational narrative
- Modular layout (tabs), expand/collapse for mobile

MVP metrics:
- Matches played, W/L, Win %
- Games W/L, Games Win %
- Points for/against, differential
- Avg point differential per game
- Avg margin of victory per match
- Current streak + longest win streak
- Best opponent / worst opponent (by record)
- Current Elo, highest Elo, lowest Elo
- Elo over time (chart)

### 8.2 Inspect Player Stats (view-only)
Purpose: neutral inspection of another player's stats.

Rules:
- Same core stat set as My Stats
- Neutral language, no personalization
- Access via leaderboard and player profile routes

Leaderboard vs Stats boundary:
- Leaderboard: "Where do players rank relative to one another?"
- My Stats: "How am I performing over time?"
- Inspect: "What does this player's performance look like?"

Avoid duplicating surfaces or turning stats pages into leaderboards.

---

## 9. Routes / pages (initial)
- `/login`
- `/submit-match`
- `/leaderboard`
- `/players/:id` (player profile + inspect stats)
- `/my-matches`

UI expectation: mobile-first with bottom tab navigation.

---

## 9.1 Admin controls (inline)
- Admin-only controls are inline on existing pages (hidden for non-admins).
- No global admin mode, toggle, or banner.
- Admins can create, edit, and void matches for any players.
- Inactive matches/games are hidden by default; admin views can include an optional "include inactive" filter.
- Audit log remains database-only (no frontend surface).

---

## 10. Match submission, edit, void
Submission inputs:
- Opponent
- Match date (date only)
- Game 1 score
- Game 2 score
- Optional Game 3 score (or more depending on match_format)
- Optional notes
- Match format (default `bo3`)
- Standard users can only create matches that include themselves (select opponent).
- Admins can create matches for any two players (select player 1 + player 2).

Client-side validation:
- Minimum winning score: 11
- Win by 2
- No cap
- Best-of-X logic enforced
- Impossible scorelines blocked

Editing rules:
- Either participant may edit a match
- Admins may edit any match
- Match ID remains constant
- Derived cached fields recomputed
- Audit log captures before/after

Voiding rules:
- Set `is_active = false`
- No hard deletes
- Excluded from stats/Elo by default
- Admins may void any match

---

## 11. Database (Supabase Postgres) - current state summary
Dump snapshot: 2026-01-30

### 11.1 Tables
- `profiles`
- `matches`
- `games`
- `competitions`
- `audit_log`

All tables include:
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `created_by uuid references profiles(id)` (some tables require NOT NULL)
- `updated_at timestamptz null`
- `updated_by uuid references profiles(id) null`
- CHECK enforcing `(updated_at, updated_by)` pair:
  - both NULL OR both NOT NULL

RLS is enabled on all tables.

### 11.2 `profiles`
Columns:
- `id uuid pk`
- `auth_user_id uuid unique null`
- `username text unique not null`
- `first_name text null`
- `last_name text null`
- `display_name text not null`
- `is_active boolean not null default false`
- `is_admin boolean not null default false`
- audit columns

Notes:
- Profiles are created via the auth trigger; no pre-seeding.
- `auth_user_id` is the access handle and should be set for active users.
- `is_active` is informational only and does not gate access.
- Historical matches reference profiles only (never auth users).

Constraints:
- UNIQUE(`username`)
- UNIQUE(`auth_user_id`)

FKs:
- `created_by` references `profiles(id)`
- `updated_by` references `profiles(id)`

### 11.3 `matches`
Columns:
- `id uuid pk`
- `player1_id uuid not null references profiles(id)`
- `player2_id uuid not null references profiles(id)`
- cached/derived:
  - `winner_user_id uuid references profiles(id)`
  - `loser_user_id uuid references profiles(id)`
  - `player1_games_won int not null`
  - `player2_games_won int not null`
- `match_format text not null` CHECK in `('bo1','bo3','bo5','bo7')`
- `match_date date not null`
- `competition_type text not null default 'ranked'` CHECK in `('ranked','tournament')`
- `competition_id uuid references competitions(id) null`
- `notes text null`
- `is_active boolean not null default true`
- audit columns (`created_by` NOT NULL)

Constraints:
- `player1_id <> player2_id`

Indexes:
- `idx_matches_match_date (match_date)`
- `idx_matches_players (player1_id, player2_id)`

### 11.4 `games`
Columns:
- `id uuid pk`
- `match_id uuid not null references matches(id) on delete cascade`
- `game_number int not null`
- `player1_score int not null check >= 0`
- `player2_score int not null check >= 0`
- `is_active boolean not null default true`
- audit columns (`created_by` NOT NULL)

Constraints:
- UNIQUE(`match_id`, `game_number`) (present twice in dump; treat as one logical constraint)

Indexes:
- `idx_games_match (match_id)` (plus an additional redundant `idx_games_match_id`)

### 11.5 `competitions`
Columns:
- `id uuid pk`
- `name text not null`
- `format text not null`
- `start_date date null`
- `end_date date null`
- `is_active boolean not null default true`
- audit columns (`created_by` NOT NULL)

### 11.6 `audit_log`
Columns:
- `id uuid pk`
- `entity_type text not null` (e.g. `profile`, `match`, `game`, `competition`)
- `entity_id uuid not null`
- `action text not null` (e.g. `create`, `update`, `void`, `link_auth`)
- `before_data jsonb null`
- `after_data jsonb null`
- `is_active boolean not null default true` (structural consistency only)
- `created_at timestamptz not null default now()`
- `created_by uuid not null references profiles(id)`

Index:
- `idx_audit_entity (entity_type, entity_id)`

Audit rows are append-only.

---

## 12. Database functions (current)
These are implemented in PL/pgSQL and are the intended write paths.

### 12.1 `match_create(...) -> void`
Signature:
- `(p_match_id uuid, p_player1_id uuid, p_player2_id uuid, p_match_date date, p_match_format text, p_games jsonb, p_notes text, p_created_by uuid)`

Behavior:
- Validates players distinct.
- Validates `p_match_format` in `bo1/bo3/bo5/bo7`.
- Validates `p_games` is a non-empty JSON array.
- For each game: requires `game_number`, `player1_score`, `player2_score`, non-negative, not tied.
- Computes games won; sets winner/loser accordingly.
- Inserts into `matches` (cached fields filled).
- Inserts each game into `games` (id is `gen_random_uuid()`).
- Inserts `audit_log` row with action `create` and `after_data` including players/date/format/notes/games.

### 12.2 `match_update(...) -> void`
Signature:
- `(p_match_id uuid, p_games jsonb, p_notes text, p_updated_by uuid)`

Behavior:
- Validates `p_games` structure (non-empty JSON array).
- `SELECT ... FOR UPDATE` on `matches` row.
- Captures `before` snapshot (`to_jsonb(v_match)`).
- Soft-deactivates existing active `games` rows for match (`is_active=false`, set updated pair).
- Inserts replacement `games` rows as new active rows.
- Recomputes cached winner/loser and games won.
- Updates `matches` cached fields + notes + updated pair.
- Inserts `audit_log` row with action `update`, `before_data`, and `after_data` containing `notes` + `games`.

### 12.3 `match_void(...) -> void`
Signature:
- `(p_match_id uuid, p_updated_by uuid)`

Behavior:
- Locks match row; captures `before` snapshot.
- Sets `matches.is_active=false` with updated pair.
- Sets active `games.is_active=false` with updated pair.
- Inserts `audit_log` row with action `void` and `before_data`.

---

## 13. Access model and permissions (current db state)
- RLS is enabled on all tables (policies not included in dump excerpt).
- GRANT ALL on tables and functions to roles:
  - `anon`
  - `authenticated`
  - `service_role`

Note: Broad grants mean RLS/policies are the real gate. Treat "write paths" as part of app correctness rather than security.
Apply `supabase/rls-rpc-only.sql` to enforce RPC-only writes on `matches` and `games`.
`profile_link_auth` is not used; remove it with `supabase/remove-profile-link-auth.sql`.

---

## 14. Implementation directives (guardrails)
### 14.1 Data correctness
- Never compute Elo or stats from cached `matches` fields alone.
- Always use active matches/games only (`is_active=true`), unless explicitly building an admin/audit view.
- Always sort matches by `match_date`, then `created_at`, then `id` before derived computations.
- Apply date filters before sorting/computation.

### 14.2 Mutations
- Prefer calling DB functions (`match_create`, `match_update`, `match_void`) over ad-hoc inserts/updates.
- Ensure the UI provides `created_by/updated_by` as the current profile id.
- Never hard-delete matches or games from the application.

### 14.3 Audit
- Treat `audit_log` as append-only.
- Any future mutation paths should add an `audit_log` row.

### 14.4 UI surface boundaries
- Leaderboard is comparative; stats dashboards are not.
- My Stats must not include league-relative comparisons.
- Inspect Stats is view-only and neutral.

### 14.5 Mobile-first UX
- Default to compact layouts, collapsible sections, and minimal navigation loops.

---

## 15. Known oddities / cleanup opportunities (do not break behavior)
- `games` has duplicated UNIQUE constraints for `(match_id, game_number)`.
- `games` also has duplicated match_id indexes (`idx_games_match`, `idx_games_match_id`).

Apply `supabase/games-index-fix.sql` to clean this up intentionally.

---

## 16. Appendix: quick table relationships
- `profiles` is the identity root referenced by everything.
- `matches.player1_id/player2_id/winner_user_id/loser_user_id/created_by/updated_by -> profiles.id`
- `games.match_id -> matches.id (on delete cascade)`
- `games.created_by/updated_by -> profiles.id`
- `competitions.created_by/updated_by -> profiles.id`
- `matches.competition_id -> competitions.id`
- `audit_log.created_by -> profiles.id`
