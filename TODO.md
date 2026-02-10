## TODO

**Tournament Roadmap (Plan Only)**
- Implement tournament functionality later as a full release (not incremental MVP).
- Supports singles and doubles tournaments.
- Doubles tournaments use fixed teams (no dynamic pairing).
- Formats: single elimination, double elimination (with losers bracket), round robin.
- Multi-format tournaments allowed (e.g., round robin into elimination).
- Format sequence is predefined; each stage re-seeds based entirely on prior stage results (no Elo).
- Byes supported; byes do not count as wins and do not affect Elo.
- Seeding: auto by Elo; manual reorder allowed only in draft (after start requires rebuild).
- Late entries allowed only in draft (after start requires rebuild).
- Minimum players 4, no max.
- Tournament matches always count toward Elo with a slight K-factor increase (mandatory).
- K-factor multiplier lives in Elo config file (default 1.2).
- Elo used is competition-type specific (singles Elo for singles tournaments, doubles Elo for doubles tournaments).
- Doubles Elo uses the same rating system as non-tournament doubles; tournaments only apply the multiplier.
- Bracket generation is draft-only (auto by Elo or manual mapping).
- Standings and leaderboards computed live from matches.
- Tie-break options per tournament: match wins, game wins, points, head-to-head (order set by organizer).
- Tie-break rules are configurable per tournament.
- Admin-only tournament creation/editing; participants can edit their own matches.
- Tournaments live in `competitions`; tournament matches are `matches.competition_type='tournament'` with `competition_id`.
- Regular (non-tournament) matches have `competition_id` NULL.
- New tournament participants table required.
- No rollback beyond admin rebuild (void + regenerate).
- Edits audited in `audit_log`; no snapshot table needed.
- Separate tournament routes; bracket view desktop-first, mobile scrollable.
- Stats pages include tournament data; add filter by `competition_type` (and optionally `competition_id`).
- Round robin: one match per round; games per match configurable in tournament settings.
- Tournament workflow policy:
- `draft`: all edits allowed (participants, seeds, formats, bracket).
- `in_progress`: match results only; no entry/seed/bracket changes.
- `completed`/`archived`: view-only.
- Admin-only rebuild after start: void all tournament matches, regenerate bracket and rounds, audit before/after.

**Schema / Data Model**
- Treat `competitions` as the tournament root entity; add tournament metadata fields:
- `state` (`draft`, `in_progress`, `completed`, `archived`)
- `match_type` (`singles` or `doubles`)
- `allowed_formats` (jsonb array: `['round_robin','single_elim','double_elim']`)
- `seeding_rule` (text; default `elo`)
- `tiebreak_rules` (jsonb ordered list; options: match wins, game wins, points, head-to-head; configurable per tournament)
- `k_factor_multiplier` (numeric; default 1.2; slight increase)
- `allow_late_entries` (boolean, default true)
- `min_players` (int, default 4), `max_players` (int, nullable)
- New table: `competition_entries` (tournament participants/teams)
- Columns: `id`, `competition_id`, `seed`, `status`, `is_active`, audit columns
- New table: `competition_entry_members` (team members)
- Columns: `id`, `entry_id`, `player_id`, `slot`, `is_active`, audit columns
- Constraints: unique `(entry_id, slot)` and unique `(entry_id, player_id)`, plus `(competition_id, seed)` when active
- Ensure players are unique across entries within a competition (no player in multiple entries).
- New table: `competition_rounds`
- Columns: `id`, `competition_id`, `round_number`, `stage` (e.g., `round_robin`, `winners`, `losers`, `finals`), `format` (match format, e.g. `bo1/bo3/bo5/bo7`), `state`, `metadata`, audit columns
- Round IDs must be unique; round robin may have many rounds (e.g., 36).
- New table: `competition_round_matches`
- Columns: `id`, `round_id`, `match_id`, `bracket_side` (nullable), `bracket_pos` (nullable), `group_id` (nullable), `next_match_id` (nullable), `next_match_side` (nullable), audit columns
- Enforce: a player can only play one match per round (add via validation/RPC checks).
- Recommendation for round relationship:
- `competitions` -> `competition_rounds` -> `competition_round_matches` -> `matches`

**RPCs / Write Paths**
- Add SECURITY DEFINER RPCs to keep writes auditable and consistent:
- `competition_create(...)` (creates competition + optional initial rounds + entries)
- `competition_update(...)` (admin-only, writes audit log)
- `competition_add_entry(...)` (late entries)
- `competition_set_seeds(...)` (admin-only)
- `competition_generate_bracket(...)` (auto by Elo)
- `competition_set_bracket(...)` (manual bracket mapping)
- `competition_rebuild_bracket(...)` (admin-only; void matches + regenerate)
- `competition_round_set_state(...)` (draft/in_progress/completed)
- Ensure `audit_log` entries for all tournament mutations

**RLS / Permissions**
- Admin-only INSERT/UPDATE/DELETE on new tournament tables.
- SELECT for authenticated users; filter `is_active=true` unless admin.
- Match edit rules unchanged: participants can edit their own matches; admins can edit all.

**Match Integration**
- Tournament matches use existing `matches` + `games` tables.
- Ensure `competition_type='tournament'` on tournament matches.
- Update Elo computation to apply `k_factor_multiplier` when `competition_type='tournament'`.
- Keep deterministic computation ordering (match_date, created_at, id).

**Standings / Tie-Break**
- Implement standings logic per tournament using configurable tie-break order from `competitions.tiebreak_rules`.
- Live updates as matches are entered.
- Support standings for round robin and for multi-stage tournaments.

**Bracket Handling**
- Bracket is editable only in draft; after start requires rebuild.
- Manual bracket edits are draft-only and should update `competition_round_matches` and associated `matches`.
- Auto-seed uses Elo and respects byes.
- Double elimination includes losers bracket only (no additional consolation formats).

**Frontend / Routes**
- Add a dedicated tournament section and routes:
- `/tournaments`
- `/tournaments/:id`
- `/tournaments/:id/bracket`
- `/tournaments/:id/standings`
- `/tournaments/:id/participants`
- Admin-only tournament creation/editing UI.
- Bracket view: desktop-first with full bracket; mobile scroll/drag.

**Stats / Leaderboards**
- Add filter by `competition_type` (and optionally `competition_id`) to My Stats, Inspect Stats, and leaderboard.
- Ensure default remains all-time across ranked + tournament.

**Docs**
- Update `DATABASE.md` after schema changes.
- Document Elo multiplier behavior for tournaments.
