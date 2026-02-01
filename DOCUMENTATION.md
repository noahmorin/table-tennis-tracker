A lightweight, mobile-first web app for tracking competitive table tennis matches within a single office.

The system prioritizes **simplicity, correctness, auditability, and zero-cost hosting**, while remaining extensible enough to support Elo ranking and future tournament modes.

---

## 1. Project Goals

- Track ranked, competitive table tennis matches among trusted office users
- Display:
    - Leaderboards
    - Player profiles
    - Match history
    - Elo ratings (computed client-side)
- Allow low-friction match submission and correction
- Maintain a complete, auditable match history
- Avoid custom backend servers
- Operate entirely on free tiers

---

## 2. Non-Goals (Explicit)

- No anti-cheat
- No real-time scoring
- No offline support
- No schedules, fixtures, or future matches
- No heavy backend logic
- No optimization for large scale

Office-scale usage only (≈8–25 users).

---

## 3. Tech Stack

### Frontend

- Vue 3
- TypeScript
- Vite
- Mobile-first layout
- Hosted on GitHub Pages

### Backend / Data

- Supabase
    - PostgreSQL (free tier)
    - Supabase Auth (email + password)
- No NestJS
- No custom backend services
- Frontend talks directly to Supabase via SDK

---

## 4. Trust & Security Model

- All users are trusted
- Authentication exists only for identity attribution
- Data errors are acceptable and correctable
- Minimal Row Level Security (RLS)
- No anti-cheat, no rate limiting, no moderation workflows

---

## 5. Core Domain Model

### Fundamental Rule

> A match is a single record shared by both players.
> 
> 
> Games belong to that match.
> 
> All stats and Elo are derived from match history.
> 

---

# 6. Database Schema

---

## 6.0 Standard Audit Columns (Applied Everywhere)

Every mutable table **must** include the following columns:

```sql
is_active boolean NOT NULL DEFAULT true,

created_at timestamptz NOT NULL DEFAULT now(),
created_by uuid REFERENCES profiles(id),

updated_at timestamptz,
updated_by uuid REFERENCES profiles(id),

CHECK (
  (updated_at IS NULL AND updated_by IS NULL)
OR
  (updated_at IS NOT NULL AND updated_by IS NOT NULL)
)

```

### Semantics

- `is_active`
    - Soft-delete / void flag
    - Inactive rows are excluded from stats, Elo, and leaderboards by default
- `created_at`
    - Immutable timestamp of record creation
- `created_by`
    - Profile that created the record
- `updated_at`
    - Timestamp of last modification (nullable)
- `updated_by`
    - Profile that last modified the record (nullable)

### Rules

- No `ON DELETE CASCADE` on audit foreign keys
- Deactivated profiles remain valid references
- Audit fields are set by the application or security definer routines (the only trigger is auth user -> profile)
- `updated_at` and `updated_by` must always be set together

---

## 6.1 Profiles (Domain Users / Players)

Profiles represent **real people in the league**, regardless of whether they can log in.

```sql
profiles (
  id uuid PRIMARY KEY, -- internal profile ID (never changes)

  auth_user_id uuid UNIQUE NULL, -- references auth.users.id when linked

  username text UNIQUE NOT NULL,
  first_name text,
  last_name text,
  display_name text NOT NULL,
  
  is_active boolean NOT NULL DEFAULT false,
	is_admin boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),

  updated_at timestamptz,
  updated_by uuid REFERENCES profiles(id)
)
```

### Notes

- Profiles are created on signup via an `auth.users` trigger (using required metadata).
- Profiles are not pre-seeded; `auth_user_id` should always be set for active users.
- Access is governed by Supabase Auth + RLS. `profiles.is_active` is informational only.
- Historical matches remain intact even if auth is removed
- Profiles are the **only identity referenced by matches**

---

## 6.2 Matches (Core Entity)

Each real-world match is stored **once**, shared by both players.

```sql
matches (
  id uuid PRIMARY KEY,

  player1_id uuid NOT NULL REFERENCES profiles(id),
  player2_id uuid NOT NULL REFERENCES profiles(id),

-- derived (cached, recomputed on every edit)
  winner_user_id uuid REFERENCES profiles(id),
  loser_user_id uuid REFERENCES profiles(id),
  player1_games_won int NOT NULL,
  player2_games_won int NOT NULL,

  match_format text NOT NULL,
  match_date date NOT NULL,

  competition_type text NOT NULL DEFAULT 'ranked',
  competition_id uuid,

  notes text,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES profiles(id),

  updated_at timestamptz,
  updated_by uuid REFERENCES profiles(id),

CHECK (player1_id <> player2_id),
CHECK (competition_type IN ('ranked','tournament')),
CHECK (match_format IN ('bo1','bo3','bo5','bo7'))
)

```

### Notes

- One row per real-world match
- Derived fields are cached for read performance
- Raw game scores remain the source of truth
- `is_active = false` voids the match
- Voided matches are excluded from stats and Elo by default

---

## 6.3 Games (Raw Match Data)

Each game within a match is stored as a separate row.

```sql
games (
  id uuid PRIMARY KEY,

  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_number int NOT NULL,

  player1_score int NOT NULL,
  player2_score int NOT NULL,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES profiles(id),

  updated_at timestamptz,
  updated_by uuid REFERENCES profiles(id),

UNIQUE (match_id, game_number)
CHECK (player1_score >= 0),
CHECK (player2_score >= 0)
)

```

### Notes

- One row per game
- Scores are authoritative
- Players are inferred from the parent match
- Unique `(match_id, game_number)` ensures deterministic ordering
- Soft-delete supported for corrections

---

## 6.4 Competitions (Future – Tournament Support)

Not required at launch, but schema-ready.

```sql
competitions (
  id uuid PRIMARY KEY,

  name text NOT NULL,
  format text NOT NULL, -- 'round_robin', 'single_elim', etc
  start_date date,
  end_date date,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES profiles(id),

  updated_at timestamptz,
  updated_by uuid REFERENCES profiles(id)
)

```

### Notes

- Matches link via `competition_id`
- Tournament matches affect Elo by default
- Match logic remains identical across competition types

---

## 6.5 Audit Log (Immutable System Table)

Captures all mutations for accountability and debugging.

```sql
audit_log (
  id uuid PRIMARY KEY,

  entity_type text NOT NULL, -- 'profile', 'match', 'game', 'competition'
  entity_id uuid NOT NULL,

  action text NOT NULL, -- 'create', 'update', 'void', 'link_auth'

  before_data jsonb,
  after_data jsonb,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES profiles(id)
)
```

### Notes

- Audit rows are never updated
- Not used for rollback
- `is_active` exists for structural consistency only

---

## 7. Match Submission & Editing

### Submission Flow

- Player submits match after completion
- Standard users can only create matches that include themselves (player 1 is locked to their profile and they select player 2).
- Admins can create matches for any two players (select player 1 and player 2).
- Required inputs:
    - Player 1
    - Player 2
    - Match date (date only)
    - Game 1 score
    - Game 2 score
    - Optional Game 3 score
    - Optional notes
    - Match format (default: best-of-3)

### Validation (Client-Side)

- Minimum winning score: 11
- Win by 2
- No cap
- Best-of-X logic enforced
- Impossible scorelines blocked

### Editing Rules

- Either participant may edit a match
- Admins may edit any match
- Match ID remains constant
- Derived fields are recomputed
- Audit log records before/after

### Voiding

- Sets `is_active = false`
- Admins may void any match
- No hard deletes
- Excluded from stats/Elo by default

---

## 8. Elo & Stats Model

### Core Principle

> All stats and Elo are recomputed client-side from match history.
> 

No aggregates. No materialized views. No stored ratings.

### Ordering (Deterministic)

Matches are processed in this order:

1. `match_date`
2. `created_at`
3. `match_id`

This guarantees:

- Stable Elo
- Correct back-dated inserts
- Safe edits and voids

### Elo Defaults

- Single rating per player
- Tournament matches affect Elo by default
- Recomputed on every load

---

## 9. Leaderboard & Profiles

### Leaderboard Columns

- Matches played
- Match W/L
- Games W/L
- Points for
- Points against
- Point differential
- Win %
- Current streak (W/L)
- Elo

### Filters

- All time
- Last 30 days
- Last 90 days
- Custom date range

All filtering is applied **before computation**.

---

## 9.5 Statistics Dashboard (My Stats & Inspect Stats)

The application includes **two distinct statistics experiences**, each with a clearly defined purpose and scope.

### Guiding Principle

> Statistics are analytical and factual, not narrative or interpretive.
> 
> 
> The application presents data; the user derives insights.
> 

---

### My Stats (Personal Dashboard)

**Purpose**

A personalized, professional-grade dashboard for analyzing an individual player’s own historical performance.

**Intent**

- Self-analysis and self-improvement
- No ranking emphasis
- No motivational or coaching language
- No subjective or interpretive metrics

**Characteristics**

- Default stats view for logged-in users
- Modular layout using tabs
- Expand/collapse sections for mobile readability
- Light interactivity only (no deep navigation loops)

**Included Data (MVP)**

- Matches played
- Wins / losses
- Win %
- Games won / lost
- Games win %
- Points for / against
- Point differential
- Average point differential per game
- Average margin of victory per match
- Current streak (W/L)
- Longest win streak
- Best opponent (by record)
- Worst opponent (by record)
- Current Elo
- Highest Elo
- Lowest Elo
- Elo over time (chart)

**Filtering**

- All time
- Last 30 / 60 / 90 days
- Current month
- Custom date range

All filters are applied **before computation**.

**Explicit Exclusions (MVP)**

- No subjective stats
- No narrative insights
- No “clutch”, situational, or contextual breakdowns
- No league-relative comparisons (averages, percentiles)
- No predictive or ML-based metrics

Subjective and interesting insights can be considered post-mvp, however, for now keep thing simple.

---

### Inspect Player Stats (View-Only)

**Purpose**

Allow transparent inspection of another player’s performance without personalization or narrative framing.

**Intent**

- Transparency
- Context for leaderboard rankings
- Peer inspection only

**Characteristics**

- View-only
- Same core stat set as My Stats
- Neutral language and presentation
- No personalization or self-referential framing

**Access**

- Via leaderboard
- Via player profile routes

---

### Leaderboard vs Stats Boundary (Enforced)

- **Leaderboard** answers:
    
    > “Where do players rank relative to one another?”
    > 
- **My Stats** answers:
    
    > “How am I actually performing over time?”
    > 
- **Inspect Player Stats** answers:
    
    > “What does this player’s performance look like?”
    > 

Each surface has a **single responsibility** and avoids overlap.

---

### Computation Model

- All statistics are derived **client-side** from match history
- No pre-aggregated tables
- No stored statistics
- No stored Elo history
- All stats are deterministic and reproducible

Database queries may assist with **filtering and shaping**, but not with analytics logic.

---

### Interaction Rules

- Primary interaction: expand/collapse sections
- Secondary interaction: tap-through to match lists when relevant
- Navigation mirrors existing patterns (e.g. player name → inspect stats)
- Drill-down is optional, not the primary flow

---

## 10. Tournament Support (Future-Proofed)

### Current State

- No tournament UI
- No tournament logic

### Schema Support (Already Present)

- `competition_type`
- `competition_id`

Tournament matches:

- Use the same match + game model
- Share Elo logic
- Differ only by context

---

## 11. Routing / Pages (Initial)

- `/login`
- `/submit-match`
- `/leaderboard`
- `/players/:id`
- `/my-matches`

Mobile-first navigation (bottom tabs).

---

## 11.1 Admin Controls (Inline)

- Admin-only controls are inline on existing pages (hidden for non-admins).
- No global admin mode, toggle, or banner.
- Admins can create matches for any two players (select player 1 + player 2), edit any match, and void any match.
- Inactive matches/games are hidden by default; admin views can include an optional "include inactive" filter.
- The audit log remains database-only (no frontend surface).

---

## 12. Design Philosophy (Non-Negotiable)

- Store rich raw data
- Derive everything deterministically
- Prefer recomputation over storage
- Prefer correction over deletion
- No premature optimization
- Simplicity over theoretical purity

---

## 13. Final Lock Summary

- One match ID per real-world match
- Raw scores are truth
- Derived fields are cached
- Edits overwrite derived data
- Elo and stats are client-side only
- Tournament support is additive, not invasive
- Schema is stable and future-proof

---

## 14. Supabase setup (required)

### Auth settings

- Email confirmation: disabled.
- Site URL: `https://noahmorin.github.io/table-tennis-tracker/`
- Redirect allowlist:
  - `https://noahmorin.github.io/table-tennis-tracker/`
  - `http://localhost:5173/`

### Signup profile trigger

- On `auth.users` insert, create a `profiles` row and an `audit_log` row.
- Reject signup if `username`, `first_name`, or `last_name` are missing or blank.
- `profiles.id` is a new UUID (not the auth user id).
- Force `is_admin = false` on signup.

Example SQL (run in Supabase SQL editor):

```sql
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_profile_id uuid;
begin
  v_username := nullif(trim(lower(new.raw_user_meta_data->>'username')), '');
  v_first_name := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  v_last_name := nullif(trim(new.raw_user_meta_data->>'last_name'), '');

  if v_username is null or v_first_name is null or v_last_name is null then
    raise exception 'Missing required profile fields';
  end if;

  v_display_name := trim(v_first_name || ' ' || v_last_name);
  v_profile_id := gen_random_uuid();

  insert into public.profiles (
    id,
    auth_user_id,
    username,
    first_name,
    last_name,
    display_name,
    is_active,
    is_admin,
    created_by
  ) values (
    v_profile_id,
    new.id,
    v_username,
    v_first_name,
    v_last_name,
    v_display_name,
    true,
    false,
    v_profile_id
  );

  insert into public.audit_log (
    id,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    created_by
  ) values (
    gen_random_uuid(),
    'profile',
    v_profile_id,
    'create',
    null,
    jsonb_build_object(
      'id', v_profile_id,
      'username', v_username,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'display_name', v_display_name,
      'auth_user_id', new.id
    ),
    v_profile_id
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();
```

### Username availability RPC

- `public.username_available(text) -> boolean` is used by the signup form to avoid duplicate usernames.
- SQL lives in `supabase/username-available.sql`.

### Auth helper functions

- `public.current_profile_id()` and `public.is_admin()` are required by RLS policies and RPCs.
- SQL lives in `supabase/auth-helpers.sql`.

### Legacy cleanup

- `profile_link_auth` is not used. If it exists in the database, remove it with `supabase/remove-profile-link-auth.sql`.

### RLS policy intent (minimum)

- `profiles`: authenticated read (including inactive); admin-only insert/update. No client-side profile creation.
- `matches`/`games`: authenticated read (active only; admins may see inactive). App mutations go through `match_*`.
- `competitions`: authenticated read (active only); admin-only insert/update.
- `audit_log`: admin-only read; no direct client writes (functions/triggers only).

Notes:
- If you lock down `audit_log` inserts, `match_create`, `match_update`, and `match_void` must be security definer and must validate that the caller is a participant (or admin for voids).
- Consider helper functions like `current_profile_id()` and `is_admin()` to keep RLS policies readable.
- If you want to enforce RPC-only writes, drop the direct insert/update policies on `matches` and `games`.

### Match functions

- `match_create`, `match_update`, `match_void` are security definer and enforce participant/admin checks.
- SQL lives in `supabase/match-functions.sql`.

### Schema fix (required for `match_update`)

- `match_update` soft-deactivates old games then inserts replacements with the same `(match_id, game_number)`.
- A full unique constraint on `(match_id, game_number)` will block updates.
- Apply `supabase/games-index-fix.sql` to replace the full unique constraint with a partial unique index and drop duplicate indexes.
