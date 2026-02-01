# TODO

## Match submission / edit / void
- [ ] Build submit match form (opponent, date, scores, format, notes).
- [ ] Enforce client validation (min 11, win by 2, best-of rules).
- [ ] Implement match creation via `match_create` (games JSON + notes).
- [ ] Implement match editing via `match_update`.
- [ ] Implement match voiding via `match_void`.
- [ ] Ensure all mutations write to `audit_log`.

## Stats & Elo
- [ ] Implement deterministic computation module (sort by `match_date`, `created_at`, `match_id`).
- [ ] Apply date filters before computation (all-time, last 30/60/90, custom).
- [ ] Implement Elo engine (single rating per player).
- [ ] Build My Stats dashboard (tabs, sections, metrics, Elo chart).
- [ ] Build Inspect Stats view (neutral language, same metric set).

## Pages & UX
- [ ] Leaderboard page with filters + derived stats.
- [ ] Player profile page (profile + inspect stats).
- [ ] My matches page (match history, edit/void actions).
- [ ] Decide on `/match-history` route vs `/my-matches`, update router/nav/docs.
- [ ] Add loading/empty/error states for data pages.

## Admin actions (inline)
- [ ] Inline admin-only controls (hidden for non-admins).
- [ ] Allow admins to create matches for any players (select player 1 + player 2).
- [ ] Allow admins to edit/void any match.
- [ ] Add "include inactive" filter where match lists are shown.

## Deploy
- [ ] Document GitHub Pages build/deploy steps and base path expectations.

## Documentation alignment
- [ ] Update `DOCUMENTATION.md`/`README.md` to match current auth choice (email + password) and routes.
