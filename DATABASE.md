# Database Reference (Supabase Postgres)

Last updated: 2026-02-03
Source: post-migration schema (doubles refactor applied).
See `AGENTS.md` for app-wide rules and guardrails.

## Overview
The database is designed for auditability and deterministic recomputation:
- Matches and games are append-only via soft-deactivation (`is_active=false`).
- RLS is enabled on all tables; writes go through SECURITY DEFINER RPCs.
- Audit log is append-only and admin-readable only.

## Tables

### `profiles`
Purpose: identity root for all domain data.

Key columns:
- `id uuid pk`
- `auth_user_id uuid unique`
- `username text unique not null`
- `display_name text not null`
- `is_active boolean default false`
- `is_admin boolean default false`
- audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`)

Constraints:
- `profiles_auth_user_id_key` UNIQUE (`auth_user_id`)
- `profiles_username_key` UNIQUE (`username`)
- update pair checks (updated_at/updated_by must be both NULL or both set)

RLS policies:
- `profiles_select_authenticated`: SELECT for authenticated (true)
- `profiles_admin_insert`, `profiles_admin_update`: admin-only INSERT/UPDATE

### `matches`
Purpose: match header row, cached derived fields at the side/team level.

Key columns:
- `id uuid pk`
- `match_type text not null default 'doubles'` CHECK in `('singles','doubles')`
- `match_format text` CHECK in `('bo1','bo3','bo5','bo7')`
- `match_date date not null`
- `competition_type text` CHECK in `('ranked','tournament')` default `ranked`
- `competition_id uuid` (FK competitions)
- `notes text`
- cached: `side_a_games_won`, `side_b_games_won`
- cached: `winner_side`, `loser_side` CHECK in `('A','B')`
- `is_active boolean default true`
- audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`)

Constraints:
- update pair checks (updated_at/updated_by)
- `winner_side <> loser_side`

Indexes:
- `idx_matches_match_date` (`match_date`)
- `idx_matches_type_date` (`match_type`, `match_date`)

RLS policies:
- `matches_select_authenticated`: SELECT for authenticated where `is_active=true` or admin

### `games`
Purpose: per-game scores (authoritative raw data) by side.

Key columns:
- `id uuid pk`
- `match_id uuid not null` (FK matches, ON DELETE CASCADE)
- `game_number int not null`
- `side_a_score int not null` (>= 0)
- `side_b_score int not null` (>= 0)
- `is_active boolean default true`
- audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`)

Constraints:
- update pair checks (updated_at/updated_by)

Indexes:
- `games_match_game_number_active`: UNIQUE (`match_id`, `game_number`) WHERE `is_active=true`
- `idx_games_match`: (`match_id`)

RLS policies:
- `games_select_authenticated`: SELECT for authenticated where `is_active=true` or admin

### `match_participants`
Purpose: membership of players on sides/slots for each match.

Key columns:
- `id uuid pk`
- `match_id uuid not null` (FK matches, ON DELETE CASCADE)
- `player_id uuid not null` (FK profiles)
- `side text not null` CHECK in `('A','B')`
- `slot int not null` CHECK in `(1,2)`
- `is_active boolean default true`
- audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`)

Constraints:
- update pair checks (updated_at/updated_by)

Indexes:
- UNIQUE `match_participants_unique_player_active` (`match_id`, `player_id`) WHERE `is_active=true`
- UNIQUE `match_participants_unique_slot_active` (`match_id`, `side`, `slot`) WHERE `is_active=true`
- `idx_match_participants_match` (`match_id`)
- `idx_match_participants_player` (`player_id`, `match_id`)

RLS policies:
- `match_participants_select_authenticated`: SELECT for authenticated where `is_active=true` or admin

### `competitions`
Purpose: optional grouping for tournament/ranked context.

Key columns:
- `id uuid pk`
- `name text not null`
- `format text not null`
- `start_date date`, `end_date date`
- `is_active boolean default true`
- audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`)

Constraints:
- update pair checks (updated_at/updated_by)

RLS policies:
- `competitions_select_authenticated`: SELECT for authenticated where `is_active=true` or admin
- `competitions_admin_insert`, `competitions_admin_update`: admin-only

### `audit_log`
Purpose: append-only audit trail.

Key columns:
- `id uuid pk`
- `entity_type text not null`
- `entity_id uuid not null`
- `action text not null`
- `before_data jsonb`, `after_data jsonb`
- `is_active boolean default true`
- `created_at timestamptz default now()`
- `created_by uuid not null` (FK profiles)

Indexes:
- `idx_audit_entity` (`entity_type`, `entity_id`)

RLS policies:
- `audit_log_select_admin`: SELECT for authenticated admins only

## Views

### `match_team_rosters`
Purpose: nested teams read shape for matches.

Behavior:
- Returns `team_a` and `team_b` as JSON arrays (ordered by slot).
- Filters to `is_active=true` or admin.
- SECURITY INVOKER so RLS applies.

## Functions (RPCs + helpers)

### `current_profile_id() -> uuid`
Returns `profiles.id` for the current auth user (`auth.uid()`).
SECURITY DEFINER; used inside RPCs for authorization.

### `is_admin() -> boolean`
Returns `profiles.is_admin` for the current auth user; defaults to false.
SECURITY DEFINER; used inside RPCs and RLS policies.

### `match_create(...) -> void`
Signature:
`(p_match_id uuid, p_match_type text, p_match_date date, p_match_format text, p_competition_type text, p_competition_id uuid, p_notes text, p_team_a jsonb, p_team_b jsonb, p_games jsonb, p_created_by uuid)`

Behavior:
- Auth required. `p_created_by` must equal `current_profile_id()`.
- Non-admins must be a participant.
- Validates match type/format/competition type.
- Validates team sizes and unique players across teams.
- Validates games: non-empty array, distinct `game_number`, scores non-negative and not tied.
- Computes side games won and winner/loser side.
- Inserts into `matches`, `match_participants`, `games`.
- Writes `audit_log` with `action='create'`.

### `match_update(...) -> void`
Signature:
`(p_match_id uuid, p_match_type text, p_match_date date, p_match_format text, p_competition_type text, p_competition_id uuid, p_notes text, p_team_a jsonb, p_team_b jsonb, p_games jsonb, p_updated_by uuid)`

Behavior:
- Auth required. `p_updated_by` must equal `current_profile_id()`.
- Non-admins must be participants and cannot change participants/match date/match type/competition.
- Locks match row; voided matches are admin-only.
- Soft-deactivates active `games` + `match_participants`.
- Inserts replacement rows, recomputes cached fields, updates match header.
- Writes `audit_log` with `action='update'`.

### `match_void(p_match_id, p_updated_by) -> void`
Behavior:
- Admin-only. Soft-deactivates match, games, and participants.
- Writes `audit_log` with `action='void'`.

### `username_available(p_username text) -> boolean`
Validates username: non-null, non-empty, regex `^[a-z0-9._-]+$`, case-insensitive uniqueness.

## Grants and RLS
- RLS is enabled on all tables.
- `matches`, `games`, and `match_participants` revoke general table privileges from `anon` and `authenticated`, then re-grant SELECT. RLS still gates access.
- RPCs are SECURITY DEFINER with explicit `GRANT EXECUTE` to `anon`, `authenticated`, and `service_role`.

## RLS Policies (Current List)
| schema | table | policy | command | using_expression | with_check_expression |
| --- | --- | --- | --- | --- | --- |
| public | audit_log | audit_log_select_admin | SELECT | is_admin() | null |
| public | competitions | competitions_admin_insert | INSERT | null | is_admin() |
| public | competitions | competitions_admin_update | UPDATE | is_admin() | is_admin() |
| public | competitions | competitions_select_authenticated | SELECT | ((is_active = true) OR is_admin()) | null |
| public | games | games_select_authenticated | SELECT | ((is_active = true) OR is_admin()) | null |
| public | matches | matches_select_authenticated | SELECT | ((is_active = true) OR is_admin()) | null |
| public | match_participants | match_participants_select_authenticated | SELECT | ((is_active = true) OR is_admin()) | null |
| public | profiles | profiles_admin_insert | INSERT | null | is_admin() |
| public | profiles | profiles_admin_update | UPDATE | is_admin() | is_admin() |
| public | profiles | profiles_select_authenticated | SELECT | true | null |

## Triggers (Relevant)
Auth profiles:
| schema | table | trigger_name | timing | definition |
| --- | --- | --- | --- | --- |
| auth | users | on_auth_user_created | AFTER INSERT | `handle_new_user_profile()` |

Non-app triggers (Supabase-managed):
| schema | table | trigger_name | timing |
| --- | --- | --- | --- |
| realtime | subscription | tr_check_filters | BEFORE INSERT OR UPDATE |
| storage | buckets | enforce_bucket_name_length_trigger | BEFORE INSERT OR UPDATE |
| storage | objects | objects_delete_delete_prefix | AFTER DELETE |
| storage | objects | objects_insert_create_prefix | BEFORE INSERT |
| storage | objects | objects_update_create_prefix | BEFORE UPDATE |
| storage | objects | update_objects_updated_at | BEFORE UPDATE |
| storage | prefixes | prefixes_create_hierarchy | BEFORE INSERT |
| storage | prefixes | prefixes_delete_hierarchy | AFTER DELETE |

